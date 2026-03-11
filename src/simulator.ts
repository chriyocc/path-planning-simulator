import type {
  Action,
  BranchId,
  Graph,
  Observation,
  PolicyOverrides,
  RoundState,
  SimulationConfig,
  SimulationResult,
  StrategyPolicy,
  TraceStep
} from "./types";
import { layoutIdForSeed, randomizeRound } from "./randomization";
import { GraphRouter } from "./router";
import { getLayoutById } from "./layouts";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];

function nearestBlackZone(router: GraphRouter, fromNode: string, blackZoneIds: string[]): string {
  if (blackZoneIds.length === 0) {
    throw new Error("No black zones configured");
  }
  const blackZones = blackZoneIds;
  let nearest = blackZones[0];
  let minTime = router.shortestPath(fromNode, nearest).cost_s;
  for (let i = 1; i < blackZones.length; i++) {
    const time = router.shortestPath(fromNode, blackZones[i]).cost_s;
    if (time < minTime) {
      minTime = time;
      nearest = blackZones[i];
    }
  }
  return nearest;
}

function syncLegacyHoldingLock(state: RoundState): void {
  state.holding_lock_for_branch = state.holding_locks_for_branches[0] ?? null;
}

function createInitialStateFromResources(
  config: SimulationConfig,
  branch_to_resources: RoundState["branch_to_resources"]
): RoundState {
  return {
    current_node: config.map.startNodeId,
    branch_to_resources,
    locks_cleared: { RED: false, YELLOW: false, BLUE: false, GREEN: false },
    picked_slots: {},
    inventory: [],
    holding_locks_for_branches: [],
    holding_lock_for_branch: null,
    placed_locks: [],
    placed_resources: [],
    score: 0,
    time_elapsed_s: 0,
    started_navigation: false,
    reached_main_junction: false,
    completed: false,
    returned_to_start: false
  };
}

function createInitialState(config: SimulationConfig, seed: number): RoundState {
  return createInitialStateFromResources(config, randomizeRound(seed).branch_to_resources);
}

function observationOf(state: RoundState, timeout: number): Observation {
  const unlocked_branches = BRANCHES.filter((b) => state.locks_cleared[b]);
  const locked_branches = BRANCHES.filter((b) => !state.locks_cleared[b]);
  return {
    remaining_time_s: Math.max(0, timeout - state.time_elapsed_s),
    unlocked_branches,
    locked_branches,
    inventory_count: state.inventory.length,
    all_resources_delivered: state.placed_resources.length === 8
  };
}

function addTrace(
  trace: TraceStep[],
  action: Action,
  fromNode: string,
  toNode: string,
  path: string[],
  segment_time_s: number,
  state: RoundState,
  note?: string
): void {
  trace.push({
    action,
    fromNode,
    toNode,
    path,
    segment_time_s,
    total_time_s: state.time_elapsed_s,
    score_after: state.score,
    note
  });
}

function applyTimeout(state: RoundState, config: SimulationConfig): boolean {
  if (state.time_elapsed_s > config.timeout_s) {
    state.time_elapsed_s = config.timeout_s;
    state.completed = true;
    return true;
  }
  return false;
}

function moveTo(
  state: RoundState,
  targetNode: string,
  router: GraphRouter,
  config: SimulationConfig,
  trace: TraceStep[],
  sourceAction: Action
): boolean {
  if (state.current_node === targetNode) return false;
  const pathResult = router.shortestPath(state.current_node, targetNode);
  const fromNode = state.current_node;
  state.current_node = targetNode;
  state.time_elapsed_s += pathResult.cost_s;

  if (!state.started_navigation && fromNode === config.map.startNodeId && targetNode !== config.map.startNodeId) {
    state.score += config.navigation_bonus.leave_start;
    state.started_navigation = true;
  }
  if (!state.reached_main_junction && pathResult.path.includes(config.map.mainJunctionId)) {
    state.score += config.navigation_bonus.reach_main_junction;
    state.reached_main_junction = true;
  }

  if (state.current_node === config.map.startNodeId) {
    state.returned_to_start = true;
  }

  const timedOut = applyTimeout(state, config);
  addTrace(trace, sourceAction, fromNode, targetNode, pathResult.path, pathResult.cost_s, state, timedOut ? "timeout" : undefined);
  return timedOut;
}

function branchFromSlotNode(graph: Graph, slotNodeId: string): BranchId | null {
  const node = graph.nodes[slotNodeId];
  if (!node) return null;
  return node.meta?.branchId ?? null;
}

function checkFullCompletion(state: RoundState, config: SimulationConfig): void {
  const allLocks = BRANCHES.every((b) => state.locks_cleared[b]);
  const allResources = state.placed_resources.length === 8;
  if (allLocks && allResources && state.current_node === config.map.startNodeId && state.time_elapsed_s <= config.timeout_s) {
    if (!state.completed) {
      state.score += config.return_bonus;
    }
    state.completed = true;
    state.returned_to_start = true;
  }
}

function inventoryDropIndex(
  state: RoundState,
  color: Exclude<Action["color"], undefined>,
  dropOrder: PolicyOverrides["resource_drop_order"]
): number {
  if (dropOrder === "lifo") {
    for (let i = state.inventory.length - 1; i >= 0; i -= 1) {
      if (state.inventory[i].color === color) return i;
    }
    return -1;
  }
  return state.inventory.findIndex((item) => item.color === color);
}

function simulateRoundFromState(
  config: SimulationConfig,
  policy: StrategyPolicy,
  state: RoundState,
  seed: number | null,
  layout_id: number,
  overrides?: Partial<PolicyOverrides>
): SimulationResult {
  const router = new GraphRouter(config.map, config.robot);
  const trace: TraceStep[] = [];
  const legality_violations: string[] = [];
  const resourceDropOrder = overrides?.resource_drop_order ?? "auto";

  const maxSteps = 500;
  for (let steps = 0; steps < maxSteps && !state.completed; steps += 1) {
    if (state.time_elapsed_s >= config.timeout_s) {
      state.completed = true;
      break;
    }

    const observation = observationOf(state, config.timeout_s);
    const action = policy.nextAction(state, observation, config);
    const fromNode = state.current_node;

    if (action.type === "END_ROUND") {
      state.completed = true;
      addTrace(trace, action, fromNode, state.current_node, [state.current_node], 0, state, "policy_end");
      break;
    }

    if (action.type === "RETURN_START") {
      if (moveTo(state, config.map.startNodeId, router, config, trace, action)) break;
      checkFullCompletion(state, config);
      continue;
    }

    if (action.type === "MOVE_TO") {
      if (!action.targetNodeId || !config.map.nodes[action.targetNodeId]) {
        legality_violations.push("MOVE_TO without valid targetNodeId");
        addTrace(trace, action, fromNode, fromNode, [fromNode], 0, state, "invalid_move_target");
        continue;
      }
      if (moveTo(state, action.targetNodeId, router, config, trace, action)) break;
      checkFullCompletion(state, config);
      continue;
    }

    if (action.type === "PICK_LOCK") {
      const branchId = action.branchId;
      if (!branchId) {
        legality_violations.push("PICK_LOCK missing branchId");
        continue;
      }
      const branch = config.map.branches[branchId];
      if (moveTo(state, branch.lock_node, router, config, trace, action)) break;
      if (state.locks_cleared[branchId]) {
        legality_violations.push(`PICK_LOCK attempted on cleared branch ${branchId}`);
        continue;
      }
      if (state.holding_locks_for_branches.includes(branchId)) {
        legality_violations.push(`PICK_LOCK attempted while already holding lock for ${branchId}`);
        continue;
      }
      const inventoryCount = state.inventory.length;
      const lockCount = state.holding_locks_for_branches.length;
      const currentLoad = inventoryCount + lockCount;
      if (currentLoad >= config.robot.carry_capacity) {
        legality_violations.push(`PICK_LOCK capacity exceeded (${currentLoad}/${config.robot.carry_capacity})`);
        continue;
      }
      state.holding_locks_for_branches.push(branchId);
      syncLegacyHoldingLock(state);
      state.time_elapsed_s += config.robot.pickup_s;
      state.score += config.lock_points.grip;
      if (applyTimeout(state, config)) break;
      addTrace(trace, action, branch.lock_node, branch.lock_node, [branch.lock_node], config.robot.pickup_s, state, "lock_gripped");
      continue;
    }

    if (action.type === "DROP_LOCK") {
      const branchId = action.branchId ?? state.holding_locks_for_branches[0];
      const blackZone = nearestBlackZone(router, state.current_node, config.map.blackZoneIds);
      if (moveTo(state, blackZone, router, config, trace, action)) break;
      if (!branchId) {
        legality_violations.push("DROP_LOCK attempted without held lock");
        continue;
      }
      const heldIdx = state.holding_locks_for_branches.indexOf(branchId);
      if (heldIdx < 0) {
        legality_violations.push("DROP_LOCK attempted without matching held lock");
        continue;
      }
      state.holding_locks_for_branches.splice(heldIdx, 1);
      syncLegacyHoldingLock(state);
      state.locks_cleared[branchId] = true;
      state.placed_locks.push({ branchId, zoneId: blackZone });
      state.time_elapsed_s += config.robot.drop_s;
      state.score += config.lock_points.place;
      if (applyTimeout(state, config)) break;
      addTrace(trace, action, blackZone, blackZone, [blackZone], config.robot.drop_s, state, "lock_deposited");
      continue;
    }

    if (action.type === "PICK_RESOURCE") {
      const slotNodeId = action.slotNodeId;
      if (!slotNodeId) {
        legality_violations.push("PICK_RESOURCE missing slotNodeId");
        continue;
      }
      if (moveTo(state, slotNodeId, router, config, trace, action)) break;
      const branchId = branchFromSlotNode(config.map, slotNodeId);
      if (!branchId) {
        legality_violations.push(`PICK_RESOURCE invalid slot ${slotNodeId}`);
        continue;
      }
      if (!config.map.branches[branchId].resource_slot_nodes.includes(slotNodeId)) {
        legality_violations.push(`PICK_RESOURCE non-resource slot ${slotNodeId}`);
        continue;
      }
      if (!state.locks_cleared[branchId]) {
        legality_violations.push(`PICK_RESOURCE before unlock from ${branchId}`);
        continue;
      }
      if (state.picked_slots[slotNodeId]) {
        legality_violations.push(`PICK_RESOURCE already picked ${slotNodeId}`);
        continue;
      }
      const inventoryCount = state.inventory.length;
      const lockCount = state.holding_locks_for_branches.length;
      const currentLoad = inventoryCount + lockCount;
      if (currentLoad >= config.robot.carry_capacity) {
        legality_violations.push(`PICK_RESOURCE capacity exceeded (${currentLoad}/${config.robot.carry_capacity})`);
        continue;
      }
      const slotIndex = config.map.nodes[slotNodeId].meta?.slotIndex;
      if (!slotIndex || slotIndex < 1 || slotIndex > 2) {
        legality_violations.push(`PICK_RESOURCE slot index invalid ${slotNodeId}`);
        continue;
      }
      if (slotIndex === 2) {
        const firstSlotNodeId = config.map.branches[branchId].resource_slot_nodes[0];
        if (!state.picked_slots[firstSlotNodeId]) {
          legality_violations.push(`PICK_RESOURCE slot order violated at ${slotNodeId} (slot 1 required first)`);
          continue;
        }
      }
      const color = state.branch_to_resources[branchId][slotIndex - 1];
      if (color === "BLACK") {
        legality_violations.push(`PICK_RESOURCE black color invalid at ${slotNodeId}`);
        continue;
      }
      state.inventory.push({ color, sourceBranch: branchId });
      state.picked_slots[slotNodeId] = true;
      state.score += 5;
      state.time_elapsed_s += config.robot.pickup_s;
      if (applyTimeout(state, config)) break;
      addTrace(trace, action, slotNodeId, slotNodeId, [slotNodeId], config.robot.pickup_s, state, `picked_${color}`);
      continue;
    }

    if (action.type === "DROP_RESOURCE") {
      const color = action.color;
      if (!color) {
        legality_violations.push("DROP_RESOURCE missing color");
        continue;
      }
      const zone = config.map.colorZoneNodeIds[color];
      if (moveTo(state, zone, router, config, trace, action)) break;
      const idx = inventoryDropIndex(state, color, resourceDropOrder);
      if (idx < 0) {
        legality_violations.push(`DROP_RESOURCE color not in inventory ${color}`);
        continue;
      }
      const [item] = state.inventory.splice(idx, 1);
      const branch = config.map.branches[item.sourceBranch];
      state.placed_resources.push({ color: item.color as Exclude<typeof item.color, "BLACK">, sourceBranch: item.sourceBranch });
      state.score += branch.resource_points;
      state.time_elapsed_s += config.robot.drop_s;
      if (applyTimeout(state, config)) break;
      addTrace(trace, action, zone, zone, [zone], config.robot.drop_s, state, `dropped_${color}`);
      checkFullCompletion(state, config);
      continue;
    }
  }

  if (state.time_elapsed_s >= config.timeout_s) {
    state.time_elapsed_s = config.timeout_s;
    state.completed = true;
  }

  return {
    seed,
    layout_id,
    state,
    trace,
    legality_violations,
    policy_name: policy.name
  };
}

export function simulateRound(
  config: SimulationConfig,
  policy: StrategyPolicy,
  seed: number,
  overrides?: Partial<PolicyOverrides>
): SimulationResult {
  const state = createInitialState(config, seed);
  return simulateRoundFromState(config, policy, state, seed, layoutIdForSeed(seed), overrides);
}

export function simulateRoundForLayout(
  config: SimulationConfig,
  policy: StrategyPolicy,
  layoutId: number,
  overrides?: Partial<PolicyOverrides>
): SimulationResult {
  const layout = getLayoutById(layoutId);
  const state = createInitialStateFromResources(config, layout.slots);
  return simulateRoundFromState(config, policy, state, null, layoutId, overrides);
}

export function createDefaultSimulationConfig(map: Graph): SimulationConfig {
  return {
    map,
    robot: {
      carry_capacity: 2,
      pickup_s: 1.2,
      drop_s: 1,
      junction_decision_s: 0.2,
      speed_mm_s_by_line_type: {
        SOLID: 320,
        DASHED: 250,
        ZIGZAG: 220,
        SINE: 280
      },
      turn_penalty_s: {
        NONE: 0,
        LIGHT: 0.25,
        HEAVY: 0.6
      },
      recovery_profile: {
        line_lost_s: 1,
        recovery_s: 1.5
      }
    },
    timeout_s: 600,
    return_bonus: 40,
    navigation_bonus: {
      leave_start: 5,
      reach_main_junction: 10
    },
    lock_points: {
      grip: 10,
      place: 20
    }
  };
}
