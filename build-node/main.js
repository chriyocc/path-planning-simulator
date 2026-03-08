import "./styles.css";
import { ALL_POLICIES, AdaptiveSafePolicy, createDefaultGraph, createDefaultSimulationConfig, estimateFirmwarePlan, generateFsmContractMarkdown, simulateBatch, simulateRound } from "./index";
const graph = createDefaultGraph();
const baseConfig = createDefaultSimulationConfig(graph);
const app = document.querySelector("#app");
if (!app)
    throw new Error("#app not found");
app.innerHTML = `
<div class="layout">
  <section class="board">
    <canvas id="map" width="980" height="760"></canvas>
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
    </div>
    <div class="row">
      <button id="runOne">Run Round</button>
      <button id="play">Play Trace</button>
      <button id="runBatch">Run Batch</button>
    </div>
    <div class="row">
      <button id="exportRoute">Export route_table.json</button>
      <button id="exportPolicy">Export policy_rules.json</button>
      <button id="exportFsm">Export fsm_contract.md</button>
    </div>
    <div class="stat">Round Summary<pre id="summary"></pre></div>
    <div class="stat">Branch Randomization<pre id="randomization"></pre></div>
    <div class="stat">Policy Ranking (Batch)<pre id="batch"></pre></div>
  </aside>
</div>
`;
const canvas = document.getElementById("map");
const context = canvas.getContext("2d");
if (!context)
    throw new Error("Canvas context unavailable");
const ctx = context;
const policySelect = document.getElementById("policy");
const seedInput = document.getElementById("seed");
const capacityInput = document.getElementById("capacity");
const runsInput = document.getElementById("runs");
const summaryEl = document.getElementById("summary");
const batchEl = document.getElementById("batch");
const randomizationEl = document.getElementById("randomization");
ALL_POLICIES.forEach((policy) => {
    const opt = document.createElement("option");
    opt.value = policy.name;
    opt.textContent = policy.name;
    policySelect.appendChild(opt);
});
policySelect.value = AdaptiveSafePolicy.name;
let latestResult = null;
let latestBatch = [];
let robotNodeId = graph.startNodeId;
function getPolicyByName(name) {
    return ALL_POLICIES.find((p) => p.name === name) ?? AdaptiveSafePolicy;
}
function configFromInputs() {
    return {
        ...baseConfig,
        robot: {
            ...baseConfig.robot,
            carry_capacity: Math.max(1, Number(capacityInput.value) || 1)
        }
    };
}
function worldToCanvas(g, nodeId) {
    const node = g.nodes[nodeId];
    const x = (node.x_mm / 1500) * canvas.width;
    const y = (node.y_mm / 2000) * canvas.height;
    return { x, y };
}
function colorOfNode(nodeId) {
    if (nodeId.includes("RED"))
        return "#d33";
    if (nodeId.includes("YELLOW"))
        return "#d1a80d";
    if (nodeId.includes("BLUE"))
        return "#2e63cf";
    if (nodeId.includes("GREEN"))
        return "#2e9f4c";
    if (nodeId.includes("BLACK"))
        return "#111";
    return "#3f3f3f";
}
function drawMap(g, highlightPath = []) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const edge of g.edges) {
        const a = worldToCanvas(g, edge.from);
        const b = worldToCanvas(g, edge.to);
        ctx.save();
        ctx.strokeStyle = edge.line_type === "DASHED" ? "#424242" : "#2f4054";
        ctx.lineWidth = 2;
        if (edge.line_type === "DASHED") {
            ctx.setLineDash([8, 8]);
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.restore();
    }
    if (highlightPath.length > 1) {
        ctx.save();
        ctx.strokeStyle = "#ff6b00";
        ctx.lineWidth = 4;
        ctx.beginPath();
        const first = worldToCanvas(g, highlightPath[0]);
        ctx.moveTo(first.x, first.y);
        for (const nodeId of highlightPath.slice(1)) {
            const p = worldToCanvas(g, nodeId);
            ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.restore();
    }
    Object.values(g.nodes).forEach((node) => {
        const p = worldToCanvas(g, node.id);
        ctx.beginPath();
        ctx.arc(p.x, p.y, node.kind === "JUNCTION" ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = colorOfNode(node.id);
        ctx.fill();
        if (["START", "BLACK_ZONE", "COLOR_ZONE"].includes(node.kind)) {
            ctx.font = "11px sans-serif";
            ctx.fillStyle = "#222";
            ctx.fillText(node.id, p.x + 6, p.y - 5);
        }
    });
    const robotPos = worldToCanvas(g, robotNodeId);
    ctx.beginPath();
    ctx.arc(robotPos.x, robotPos.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#ff5f1f";
    ctx.fill();
}
function summarizeResult(result) {
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
}
function summarizeBatch(items) {
    if (items.length === 0) {
        batchEl.textContent = "(run batch to view ranking)";
        return;
    }
    batchEl.textContent = items
        .sort((a, b) => b.mean_score - a.mean_score)
        .map((r, i) => `${i + 1}. ${r.policy_name}\n  mean_score=${r.mean_score}\n  completion=${r.completion_rate}%\n  mean_time=${r.mean_time_s}s p50=${r.p50_time_s}s p90=${r.p90_time_s}s\n  violations=${r.violations_count}`)
        .join("\n\n");
}
function runRound() {
    const config = configFromInputs();
    const policy = getPolicyByName(policySelect.value);
    const seed = Math.max(1, Number(seedInput.value) || 1);
    latestResult = simulateRound(config, policy, seed);
    robotNodeId = latestResult.state.current_node;
    drawMap(graph);
    summarizeResult(latestResult);
}
function stepPlayback(trace) {
    let index = 0;
    const tick = () => {
        if (index >= trace.length)
            return;
        const step = trace[index];
        robotNodeId = step.toNode;
        drawMap(graph, step.path);
        index += 1;
        setTimeout(() => requestAnimationFrame(tick), 220);
    };
    tick();
}
function runBatch() {
    const config = configFromInputs();
    const runs = Math.max(10, Number(runsInput.value) || 100);
    latestBatch = ALL_POLICIES.map((p) => simulateBatch(config, p, runs));
    summarizeBatch(latestBatch);
}
function download(name, content) {
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
document.getElementById("runOne").onclick = () => runRound();
document.getElementById("play").onclick = () => {
    if (!latestResult)
        runRound();
    if (latestResult)
        stepPlayback(latestResult.trace);
};
document.getElementById("runBatch").onclick = () => runBatch();
document.getElementById("exportRoute").onclick = () => {
    if (!latestResult)
        runRound();
    if (!latestResult)
        return;
    const fw = estimateFirmwarePlan(latestResult);
    download("route_table.json", JSON.stringify(fw.route_table, null, 2));
};
document.getElementById("exportPolicy").onclick = () => {
    if (!latestResult)
        runRound();
    if (!latestResult)
        return;
    const fw = estimateFirmwarePlan(latestResult);
    download("policy_rules.json", JSON.stringify(fw.policy_rules, null, 2));
};
document.getElementById("exportFsm").onclick = () => {
    download("fsm_contract.md", generateFsmContractMarkdown());
};
drawMap(graph);
runRound();
summarizeBatch([]);
