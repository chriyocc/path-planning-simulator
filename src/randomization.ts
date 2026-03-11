import seedrandom from "seedrandom";
import type { BranchId, ResourceColor, RoundRandomization } from "./types";
import { findLayoutIdForRandomization } from "./layouts";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const COLORS: ResourceColor[] = ["RED", "YELLOW", "BLUE", "GREEN"];

function shuffledRow(rng: seedrandom.PRNG): [ResourceColor, ResourceColor, ResourceColor, ResourceColor] {
  const row = [...COLORS];
  for (let i = row.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [row[i], row[j]] = [row[j], row[i]];
  }
  return row as [ResourceColor, ResourceColor, ResourceColor, ResourceColor];
}

export function randomizeRound(seed: number): RoundRandomization {
  const rng = seedrandom(String(seed));
  const firstRow = shuffledRow(rng);
  const secondRow = shuffledRow(rng);

  const branch_to_resources = {} as RoundRandomization["branch_to_resources"];
  BRANCHES.forEach((branchId, index) => {
    branch_to_resources[branchId] = [firstRow[index], secondRow[index]];
  });

  return { branch_to_resources };
}

export function layoutIdForSeed(seed: number): number {
  const layoutId = findLayoutIdForRandomization(randomizeRound(seed).branch_to_resources);
  if (layoutId === null) {
    throw new Error(`Seed ${seed} did not resolve to a legal layout`);
  }
  return layoutId;
}
