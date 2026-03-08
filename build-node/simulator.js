import { randomizeRound } from "./randomization";
import { GraphRouter } from "./router";
const BRANCHES = ["RED", "YELLOW", "BLUE", "GREEN"];
function createInitialState(config, seed) {
    const randomization = randomizeRound(seed);
    return {
        current_node: config.map.startNodeId,
        branch_to_resources: randomization.branch_to_resources,
        locks_cleared: { RED: false, YELLOW: false, BLUE: false, GREEN: false },
        picked_slots: {},
        inventory: [],
        holding_lock_for_branch: null,
        placed_resources: [],
        score: 0,
        time_elapsed_s: 0,
        started_navigation: false,
        reached_main_junction: false,
        completed: false,
        returned_to_start: false
    };
}
function observationOf(state, timeout) {
    const unlocked_branches = BRANCHES.filter((b) => state.locks_cleared[b]);
    const locked_branches = BRANCHES.filter((b) => !state.locks_cleared[b]);
    return {
        remaining_time_s: Math.max(0, timeout - state.time_elapsed_s),
        unlocked_branches,
        locked_branches,
        inventory_count: state.inventory.length,
        all_resources_delivered: state.placed_resources.length === 8
    };
}
function addTrace(trace, action, fromNode, toNode, path, segment_time_s, state, note) {
    trace.push({
        action,
        fromNode,
        toNode,
        path,
        segment_time_s,
        total_time_s: state.time_elapsed_s,
        score_after: state.score,
        note
    });
}
function applyTimeout(state, config) {
    if (state.time_elapsed_s > config.timeout_s) {
        state.time_elapsed_s = config.timeout_s;
        state.completed = true;
        return true;
    }
    return false;
}
function moveTo(state, targetNode, router, config, trace, sourceAction) {
    if (state.current_node === targetNode)
        return false;
    const pathResult = router.shortestPath(state.current_node, targetNode);
    const fromNode = state.current_node;
    state.current_node = targetNode;
    state.time_elapsed_s += pathResult.cost_s;
    if (!state.started_navigation && fromNode === config.map.startNodeId && targetNode !== config.map.startNodeId) {
        state.score += config.navigation_bonus.leave_start;
        state.started_navigation = true;
    }
    if (!state.reached_main_junction && pathResult.path.includes(config.map.mainJunctionId)) {
        state.score += config.navigation_bonus.reach_main_junction;
        state.reached_main_junction = true;
    }
    if (state.current_node === config.map.startNodeId) {
        state.returned_to_start = true;
    }
    const timedOut = applyTimeout(state, config);
    addTrace(trace, sourceAction, fromNode, targetNode, pathResult.path, pathResult.cost_s, state, timedOut ? "timeout" : undefined);
    return timedOut;
}
function branchFromSlotNode(graph, slotNodeId) {
    const node = graph.nodes[slotNodeId];
    if (!node)
        return null;
    return node.meta?.branchId ?? null;
}
function checkFullCompletion(state, config) {
    const allLocks = BRANCHES.every((b) => state.locks_cleared[b]);
    const allResources = state.placed_resources.length === 8;
    if (allLocks && allResources && state.current_node === config.map.startNodeId && state.time_elapsed_s <= config.timeout_s) {
        if (!state.completed) {
            state.score += config.return_bonus;
        }
        state.completed = true;
        state.returned_to_start = true;
    }
}
export function simulateRound(config, policy, seed) {
    const state = createInitialState(config, seed);
    const router = new GraphRouter(config.map, config.robot);
    const trace = [];
    const legality_violations = [];
    const maxSteps = 500;
    for (let steps = 0; steps < maxSteps && !state.completed; steps += 1) {
        if (state.time_elapsed_s >= config.timeout_s) {
            state.completed = true;
            break;
        }
        const observation = observationOf(state, config.timeout_s);
        const action = policy.nextAction(state, observation, config);
        const fromNode = state.current_node;
        if (action.type === "END_ROUND") {
            state.completed = true;
            addTrace(trace, action, fromNode, state.current_node, [state.current_node], 0, state, "policy_end");
            break;
        }
        if (action.type === "RETURN_START") {
            if (moveTo(state, config.map.startNodeId, router, config, trace, action))
                break;
            checkFullCompletion(state, config);
            continue;
        }
        if (action.type === "MOVE_TO") {
            if (!action.targetNodeId || !config.map.nodes[action.targetNodeId]) {
                legality_violations.push("MOVE_TO without valid targetNodeId");
                addTrace(trace, action, fromNode, fromNode, [fromNode], 0, state, "invalid_move_target");
                continue;
            }
            if (moveTo(state, action.targetNodeId, router, config, trace, action))
                break;
            checkFullCompletion(state, config);
            continue;
        }
        if (action.type === "PICK_LOCK") {
            const branchId = action.branchId;
            if (!branchId) {
                legality_violations.push("PICK_LOCK missing branchId");
                continue;
            }
            const branch = config.map.branches[branchId];
            if (moveTo(state, branch.lock_node, router, config, trace, action))
                break;
            if (state.locks_cleared[branchId]) {
                legality_violations.push(`PICK_LOCK attempted on cleared branch ${branchId}`);
                continue;
            }
            if (state.holding_lock_for_branch !== null) {
                legality_violations.push("PICK_LOCK attempted while already holding a lock");
                continue;
            }
            state.holding_lock_for_branch = branchId;
            state.time_elapsed_s += config.robot.pickup_s;
            state.score += config.lock_points.grip;
            if (applyTimeout(state, config))
                break;
            addTrace(trace, action, branch.lock_node, branch.lock_node, [branch.lock_node], config.robot.pickup_s, state, "lock_gripped");
            continue;
        }
        if (action.type === "DROP_LOCK") {
            const branchId = action.branchId ?? state.holding_lock_for_branch;
            if (moveTo(state, config.map.blackZoneId, router, config, trace, action))
                break;
            if (!branchId || state.holding_lock_for_branch !== branchId) {
                legality_violations.push("DROP_LOCK attempted without matching held lock");
                continue;
            }
            state.holding_lock_for_branch = null;
            state.locks_cleared[branchId] = true;
            state.time_elapsed_s += config.robot.drop_s;
            state.score += config.lock_points.place;
            if (applyTimeout(state, config))
                break;
            addTrace(trace, action, config.map.blackZoneId, config.map.blackZoneId, [config.map.blackZoneId], config.robot.drop_s, state, "lock_deposited");
            continue;
        }
        if (action.type === "PICK_RESOURCE") {
            const slotNodeId = action.slotNodeId;
            if (!slotNodeId) {
                legality_violations.push("PICK_RESOURCE missing slotNodeId");
                continue;
            }
            if (moveTo(state, slotNodeId, router, config, trace, action))
                break;
            const branchId = branchFromSlotNode(config.map, slotNodeId);
            if (!branchId) {
                legality_violations.push(`PICK_RESOURCE invalid slot ${slotNodeId}`);
                continue;
            }
            if (!config.map.branches[branchId].resource_slot_nodes.includes(slotNodeId)) {
                legality_violations.push(`PICK_RESOURCE non-resource slot ${slotNodeId}`);
                continue;
            }
            if (!state.locks_cleared[branchId]) {
                legality_violations.push(`PICK_RESOURCE before unlock from ${branchId}`);
                continue;
            }
            if (state.picked_slots[slotNodeId]) {
                legality_violations.push(`PICK_RESOURCE already picked ${slotNodeId}`);
                continue;
            }
            if (state.inventory.length >= config.robot.carry_capacity) {
                legality_violations.push("PICK_RESOURCE capacity exceeded");
                continue;
            }
            const slotIndex = config.map.nodes[slotNodeId].meta?.slotIndex;
            if (!slotIndex || slotIndex < 1 || slotIndex > 2) {
                legality_violations.push(`PICK_RESOURCE slot index invalid ${slotNodeId}`);
                continue;
            }
            const color = state.branch_to_resources[branchId][slotIndex - 1];
            if (color === "BLACK") {
                legality_violations.push(`PICK_RESOURCE black color invalid at ${slotNodeId}`);
                continue;
            }
            state.inventory.push({ color, sourceBranch: branchId });
            state.picked_slots[slotNodeId] = true;
            state.time_elapsed_s += config.robot.pickup_s;
            if (applyTimeout(state, config))
                break;
            addTrace(trace, action, slotNodeId, slotNodeId, [slotNodeId], config.robot.pickup_s, state, `picked_${color}`);
            continue;
        }
        if (action.type === "DROP_RESOURCE") {
            const color = action.color;
            if (!color) {
                legality_violations.push("DROP_RESOURCE missing color");
                continue;
            }
            const zone = config.map.colorZoneNodeIds[color];
            if (moveTo(state, zone, router, config, trace, action))
                break;
            const idx = state.inventory.findIndex((item) => item.color === color);
            if (idx < 0) {
                legality_violations.push(`DROP_RESOURCE color not in inventory ${color}`);
                continue;
            }
            const [item] = state.inventory.splice(idx, 1);
            const branch = config.map.branches[item.sourceBranch];
            state.placed_resources.push({ color: item.color, sourceBranch: item.sourceBranch });
            state.score += branch.resource_points;
            state.time_elapsed_s += config.robot.drop_s;
            if (applyTimeout(state, config))
                break;
            addTrace(trace, action, zone, zone, [zone], config.robot.drop_s, state, `dropped_${color}`);
            checkFullCompletion(state, config);
            continue;
        }
    }
    if (state.time_elapsed_s >= config.timeout_s) {
        state.time_elapsed_s = config.timeout_s;
        state.completed = true;
    }
    return {
        seed,
        state,
        trace,
        legality_violations,
        policy_name: policy.name
    };
}
export function createDefaultSimulationConfig(map) {
    return {
        map,
        robot: {
            carry_capacity: 2,
            pickup_s: 1.2,
            drop_s: 1,
            junction_decision_s: 0.2,
            speed_mm_s_by_line_type: {
                SOLID: 320,
                DASHED: 250,
                ZIGZAG: 220,
                SINE: 240
            },
            turn_penalty_s: {
                NONE: 0,
                LIGHT: 0.25,
                HEAVY: 0.6
            },
            recovery_profile: {
                line_lost_s: 1,
                recovery_s: 1.5
            }
        },
        timeout_s: 600,
        return_bonus: 40,
        navigation_bonus: {
            leave_start: 5,
            reach_main_junction: 10
        },
        lock_points: {
            grip: 10,
            place: 20
        }
    };
}
