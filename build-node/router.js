function edgeTimeSeconds(edge, robot) {
    const base = edge.distance_mm / robot.speed_mm_s_by_line_type[edge.line_type];
    return base + robot.turn_penalty_s[edge.turn_cost_class] + robot.junction_decision_s;
}
function dijkstra(graph, robot, source) {
    const distances = new Map();
    const prev = new Map();
    const queue = new Set(Object.keys(graph.nodes));
    for (const nodeId of queue) {
        distances.set(nodeId, Number.POSITIVE_INFINITY);
        prev.set(nodeId, null);
    }
    distances.set(source, 0);
    while (queue.size > 0) {
        let u = null;
        let best = Number.POSITIVE_INFINITY;
        for (const nodeId of queue) {
            const d = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
            if (d < best) {
                best = d;
                u = nodeId;
            }
        }
        if (u === null)
            break;
        queue.delete(u);
        for (const edge of graph.adjacency[u]) {
            const alt = (distances.get(u) ?? Number.POSITIVE_INFINITY) + edgeTimeSeconds(edge, robot);
            if (alt < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
                distances.set(edge.to, alt);
                prev.set(edge.to, u);
            }
        }
    }
    const out = {};
    for (const target of Object.keys(graph.nodes)) {
        const cost_s = distances.get(target) ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(cost_s)) {
            out[target] = { path: [], cost_s };
            continue;
        }
        const rev = [];
        let cursor = target;
        while (cursor) {
            rev.push(cursor);
            cursor = prev.get(cursor) ?? null;
        }
        out[target] = { path: rev.reverse(), cost_s };
    }
    return out;
}
export class GraphRouter {
    graph;
    robot;
    table = {};
    constructor(graph, robot) {
        this.graph = graph;
        this.robot = robot;
        for (const nodeId of Object.keys(graph.nodes)) {
            this.table[nodeId] = dijkstra(graph, robot, nodeId);
        }
    }
    shortestPath(from, to) {
        return this.table[from][to];
    }
}
