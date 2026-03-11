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

interface PlannerSetup {
  capacity: number;
  pickup_s: number;
  drop_s: number;
  slotColors: number[];
  dist: number[][];
  startHeldMask: number;
  startClearedMask: number;
  startPickedMask: number;
  startDroppedMask: number;
  targetNodeId: number;
}

function popcount(n: number) {
  let count = 0;
  while (n) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

function buildPlannerSetup(
  config: SimulationConfig,
  initialState: RoundState,
  router: GraphRouter
): PlannerSetup {
  const capacity = config.robot.carry_capacity;
  const pickup_s = config.robot.pickup_s;
  const drop_s = config.robot.drop_s;

  const slotColors: number[] = Array(8).fill(0);
  for (let b = 0; b < 4; b++) {
    const branch = BRANCHES[b];
    const colors = initialState.branch_to_resources[branch];
    slotColors[b * 2] = BRANCHES.indexOf(colors[0] as BranchId);
    slotColors[b * 2 + 1] = BRANCHES.indexOf(colors[1] as BranchId);
  }

  const nodeCount = NODE_NAMES.length;
  const dist: number[][] = Array(nodeCount)
    .fill(0)
    .map(() => Array(nodeCount).fill(0));
  for (let i = 0; i < nodeCount; i++) {
    for (let j = 0; j < nodeCount; j++) {
      dist[i][j] = i === j ? 0 : router.shortestPath(ID_TO_NODE[i], ID_TO_NODE[j]).cost_s;
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

  return {
    capacity,
    pickup_s,
    drop_s,
    slotColors,
    dist,
    startHeldMask,
    startClearedMask,
    startPickedMask,
    startDroppedMask,
    targetNodeId: NODE_TO_ID["START"]
  };
}

function deriveInitialStack(initialState: RoundState, setup: PlannerSetup): number[] {
  const usedSlots = Array(8).fill(false);
  const droppedMask = setup.startDroppedMask;
  return initialState.inventory
    .filter((item) => item.color !== "BLACK")
    .map((item) => {
      for (let slot = 0; slot < 8; slot += 1) {
        if (usedSlots[slot]) continue;
        if (((setup.startPickedMask >> slot) & 1) === 0) continue;
        if (((droppedMask >> slot) & 1) !== 0) continue;
        const branchIdx = slot >> 1;
        if (BRANCHES[branchIdx] !== item.sourceBranch) continue;
        if (BRANCHES[setup.slotColors[slot]] !== item.color) continue;
        usedSlots[slot] = true;
        return slot;
      }
      throw new Error(`Could not map carried inventory item ${item.color} from ${item.sourceBranch} to a slot`);
    });
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
  const setup = buildPlannerSetup(config, initialState, router);
  const { capacity, pickup_s, drop_s, slotColors, dist, startHeldMask, startClearedMask, startPickedMask, startDroppedMask, targetNodeId } = setup;

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

interface LiFoPlannerState {
  nodeId: number;
  locksHeldMask: number;
  locksCleared: number;
  resPicked: number;
  resDropped: number;
  carriedSlots: number[];
}

function encodeLiFoState(state: LiFoPlannerState): string {
  return [
    state.nodeId,
    state.locksHeldMask,
    state.locksCleared,
    state.resPicked,
    state.resDropped,
    state.carriedSlots.join(".")
  ].join("|");
}

function cloneLiFoState(state: LiFoPlannerState): LiFoPlannerState {
  return {
    nodeId: state.nodeId,
    locksHeldMask: state.locksHeldMask,
    locksCleared: state.locksCleared,
    resPicked: state.resPicked,
    resDropped: state.resDropped,
    carriedSlots: [...state.carriedSlots]
  };
}

export function computeOptimalPolicyLiFo(
  config: SimulationConfig,
  initialState: RoundState,
  router: GraphRouter
): Action[] {
  const setup = buildPlannerSetup(config, initialState, router);
  const { capacity, pickup_s, drop_s, slotColors, dist, startHeldMask, startClearedMask, startPickedMask, startDroppedMask, targetNodeId } = setup;
  const startState: LiFoPlannerState = {
    nodeId: NODE_TO_ID[initialState.current_node] ?? NODE_TO_ID["START"],
    locksHeldMask: startHeldMask,
    locksCleared: startClearedMask,
    resPicked: startPickedMask,
    resDropped: startDroppedMask,
    carriedSlots: deriveInitialStack(initialState, setup)
  };

  const startKey = encodeLiFoState(startState);
  const bestCost = new Map<string, number>();
  const prevMap = new Map<string, { state: string; action: Action }>();
  const stateStore = new Map<string, LiFoPlannerState>([[startKey, startState]]);
  const heap = new MinHeap();
  heap.push(0, 0);
  const heapKeyStore = new Map<number, string>([[0, startKey]]);
  let nextHeapId = 1;
  bestCost.set(startKey, 0);

  const goalResMask = 255;
  let finalStateKey: string | null = null;
  let iters = 0;

  while (heap.data.length > 0) {
    const popped = heap.pop();
    if (!popped) break;
    const [heapId, currentCost] = popped;
    const stateKey = heapKeyStore.get(heapId);
    if (!stateKey) continue;
    const recordedCost = bestCost.get(stateKey);
    if (recordedCost === undefined || currentCost > recordedCost) continue;
    const s = stateStore.get(stateKey)!;

    if (s.resDropped === goalResMask && s.nodeId === targetNodeId) {
      finalStateKey = stateKey;
      break;
    }

    iters += 1;
    if (iters > 2000000) break;

    const relax = (nextState: LiFoPlannerState, addedCost: number, action: Action) => {
      const nextKey = encodeLiFoState(nextState);
      const altCost = currentCost + addedCost;
      const old = bestCost.get(nextKey);
      if (old === undefined || altCost < old) {
        bestCost.set(nextKey, altCost);
        prevMap.set(nextKey, { state: stateKey, action });
        stateStore.set(nextKey, nextState);
        const heapIdForKey = nextHeapId++;
        heapKeyStore.set(heapIdForKey, nextKey);
        heap.push(heapIdForKey, altCost);
      }
    };

    if (s.resDropped === goalResMask) {
      if (s.nodeId !== targetNodeId) {
        relax(
          { ...cloneLiFoState(s), nodeId: targetNodeId },
          dist[s.nodeId][targetNodeId],
          { type: "RETURN_START" }
        );
      }
      continue;
    }

    const inventoryCount = s.carriedSlots.length;
    const heldCount = popcount(s.locksHeldMask);
    const currentLoad = inventoryCount + heldCount;

    if (s.locksHeldMask > 0) {
      for (let b = 0; b < 4; b += 1) {
        if ((s.locksHeldMask & (1 << b)) === 0) continue;
        const bZone = nearestBlackZoneId(dist, s.nodeId, config.map.blackZoneIds);
        const nextState = cloneLiFoState(s);
        nextState.nodeId = bZone;
        nextState.locksHeldMask &= ~(1 << b);
        nextState.locksCleared |= 1 << b;
        relax(nextState, dist[s.nodeId][bZone] + drop_s, { type: "DROP_LOCK", branchId: BRANCHES[b] });
      }
    }

    if (currentLoad < capacity) {
      for (let b = 0; b < 4; b += 1) {
        if ((s.locksCleared & (1 << b)) !== 0) continue;
        if ((s.locksHeldMask & (1 << b)) !== 0) continue;
        const lNode = NODE_TO_ID["LOCK_" + BRANCHES[b]];
        const nextState = cloneLiFoState(s);
        nextState.nodeId = lNode;
        nextState.locksHeldMask |= 1 << b;
        relax(nextState, dist[s.nodeId][lNode] + pickup_s, { type: "PICK_LOCK", branchId: BRANCHES[b] });
      }
    }

    if (currentLoad < capacity) {
      for (let slot = 0; slot < 8; slot += 1) {
        if ((s.resPicked & (1 << slot)) !== 0) continue;
        if (slot % 2 === 1 && (s.resPicked & (1 << (slot - 1))) === 0) continue;
        const branchIdx = slot >> 1;
        if ((s.locksCleared & (1 << branchIdx)) === 0) continue;
        const slotName = "R_" + BRANCHES[branchIdx] + "_" + ((slot % 2) + 1);
        const slNode = NODE_TO_ID[slotName];
        const nextState = cloneLiFoState(s);
        nextState.nodeId = slNode;
        nextState.resPicked |= 1 << slot;
        nextState.carriedSlots.push(slot);
        relax(nextState, dist[s.nodeId][slNode] + pickup_s, {
          type: "PICK_RESOURCE",
          slotNodeId: slotName,
          branchId: BRANCHES[branchIdx]
        });
      }
    }

    if (s.carriedSlots.length > 0) {
      const topSlot = s.carriedSlots[s.carriedSlots.length - 1];
      const colorIdx = slotColors[topSlot];
      const zNode = NODE_TO_ID["ZONE_" + BRANCHES[colorIdx]];
      const nextState = cloneLiFoState(s);
      nextState.nodeId = zNode;
      nextState.resDropped |= 1 << topSlot;
      nextState.carriedSlots.pop();
      relax(nextState, dist[s.nodeId][zNode] + drop_s, { type: "DROP_RESOURCE", color: BRANCHES[colorIdx] });
    }
  }

  const path: Action[] = [];
  let curr = finalStateKey;
  while (curr !== null) {
    const entry = prevMap.get(curr);
    if (!entry) break;
    path.push(entry.action);
    curr = entry.state;
  }

  path.reverse();
  return path.length > 0 ? path : [{ type: "END_ROUND" }];
}
