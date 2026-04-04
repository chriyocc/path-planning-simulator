import { enumerateLegalLayouts } from "./layouts";
import { GraphRouter } from "./router";
import type {
  Action,
  BranchId,
  KnownResourceColor,
  Observation,
  PolicyDecision,
  PolicyKnownSlots,
  PolicyStatusSnapshot,
  PolicyTraceEvent,
  ResourceColor,
  RoundState,
  SimulationConfig,
  StrategyPolicy
} from "./types";

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const LEGAL_LAYOUTS = enumerateLegalLayouts();

interface PostPickupRuntime {
  knownSlots: PolicyKnownSlots;
  candidateIds: number[] | null;
  lastNotes: string[];
  shouldFinishCheapRemainingCargo: boolean;
  cheapRemainingCargoColor: Exclude<ResourceColor, "BLACK"> | null;
}

type PolicyFlavor = "observed" | "deductive" | "hybrid";

function createUnknownKnownSlots(): PolicyKnownSlots {
  return {
    RED: ["UNKNOWN", "UNKNOWN"],
    YELLOW: ["UNKNOWN", "UNKNOWN"],
    BLUE: ["UNKNOWN", "UNKNOWN"],
    GREEN: ["UNKNOWN", "UNKNOWN"]
  };
}

function cloneKnownSlots(knownSlots: PolicyKnownSlots): PolicyKnownSlots {
  return {
    RED: [...knownSlots.RED] as PolicyKnownSlots["RED"],
    YELLOW: [...knownSlots.YELLOW] as PolicyKnownSlots["YELLOW"],
    BLUE: [...knownSlots.BLUE] as PolicyKnownSlots["BLUE"],
    GREEN: [...knownSlots.GREEN] as PolicyKnownSlots["GREEN"]
  };
}

function formatKnownColor(color: KnownResourceColor): string {
  return color === "UNKNOWN" ? "?" : color;
}

function formatKnowledgeSummary(knownSlots: PolicyKnownSlots, flavor: PolicyFlavor): string {
  const prefix = flavor === "observed" ? "observed" : "known";
  return `${prefix}=${BRANCHES
    .map((branch) => `${branch}: ${formatKnownColor(knownSlots[branch][0])}, ${formatKnownColor(knownSlots[branch][1])}`)
    .join(" | ")}`;
}

function holdingSummary(state: RoundState): string {
  const locks = state.holding_locks_for_branches.length > 0
    ? state.holding_locks_for_branches.join(", ")
    : "none";
  const resources = state.inventory.length > 0
    ? state.inventory.map((item) => `${item.color}:${item.sourceBranch}`).join(", ")
    : "none";
  return `locks=[${locks}] resources=[${resources}]`;
}

function describeAction(action: Action): string {
  if (action.type === "PICK_LOCK") return `Pick ${action.branchId} black lock`;
  if (action.type === "DROP_LOCK") return `Drop ${action.branchId ?? "held"} black lock`;
  if (action.type === "PICK_RESOURCE") return `Pick ${action.slotNodeId ?? "resource"}`;
  if (action.type === "DROP_RESOURCE") return `Drop ${action.color ?? "resource"}`;
  if (action.type === "RETURN_START") return "Return to START";
  if (action.type === "MOVE_TO") return `Move to ${action.targetNodeId ?? "target"}`;
  return "End round";
}

function travelSeconds(router: GraphRouter, fromNode: string, toNode: string): number {
  return router.shortestPath(fromNode, toNode).cost_s;
}

function nearestBlackZone(router: GraphRouter, fromNode: string, blackZones: string[]): string {
  let nearest = blackZones[0];
  let minTime = travelSeconds(router, fromNode, nearest);
  for (let i = 1; i < blackZones.length; i += 1) {
    const time = travelSeconds(router, fromNode, blackZones[i]);
    if (time < minTime) {
      minTime = time;
      nearest = blackZones[i];
    }
  }
  return nearest;
}

function pendingSlotsForBranch(state: RoundState, config: SimulationConfig, branchId: BranchId): string[] {
  const slots = config.map.branches[branchId].resource_slot_nodes;
  return slots.filter((slot) => !state.picked_slots[slot]);
}

function dropColorAtCurrentZone(state: RoundState, config: SimulationConfig): Action | null {
  for (const item of state.inventory) {
    if (item.color === "BLACK") continue;
    const color = item.color as Exclude<Action["color"], undefined>;
    if (config.map.colorZoneNodeIds[color] === state.current_node) {
      return { type: "DROP_RESOURCE", color };
    }
  }
  return null;
}

function chooseDropColor(state: RoundState, config: SimulationConfig, router: GraphRouter): Action {
  const grouped = new Map<Exclude<Action["color"], undefined>, { count: number; points: number }>();
  for (const item of state.inventory) {
    if (item.color === "BLACK") continue;
    const color = item.color as Exclude<Action["color"], undefined>;
    const current = grouped.get(color) ?? { count: 0, points: 0 };
    current.count += 1;
    current.points += config.map.branches[item.sourceBranch].resource_points;
    grouped.set(color, current);
  }

  let bestColor: Exclude<Action["color"], undefined> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [color, stats] of grouped) {
    const zoneNode = config.map.colorZoneNodeIds[color];
    const travel = travelSeconds(router, state.current_node, zoneNode) + config.robot.drop_s;
    const score = (stats.points + stats.count * 0.25) / Math.max(0.001, travel);
    if (score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }
  return bestColor ? { type: "DROP_RESOURCE", color: bestColor } : { type: "END_ROUND" };
}

function chooseNextLocked(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  blockedBranches: BranchId[] = []
): BranchId | null {
  let best: { branchId: BranchId; score: number } | null = null;
  for (const branchId of BRANCHES) {
    if (state.locks_cleared[branchId]) continue;
    if (state.holding_locks_for_branches.includes(branchId)) continue;
    if (blockedBranches.includes(branchId)) continue;
    const branch = config.map.branches[branchId];
    const lockNode = branch.lock_node;
    const toLock = travelSeconds(router, state.current_node, lockNode);
    const blackZone = nearestBlackZone(router, lockNode, config.map.blackZoneIds);
    const toBlack = travelSeconds(router, lockNode, blackZone);
    const totalTime = toLock + config.robot.pickup_s + toBlack + config.robot.drop_s;
    const value = branch.resource_points * 2;
    const score = value / Math.max(0.001, totalTime);
    if (!best || score > best.score) {
      best = { branchId, score };
    }
  }
  return best?.branchId ?? null;
}

function shouldChainSecondLockBeforeDrop(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  heldBranch: BranchId,
  candidateBranch: BranchId
): boolean {
  const blackZones = config.map.blackZoneIds;
  const candidateLockNode = config.map.branches[candidateBranch].lock_node;
  const dropNowZone = nearestBlackZone(router, state.current_node, blackZones);
  const candidateDropZone = nearestBlackZone(router, candidateLockNode, blackZones);

  const curToBlack = travelSeconds(router, state.current_node, dropNowZone);
  const blackToCandidate = travelSeconds(router, dropNowZone, candidateLockNode);
  const candidateToBlack = travelSeconds(router, candidateLockNode, candidateDropZone);
  const curToCandidate = travelSeconds(router, state.current_node, candidateLockNode);

  const dropNowThenFetchSecond =
    curToBlack +
    config.robot.drop_s +
    blackToCandidate +
    config.robot.pickup_s +
    candidateToBlack +
    config.robot.drop_s;

  const pickSecondThenDropBoth =
    curToCandidate +
    config.robot.pickup_s +
    candidateToBlack +
    config.robot.drop_s +
    config.robot.drop_s;

  return pickSecondThenDropBoth < dropNowThenFetchSecond || heldBranch !== candidateBranch;
}

function maybeReturnOrEnd(state: RoundState, config: SimulationConfig): Action {
  if (state.placed_resources.length === 8 && state.current_node !== config.map.startNodeId) {
    return { type: "RETURN_START" };
  }
  return { type: "END_ROUND" };
}

function revealPickedSlotColor(note: string | undefined): Exclude<ResourceColor, "BLACK"> | null {
  if (!note?.startsWith("picked_")) return null;
  const color = note.slice("picked_".length) as ResourceColor;
  if (color === "BLACK") return null;
  return color;
}

function filterCandidateIdsByKnownSlots(knownSlots: PolicyKnownSlots, candidateIds: number[]): number[] {
  return candidateIds.filter((layoutId) => {
    const layout = LEGAL_LAYOUTS[layoutId];
    return BRANCHES.every((branch) => {
      const [slot1, slot2] = knownSlots[branch];
      if (slot1 !== "UNKNOWN" && layout.slots[branch][0] !== slot1) return false;
      if (slot2 !== "UNKNOWN" && layout.slots[branch][1] !== slot2) return false;
      return true;
    });
  });
}

function inferKnownSlotsFromCandidates(knownSlots: PolicyKnownSlots, candidateIds: number[]): PolicyKnownSlots {
  const inferred = cloneKnownSlots(knownSlots);
  if (candidateIds.length === 0) return inferred;
  for (const branch of BRANCHES) {
    for (const slotIndex of [0, 1] as const) {
      if (inferred[branch][slotIndex] !== "UNKNOWN") continue;
      const candidateColor = LEGAL_LAYOUTS[candidateIds[0]].slots[branch][slotIndex];
      if (candidateIds.every((layoutId) => LEGAL_LAYOUTS[layoutId].slots[branch][slotIndex] === candidateColor)) {
        inferred[branch][slotIndex] = candidateColor;
      }
    }
  }
  return inferred;
}

function expectedZoneTravelForUnknownSlot(
  branchId: BranchId,
  slotIndex: 0 | 1,
  slotNodeId: string,
  config: SimulationConfig,
  router: GraphRouter,
  candidateIds: number[] | null
): number {
  if (!candidateIds || candidateIds.length === 0) return 0;
  const counts = new Map<Exclude<ResourceColor, "BLACK">, number>();
  for (const layoutId of candidateIds) {
    const color = LEGAL_LAYOUTS[layoutId].slots[branchId][slotIndex];
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let weighted = 0;
  for (const [color, count] of counts) {
    weighted +=
      (count / candidateIds.length) *
      (travelSeconds(router, slotNodeId, config.map.colorZoneNodeIds[color]) + config.robot.drop_s);
  }
  return weighted;
}

function expectedInformationGain(branchId: BranchId, slotIndex: 0 | 1, candidateIds: number[] | null): number {
  if (!candidateIds || candidateIds.length <= 1) return 0;
  const partitions = new Map<Exclude<ResourceColor, "BLACK">, number>();
  for (const layoutId of candidateIds) {
    const color = LEGAL_LAYOUTS[layoutId].slots[branchId][slotIndex];
    partitions.set(color, (partitions.get(color) ?? 0) + 1);
  }
  const total = candidateIds.length;
  const expectedRemaining = [...partitions.values()].reduce((sum, size) => sum + (size / total) * size, 0);
  return total - expectedRemaining;
}

function scoreResourcePickup(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  branchId: BranchId,
  slotNodeId: string,
  knownSlots: PolicyKnownSlots,
  candidateIds: number[] | null,
  flavor: PolicyFlavor
): number {
  const toSlot = travelSeconds(router, state.current_node, slotNodeId) + config.robot.pickup_s;
  const slotIndex = slotNodeId.endsWith("_1") ? 0 : 1;
  const knownColor = knownSlots[branchId][slotIndex];
  const branchPoints = config.map.branches[branchId].resource_points;
  const slotOrderBonus = slotIndex === 0 ? 4 : 1.5;

  if (knownColor !== "UNKNOWN") {
    const toZone = travelSeconds(router, slotNodeId, config.map.colorZoneNodeIds[knownColor]) + config.robot.drop_s;
    return (branchPoints + 5 + slotOrderBonus) / Math.max(0.001, toSlot + toZone);
  }

  const unknownBase = (branchPoints + slotOrderBonus) / Math.max(0.001, toSlot);
  if (flavor === "observed") {
    return unknownBase;
  }

  const expectedTravel = expectedZoneTravelForUnknownSlot(branchId, slotIndex, slotNodeId, config, router, candidateIds);
  const infoGain = expectedInformationGain(branchId, slotIndex, candidateIds);
  if (flavor === "deductive") {
    return unknownBase - expectedTravel * 0.01 + infoGain * 0.04;
  }
  return unknownBase - expectedTravel * 0.008 + infoGain * 0.08;
}

function chooseNextResourcePickup(
  state: RoundState,
  config: SimulationConfig,
  router: GraphRouter,
  knownSlots: PolicyKnownSlots,
  candidateIds: number[] | null,
  flavor: PolicyFlavor
): Action | null {
  let best: { action: Action; score: number } | null = null;
  for (const branchId of BRANCHES) {
    if (!state.locks_cleared[branchId]) continue;
    const pending = pendingSlotsForBranch(state, config, branchId);
    for (const slotNodeId of pending) {
      const [slot1, slot2] = config.map.branches[branchId].resource_slot_nodes;
      if (slotNodeId === slot2 && !state.picked_slots[slot1]) continue;
      const score = scoreResourcePickup(state, config, router, branchId, slotNodeId, knownSlots, candidateIds, flavor);
      if (!best || score > best.score) {
        best = { action: { type: "PICK_RESOURCE", slotNodeId, branchId }, score };
      }
    }
  }
  return best?.action ?? null;
}

function createRuntime(deductive: boolean): PostPickupRuntime {
  return {
    knownSlots: createUnknownKnownSlots(),
    candidateIds: deductive ? LEGAL_LAYOUTS.map((layout) => layout.id) : null,
    lastNotes: [],
    shouldFinishCheapRemainingCargo: false
    ,
    cheapRemainingCargoColor: null
  };
}

function updateRuntimeKnowledge(runtime: PostPickupRuntime, deductive: boolean): void {
  if (!deductive || runtime.candidateIds === null) return;
  runtime.candidateIds = filterCandidateIdsByKnownSlots(runtime.knownSlots, runtime.candidateIds);
  runtime.knownSlots = inferKnownSlotsFromCandidates(runtime.knownSlots, runtime.candidateIds);
}

function buildSnapshot(
  state: RoundState,
  runtime: PostPickupRuntime,
  action: Action,
  notes: string[],
  flavor: PolicyFlavor
): PolicyStatusSnapshot {
  const candidateCount = flavor === "observed" ? null : runtime.candidateIds?.length ?? null;
  return {
    current_step: describeAction(action),
    next_step: "Re-evaluate after current step",
    holding: holdingSummary(state),
    knowledge_summary: formatKnowledgeSummary(runtime.knownSlots, flavor),
    candidate_count: candidateCount,
    layout_locked: flavor === "observed" ? false : candidateCount === 1,
    policy_notes: [...notes],
    known_slots: cloneKnownSlots(runtime.knownSlots)
  };
}

function chooseObservedOrDeductiveBusAction(
  state: RoundState,
  _observation: Observation,
  config: SimulationConfig,
  runtime: PostPickupRuntime,
  flavor: "observed" | "deductive"
): { action: Action; notes: string[] } {
  const router = new GraphRouter(config.map, config.robot);
  const held = state.holding_locks_for_branches;
  const immediateDrop = dropColorAtCurrentZone(state, config);
  const cheapRemainingCargoThresholdS = 14;

  if (held.length > 0) {
    if (config.map.blackZoneIds.includes(state.current_node)) {
      return {
        action: { type: "DROP_LOCK", branchId: held[0] },
        notes: ["Post-pickup bus: flush held locks at the black zone"]
      };
    }
    if (
      held.length === 1 &&
      state.inventory.length === 0 &&
      config.robot.carry_capacity >= 2 &&
      held.length < config.robot.carry_capacity
    ) {
      const candidate = chooseNextLocked(state, config, router, held);
      if (candidate && shouldChainSecondLockBeforeDrop(state, config, router, held[0], candidate)) {
        return {
          action: { type: "PICK_LOCK", branchId: candidate },
          notes: ["Post-pickup bus: chain another lock before first black-zone drop"]
        };
      }
    }
    return {
      action: { type: "DROP_LOCK", branchId: held[0] },
      notes: ["Post-pickup bus: deposit held lock to unlock branch access"]
    };
  }

  if (immediateDrop) {
    return { action: immediateDrop, notes: ["Post-pickup bus: immediate drop at matching color zone"] };
  }

  if ((flavor === "observed" || flavor === "deductive") && runtime.shouldFinishCheapRemainingCargo && state.inventory.length === 1) {
    const remainingColor = state.inventory[0].color;
    if (remainingColor !== "BLACK") {
      const remainingDropCost =
        travelSeconds(router, state.current_node, config.map.colorZoneNodeIds[remainingColor]) + config.robot.drop_s;
      if (remainingDropCost <= cheapRemainingCargoThresholdS) {
        runtime.shouldFinishCheapRemainingCargo = false;
        runtime.cheapRemainingCargoColor = null;
        return {
          action: { type: "DROP_RESOURCE", color: remainingColor },
          notes: [
            flavor === "deductive"
              ? "Post-pickup deductive bus: finish cheap remaining carried color before opening new work"
              : "Post-pickup bus: finish cheap remaining carried color before opening new work"
          ]
        };
      }
    }
    runtime.shouldFinishCheapRemainingCargo = false;
    runtime.cheapRemainingCargoColor = null;
  }

  const nextLocked = chooseNextLocked(state, config, router);
  if (nextLocked) {
    return {
      action: { type: "PICK_LOCK", branchId: nextLocked },
      notes: ["Post-pickup bus: keep unlocking high-value branches before harvest"]
    };
  }

  if (state.inventory.length >= config.robot.carry_capacity) {
    return {
      action: chooseDropColor(state, config, router),
      notes: ["Post-pickup bus: cargo full, convert known carried colors"]
    };
  }

  const nextPick = chooseNextResourcePickup(state, config, router, runtime.knownSlots, runtime.candidateIds, flavor);
  if (nextPick) {
    return {
      action: nextPick,
      notes: flavor === "observed"
        ? ["Post-pickup bus: pick next resource using travel, slot order, and branch value only"]
        : ["Post-pickup deductive bus: pick next resource using travel plus candidate-aware expectations"]
    };
  }

  if (state.inventory.length > 0) {
    return {
      action: chooseDropColor(state, config, router),
      notes: ["Post-pickup bus: no better pickup remains, deliver carried resources"]
    };
  }

  if (state.placed_resources.length === 8) {
    return { action: maybeReturnOrEnd(state, config), notes: ["Post-pickup bus: finish the round"] };
  }

  return { action: { type: "END_ROUND" }, notes: ["Post-pickup bus: no legal progress remains"] };
}

function chooseHybridAction(
  state: RoundState,
  _observation: Observation,
  config: SimulationConfig,
  runtime: PostPickupRuntime
): { action: Action; notes: string[] } {
  const router = new GraphRouter(config.map, config.robot);
  const held = state.holding_locks_for_branches;
  const immediateDrop = dropColorAtCurrentZone(state, config);
  const currentLoad = state.holding_locks_for_branches.length + state.inventory.length;
  const cheapRemainingCargoThresholdS = 14;

  if (held.length > 0 && config.map.blackZoneIds.includes(state.current_node)) {
    return {
      action: { type: "DROP_LOCK", branchId: held[0] },
      notes: ["Hybrid: flush all held locks before leaving the black zone"]
    };
  }

  if (
    held.length === 1 &&
    state.inventory.length === 0 &&
    config.robot.carry_capacity >= 2 &&
    held.length < config.robot.carry_capacity
  ) {
    const candidate = chooseNextLocked(state, config, router, held);
    if (candidate && shouldChainSecondLockBeforeDrop(state, config, router, held[0], candidate)) {
      return {
        action: { type: "PICK_LOCK", branchId: candidate },
        notes: ["Hybrid: batch another lock before committing to black-zone drop"]
      };
    }
  }

  if (held.length > 0) {
    return {
      action: { type: "DROP_LOCK", branchId: held[0] },
      notes: ["Hybrid: unlock branch access before more harvesting"]
    };
  }

  if (immediateDrop) {
    return { action: immediateDrop, notes: ["Hybrid: immediate conversion at matching color zone"] };
  }

  if (currentLoad >= config.robot.carry_capacity && state.inventory.length > 0) {
    return {
      action: chooseDropColor(state, config, router),
      notes: ["Hybrid: cargo full, convert carried resources before any new pickup"]
    };
  }

  if (state.placed_resources.length === 8 && state.inventory.length === 0) {
    return { action: maybeReturnOrEnd(state, config), notes: ["Hybrid: round complete, return home"] };
  }

  const actions: Array<{ action: Action; score: number; note: string }> = [];
  const nextLocked = currentLoad < config.robot.carry_capacity ? chooseNextLocked(state, config, router) : null;
  if (nextLocked) {
    const lockNode = config.map.branches[nextLocked].lock_node;
    const toLock = travelSeconds(router, state.current_node, lockNode) + config.robot.pickup_s;
    actions.push({
      action: { type: "PICK_LOCK", branchId: nextLocked },
      score: (config.map.branches[nextLocked].resource_points * 1.8 + 2) / Math.max(0.001, toLock),
      note: "Hybrid: value-of-information still favors opening another branch"
    });
  }

  if (state.inventory.length > 0) {
    const drop = chooseDropColor(state, config, router);
    const color = drop.color!;
    const zoneNode = config.map.colorZoneNodeIds[color];
    const toZone = travelSeconds(router, state.current_node, zoneNode) + config.robot.drop_s;
    const carriedPoints = state.inventory
      .filter((item) => item.color === color)
      .reduce((sum, item) => sum + config.map.branches[item.sourceBranch].resource_points, 0);
    actions.push({
      action: drop,
      score:
        (carriedPoints + 1.5) / Math.max(0.001, toZone) +
        (
          runtime.shouldFinishCheapRemainingCargo &&
          state.inventory.length === 1 &&
          runtime.cheapRemainingCargoColor === color &&
          toZone <= cheapRemainingCargoThresholdS
        ? 3
        : 0
        ),
      note:
        runtime.shouldFinishCheapRemainingCargo &&
        state.inventory.length === 1 &&
        runtime.cheapRemainingCargoColor === color &&
        toZone <= cheapRemainingCargoThresholdS
          ? "Hybrid: finish cheap remaining cargo now before reopening work"
          : "Hybrid: converting carried resources now beats more exploration"
    });
  }

  if (currentLoad < config.robot.carry_capacity) {
    const nextPick = chooseNextResourcePickup(state, config, router, runtime.knownSlots, runtime.candidateIds, "hybrid");
    if (nextPick?.branchId && nextPick.slotNodeId) {
      const slotIndex = nextPick.slotNodeId.endsWith("_1") ? 0 : 1;
      const baseScore = scoreResourcePickup(
        state,
        config,
        router,
        nextPick.branchId,
        nextPick.slotNodeId,
        runtime.knownSlots,
        runtime.candidateIds,
        "hybrid"
      );
      const infoGain = expectedInformationGain(nextPick.branchId, slotIndex, runtime.candidateIds);
      actions.push({
        action: nextPick,
        score: baseScore + infoGain * 0.05 + (slotIndex === 0 ? 0.8 : 0.2),
        note: "Hybrid: bounded info-aware harvest beats more lock clearing"
      });
    }
  }

  if (actions.length === 0) {
    return { action: { type: "END_ROUND" }, notes: ["Hybrid: no legal progress remains"] };
  }

  actions.sort((a, b) => b.score - a.score);
  return { action: actions[0].action, notes: [actions[0].note] };
}

function createPostPickupPolicy(name: string, flavor: PolicyFlavor): StrategyPolicy {
  const deductive = flavor !== "observed";
  let runtime: PostPickupRuntime | null = null;

  function ensureRuntime(state: RoundState): PostPickupRuntime {
    if (!runtime || state.time_elapsed_s === 0) {
      runtime = createRuntime(deductive);
    }
    return runtime;
  }

  function decide(state: RoundState, observation: Observation, config: SimulationConfig): PolicyDecision {
    const currentRuntime = ensureRuntime(state);
    const choice =
      flavor === "hybrid"
        ? chooseHybridAction(state, observation, config, currentRuntime)
        : chooseObservedOrDeductiveBusAction(state, observation, config, currentRuntime, flavor);
    return {
      action: choice.action,
      snapshot: buildSnapshot(state, currentRuntime, choice.action, choice.notes, flavor)
    };
  }

  return {
    name,
    nextAction(state, observation, config) {
      return decide(state, observation, config).action;
    },
    decide,
    onTraceStep(state, event) {
      const currentRuntime = ensureRuntime(state);
      currentRuntime.lastNotes = [];
      currentRuntime.shouldFinishCheapRemainingCargo = Boolean(
        (flavor === "observed" || flavor === "deductive" || flavor === "hybrid") &&
        event.action.type === "DROP_RESOURCE" &&
        state.inventory.length === 1
      );
      currentRuntime.cheapRemainingCargoColor =
        currentRuntime.shouldFinishCheapRemainingCargo && state.inventory[0]?.color !== "BLACK"
          ? (state.inventory[0].color as Exclude<ResourceColor, "BLACK">)
          : null;

      const color = revealPickedSlotColor(event.note);
      if (color && event.action.type === "PICK_RESOURCE" && event.action.branchId && event.action.slotNodeId) {
        const slotIndex = event.action.slotNodeId.endsWith("_1") ? 0 : 1;
        currentRuntime.knownSlots[event.action.branchId][slotIndex] = color;
        updateRuntimeKnowledge(currentRuntime, deductive);
        currentRuntime.lastNotes.push(
          `Observed ${event.action.branchId} slot ${slotIndex + 1} = ${color}`
        );
        if (deductive && currentRuntime.candidateIds?.length === 1) {
          currentRuntime.lastNotes.push("Candidate set collapsed to a single legal layout");
        }
      }

      if (currentRuntime.lastNotes.length === 0 && event.note) {
        currentRuntime.lastNotes.push(event.note);
      }

      return buildSnapshot(state, currentRuntime, event.action, currentRuntime.lastNotes, flavor);
    }
  };
}

export const BusRevealedAfterPickupPolicy = createPostPickupPolicy("Bus_RevealedAfterPickup", "observed");
export const BusRevealedAfterPickupDeductivePolicy = createPostPickupPolicy(
  "Bus_RevealedAfterPickup_Deductive",
  "deductive"
);
export const InferenceBusHybridPolicy = createPostPickupPolicy("Inference_BusHybrid", "hybrid");
