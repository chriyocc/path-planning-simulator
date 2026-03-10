import { describe, expect, it } from "vitest";
import {
  BaselineSingleCarryPolicy,
  BusRouteParametricPolicy,
  FixedRouteCapacity2Policy,
  ValueAwareDeadlinePolicy,
  OptimalOmniscientPolicy,
  withPolicyOverrides
} from "../src/policies";
import { createDefaultGraph } from "../src/map";
import { estimateFirmwarePlan } from "../src/firmware";
import { GraphRouter } from "../src/router";
import { randomizeRound } from "../src/randomization";
import { simulateBatch } from "../src/batch";
import { createDefaultSimulationConfig, simulateRound } from "../src/simulator";
import type { Observation, RoundState, StrategyPolicy } from "../src/types";

const graph = createDefaultGraph();

function config() {
  return createDefaultSimulationConfig(graph);
}

function stateAtRedZoneWithTwoRed(): RoundState {
  return {
    current_node: "ZONE_RED",
    branch_to_resources: randomizeRound(1).branch_to_resources,
    locks_cleared: { RED: true, YELLOW: false, BLUE: false, GREEN: false },
    picked_slots: { R_RED_1: true, R_RED_2: true },
    inventory: [
      { color: "RED", sourceBranch: "RED" },
      { color: "RED", sourceBranch: "RED" }
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
  };
}

function observationAtRedZone(cfg: ReturnType<typeof config>): Observation {
  return {
    remaining_time_s: cfg.timeout_s,
    unlocked_branches: ["RED"],
    locked_branches: ["YELLOW", "BLUE", "GREEN"],
    inventory_count: 2,
    all_resources_delivered: false
  };
}

function scriptedPolicy(actions: readonly ReturnType<StrategyPolicy["nextAction"]>[], name = "Scripted"): StrategyPolicy {
  let idx = 0;
  return {
    name,
    nextAction: () => actions[idx++] ?? { type: "END_ROUND" }
  };
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

  it("reaches the right black zone directly from the right loop", () => {
    const cfg = config();
    const router = new GraphRouter(cfg.map, cfg.robot);
    const route = router.shortestPath("LOOP_TR", "BLACK_ZONE_RIGHT");
    expect(route.path).toEqual(["LOOP_TR", "BLACK_ZONE_RIGHT"]);
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

  it("bus route drops the second same-color resource immediately when already at the zone", () => {
    const cfg = config();
    const roundState = stateAtRedZoneWithTwoRed();
    const observation = observationAtRedZone(cfg);

    const action = BusRouteParametricPolicy.nextAction(roundState, observation, cfg);
    expect(action).toEqual({ type: "DROP_RESOURCE", color: "RED" });
  });

  it("baseline single carry drops immediately when already at the matching zone", () => {
    const cfg = config();
    const action = BaselineSingleCarryPolicy.nextAction(stateAtRedZoneWithTwoRed(), observationAtRedZone(cfg), cfg);
    expect(action).toEqual({ type: "DROP_RESOURCE", color: "RED" });
  });

  it("value aware deadline drops immediately when already at the matching zone", () => {
    const cfg = config();
    const action = ValueAwareDeadlinePolicy.nextAction(stateAtRedZoneWithTwoRed(), observationAtRedZone(cfg), cfg);
    expect(action).toEqual({ type: "DROP_RESOURCE", color: "RED" });
  });

  it("optimal omniscient drops immediately when already at the matching zone", () => {
    const cfg = config();
    const action = OptimalOmniscientPolicy.nextAction(stateAtRedZoneWithTwoRed(), observationAtRedZone(cfg), cfg);
    expect(action).toEqual({ type: "DROP_RESOURCE", color: "RED" });
  });

  it("LiFo means the most recently picked resource is dropped next, even if it changes the color choice", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 2;
    const roundState: RoundState = {
      current_node: "J_MAIN",
      branch_to_resources: randomizeRound(1).branch_to_resources,
      locks_cleared: { RED: true, YELLOW: false, BLUE: false, GREEN: false },
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
    };
    const observation: Observation = {
      remaining_time_s: cfg.timeout_s,
      unlocked_branches: ["RED"],
      locked_branches: ["YELLOW", "BLUE", "GREEN"],
      inventory_count: 2,
      all_resources_delivered: false
    };

    const wrapped = withPolicyOverrides(OptimalOmniscientPolicy, { resource_drop_order: "lifo" });
    expect(wrapped.nextAction(roundState, observation, cfg)).toEqual({ type: "DROP_RESOURCE", color: "GREEN" });
  });

  it("drop resource uses FIFO matching removal in auto mode and LiFo removal when enabled", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 3;
    const actions = [
      { type: "PICK_LOCK", branchId: "GREEN" },
      { type: "DROP_LOCK", branchId: "GREEN" },
      { type: "PICK_RESOURCE", slotNodeId: "R_GREEN_1", branchId: "GREEN" },
      { type: "PICK_RESOURCE", slotNodeId: "R_GREEN_2", branchId: "GREEN" },
      { type: "PICK_LOCK", branchId: "RED" },
      { type: "DROP_LOCK", branchId: "RED" },
      { type: "PICK_RESOURCE", slotNodeId: "R_RED_1", branchId: "RED" },
      { type: "DROP_RESOURCE", color: "RED" },
      { type: "END_ROUND" }
    ] as const;

    const autoResult = simulateRound(cfg, scriptedPolicy(actions, "DropAuto"), 1);
    const lifoResult = simulateRound(
      cfg,
      scriptedPolicy(actions, "DropLiFo"),
      1,
      { resource_drop_order: "lifo" }
    );

    expect(autoResult.state.placed_resources[0]).toEqual({ color: "RED", sourceBranch: "GREEN" });
    expect(lifoResult.state.placed_resources[0]).toEqual({ color: "RED", sourceBranch: "RED" });
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
  it("fixed route policy unlocks branches in the same order across different seeds", () => {
    const run1 = simulateRound(config(), FixedRouteCapacity2Policy, 1);
    const run2 = simulateRound(config(), FixedRouteCapacity2Policy, 57);

    const unlockOrder = (result: ReturnType<typeof simulateRound>) =>
      result.trace
        .filter((step) => step.note === "lock_gripped")
        .map((step) => step.action.branchId);

    expect(unlockOrder(run1)).toEqual(["YELLOW", "BLUE", "GREEN", "RED"]);
    expect(unlockOrder(run2)).toEqual(["YELLOW", "BLUE", "GREEN", "RED"]);
  });

  it("bus policy fill-capacity override chains an extra lock instead of dropping immediately", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 2;
    const state: RoundState = {
      current_node: "LOCK_YELLOW",
      branch_to_resources: randomizeRound(1).branch_to_resources,
      locks_cleared: { RED: false, YELLOW: false, BLUE: false, GREEN: false },
      picked_slots: {},
      inventory: [],
      holding_locks_for_branches: ["YELLOW"],
      holding_lock_for_branch: "YELLOW",
      placed_locks: [],
      placed_resources: [],
      score: 0,
      time_elapsed_s: 0,
      started_navigation: true,
      reached_main_junction: true,
      completed: false,
      returned_to_start: false
    };
    const observation: Observation = {
      remaining_time_s: cfg.timeout_s,
      unlocked_branches: [],
      locked_branches: ["RED", "YELLOW", "BLUE", "GREEN"],
      inventory_count: 1,
      all_resources_delivered: false
    };

    const action = withPolicyOverrides(BusRouteParametricPolicy, {
      black_lock_carry_mode: "fill_capacity"
    }).nextAction({ ...state }, observation, cfg);

    expect(action.type).toBe("PICK_LOCK");
    expect(action.branchId).not.toBe("YELLOW");
  });

  it("bus policy single override drops immediately when already holding one lock", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 3;
    const state: RoundState = {
      current_node: "LOCK_YELLOW",
      branch_to_resources: randomizeRound(2).branch_to_resources,
      locks_cleared: { RED: false, YELLOW: false, BLUE: false, GREEN: false },
      picked_slots: {},
      inventory: [],
      holding_locks_for_branches: ["YELLOW"],
      holding_lock_for_branch: "YELLOW",
      placed_locks: [],
      placed_resources: [],
      score: 0,
      time_elapsed_s: 0,
      started_navigation: true,
      reached_main_junction: true,
      completed: false,
      returned_to_start: false
    };
    const observation: Observation = {
      remaining_time_s: cfg.timeout_s,
      unlocked_branches: [],
      locked_branches: ["RED", "YELLOW", "BLUE", "GREEN"],
      inventory_count: 1,
      all_resources_delivered: false
    };

    const action = withPolicyOverrides(BusRouteParametricPolicy, {
      black_lock_carry_mode: "single"
    }).nextAction({ ...state }, observation, cfg);

    expect(action).toEqual({ type: "DROP_LOCK", branchId: "YELLOW" });
  });

  it("fixed route fill-capacity override picks multiple locks before the first drop", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 2;
    const result = simulateRound(
      cfg,
      withPolicyOverrides(FixedRouteCapacity2Policy, { black_lock_carry_mode: "fill_capacity" }),
      1
    );
    const firstDropIndex = result.trace.findIndex((step) => step.note === "lock_deposited");
    const lockGripsBeforeDrop = result.trace
      .slice(0, firstDropIndex)
      .filter((step) => step.note === "lock_gripped")
      .map((step) => step.action.branchId);

    expect(lockGripsBeforeDrop).toEqual(["YELLOW", "BLUE"]);
  });

  it("fixed route branch-order overrides change lock unlock order", () => {
    const cases = [
      { branch_order: "yellow_blue_green_red", expected: ["YELLOW", "BLUE", "GREEN", "RED"] },
      { branch_order: "red_yellow_blue_green", expected: ["RED", "YELLOW", "BLUE", "GREEN"] },
      { branch_order: "blue_green_yellow_red", expected: ["BLUE", "GREEN", "YELLOW", "RED"] },
      { branch_order: "green_blue_yellow_red", expected: ["GREEN", "BLUE", "YELLOW", "RED"] }
    ] as const;

    for (const testCase of cases) {
      const result = simulateRound(
        config(),
        withPolicyOverrides(FixedRouteCapacity2Policy, { branch_order: testCase.branch_order }),
        1
      );
      const unlockOrder = result.trace
        .filter((step) => step.note === "lock_gripped")
        .map((step) => step.action.branchId);
      expect(unlockOrder).toEqual(testCase.expected);
    }
  });

  it("fixed route immediate color drop timing scores earlier than auto on the same seed", () => {
    const autoResult = simulateRound(config(), withPolicyOverrides(FixedRouteCapacity2Policy, { color_drop_timing: "auto" }), 1);
    const immediateResult = simulateRound(
      config(),
      withPolicyOverrides(FixedRouteCapacity2Policy, { color_drop_timing: "immediate" }),
      1
    );
    const firstDropIndex = (result: ReturnType<typeof simulateRound>) =>
      result.trace.findIndex((step) => step.note?.startsWith("dropped_"));

    expect(firstDropIndex(immediateResult)).toBeGreaterThanOrEqual(0);
    expect(firstDropIndex(autoResult)).toBeGreaterThanOrEqual(0);
    expect(firstDropIndex(immediateResult)).toBeLessThan(firstDropIndex(autoResult));
  });

  it("fixed route when-full color drop timing waits until capacity is full before first drop when pickups remain", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 3;
    const result = simulateRound(
      cfg,
      withPolicyOverrides(FixedRouteCapacity2Policy, { color_drop_timing: "when_full" }),
      1
    );
    const firstDropIndex = result.trace.findIndex((step) => step.note?.startsWith("dropped_"));
    const pickedBeforeFirstDrop = result.trace
      .slice(0, firstDropIndex)
      .filter((step) => step.note?.startsWith("picked_")).length;

    expect(firstDropIndex).toBeGreaterThanOrEqual(0);
    expect(pickedBeforeFirstDrop).toBe(3);
  });

  it("fixed route clear-all-first lock strategy clears every lock before the first resource pickup", () => {
    const result = simulateRound(
      config(),
      withPolicyOverrides(FixedRouteCapacity2Policy, { lock_clear_strategy: "clear_all_first" }),
      1
    );
    const firstResourcePickIndex = result.trace.findIndex((step) => step.note?.startsWith("picked_"));
    const lastLockGripIndex = result.trace
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.note === "lock_gripped")
      .at(-1)?.index ?? -1;

    expect(firstResourcePickIndex).toBeGreaterThan(lastLockGripIndex);
    expect(
      result.trace.filter((step) => step.note === "lock_gripped").map((step) => step.action.branchId)
    ).toEqual(["YELLOW", "BLUE", "GREEN", "RED"]);
  });

  it("every policy can be wrapped and LiFo suffix is preserved in the effective name", () => {
    const wrapped = withPolicyOverrides(BaselineSingleCarryPolicy, {
      resource_drop_order: "lifo"
    });
    expect(wrapped).not.toBe(BaselineSingleCarryPolicy);
    expect(wrapped.name).toContain("cargo:lifo");
  });

  it("bus route ignores fixed-route-only knobs and still obeys black-lock carry override", () => {
    const cfg = config();
    cfg.robot.carry_capacity = 3;
    const state: RoundState = {
      current_node: "LOCK_YELLOW",
      branch_to_resources: randomizeRound(2).branch_to_resources,
      locks_cleared: { RED: false, YELLOW: false, BLUE: false, GREEN: false },
      picked_slots: {},
      inventory: [],
      holding_locks_for_branches: ["YELLOW"],
      holding_lock_for_branch: "YELLOW",
      placed_locks: [],
      placed_resources: [],
      score: 0,
      time_elapsed_s: 0,
      started_navigation: true,
      reached_main_junction: true,
      completed: false,
      returned_to_start: false
    };
    const observation: Observation = {
      remaining_time_s: cfg.timeout_s,
      unlocked_branches: [],
      locked_branches: ["RED", "YELLOW", "BLUE", "GREEN"],
      inventory_count: 1,
      all_resources_delivered: false
    };

    const action = withPolicyOverrides(BusRouteParametricPolicy, {
      black_lock_carry_mode: "single",
      branch_order: "green_blue_yellow_red",
      color_drop_timing: "immediate",
      lock_clear_strategy: "clear_all_first",
      resource_drop_order: "lifo"
    }).nextAction({ ...state }, observation, cfg);

    expect(action).toEqual({ type: "DROP_LOCK", branchId: "YELLOW" });
  });

  it("LiFo wrappers are applied across baseline, bus, fixed-route, and optimal policies", () => {
    expect(withPolicyOverrides(BaselineSingleCarryPolicy, { resource_drop_order: "lifo" }).name).toContain("cargo:lifo");
    expect(withPolicyOverrides(BusRouteParametricPolicy, { resource_drop_order: "lifo" }).name).toContain("cargo:lifo");
    expect(withPolicyOverrides(FixedRouteCapacity2Policy, { resource_drop_order: "lifo" }).name).toContain("cargo:lifo");
    expect(withPolicyOverrides(OptimalOmniscientPolicy, { resource_drop_order: "lifo" }).name).toContain("cargo:lifo");
  });

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
    expect(fw.policy_rules.some((rule) => rule.action.includes("nearest BLACK_ZONE"))).toBe(true);
  });
});
