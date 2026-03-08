import "./styles.css";
import {
  ALL_POLICIES,
  AdaptiveSafePolicy,
  buildGraph,
  createDefaultGraph,
  createDefaultSimulationConfig,
  estimateFirmwarePlan,
  generateFsmContractMarkdown,
  simulateBatch,
  simulateRound
} from "./index";
import type {
  BatchResult,
  BranchId,
  Edge,
  Graph,
  LineType,
  ResourceColor,
  SimulationConfig,
  SimulationResult,
  StrategyPolicy,
  TraceStep
} from "./types";

interface Point {
  x: number;
  y: number;
}

interface RobotPose extends Point {
  heading: number;
}

interface VisualState {
  inventory: ResourceColor[];
  holdingLockCount: number;
  locksPlaced: BranchId[];
  zonePlaced: Record<Exclude<ResourceColor, "BLACK">, number>;
  pickedSlots: Record<string, boolean>;
  elapsed_s: number;
}

const MAP_W_MM = 1500;
const MAP_H_MM = 2000;

let graph = createDefaultGraph();
const baseConfig = createDefaultSimulationConfig(graph);

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");

app.innerHTML = `
<div class="layout">
  <section class="board">
    <canvas id="map" width="900" height="1200"></canvas>
  </section>
  <aside class="panel">
    <h1>RoboSurvivor 2026</h1>
    <div class="controls">
      <label>Policy
        <select id="policy"></select>
      </label>
      <label>Seed
        <input id="seed" type="number" value="1" min="1" />
      </label>
      <label>Carry Capacity
        <input id="capacity" type="number" value="2" min="1" max="6" />
      </label>
      <label>Batch Runs
        <input id="runs" type="number" value="200" min="10" max="2000" />
      </label>
      <label>Playback Speed
        <input id="speed" type="range" min="0.2" max="2" step="0.05" value="0.35" />
      </label>
      <label>Speed Value
        <input id="speedValue" type="text" value="0.35x" readonly />
      </label>
    </div>
    <div class="row">
      <button id="runOne">Run Round</button>
      <button id="randomSeed">Randomize Seed + Run</button>
      <button id="play">Play Trace</button>
      <button id="runBatch">Run Batch</button>
    </div>
    <div class="row">
      <button id="exportRoute">Export route_table.json</button>
      <button id="exportPolicy">Export policy_rules.json</button>
      <button id="exportFsm">Export fsm_contract.md</button>
    </div>
    <div class="stat">Live Game Time<pre id="live"></pre></div>
    <div class="stat">Round Summary<pre id="summary"></pre></div>
    <div class="stat">Branch Randomization<pre id="randomization"></pre></div>
    <div class="stat">Policy Ranking (Batch)<pre id="batch"></pre></div>

    <div class="stat">Map Editor
      <div class="controls">
        <label>Edit Mode
          <select id="editMode">
            <option value="OFF">OFF</option>
            <option value="ON">ON</option>
          </select>
        </label>
        <label>Node
          <select id="nodeSelect"></select>
        </label>
        <label>Node X (mm)
          <input id="nodeX" type="number" min="0" max="1500" step="1" />
        </label>
        <label>Node Y (mm)
          <input id="nodeY" type="number" min="0" max="2000" step="1" />
        </label>
        <label>Edge
          <select id="edgeSelect"></select>
        </label>
        <label>Line Type
          <select id="lineType">
            <option value="SOLID">SOLID</option>
            <option value="DASHED">DASHED</option>
            <option value="ZIGZAG">ZIGZAG</option>
            <option value="SINE">SINE</option>
          </select>
        </label>
      </div>
      <div class="row">
        <button id="applyNode">Apply Node</button>
        <button id="applyEdge">Apply Edge</button>
        <button id="resetMap">Reset Map</button>
      </div>
      <pre id="editHelp">Tip: turn Edit Mode ON and drag nodes directly on canvas to edit lines.</pre>
    </div>
  </aside>
</div>
<div id="batchToast" class="toast hidden">Running batch simulation...</div>
`;

const canvas = document.getElementById("map") as HTMLCanvasElement;
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas context unavailable");
const ctx: CanvasRenderingContext2D = context;

const policySelect = document.getElementById("policy") as HTMLSelectElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const capacityInput = document.getElementById("capacity") as HTMLInputElement;
const runsInput = document.getElementById("runs") as HTMLInputElement;
const speedInput = document.getElementById("speed") as HTMLInputElement;
const speedValue = document.getElementById("speedValue") as HTMLInputElement;
const randomSeedBtn = document.getElementById("randomSeed") as HTMLButtonElement;
const runBatchBtn = document.getElementById("runBatch") as HTMLButtonElement;
const batchToast = document.getElementById("batchToast") as HTMLDivElement;

const summaryEl = document.getElementById("summary") as HTMLPreElement;
const batchEl = document.getElementById("batch") as HTMLPreElement;
const randomizationEl = document.getElementById("randomization") as HTMLPreElement;
const liveEl = document.getElementById("live") as HTMLPreElement;

const editModeSelect = document.getElementById("editMode") as HTMLSelectElement;
const nodeSelect = document.getElementById("nodeSelect") as HTMLSelectElement;
const nodeX = document.getElementById("nodeX") as HTMLInputElement;
const nodeY = document.getElementById("nodeY") as HTMLInputElement;
const edgeSelect = document.getElementById("edgeSelect") as HTMLSelectElement;
const lineTypeSelect = document.getElementById("lineType") as HTMLSelectElement;

ALL_POLICIES.forEach((policy) => {
  const opt = document.createElement("option");
  opt.value = policy.name;
  opt.textContent = policy.name;
  policySelect.appendChild(opt);
});
policySelect.value = AdaptiveSafePolicy.name;

let latestResult: SimulationResult | null = null;
let latestBatch: BatchResult[] = [];
let robotPose: RobotPose = { ...nodePoint(graph.startNodeId), heading: -Math.PI / 2 };
let visualState: VisualState = emptyVisualState();
let animationHandle = 0;
let draggedNodeId: string | null = null;

function emptyVisualState(): VisualState {
  return {
    inventory: [],
    holdingLockCount: 0,
    locksPlaced: [],
    zonePlaced: { RED: 0, YELLOW: 0, BLUE: 0, GREEN: 0 },
    pickedSlots: {},
    elapsed_s: 0
  };
}

function getPolicyByName(name: string): StrategyPolicy {
  return ALL_POLICIES.find((p) => p.name === name) ?? AdaptiveSafePolicy;
}

function cloneGraphForSimulation(g: Graph): Graph {
  const cloned = buildGraph({
    nodes: Object.values(g.nodes).map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined })),
    edges: g.edges.map((e) => ({ ...e })),
    branches: Object.values(g.branches).map((b) => ({ ...b, resource_slot_nodes: [...b.resource_slot_nodes] as [string, string] })),
    startNodeId: g.startNodeId,
    mainJunctionId: g.mainJunctionId,
    blackZoneIds: g.blackZoneIds,
    colorZoneNodeIds: { ...g.colorZoneNodeIds }
  });

  // Keep edge distances aligned with edited geometry.
  for (const edge of cloned.edges) {
    const a = cloned.nodes[edge.from];
    const b = cloned.nodes[edge.to];
    edge.distance_mm = Math.max(1, Math.hypot(a.x_mm - b.x_mm, a.y_mm - b.y_mm));
  }

  return buildGraph({
    nodes: Object.values(cloned.nodes),
    edges: cloned.edges,
    branches: Object.values(cloned.branches),
    startNodeId: cloned.startNodeId,
    mainJunctionId: cloned.mainJunctionId,
    blackZoneIds: cloned.blackZoneIds,
    colorZoneNodeIds: cloned.colorZoneNodeIds
  });
}

function configFromInputs(): SimulationConfig {
  const simGraph = cloneGraphForSimulation(graph);
  return {
    ...baseConfig,
    map: simGraph,
    robot: {
      ...baseConfig.robot,
      carry_capacity: Math.max(1, Number(capacityInput.value) || 1)
    }
  };
}

function mmToCanvas(x_mm: number, y_mm: number): Point {
  return {
    x: (x_mm / MAP_W_MM) * canvas.width,
    y: (y_mm / MAP_H_MM) * canvas.height
  };
}

function canvasToMm(x: number, y: number): Point {
  return {
    x: (x / canvas.width) * MAP_W_MM,
    y: (y / canvas.height) * MAP_H_MM
  };
}

function nodePoint(nodeId: string): Point {
  const node = graph.nodes[nodeId];
  return mmToCanvas(node.x_mm, node.y_mm);
}

function sampleSegment(start: Point, end: Point, lineType: LineType): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  if (lineType === "SOLID" || lineType === "DASHED") {
    return [start, end];
  }

  if (lineType === "ZIGZAG") {
    const count = 8;
    const amplitude = Math.min(14, len * 0.18);
    const pts: Point[] = [];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const baseX = start.x + dx * t;
      const baseY = start.y + dy * t;
      const off = i === 0 || i === count ? 0 : i % 2 === 0 ? -amplitude : amplitude;
      pts.push({ x: baseX + nx * off, y: baseY + ny * off });
    }
    return pts;
  }

  const count = 30;
  const amplitude = Math.min(16, len * 0.2);
  const pts: Point[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const baseX = start.x + dx * t;
    const baseY = start.y + dy * t;
    const off = Math.sin(t * Math.PI * 2) * amplitude;
    pts.push({ x: baseX + nx * off, y: baseY + ny * off });
  }
  return pts;
}

function findEdge(from: string, to: string): Edge | null {
  return graph.adjacency[from].find((e) => e.to === to) ?? null;
}

function drawPolyline(points: Point[], dashed: boolean): void {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = "#0f1620";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (dashed) ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const pt of points.slice(1)) {
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawRectMm(x_mm: number, y_mm: number, w_mm: number, h_mm: number, color: string, lineWidth = 3): void {
  const p = mmToCanvas(x_mm, y_mm);
  const w = (w_mm / MAP_W_MM) * canvas.width;
  const h = (h_mm / MAP_H_MM) * canvas.height;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(p.x, p.y, w, h);
  ctx.restore();
}

function drawCircleMm(x_mm: number, y_mm: number, r_mm: number, color: string): void {
  const p = mmToCanvas(x_mm, y_mm);
  const r = (r_mm / MAP_W_MM) * canvas.width;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawMapTemplate(): void {
  drawRectMm(2, 2, 1496, 1996, "#202020", 2); // outer bounds
  drawRectMm(100, 150, 1300, 800, "#202020", 4); // main central loop

  drawRectMm(425, 0, 650, 150, "#000000", 3); // Black Zone (Top Center)

  drawRectMm(400, 250, 300, 300, "#d8bb23", 4); // YELLOW Top-Left
  drawRectMm(800, 250, 300, 300, "#2e67d3", 4); // BLUE Top-Right
  drawRectMm(400, 550, 300, 300, "#d53f34", 4); // RED Bottom-Left
  drawRectMm(800, 550, 300, 300, "#2f9c54", 4); // GREEN Bottom-Right

  drawPolyline([mmToCanvas(550, 950), mmToCanvas(550, 1150)], false); // branch trunk
  drawPolyline([mmToCanvas(300, 1150), mmToCanvas(1250, 1150)], false); // bottom junction line
  
  // Connect the START point down at bottom left.
  drawPolyline([mmToCanvas(300, 1150), mmToCanvas(300, 1450)], false); // start path line
  drawRectMm(200, 1350, 200, 200, "#202020", 4); // start zone: 200x200 
}



  



function drawTrackLines(g: Graph): void {
  for (const edge of g.edges) {
    const from = nodePoint(edge.from);
    const to = nodePoint(edge.to);
    const points = sampleSegment(from, to, edge.line_type);
    drawPolyline(points, edge.line_type === "DASHED");
  }

  Object.values(g.nodes).forEach((node) => {
    const p = nodePoint(node.id);
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, node.kind === "JUNCTION" ? 4 : 2.8, 0, Math.PI * 2);
    ctx.fillStyle = "#222";
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.restore();

    if (editModeSelect.value === "ON") {
      ctx.save();
      ctx.fillStyle = "#111";
      ctx.font = "10px monospace";
      ctx.fillText(node.id, p.x + 6, p.y - 6);
      ctx.restore();
    }
  });
}

function resourceColorHex(color: Exclude<ResourceColor, "BLACK">): string {
  if (color === "RED") return "#d53f34";
  if (color === "YELLOW") return "#d8bb23";
  if (color === "BLUE") return "#2e67d3";
  return "#2f9c54";
}

function drawBottomResources(): void {
  const order: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
  const fallback: Record<BranchId, [Exclude<ResourceColor, "BLACK">, Exclude<ResourceColor, "BLACK">]> = {
    RED: ["RED", "GREEN"],
    YELLOW: ["YELLOW", "RED"],
    BLUE: ["BLUE", "YELLOW"],
    GREEN: ["GREEN", "BLUE"]
  };
  const random = latestResult?.state.branch_to_resources ?? fallback;

  order.forEach((branchId) => {
    const branch = graph.branches[branchId];
    const lockPt = nodePoint(branch.lock_node);
    const slots = branch.resource_slot_nodes;
    const colors = random[branchId];

    ctx.save();
    ctx.beginPath();
    ctx.arc(lockPt.x, lockPt.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#141414";
    ctx.fill();
    ctx.restore();

    slots.forEach((slotId, idx) => {
      const p = nodePoint(slotId);
      const color = colors[idx] as Exclude<ResourceColor, "BLACK">;
      const picked = Boolean(visualState.pickedSlots[slotId]);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fillStyle = picked ? "#f0eee6" : `${resourceColorHex(color)}44`;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = resourceColorHex(color);
      ctx.stroke();
      if (picked) {
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 5);
        ctx.moveTo(p.x + 5, p.y - 5);
        ctx.lineTo(p.x - 5, p.y + 5);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "#666";
        ctx.stroke();
      }
      ctx.restore();
    });
  });
}

function drawZoneCargoCounts(): void {
  const zoneCenters: Record<Exclude<ResourceColor, "BLACK">, Point> = {
    YELLOW: mmToCanvas(550, 400),
    BLUE: mmToCanvas(950, 400),
    RED: mmToCanvas(550, 700),
    GREEN: mmToCanvas(950, 700)
  };

  (Object.keys(zoneCenters) as Array<Exclude<ResourceColor, "BLACK">>).forEach((color) => {
    const count = visualState.zonePlaced[color];
    const c = zoneCenters[color];
    for (let i = 0; i < count; i += 1) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x - 22 + i * 15, c.y + 25, 5, 0, Math.PI * 2);
      ctx.fillStyle = resourceColorHex(color);
      ctx.fill();
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  });
}

function drawBlackZoneLocks(): void {
  const blackZonePt = nodePoint("BLACK_ZONE");
  const branchOrder: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
  const locksCount = visualState.locksPlaced.length;
  
  for (let i = 0; i < locksCount; i += 1) {
    const branchId = visualState.locksPlaced[i];
    const xOffset = (i - (locksCount - 1) / 2) * 18;
    ctx.save();
    ctx.beginPath();
    ctx.arc(blackZonePt.x + xOffset, blackZonePt.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#111111";
    ctx.fill();
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

function drawRobot(pose: RobotPose): void {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.heading);

  ctx.fillStyle = "#ff6a1f";
  ctx.strokeStyle = "#5b280a";
  ctx.lineWidth = 1.2;
  ctx.fillRect(-10, -16, 20, 32);
  ctx.strokeRect(-10, -16, 20, 32);

  // front marker
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(-6, -12);
  ctx.lineTo(6, -12);
  ctx.closePath();
  ctx.fillStyle = "#222";
  ctx.fill();

  // cargo visualization on top of robot body
  const slotX = [-6, 0, 6, -3, 3, 9];
  // Draw held lock(s) first.
  for (let i = 0; i < visualState.holdingLockCount; i += 1) {
    ctx.beginPath();
    const px = slotX[i] ?? 0;
    const py = 0 + Math.floor(i / 3) * 6;
    ctx.arc(px, py, 2.7, 0, Math.PI * 2);
    ctx.fillStyle = "#111111";
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // Draw colored resources
  visualState.inventory.forEach((color, idx) => {
    const slotIndex = idx + visualState.holdingLockCount;
    const px = slotX[slotIndex] ?? 0;
    const py = 0 + Math.floor(slotIndex / 3) * 6;
    ctx.beginPath();
    ctx.arc(px, py, 2.7, 0, Math.PI * 2);
    ctx.fillStyle = resourceColorHex(color as Exclude<ResourceColor, "BLACK">);
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });

  ctx.restore();
}

function drawMap(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawMapTemplate();
  drawTrackLines(graph);
  drawBottomResources();
  drawZoneCargoCounts();
  drawBlackZoneLocks();
  drawRobot(robotPose);
}

function summarizeResult(result: SimulationResult): void {
  const s = result.state;
  summaryEl.textContent = [
    `policy=${result.policy_name}`,
    `seed=${result.seed}`,
    `score=${s.score}`,
    `time=${s.time_elapsed_s.toFixed(2)}s`,
    `placed=${s.placed_resources.length}/8`,
    `returned=${s.returned_to_start}`,
    `violations=${result.legality_violations.length}`,
    `trace_steps=${result.trace.length}`
  ].join("\n");

  randomizationEl.textContent = Object.entries(s.branch_to_resources)
    .map(([branch, colors]) => `${branch}: ${colors.join(", ")}`)
    .join("\n");
  randomizationEl.textContent += `\nseed=${result.seed} (same seed => same placement)`;
}

function updateLivePanel(timeoutS: number): void {
  const remaining = Math.max(0, timeoutS - visualState.elapsed_s);
  liveEl.textContent = [
    `elapsed=${visualState.elapsed_s.toFixed(1)}s`,
    `remaining=${remaining.toFixed(1)}s`,
    `carrying=[locks=${visualState.holdingLockCount}, resources=${visualState.inventory.join(", ") || "empty"}]`,
    `zone_fill: R=${visualState.zonePlaced.RED} Y=${visualState.zonePlaced.YELLOW} B=${visualState.zonePlaced.BLUE} G=${visualState.zonePlaced.GREEN}`
  ].join("\n");
}

function summarizeBatch(items: BatchResult[]): void {
  if (items.length === 0) {
    batchEl.textContent = "(run batch to view ranking)";
    return;
  }
  batchEl.textContent = items
    .sort((a, b) => b.mean_score - a.mean_score)
    .map(
      (r, i) =>
        `${i + 1}. ${r.policy_name}\n  mean_score=${r.mean_score}\n  completion=${r.completion_rate}%\n  mean_time=${r.mean_time_s}s p50=${r.p50_time_s}s p90=${r.p90_time_s}s\n  violations=${r.violations_count}`
    )
    .join("\n\n");
}

function parsePickedColor(step: TraceStep, branchToResources: SimulationResult["state"]["branch_to_resources"]): ResourceColor | null {
  if (step.note?.startsWith("picked_")) {
    return step.note.replace("picked_", "").toUpperCase() as ResourceColor;
  }
  const slot = step.action.slotNodeId;
  if (!slot) return null;
  const node = graph.nodes[slot];
  const branchId = node?.meta?.branchId as BranchId | undefined;
  const slotIdx = node?.meta?.slotIndex;
  if (!branchId || !slotIdx || slotIdx < 1 || slotIdx > 2) return null;
  return branchToResources[branchId][slotIdx - 1];
}

function deriveVisualState(result: SimulationResult, stepIdx: number, progressInStep: number): VisualState {
  const v = emptyVisualState();
  let elapsed = 0;
  const heldLockBranches: BranchId[] = [];
  const locksPlaced: BranchId[] = [];
  const placedCounts: Record<string, number> = { RED: 0, YELLOW: 0, BLUE: 0, GREEN: 0 };

  function applyCompletedStep(step: TraceStep): void {
    if (step.note === "lock_gripped") {
      const branchId = step.action.branchId;
      if (branchId && !heldLockBranches.includes(branchId)) heldLockBranches.push(branchId);
      return;
    }

    if (step.note === "lock_deposited") {
      const branchId = step.action.branchId ?? heldLockBranches[0];
      if (branchId && !locksPlaced.includes(branchId)) locksPlaced.push(branchId);
      if (branchId) {
        const idx = heldLockBranches.indexOf(branchId);
        if (idx >= 0) heldLockBranches.splice(idx, 1);
      }
      return;
    }

    if (step.note?.startsWith("picked_")) {
      const c = parsePickedColor(step, result.state.branch_to_resources);
      if (c) v.inventory.push(c);
      if (step.action.slotNodeId) v.pickedSlots[step.action.slotNodeId] = true;
      return;
    }

    if (step.note?.startsWith("dropped_")) {
      const color = (step.action.color ?? (step.note?.replace("dropped_", "").toUpperCase() as ResourceColor)) as Exclude<ResourceColor, "BLACK">;
      const idx = v.inventory.indexOf(color);
      if (idx >= 0) v.inventory.splice(idx, 1);
      placedCounts[color] = (placedCounts[color] || 0) + 1;
    }
  }

  // Only process steps BEFORE the current step (not including current)
  for (let i = 0; i < stepIdx && i < result.trace.length; i += 1) {
    const step = result.trace[i];
    elapsed += step.segment_time_s;
    applyCompletedStep(step);
  }

  // Only process current step when progress >= 1 (fully complete)
  if (stepIdx < result.trace.length && progressInStep >= 1) {
    const step = result.trace[stepIdx];
    elapsed += step.segment_time_s;
    applyCompletedStep(step);
  }

  v.zonePlaced = placedCounts as VisualState["zonePlaced"];
  v.holdingLockCount = heldLockBranches.length;
  v.locksPlaced = locksPlaced;
  v.elapsed_s = elapsed;
  return v;
}

function runRound(): void {
  if (animationHandle) cancelAnimationFrame(animationHandle);
  const config = configFromInputs();
  const policy = getPolicyByName(policySelect.value);
  const seed = Math.max(1, Number(seedInput.value) || 1);
  const result = simulateRound(config, policy, seed);
  latestResult = result;
  const finalPt = mmToCanvas(
    result.state.current_node ? config.map.nodes[result.state.current_node].x_mm : graph.nodes[graph.startNodeId].x_mm,
    result.state.current_node ? config.map.nodes[result.state.current_node].y_mm : graph.nodes[graph.startNodeId].y_mm
  );
  robotPose = { ...finalPt, heading: robotPose.heading };
  // Use final state directly from simulation result
  visualState = {
    inventory: result.state.inventory.map(i => i.color),
    holdingLockCount: result.state.holding_locks_for_branches?.length ?? (result.state.holding_lock_for_branch ? 1 : 0),
    locksPlaced: (Object.keys(result.state.locks_cleared) as BranchId[]).filter(b => result.state.locks_cleared[b]),
    zonePlaced: { RED: 0, YELLOW: 0, BLUE: 0, GREEN: 0 },
    pickedSlots: { ...result.state.picked_slots },
    elapsed_s: result.state.time_elapsed_s
  };
  // Count placed resources
  for (const placed of result.state.placed_resources) {
    visualState.zonePlaced[placed.color]++;
  }
  updateLivePanel(config.timeout_s);
  drawMap();
  summarizeResult(result);
}

function pathToPoints(path: string[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const fromId = path[i];
    const toId = path[i + 1];
    const edge = findEdge(fromId, toId);
    const from = nodePoint(fromId);
    const to = nodePoint(toId);
    const seg = sampleSegment(from, to, edge?.line_type ?? "SOLID");
    if (out.length > 0) seg.shift();
    out.push(...seg);
  }
  return out;
}

function traceToPoses(trace: TraceStep[]): Array<RobotPose & { stepIdx: number; stepProgress: number }> {
  const poses: Array<RobotPose & { stepIdx: number; stepProgress: number }> = [];
  for (let stepIdx = 0; stepIdx < trace.length; stepIdx += 1) {
    const step = trace[stepIdx];
    if (step.path.length < 2) continue;
    const points = pathToPoints(step.path);
    const count = Math.max(points.length, 2);
    for (let i = 0; i < points.length; i += 1) {
      const cur = points[i];
      const next = points[Math.min(i + 1, points.length - 1)];
      const heading = Math.atan2(next.y - cur.y, next.x - cur.x) + Math.PI / 2;
      poses.push({ x: cur.x, y: cur.y, heading, stepIdx, stepProgress: i / (count - 1) });
    }
  }
  if (poses.length < 2) {
    return [{ ...robotPose, stepIdx: 0, stepProgress: 1 }];
  }
  return poses;
}

function playTrace(result: SimulationResult): void {
  if (animationHandle) cancelAnimationFrame(animationHandle);
  const poses = traceToPoses(result.trace);
  const simTotal = result.trace.reduce((acc, step) => acc + step.segment_time_s, 0);
  const speed = Number(speedInput.value) || 0.35;
  const msPerSimSecond = 420;
  const durationMs = Math.max(10000, (simTotal * msPerSimSecond) / speed);

  let start = 0;
  const frame = (ts: number) => {
    if (!start) start = ts;
    const t = Math.min(1, (ts - start) / durationMs);
    const idx = t * (poses.length - 1);
    const i = Math.floor(idx);
    const j = Math.min(i + 1, poses.length - 1);
    const a = poses[i];
    const b = poses[j];
    const lt = idx - i;

    robotPose = {
      x: a.x + (b.x - a.x) * lt,
      y: a.y + (b.y - a.y) * lt,
      heading: a.heading + (b.heading - a.heading) * lt
    };

    visualState = deriveVisualState(result, a.stepIdx, a.stepProgress);
    updateLivePanel(baseConfig.timeout_s);
    drawMap();

    if (t < 1) {
      animationHandle = requestAnimationFrame(frame);
    } else {
      visualState = deriveVisualState(result, result.trace.length - 1, 1);
      updateLivePanel(baseConfig.timeout_s);
      drawMap();
    }
  };

  animationHandle = requestAnimationFrame(frame);
}

function showBatchToast(show: boolean): void {
  batchToast.classList.toggle("hidden", !show);
}

async function runBatch(): Promise<void> {
  if (runBatchBtn.disabled) return;
  runBatchBtn.disabled = true;
  showBatchToast(true);
  // Yield one frame so the toast paints before heavy sync batch work starts.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const config = configFromInputs();
  const runs = Math.max(10, Number(runsInput.value) || 100);
  try {
    latestBatch = ALL_POLICIES.map((p) => simulateBatch(config, p, runs));
    summarizeBatch(latestBatch);
  } finally {
    showBatchToast(false);
    runBatchBtn.disabled = false;
  }
}

function download(name: string, content: string): void {
  const blob = new Blob([content], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function refreshMapEditorControls(): void {
  const currentNode = nodeSelect.value;
  nodeSelect.innerHTML = "";
  Object.keys(graph.nodes)
    .sort()
    .forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      nodeSelect.appendChild(opt);
    });
  nodeSelect.value = currentNode && graph.nodes[currentNode] ? currentNode : graph.startNodeId;

  const currentEdge = edgeSelect.value;
  edgeSelect.innerHTML = "";
  graph.edges.forEach((edge) => {
    const opt = document.createElement("option");
    opt.value = edge.id;
    opt.textContent = `${edge.id} (${edge.from} -> ${edge.to})`;
    edgeSelect.appendChild(opt);
  });
  edgeSelect.value = currentEdge && graph.edges.find((e) => e.id === currentEdge) ? currentEdge : graph.edges[0].id;

  const node = graph.nodes[nodeSelect.value];
  nodeX.value = String(Math.round(node.x_mm));
  nodeY.value = String(Math.round(node.y_mm));

  const edge = graph.edges.find((e) => e.id === edgeSelect.value);
  if (edge) {
    lineTypeSelect.value = edge.line_type;
  }
}

function rebuildGraphFromCurrent(): void {
  graph = buildGraph({
    nodes: Object.values(graph.nodes).map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined })),
    edges: graph.edges.map((e) => ({ ...e })),
    branches: Object.values(graph.branches).map((b) => ({ ...b, resource_slot_nodes: [...b.resource_slot_nodes] as [string, string] })),
    startNodeId: graph.startNodeId,
    mainJunctionId: graph.mainJunctionId,
    blackZoneIds: graph.blackZoneIds,
    colorZoneNodeIds: { ...graph.colorZoneNodeIds }
  });
}

function nearestNodeId(x: number, y: number): string | null {
  let bestId: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  Object.keys(graph.nodes).forEach((id) => {
    const p = nodePoint(id);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  });
  if (bestId && bestDist < 18) {
    return bestId;
  }
  return null;
}

speedInput.oninput = () => {
  speedValue.value = `${Number(speedInput.value).toFixed(2)}x`;
};

randomSeedBtn.onclick = () => {
  const seed = Math.floor(Math.random() * 1_000_000) + 1;
  seedInput.value = String(seed);
  runRound();
};

nodeSelect.onchange = () => {
  const n = graph.nodes[nodeSelect.value];
  nodeX.value = String(Math.round(n.x_mm));
  nodeY.value = String(Math.round(n.y_mm));
};

edgeSelect.onchange = () => {
  const edge = graph.edges.find((e) => e.id === edgeSelect.value);
  if (edge) lineTypeSelect.value = edge.line_type;
};

(document.getElementById("applyNode") as HTMLButtonElement).onclick = () => {
  const id = nodeSelect.value;
  const n = graph.nodes[id];
  if (!n) return;
  n.x_mm = Math.min(MAP_W_MM, Math.max(0, Number(nodeX.value) || n.x_mm));
  n.y_mm = Math.min(MAP_H_MM, Math.max(0, Number(nodeY.value) || n.y_mm));
  rebuildGraphFromCurrent();
  drawMap();
};

(document.getElementById("applyEdge") as HTMLButtonElement).onclick = () => {
  const edge = graph.edges.find((e) => e.id === edgeSelect.value);
  if (!edge) return;
  edge.line_type = lineTypeSelect.value as LineType;
  rebuildGraphFromCurrent();
  drawMap();
};

(document.getElementById("resetMap") as HTMLButtonElement).onclick = () => {
  graph = createDefaultGraph();
  refreshMapEditorControls();
  drawMap();
};

canvas.addEventListener("mousedown", (ev) => {
  if (editModeSelect.value !== "ON") return;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  draggedNodeId = nearestNodeId(x, y);
  if (draggedNodeId) {
    nodeSelect.value = draggedNodeId;
    const n = graph.nodes[draggedNodeId];
    nodeX.value = String(Math.round(n.x_mm));
    nodeY.value = String(Math.round(n.y_mm));
  }
});

canvas.addEventListener("mousemove", (ev) => {
  if (editModeSelect.value !== "ON" || !draggedNodeId) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  const mm = canvasToMm(x, y);
  const n = graph.nodes[draggedNodeId];
  n.x_mm = Math.min(MAP_W_MM, Math.max(0, mm.x));
  n.y_mm = Math.min(MAP_H_MM, Math.max(0, mm.y));
  nodeX.value = String(Math.round(n.x_mm));
  nodeY.value = String(Math.round(n.y_mm));
  rebuildGraphFromCurrent();
  drawMap();
});

window.addEventListener("mouseup", () => {
  draggedNodeId = null;
});

(document.getElementById("runOne") as HTMLButtonElement).onclick = () => runRound();
(document.getElementById("play") as HTMLButtonElement).onclick = () => {
  if (!latestResult) runRound();
  if (latestResult) playTrace(latestResult);
};
runBatchBtn.onclick = () => {
  void runBatch();
};

(document.getElementById("exportRoute") as HTMLButtonElement).onclick = () => {
  if (!latestResult) runRound();
  if (!latestResult) return;
  const fw = estimateFirmwarePlan(latestResult);
  download("route_table.json", JSON.stringify(fw.route_table, null, 2));
};

(document.getElementById("exportPolicy") as HTMLButtonElement).onclick = () => {
  if (!latestResult) runRound();
  if (!latestResult) return;
  const fw = estimateFirmwarePlan(latestResult);
  download("policy_rules.json", JSON.stringify(fw.policy_rules, null, 2));
};

(document.getElementById("exportFsm") as HTMLButtonElement).onclick = () => {
  download("fsm_contract.md", generateFsmContractMarkdown());
};

refreshMapEditorControls();
drawMap();
// runRound();  // Don't run on load - wait for user to click
summarizeBatch([]);
updateLivePanel(baseConfig.timeout_s);
