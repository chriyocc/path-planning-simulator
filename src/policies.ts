import type { Action, BranchId, RoundState, SimulationConfig, StrategyPolicy } from "./types";
import { computeOptimalPolicy } from "./planner";
import { GraphRouter } from "./router";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const FIXED_BRANCH_ORDER: BranchId[] = ["YELLOW", "BLUE", "GREEN", "RED"];

function nearestBlackZone(router: GraphRouter, fromNode: string, blackZones: string[]): string {
  let nearest = blackZones[0];
  let minTime = travelSeconds(router, fromNode, nearest);
  for (let i = 1; i < blackZones.length; i++) {
    const time = travelSeconds(router, fromNode, blackZones[i]);
    if (time < minTime) {
      minTime = time;
      nearest = blackZones[i];
    }
  }
  return nearest;
}

function pendingSlotsForBranch(state: RoundState, config: SimulationConfig, branchId: BranchId): string[] {
  const slots = config.map.branches[branchId].resource_slot_nodes;
  return slots.filter((slot) => !state.picked_slots[slot]);
}

function travelSeconds(router: GraphRouter, fromNode: string, toNode: string): number {
  return router.shortestPath(fromNode, toNode).cost_s;
}

function slotColorForNode(
  state: RoundState,
  config: SimulationConfig,
  branchId: BranchId,
  slotNodeId: string
): Exclude<Action["color"], undefined> | null {
  const slotIdx = config.map.branches[branchId].resource_slot_nodes.indexOf(slotNodeId);
  if (slotIdx < 0 || slotIdx > 1) return null;
  const color = state.branch_to_resources[branchId][slotIdx];
  if (color === "BLACK") return null;
  return color;
}

function allResourcesPicked(state: RoundState, config: SimulationConfig): boolean {
  return Object.values(config.map.branches).flatMap((b) => b.resource_slot_nodes).every((slot) => state.picked_slots[slot]);
}

function heldLocks(state: RoundState): BranchId[] {
  if (state.holding_locks_for_branches && state.holding_locks_for_branches.length > 0) {
    return state.holding_locks_for_branches;
  }
  return state.holding_lock_for_branch ? [state.holding_lock_for_branch] : [];
}

function dropColorAtCurrentZone(state: RoundState, config: SimulationConfig): Action | null {
  for (const item of state.inventory) {
    if (item.color === "BLACK") continue;
    const color = item.color as Exclude<Action["color"], undefined>;
    if (config.map.colorZoneNodeIds[color] === state.current_node) {
      return { type: "DROP_RESOURCE", color };
    }
  }
  return null;
}

function chooseNextLocked(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  mode: "nearest" | "value",
  minBranchPoints = 0,
  blockedBranches: BranchId[] = []
): BranchId | null {
  let best: { branchId: BranchId; score: number } | null = null;
  for (const branchId of BRANCHES) {
    if (state.locks_cleared[branchId]) continue;
    if (blockedBranches.includes(branchId)) continue;
    const branch = config.map.branches[branchId];
    if (branch.resource_points < minBranchPoints) continue;
    const lockNode = branch.lock_node;
    const toLock = travelSeconds(router, state.current_node, lockNode);
    const blackZone = nearestBlackZone(router, lockNode, config.map.blackZoneIds);
    const toBlack = travelSeconds(router, lockNode, blackZone);
    const totalTime = toLock + config.robot.pickup_s + toBlack + config.robot.drop_s;
    const value = branch.resource_points * 2;
    const score = mode === "nearest" ? -totalTime : value / Math.max(0.001, totalTime);
    if (!best || score > best.score) {
      best = { branchId, score };
    }
  }
  return best?.branchId ?? null;
}

function chooseDropColor(state: RoundState, config: SimulationConfig, router: GraphRouter, mode: "nearest" | "value"): Action {
  const freq = new Map<Exclude<Action["color"], undefined>, number>();
  const points = new Map<Exclude<Action["color"], undefined>, number>();
  for (const item of state.inventory) {
    if (item.color === "BLACK") continue;
    const color = item.color as Exclude<Action["color"], undefined>;
    freq.set(color, (freq.get(color) ?? 0) + 1);
    const itemValue = config.map.branches[item.sourceBranch].resource_points;
    points.set(color, (points.get(color) ?? 0) + itemValue);
  }

  const colors = [...freq.keys()];
  if (colors.length === 0) {
    return { type: "END_ROUND" };
  }

  let bestColor = colors[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const color of colors) {
    const zoneNode = config.map.colorZoneNodeIds[color];
    const travel = travelSeconds(router, state.current_node, zoneNode) + config.robot.drop_s;
    const totalPoints = points.get(color) ?? 0;
    const count = freq.get(color) ?? 0;
    const score = mode === "nearest" ? -travel : (totalPoints + count * 0.25) / Math.max(0.001, travel);
    if (score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }
  return { type: "DROP_RESOURCE", color: bestColor };
}

function chooseNextPick(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  mode: "nearest" | "value"
): Action | null {
  let best: { action: Action; score: number } | null = null;
  for (const branchId of BRANCHES) {
    if (!state.locks_cleared[branchId]) continue;
    const pending = pendingSlotsForBranch(state, config, branchId);
    for (const slotNodeId of pending) {
      const [slot1, slot2] = config.map.branches[branchId].resource_slot_nodes;
      if (slotNodeId === slot2 && !state.picked_slots[slot1]) {
        continue;
      }
      const toSlot = travelSeconds(router, state.current_node, slotNodeId) + config.robot.pickup_s;
      let score = -toSlot;
      if (mode === "value") {
        const color = slotColorForNode(state, config, branchId, slotNodeId);
        if (!color) continue;
        const toZone = travelSeconds(router, slotNodeId, config.map.colorZoneNodeIds[color]) + config.robot.drop_s;
        const points = config.map.branches[branchId].resource_points;
        score = points / Math.max(0.001, toSlot + toZone);
      }
      if (!best || score > best.score) {
        best = { action: { type: "PICK_RESOURCE", slotNodeId, branchId }, score };
      }
    }
  }
  return best?.action ?? null;
}

function shouldChainSecondLockBeforeDrop(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  heldBranch: BranchId,
  candidateBranch: BranchId
): boolean {
  const blackZones = config.map.blackZoneIds;
  const candidateLockNode = config.map.branches[candidateBranch].lock_node;
  const dropNowZone = nearestBlackZone(router, state.current_node, blackZones);
  const candidateDropZone = nearestBlackZone(router, candidateLockNode, blackZones);

  const curToBlack = travelSeconds(router, state.current_node, dropNowZone);
  const blackToCandidate = travelSeconds(router, dropNowZone, candidateLockNode);
  const candidateToBlack = travelSeconds(router, candidateLockNode, candidateDropZone);
  const curToCandidate = travelSeconds(router, state.current_node, candidateLockNode);

  // Option A: drop held lock now, then later go pick+drop candidate lock.
  const dropNowThenFetchSecond =
    curToBlack +
    config.robot.drop_s +
    blackToCandidate +
    config.robot.pickup_s +
    candidateToBlack +
    config.robot.drop_s;

  // Option B: pick candidate lock first, then make a single black-zone visit to drop both.
  const pickSecondThenDropBoth =
    curToCandidate +
    config.robot.pickup_s +
    candidateToBlack +
    config.robot.drop_s +
    config.robot.drop_s;

  return pickSecondThenDropBoth < dropNowThenFetchSecond;
}

function maybeReturnOrEnd(state: RoundState, config: SimulationConfig): Action {
  if (state.placed_resources.length === 8 && state.current_node !== config.map.startNodeId) {
    return { type: "RETURN_START" };
  }
  return { type: "END_ROUND" };
}

function firstLockedBranchInOrder(state: RoundState, order: BranchId[]): BranchId | null {
  for (const branchId of order) {
    if (!state.locks_cleared[branchId]) {
      return branchId;
    }
  }
  return null;
}

function nextPickInFixedOrder(state: RoundState, config: SimulationConfig, order: BranchId[]): Action | null {
  for (const branchId of order) {
    if (!state.locks_cleared[branchId]) continue;
    const pending = pendingSlotsForBranch(state, config, branchId);
    for (const slotNodeId of pending) {
      const [slot1, slot2] = config.map.branches[branchId].resource_slot_nodes;
      if (slotNodeId === slot2 && !state.picked_slots[slot1]) {
        continue;
      }
      return { type: "PICK_RESOURCE", slotNodeId, branchId };
    }
  }
  return null;
}

let optimalPathCache: Action[] | null = null;
let currentPlanIndex = 0;

export const OptimalOmniscientPolicy: StrategyPolicy = {
  name: "Optimal_Omniscient",
  nextAction(state, _, config) {
    if (state.time_elapsed_s === 0 || optimalPathCache === null) {
      const router = new GraphRouter(config.map, config.robot);
      optimalPathCache = computeOptimalPolicy(config, state, router);
      currentPlanIndex = 0;
    }
    
    if (optimalPathCache && currentPlanIndex < optimalPathCache.length) {
      return optimalPathCache[currentPlanIndex++];
    }
    return { type: "END_ROUND" };
  }
};

export const BaselineSingleCarryPolicy: StrategyPolicy = {
  name: "Baseline_SingleCarry",
  nextAction(state, observation, config) {
    const router = new GraphRouter(config.map, config.robot);
    const held = heldLocks(state);

    if (held.length > 0) {
      return { type: "DROP_LOCK", branchId: held[0] };
    }

    const immediateDrop = dropColorAtCurrentZone(state, config);
    if (immediateDrop) {
      return immediateDrop;
    }

    if (state.inventory.length > 0) {
      return chooseDropColor(state, config, router, "nearest");
    }

    const nextLocked = chooseNextLocked(state, config, router, "nearest");
    if (nextLocked) {
      return { type: "PICK_LOCK", branchId: nextLocked };
    }

    const pick = chooseNextPick(state, config, router, "nearest");
    if (pick) return pick;

    if (allResourcesPicked(state, config) && state.inventory.length === 0) {
      return maybeReturnOrEnd(state, config);
    }

    if (observation.remaining_time_s < 10) {
      return { type: "END_ROUND" };
    }

    return { type: "END_ROUND" };
  }
};

export const BusRouteParametricPolicy: StrategyPolicy = {
  name: "BusRoute_Parametric",
  nextAction(state, observation, config) {
    const router = new GraphRouter(config.map, config.robot);
    const held = heldLocks(state);

    if (held.length > 0) {
      if (held.length === 1 && state.inventory.length === 0 && config.robot.carry_capacity >= 2) {
        const candidate = chooseNextLocked(state, config, router, "value", 0, held);
        if (candidate && shouldChainSecondLockBeforeDrop(state, config, router, held[0], candidate)) {
          return { type: "PICK_LOCK", branchId: candidate };
        }
      }
      return { type: "DROP_LOCK", branchId: held[0] };
    }

    const immediateDrop = dropColorAtCurrentZone(state, config);
    if (immediateDrop) {
      return immediateDrop;
    }

    const nextLocked = chooseNextLocked(state, config, router, "value");
    if (nextLocked) {
      return { type: "PICK_LOCK", branchId: nextLocked };
    }

    if (state.inventory.length >= config.robot.carry_capacity) {
      return chooseDropColor(state, config, router, "value");
    }

    const pick = chooseNextPick(state, config, router, "value");
    if (pick) {
      return pick;
    }

    if (state.inventory.length > 0) {
      return chooseDropColor(state, config, router, "value");
    }

    if (state.placed_resources.length === 8) {
      return maybeReturnOrEnd(state, config);
    }

    if (observation.remaining_time_s < 12) {
      return { type: "END_ROUND" };
    }

    return { type: "END_ROUND" };
  }
};

export const ValueAwareDeadlinePolicy: StrategyPolicy = {
  name: "ValueAware_Deadline",
  nextAction(state, observation, config) {
    const router = new GraphRouter(config.map, config.robot);
    const held = heldLocks(state);

    if (held.length > 0) {
      return { type: "DROP_LOCK", branchId: held[0] };
    }

    const immediateDrop = dropColorAtCurrentZone(state, config);
    if (immediateDrop) {
      return immediateDrop;
    }

    if (observation.remaining_time_s < 35) {
      if (state.inventory.length > 0) {
        return chooseDropColor(state, config, router, "value");
      }
      return state.placed_resources.length === 8 ? maybeReturnOrEnd(state, config) : { type: "END_ROUND" };
    }

    const minPoints = observation.remaining_time_s < 130 ? 30 : 0;
    const nextLocked = chooseNextLocked(state, config, router, "value", minPoints);
    if (nextLocked) {
      return { type: "PICK_LOCK", branchId: nextLocked };
    }

    if (state.inventory.length >= config.robot.carry_capacity) {
      return chooseDropColor(state, config, router, "value");
    }

    const pick = chooseNextPick(state, config, router, "value");
    if (pick) return pick;
    if (state.inventory.length > 0) return chooseDropColor(state, config, router, "value");
    return maybeReturnOrEnd(state, config);
  }
};

export const AdaptiveSafePolicy: StrategyPolicy = {
  name: "AdaptiveSafe",
  nextAction(state, observation, config) {
    const useSafe = observation.remaining_time_s > 300;
    if (useSafe) {
      return BaselineSingleCarryPolicy.nextAction(state, observation, config);
    }
    return ValueAwareDeadlinePolicy.nextAction(state, observation, config);
  }
};

export const FixedRouteCapacity2Policy: StrategyPolicy = {
  name: "FixedRoute_Capacity2",
  nextAction(state, observation, config) {
    const router = new GraphRouter(config.map, config.robot);
    const held = heldLocks(state);

    if (held.length > 0) {
      return { type: "DROP_LOCK", branchId: held[0] };
    }

    const immediateDrop = dropColorAtCurrentZone(state, config);
    if (immediateDrop) {
      return immediateDrop;
    }

    const nextLockedBranch = firstLockedBranchInOrder(state, FIXED_BRANCH_ORDER);
    if (nextLockedBranch) {
      if (state.inventory.length >= config.robot.carry_capacity) {
        return chooseDropColor(state, config, router, "nearest");
      }
      return { type: "PICK_LOCK", branchId: nextLockedBranch };
    }

    if (state.inventory.length >= config.robot.carry_capacity) {
      return chooseDropColor(state, config, router, "nearest");
    }

    const nextPick = nextPickInFixedOrder(state, config, FIXED_BRANCH_ORDER);
    if (nextPick) {
      return nextPick;
    }

    if (state.inventory.length > 0) {
      return chooseDropColor(state, config, router, "nearest");
    }

    if (state.placed_resources.length === 8) {
      return maybeReturnOrEnd(state, config);
    }

    if (observation.remaining_time_s < 10) {
      return { type: "END_ROUND" };
    }

    return maybeReturnOrEnd(state, config);
  }
};

export const ALL_POLICIES: StrategyPolicy[] = [
  BaselineSingleCarryPolicy,
  BusRouteParametricPolicy,
  ValueAwareDeadlinePolicy,
  AdaptiveSafePolicy,
  FixedRouteCapacity2Policy,
  OptimalOmniscientPolicy
];
