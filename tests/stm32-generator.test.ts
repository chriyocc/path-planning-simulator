import { describe, expect, it } from "vitest";
import { createDefaultGraph, createDefaultMapSpec } from "../src/map";
import { computeOptimalPolicy, computeOptimalPolicyLiFo } from "../src/planner";
import { GraphRouter } from "../src/router";
import { createDefaultSimulationConfig } from "../src/simulator";
import {
  MAX_PLAN_ACTIONS,
  buildStm32TablesData,
  enumerateLegalLayouts,
  renderStm32Tables
} from "../src/generateStm32Tables";
import type { BranchId, ResourceColor } from "../src/types";

describe("stm32 table generation", () => {
  it("enumerates exactly 576 legal layouts", () => {
    const layouts = enumerateLegalLayouts();
    expect(layouts).toHaveLength(576);
  });

  it("emits one of each color in every layout row", () => {
    const layouts = enumerateLegalLayouts();
    for (const layout of layouts) {
      const row1 = Object.values(layout.slots).map((slots) => slots[0]).sort();
      const row2 = Object.values(layout.slots).map((slots) => slots[1]).sort();
      expect(row1).toEqual(["BLUE", "GREEN", "RED", "YELLOW"]);
      expect(row2).toEqual(["BLUE", "GREEN", "RED", "YELLOW"]);
    }
  });

  it("builds non-empty plans within the configured maximum", () => {
    const data = buildStm32TablesData();
    expect(data.planTable).toHaveLength(576);
    expect(data.planTableBusRoute).toHaveLength(576);
    expect(data.planTableLiFo).toHaveLength(576);
    for (const plan of data.planTable) {
      expect(plan.action_count).toBeGreaterThan(0);
      expect(plan.action_count).toBeLessThanOrEqual(MAX_PLAN_ACTIONS);
    }
    for (const plan of data.planTableBusRoute) {
      expect(plan.action_count).toBeGreaterThan(0);
      expect(plan.action_count).toBeLessThanOrEqual(MAX_PLAN_ACTIONS);
    }
    for (const plan of data.planTableLiFo) {
      expect(plan.action_count).toBeGreaterThan(0);
      expect(plan.action_count).toBeLessThanOrEqual(MAX_PLAN_ACTIONS);
    }
  }, 150000);

  it("builds valid routes between every important node pair", () => {
    const data = buildStm32TablesData();
    for (const fromNode of data.importantNodes) {
      for (const toNode of data.importantNodes) {
        const entry = data.routeTable[fromNode][toNode];
        expect(entry.valid).toBe(1);
        expect(entry.step_count).toBeGreaterThan(0);
      }
    }
  });

  it("does not keep overlapping duplicate junction nodes in the default map", () => {
    const spec = createDefaultMapSpec();
    const overlaps = new Map<string, string[]>();
    for (const node of spec.nodes) {
      const key = `${node.x_mm},${node.y_mm}`;
      overlaps.set(key, [...(overlaps.get(key) ?? []), `${node.id}:${node.kind}`]);
    }

    const duplicateJunctionCoords = [...overlaps.values()].filter(
      (nodes) => nodes.length > 1 && nodes.every((entry) => entry.endsWith(":JUNCTION"))
    );

    expect(duplicateJunctionCoords).toEqual([]);
  });

  it("simplifies representative STM32 routes across the red/main junction", () => {
    const data = buildStm32TablesData();

    expect(data.routeTable.START.LOCK_RED.path).toEqual(["START", "C_START", "J_MAIN", "ENTRY_RED", "LOCK_RED"]);
    expect(data.routeTable.START.LOCK_RED.steps).toEqual([
      "STEP_LEFT",
      "STEP_LEFT",
      "STEP_ENTER_BRANCH",
      "STEP_STOP_ON_MARKER"
    ]);

    expect(data.routeTable.LOCK_RED.LOCK_YELLOW.path).toEqual([
      "LOCK_RED",
      "ENTRY_RED",
      "J_MAIN",
      "J_YELLOW",
      "ENTRY_YELLOW",
      "LOCK_YELLOW"
    ]);
    expect(data.routeTable.LOCK_RED.LOCK_YELLOW.steps).toEqual([
      "STEP_ENTER_BRANCH",
      "STEP_LEFT",
      "STEP_LEFT",
      "STEP_ENTER_BRANCH",
      "STEP_STOP_ON_MARKER"
    ]);

    expect(data.routeTable.LOCK_RED.BLACK_ZONE.path).toEqual([
      "LOCK_RED",
      "ENTRY_RED",
      "J_MAIN",
      "J_MID_LEFT",
      "LOOP_BL",
      "LOOP_LEFT_Y",
      "LOOP_TL",
      "BLACK_ZONE"
    ]);
  });

  it("renders stable public headers and representative entries", () => {
    const files = renderStm32Tables(buildStm32TablesData());

    expect(files["generated_layouts.h"]).toContain("typedef enum {\n  BRANCH_RED,");
    expect(files["generated_layouts.h"]).toContain("extern const layout_desc_t g_layouts[576];");
    expect(files["generated_layouts.c"]).toContain("{ .slots = { { COLOR_RED, COLOR_RED }, { COLOR_YELLOW, COLOR_YELLOW }, { COLOR_BLUE, COLOR_BLUE }, { COLOR_GREEN, COLOR_GREEN } } }");

    expect(files["generated_plan_table.h"]).toContain("#define MAX_PLAN_ACTIONS 32");
    expect(files["generated_plan_table.c"]).toContain("const plan_desc_t g_plan_table[576] = {");
    expect(files["generated_plan_table_bus_route.h"]).toContain("extern const plan_desc_t g_plan_table_bus_route[576];");
    expect(files["generated_plan_table_bus_route.c"]).toContain("const plan_desc_t g_plan_table_bus_route[576] = {");
    expect(files["generated_plan_table_lifo.h"]).toContain("extern const plan_desc_t g_plan_table_lifo[576];");
    expect(files["generated_plan_table_lifo.c"]).toContain("const plan_desc_t g_plan_table_lifo[576] = {");

    expect(files["generated_routes.h"]).toContain("extern const route_entry_t g_route_table[NODE_ID_T_COUNT][NODE_ID_T_COUNT];");
    expect(files["generated_routes.c"]).toContain("/* Route steps are derived from node paths as a first-pass junction abstraction. */");
    expect(files["generated_routes.c"]).toContain("{ 1,");
  });

  it("keeps generated plan actions consistent with the planner for a known layout", () => {
    const graph = createDefaultGraph();
    const config = createDefaultSimulationConfig(graph);
    const router = new GraphRouter(config.map, config.robot);
    const layout = enumerateLegalLayouts()[0];
    const data = buildStm32TablesData();
    const directPlan = computeOptimalPolicy(
      config,
      {
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
      },
      router
    );

    const generatedPlan = data.planTable[layout.id];
    expect(generatedPlan.action_count).toBe(directPlan.length);
    expect(generatedPlan.actions[0].type).toBe(directPlan[0].type);
  });

  it("enforces true LiFo when the planner starts with stacked carried resources", () => {
    const graph = createDefaultGraph();
    const config = createDefaultSimulationConfig(graph);
    const router = new GraphRouter(config.map, config.robot);
    const layout = {
      id: 999,
      slots: {
        RED: ["RED", "GREEN"],
        YELLOW: ["YELLOW", "RED"],
        BLUE: ["BLUE", "YELLOW"],
        GREEN: ["GREEN", "BLUE"]
      } as Record<BranchId, [ResourceColor, ResourceColor]>
    };
    const lifoPlan = computeOptimalPolicyLiFo(
      config,
      {
        current_node: "J_MAIN",
        branch_to_resources: layout.slots,
        locks_cleared: { RED: true, YELLOW: true, BLUE: true, GREEN: true },
        picked_slots: { R_RED_1: true, R_RED_2: true },
        inventory: [
          { color: "RED", sourceBranch: "RED" },
          { color: "GREEN", sourceBranch: "RED" }
        ],
        holding_locks_for_branches: [],
        holding_lock_for_branch: null,
        placed_locks: [],
        placed_resources: [],
        score: 0,
        time_elapsed_s: 0,
        started_navigation: true,
        reached_main_junction: true,
        completed: false,
        returned_to_start: false
      },
      router
    );

    expect(lifoPlan[0]).toEqual({ type: "DROP_RESOURCE", color: "GREEN" });
  });

  it("emits at least one layout where LiFo and normal exported plans differ", () => {
    const data = buildStm32TablesData();
    const hasDifferentLayout = data.planTable.some((plan, index) => {
      const lifoPlan = data.planTableLiFo[index];
      return JSON.stringify(plan) !== JSON.stringify(lifoPlan);
    });

    expect(hasDifferentLayout).toBe(true);
  });

  it("emits at least one layout where bus route and omniscient exported plans differ", () => {
    const data = buildStm32TablesData();
    const hasDifferentLayout = data.planTable.some((plan, index) => {
      const busPlan = data.planTableBusRoute[index];
      return JSON.stringify(plan) !== JSON.stringify(busPlan);
    });

    expect(hasDifferentLayout).toBe(true);
  });
});
