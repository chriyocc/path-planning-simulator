import { describe, expect, it } from "vitest";
import {
  formatBatchRankingPanel,
  formatPolicyStatusPanel,
  formatRandomizationPanel,
  formatSingleSourceComparisonPanel
} from "../src/runtimePanels";
import type { BatchResult, PolicyStatusSnapshot, SimulationResult } from "../src/types";

const snapshot: PolicyStatusSnapshot = {
  current_step: "Pick YELLOW black lock",
  next_step: "Drop YELLOW black lock",
  holding: "locks=[none] resources=[none]",
  knowledge_summary: "RED: ?, ? | YELLOW: YELLOW, ? | BLUE: ?, ? | GREEN: ?, ?",
  candidate_count: 144,
  layout_locked: false,
  policy_notes: ["Observed YELLOW slot 1 = YELLOW"],
  known_slots: {
    RED: ["UNKNOWN", "UNKNOWN"],
    YELLOW: ["YELLOW", "UNKNOWN"],
    BLUE: ["UNKNOWN", "UNKNOWN"],
    GREEN: ["UNKNOWN", "UNKNOWN"]
  }
};

const result: SimulationResult = {
  seed: null,
  layout_id: 0,
  state: {
    current_node: "START",
    branch_to_resources: {
      RED: ["RED", "RED"],
      YELLOW: ["YELLOW", "YELLOW"],
      BLUE: ["BLUE", "BLUE"],
      GREEN: ["GREEN", "GREEN"]
    },
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
  trace: [],
  policy_snapshots: [],
  legality_violations: [],
  policy_name: "Inference_ExpectedValue"
};

describe("runtime panel formatting", () => {
  it("renders the shared status panel from structured snapshots", () => {
    const text = formatPolicyStatusPanel(snapshot, {
      holdingLockCount: 1,
      inventory: [{ color: "YELLOW", sourceBranch: "YELLOW" }]
    });

    expect(text).toContain("current_step=Pick YELLOW black lock");
    expect(text).toContain("candidate_count=144");
    expect(text).toContain("holding_resources=YELLOW:YELLOW");
  });

  it("renders known-so-far layout view from recorded knowledge snapshots", () => {
    const text = formatRandomizationPanel(result, snapshot, "known_so_far");
    expect(text).toContain("layout_view=known_so_far");
    expect(text).toContain("YELLOW: YELLOW, ?");
    expect(text).toContain("RED: ?, ?");
  });

  it("renders ground truth layout view from the final simulation result", () => {
    const text = formatRandomizationPanel(result, snapshot, "ground_truth");
    expect(text).toContain("layout_view=ground_truth");
    expect(text).toContain("YELLOW: YELLOW, YELLOW");
    expect(text).toContain("RED: RED, RED");
  });

  it("renders a single-source comparison table for the current layout or seed", () => {
    const text = formatSingleSourceComparisonPanel(
      {
        mode: "seed_sampling",
        seed: 42,
        layout_id: 165
      },
      [
        {
          policy_name: "BusRoute_Parametric",
          score: 495,
          time_s: 217.75,
          completed: true,
          violations: 0
        },
        {
          policy_name: "Optimal_Omniscient",
          score: 495,
          time_s: 187.67,
          completed: true,
          violations: 0
        }
      ]
    );

    expect(text).toContain("source_mode=seed_sampling");
    expect(text).toContain("seed=42");
    expect(text).toContain("layout_id=165");
    expect(text).toContain("1. Optimal_Omniscient");
    expect(text).toContain("2. BusRoute_Parametric");
    expect(text).toContain("time=187.67s");
  });

  it("ranks batch results by legality, completion, score, p90, and mean time rather than mean time alone", () => {
    const entries: BatchResult[] = [
      {
        policy_name: "FastButRisky",
        batch_source: "exact_layout_sweep",
        runs: 576,
        mean_score: 495,
        completion_rate: 100,
        mean_time_s: 210,
        p50_time_s: 205,
        p90_time_s: 270,
        violations_count: 0,
        top_samples: []
      },
      {
        policy_name: "StableAndLegal",
        batch_source: "exact_layout_sweep",
        runs: 576,
        mean_score: 495,
        completion_rate: 100,
        mean_time_s: 214,
        p50_time_s: 212,
        p90_time_s: 225,
        violations_count: 0,
        top_samples: []
      },
      {
        policy_name: "FasterButIllegal",
        batch_source: "exact_layout_sweep",
        runs: 576,
        mean_score: 495,
        completion_rate: 100,
        mean_time_s: 180,
        p50_time_s: 178,
        p90_time_s: 190,
        violations_count: 2,
        top_samples: []
      }
    ];

    const text = formatBatchRankingPanel(entries);
    expect(text).toContain("1. StableAndLegal");
    expect(text).toContain("2. FastButRisky");
    expect(text).toContain("3. FasterButIllegal");
  });
});
