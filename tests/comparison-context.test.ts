import { describe, expect, it } from "vitest";
import { resolveSingleSourceComparisonContext } from "../src/comparisonContext";
import { layoutIdForSeed } from "../src/randomization";

describe("single-source comparison context", () => {
  it("preserves the typed layout input in seed mode while still comparing the seed-derived layout", () => {
    const resolved = resolveSingleSourceComparisonContext("seed_sampling", 1, 123);

    expect(resolved.context).toEqual({
      mode: "exact_layout_sweep",
      seed: null,
      layout_id: 123
    });
    expect(resolved.normalizedLayoutInput).toBe(123);
  });

  it("keeps seeded comparison only when the typed layout still matches the seed-derived layout", () => {
    const layoutId = layoutIdForSeed(1);
    const resolved = resolveSingleSourceComparisonContext("seed_sampling", 1, layoutId);

    expect(resolved.context).toEqual({
      mode: "seed_sampling",
      seed: 1,
      layout_id: layoutId
    });
  });
});
