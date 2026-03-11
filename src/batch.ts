import type { BatchResult, PolicyOverrides, SimulationConfig, StrategyPolicy } from "./types";
import { simulateRound, simulateRoundForLayout } from "./simulator";
import { enumerateLegalLayouts } from "./layouts";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

export function simulateBatch(
  config: SimulationConfig,
  policy: StrategyPolicy,
  runs: number,
  overrides?: Partial<PolicyOverrides>
): BatchResult {
  const results = [];
  for (let i = 1; i <= runs; i += 1) {
    results.push(simulateRound(config, policy, i, overrides));
  }
  return summarizeBatchResults(policy.name, "seed_sampling", results, runs);
}

export function simulateBatchOverLayouts(
  config: SimulationConfig,
  policy: StrategyPolicy,
  overrides?: Partial<PolicyOverrides>
): BatchResult {
  const layouts = enumerateLegalLayouts();
  const results = layouts.map((layout) => simulateRoundForLayout(config, policy, layout.id, overrides));
  return summarizeBatchResults(policy.name, "exact_layout_sweep", results, layouts.length);
}

function summarizeBatchResults(
  policyName: string,
  batchSource: BatchResult["batch_source"],
  results: ReturnType<typeof simulateRound>[],
  runs: number
): BatchResult {
  const times = results.map((r) => r.state.time_elapsed_s).sort((a, b) => a - b);
  const meanScore = results.reduce((acc, r) => acc + r.state.score, 0) / runs;
  const meanTime = results.reduce((acc, r) => acc + r.state.time_elapsed_s, 0) / runs;
  const completion = results.filter((r) => r.state.returned_to_start && r.state.placed_resources.length === 8).length / runs;
  const violations = results.reduce((acc, r) => acc + r.legality_violations.length, 0);

  const top_samples = results
    .map((r) => ({ seed: r.seed, layout_id: r.layout_id, score: r.state.score, time_s: r.state.time_elapsed_s }))
    .sort((a, b) => b.score - a.score || a.time_s - b.time_s)
    .slice(0, 5);

  return {
    policy_name: policyName,
    batch_source: batchSource,
    runs,
    mean_score: Number(meanScore.toFixed(2)),
    completion_rate: Number((completion * 100).toFixed(2)),
    mean_time_s: Number(meanTime.toFixed(2)),
    p50_time_s: Number(percentile(times, 50).toFixed(2)),
    p90_time_s: Number(percentile(times, 90).toFixed(2)),
    violations_count: violations,
    top_samples
  };
}
