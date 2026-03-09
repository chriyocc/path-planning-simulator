import { GraphRouter } from "./router";
import type { Action, BranchId, ResourceColor, RoundState, SimulationConfig } from "./types";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];

const NODE_NAMES = [
  "START",
  "BLACK_ZONE",
  "BLACK_ZONE_RIGHT",
  "ZONE_RED",
  "ZONE_YELLOW",
  "ZONE_BLUE",
  "ZONE_GREEN",
  "LOCK_RED",
  "LOCK_YELLOW",
  "LOCK_BLUE",
  "LOCK_GREEN",
  "R_RED_1",
  "R_RED_2",
  "R_YELLOW_1",
  "R_YELLOW_2",
  "R_BLUE_1",
  "R_BLUE_2",
  "R_GREEN_1",
  "R_GREEN_2"
];

const NODE_TO_ID = Object.fromEntries(NODE_NAMES.map((name, i) => [name, i]));
const ID_TO_NODE: Record<number, string> = Object.fromEntries(NODE_NAMES.map((name, i) => [i, name]));

function nearestBlackZoneId(dist: number[][], fromNodeId: number, blackZoneIds: string[]): number {
  const zoneNodeIds = blackZoneIds.map((zoneId) => NODE_TO_ID[zoneId]).filter((id) => id !== undefined);
  if (zoneNodeIds.length === 0) {
    throw new Error("No black zones configured for planner");
  }
  let bestNodeId = zoneNodeIds[0];
  let bestCost = dist[fromNodeId][bestNodeId];
  for (let i = 1; i < zoneNodeIds.length; i += 1) {
    const candidateId = zoneNodeIds[i];
    const candidateCost = dist[fromNodeId][candidateId];
    if (candidateCost < bestCost) {
      bestCost = candidateCost;
      bestNodeId = candidateId;
    }
  }
  return bestNodeId;
}

function packState(nodeId: number, locksHeldMask: number, locksCleared: number, resPicked: number, resDropped: number): number {
  return nodeId | (locksHeldMask << 5) | (locksCleared << 9) | (resPicked << 13) | (resDropped << 21);
}

function unpackState(packed: number) {
  return {
    nodeId: packed & 31,
    locksHeldMask: (packed >> 5) & 15,
    locksCleared: (packed >> 9) & 15,
    resPicked: (packed >> 13) & 255,
    resDropped: (packed >> 21) & 255
  };
}

class MinHeap {
  public data: number[] = [];
  public values: number[] = [];

  push(item: number, value: number) {
    this.data.push(item);
    this.values.push(value);
    this.up(this.data.length - 1);
  }

  pop(): [number, number] | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const topVal = this.values[0];
    const bottom = this.data.pop()!;
    const bottomVal = this.values.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.values[0] = bottomVal;
      this.down(0);
    }
    return [top, topVal];
  }

  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.values[p] <= this.values[i]) break;
      const t = this.data[i];
      this.data[i] = this.data[p];
      this.data[p] = t;
      const tv = this.values[i];
      this.values[i] = this.values[p];
      this.values[p] = tv;
      i = p;
    }
  }

  private down(i: number) {
    const len = this.data.length;
    while ((i << 1) + 1 < len) {
      let left = (i << 1) + 1;
      let right = left + 1;
      let min = left;
      if (right < len && this.values[right] < this.values[left]) {
        min = right;
      }
      if (this.values[i] <= this.values[min]) break;
      const t = this.data[i];
      this.data[i] = this.data[min];
      this.data[min] = t;
      const tv = this.values[i];
      this.values[i] = this.values[min];
      this.values[min] = tv;
      i = min;
    }
  }
}

export function computeOptimalPolicy(
  config: SimulationConfig,
  initialState: RoundState,
  router: GraphRouter
): Action[] {
  const capacity = config.robot.carry_capacity;
  const pickup_s = config.robot.pickup_s;
  const drop_s = config.robot.drop_s;

  const slotColors: number[] = Array(8).fill(0);
  for (let b = 0; b < 4; b++) {
    const branch = BRANCHES[b];
    const colors = initialState.branch_to_resources[branch];
    const colorId0 = BRANCHES.indexOf(colors[0] as BranchId);
    const colorId1 = BRANCHES.indexOf(colors[1] as BranchId);
    slotColors[b * 2] = colorId0;
    slotColors[b * 2 + 1] = colorId1;
  }

  const nodeCount = NODE_NAMES.length;
  const dist: number[][] = Array(nodeCount).fill(0).map(() => Array(nodeCount).fill(0));
  for (let i = 0; i < nodeCount; i++) {
    for (let j = 0; j < nodeCount; j++) {
      if (i === j) dist[i][j] = 0;
      else {
        dist[i][j] = router.shortestPath(ID_TO_NODE[i], ID_TO_NODE[j]).cost_s;
      }
    }
  }

  let startHeldMask = 0;
  const initialHeld = initialState.holding_locks_for_branches?.length
    ? initialState.holding_locks_for_branches
    : (initialState.holding_lock_for_branch ? [initialState.holding_lock_for_branch] : []);
  for (const branchId of initialHeld) {
    const idx = BRANCHES.indexOf(branchId);
    if (idx >= 0) startHeldMask |= 1 << idx;
  }
  let startClearedMask = 0;
  for (let b = 0; b < BRANCHES.length; b += 1) {
    if (initialState.locks_cleared[BRANCHES[b]]) startClearedMask |= 1 << b;
  }
  let startPickedMask = 0;
  for (let slot = 0; slot < 8; slot += 1) {
    const branchIdx = slot >> 1;
    const slotName = "R_" + BRANCHES[branchIdx] + "_" + ((slot % 2) + 1);
    if (initialState.picked_slots[slotName]) startPickedMask |= 1 << slot;
  }
  let startDroppedMask = 0;
  const droppedSlots = Array(8).fill(0);
  for (const placed of initialState.placed_resources) {
    for (let slot = 0; slot < 8; slot += 1) {
      if (droppedSlots[slot]) continue;
      if (((startPickedMask >> slot) & 1) === 0) continue;
      const branchIdx = slot >> 1;
      if (BRANCHES[branchIdx] === placed.sourceBranch && BRANCHES[slotColors[slot]] === placed.color) {
        droppedSlots[slot] = 1;
        startDroppedMask |= 1 << slot;
        break;
      }
    }
  }

  const startPacked = packState(
    NODE_TO_ID[initialState.current_node] ?? NODE_TO_ID["START"],
    startHeldMask,
    startClearedMask,
    startPickedMask,
    startDroppedMask
  );
  const bestCost = new Map<number, number>();
  const prevMap = new Map<number, { state: number; action: Action }>();
  
  const heap = new MinHeap();
  heap.push(startPacked, 0);
  bestCost.set(startPacked, 0);

  const goalResMask = 255;
  const targetNodeId = NODE_TO_ID["START"];

  function popcount(n: number) {
    let count = 0;
    while (n) {
      count += n & 1;
      n >>= 1;
    }
    return count;
  }

  let finalState: number | null = null;
  let iters = 0;

  while (heap.data.length > 0) {
    const popped = heap.pop();
    if (!popped) break;
    const [u, currentCost] = popped;

    const recordedCost = bestCost.get(u)!;
    if (currentCost > recordedCost) continue;

    const s = unpackState(u);
    
    // Check goal condition: all 8 dropped + returned to start
    if (s.resDropped === goalResMask && s.nodeId === targetNodeId) {
      finalState = u;
      break;
    }

    iters++;
    if (iters > 2000000) break; // Fallback to avoid hanging

    const relax = (newU: number, addedCost: number, action: Action) => {
      const altCost = currentCost + addedCost;
      const old = bestCost.get(newU);
      if (old === undefined || altCost < old) {
        bestCost.set(newU, altCost);
        prevMap.set(newU, { state: u, action });
        heap.push(newU, altCost);
      }
    };

    if (s.resDropped === goalResMask) {
      if (s.nodeId !== targetNodeId) {
        relax(packState(targetNodeId, s.locksHeldMask, s.locksCleared, s.resPicked, s.resDropped), dist[s.nodeId][targetNodeId], { type: "RETURN_START" });
      }
      continue;
    }

    const inventoryCount = popcount(s.resPicked) - popcount(s.resDropped);
    const heldCount = popcount(s.locksHeldMask);
    const currentLoad = inventoryCount + heldCount;

    if (s.locksHeldMask > 0) {
      for (let b = 0; b < 4; b++) {
        if ((s.locksHeldMask & (1 << b)) === 0) continue;
        const bZone = nearestBlackZoneId(dist, s.nodeId, config.map.blackZoneIds);
        const newLocksHeldMask = s.locksHeldMask & ~(1 << b);
        const newLocksCleared = s.locksCleared | (1 << b);
        relax(
          packState(bZone, newLocksHeldMask, newLocksCleared, s.resPicked, s.resDropped),
          dist[s.nodeId][bZone] + drop_s,
          { type: "DROP_LOCK", branchId: BRANCHES[b] }
        );
      }
    }

    if (currentLoad < capacity) {
      for (let b = 0; b < 4; b++) {
        if ((s.locksCleared & (1 << b)) === 0) {
          if ((s.locksHeldMask & (1 << b)) !== 0) continue;
          const lNode = NODE_TO_ID["LOCK_" + BRANCHES[b]];
          relax(
            packState(lNode, s.locksHeldMask | (1 << b), s.locksCleared, s.resPicked, s.resDropped),
            dist[s.nodeId][lNode] + pickup_s,
            { type: "PICK_LOCK", branchId: BRANCHES[b] }
          );
        }
      }
    }

    if (currentLoad < capacity) {
      for (let slot = 0; slot < 8; slot++) {
        if ((s.resPicked & (1 << slot)) === 0) {
          if (slot % 2 === 1) {
            const firstSlot = slot - 1;
            if ((s.resPicked & (1 << firstSlot)) === 0) continue;
          }
          const branchIdx = slot >> 1;
          if ((s.locksCleared & (1 << branchIdx)) !== 0) {
            const slotName = "R_" + BRANCHES[branchIdx] + "_" + ((slot % 2) + 1);
            const slNode = NODE_TO_ID[slotName];
            relax(
              packState(slNode, s.locksHeldMask, s.locksCleared, s.resPicked | (1 << slot), s.resDropped),
              dist[s.nodeId][slNode] + pickup_s,
              { type: "PICK_RESOURCE", slotNodeId: slotName, branchId: BRANCHES[branchIdx] }
            );
          }
        }
      }
    }

    if (inventoryCount > 0) {
      const invColors = new Set<number>();
      for (let slot = 0; slot < 8; slot++) {
        if (((s.resPicked & (1 << slot)) !== 0) && ((s.resDropped & (1 << slot)) === 0)) {
          invColors.add(slotColors[slot]);
        }
      }

      for (const colorIdx of invColors) {
        let droppedSlot = -1;
        for (let slot = 0; slot < 8; slot++) {
           if (((s.resPicked & (1 << slot)) !== 0) && ((s.resDropped & (1 << slot)) === 0) && slotColors[slot] === colorIdx) {
             droppedSlot = slot;
             break;
           }
        }

        if (droppedSlot !== -1) {
          const zNode = NODE_TO_ID["ZONE_" + BRANCHES[colorIdx]];
          relax(
            packState(zNode, s.locksHeldMask, s.locksCleared, s.resPicked, s.resDropped | (1 << droppedSlot)),
            dist[s.nodeId][zNode] + drop_s,
            { type: "DROP_RESOURCE", color: BRANCHES[colorIdx] }
          );
        }
      }
    }
  }

  const path: Action[] = [];
  let curr = finalState;
  while (curr !== null) {
    const entry = prevMap.get(curr);
    if (!entry) break;
    path.push(entry.action);
    curr = entry.state;
  }
  
  path.reverse();
  return path.length > 0 ? path : [{ type: "END_ROUND" }];
}
