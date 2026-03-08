export function estimateFirmwarePlan(bestPolicyTrace) {
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
        { guard: "holding_lock_for_branch != null", action: "Navigate to BLACK_ZONE and execute DROP_LOCK" },
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
export function generateFsmContractMarkdown() {
    return `# FSM Contract (STM32 Baseline)\n\n## States\n- IDLE\n- NAVIGATE\n- ALIGN_PICK\n- ALIGN_DROP\n- DECIDE\n- ERROR_RECOVERY\n- RETURN_HOME\n\n## Transition Rules\n1. IDLE -> NAVIGATE when start trigger is received.\n2. NAVIGATE -> DECIDE when junction marker is detected.\n3. DECIDE -> ALIGN_PICK for PICK_LOCK or PICK_RESOURCE actions.\n4. DECIDE -> ALIGN_DROP for DROP_LOCK or DROP_RESOURCE actions.\n5. ALIGN_PICK -> NAVIGATE after successful pickup; -> ERROR_RECOVERY on sensor timeout.\n6. ALIGN_DROP -> NAVIGATE after successful placement; -> ERROR_RECOVERY on placement failure.\n7. ERROR_RECOVERY -> NAVIGATE after line reacquisition.\n8. DECIDE -> RETURN_HOME when all resources delivered or end-of-round policy guard is met.\n9. RETURN_HOME -> IDLE when START node is reached and round terminates.\n\n## Sensor Assumptions\n- Multi-channel line array provides lateral error and junction event flags.\n- Gripper presence sensor confirms lock/resource pickup.\n- Color classification available during branch pickup and zone placement checks.\n`;
}
