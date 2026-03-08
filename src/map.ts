import type { BranchId, Graph, MapSpec } from "./types";

export function buildGraph(mapSpec: MapSpec): Graph {
  const nodes = Object.fromEntries(mapSpec.nodes.map((n) => [n.id, n]));
  const adjacency: Graph["adjacency"] = {};

  for (const nodeId of Object.keys(nodes)) {
    adjacency[nodeId] = [];
  }

  for (const edge of mapSpec.edges) {
    adjacency[edge.from].push(edge);
    if (edge.bidirectional) {
      adjacency[edge.to].push({ ...edge, id: `${edge.id}_rev`, from: edge.to, to: edge.from });
    }
  }

  const branches = Object.fromEntries(mapSpec.branches.map((b) => [b.branch_id, b])) as Record<BranchId, MapSpec["branches"][number]>;

  return {
    nodes,
    edges: mapSpec.edges,
    adjacency,
    branches,
    startNodeId: mapSpec.startNodeId,
    mainJunctionId: mapSpec.mainJunctionId,
    blackZoneIds: mapSpec.blackZoneIds,
    colorZoneNodeIds: mapSpec.colorZoneNodeIds
  };
}

export function createDefaultMapSpec(): MapSpec {
  return {
    nodes: [
      { id: "START", kind: "START", x_mm: 300, y_mm: 1450 },
      { id: "C_START", kind: "JUNCTION", x_mm: 300, y_mm: 1150 },
      { id: "J_MAIN", kind: "JUNCTION", x_mm: 550, y_mm: 1150 },
      
      // { id: "J_LOOP_BOTTOM", kind: "JUNCTION", x_mm: 550, y_mm: 950 },
      
      { id: "LOOP_BL", kind: "JUNCTION", x_mm: 100, y_mm: 950 },
      { id: "LOOP_BR", kind: "JUNCTION", x_mm: 1400, y_mm: 950 },
      
      { id: "LOOP_TL", kind: "JUNCTION", x_mm: 100, y_mm: 150 },
      { id: "LOOP_TR", kind: "JUNCTION", x_mm: 1400, y_mm: 150 },
      
      { id: "BLACK_ZONE_RIGHT", kind: "BLACK_ZONE", x_mm: 1100, y_mm: 150 },
      { id: "BLACK_ZONE", kind: "BLACK_ZONE", x_mm: 750, y_mm: 150 },

      { id: "LOOP_LEFT_Y", kind: "JUNCTION", x_mm: 100, y_mm: 400 },
      { id: "J_MID_LEFT", kind: "JUNCTION", x_mm: 550, y_mm: 950 },
      
      { id: "LOOP_RIGHT_B", kind: "JUNCTION", x_mm: 1400, y_mm: 400 },
      { id: "LOOP_RIGHT_G", kind: "JUNCTION", x_mm: 1400, y_mm: 700 },

      { id: "ZONE_YELLOW", kind: "COLOR_ZONE", x_mm: 550, y_mm: 400, meta: { color: "YELLOW" } },
      { id: "ZONE_RED", kind: "COLOR_ZONE", x_mm: 550, y_mm: 700, meta: { color: "RED" } },
      { id: "ZONE_BLUE", kind: "COLOR_ZONE", x_mm: 950, y_mm: 400, meta: { color: "BLUE" } },
      { id: "ZONE_GREEN", kind: "COLOR_ZONE", x_mm: 950, y_mm: 700, meta: { color: "GREEN" } },

      { id: "J_RED", kind: "JUNCTION", x_mm: 550, y_mm: 1150 },
      { id: "ENTRY_RED", kind: "BRANCH_ENTRY", x_mm: 550, y_mm: 1350, meta: { branchId: "RED" } },
      { id: "LOCK_RED", kind: "BRANCH_SLOT", x_mm: 550, y_mm: 1410, meta: { branchId: "RED", color: "BLACK", slotIndex: 0 } },
      { id: "R_RED_1", kind: "BRANCH_SLOT", x_mm: 550, y_mm: 1470, meta: { branchId: "RED", slotIndex: 1 } },
      { id: "R_RED_2", kind: "BRANCH_SLOT", x_mm: 550, y_mm: 1530, meta: { branchId: "RED", slotIndex: 2 } },

      { id: "J_YELLOW", kind: "JUNCTION", x_mm: 750, y_mm: 1150 },
      { id: "ENTRY_YELLOW", kind: "BRANCH_ENTRY", x_mm: 750, y_mm: 1350, meta: { branchId: "YELLOW" } },
      { id: "LOCK_YELLOW", kind: "BRANCH_SLOT", x_mm: 750, y_mm: 1410, meta: { branchId: "YELLOW", color: "BLACK", slotIndex: 0 } },
      { id: "R_YELLOW_1", kind: "BRANCH_SLOT", x_mm: 750, y_mm: 1470, meta: { branchId: "YELLOW", slotIndex: 1 } },
      { id: "R_YELLOW_2", kind: "BRANCH_SLOT", x_mm: 750, y_mm: 1530, meta: { branchId: "YELLOW", slotIndex: 2 } },

      { id: "J_BLUE", kind: "JUNCTION", x_mm: 950, y_mm: 1150 },
      { id: "ENTRY_BLUE", kind: "BRANCH_ENTRY", x_mm: 950, y_mm: 1350, meta: { branchId: "BLUE" } },
      { id: "LOCK_BLUE", kind: "BRANCH_SLOT", x_mm: 950, y_mm: 1410, meta: { branchId: "BLUE", color: "BLACK", slotIndex: 0 } },
      { id: "R_BLUE_1", kind: "BRANCH_SLOT", x_mm: 950, y_mm: 1470, meta: { branchId: "BLUE", slotIndex: 1 } },
      { id: "R_BLUE_2", kind: "BRANCH_SLOT", x_mm: 950, y_mm: 1530, meta: { branchId: "BLUE", slotIndex: 2 } },

      { id: "J_GREEN", kind: "JUNCTION", x_mm: 1150, y_mm: 1150 },
      { id: "ENTRY_GREEN", kind: "BRANCH_ENTRY", x_mm: 1150, y_mm: 1350, meta: { branchId: "GREEN" } },
      { id: "LOCK_GREEN", kind: "BRANCH_SLOT", x_mm: 1150, y_mm: 1410, meta: { branchId: "GREEN", color: "BLACK", slotIndex: 0 } },
      { id: "R_GREEN_1", kind: "BRANCH_SLOT", x_mm: 1150, y_mm: 1470, meta: { branchId: "GREEN", slotIndex: 1 } },
      { id: "R_GREEN_2", kind: "BRANCH_SLOT", x_mm: 1150, y_mm: 1530, meta: { branchId: "GREEN", slotIndex: 2 } }

    ],
    edges: [
      { id: "E_START_C", from: "START", to: "C_START", distance_mm: 300, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_C_JR", from: "C_START", to: "J_RED", distance_mm: 250, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_JREDM", from: "J_RED", to: "J_MAIN", distance_mm: 1, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_JR_JY", from: "J_MAIN", to: "J_YELLOW", distance_mm: 200, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_JY_JB", from: "J_YELLOW", to: "J_BLUE", distance_mm: 200, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_JB_JG", from: "J_BLUE", to: "J_GREEN", distance_mm: 200, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      
      { id: "E_MAIN_UP", from: "J_MAIN", to: "J_MID_LEFT", distance_mm: 200, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_LOOP_BOTTOM_L", from: "J_MID_LEFT", to: "LOOP_BL", distance_mm: 450, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_LOOP_BOTTOM_R", from: "J_MID_LEFT", to: "LOOP_BR", distance_mm: 850, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      
      // { id: "E_LOOP_LEFT_R_JLOOP", from: "LOOP_LEFT_R", to: "J_LOOP_BOTTOM", distance_mm: 150, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_LOOP_TL_YR", from: "LOOP_LEFT_Y", to: "LOOP_TL", distance_mm: 420, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_LOOP_Y_BL", from: "LOOP_LEFT_Y", to: "LOOP_BL", distance_mm: 550, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      
      { id: "E_LOOP_R_BG", from: "LOOP_RIGHT_G", to: "LOOP_RIGHT_B", distance_mm: 120, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_LOOP_BR_BG", from: "LOOP_BR", to: "LOOP_RIGHT_G", distance_mm: 260, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_LOOP_TR_BG", from: "LOOP_RIGHT_B", to: "LOOP_TR", distance_mm: 420, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      
      { id: "E_LOOP_TL_BLACK", from: "LOOP_TL", to: "BLACK_ZONE", distance_mm: 650, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_LOOP_TR_BLACK_RIGHT", from: "LOOP_TR", to: "BLACK_ZONE_RIGHT", distance_mm: 300, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },

      { id: "E_DELIVERY_RED", from: "J_MID_LEFT", to: "ZONE_RED", distance_mm: 250, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_DELIVERY_YELLOW", from: "LOOP_LEFT_Y", to: "ZONE_YELLOW", distance_mm: 440, line_type: "ZIGZAG", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_DELIVERY_BLUE", from: "LOOP_RIGHT_B", to: "ZONE_BLUE", distance_mm: 440, line_type: "SINE", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_DELIVERY_GREEN", from: "LOOP_RIGHT_G", to: "ZONE_GREEN", distance_mm: 440, line_type: "DASHED", bidirectional: true, turn_cost_class: "LIGHT" },

      { id: "E_MAIN_ENTRY_RED", from: "J_RED", to: "ENTRY_RED", distance_mm: 180, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_MAIN_ENTRY_YELLOW", from: "J_YELLOW", to: "ENTRY_YELLOW", distance_mm: 180, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_MAIN_ENTRY_BLUE", from: "J_BLUE", to: "ENTRY_BLUE", distance_mm: 180, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },
      { id: "E_MAIN_ENTRY_GREEN", from: "J_GREEN", to: "ENTRY_GREEN", distance_mm: 180, line_type: "SOLID", bidirectional: true, turn_cost_class: "LIGHT" },

      { id: "E_ENTRY_LOCK_RED", from: "ENTRY_RED", to: "LOCK_RED", distance_mm: 20, line_type: "SOLID", bidirectional: true, turn_cost_class: "HEAVY" },
      { id: "E_LOCK_R1_RED", from: "LOCK_RED", to: "R_RED_1", distance_mm: 70, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_LOCK_R2_RED", from: "LOCK_RED", to: "R_RED_2", distance_mm: 115, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },

      { id: "E_ENTRY_LOCK_YELLOW", from: "ENTRY_YELLOW", to: "LOCK_YELLOW", distance_mm: 20, line_type: "SOLID", bidirectional: true, turn_cost_class: "HEAVY" },
      { id: "E_LOCK_R1_YELLOW", from: "LOCK_YELLOW", to: "R_YELLOW_1", distance_mm: 70, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_LOCK_R2_YELLOW", from: "LOCK_YELLOW", to: "R_YELLOW_2", distance_mm: 115, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },

      { id: "E_ENTRY_LOCK_BLUE", from: "ENTRY_BLUE", to: "LOCK_BLUE", distance_mm: 20, line_type: "SOLID", bidirectional: true, turn_cost_class: "HEAVY" },
      { id: "E_LOCK_R1_BLUE", from: "LOCK_BLUE", to: "R_BLUE_1", distance_mm: 70, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_LOCK_R2_BLUE", from: "LOCK_BLUE", to: "R_BLUE_2", distance_mm: 115, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },

      { id: "E_ENTRY_LOCK_GREEN", from: "ENTRY_GREEN", to: "LOCK_GREEN", distance_mm: 20, line_type: "SOLID", bidirectional: true, turn_cost_class: "HEAVY" },
      { id: "E_LOCK_R1_GREEN", from: "LOCK_GREEN", to: "R_GREEN_1", distance_mm: 70, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" },
      { id: "E_LOCK_R2_GREEN", from: "LOCK_GREEN", to: "R_GREEN_2", distance_mm: 115, line_type: "SOLID", bidirectional: true, turn_cost_class: "NONE" }
    ],
    branches: [
      { branch_id: "RED", difficulty: "SOLID", resource_points: 20, lock_node: "LOCK_RED", resource_slot_nodes: ["R_RED_1", "R_RED_2"], entry_node: "ENTRY_RED" },
      { branch_id: "YELLOW", difficulty: "SOLID", resource_points: 50, lock_node: "LOCK_YELLOW", resource_slot_nodes: ["R_YELLOW_1", "R_YELLOW_2"], entry_node: "ENTRY_YELLOW" },
      { branch_id: "BLUE", difficulty: "SOLID", resource_points: 40, lock_node: "LOCK_BLUE", resource_slot_nodes: ["R_BLUE_1", "R_BLUE_2"], entry_node: "ENTRY_BLUE" },
      { branch_id: "GREEN", difficulty: "SOLID", resource_points: 30, lock_node: "LOCK_GREEN", resource_slot_nodes: ["R_GREEN_1", "R_GREEN_2"], entry_node: "ENTRY_GREEN" }
    ],
    startNodeId: "START",
    mainJunctionId: "J_MAIN",
    blackZoneIds: ["BLACK_ZONE", "BLACK_ZONE_RIGHT"],
    colorZoneNodeIds: {
      RED: "ZONE_RED",
      YELLOW: "ZONE_YELLOW",
      BLUE: "ZONE_BLUE",
      GREEN: "ZONE_GREEN"
    }
  };
}

export function createDefaultGraph(): Graph {
  return buildGraph(createDefaultMapSpec());
}
