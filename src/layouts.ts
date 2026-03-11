import type { BranchId, ResourceColor, RoundRandomization } from "./types";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const COLORS: Exclude<ResourceColor, "BLACK">[] = ["RED", "YELLOW", "BLUE", "GREEN"];

export interface EnumeratedLayout {
  id: number;
  slots: Record<BranchId, [Exclude<ResourceColor, "BLACK">, Exclude<ResourceColor, "BLACK">]>;
}

let cachedLayouts: EnumeratedLayout[] | null = null;
let cachedLayoutIndex: Map<string, number> | null = null;

function permute<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permute(rest)) {
      out.push([item, ...tail]);
    }
  });
  return out;
}

function normalizeSlots(
  slots: Record<BranchId, [ResourceColor, ResourceColor]>
): Record<BranchId, [Exclude<ResourceColor, "BLACK">, Exclude<ResourceColor, "BLACK">]> {
  return {
    RED: [slots.RED[0] as Exclude<ResourceColor, "BLACK">, slots.RED[1] as Exclude<ResourceColor, "BLACK">],
    YELLOW: [slots.YELLOW[0] as Exclude<ResourceColor, "BLACK">, slots.YELLOW[1] as Exclude<ResourceColor, "BLACK">],
    BLUE: [slots.BLUE[0] as Exclude<ResourceColor, "BLACK">, slots.BLUE[1] as Exclude<ResourceColor, "BLACK">],
    GREEN: [slots.GREEN[0] as Exclude<ResourceColor, "BLACK">, slots.GREEN[1] as Exclude<ResourceColor, "BLACK">]
  };
}

function layoutKey(
  slots: Record<BranchId, [Exclude<ResourceColor, "BLACK">, Exclude<ResourceColor, "BLACK">]>
): string {
  return BRANCHES.map((branch) => `${branch}:${slots[branch][0]}-${slots[branch][1]}`).join("|");
}

export function enumerateLegalLayouts(): EnumeratedLayout[] {
  if (cachedLayouts) return cachedLayouts;
  const rowPermutations = permute(COLORS);
  const layouts: EnumeratedLayout[] = [];
  let id = 0;
  for (const row1 of rowPermutations) {
    for (const row2 of rowPermutations) {
      const slots = {} as EnumeratedLayout["slots"];
      BRANCHES.forEach((branchId, index) => {
        slots[branchId] = [row1[index], row2[index]];
      });
      layouts.push({ id, slots });
      id += 1;
    }
  }
  cachedLayouts = layouts;
  cachedLayoutIndex = new Map(layouts.map((layout) => [layoutKey(layout.slots), layout.id]));
  return layouts;
}

export function getLayoutById(layoutId: number): EnumeratedLayout {
  const layouts = enumerateLegalLayouts();
  const layout = layouts[layoutId];
  if (!layout) {
    throw new Error(`Unknown layout_id ${layoutId}`);
  }
  return layout;
}

export function findLayoutIdForRandomization(
  slots: Record<BranchId, [ResourceColor, ResourceColor]>
): number | null {
  enumerateLegalLayouts();
  const key = layoutKey(normalizeSlots(slots));
  return cachedLayoutIndex?.get(key) ?? null;
}

export function randomizationFromLayoutId(layoutId: number): RoundRandomization {
  return { branch_to_resources: getLayoutById(layoutId).slots };
}
