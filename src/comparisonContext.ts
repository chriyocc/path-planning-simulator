import { layoutIdForSeed } from "./randomization";
import type { BatchSourceMode } from "./types";
import type { SingleSourceComparisonContext } from "./runtimePanels";

export interface ResolvedSingleSourceComparisonContext {
  context: SingleSourceComparisonContext;
  normalizedSeed: number;
  normalizedLayoutInput: number;
}

export function clampLayoutId(value: number): number {
  return Math.max(0, Math.min(575, Number.isFinite(value) ? Math.floor(value) : 0));
}

export function resolveSingleSourceComparisonContext(
  batchSourceMode: BatchSourceMode,
  seedValue: number,
  layoutValue: number
): ResolvedSingleSourceComparisonContext {
  const normalizedSeed = Math.max(1, Number(seedValue) || 1);
  const normalizedLayoutInput = clampLayoutId(Number(layoutValue));
  const seededLayoutId = layoutIdForSeed(normalizedSeed);

  if (batchSourceMode === "exact_layout_sweep") {
    return {
      context: {
        mode: "exact_layout_sweep",
        seed: null,
        layout_id: normalizedLayoutInput
      },
      normalizedSeed,
      normalizedLayoutInput
    };
  }

  if (normalizedLayoutInput !== seededLayoutId) {
    return {
      context: {
        mode: "exact_layout_sweep",
        seed: null,
        layout_id: normalizedLayoutInput
      },
      normalizedSeed,
      normalizedLayoutInput
    };
  }

  return {
    context: {
      mode: "seed_sampling",
      seed: normalizedSeed,
      layout_id: seededLayoutId
    },
    normalizedSeed,
    normalizedLayoutInput
  };
}
