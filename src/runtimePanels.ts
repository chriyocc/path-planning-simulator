import type { BatchSourceMode, BranchId, PolicyStatusSnapshot, ResourceColor, SimulationResult } from "./types";

export interface RuntimePanelVisualState {
  inventory: Array<{ color: ResourceColor; sourceBranch?: BranchId }>;
  holdingLockCount: number;
}

export type LayoutPanelMode = "known_so_far" | "ground_truth";

export interface SingleSourceComparisonContext {
  mode: BatchSourceMode;
  seed: number | null;
  layout_id: number;
}

export interface SingleSourceComparisonEntry {
  policy_name: string;
  score: number;
  time_s: number;
  completed: boolean;
  violations: number;
}

export function formatPolicyStatusPanel(
  snapshot: PolicyStatusSnapshot | null,
  visualState: RuntimePanelVisualState
): string {
  if (!snapshot) {
    return "Run a round to see the car's current step, next step, held items, and policy knowledge.";
  }

  const resources = visualState.inventory.length > 0
    ? visualState.inventory.map((item) => `${item.color}${item.sourceBranch ? `:${item.sourceBranch}` : ""}`).join(", ")
    : "none";

  return [
    `current_step=${snapshot.current_step}`,
    `next_step=${snapshot.next_step}`,
    `holding_locks=${visualState.holdingLockCount}`,
    `holding_resources=${resources}`,
    `knowledge=${snapshot.knowledge_summary}`,
    `candidate_count=${snapshot.candidate_count ?? "n/a"}`,
    `layout_locked=${snapshot.layout_locked}`,
    `notes=${snapshot.policy_notes.join(" | ") || "none"}`
  ].join("\n");
}

export function formatRandomizationPanel(
  result: SimulationResult | null,
  snapshot: PolicyStatusSnapshot | null,
  mode: LayoutPanelMode
): string {
  if (!result) {
    return "Run a round to reveal the exact legal layout used by the simulator.";
  }

  const header = [
    `layout_view=${mode}`,
    `layout_id=${result.layout_id}`,
    result.seed === null
      ? "seed=n/a (direct layout run)"
      : `seed=${result.seed} (this seed resolved to layout_id=${result.layout_id})`
  ];

  if (mode === "ground_truth" || !snapshot?.known_slots) {
    return [
      ...header,
      ...Object.entries(result.state.branch_to_resources).map(([branch, colors]) => `${branch}: ${colors.join(", ")}`)
    ].join("\n");
  }

  return [
    ...header,
    ...Object.entries(snapshot.known_slots).map(([branch, colors]) =>
      `${branch}: ${colors.map((color: typeof colors[number]) => (color === "UNKNOWN" ? "?" : color)).join(", ")}`
    )
  ].join("\n");
}

export function formatSingleSourceComparisonPanel(
  context: SingleSourceComparisonContext | null,
  entries: SingleSourceComparisonEntry[]
): string {
  if (!context) {
    return "Compare policies to benchmark the currently selected single source without changing the active playback result.";
  }

  if (entries.length === 0) {
    return [
      `source_mode=${context.mode}`,
      `layout_id=${context.layout_id}`,
      context.seed === null ? "seed=n/a (layout-driven source)" : `seed=${context.seed}`
    ].join("\n");
  }

  const sorted = [...entries].sort((a, b) =>
    Number(b.completed) - Number(a.completed) ||
    b.score - a.score ||
    a.time_s - b.time_s ||
    a.violations - b.violations ||
    a.policy_name.localeCompare(b.policy_name)
  );

  return [
    `source_mode=${context.mode}`,
    `layout_id=${context.layout_id}`,
    context.seed === null ? "seed=n/a (layout-driven source)" : `seed=${context.seed}`,
    "policy_compare=",
    ...sorted.map(
      (entry, index) =>
        `${index + 1}. ${entry.policy_name}\n  score=${entry.score}\n  time=${entry.time_s.toFixed(2)}s\n  completed=${entry.completed}\n  violations=${entry.violations}`
    )
  ].join("\n");
}
