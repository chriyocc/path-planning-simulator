import { computeOptimalPolicy, computeOptimalPolicyLiFo } from "./planner";
import { BusRouteParametricPolicy } from "./policies";
import { createDefaultGraph } from "./map";
import { GraphRouter } from "./router";
import { createDefaultSimulationConfig } from "./simulator";
import type { Action, BranchId, Graph, Observation, ResourceColor, RoundState, SimulationConfig, StrategyPolicy } from "./types";
import { enumerateLegalLayouts, type EnumeratedLayout } from "./layouts";

export { enumerateLegalLayouts, getLayoutById, findLayoutIdForRandomization, randomizationFromLayoutId } from "./layouts";
export type { EnumeratedLayout } from "./layouts";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const COLORS: Exclude<ResourceColor, "BLACK">[] = ["RED", "YELLOW", "BLUE", "GREEN"];

export const MAX_PLAN_ACTIONS = 32;
export const MAX_ROUTE_STEPS = 12;
export const IMPORTANT_NODES = [
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
] as const;

export interface GeneratedPlanAction {
  type: string;
  arg0: number;
  arg1: number;
}

export interface GeneratedPlanDesc {
  action_count: number;
  actions: GeneratedPlanAction[];
}

export type GeneratedPlanMode = "normal" | "lifo" | "bus_route";

export interface GeneratedRouteEntry {
  valid: number;
  step_count: number;
  steps: string[];
  path: string[];
}

function createInitialStateForLayout(config: SimulationConfig, layout: EnumeratedLayout): RoundState {
  return {
    current_node: config.map.startNodeId,
    branch_to_resources: layout.slots,
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

function observationOf(state: RoundState, timeout: number): Observation {
  return {
    remaining_time_s: Math.max(0, timeout - state.time_elapsed_s),
    unlocked_branches: BRANCHES.filter((branchId) => state.locks_cleared[branchId]),
    locked_branches: BRANCHES.filter((branchId) => !state.locks_cleared[branchId]),
    inventory_count: state.inventory.length,
    all_resources_delivered: state.placed_resources.length === 8
  };
}

function nearestBlackZone(router: GraphRouter, fromNode: string, blackZoneIds: string[]): string {
  if (blackZoneIds.length === 0) {
    throw new Error("No black zones configured");
  }
  let nearest = blackZoneIds[0];
  let minTime = router.shortestPath(fromNode, nearest).cost_s;
  for (let i = 1; i < blackZoneIds.length; i += 1) {
    const candidate = blackZoneIds[i];
    const candidateTime = router.shortestPath(fromNode, candidate).cost_s;
    if (candidateTime < minTime) {
      minTime = candidateTime;
      nearest = candidate;
    }
  }
  return nearest;
}

function syncLegacyHoldingLock(state: RoundState): void {
  state.holding_lock_for_branch = state.holding_locks_for_branches[0] ?? null;
}

function moveTo(state: RoundState, targetNodeId: string, router: GraphRouter, config: SimulationConfig): void {
  if (state.current_node === targetNodeId) {
    return;
  }
  const path = router.shortestPath(state.current_node, targetNodeId);
  state.current_node = targetNodeId;
  state.time_elapsed_s += path.cost_s;

  if (!state.started_navigation && targetNodeId !== config.map.startNodeId) {
    state.started_navigation = true;
    state.score += config.navigation_bonus.leave_start;
  }
  if (!state.reached_main_junction && path.path.includes(config.map.mainJunctionId)) {
    state.reached_main_junction = true;
    state.score += config.navigation_bonus.reach_main_junction;
  }
  if (state.current_node === config.map.startNodeId) {
    state.returned_to_start = true;
  }
}

function checkFullCompletion(state: RoundState, config: SimulationConfig): void {
  const allLocksCleared = BRANCHES.every((branchId) => state.locks_cleared[branchId]);
  const allResourcesDelivered = state.placed_resources.length === 8;
  if (allLocksCleared && allResourcesDelivered && state.current_node === config.map.startNodeId) {
    state.completed = true;
    state.returned_to_start = true;
  }
}

function applyPolicyAction(state: RoundState, action: Action, router: GraphRouter, config: SimulationConfig): void {
  switch (action.type) {
    case "END_ROUND":
      state.completed = true;
      return;
    case "RETURN_START":
      moveTo(state, config.map.startNodeId, router, config);
      checkFullCompletion(state, config);
      return;
    case "MOVE_TO":
      if (!action.targetNodeId || !config.map.nodes[action.targetNodeId]) {
        throw new Error("Policy emitted invalid MOVE_TO action");
      }
      moveTo(state, action.targetNodeId, router, config);
      checkFullCompletion(state, config);
      return;
    case "PICK_LOCK": {
      if (!action.branchId) {
        throw new Error("PICK_LOCK missing branchId");
      }
      const branch = config.map.branches[action.branchId];
      moveTo(state, branch.lock_node, router, config);
      if (state.locks_cleared[action.branchId]) {
        throw new Error(`PICK_LOCK attempted on cleared branch ${action.branchId}`);
      }
      if (state.holding_locks_for_branches.includes(action.branchId)) {
        throw new Error(`PICK_LOCK attempted while already holding ${action.branchId}`);
      }
      if (state.inventory.length + state.holding_locks_for_branches.length >= config.robot.carry_capacity) {
        throw new Error("PICK_LOCK exceeded carry capacity");
      }
      state.holding_locks_for_branches.push(action.branchId);
      syncLegacyHoldingLock(state);
      state.time_elapsed_s += config.robot.pickup_s;
      state.score += config.lock_points.grip;
      return;
    }
    case "DROP_LOCK": {
      const branchId = action.branchId ?? state.holding_locks_for_branches[0];
      if (!branchId) {
        throw new Error("DROP_LOCK without held lock");
      }
      const blackZoneId = nearestBlackZone(router, state.current_node, config.map.blackZoneIds);
      moveTo(state, blackZoneId, router, config);
      const heldIndex = state.holding_locks_for_branches.indexOf(branchId);
      if (heldIndex < 0) {
        throw new Error(`DROP_LOCK attempted without held branch ${branchId}`);
      }
      state.holding_locks_for_branches.splice(heldIndex, 1);
      syncLegacyHoldingLock(state);
      state.locks_cleared[branchId] = true;
      state.placed_locks.push({ branchId, zoneId: blackZoneId });
      state.time_elapsed_s += config.robot.drop_s;
      state.score += config.lock_points.place;
      return;
    }
    case "PICK_RESOURCE": {
      if (!action.slotNodeId) {
        throw new Error("PICK_RESOURCE missing slotNodeId");
      }
      moveTo(state, action.slotNodeId, router, config);
      const slotNode = config.map.nodes[action.slotNodeId];
      const branchId = slotNode.meta?.branchId;
      const slotIndex = slotNode.meta?.slotIndex;
      if (!branchId || !slotIndex || slotIndex < 1 || slotIndex > 2) {
        throw new Error(`PICK_RESOURCE invalid slot ${action.slotNodeId}`);
      }
      if (!state.locks_cleared[branchId]) {
        throw new Error(`PICK_RESOURCE before unlock on ${branchId}`);
      }
      if (state.picked_slots[action.slotNodeId]) {
        throw new Error(`PICK_RESOURCE already picked ${action.slotNodeId}`);
      }
      if (slotIndex === 2) {
        const firstSlot = config.map.branches[branchId].resource_slot_nodes[0];
        if (!state.picked_slots[firstSlot]) {
          throw new Error(`PICK_RESOURCE violated slot order on ${action.slotNodeId}`);
        }
      }
      if (state.inventory.length + state.holding_locks_for_branches.length >= config.robot.carry_capacity) {
        throw new Error("PICK_RESOURCE exceeded carry capacity");
      }
      const color = state.branch_to_resources[branchId][slotIndex - 1];
      if (color === "BLACK") {
        throw new Error(`PICK_RESOURCE encountered invalid BLACK resource on ${action.slotNodeId}`);
      }
      state.inventory.push({ color, sourceBranch: branchId });
      state.picked_slots[action.slotNodeId] = true;
      state.time_elapsed_s += config.robot.pickup_s;
      return;
    }
    case "DROP_RESOURCE": {
      if (!action.color) {
        throw new Error("DROP_RESOURCE missing color");
      }
      const zoneNode = config.map.colorZoneNodeIds[action.color];
      moveTo(state, zoneNode, router, config);
      const inventoryIndex = state.inventory.findIndex((item) => item.color === action.color);
      if (inventoryIndex < 0) {
        throw new Error(`DROP_RESOURCE missing carried color ${action.color}`);
      }
      const [item] = state.inventory.splice(inventoryIndex, 1);
      state.placed_resources.push({
        color: item.color as Exclude<typeof item.color, "BLACK">,
        sourceBranch: item.sourceBranch
      });
      state.time_elapsed_s += config.robot.drop_s;
      state.score += config.map.branches[item.sourceBranch].resource_points;
      checkFullCompletion(state, config);
      return;
    }
  }
}

function buildPolicyPlan(config: SimulationConfig, initialState: RoundState, policy: StrategyPolicy): Action[] {
  const router = new GraphRouter(config.map, config.robot);
  const state: RoundState = {
    ...initialState,
    branch_to_resources: { ...initialState.branch_to_resources },
    locks_cleared: { ...initialState.locks_cleared },
    picked_slots: { ...initialState.picked_slots },
    inventory: [...initialState.inventory],
    holding_locks_for_branches: [...initialState.holding_locks_for_branches],
    placed_locks: [...initialState.placed_locks],
    placed_resources: [...initialState.placed_resources]
  };
  const actions: Action[] = [];

  for (let stepIndex = 0; stepIndex < MAX_PLAN_ACTIONS && !state.completed; stepIndex += 1) {
    const action = policy.nextAction(state, observationOf(state, config.timeout_s), config);
    if (action.type === "END_ROUND") {
      break;
    }
    actions.push(action);
    applyPolicyAction(state, action, router, config);
    policy.onTraceStep?.(
      state,
      {
        action,
        note: action.type === "DROP_RESOURCE" && action.color ? `dropped_${action.color}` : "",
        reveals: []
      },
      config
    );
  }

  return actions;
}

function branchIdToIndex(branchId: BranchId): number {
  return BRANCHES.indexOf(branchId);
}

function colorToIndex(color: Exclude<ResourceColor, "BLACK">): number {
  return COLORS.indexOf(color);
}

function encodeAction(graph: Graph, action: Action): GeneratedPlanAction {
  if (action.type === "PICK_LOCK" || action.type === "DROP_LOCK") {
    return {
      type: action.type,
      arg0: branchIdToIndex(action.branchId as BranchId),
      arg1: 0
    };
  }
  if (action.type === "PICK_RESOURCE") {
    const slotNode = graph.nodes[action.slotNodeId as string];
    return {
      type: action.type,
      arg0: branchIdToIndex(action.branchId as BranchId),
      arg1: (slotNode.meta?.slotIndex ?? 1) - 1
    };
  }
  if (action.type === "DROP_RESOURCE") {
    return {
      type: action.type,
      arg0: colorToIndex(action.color as Exclude<ResourceColor, "BLACK">),
      arg1: 0
    };
  }
  return {
    type: action.type,
    arg0: 0,
    arg1: 0
  };
}

export function createDefaultPlanningConfig(): SimulationConfig {
  return createDefaultSimulationConfig(createDefaultGraph());
}

export function buildPlanForLayout(config: SimulationConfig, layout: EnumeratedLayout, mode: GeneratedPlanMode = "normal"): GeneratedPlanDesc {
  const router = new GraphRouter(config.map, config.robot);
  const state = createInitialStateForLayout(config, layout);
  const actions = mode === "lifo"
    ? computeOptimalPolicyLiFo(config, state, router)
    : mode === "bus_route"
      ? buildPolicyPlan(config, state, BusRouteParametricPolicy)
      : computeOptimalPolicy(config, state, router);
  if (actions.length > MAX_PLAN_ACTIONS) {
    throw new Error(`Plan for layout ${layout.id} exceeds MAX_PLAN_ACTIONS=${MAX_PLAN_ACTIONS}`);
  }
  return {
    action_count: actions.length,
    actions: actions.map((action) => encodeAction(config.map, action))
  };
}

function stepFromTurn(prev: string, current: string, next: string, graph: Graph): string {
  const prevNode = graph.nodes[prev];
  const currentNode = graph.nodes[current];
  const nextNode = graph.nodes[next];
  const ax = currentNode.x_mm - prevNode.x_mm;
  const ay = currentNode.y_mm - prevNode.y_mm;
  const bx = nextNode.x_mm - currentNode.x_mm;
  const by = nextNode.y_mm - currentNode.y_mm;
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) < 1e-6) return "STEP_STRAIGHT";
  return cross > 0 ? "STEP_LEFT" : "STEP_RIGHT";
}

function pathToRouteSteps(path: string[], graph: Graph): string[] {
  if (path.length <= 1) {
    return ["STEP_STOP_ON_MARKER"];
  }

  const steps: string[] = [];
  for (let i = 1; i < path.length - 1; i += 1) {
    const current = path[i];
    const currentNode = graph.nodes[current];
    if (currentNode.kind === "BRANCH_ENTRY") {
      steps.push("STEP_ENTER_BRANCH");
      continue;
    }
    if (currentNode.kind !== "JUNCTION") {
      continue;
    }
    steps.push(stepFromTurn(path[i - 1], current, path[i + 1], graph));
  }
  steps.push("STEP_STOP_ON_MARKER");

  if (steps.length > MAX_ROUTE_STEPS) {
    throw new Error(`Route ${path.join(" -> ")} exceeds MAX_ROUTE_STEPS=${MAX_ROUTE_STEPS}`);
  }
  return steps;
}

export function buildRouteTable(config = createDefaultPlanningConfig()): Record<string, Record<string, GeneratedRouteEntry>> {
  const router = new GraphRouter(config.map, config.robot);
  const table: Record<string, Record<string, GeneratedRouteEntry>> = {};
  for (const fromNode of IMPORTANT_NODES) {
    table[fromNode] = {};
    for (const toNode of IMPORTANT_NODES) {
      const result = router.shortestPath(fromNode, toNode);
      if (!result.path.length) {
        table[fromNode][toNode] = { valid: 0, step_count: 0, steps: [], path: [] };
        continue;
      }
      const steps = pathToRouteSteps(result.path, config.map);
      table[fromNode][toNode] = {
        valid: 1,
        step_count: steps.length,
        steps,
        path: result.path
      };
    }
  }
  return table;
}
