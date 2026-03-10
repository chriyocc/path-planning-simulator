import { computeOptimalPolicy } from "./planner";
import { createDefaultGraph } from "./map";
import { GraphRouter } from "./router";
import { createDefaultSimulationConfig } from "./simulator";
import type {
  Action,
  BranchId,
  Graph,
  ResourceColor,
  RoundState,
  SimulationConfig
} from "./types";

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

export interface EnumeratedLayout {
  id: number;
  slots: Record<BranchId, [Exclude<ResourceColor, "BLACK">, Exclude<ResourceColor, "BLACK">]>;
}

export interface GeneratedPlanAction {
  type: string;
  arg0: number;
  arg1: number;
}

export interface GeneratedPlanDesc {
  action_count: number;
  actions: GeneratedPlanAction[];
}

export interface GeneratedRouteEntry {
  valid: number;
  step_count: number;
  steps: string[];
  path: string[];
}

function permute<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permute(rest)) {
      out.push([item, ...tail]);
    }
  });
  return out;
}

export function enumerateLegalLayouts(): EnumeratedLayout[] {
  const rowPermutations = permute(COLORS);
  const layouts: EnumeratedLayout[] = [];
  let id = 0;
  for (const row1 of rowPermutations) {
    for (const row2 of rowPermutations) {
      const slots = {} as EnumeratedLayout["slots"];
      BRANCHES.forEach((branchId, index) => {
        slots[branchId] = [row1[index], row2[index]];
      });
      layouts.push({ id, slots });
      id += 1;
    }
  }
  return layouts;
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

export function buildPlanForLayout(config: SimulationConfig, layout: EnumeratedLayout): GeneratedPlanDesc {
  const router = new GraphRouter(config.map, config.robot);
  const state = createInitialStateForLayout(config, layout);
  const actions = computeOptimalPolicy(config, state, router);
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
