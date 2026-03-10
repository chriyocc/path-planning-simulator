import {
  buildRouteTable,
  buildPlanForLayout,
  createDefaultPlanningConfig,
  enumerateLegalLayouts
} from "./stm32Shared";
import type { BranchId, ResourceColor } from "./types";

type TutorialColor = Exclude<ResourceColor, "BLACK">;

export interface TutorialPlacement {
  RED: [TutorialColor, TutorialColor];
  YELLOW: [TutorialColor, TutorialColor];
  BLUE: [TutorialColor, TutorialColor];
  GREEN: [TutorialColor, TutorialColor];
}

export interface ParsedPlanAction {
  type: string;
  arg0: number;
  arg1: number;
}

export interface ParsedPlanRow {
  action_count: number;
  actions: ParsedPlanAction[];
}

export interface DecodedPlanAction {
  raw: string;
  decoded: string;
  meaning: string;
  targetNode: string;
  routeConnection: string;
}

export interface TutorialExecutionStep extends DecodedPlanAction {
  currentNode: string;
  routeLookup: string;
  routeEntry: string;
}

export const BRANCH_ID_LABELS = ["RED", "YELLOW", "BLUE", "GREEN"] as const;
export const COLOR_ID_LABELS = ["RED", "YELLOW", "BLUE", "GREEN"] as const;
export const SLOT_ID_LABELS = ["first slot", "second slot"] as const;

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const COLORS: TutorialColor[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const ROUTE_TABLE = buildRouteTable(createDefaultPlanningConfig());

export function createDefaultTutorialPlacement(): TutorialPlacement {
  return {
    RED: ["RED", "RED"],
    YELLOW: ["YELLOW", "YELLOW"],
    BLUE: ["BLUE", "BLUE"],
    GREEN: ["GREEN", "GREEN"]
  };
}

export function validatePlacementRows(placement: TutorialPlacement): string[] {
  const errors: string[] = [];
  const row1 = BRANCHES.map((branch) => placement[branch][0]).sort();
  const row2 = BRANCHES.map((branch) => placement[branch][1]).sort();
  const expected = [...COLORS].sort();
  if (JSON.stringify(row1) !== JSON.stringify(expected)) {
    errors.push("Row 1 must contain RED, YELLOW, BLUE, and GREEN exactly once.");
  }
  if (JSON.stringify(row2) !== JSON.stringify(expected)) {
    errors.push("Row 2 must contain RED, YELLOW, BLUE, and GREEN exactly once.");
  }
  return errors;
}

export function findLayoutIdForPlacement(placement: TutorialPlacement): number | null {
  const target = JSON.stringify(placement);
  const match = enumerateLegalLayouts().find((layout) => JSON.stringify(layout.slots) === target);
  return match?.id ?? null;
}

export function buildPlanForPlacement(placement: TutorialPlacement): ParsedPlanRow {
  const layoutId = findLayoutIdForPlacement(placement);
  if (layoutId === null) {
    throw new Error("Placement does not match a legal layout.");
  }
  const layout = enumerateLegalLayouts()[layoutId];
  return buildPlanForLayout(createDefaultPlanningConfig(), layout);
}

function actionTypeLabel(type: string): string {
  return type.startsWith("ACT_") ? type : `ACT_${type}`;
}

export function decodePlanAction(action: ParsedPlanAction): DecodedPlanAction {
  const type = actionTypeLabel(action.type);
  if (type === "ACT_PICK_LOCK") {
    const branch = BRANCH_ID_LABELS[action.arg0] ?? `branch ${action.arg0}`;
    const targetNode = `NODE_LOCK_${branch}`;
    return {
      raw: `${type}, ${action.arg0}, ${action.arg1}`,
      decoded: `branch ${action.arg0} = ${branch}`,
      meaning: `Pick the ${branch} branch black lock.`,
      targetNode,
      routeConnection: `Firmware maps this action to ${targetNode}, then looks up g_route_table[current_node][${targetNode}].`
    };
  }
  if (type === "ACT_DROP_LOCK") {
    const branch = BRANCH_ID_LABELS[action.arg0] ?? `branch ${action.arg0}`;
    const targetNode = "nearest NODE_BLACK_ZONE or NODE_BLACK_ZONE_RIGHT";
    return {
      raw: `${type}, ${action.arg0}, ${action.arg1}`,
      decoded: `branch ${action.arg0} = ${branch}`,
      meaning: `Go to a black zone and drop the ${branch} branch black lock.`,
      targetNode,
      routeConnection: `Firmware chooses the nearest black zone target, then looks up g_route_table[current_node][target_node].`
    };
  }
  if (type === "ACT_PICK_RESOURCE") {
    const branch = BRANCH_ID_LABELS[action.arg0] ?? `branch ${action.arg0}`;
    const slot = SLOT_ID_LABELS[action.arg1] ?? `slot ${action.arg1}`;
    const slotNodeSuffix = action.arg1 === 0 ? "1" : "2";
    const targetNode = `NODE_R_${branch}_${slotNodeSuffix}`;
    return {
      raw: `${type}, ${action.arg0}, ${action.arg1}`,
      decoded: `branch ${action.arg0} = ${branch}, slot ${action.arg1} = ${slot}`,
      meaning: `Pick the ${slot} resource from ${branch} branch.`,
      targetNode,
      routeConnection: `Firmware maps this action to ${targetNode}, then looks up g_route_table[current_node][${targetNode}].`
    };
  }
  if (type === "ACT_DROP_RESOURCE") {
    const color = COLOR_ID_LABELS[action.arg0] ?? `color ${action.arg0}`;
    const targetNode = `NODE_ZONE_${color}`;
    return {
      raw: `${type}, ${action.arg0}, ${action.arg1}`,
      decoded: `color ${action.arg0} = ${color}`,
      meaning: `Go to the ${color} scoring zone and drop one ${color} resource.`,
      targetNode,
      routeConnection: `Firmware maps this action to ${targetNode}, then looks up g_route_table[current_node][${targetNode}].`
    };
  }
  if (type === "ACT_RETURN_START") {
    const targetNode = "NODE_START";
    return {
      raw: `${type}, ${action.arg0}, ${action.arg1}`,
      decoded: "arg0 and arg1 are unused here",
      meaning: "Return to START.",
      targetNode,
      routeConnection: `Firmware uses ${targetNode} as the target, then looks up g_route_table[current_node][${targetNode}].`
    };
  }
  const targetNode = "(no target node)";
  return {
    raw: `${type}, ${action.arg0}, ${action.arg1}`,
    decoded: "arg0 and arg1 are unused here",
    meaning: "End the round.",
    targetNode,
    routeConnection: "This action ends execution, so no g_route_table lookup is needed."
  };
}

export function renderTutorialSteps(plan: ParsedPlanRow): DecodedPlanAction[] {
  return plan.actions.slice(0, plan.action_count).map(decodePlanAction);
}

function nearestBlackZoneTarget(currentNode: string): string {
  const candidates = ["BLACK_ZONE", "BLACK_ZONE_RIGHT"];
  let best = "NODE_BLACK_ZONE";
  let bestCount = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const entry = ROUTE_TABLE[currentNode.replace(/^NODE_/, "")]?.[candidate];
    if (entry?.valid && entry.step_count < bestCount) {
      best = `NODE_${candidate}`;
      bestCount = entry.step_count;
    }
  }
  return best;
}

function resolveTargetNode(action: ParsedPlanAction, currentNode: string): string {
  const type = actionTypeLabel(action.type);
  if (type === "ACT_PICK_LOCK") return `NODE_LOCK_${BRANCH_ID_LABELS[action.arg0]}`;
  if (type === "ACT_PICK_RESOURCE") return `NODE_R_${BRANCH_ID_LABELS[action.arg0]}_${action.arg1 === 0 ? "1" : "2"}`;
  if (type === "ACT_DROP_RESOURCE") return `NODE_ZONE_${COLOR_ID_LABELS[action.arg0]}`;
  if (type === "ACT_RETURN_START") return "NODE_START";
  if (type === "ACT_DROP_LOCK") return nearestBlackZoneTarget(currentNode);
  return "(no target node)";
}

function formatRouteEntry(currentNode: string, targetNode: string): { routeLookup: string; routeEntry: string } {
  if (!targetNode.startsWith("NODE_")) {
    return {
      routeLookup: "(no route lookup)",
      routeEntry: "No route-table entry is used for this action."
    };
  }
  const fromKey = currentNode.replace(/^NODE_/, "");
  const toKey = targetNode.replace(/^NODE_/, "");
  const entry = ROUTE_TABLE[fromKey]?.[toKey];
  const routeLookup = `g_route_table[${currentNode}][${targetNode}]`;
  if (!entry) {
    return {
      routeLookup,
      routeEntry: "{ valid = 0, step_count = 0, steps = { }, path = { } }"
    };
  }
  const stepsText = entry.steps.length > 0 ? entry.steps.join(", ") : "(none)";
  const pathText = entry.path.length > 0 ? entry.path.map((node) => `NODE_${node}`).join(" -> ") : "(none)";
  return {
    routeLookup,
    routeEntry: `{ valid = ${entry.valid}, step_count = ${entry.step_count}, steps = { ${stepsText} }, path = ${pathText} }`
  };
}

export function buildTutorialExecution(plan: ParsedPlanRow): TutorialExecutionStep[] {
  let currentNode = "NODE_START";
  return renderTutorialSteps(plan).map((step, index) => {
    const action = plan.actions[index];
    const targetNode = resolveTargetNode(action, currentNode);
    const routeInfo = targetNode === "(no target node)"
      ? {
          routeLookup: "(no route lookup)",
          routeEntry: "This action ends execution, so there is no g_route_table entry to read."
        }
      : formatRouteEntry(currentNode, targetNode);

    const executionStep: TutorialExecutionStep = {
      ...step,
      currentNode,
      targetNode,
      routeLookup: routeInfo.routeLookup,
      routeEntry: routeInfo.routeEntry
    };

    if (targetNode.startsWith("NODE_")) {
      currentNode = targetNode;
    }
    return executionStep;
  });
}

export function formatLayoutMeaning(placement: TutorialPlacement): string[] {
  return BRANCHES.map((branch) => {
    const [slot1, slot2] = placement[branch];
    return `${branch} branch contains ${slot1} then ${slot2}.`;
  });
}

export function formatPlanRowMeaning(plan: ParsedPlanRow): string[] {
  const lines = [`action_count = ${plan.action_count}`];
  if (plan.actions.length > plan.action_count) {
    lines.push(`Actions after ${plan.action_count} are just ACT_END_ROUND padding in the fixed-size C array.`);
  }
  return lines;
}

export function parsePlanRowText(text: string): ParsedPlanRow {
  const actionMatches = [...text.matchAll(/\{\s*(ACT_[A-Z_]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/g)];
  if (actionMatches.length === 0) {
    throw new Error("No C actions were found. Paste a plan row or action list.");
  }
  const actions = actionMatches.map((match) => ({
    type: match[1],
    arg0: Number(match[2]),
    arg1: Number(match[3])
  }));
  const countMatch = text.match(/action_count\s*=\s*(\d+)/);
  const explicitCount = countMatch ? Number(countMatch[1]) : actions.length;
  const action_count = Math.min(explicitCount, actions.length);
  return {
    action_count,
    actions
  };
}
