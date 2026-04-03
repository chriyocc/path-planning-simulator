import { describe, expect, it } from "vitest";
import { createDefaultGraph } from "../src/map";
import { randomizeRound } from "../src/randomization";
import { createDefaultSimulationConfig, simulateRound, simulateRoundForLayout } from "../src/simulator";
import { AdaptiveSafePolicy } from "../src/policies";
import { findLayoutIdForRandomization, getLayoutById } from "../src/layouts";
import { simulateBatch, simulateBatchOverLayouts } from "../src/batch";

const graph = createDefaultGraph();

function config() {
  return createDefaultSimulationConfig(graph);
}

describe("layout-id helpers", () => {
  it("resolves a legal layout by id", () => {
    const layout = getLayoutById(0);
    expect(layout.id).toBe(0);
    expect(layout.slots.RED).toEqual(["RED", "RED"]);
  });

  it("maps seeded randomization to a legal layout id", () => {
    const round = randomizeRound(1);
    const layoutId = findLayoutIdForRandomization(round.branch_to_resources);
    expect(layoutId).not.toBeNull();
    expect(getLayoutById(layoutId!).slots).toEqual(round.branch_to_resources);
  });
});

describe("layout-based simulator execution", () => {
  it("single run from explicit layout id matches the equivalent seeded placement", () => {
    const seed = 1;
    const seeded = simulateRound(config(), AdaptiveSafePolicy, seed);
    const layoutId = findLayoutIdForRandomization(seeded.state.branch_to_resources)!;
    const layoutDriven = simulateRoundForLayout(config(), AdaptiveSafePolicy, layoutId);

    expect(layoutDriven.layout_id).toBe(layoutId);
    expect(layoutDriven.state.branch_to_resources).toEqual(seeded.state.branch_to_resources);
    expect(layoutDriven.state.score).toBe(seeded.state.score);
    expect(layoutDriven.state.time_elapsed_s).toBe(seeded.state.time_elapsed_s);
  });
});

describe("exact-layout batch mode", () => {
  it("seed batch mode stays seed-driven", () => {
    const result = simulateBatch(config(), AdaptiveSafePolicy, 10);
    expect(result.batch_source).toBe("seed_sampling");
    expect(result.runs).toBe(10);
  });

  it("exact layout sweep iterates all 576 legal layouts", () => {
    const result = simulateBatchOverLayouts(config(), AdaptiveSafePolicy);
    expect(result.batch_source).toBe("exact_layout_sweep");
    expect(result.runs).toBe(576);
    expect(result.top_samples.every((sample) => sample.layout_id >= 0 && sample.layout_id < 576)).toBe(true);
  }, 120000);
});
