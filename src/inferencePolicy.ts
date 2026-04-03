import { enumerateLegalLayouts } from "./layouts";
import { computeOptimalPolicy } from "./planner";
import { GraphRouter } from "./router";
import type {
  Action,
  BranchId,
  KnownResourceColor,
  Observation,
  PolicyDecision,
  PolicyKnownSlots,
  PolicyRevealEvent,
  PolicyStatusSnapshot,
  PolicyTraceEvent,
  RoundState,
  SimulationConfig,
  StrategyPolicy
} from "./types";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const LEGAL_LAYOUTS = enumerateLegalLayouts();

interface InferenceRuntime {
  knownSlots: PolicyKnownSlots;
  candidateIds: number[];
  lockedLayoutId: number | null;
  optimalPlan: Action[];
  optimalPlanIndex: number;
  lastNotes: string[];
}

interface InferenceRolloutState {
  current_node: string;
  holding_locks_for_branches: BranchId[];
  inventory: RoundState["inventory"];
  locks_cleared: RoundState["locks_cleared"];
  picked_slots: RoundState["picked_slots"];
  placed_resource_count: number;
  known_slots: PolicyKnownSlots;
  candidate_ids: number[];
}

let runtime: InferenceRuntime | null = null;

function createUnknownKnownSlots(): PolicyKnownSlots {
  return {
    RED: ["UNKNOWN", "UNKNOWN"],
    YELLOW: ["UNKNOWN", "UNKNOWN"],
    BLUE: ["UNKNOWN", "UNKNOWN"],
    GREEN: ["UNKNOWN", "UNKNOWN"]
  };
}

function cloneKnownSlots(knownSlots: PolicyKnownSlots): PolicyKnownSlots {
  return {
    RED: [...knownSlots.RED] as PolicyKnownSlots["RED"],
    YELLOW: [...knownSlots.YELLOW] as PolicyKnownSlots["YELLOW"],
    BLUE: [...knownSlots.BLUE] as PolicyKnownSlots["BLUE"],
    GREEN: [...knownSlots.GREEN] as PolicyKnownSlots["GREEN"]
  };
}

function inferKnownSlotsFromCandidates(
  knownSlots: PolicyKnownSlots,
  candidateIds: number[]
): PolicyKnownSlots {
  const inferred = cloneKnownSlots(knownSlots);
  if (candidateIds.length === 0) return inferred;

  for (const branch of BRANCHES) {
    for (const slotIndex of [0, 1] as const) {
      if (inferred[branch][slotIndex] !== "UNKNOWN") continue;
      const firstColor = LEGAL_LAYOUTS[candidateIds[0]].slots[branch][slotIndex];
      const unanimous = candidateIds.every((layoutId) => LEGAL_LAYOUTS[layoutId].slots[branch][slotIndex] === firstColor);
      if (unanimous) {
        inferred[branch][slotIndex] = firstColor;
      }
    }
  }

  return inferred;
}

function resetRuntime(): InferenceRuntime {
  runtime = {
    knownSlots: createUnknownKnownSlots(),
    candidateIds: LEGAL_LAYOUTS.map((layout) => layout.id),
    lockedLayoutId: null,
    optimalPlan: [],
    optimalPlanIndex: 0,
    lastNotes: []
  };
  return runtime;
}

function ensureRuntime(state: RoundState): InferenceRuntime {
  if (!runtime || state.time_elapsed_s === 0) {
    return resetRuntime();
  }
  return runtime;
}

function formatKnownColor(color: KnownResourceColor): string {
  return color === "UNKNOWN" ? "?" : color;
}

function formatKnowledgeSummary(knownSlots: PolicyKnownSlots): string {
  return BRANCHES
    .map((branch) => `${branch}: ${formatKnownColor(knownSlots[branch][0])}, ${formatKnownColor(knownSlots[branch][1])}`)
    .join(" | ");
}

function holdingSummary(state: RoundState): string {
  const locks = state.holding_locks_for_branches.length > 0
    ? state.holding_locks_for_branches.join(", ")
    : "none";
  const resources = state.inventory.length > 0
    ? state.inventory.map((item) => `${item.color}:${item.sourceBranch}`).join(", ")
    : "none";
  return `locks=[${locks}] resources=[${resources}]`;
}

function describeAction(action: Action): string {
  if (action.type === "PICK_LOCK") return `Pick ${action.branchId} black lock`;
  if (action.type === "DROP_LOCK") return `Drop ${action.branchId ?? "held"} black lock`;
  if (action.type === "PICK_RESOURCE") return `Pick ${action.slotNodeId ?? "resource"}`;
  if (action.type === "DROP_RESOURCE") return `Drop ${action.color ?? "resource"}`;
  if (action.type === "RETURN_START") return "Return to START";
  if (action.type === "MOVE_TO") return `Move to ${action.targetNodeId ?? "target"}`;
  return "End round";
}

function buildSnapshot(
  state: RoundState,
  currentAction: Action,
  nextAction: Action | null,
  notes: string[]
): PolicyStatusSnapshot {
  const currentRuntime = ensureRuntime(state);
  return {
    current_step: describeAction(currentAction),
    next_step: nextAction ? describeAction(nextAction) : "Re-evaluate after current step",
    holding: holdingSummary(state),
    knowledge_summary: formatKnowledgeSummary(currentRuntime.knownSlots),
    candidate_count: currentRuntime.candidateIds.length,
    layout_locked: currentRuntime.lockedLayoutId !== null,
    policy_notes: [...notes],
    known_slots: cloneKnownSlots(currentRuntime.knownSlots)
  };
}

function nearestBlackZone(router: GraphRouter, fromNode: string, blackZones: string[]): string {
  let nearest = blackZones[0];
  let minTime = router.shortestPath(fromNode, nearest).cost_s;
  for (let i = 1; i < blackZones.length; i += 1) {
    const time = router.shortestPath(fromNode, blackZones[i]).cost_s;
    if (time < minTime) {
      minTime = time;
      nearest = blackZones[i];
    }
  }
  return nearest;
}

function isAtBlackZone(state: RoundState, config: SimulationConfig): boolean {
  return config.map.blackZoneIds.includes(state.current_node);
}

function actionDuration(state: RoundState, action: Action, config: SimulationConfig, router: GraphRouter): number {
  if (action.type === "PICK_LOCK" && action.branchId) {
    return router.shortestPath(state.current_node, config.map.branches[action.branchId].lock_node).cost_s + config.robot.pickup_s;
  }
  if (action.type === "DROP_LOCK") {
    const blackZone = nearestBlackZone(router, state.current_node, config.map.blackZoneIds);
    return router.shortestPath(state.current_node, blackZone).cost_s + config.robot.drop_s;
  }
  if (action.type === "PICK_RESOURCE" && action.slotNodeId) {
    return router.shortestPath(state.current_node, action.slotNodeId).cost_s + config.robot.pickup_s;
  }
  if (action.type === "DROP_RESOURCE" && action.color) {
    return router.shortestPath(state.current_node, config.map.colorZoneNodeIds[action.color]).cost_s + config.robot.drop_s;
  }
  if (action.type === "RETURN_START") {
    return router.shortestPath(state.current_node, config.map.startNodeId).cost_s;
  }
  return 0.5;
}

function predictedRevealPartitions(action: Action, currentRuntime: InferenceRuntime): number[] {
  if (action.type === "PICK_LOCK" && action.branchId && currentRuntime.knownSlots[action.branchId][0] === "UNKNOWN") {
    const partitions = new Map<string, number>();
    for (const layoutId of currentRuntime.candidateIds) {
      const layout = LEGAL_LAYOUTS[layoutId];
      const color = layout.slots[action.branchId][0];
      partitions.set(color, (partitions.get(color) ?? 0) + 1);
    }
    return [...partitions.values()];
  }
  if (action.type === "PICK_RESOURCE" && action.branchId && action.slotNodeId?.endsWith("_1") && currentRuntime.knownSlots[action.branchId][1] === "UNKNOWN") {
    const partitions = new Map<string, number>();
    for (const layoutId of currentRuntime.candidateIds) {
      const layout = LEGAL_LAYOUTS[layoutId];
      const color = layout.slots[action.branchId][1];
      partitions.set(color, (partitions.get(color) ?? 0) + 1);
    }
    return [...partitions.values()];
  }
  return [currentRuntime.candidateIds.length];
}

function expectedReduction(partitions: number[], total: number): number {
  if (total <= 0) return 0;
  const expectedRemaining = partitions.reduce((sum, size) => sum + (size / total) * size, 0);
  return total - expectedRemaining;
}

function expectedColorTravel(
  state: RoundState,
  action: Action,
  config: SimulationConfig,
  router: GraphRouter,
  currentRuntime: InferenceRuntime
): number {
  if (action.type !== "PICK_RESOURCE" || !action.slotNodeId || !action.branchId) return 0;
  const slotIndex = action.slotNodeId.endsWith("_1") ? 0 : 1;
  const counts = new Map<string, number>();
  for (const layoutId of currentRuntime.candidateIds) {
    const layout = LEGAL_LAYOUTS[layoutId];
    const color = layout.slots[action.branchId][slotIndex];
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let weighted = 0;
  for (const [color, count] of counts) {
    weighted +=
      (count / Math.max(1, currentRuntime.candidateIds.length)) *
      (router.shortestPath(action.slotNodeId, config.map.colorZoneNodeIds[color as keyof typeof config.map.colorZoneNodeIds]).cost_s + config.robot.drop_s);
  }
  return weighted;
}

function dropResourceReward(state: RoundState, action: Action, config: SimulationConfig): number {
  if (action.type !== "DROP_RESOURCE" || !action.color) return 0;
  const matching = state.inventory.find((item) => item.color === action.color);
  if (!matching) return 0;
  return config.map.branches[matching.sourceBranch].resource_points;
}

function scoreAction(state: RoundState, action: Action, config: SimulationConfig, router: GraphRouter, currentRuntime: InferenceRuntime): number {
  const duration = Math.max(0.25, actionDuration(state, action, config, router));
  const infoReward = expectedReduction(
    predictedRevealPartitions(action, currentRuntime),
    Math.max(1, currentRuntime.candidateIds.length)
  ) * 0.03;

  let reward = 0;
  if (action.type === "PICK_LOCK" && action.branchId) {
    reward = config.lock_points.grip + config.map.branches[action.branchId].resource_points * 0.7;
  } else if (action.type === "DROP_LOCK") {
    reward = config.lock_points.place;
  } else if (action.type === "PICK_RESOURCE" && action.branchId) {
    reward = 5 + config.map.branches[action.branchId].resource_points * 0.8;
    reward -= expectedColorTravel(state, action, config, router, currentRuntime) * 0.02;
  } else if (action.type === "DROP_RESOURCE") {
    reward = dropResourceReward(state, action, config);
  } else if (action.type === "RETURN_START") {
    reward = state.placed_resources.length === 8 ? config.return_bonus : -5;
  } else if (action.type === "END_ROUND") {
    reward = -20;
  }

  return (reward + infoReward) / duration;
}

function legalActions(state: RoundState, config: SimulationConfig): Action[] {
  const actions: Action[] = [];
  const currentLoad = state.holding_locks_for_branches.length + state.inventory.length;
  for (const held of state.holding_locks_for_branches) {
    actions.push({ type: "DROP_LOCK", branchId: held });
  }

  const seenColors = new Set<string>();
  for (const item of state.inventory) {
    if (item.color === "BLACK" || seenColors.has(item.color)) continue;
    actions.push({ type: "DROP_RESOURCE", color: item.color });
    seenColors.add(item.color);
  }

  for (const branchId of BRANCHES) {
    if (
      currentLoad < config.robot.carry_capacity &&
      !state.locks_cleared[branchId] &&
      !state.holding_locks_for_branches.includes(branchId)
    ) {
      actions.push({ type: "PICK_LOCK", branchId });
    }
  }

  for (const branchId of BRANCHES) {
    if (!state.locks_cleared[branchId]) continue;
    const [slot1, slot2] = config.map.branches[branchId].resource_slot_nodes;
    if (currentLoad < config.robot.carry_capacity && !state.picked_slots[slot1]) {
      actions.push({ type: "PICK_RESOURCE", branchId, slotNodeId: slot1 });
    }
    if (currentLoad < config.robot.carry_capacity && state.picked_slots[slot1] && !state.picked_slots[slot2]) {
      actions.push({ type: "PICK_RESOURCE", branchId, slotNodeId: slot2 });
    }
  }

  if (state.placed_resources.length === 8 && state.inventory.length === 0 && state.holding_locks_for_branches.length === 0) {
    actions.push({ type: "RETURN_START" });
  }
  actions.push({ type: "END_ROUND" });
  return actions;
}

function rolloutStateFromRoundState(state: RoundState, currentRuntime: InferenceRuntime): InferenceRolloutState {
  return {
    current_node: state.current_node,
    holding_locks_for_branches: [...state.holding_locks_for_branches],
    inventory: state.inventory.map((item) => ({ ...item })),
    locks_cleared: { ...state.locks_cleared },
    picked_slots: { ...state.picked_slots },
    placed_resource_count: state.placed_resources.length,
    known_slots: cloneKnownSlots(currentRuntime.knownSlots),
    candidate_ids: [...currentRuntime.candidateIds]
  };
}

function cloneRolloutState(state: InferenceRolloutState): InferenceRolloutState {
  return {
    current_node: state.current_node,
    holding_locks_for_branches: [...state.holding_locks_for_branches],
    inventory: state.inventory.map((item) => ({ ...item })),
    locks_cleared: { ...state.locks_cleared },
    picked_slots: { ...state.picked_slots },
    placed_resource_count: state.placed_resource_count,
    known_slots: cloneKnownSlots(state.known_slots),
    candidate_ids: [...state.candidate_ids]
  };
}

function legalRolloutActions(state: InferenceRolloutState, config: SimulationConfig): Action[] {
  const actions: Action[] = [];
  const currentLoad = state.holding_locks_for_branches.length + state.inventory.length;
  for (const held of state.holding_locks_for_branches) {
    actions.push({ type: "DROP_LOCK", branchId: held });
  }

  const seenColors = new Set<string>();
  for (const item of state.inventory) {
    if (item.color === "BLACK" || seenColors.has(item.color)) continue;
    actions.push({ type: "DROP_RESOURCE", color: item.color });
    seenColors.add(item.color);
  }

  for (const branchId of BRANCHES) {
    if (
      currentLoad < config.robot.carry_capacity &&
      !state.locks_cleared[branchId] &&
      !state.holding_locks_for_branches.includes(branchId)
    ) {
      actions.push({ type: "PICK_LOCK", branchId });
    }
  }

  for (const branchId of BRANCHES) {
    if (!state.locks_cleared[branchId]) continue;
    const [slot1, slot2] = config.map.branches[branchId].resource_slot_nodes;
    if (currentLoad < config.robot.carry_capacity && !state.picked_slots[slot1]) {
      actions.push({ type: "PICK_RESOURCE", branchId, slotNodeId: slot1 });
    }
    if (currentLoad < config.robot.carry_capacity && state.picked_slots[slot1] && !state.picked_slots[slot2]) {
      actions.push({ type: "PICK_RESOURCE", branchId, slotNodeId: slot2 });
    }
  }

  if (state.placed_resource_count === 8 && state.inventory.length === 0 && state.holding_locks_for_branches.length === 0) {
    actions.push({ type: "RETURN_START" });
  }
  actions.push({ type: "END_ROUND" });
  return actions;
}

function unrevealedSlot1Branches(state: InferenceRolloutState): BranchId[] {
  return BRANCHES.filter((branchId) => !state.locks_cleared[branchId] && state.known_slots[branchId][0] === "UNKNOWN");
}

function unrevealedSlot2Branches(state: InferenceRolloutState): BranchId[] {
  return BRANCHES.filter((branchId) => state.locks_cleared[branchId] && state.known_slots[branchId][1] === "UNKNOWN");
}

function sampleCandidateIds(candidateIds: number[]): number[] {
  if (candidateIds.length <= 32) return [...candidateIds];
  const out: number[] = [];
  const lastIndex = candidateIds.length - 1;
  for (let i = 0; i < 32; i += 1) {
    const idx = Math.round((i * lastIndex) / 31);
    out.push(candidateIds[idx]);
  }
  return [...new Set(out)];
}

function rolloutDepth(candidateCount: number): number {
  return candidateCount <= 8 ? 3 : 2;
}

function rolloutCacheKey(state: InferenceRolloutState, concreteLayoutId: number, depth: number): string {
  return [
    concreteLayoutId,
    depth,
    state.current_node,
    state.holding_locks_for_branches.join(","),
    BRANCHES.map((branch) => `${branch}:${state.locks_cleared[branch] ? 1 : 0}`).join("|"),
    Object.keys(state.picked_slots).sort().join(","),
    state.inventory.map((item) => `${item.color}:${item.sourceBranch}`).join(","),
    state.placed_resource_count,
    BRANCHES.map((branch) => state.known_slots[branch].join(",")).join("|"),
    state.candidate_ids.join(",")
  ].join(";");
}

function cheapActionPriority(
  state: InferenceRolloutState,
  action: Action,
  config: SimulationConfig
): number {
  const currentLoad = state.holding_locks_for_branches.length + state.inventory.length;
  const unknownSlot1Count = unrevealedSlot1Branches(state).length;
  if (action.type === "DROP_RESOURCE" && action.color && config.map.colorZoneNodeIds[action.color] === state.current_node) return 1000;
  if (action.type === "DROP_LOCK" && config.map.blackZoneIds.includes(state.current_node)) return 950;
  if (action.type === "PICK_LOCK" && action.branchId && state.known_slots[action.branchId][0] === "UNKNOWN") {
    return 800 + (unknownSlot1Count >= 2 ? 100 : 0) + (currentLoad < config.robot.carry_capacity ? 50 : 0);
  }
  if (action.type === "DROP_LOCK") return 700 + state.holding_locks_for_branches.length * 20;
  if (action.type === "PICK_RESOURCE" && action.slotNodeId?.endsWith("_1")) return 550;
  if (action.type === "DROP_RESOURCE") return 450;
  if (action.type === "PICK_RESOURCE" && action.slotNodeId?.endsWith("_2")) return 350;
  if (action.type === "RETURN_START") return 200;
  return 0;
}

function filterCandidateIdsByKnownSlots(knownSlots: PolicyKnownSlots, candidateIds: number[]): number[] {
  return candidateIds.filter((layoutId) => {
    const layout = LEGAL_LAYOUTS[layoutId];
    return BRANCHES.every((branch) => {
      const [slot1, slot2] = knownSlots[branch];
      if (slot1 !== "UNKNOWN" && layout.slots[branch][0] !== slot1) return false;
      if (slot2 !== "UNKNOWN" && layout.slots[branch][1] !== slot2) return false;
      return true;
    });
  });
}

function applyCandidateKnowledge(state: InferenceRolloutState): InferenceRolloutState {
  state.candidate_ids = filterCandidateIdsByKnownSlots(state.known_slots, state.candidate_ids);
  state.known_slots = inferKnownSlotsFromCandidates(state.known_slots, state.candidate_ids);
  return state;
}

function rolloutHeuristic(state: InferenceRolloutState): number {
  const unknown1 = unrevealedSlot1Branches(state).length;
  const unknown2 = unrevealedSlot2Branches(state).length;
  const unclearedLocks = BRANCHES.filter((branch) => !state.locks_cleared[branch]).length;
  return (
    state.placed_resource_count * 18 -
    unknown1 * 22 -
    unknown2 * 12 -
    unclearedLocks * 14 -
    state.holding_locks_for_branches.length * 6 -
    state.inventory.length * 8
  );
}

function applyRolloutAction(
  state: InferenceRolloutState,
  action: Action,
  concreteLayoutId: number,
  config: SimulationConfig,
  router: GraphRouter
): { next: InferenceRolloutState; utility: number } {
  const next = cloneRolloutState(state);
  const layout = LEGAL_LAYOUTS[concreteLayoutId];
  let scoreDelta = 0;
  let infoDelta = 0;
  const duration = actionDuration(
    {
      current_node: next.current_node,
      branch_to_resources: layout.slots,
      locks_cleared: next.locks_cleared,
      picked_slots: next.picked_slots,
      inventory: next.inventory,
      holding_locks_for_branches: next.holding_locks_for_branches,
      holding_lock_for_branch: next.holding_locks_for_branches[0] ?? null,
      placed_locks: [],
      placed_resources: [],
      score: 0,
      time_elapsed_s: 0,
      started_navigation: false,
      reached_main_junction: false,
      completed: false,
      returned_to_start: false
    },
    action,
    config,
    router
  );
  const prevCandidateCount = next.candidate_ids.length;

  if (action.type === "PICK_LOCK" && action.branchId) {
    next.current_node = config.map.branches[action.branchId].lock_node;
    next.holding_locks_for_branches.push(action.branchId);
    next.known_slots[action.branchId][0] = layout.slots[action.branchId][0];
    scoreDelta += config.lock_points.grip;
  } else if (action.type === "DROP_LOCK" && action.branchId) {
    next.current_node = nearestBlackZone(router, next.current_node, config.map.blackZoneIds);
    const idx = next.holding_locks_for_branches.indexOf(action.branchId);
    if (idx >= 0) next.holding_locks_for_branches.splice(idx, 1);
    next.locks_cleared[action.branchId] = true;
    scoreDelta += config.lock_points.place;
  } else if (action.type === "PICK_RESOURCE" && action.branchId && action.slotNodeId) {
    next.current_node = action.slotNodeId;
    const slotIndex = action.slotNodeId.endsWith("_1") ? 0 : 1;
    const color = layout.slots[action.branchId][slotIndex];
    next.inventory.push({ color, sourceBranch: action.branchId });
    next.picked_slots[action.slotNodeId] = true;
    scoreDelta += 5;
    if (slotIndex === 0) {
      next.known_slots[action.branchId][1] = layout.slots[action.branchId][1];
    }
  } else if (action.type === "DROP_RESOURCE" && action.color) {
    next.current_node = config.map.colorZoneNodeIds[action.color];
    const idx = next.inventory.findIndex((item) => item.color === action.color);
    if (idx >= 0) {
      const [removed] = next.inventory.splice(idx, 1);
      scoreDelta += config.map.branches[removed.sourceBranch].resource_points;
      next.placed_resource_count += 1;
    }
  } else if (action.type === "RETURN_START") {
    next.current_node = config.map.startNodeId;
  }

  applyCandidateKnowledge(next);
  if (prevCandidateCount > 0 && next.candidate_ids.length > 0) {
    infoDelta = Math.log2(prevCandidateCount / next.candidate_ids.length);
  }

  const utility = scoreDelta - duration + infoDelta * 8;
  return { next, utility };
}

function evaluateRollout(
  state: InferenceRolloutState,
  concreteLayoutId: number,
  depth: number,
  config: SimulationConfig,
  cache: Map<string, number>,
  router: GraphRouter
): number {
  const key = rolloutCacheKey(state, concreteLayoutId, depth);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (depth <= 0) {
    const value = rolloutHeuristic(state);
    cache.set(key, value);
    return value;
  }

  const actions = legalRolloutActions(state, config)
    .sort((a, b) => cheapActionPriority(state, b, config) - cheapActionPriority(state, a, config))
    .slice(0, 4);
  if (actions.length === 0) {
    const value = rolloutHeuristic(state);
    cache.set(key, value);
    return value;
  }

  let best = Number.NEGATIVE_INFINITY;
  for (const action of actions) {
    const { next, utility } = applyRolloutAction(state, action, concreteLayoutId, config, router);
    const value = utility + 0.92 * evaluateRollout(next, concreteLayoutId, depth - 1, config, cache, router);
    if (value > best) best = value;
  }
  cache.set(key, best);
  return best;
}

function chooseBestRolloutAction(
  state: RoundState,
  candidateActions: Action[],
  config: SimulationConfig,
  currentRuntime: InferenceRuntime
): Action | null {
  if (candidateActions.length === 0) return null;
  const rolloutState = rolloutStateFromRoundState(state, currentRuntime);
  const sampledCandidateIds = sampleCandidateIds(currentRuntime.candidateIds);
  const depth = rolloutDepth(currentRuntime.candidateIds.length);
  const cache = new Map<string, number>();
  const router = new GraphRouter(config.map, config.robot);

  let bestAction: Action | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const action of candidateActions) {
    let total = 0;
    for (const candidateId of sampledCandidateIds) {
      const { next, utility } = applyRolloutAction(rolloutState, action, candidateId, config, router);
      total += utility + 0.92 * evaluateRollout(next, candidateId, depth - 1, config, cache, router);
    }
    const avg = total / Math.max(1, sampledCandidateIds.length);
    if (avg > bestValue) {
      bestValue = avg;
      bestAction = action;
    }
  }
  return bestAction;
}

function chooseBestAction(
  state: RoundState,
  actions: Action[],
  config: SimulationConfig,
  router: GraphRouter,
  currentRuntime: InferenceRuntime
): Action | null {
  if (actions.length === 0) return null;
  return actions
    .map((action) => ({ action, score: scoreAction(state, action, config, router, currentRuntime) }))
    .sort((a, b) => b.score - a.score)[0]?.action ?? null;
}

function chooseInferenceAction(
  state: RoundState,
  config: SimulationConfig,
  currentRuntime: InferenceRuntime
): { action: Action; notes: string[] } {
  const router = new GraphRouter(config.map, config.robot);
  const actions = legalActions(state, config);
  const currentLoad = state.holding_locks_for_branches.length + state.inventory.length;
  const remainingUnknownSlot1 = BRANCHES.filter(
    (branchId) => currentRuntime.knownSlots[branchId][0] === "UNKNOWN"
  ).length;

  const immediateDrop = actions.find(
    (action) =>
      action.type === "DROP_RESOURCE" &&
      action.color &&
      config.map.colorZoneNodeIds[action.color] === state.current_node
  );
  if (immediateDrop) {
    return { action: immediateDrop, notes: ["Inference mode: immediate resource conversion at matching zone"] };
  }

  const informativeSlot1Pick = chooseBestAction(
    state,
    actions.filter(
      (action) =>
        action.type === "PICK_RESOURCE" &&
        action.slotNodeId?.endsWith("_1") &&
        action.branchId &&
        currentRuntime.knownSlots[action.branchId][1] === "UNKNOWN" &&
        state.inventory.length < config.robot.carry_capacity
    ),
    config,
    router,
    currentRuntime
  );

  const informativeLockPick = chooseBestAction(
    state,
    actions.filter(
      (action) =>
        action.type === "PICK_LOCK" &&
        action.branchId &&
        currentRuntime.knownSlots[action.branchId][0] === "UNKNOWN"
    ),
    config,
    router,
    currentRuntime
  );

  const dropLock = actions.find((action) => action.type === "DROP_LOCK");
  const informativeLockActions = actions.filter(
    (action) =>
      action.type === "PICK_LOCK" &&
      action.branchId &&
      currentRuntime.knownSlots[action.branchId][0] === "UNKNOWN"
  );
  const slot2Pick = chooseBestAction(
    state,
    actions.filter((action) => action.type === "PICK_RESOURCE" && action.slotNodeId?.endsWith("_2")),
    config,
    router,
    currentRuntime
  );
  const dropResource = chooseBestAction(
    state,
    actions.filter((action) => action.type === "DROP_RESOURCE"),
    config,
    router,
    currentRuntime
  );
  const fallback = chooseBestAction(state, actions, config, router, currentRuntime);

  const shouldFillCapacityWithLocks =
    currentLoad < config.robot.carry_capacity &&
    informativeLockPick !== null &&
    currentRuntime.lockedLayoutId === null &&
    !isAtBlackZone(state, config);

  if (shouldFillCapacityWithLocks) {
    return {
      action: informativeLockPick!,
      notes: ["Inference mode: filling capacity with black locks for information gain"]
    };
  }

  if (state.holding_locks_for_branches.length > 0 && isAtBlackZone(state, config) && dropLock) {
    return {
      action: dropLock,
      notes: ["Inference mode: flushing all held black locks before leaving the black zone"]
    };
  }

  if (state.inventory.length >= config.robot.carry_capacity && dropResource) {
    return {
      action: dropResource,
      notes: ["Inference mode: cargo full, convert carried resources before continuing"]
    };
  }

  if (state.holding_locks_for_branches.length > 0 && dropLock) {
    return {
      action: dropLock,
      notes: ["Inference mode: no more informative lock pickups, heading to black zone to deposit held locks"]
    };
  }

  if (informativeLockActions.length > 0 && state.inventory.length === 0 && remainingUnknownSlot1 >= 2) {
    const rolloutChoice = chooseBestRolloutAction(state, informativeLockActions, config, currentRuntime);
    return {
      action: rolloutChoice ?? informativeLockActions[0],
      notes: ["Inference mode: collect remaining informative locks before branch harvest"]
    };
  }

  const rolloutCandidates = actions.filter((action) => {
    if (action.type === "PICK_LOCK") {
      return Boolean(action.branchId && currentRuntime.knownSlots[action.branchId][0] === "UNKNOWN");
    }
    if (action.type === "PICK_RESOURCE" && action.slotNodeId?.endsWith("_1")) {
      return Boolean(action.branchId && currentRuntime.knownSlots[action.branchId][1] === "UNKNOWN");
    }
    return action.type === "PICK_RESOURCE" || action.type === "DROP_RESOURCE" || action.type === "RETURN_START";
  });

  if (rolloutCandidates.length > 0) {
    const rolloutChoice = chooseBestRolloutAction(state, rolloutCandidates, config, currentRuntime);
    if (rolloutChoice) {
      if (rolloutChoice.type === "PICK_LOCK") {
        return {
          action: rolloutChoice,
          notes: ["Inference mode: rollout favors more lock information before harvesting"]
        };
      }
      if (rolloutChoice.type === "PICK_RESOURCE" && rolloutChoice.slotNodeId?.endsWith("_1")) {
        return {
          action: rolloutChoice,
          notes: ["Inference mode: rollout favors slot-1 harvest for reveal plus downstream value"]
        };
      }
      if (rolloutChoice.type === "DROP_RESOURCE") {
        return {
          action: rolloutChoice,
          notes: ["Inference mode: rollout favors converting carried resources now"]
        };
      }
      if (rolloutChoice.type === "PICK_RESOURCE" && rolloutChoice.slotNodeId?.endsWith("_2")) {
        return {
          action: rolloutChoice,
          notes: ["Inference mode: rollout favors finishing a cleared branch harvest"]
        };
      }
      if (rolloutChoice.type === "RETURN_START") {
        return {
          action: rolloutChoice,
          notes: ["Inference mode: rollout confirms return-to-start finish"]
        };
      }
    }
  }

  if (informativeSlot1Pick) {
    return {
      action: informativeSlot1Pick,
      notes: ["Inference mode: pick first slot to score and reveal second-slot color"]
    };
  }

  if (slot2Pick) {
    return {
      action: slot2Pick,
      notes: ["Inference mode: continue harvesting cleared branches"]
    };
  }

  if (dropResource) {
    return {
      action: dropResource,
      notes: ["Inference mode: convert carried resources before new exploration"]
    };
  }

  return {
    action: fallback ?? { type: "END_ROUND" as const },
    notes: ["Inference mode: score while learning"]
  };
}

function updateCandidatesFromKnowledge(currentRuntime: InferenceRuntime): void {
  currentRuntime.candidateIds = filterCandidateIdsByKnownSlots(currentRuntime.knownSlots, currentRuntime.candidateIds);
  currentRuntime.knownSlots = inferKnownSlotsFromCandidates(currentRuntime.knownSlots, currentRuntime.candidateIds);
  currentRuntime.lockedLayoutId = currentRuntime.candidateIds.length === 1 ? currentRuntime.candidateIds[0] : null;
}

function applyReveal(currentRuntime: InferenceRuntime, reveal: PolicyRevealEvent): void {
  const slot = currentRuntime.knownSlots[reveal.branchId];
  slot[reveal.slotIndex] = reveal.color;
  updateCandidatesFromKnowledge(currentRuntime);
}

function ensureOptimalPlan(state: RoundState, config: SimulationConfig): void {
  const currentRuntime = ensureRuntime(state);
  if (currentRuntime.lockedLayoutId === null) return;
  if (currentRuntime.optimalPlan.length > 0 && currentRuntime.optimalPlanIndex < currentRuntime.optimalPlan.length) return;
  const router = new GraphRouter(config.map, config.robot);
  currentRuntime.optimalPlan = computeOptimalPolicy(config, state, router);
  currentRuntime.optimalPlanIndex = 0;
}

export const InferenceExpectedValuePolicy: StrategyPolicy = {
  name: "Inference_ExpectedValue",
  nextAction(state, observation, config) {
    return decideInference(state, observation, config).action;
  },
  decide: decideInference,
  onTraceStep(state, event, config) {
    const currentRuntime = ensureRuntime(state);
    currentRuntime.lastNotes = [];
    for (const reveal of event.reveals) {
      applyReveal(currentRuntime, reveal);
      currentRuntime.lastNotes.push(`Observed ${reveal.branchId} slot ${reveal.slotIndex + 1} = ${reveal.color}`);
    }
    if (currentRuntime.lockedLayoutId !== null) {
      currentRuntime.lastNotes.push("Layout locked; optimal handoff ready");
      ensureOptimalPlan(state, config);
    }
    return buildSnapshot(state, event.action, null, currentRuntime.lastNotes);
  }
};

function decideInference(state: RoundState, _observation: Observation, config: SimulationConfig): PolicyDecision {
  const currentRuntime = ensureRuntime(state);

  if (currentRuntime.lockedLayoutId !== null) {
    ensureOptimalPlan(state, config);
    const action = currentRuntime.optimalPlan[currentRuntime.optimalPlanIndex] ?? { type: "END_ROUND" as const };
    const nextAction = currentRuntime.optimalPlan[currentRuntime.optimalPlanIndex + 1] ?? null;
    currentRuntime.optimalPlanIndex += 1;
    return {
      action,
      snapshot: buildSnapshot(state, action, nextAction, ["Layout locked; following optimal remaining plan"])
    };
  }

  const { action, notes } = chooseInferenceAction(state, config, currentRuntime);
  return {
    action,
    snapshot: buildSnapshot(state, action, null, notes)
  };
}
