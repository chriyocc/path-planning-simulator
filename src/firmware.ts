import type { FirmwarePlanExport, SimulationResult } from "./types";

export function estimateFirmwarePlan(bestPolicyTrace: SimulationResult): FirmwarePlanExport {
  const route_table = bestPolicyTrace.trace
    .filter((step) => step.fromNode !== step.toNode)
    .map((step) => ({
      from_node: step.fromNode,
      to_node: step.toNode,
      turn_sequence: step.path,
      expected_segment_time_s: Number(step.segment_time_s.toFixed(3))
    }));

  const policy_rules = [
    { guard: "remaining_time_s < 80 && inventory_count > 0", action: "Prioritize DROP_RESOURCE by highest sourceBranch points" },
    { guard: "holding_lock_for_branch != null", action: "Navigate to nearest BLACK_ZONE node and execute DROP_LOCK" },
    { guard: "all_resources_delivered && current_node != START", action: "RETURN_HOME" },
    { guard: "line_lost_s > 1.0", action: "Enter ERROR_RECOVERY spiral-reacquire profile" }
  ];

  return {
    route_table,
    policy_rules,
    fsm_states: ["IDLE", "NAVIGATE", "ALIGN_PICK", "ALIGN_DROP", "DECIDE", "ERROR_RECOVERY", "RETURN_HOME"],
    notes: [
      `Derived from policy ${bestPolicyTrace.policy_name}`,
      "Turn sequence is node-ordered path, firmware can map to turn primitives at junction markers.",
      "Expected segment times should be re-calibrated with on-robot telemetry logs."
    ]
  };
}
