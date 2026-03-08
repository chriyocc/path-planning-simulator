import type { Graph, RobotProfile } from "./types";

export interface PathResult {
  path: string[];
  cost_s: number;
}

function edgeTimeSeconds(edge: Graph["edges"][number], robot: RobotProfile): number {
  const base = edge.distance_mm / robot.speed_mm_s_by_line_type[edge.line_type];
  return base + robot.turn_penalty_s[edge.turn_cost_class] + robot.junction_decision_s;
}

function dijkstra(graph: Graph, robot: RobotProfile, source: string): Record<string, PathResult> {
  const distances = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const queue = new Set<string>(Object.keys(graph.nodes));

  for (const nodeId of queue) {
    distances.set(nodeId, Number.POSITIVE_INFINITY);
    prev.set(nodeId, null);
  }
  distances.set(source, 0);

  while (queue.size > 0) {
    let u: string | null = null;
    let best = Number.POSITIVE_INFINITY;

    for (const nodeId of queue) {
      const d = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (d < best) {
        best = d;
        u = nodeId;
      }
    }

    if (u === null) break;
    queue.delete(u);

    for (const edge of graph.adjacency[u]) {
      const alt = (distances.get(u) ?? Number.POSITIVE_INFINITY) + edgeTimeSeconds(edge, robot);
      if (alt < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, alt);
        prev.set(edge.to, u);
      }
    }
  }

  const out: Record<string, PathResult> = {};
  for (const target of Object.keys(graph.nodes)) {
    const cost_s = distances.get(target) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(cost_s)) {
      out[target] = { path: [], cost_s };
      continue;
    }
    const rev: string[] = [];
    let cursor: string | null = target;
    while (cursor) {
      rev.push(cursor);
      cursor = prev.get(cursor) ?? null;
    }
    out[target] = { path: rev.reverse(), cost_s };
  }

  return out;
}

export class GraphRouter {
  private table: Record<string, Record<string, PathResult>> = {};

  constructor(private readonly graph: Graph, private readonly robot: RobotProfile) {
    for (const nodeId of Object.keys(graph.nodes)) {
      this.table[nodeId] = dijkstra(graph, robot, nodeId);
    }
  }

  shortestPath(from: string, to: string): PathResult {
    return this.table[from][to];
  }
}
