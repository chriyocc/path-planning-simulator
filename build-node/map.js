export function buildGraph(mapSpec) {
    const nodes = Object.fromEntries(mapSpec.nodes.map((n) => [n.id, n]));
    const adjacency = {};
    for (const nodeId of Object.keys(nodes)) {
        adjacency[nodeId] = [];
    }
    for (const edge of mapSpec.edges) {
        adjacency[edge.from].push(edge);
        if (edge.bidirectional) {
            adjacency[edge.to].push({ ...edge, id: `${edge.id}_rev`, from: edge.to, to: edge.from });
        }
    }
    const branches = Object.fromEntries(mapSpec.branches.map((b) => [b.branch_id, b]));
    return {
        nodes,
        edges: mapSpec.edges,
        adjacency,
        branches,
        startNodeId: mapSpec.startNodeId,
        mainJunctionId: mapSpec.mainJunctionId,
        blackZoneId: mapSpec.blackZoneId,
        colorZoneNodeIds: mapSpec.colorZoneNodeIds
    };
}
export function createDefaultMapSpec() {
    return {
        nodes: [
            { id: "START", kind: "START", x_mm: 100, y_mm: 1800 },
            { id: "J_MAIN", kind: "JUNCTION", x_mm: 750, y_mm: 1550 },
            { id: "J_TOP", kind: "JUNCTION", x_mm: 750, y_mm: 900 },
            { id: "BLACK_ZONE", kind: "BLACK_ZONE", x_mm: 750, y_mm: 400 },
            { id: "ZONE_RED", kind: "COLOR_ZONE", x_mm: 600, y_mm: 1000, meta: { color: "RED" } },
            { id: "ZONE_YELLOW", kind: "COLOR_ZONE", x_mm: 600, y_mm: 700, meta: { color: "YELLOW" } },
            { id: "ZONE_BLUE", kind: "COLOR_ZONE", x_mm: 900, y_mm: 700, meta: { color: "BLUE" } },
            { id: "ZONE_GREEN", kind: "COLOR_ZONE", x_mm: 900, y_mm: 1000, meta: { color: "GREEN" } },
            { id: "ENTRY_RED", kind: "BRANCH_ENTRY", x_mm: 400, y_mm: 1550, meta: { branchId: "RED" } },
            { id: "LOCK_RED", kind: "BRANCH_SLOT", x_mm: 360, y_mm: 1680, meta: { branchId: "RED", color: "BLACK", slotIndex: 0 } },
            { id: "R_RED_1", kind: "BRANCH_SLOT", x_mm: 360, y_mm: 1760, meta: { branchId: "RED", slotIndex: 1 } },
            { id: "R_RED_2", kind: "BRANCH_SLOT", x_mm: 410, y_mm: 1760, meta: { branchId: "RED", slotIndex: 2 } },
            { id: "ENTRY_YELLOW", kind: "BRANCH_ENTRY", x_mm: 650, y_mm: 1550, meta: { branchId: "YELLOW" } },
            { id: "LOCK_YELLOW", kind: "BRANCH_SLOT", x_mm: 650, y_mm: 1680, meta: { branchId: "YELLOW", color: "BLACK", slotIndex: 0 } },
            { id: "R_YELLOW_1", kind: "BRANCH_SLOT", x_mm: 620, y_mm: 1760, meta: { branchId: "YELLOW", slotIndex: 1 } },
            { id: "R_YELLOW_2", kind: "BRANCH_SLOT", x_mm: 680, y_mm: 1760, meta: { branchId: "YELLOW", slotIndex: 2 } },
            { id: "ENTRY_BLUE", kind: "BRANCH_ENTRY", x_mm: 900, y_mm: 1550, meta: { branchId: "BLUE" } },
            { id: "LOCK_BLUE", kind: "BRANCH_SLOT", x_mm: 900, y_mm: 1680, meta: { branchId: "BLUE", color: "BLACK", slotIndex: 0 } },
            { id: "R_BLUE_1", kind: "BRANCH_SLOT", x_mm: 870, y_mm: 1760, meta: { branchId: "BLUE", slotIndex: 1 } },
            { id: "R_BLUE_2", kind: "BRANCH_SLOT", x_mm: 930, y_mm: 1760, meta: { branchId: "BLUE", slotIndex: 2 } },
            { id: "ENTRY_GREEN", kind: "BRANCH_ENTRY", x_mm: 1150, y_mm: 1550, meta: { branchId: "GREEN" } },
            { id: "LOCK_GREEN", kind: "BRANCH_SLOT", x_mm: 1150, y_mm: 1680, meta: { branchId: "GREEN", color: "BLACK", slotIndex: 0 } },
            { id: "R_GREEN_1", kind: "BRANCH_SLOT", x_mm: 1120, y_mm: 1760, meta: { branchId: "GREEN", slotIndex: 1 } },
            { id: "R_GREEN_2", kind: "BRANCH_SLOT", x_mm: 1180, y_mm: 1760, meta: { branchId: "GREEN", slotIndex: 2 } }
        ],
        edges: [
            { id: "E_START_MAIN", from: "START", to: "J_MAIN", distance_mm: 700, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_MAIN_TOP", from: "J_MAIN", to: "J_TOP", distance_mm: 650, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_TOP_BLACK", from: "J_TOP", to: "BLACK_ZONE", distance_mm: 500, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_TOP_RED", from: "J_TOP", to: "ZONE_RED", distance_mm: 220, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_TOP_YELLOW", from: "J_TOP", to: "ZONE_YELLOW", distance_mm: 180, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_TOP_BLUE", from: "J_TOP", to: "ZONE_BLUE", distance_mm: 180, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_TOP_GREEN", from: "J_TOP", to: "ZONE_GREEN", distance_mm: 220, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_MAIN_ENTRY_RED", from: "J_MAIN", to: "ENTRY_RED", distance_mm: 350, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_MAIN_ENTRY_YELLOW", from: "J_MAIN", to: "ENTRY_YELLOW", distance_mm: 100, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_MAIN_ENTRY_BLUE", from: "J_MAIN", to: "ENTRY_BLUE", distance_mm: 150, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_MAIN_ENTRY_GREEN", from: "J_MAIN", to: "ENTRY_GREEN", distance_mm: 400, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
            { id: "E_ENTRY_LOCK_RED", from: "ENTRY_RED", to: "LOCK_RED", distance_mm: 130, line_type: "SOLID", bidirectional: true, turn_cost_class: "HEAVY" },
            { id: "E_LOCK_R1_RED", from: "LOCK_RED", to: "R_RED_1", distance_mm: 70, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_LOCK_R2_RED", from: "LOCK_RED", to: "R_RED_2", distance_mm: 70, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_ENTRY_LOCK_YELLOW", from: "ENTRY_YELLOW", to: "LOCK_YELLOW", distance_mm: 130, line_type: "ZIGZAG", bidirectional: true, turn_cost_class: "HEAVY" },
            { id: "E_LOCK_R1_YELLOW", from: "LOCK_YELLOW", to: "R_YELLOW_1", distance_mm: 70, line_type: "ZIGZAG", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_LOCK_R2_YELLOW", from: "LOCK_YELLOW", to: "R_YELLOW_2", distance_mm: 70, line_type: "ZIGZAG", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_ENTRY_LOCK_BLUE", from: "ENTRY_BLUE", to: "LOCK_BLUE", distance_mm: 130, line_type: "SINE", bidirectional: true, turn_cost_class: "HEAVY" },
            { id: "E_LOCK_R1_BLUE", from: "LOCK_BLUE", to: "R_BLUE_1", distance_mm: 70, line_type: "SINE", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_LOCK_R2_BLUE", from: "LOCK_BLUE", to: "R_BLUE_2", distance_mm: 70, line_type: "SINE", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_ENTRY_LOCK_GREEN", from: "ENTRY_GREEN", to: "LOCK_GREEN", distance_mm: 130, line_type: "DASHED", bidirectional: true, turn_cost_class: "HEAVY" },
            { id: "E_LOCK_R1_GREEN", from: "LOCK_GREEN", to: "R_GREEN_1", distance_mm: 70, line_type: "DASHED", bidirectional: true, turn_cost_class: "NONE" },
            { id: "E_LOCK_R2_GREEN", from: "LOCK_GREEN", to: "R_GREEN_2", distance_mm: 70, line_type: "DASHED", bidirectional: true, turn_cost_class: "NONE" }
        ],
        branches: [
            { branch_id: "RED", difficulty: "SOLID", resource_points: 20, lock_node: "LOCK_RED", resource_slot_nodes: ["R_RED_1", "R_RED_2"], entry_node: "ENTRY_RED" },
            { branch_id: "YELLOW", difficulty: "ZIGZAG", resource_points: 50, lock_node: "LOCK_YELLOW", resource_slot_nodes: ["R_YELLOW_1", "R_YELLOW_2"], entry_node: "ENTRY_YELLOW" },
            { branch_id: "BLUE", difficulty: "SINE", resource_points: 40, lock_node: "LOCK_BLUE", resource_slot_nodes: ["R_BLUE_1", "R_BLUE_2"], entry_node: "ENTRY_BLUE" },
            { branch_id: "GREEN", difficulty: "DASHED", resource_points: 30, lock_node: "LOCK_GREEN", resource_slot_nodes: ["R_GREEN_1", "R_GREEN_2"], entry_node: "ENTRY_GREEN" }
        ],
        startNodeId: "START",
        mainJunctionId: "J_MAIN",
        blackZoneId: "BLACK_ZONE",
        colorZoneNodeIds: {
            RED: "ZONE_RED",
            YELLOW: "ZONE_YELLOW",
            BLUE: "ZONE_BLUE",
            GREEN: "ZONE_GREEN"
        }
    };
}
export function createDefaultGraph() {
    return buildGraph(createDefaultMapSpec());
}
