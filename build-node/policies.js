const HIGH_VALUE_ORDER = ["YELLOW", "BLUE", "GREEN", "RED"];
const SAFE_ORDER = ["RED", "YELLOW", "BLUE", "GREEN"];
function pendingSlotsForBranch(state, config, branchId) {
    const slots = config.map.branches[branchId].resource_slot_nodes;
    return slots.filter((slot) => !state.picked_slots[slot]);
}
function allResourcesPicked(state, config) {
    return Object.values(config.map.branches).flatMap((b) => b.resource_slot_nodes).every((slot) => state.picked_slots[slot]);
}
function chooseNextLocked(state, order) {
    return order.find((b) => !state.locks_cleared[b]) ?? null;
}
function chooseDropColor(state) {
    const freq = new Map();
    for (const item of state.inventory) {
        freq.set(item.color, (freq.get(item.color) ?? 0) + 1);
    }
    const color = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { type: "DROP_RESOURCE", color };
}
function chooseNextPickFromOrder(state, config, order) {
    for (const branchId of order) {
        if (!state.locks_cleared[branchId])
            continue;
        const pending = pendingSlotsForBranch(state, config, branchId);
        if (pending.length > 0) {
            return { type: "PICK_RESOURCE", slotNodeId: pending[0], branchId };
        }
    }
    return null;
}
function maybeReturnOrEnd(state, config) {
    if (state.placed_resources.length === 8 && state.current_node !== config.map.startNodeId) {
        return { type: "RETURN_START" };
    }
    return { type: "END_ROUND" };
}
export const BaselineSingleCarryPolicy = {
    name: "Baseline_SingleCarry",
    nextAction(state, observation, config) {
        if (state.holding_lock_for_branch) {
            return { type: "DROP_LOCK", branchId: state.holding_lock_for_branch };
        }
        if (state.inventory.length > 0) {
            return { type: "DROP_RESOURCE", color: state.inventory[0].color };
        }
        const nextLocked = chooseNextLocked(state, SAFE_ORDER);
        if (nextLocked) {
            return { type: "PICK_LOCK", branchId: nextLocked };
        }
        const pick = chooseNextPickFromOrder(state, config, SAFE_ORDER);
        if (pick)
            return pick;
        if (allResourcesPicked(state, config) && state.inventory.length === 0) {
            return maybeReturnOrEnd(state, config);
        }
        if (observation.remaining_time_s < 10) {
            return { type: "END_ROUND" };
        }
        return { type: "END_ROUND" };
    }
};
export const BusRouteParametricPolicy = {
    name: "BusRoute_Parametric",
    nextAction(state, observation, config) {
        if (state.holding_lock_for_branch) {
            return { type: "DROP_LOCK", branchId: state.holding_lock_for_branch };
        }
        const nextLocked = chooseNextLocked(state, HIGH_VALUE_ORDER);
        if (nextLocked) {
            return { type: "PICK_LOCK", branchId: nextLocked };
        }
        if (state.inventory.length >= config.robot.carry_capacity) {
            return chooseDropColor(state);
        }
        const pick = chooseNextPickFromOrder(state, config, HIGH_VALUE_ORDER);
        if (pick) {
            return pick;
        }
        if (state.inventory.length > 0) {
            return chooseDropColor(state);
        }
        if (state.placed_resources.length === 8) {
            return maybeReturnOrEnd(state, config);
        }
        if (observation.remaining_time_s < 12) {
            return { type: "END_ROUND" };
        }
        return { type: "END_ROUND" };
    }
};
export const ValueAwareDeadlinePolicy = {
    name: "ValueAware_Deadline",
    nextAction(state, observation, config) {
        if (state.holding_lock_for_branch) {
            return { type: "DROP_LOCK", branchId: state.holding_lock_for_branch };
        }
        if (observation.remaining_time_s < 35) {
            if (state.inventory.length > 0) {
                const maxItem = state.inventory
                    .slice()
                    .sort((a, b) => config.map.branches[b.sourceBranch].resource_points - config.map.branches[a.sourceBranch].resource_points)[0];
                return { type: "DROP_RESOURCE", color: maxItem.color };
            }
            return state.placed_resources.length === 8 ? maybeReturnOrEnd(state, config) : { type: "END_ROUND" };
        }
        const remainingLocks = HIGH_VALUE_ORDER.filter((b) => !state.locks_cleared[b]);
        if (remainingLocks.length > 0) {
            const filtered = observation.remaining_time_s < 130 ? remainingLocks.filter((b) => config.map.branches[b].resource_points > 20) : remainingLocks;
            if (filtered.length > 0) {
                return { type: "PICK_LOCK", branchId: filtered[0] };
            }
        }
        if (state.inventory.length >= config.robot.carry_capacity) {
            return chooseDropColor(state);
        }
        const pick = chooseNextPickFromOrder(state, config, HIGH_VALUE_ORDER);
        if (pick)
            return pick;
        if (state.inventory.length > 0)
            return chooseDropColor(state);
        return maybeReturnOrEnd(state, config);
    }
};
export const AdaptiveSafePolicy = {
    name: "AdaptiveSafe",
    nextAction(state, observation, config) {
        const useSafe = observation.remaining_time_s > 300;
        if (useSafe) {
            return BaselineSingleCarryPolicy.nextAction(state, observation, config);
        }
        return ValueAwareDeadlinePolicy.nextAction(state, observation, config);
    }
};
export const ALL_POLICIES = [
    BaselineSingleCarryPolicy,
    BusRouteParametricPolicy,
    ValueAwareDeadlinePolicy,
    AdaptiveSafePolicy
];
