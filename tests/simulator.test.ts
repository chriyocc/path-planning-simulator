import { describe, expect, it } from "vitest";
import { BaselineSingleCarryPolicy, BusRouteParametricPolicy, ValueAwareDeadlinePolicy, OptimalOmniscientPolicy } from "../src/policies";
import { createDefaultGraph } from "../src/map";
import { estimateFirmwarePlan } from "../src/firmware";
import { GraphRouter } from "../src/router";
import { randomizeRound } from "../src/randomization";
import { simulateBatch } from "../src/batch";
import { createDefaultSimulationConfig, simulateRound } from "../src/simulator";
import type { StrategyPolicy } from "../src/types";

const graph = createDefaultGraph();

function config() {
  return createDefaultSimulationConfig(graph);
}

describe("routing", () => {
  it("finds shortest path between start and black zone through junctions", () => {
    const cfg = config();
    const router = new GraphRouter(cfg.map, cfg.robot);
    const route = router.shortestPath("START", "BLACK_ZONE");
    expect(route.path[0]).toBe("START");
    expect(route.path).toContain("J_MAIN");
    expect(route.path).toContain("J_MID_LEFT");
    expect(route.path.at(-1)).toBe("BLACK_ZONE");
    expect(route.cost_s).toBeGreaterThan(0);
  });
});

describe("randomization", () => {
  it("always generates one of each color in both first and second rows", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const round = randomizeRound(seed);
      const firstRow = Object.values(round.branch_to_resources).map((slots) => slots[0]).sort();
      const secondRow = Object.values(round.branch_to_resources).map((slots) => slots[1]).sort();
      expect(firstRow).toEqual(["BLUE", "GREEN", "RED", "YELLOW"]);
      expect(secondRow).toEqual(["BLUE", "GREEN", "RED", "YELLOW"]);
    }
  });
});

describe("legality", () => {
  it("rejects picking a resource before unlocking branch", () => {
    const illegalPolicy: StrategyPolicy = {
      name: "IllegalPick",
      nextAction: () => ({ type: "PICK_RESOURCE", slotNodeId: "R_RED_1", branchId: "RED" })
    };

    const result = simulateRound(config(), illegalPolicy, 7);
    expect(result.legality_violations.some((v) => v.includes("before unlock"))).toBe(true);
  });

  it("baseline one-by-one policy runs without legality violations", () => {
    const result = simulateRound(config(), BaselineSingleCarryPolicy, 5);
    expect(result.legality_violations.length).toBe(0);
  });

  it("counts held lock against carry capacity when picking a lock", () => {
    const actions = [
      { type: "PICK_LOCK", branchId: "RED" },
      { type: "DROP_LOCK", branchId: "RED" },
      { type: "PICK_RESOURCE", slotNodeId: "R_RED_1", branchId: "RED" },
      { type: "PICK_RESOURCE", slotNodeId: "R_RED_2", branchId: "RED" },
      { type: "PICK_LOCK", branchId: "YELLOW" },
      { type: "END_ROUND" }
    ] as const;
    let idx = 0;
    const scriptedPolicy: StrategyPolicy = {
      name: "LockCapacityScripted",
      nextAction: () => (actions[idx++] as ReturnType<StrategyPolicy["nextAction"]>) ?? { type: "END_ROUND" }
    };

    const result = simulateRound(config(), scriptedPolicy, 11);
    expect(result.legality_violations.some((v) => v.includes("PICK_LOCK capacity exceeded"))).toBe(true);
    expect(result.state.holding_lock_for_branch).toBe(null);
  });

  it("allows carrying two black locks when capacity is 2", () => {
    const actions = [
      { type: "PICK_LOCK", branchId: "RED" },
      { type: "PICK_LOCK", branchId: "YELLOW" },
      { type: "END_ROUND" }
    ] as const;
    let idx = 0;
    const scriptedPolicy: StrategyPolicy = {
      name: "TwoLockCarryScripted",
      nextAction: () => (actions[idx++] as ReturnType<StrategyPolicy["nextAction"]>) ?? { type: "END_ROUND" }
    };

    const cfg = config();
    cfg.robot.carry_capacity = 2;
    const result = simulateRound(cfg, scriptedPolicy, 13);
    expect(result.legality_violations.some((v) => v.includes("PICK_LOCK capacity exceeded"))).toBe(false);
    expect(result.state.holding_locks_for_branches.sort()).toEqual(["RED", "YELLOW"]);
  });

  it("rejects picking slot 2 before slot 1 in a branch", () => {
    const actions = [
      { type: "PICK_LOCK", branchId: "RED" },
      { type: "DROP_LOCK", branchId: "RED" },
      { type: "PICK_RESOURCE", slotNodeId: "R_RED_2", branchId: "RED" },
      { type: "END_ROUND" }
    ] as const;
    let idx = 0;
    const scriptedPolicy: StrategyPolicy = {
      name: "SlotOrderScripted",
      nextAction: () => (actions[idx++] as ReturnType<StrategyPolicy["nextAction"]>) ?? { type: "END_ROUND" }
    };

    const result = simulateRound(config(), scriptedPolicy, 17);
    expect(result.legality_violations.some((v) => v.includes("slot order violated"))).toBe(true);
  });
});

describe("timing and scoring", () => {
  it("truncates time at timeout", () => {
    const slow = config();
    slow.timeout_s = 2;
    slow.robot.speed_mm_s_by_line_type = {
      SOLID: 50,
      DASHED: 40,
      ZIGZAG: 35,
      SINE: 38
    };

    const movePolicy: StrategyPolicy = {
      name: "MoveFar",
      nextAction: () => ({ type: "MOVE_TO", targetNodeId: "BLACK_ZONE" })
    };

    const result = simulateRound(slow, movePolicy, 1);
    expect(result.state.time_elapsed_s).toBe(2);
  });

  it("applies return bonus only when full completion and return occur", () => {
    const result = simulateRound(config(), BusRouteParametricPolicy, 2);
    expect(result.state.placed_resources.length).toBe(8);
    expect(result.state.returned_to_start).toBe(true);
    expect(result.state.score).toBeGreaterThanOrEqual(40);
  });

  it("awards the official 495 points for a perfect run", () => {
    const result = simulateRound(config(), OptimalOmniscientPolicy, 1);
    expect(result.state.placed_resources.length).toBe(8);
    expect(result.state.returned_to_start).toBe(true);
    expect(result.state.score).toBe(495);
  });
});

describe("policy comparisons", () => {
  it("higher carry capacity should not increase mean time for bus policy", { timeout: 15000 }, () => {
    const cap1 = config();
    cap1.robot.carry_capacity = 1;
    const cap3 = config();
    cap3.robot.carry_capacity = 3;

    const r1 = simulateBatch(cap1, BusRouteParametricPolicy, 80);
    const r3 = simulateBatch(cap3, BusRouteParametricPolicy, 80);
    expect(r3.mean_time_s).toBeLessThanOrEqual(r1.mean_time_s);
  });

  it("value-aware policy improves mean score in tight deadlines", { timeout: 15000 }, () => {
    const tight = config();
    tight.timeout_s = 120;
    const baseline = simulateBatch(tight, BaselineSingleCarryPolicy, 120);
    const value = simulateBatch(tight, ValueAwareDeadlinePolicy, 120);
    expect(value.mean_score).toBeGreaterThanOrEqual(baseline.mean_score);
  });

  it("optimal omniscient policy should guarantee lowest time to completion", () => {
    const defaultCfg = config();
    defaultCfg.timeout_s = 600; // ensure plenty of time
    const bus = simulateBatch(defaultCfg, BusRouteParametricPolicy, 20);
    const optimal = simulateBatch(defaultCfg, OptimalOmniscientPolicy, 20);
    expect(optimal.mean_time_s).toBeLessThan(bus.mean_time_s);
    expect(optimal.completion_rate).toBe(100);
  });
});

describe("batch and exports", () => {
  it("batch is reproducible for fixed run count", () => {
    const a = simulateBatch(config(), BusRouteParametricPolicy, 50);
    const b = simulateBatch(config(), BusRouteParametricPolicy, 50);
    expect(a.mean_score).toBe(b.mean_score);
    expect(a.p90_time_s).toBe(b.p90_time_s);
  });

  it("firmware export has required fsm states and route rows", () => {
    const result = simulateRound(config(), BusRouteParametricPolicy, 1);
    const fw = estimateFirmwarePlan(result);
    expect(fw.fsm_states).toContain("DECIDE");
    expect(fw.fsm_states).toContain("ERROR_RECOVERY");
    expect(fw.route_table.length).toBeGreaterThan(0);
    expect(fw.policy_rules.length).toBeGreaterThan(0);
  });
});
