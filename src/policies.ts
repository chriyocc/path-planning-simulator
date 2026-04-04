import type {
  Action,
  BranchId,
  Observation,
  PolicyDecision,
  PolicyStatusSnapshot,
  PolicyTraceEvent,
  BranchOrderMode,
  PolicyOverrides,
  RoundState,
  SimulationConfig,
  StrategyPolicy
} from "./types";
import { computeOptimalPolicy, computeOptimalPolicyLiFo } from "./planner";
import { GraphRouter } from "./router";
export { InferenceExpectedValuePolicy } from "./inferencePolicy";
import { InferenceExpectedValuePolicy } from "./inferencePolicy";
export {
  BusRevealedAfterPickupDeductivePolicy,
  BusRevealedAfterPickupPolicy,
  InferenceBusHybridPolicy
} from "./postPickupPolicies";
import {
  BusRevealedAfterPickupDeductivePolicy,
  BusRevealedAfterPickupPolicy,
  InferenceBusHybridPolicy
} from "./postPickupPolicies";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const FIXED_BRANCH_ORDER: BranchId[] = ["YELLOW", "BLUE", "GREEN", "RED"];
const FIXED_BRANCH_ORDERS: Record<BranchOrderMode, BranchId[]> = {
  yellow_blue_green_red: ["YELLOW", "BLUE", "GREEN", "RED"],
  red_yellow_blue_green: ["RED", "YELLOW", "BLUE", "GREEN"],
  blue_green_yellow_red: ["BLUE", "GREEN", "YELLOW", "RED"],
  green_blue_yellow_red: ["GREEN", "BLUE", "YELLOW", "RED"]
};
const DEFAULT_POLICY_OVERRIDES: PolicyOverrides = {
  black_lock_carry_mode: "auto",
  branch_order: "yellow_blue_green_red",
  color_drop_timing: "auto",
  lock_clear_strategy: "auto",
  resource_drop_order: "auto"
};

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

function inventoryForDropOrder(
  state: RoundState,
  dropOrder: PolicyOverrides["resource_drop_order"] = DEFAULT_POLICY_OVERRIDES.resource_drop_order
) {
  return dropOrder === "lifo" ? [...state.inventory].reverse() : state.inventory;
}

function topCarriedResource(
  state: RoundState,
  dropOrder: PolicyOverrides["resource_drop_order"] = DEFAULT_POLICY_OVERRIDES.resource_drop_order
) {
  return inventoryForDropOrder(state, dropOrder).find((item) => item.color !== "BLACK") ?? null;
}

function dropColorAtCurrentZone(
  state: RoundState,
  config: SimulationConfig,
  dropOrder: PolicyOverrides["resource_drop_order"] = DEFAULT_POLICY_OVERRIDES.resource_drop_order
): Action | null {
  if (dropOrder === "lifo") {
    const topItem = topCarriedResource(state, dropOrder);
    if (!topItem || topItem.color === "BLACK") return null;
    const color = topItem.color as Exclude<Action["color"], undefined>;
    return config.map.colorZoneNodeIds[color] === state.current_node ? { type: "DROP_RESOURCE", color } : null;
  }
  for (const item of inventoryForDropOrder(state, dropOrder)) {
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

function chooseDropColor(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  mode: "nearest" | "value",
  dropOrder: PolicyOverrides["resource_drop_order"] = DEFAULT_POLICY_OVERRIDES.resource_drop_order
): Action {
  if (dropOrder === "lifo") {
    const topItem = topCarriedResource(state, dropOrder);
    if (!topItem || topItem.color === "BLACK") {
      return { type: "END_ROUND" };
    }
    return { type: "DROP_RESOURCE", color: topItem.color as Exclude<Action["color"], undefined> };
  }

  const freq = new Map<Exclude<Action["color"], undefined>, number>();
  const points = new Map<Exclude<Action["color"], undefined>, number>();
  const recencyRank = new Map<Exclude<Action["color"], undefined>, number>();
  for (const item of state.inventory) {
    if (item.color === "BLACK") continue;
    const color = item.color as Exclude<Action["color"], undefined>;
    freq.set(color, (freq.get(color) ?? 0) + 1);
    const itemValue = config.map.branches[item.sourceBranch].resource_points;
    points.set(color, (points.get(color) ?? 0) + itemValue);
  }
  inventoryForDropOrder(state, dropOrder).forEach((item, index, orderedInventory) => {
    if (item.color === "BLACK") return;
    const color = item.color as Exclude<Action["color"], undefined>;
    if (!recencyRank.has(color)) {
      recencyRank.set(color, orderedInventory.length - index);
    }
  });

  const colors = [...freq.keys()];
  if (colors.length === 0) {
    return { type: "END_ROUND" };
  }

  let bestColor = colors[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestRank = Number.NEGATIVE_INFINITY;
  for (const color of colors) {
    const zoneNode = config.map.colorZoneNodeIds[color];
    const travel = travelSeconds(router, state.current_node, zoneNode) + config.robot.drop_s;
    const totalPoints = points.get(color) ?? 0;
    const count = freq.get(color) ?? 0;
    const score = mode === "nearest" ? -travel : (totalPoints + count * 0.25) / Math.max(0.001, travel);
    const rank = recencyRank.get(color) ?? 0;
    if (score > bestScore || (Math.abs(score - bestScore) < 1e-9 && rank > bestRank)) {
      bestScore = score;
      bestColor = color;
      bestRank = rank;
    }
  }
  return { type: "DROP_RESOURCE", color: bestColor };
}

function overrideDropActionForResourceOrder(
  state: RoundState,
  action: Action,
  overrides: PolicyOverrides
): Action {
  if (action.type !== "DROP_RESOURCE" || overrides.resource_drop_order !== "lifo") {
    return action;
  }
  const topItem = topCarriedResource(state, overrides.resource_drop_order);
  if (!topItem || topItem.color === "BLACK") {
    return action;
  }
  return { type: "DROP_RESOURCE", color: topItem.color as Exclude<Action["color"], undefined> };
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

function firstLockedBranchInOrder(state: RoundState, order: BranchId[], blockedBranches: BranchId[] = []): BranchId | null {
  for (const branchId of order) {
    if (blockedBranches.includes(branchId)) continue;
    if (!state.locks_cleared[branchId]) {
      return branchId;
    }
  }
  return null;
}

function firstUnlockedPendingBranchInOrder(state: RoundState, config: SimulationConfig, order: BranchId[]): BranchId | null {
  for (const branchId of order) {
    if (!state.locks_cleared[branchId]) continue;
    if (pendingSlotsForBranch(state, config, branchId).length > 0) {
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

function fixedRouteActionCore(
  state: RoundState,
  observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  order: BranchId[],
  blackLockCarryMode: PolicyOverrides["black_lock_carry_mode"],
  colorDropTiming: PolicyOverrides["color_drop_timing"],
  lockClearStrategy: PolicyOverrides["lock_clear_strategy"],
  resourceDropOrder: PolicyOverrides["resource_drop_order"] = DEFAULT_POLICY_OVERRIDES.resource_drop_order
): Action {
  const router = new GraphRouter(config.map, config.robot);
  const held = heldLocks(state);
  const pendingUnlockedBranch = firstUnlockedPendingBranchInOrder(state, config, order);
  const nextLockedBranch = firstLockedBranchInOrder(state, order, held);

  if (held.length > 0) {
    if (
      blackLockCarryMode === "fill_capacity" &&
      state.inventory.length === 0 &&
      held.length < config.robot.carry_capacity &&
      pendingUnlockedBranch === null &&
      nextLockedBranch
    ) {
      return { type: "PICK_LOCK", branchId: nextLockedBranch };
    }
    return { type: "DROP_LOCK", branchId: held[0] };
  }

  const immediateDrop = dropColorAtCurrentZone(state, config, resourceDropOrder);
  if (immediateDrop) {
    return immediateDrop;
  }

  if (state.inventory.length >= config.robot.carry_capacity) {
    return chooseDropColor(state, config, router, "nearest", resourceDropOrder);
  }

  if (colorDropTiming === "immediate" && state.inventory.length > 0) {
    return chooseDropColor(state, config, router, "nearest", resourceDropOrder);
  }

  if (lockClearStrategy === "clear_all_first" && nextLockedBranch) {
    return { type: "PICK_LOCK", branchId: nextLockedBranch };
  }

  if (pendingUnlockedBranch) {
    const nextPick = nextPickInFixedOrder(state, config, order);
    if (nextPick) {
      return nextPick;
    }
  }

  if (nextLockedBranch) {
    return { type: "PICK_LOCK", branchId: nextLockedBranch };
  }

  const nextPick = nextPickInFixedOrder(state, config, order);
  if (nextPick) {
    return nextPick;
  }

  if (state.inventory.length > 0) {
    return chooseDropColor(state, config, router, "nearest", resourceDropOrder);
  }

  if (state.placed_resources.length === 8) {
    return maybeReturnOrEnd(state, config);
  }

  if (observation.remaining_time_s < 10) {
    return { type: "END_ROUND" };
  }

  return maybeReturnOrEnd(state, config);
}

let optimalPathCache: Action[] | null = null;
let currentPlanIndex = 0;
let busShouldFinishCheapRemainingCargo = false;
let busCheapRemainingCargoColor: Exclude<Action["color"], undefined> | null = null;

function cheapRemainingCargoThresholdS(): number {
  return 14;
}

function busPolicySnapshot(action: Action, state: RoundState, notes: string[] = []): PolicyStatusSnapshot {
  const currentStep = action.type === "PICK_LOCK"
    ? `Pick ${action.branchId ?? "branch"} black lock`
    : action.type === "DROP_LOCK"
      ? `Drop ${action.branchId ?? "held"} black lock`
      : action.type === "PICK_RESOURCE"
        ? `Pick ${action.slotNodeId ?? "resource"}`
        : action.type === "DROP_RESOURCE"
          ? `Drop ${action.color ?? "resource"}`
          : action.type === "RETURN_START"
            ? "Return to start"
            : action.type === "MOVE_TO"
              ? `Move to ${action.targetNodeId ?? "target"}`
              : "End round";
  const locks = state.holding_locks_for_branches.length > 0
    ? state.holding_locks_for_branches.join(", ")
    : "none";
  const resources = state.inventory.length > 0
    ? state.inventory.map((item) => `${item.color}:${item.sourceBranch}`).join(", ")
    : "none";

  return {
    current_step: currentStep,
    next_step: "Re-evaluate after current step",
    holding: `locks=[${locks}] resources=[${resources}]`,
    knowledge_summary: "knowledge: not used by this policy",
    candidate_count: null,
    layout_locked: false,
    policy_notes: notes,
    known_slots: null
  };
}

function busDecisionCore(
  state: RoundState,
  observation: Observation,
  config: SimulationConfig
): Action {
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

  if (busShouldFinishCheapRemainingCargo && state.inventory.length === 1) {
    const remainingColor = state.inventory[0].color;
    if (remainingColor !== "BLACK" && busCheapRemainingCargoColor === remainingColor) {
      const remainingDropCost =
        travelSeconds(router, state.current_node, config.map.colorZoneNodeIds[remainingColor]) + config.robot.drop_s;
      busShouldFinishCheapRemainingCargo = false;
      busCheapRemainingCargoColor = null;
      if (remainingDropCost <= cheapRemainingCargoThresholdS()) {
        return { type: "DROP_RESOURCE", color: remainingColor };
      }
    } else {
      busShouldFinishCheapRemainingCargo = false;
      busCheapRemainingCargoColor = null;
    }
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
    if (state.time_elapsed_s === 0) {
      busShouldFinishCheapRemainingCargo = false;
      busCheapRemainingCargoColor = null;
    }
    return busDecisionCore(state, observation, config);
  },
  decide(state, observation, config): PolicyDecision {
    if (state.time_elapsed_s === 0) {
      busShouldFinishCheapRemainingCargo = false;
      busCheapRemainingCargoColor = null;
    }
    const action = busDecisionCore(state, observation, config);
    const notes =
      busShouldFinishCheapRemainingCargo && state.inventory.length === 1
        ? ["Prefer finishing a cheap remaining carried color after the last drop"]
        : [];
    return { action, snapshot: busPolicySnapshot(action, state, notes) };
  },
  onTraceStep(state, event, _config): PolicyStatusSnapshot {
    busShouldFinishCheapRemainingCargo = Boolean(
      event.action.type === "DROP_RESOURCE" &&
      state.inventory.length === 1 &&
      state.inventory[0]?.color !== "BLACK"
    );
    busCheapRemainingCargoColor = busShouldFinishCheapRemainingCargo
      ? state.inventory[0].color as Exclude<Action["color"], undefined>
      : null;
    return busPolicySnapshot(
      event.action,
      state,
      busShouldFinishCheapRemainingCargo
        ? ["Finish the cheap remaining carried color before reopening new lock work"]
        : event.note
          ? [event.note]
          : []
    );
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
    return fixedRouteActionCore(
      state,
      observation,
      config,
      FIXED_BRANCH_ORDER,
      DEFAULT_POLICY_OVERRIDES.black_lock_carry_mode,
      DEFAULT_POLICY_OVERRIDES.color_drop_timing,
      DEFAULT_POLICY_OVERRIDES.lock_clear_strategy,
      DEFAULT_POLICY_OVERRIDES.resource_drop_order
    );
  }
};

const OVERRIDE_CAPABLE_POLICY_NAMES = new Set<string>([BusRouteParametricPolicy.name, FixedRouteCapacity2Policy.name]);

export function policySupportsOverrides(policyName: string): boolean {
  return OVERRIDE_CAPABLE_POLICY_NAMES.has(policyName);
}

export function createDefaultPolicyOverrides(): PolicyOverrides {
  return { ...DEFAULT_POLICY_OVERRIDES };
}

export function policySupportsFixedRouteExperiment(policyName: string): boolean {
  return policyName === FixedRouteCapacity2Policy.name;
}

function normalizeOverrides(overrides?: Partial<PolicyOverrides>): PolicyOverrides {
  return {
    ...DEFAULT_POLICY_OVERRIDES,
    ...overrides
  };
}

function baselineActionWithOverrides(
  state: RoundState,
  observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  overrides: PolicyOverrides
): Action {
  const router = new GraphRouter(config.map, config.robot);
  const held = heldLocks(state);

  if (held.length > 0) {
    return { type: "DROP_LOCK", branchId: held[0] };
  }

  const immediateDrop = dropColorAtCurrentZone(state, config, overrides.resource_drop_order);
  if (immediateDrop) {
    return immediateDrop;
  }

  if (state.inventory.length > 0) {
    return chooseDropColor(state, config, router, "nearest", overrides.resource_drop_order);
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

function valueAwareActionWithOverrides(
  state: RoundState,
  observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  overrides: PolicyOverrides
): Action {
  const router = new GraphRouter(config.map, config.robot);
  const held = heldLocks(state);

  if (held.length > 0) {
    return { type: "DROP_LOCK", branchId: held[0] };
  }

  const immediateDrop = dropColorAtCurrentZone(state, config, overrides.resource_drop_order);
  if (immediateDrop) {
    return immediateDrop;
  }

  if (observation.remaining_time_s < 35) {
    if (state.inventory.length > 0) {
      return chooseDropColor(state, config, router, "value", overrides.resource_drop_order);
    }
    return state.placed_resources.length === 8 ? maybeReturnOrEnd(state, config) : { type: "END_ROUND" };
  }

  const minPoints = observation.remaining_time_s < 130 ? 30 : 0;
  const nextLocked = chooseNextLocked(state, config, router, "value", minPoints);
  if (nextLocked) {
    return { type: "PICK_LOCK", branchId: nextLocked };
  }

  if (state.inventory.length >= config.robot.carry_capacity) {
    return chooseDropColor(state, config, router, "value", overrides.resource_drop_order);
  }

  const pick = chooseNextPick(state, config, router, "value");
  if (pick) return pick;
  if (state.inventory.length > 0) return chooseDropColor(state, config, router, "value", overrides.resource_drop_order);
  return maybeReturnOrEnd(state, config);
}

function adaptiveActionWithOverrides(
  state: RoundState,
  observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  overrides: PolicyOverrides
): Action {
  const useSafe = observation.remaining_time_s > 300;
  if (useSafe) {
    return baselineActionWithOverrides(state, observation, config, overrides);
  }
  return valueAwareActionWithOverrides(state, observation, config, overrides);
}

function optimalActionWithOverrides(
  state: RoundState,
  _observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  overrides: PolicyOverrides
): Action {
  if (state.time_elapsed_s === 0 || optimalPathCache === null) {
    const router = new GraphRouter(config.map, config.robot);
    optimalPathCache = overrides.resource_drop_order === "lifo"
      ? computeOptimalPolicyLiFo(config, state, router)
      : computeOptimalPolicy(config, state, router);
    currentPlanIndex = 0;
  }

  if (optimalPathCache && currentPlanIndex < optimalPathCache.length) {
    return optimalPathCache[currentPlanIndex++];
  }
  return { type: "END_ROUND" };
}

function busRouteActionWithOverrides(
  state: RoundState,
  observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  overrides: PolicyOverrides
): Action {
  if (
    overrides.black_lock_carry_mode === "auto" &&
    overrides.resource_drop_order === DEFAULT_POLICY_OVERRIDES.resource_drop_order
  ) {
    return BusRouteParametricPolicy.nextAction(state, observation, config);
  }

  const router = new GraphRouter(config.map, config.robot);
  const held = heldLocks(state);

  if (held.length > 0) {
    if (
      overrides.black_lock_carry_mode === "auto" &&
      held.length === 1 &&
      state.inventory.length === 0 &&
      config.robot.carry_capacity >= 2
    ) {
      const candidate = chooseNextLocked(state, config, router, "value", 0, held);
      if (candidate && shouldChainSecondLockBeforeDrop(state, config, router, held[0], candidate)) {
        return { type: "PICK_LOCK", branchId: candidate };
      }
    } else if (
      overrides.black_lock_carry_mode === "fill_capacity" &&
      state.inventory.length === 0 &&
      held.length < config.robot.carry_capacity
    ) {
      const candidate = chooseNextLocked(state, config, router, "value", 0, held);
      if (candidate) {
        return { type: "PICK_LOCK", branchId: candidate };
      }
    }
    return { type: "DROP_LOCK", branchId: held[0] };
  }

  const immediateDrop = dropColorAtCurrentZone(state, config, overrides.resource_drop_order);
  if (immediateDrop) {
    return immediateDrop;
  }

  const nextLocked = chooseNextLocked(state, config, router, "value");
  if (nextLocked) {
    return { type: "PICK_LOCK", branchId: nextLocked };
  }

  if (state.inventory.length >= config.robot.carry_capacity) {
    return chooseDropColor(state, config, router, "value", overrides.resource_drop_order);
  }

  const pick = chooseNextPick(state, config, router, "value");
  if (pick) {
    return pick;
  }

  if (state.inventory.length > 0) {
    return chooseDropColor(state, config, router, "value", overrides.resource_drop_order);
  }

  if (state.placed_resources.length === 8) {
    return maybeReturnOrEnd(state, config);
  }

  if (observation.remaining_time_s < 12) {
    return { type: "END_ROUND" };
  }

  return { type: "END_ROUND" };
}

function fixedRouteActionWithOverrides(
  state: RoundState,
  observation: Parameters<StrategyPolicy["nextAction"]>[1],
  config: SimulationConfig,
  overrides: PolicyOverrides
): Action {
  if (
    overrides.black_lock_carry_mode === "auto" &&
    overrides.branch_order === DEFAULT_POLICY_OVERRIDES.branch_order &&
    overrides.color_drop_timing === DEFAULT_POLICY_OVERRIDES.color_drop_timing &&
    overrides.lock_clear_strategy === DEFAULT_POLICY_OVERRIDES.lock_clear_strategy &&
    overrides.resource_drop_order === DEFAULT_POLICY_OVERRIDES.resource_drop_order
  ) {
    return FixedRouteCapacity2Policy.nextAction(state, observation, config);
  }
  return fixedRouteActionCore(
    state,
    observation,
    config,
    FIXED_BRANCH_ORDERS[overrides.branch_order],
    overrides.black_lock_carry_mode,
    overrides.color_drop_timing,
    overrides.lock_clear_strategy,
    overrides.resource_drop_order
  );
}

export function withPolicyOverrides(basePolicy: StrategyPolicy, overrides?: Partial<PolicyOverrides>): StrategyPolicy {
  const normalized = normalizeOverrides(overrides);
  const supportsLegacyOverrides = policySupportsOverrides(basePolicy.name);
  const usesDefaultsOnly =
    normalized.black_lock_carry_mode === DEFAULT_POLICY_OVERRIDES.black_lock_carry_mode &&
    normalized.branch_order === DEFAULT_POLICY_OVERRIDES.branch_order &&
    normalized.color_drop_timing === DEFAULT_POLICY_OVERRIDES.color_drop_timing &&
    normalized.lock_clear_strategy === DEFAULT_POLICY_OVERRIDES.lock_clear_strategy &&
    normalized.resource_drop_order === DEFAULT_POLICY_OVERRIDES.resource_drop_order;

  if (!supportsLegacyOverrides && usesDefaultsOnly) {
    return basePolicy;
  }

  const lockSuffix =
    normalized.black_lock_carry_mode === "auto"
      ? "auto"
      : normalized.black_lock_carry_mode === "single"
        ? "single"
        : "fill";
  const branchSuffix = normalized.branch_order
    .split("_")
    .map((part) => part[0])
    .join("");
  const dropSuffix =
    normalized.color_drop_timing === "auto"
      ? "auto"
      : normalized.color_drop_timing === "immediate"
        ? "imm"
        : "full";
  const lockPhaseSuffix = normalized.lock_clear_strategy === "auto" ? "auto" : "alllocks";
  const resourceDropSuffix = normalized.resource_drop_order === "auto" ? "auto" : "lifo";
  const nameSuffix =
    basePolicy.name === FixedRouteCapacity2Policy.name
      ? `locks:${lockSuffix}|order:${branchSuffix}|drop:${dropSuffix}|phase:${lockPhaseSuffix}|cargo:${resourceDropSuffix}`
      : basePolicy.name === BusRouteParametricPolicy.name
        ? `locks:${lockSuffix}|cargo:${resourceDropSuffix}`
        : `cargo:${resourceDropSuffix}`;

  const wrapped: StrategyPolicy = {
    name: `${basePolicy.name}[${nameSuffix}]`,
    nextAction(state, observation, config) {
      if (basePolicy.name === BaselineSingleCarryPolicy.name) {
        return baselineActionWithOverrides(state, observation, config, normalized);
      }
      if (basePolicy.name === BusRouteParametricPolicy.name) {
        return busRouteActionWithOverrides(state, observation, config, normalized);
      }
      if (basePolicy.name === ValueAwareDeadlinePolicy.name) {
        return valueAwareActionWithOverrides(state, observation, config, normalized);
      }
      if (basePolicy.name === AdaptiveSafePolicy.name) {
        return adaptiveActionWithOverrides(state, observation, config, normalized);
      }
      if (basePolicy.name === FixedRouteCapacity2Policy.name) {
        return fixedRouteActionWithOverrides(state, observation, config, normalized);
      }
      if (basePolicy.name === OptimalOmniscientPolicy.name) {
        return optimalActionWithOverrides(state, observation, config, normalized);
      }
      return overrideDropActionForResourceOrder(
        state,
        basePolicy.nextAction(state, observation, config),
        normalized
      );
    }
  };

  if (basePolicy.decide) {
    wrapped.decide = (state, observation, config) => {
      const decision = basePolicy.decide!(state, observation, config);
      return {
        ...decision,
        action: overrideDropActionForResourceOrder(state, decision.action, normalized)
      };
    };
  }

  if (basePolicy.onTraceStep) {
    wrapped.onTraceStep = (state, event, config) => basePolicy.onTraceStep!(state, event, config);
  }

  return wrapped;
}

export const ALL_POLICIES: StrategyPolicy[] = [
  BaselineSingleCarryPolicy,
  BusRouteParametricPolicy,
  BusRevealedAfterPickupPolicy,
  BusRevealedAfterPickupDeductivePolicy,
  InferenceBusHybridPolicy,
  ValueAwareDeadlinePolicy,
  AdaptiveSafePolicy,
  FixedRouteCapacity2Policy,
  OptimalOmniscientPolicy,
  InferenceExpectedValuePolicy
];
