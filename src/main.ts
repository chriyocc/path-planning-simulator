import "./styles.css";
import {
  ALL_POLICIES,
  AdaptiveSafePolicy,
  buildGraph,
  createDefaultPolicyOverrides,
  createDefaultGraph,
  createDefaultSimulationConfig,
  estimateFirmwarePlan,
  policySupportsFixedRouteExperiment,
  policySupportsOverrides,
  simulateBatch,
  simulateRound,
  withPolicyOverrides
} from "./index";
import type {
  BlackLockCarryMode,
  BatchResult,
  BranchOrderMode,
  BranchId,
  ColorDropTimingMode,
  Edge,
  Graph,
  LineType,
  LockClearStrategyMode,
  PolicyOverrides,
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
  locksPlaced: Array<{ branchId: BranchId; zoneId: string }>;
  zonePlaced: Record<Exclude<ResourceColor, "BLACK">, number>;
  pickedSlots: Record<string, boolean>;
  elapsed_s: number;
}

interface SectionInfo {
  title: string;
  body: string[];
}

interface PolicyInfo {
  label: string;
  summary: string;
  whyUseIt: string;
  decisionFlow: string[];
  strengths: string[];
  watchouts: string[];
}

interface StrategySection {
  title: string;
  summary: string;
  bullets: string[];
}

const MAP_W_MM = 1500;
const MAP_H_MM = 2000;

const SECTION_INFO: Record<string, SectionInfo> = {
  "simulation-controls": {
    title: "Simulation Controls",
    body: [
      "Policy chooses the decision function that decides every next action during the round. Changing it swaps the full decision logic, not just a label.",
      "Seed fixes the branch randomization. Using the same seed gives the same color placement, which makes comparisons between policies fair and repeatable.",
      "Carry Capacity limits how many total items the robot can hold at once. Locks and colored resources both consume capacity.",
      "Batch Runs controls how many seeded simulations are used during ranking. Higher values make comparisons more stable but also slower.",
      "Playback Speed affects only the trace animation in the browser. It does not change simulated robot time or batch statistics."
    ]
  },
  "strategy-knobs": {
    title: "Strategy Knobs",
    body: [
      "This section lets you override specific policy decisions without replacing the whole policy.",
      "You can control how supported policies carry black locks, and the fixed-route policy also exposes branch order, colored-resource drop timing, and whether to clear all locks before collecting resources.",
      "Only policies that explicitly support overrides will use these settings. Unsupported policies keep their built-in behavior."
    ]
  },
  "round-actions": {
    title: "Round Actions",
    body: [
      "Run Round executes one deterministic simulation using the selected policy, seed, and carry capacity. It refreshes the summary, map state, and trace data.",
      "Randomize Seed + Run picks a new seed and immediately simulates one round so you can inspect a fresh branch layout without manually entering values.",
      "Play Trace animates the latest simulated trace on the map. If there is no latest result yet, the app first runs a round.",
      "Pause Trace freezes the animation at the current playback position. Pressing it again resumes from the same point instead of restarting the trace.",
      "Run Batch evaluates every available policy across many seeds, then ranks them by performance so you can compare robustness instead of one lucky run."
    ]
  },
  "policy-details": {
    title: "Policy Details",
    body: [
      "This section explains the selected policy in plain language and shows its decision ladder. The explanation is derived from the actual policy code, so it maps to what the simulator is doing.",
      "Summary tells you the policy's overall intent. Decision flow lists the main guards in the order they are evaluated.",
      "Strengths call out where the policy tends to work well. Watchouts highlight assumptions or tradeoffs that can make a policy fragile in some layouts or deadlines."
    ]
  },
  "artifacts": {
    title: "Firmware Artifacts",
    body: [
      "route_table.json is necessary when you want to convert the chosen simulation trace into a node-by-node movement plan for firmware or downstream tools.",
      "policy_rules.json is necessary when you want a compact list of runtime guard rules that explain what the controller should do when time, cargo, or recovery conditions change.",
      "fsm_contract.md was only generated as human-readable documentation. It is not loaded by the web app, not referenced by tests as a required output, and not needed to run the simulator or export the firmware-facing data.",
      "Because of that, this UI keeps only the two practical exports: route table and policy rules."
    ]
  },
  "live-game-time": {
    title: "Live Game Time",
    body: [
      "This panel mirrors the currently rendered trace frame, not just the final simulation result. During playback it updates continuously.",
      "Elapsed is simulated round time already consumed. Remaining is the timeout budget left from the configured round limit.",
      "The carrying line shows both held locks and colored resources because both matter for capacity and next-action choices.",
      "Zone fill shows how many correctly placed resources have been scored into each color zone so far."
    ]
  },
  "round-summary": {
    title: "Round Summary",
    body: [
      "This is the concise end-of-round report for the most recent run.",
      "Score is the points achieved by the policy under the current seed. Placed shows how many of the eight colored resources were delivered.",
      "Returned indicates whether the robot made it back to START before the round ended. Violations reports legality or execution rule issues detected by the simulator.",
      "Trace steps shows how many timed segments the round generated, which also determines how detailed playback will be."
    ]
  },
  "branch-randomization": {
    title: "Branch Randomization",
    body: [
      "Each branch contains two hidden colored resources. This panel reveals the seeded randomization used by the latest run.",
      "Keeping the seed fixed is the correct way to compare policy behavior because it prevents the branch layout from changing between runs.",
      "If a policy looks better on one seed, use batch mode to check whether that advantage holds over many layouts."
    ]
  },
  "policy-ranking": {
    title: "Policy Ranking",
    body: [
      "Batch ranking runs all policies over the same set of seeds and compares their aggregated results.",
      "Mean score is the primary success indicator. Completion shows how often a policy finished all required deliveries.",
      "Mean, p50, and p90 time show typical and slower-case completion behavior. Violations count tells you whether a policy tends to drift into illegal or unrecoverable situations."
    ]
  },
  "game-strategy": {
    title: "Game Strategy",
    body: [
      "This section summarizes the team's recommended competition approach from the strategy manual in docs.",
      "The main idea is to precompute legal plans offline and let the robot infer the active layout onboard, instead of having a human tell the robot which layout was randomized.",
      "That keeps the approach closer to the autonomy requirement while still using the small legal layout space effectively."
    ]
  },
  "map-editor": {
    title: "Map Editor",
    body: [
      "Edit Mode lets you adjust the graph that the simulator routes over. This changes the path geometry and recomputes distances from the edited node locations.",
      "Node and Edge controls are precise editors for coordinates and line styles. Dragging nodes on the canvas is the faster direct-manipulation option.",
      "Reset Map restores the built-in default topology. This is useful after experimentation because route timing and policy behavior both depend on the geometry."
    ]
  }
};

const GAME_STRATEGY: StrategySection[] = [
  {
    title: "Official Direction",
    summary: "Build a legal, robust, high-scoring autonomous system without relying on gray-zone human input.",
    bullets: [
      "Use simulation to support planning, not to replace the official rules.",
      "Prefer strategies that remain defensible under referee scrutiny.",
      "Keep a fallback heuristic policy available if the main plan cannot be executed cleanly."
    ]
  },
  {
    title: "Main Competition Plan",
    summary: "Precompute all legal layouts offline, then let the robot determine the active layout onboard.",
    bullets: [
      "The legal layout space is 576 because each row is a permutation of R/G/B/Y.",
      "Compute a best high-level action plan for each legal layout before impound.",
      "Store plan tables onboard and execute them through a line-following state machine.",
      "If the exact layout is not yet known, continue with a safe heuristic while gathering more observations."
    ]
  },
  {
    title: "Why This Is Recommended",
    summary: "It keeps online decision cost low while staying aligned with autonomy and field constraints.",
    bullets: [
      "No human needs to provide the layout number to the robot.",
      "All environment interpretation stays onboard.",
      "Planning and low-level control remain cleanly separated, which is better for firmware and debugging."
    ]
  },
  {
    title: "Operational Guardrails",
    summary: "Setup-phase reading can help, but the robot must still be able to operate safely when setup data is incomplete or noisy.",
    bullets: [
      "Use setup time for legal calibration and optional onboard observation only.",
      "Do not depend on laptops, code download, or manual layout-number entry after impound.",
      "Treat manual layout selection as documented gray-zone behavior, not the official main strategy."
    ]
  }
];

const POLICY_INFO: Record<string, PolicyInfo> = {
  Baseline_SingleCarry: {
    label: "Baseline Single Carry",
    summary: "A conservative fallback policy that behaves like a simple one-job-at-a-time operator.",
    whyUseIt: "Use this when you want predictable, easy-to-understand behavior and a low-risk baseline for comparison.",
    decisionFlow: [
      "If the robot is already holding a lock, drop that lock into a black zone first.",
      "If the robot is standing on the correct scoring zone for a carried color, unload immediately.",
      "If the robot is carrying any resources, head to the nearest valid drop opportunity for those resources.",
      "Otherwise choose the next locked branch using nearest-time logic, clear it, then pick resources in branch order.",
      "When everything is collected and nothing is being carried, return home or end the round."
    ],
    strengths: [
      "Easy to reason about and debug.",
      "Rarely overcommits capacity.",
      "Good reference policy when testing new heuristics."
    ],
    watchouts: [
      "Leaves points on the table because it ignores value density.",
      "Does not exploit multi-carry opportunities.",
      "Can waste time with extra trips in richer layouts."
    ]
  },
  BusRoute_Parametric: {
    label: "Bus Route Parametric",
    summary: "The main capacity-aware heuristic that tries to maximize points per travel time while opportunistically chaining efficient actions.",
    whyUseIt: "Use this as the practical default when you want strong heuristic performance without omniscient planning.",
    decisionFlow: [
      "If the robot holds one lock, has no resources, and capacity allows, check whether picking a second lock before dropping both is faster than two separate black-zone trips.",
      "Otherwise, if any lock is held, drop it at the nearest valid black zone.",
      "If the robot is on a matching color zone, drop immediately before moving away.",
      "Choose the next lock or resource using value-per-time style scoring rather than nearest distance alone.",
      "When capacity is full or no better pickup remains, switch to scoring carried resources."
    ],
    strengths: [
      "Uses carry capacity better than the baseline policy.",
      "Balances branch value against travel cost.",
      "Usually a strong all-around heuristic for realistic runs."
    ],
    watchouts: [
      "More heuristic complexity means behavior is less obvious at a glance.",
      "Still not globally optimal because it only evaluates local tradeoffs.",
      "Can be sensitive to geometry edits that change travel ratios."
    ]
  },
  ValueAware_Deadline: {
    label: "Value Aware Deadline",
    summary: "A time-sensitive policy that becomes more selective as the round clock shrinks.",
    whyUseIt: "Use this when endgame timing matters more than exhaustive collection and you want the policy to protect late-round score conversion.",
    decisionFlow: [
      "If a lock is held, finish dropping it before doing anything else.",
      "If the robot is already on a valid color zone, drop matching cargo immediately.",
      "When remaining time is very low, stop opening new work and focus on scoring carried items or ending safely.",
      "When the timer gets tighter, ignore low-value branches and prefer higher-point work.",
      "While enough time remains, pick locks and resources using value-based scoring and unload when capacity is reached."
    ],
    strengths: [
      "Handles late-round pressure better than purely distance-based policies.",
      "Avoids some low-value detours near the deadline.",
      "Good when finishing strong matters more than exploring everything."
    ],
    watchouts: [
      "Can skip useful low-point work if the thresholds are too aggressive.",
      "Threshold behavior may look abrupt when the timer crosses a cutoff.",
      "Less intuitive than the baseline when debugging single runs."
    ]
  },
  AdaptiveSafe: {
    label: "Adaptive Safe",
    summary: "A hybrid wrapper that starts safe, then switches to the deadline-aware strategy once enough time has elapsed.",
    whyUseIt: "Use this when you want a guarded opening with a more aggressive closing strategy later in the round.",
    decisionFlow: [
      "While more than 300 seconds remain, delegate decisions to the conservative baseline logic.",
      "Once the timer drops below that threshold, delegate decisions to the value-aware deadline policy.",
      "The handoff lets the policy keep early-round behavior simple while still reacting to late-round urgency."
    ],
    strengths: [
      "Simple mental model despite combining two behaviors.",
      "Safer early-round routing than full value chasing.",
      "More deadline-aware than baseline alone."
    ],
    watchouts: [
      "The 300-second switch is a hard threshold.",
      "If the baseline opening was inefficient, the late switch cannot fully recover lost time.",
      "Behavior depends on two underlying policies, so tuning one changes this policy too."
    ]
  },
  FixedRoute_Capacity2: {
    label: "Fixed Route Capacity 2",
    summary: "A scripted branch-order policy that always clears and harvests branches in the same order, regardless of randomized resource placement.",
    whyUseIt: "Use this when you want a predictable route template for repeated testing or for comparing a simple fixed strategy against adaptive heuristics.",
    decisionFlow: [
      "Follow one fixed branch order every run: YELLOW, then BLUE, then GREEN, then RED.",
      "If a lock is being carried, drop it first so the branch becomes legal for resource collection.",
      "If the robot is already on a correct color zone, unload matching resources immediately.",
      "If capacity is full, go score the carried resources before continuing the route.",
      "Otherwise keep unlocking and collecting resources in the same branch order until everything is delivered, then return home."
    ],
    strengths: [
      "Very easy to understand and repeat.",
      "Useful for hardware testing because route order is stable across seeds.",
      "Good baseline for comparing fixed-route behavior against adaptive policies."
    ],
    watchouts: [
      "Ignores the randomized layout when choosing branch order.",
      "Usually leaves performance on the table compared with value-aware routing.",
      "The name assumes carry capacity 2 is the intended operating mode, but the simulator will still let users change capacity."
    ]
  },
  Optimal_Omniscient: {
    label: "Optimal Omniscient",
    summary: "A benchmark policy that computes a full plan using complete knowledge of the randomized layout.",
    whyUseIt: "Use this as an upper-bound reference for what the simulator could achieve if the robot knew everything in advance.",
    decisionFlow: [
      "At the start of the round, compute the full best action sequence from the current state.",
      "Cache that sequence and emit actions in order until the plan is exhausted.",
      "End the round when the precomputed action list is complete."
    ],
    strengths: [
      "Best reference point for comparing heuristic quality.",
      "Helps quantify how far practical policies are from the planner’s upper bound.",
      "Useful for validating the simulator and export pipeline."
    ],
    watchouts: [
      "Not realistic for real hardware because it assumes full knowledge.",
      "Best used for benchmarking, not as a deployable runtime strategy.",
      "Planner cost may grow with problem complexity."
    ]
  }
};

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
    <header class="hero">
      <p class="eyebrow">Path Planning Simulator</p>
      <h1>RoboSurvivor 2026</h1>
      <p class="hero-copy">Compare policies, inspect the robot trace, and export the firmware-facing tables that are actually useful downstream.</p>
    </header>

    <section class="section-card" data-section="simulation-controls">
      <div class="section-heading">
        <div>
          <h2>Simulation Controls</h2>
          <p>Configure the run before simulating.</p>
        </div>
        <button class="info-button" type="button" data-info-target="simulation-controls" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-simulation-controls"></div>
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
    </section>

    <section class="section-card" data-section="strategy-knobs" id="strategyKnobsCard">
      <div class="section-heading">
        <div>
          <h2>Strategy Knobs</h2>
          <p>User-controlled decision rules layered on supported policies.</p>
        </div>
        <button class="info-button" type="button" data-info-target="strategy-knobs" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-strategy-knobs"></div>
      <div class="controls">
        <label id="blackLockCarryControl">Black Lock Carry
          <select id="blackLockCarry">
            <option value="auto">Policy default / Auto</option>
            <option value="single">One-by-one</option>
            <option value="fill_capacity">Use capacity fully</option>
          </select>
        </label>
        <label id="branchOrderControl">Branch Order
          <select id="branchOrder">
            <option value="yellow_blue_green_red">YELLOW -> BLUE -> GREEN -> RED</option>
            <option value="red_yellow_blue_green">RED -> YELLOW -> BLUE -> GREEN</option>
            <option value="blue_green_yellow_red">BLUE -> GREEN -> YELLOW -> RED</option>
            <option value="green_blue_yellow_red">GREEN -> BLUE -> YELLOW -> RED</option>
          </select>
        </label>
        <label id="colorDropTimingControl">Color Drop Timing
          <select id="colorDropTiming">
            <option value="auto">Policy default / Auto</option>
            <option value="immediate">Immediate</option>
            <option value="when_full">When full</option>
          </select>
        </label>
        <label id="lockClearStrategyControl">Lock Clear Strategy
          <select id="lockClearStrategy">
            <option value="auto">Policy default / Auto</option>
            <option value="clear_all_first">Take all black locks first</option>
          </select>
        </label>
      </div>
      <p id="strategyKnobsMessage" class="support-note"></p>
    </section>

    <section class="section-card" data-section="round-actions">
      <div class="section-heading">
        <div>
          <h2>Round Actions</h2>
          <p>Run a single round, animate it, or benchmark every policy.</p>
        </div>
        <button class="info-button" type="button" data-info-target="round-actions" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-round-actions"></div>
      <div class="row">
        <button id="runOne">Run Round</button>
        <button id="randomSeed">Randomize Seed + Run</button>
        <button id="play">Play Trace</button>
        <button id="pauseTrace" disabled>Pause Trace</button>
        <button id="runBatch">Run Batch</button>
      </div>
    </section>

    <section class="section-card" data-section="policy-details">
      <div class="section-heading">
        <div>
          <h2>Policy Details</h2>
          <p>Shows what the selected policy is trying to do and the order of its decision rules.</p>
        </div>
        <button class="info-button" type="button" data-info-target="policy-details" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-policy-details"></div>
      <div id="policyDetails" class="policy-card"></div>
    </section>

    <section class="section-card" data-section="artifacts">
      <div class="section-heading">
        <div>
          <h2>Firmware Artifacts</h2>
          <p>Keep the practical outputs that map directly to firmware behavior.</p>
        </div>
        <button class="info-button" type="button" data-info-target="artifacts" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-artifacts"></div>
      <div class="artifact-grid">
        <article class="artifact-card">
          <h3>route_table.json</h3>
          <p>Necessary when you want a node-ordered travel plan from the selected run.</p>
        </article>
        <article class="artifact-card">
          <h3>policy_rules.json</h3>
          <p>Necessary when you want compact runtime guard/action rules for the controller.</p>
        </article>
      </div>
      <div class="row">
        <button id="exportRoute">Export route_table.json</button>
        <button id="exportPolicy">Export policy_rules.json</button>
      </div>
    </section>

    <section class="section-card" data-section="live-game-time">
      <div class="section-heading">
        <div>
          <h2>Live Game Time</h2>
          <p>Playback-aware timing and cargo state.</p>
        </div>
        <button class="info-button" type="button" data-info-target="live-game-time" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-live-game-time"></div>
      <div class="stat"><pre id="live"></pre></div>
    </section>

    <section class="section-card" data-section="round-summary">
      <div class="section-heading">
        <div>
          <h2>Round Summary</h2>
          <p>Quick result for the latest deterministic run.</p>
        </div>
        <button class="info-button" type="button" data-info-target="round-summary" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-round-summary"></div>
      <div class="stat"><pre id="summary"></pre></div>
    </section>

    <section class="section-card" data-section="branch-randomization">
      <div class="section-heading">
        <div>
          <h2>Branch Randomization</h2>
          <p>Reveals the seeded resource layout used by the latest run.</p>
        </div>
        <button class="info-button" type="button" data-info-target="branch-randomization" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-branch-randomization"></div>
      <div class="stat"><pre id="randomization"></pre></div>
    </section>

    <section class="section-card" data-section="policy-ranking">
      <div class="section-heading">
        <div>
          <h2>Policy Ranking (Batch)</h2>
          <p>Aggregated comparison across many seeds.</p>
        </div>
        <button class="info-button" type="button" data-info-target="policy-ranking" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-policy-ranking"></div>
      <div class="stat"><pre id="batch"></pre></div>
    </section>

    <section class="section-card" data-section="game-strategy">
      <div class="section-heading">
        <div>
          <h2>Game Strategy</h2>
          <p>The team’s recommended competition direction, shown directly in the app.</p>
        </div>
        <button class="info-button" type="button" data-info-target="game-strategy" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-game-strategy"></div>
      <div id="gameStrategy" class="strategy-card"></div>
    </section>

    <section class="section-card" data-section="map-editor">
      <div class="section-heading">
        <div>
          <h2>Map Editor</h2>
          <p>Edit node geometry and line style directly in the browser.</p>
        </div>
        <button class="info-button" type="button" data-info-target="map-editor" aria-expanded="false">Info</button>
      </div>
      <div class="info-panel hidden" id="info-map-editor"></div>
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
    </section>
  </aside>
</div>
<div id="batchToast" class="toast hidden">Running batch simulation...</div>
`;

const canvas = document.getElementById("map") as HTMLCanvasElement;
const context = canvas.getContext("2d");
if (!context) throw new Error("Canvas context unavailable");
const ctx: CanvasRenderingContext2D = context;

const policySelect = document.getElementById("policy") as HTMLSelectElement;
const blackLockCarryControl = document.getElementById("blackLockCarryControl") as HTMLLabelElement;
const blackLockCarrySelect = document.getElementById("blackLockCarry") as HTMLSelectElement;
const branchOrderControl = document.getElementById("branchOrderControl") as HTMLLabelElement;
const branchOrderSelect = document.getElementById("branchOrder") as HTMLSelectElement;
const colorDropTimingControl = document.getElementById("colorDropTimingControl") as HTMLLabelElement;
const colorDropTimingSelect = document.getElementById("colorDropTiming") as HTMLSelectElement;
const lockClearStrategyControl = document.getElementById("lockClearStrategyControl") as HTMLLabelElement;
const lockClearStrategySelect = document.getElementById("lockClearStrategy") as HTMLSelectElement;
const strategyKnobsCard = document.getElementById("strategyKnobsCard") as HTMLElement;
const strategyKnobsMessage = document.getElementById("strategyKnobsMessage") as HTMLParagraphElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const capacityInput = document.getElementById("capacity") as HTMLInputElement;
const runsInput = document.getElementById("runs") as HTMLInputElement;
const speedInput = document.getElementById("speed") as HTMLInputElement;
const speedValue = document.getElementById("speedValue") as HTMLInputElement;
const randomSeedBtn = document.getElementById("randomSeed") as HTMLButtonElement;
const runBatchBtn = document.getElementById("runBatch") as HTMLButtonElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const pauseTraceBtn = document.getElementById("pauseTrace") as HTMLButtonElement;
const batchToast = document.getElementById("batchToast") as HTMLDivElement;
const policyDetailsEl = document.getElementById("policyDetails") as HTMLDivElement;

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
let currentOverrides: PolicyOverrides = createDefaultPolicyOverrides();
blackLockCarrySelect.value = currentOverrides.black_lock_carry_mode;
branchOrderSelect.value = currentOverrides.branch_order;
colorDropTimingSelect.value = currentOverrides.color_drop_timing;
lockClearStrategySelect.value = currentOverrides.lock_clear_strategy;
let robotPose: RobotPose = { ...nodePoint(graph.startNodeId), heading: -Math.PI / 2 };
let visualState: VisualState = emptyVisualState();
let animationHandle = 0;
let draggedNodeId: string | null = null;
let activeAnimation: {
  startTs: number;
  pausedAtMs: number;
  durationMs: number;
  poses: Array<RobotPose & { stepIdx: number; stepProgress: number }>;
  result: SimulationResult;
  isPaused: boolean;
} | null = null;

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

function renderInfoPanel(sectionKey: string): string {
  const info = SECTION_INFO[sectionKey];
  if (!info) return "";
  return [
    `<p class="info-title">${info.title}</p>`,
    ...info.body.map((line) => `<p>${line}</p>`)
  ].join("");
}

function syncInfoPanels(): void {
  document.querySelectorAll<HTMLButtonElement>(".info-button").forEach((button) => {
    const key = button.dataset.infoTarget;
    if (!key) return;
    const panel = document.getElementById(`info-${key}`);
    if (!panel) return;
    panel.innerHTML = renderInfoPanel(key);
    button.onclick = () => {
      const isOpen = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", isOpen);
      button.setAttribute("aria-expanded", String(!isOpen));
      button.textContent = isOpen ? "Info" : "Hide";
    };
  });
}

function renderPolicyDetails(name: string): void {
  const info = POLICY_INFO[name] ?? POLICY_INFO[AdaptiveSafePolicy.name];
  const supportsOverrides = policySupportsOverrides(name);
  const fixedRouteExperiment = policySupportsFixedRouteExperiment(name);
  const overrideLines: string[] = [];
  if (supportsOverrides) {
    overrideLines.push(`black lock carry = ${currentOverrides.black_lock_carry_mode}`);
  }
  if (fixedRouteExperiment) {
    overrideLines.push(`branch order = ${currentOverrides.branch_order}`);
    overrideLines.push(`color drop timing = ${currentOverrides.color_drop_timing}`);
    overrideLines.push(`lock clear strategy = ${currentOverrides.lock_clear_strategy}`);
  }
  const overrideSummary = overrideLines.length
    ? `<div class="policy-override-note">${overrideLines.map((line) => `<p>${line}</p>`).join("")}</div>`
    : "";
  policyDetailsEl.innerHTML = `
    <div class="policy-header">
      <div>
        <p class="policy-kicker">${info.label}</p>
        <h3>${name}</h3>
      </div>
      <p class="policy-summary">${info.summary}</p>
    </div>
    <p class="policy-why">${info.whyUseIt}</p>
    ${overrideSummary}
    <div class="policy-columns">
      <div>
        <h4>Decision Flow</h4>
        <ol>
          ${info.decisionFlow.map((item) => `<li>${item}</li>`).join("")}
        </ol>
      </div>
      <div>
        <h4>Strengths</h4>
        <ul>
          ${info.strengths.map((item) => `<li>${item}</li>`).join("")}
        </ul>
        <h4>Watchouts</h4>
        <ul>
          ${info.watchouts.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

function syncStrategyKnobs(): void {
  const policyName = policySelect.value;
  const supportsOverrides = policySupportsOverrides(policyName);
  const supportsFixedRouteExperiment = policySupportsFixedRouteExperiment(policyName);
  strategyKnobsCard.classList.toggle("knobs-disabled", !supportsOverrides);
  blackLockCarryControl.classList.toggle("hidden", !supportsOverrides);
  blackLockCarrySelect.disabled = !supportsOverrides;
  branchOrderControl.classList.toggle("hidden", !supportsFixedRouteExperiment);
  branchOrderSelect.disabled = !supportsFixedRouteExperiment;
  colorDropTimingControl.classList.toggle("hidden", !supportsFixedRouteExperiment);
  colorDropTimingSelect.disabled = !supportsFixedRouteExperiment;
  lockClearStrategyControl.classList.toggle("hidden", !supportsFixedRouteExperiment);
  lockClearStrategySelect.disabled = !supportsFixedRouteExperiment;

  if (supportsFixedRouteExperiment) {
    strategyKnobsMessage.textContent =
      "This fixed-route policy supports black-lock carry, branch order, color drop timing, and lock-clear sequencing overrides.";
  } else if (supportsOverrides) {
    strategyKnobsMessage.textContent = "This policy supports black-lock carry overrides for testing.";
  } else {
    strategyKnobsMessage.textContent = "This policy uses its built-in behavior. Strategy knobs are not applied.";
  }
}

function currentPolicyOverrides(): PolicyOverrides {
  return {
    ...currentOverrides,
    black_lock_carry_mode: blackLockCarrySelect.value as BlackLockCarryMode,
    branch_order: branchOrderSelect.value as BranchOrderMode,
    color_drop_timing: colorDropTimingSelect.value as ColorDropTimingMode,
    lock_clear_strategy: lockClearStrategySelect.value as LockClearStrategyMode
  };
}

function selectedExecutionPolicy(): StrategyPolicy {
  const basePolicy = getPolicyByName(policySelect.value);
  const overrides = currentPolicyOverrides();
  currentOverrides = overrides;
  return withPolicyOverrides(basePolicy, overrides);
}

function renderGameStrategy(): void {
  const strategyEl = document.getElementById("gameStrategy") as HTMLDivElement | null;
  if (!strategyEl) return;
  strategyEl.innerHTML = GAME_STRATEGY.map(
    (section) => `
      <article class="strategy-block">
        <h3>${section.title}</h3>
        <p class="strategy-summary">${section.summary}</p>
        <ul>
          ${section.bullets.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </article>
    `
  ).join("");
}

function stopTracePlayback(resetState = false): void {
  if (animationHandle) {
    cancelAnimationFrame(animationHandle);
    animationHandle = 0;
  }
  if (resetState) {
    activeAnimation = null;
    pauseTraceBtn.disabled = true;
    pauseTraceBtn.textContent = "Pause Trace";
  }
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
  graph.blackZoneIds.forEach((zoneId) => {
    const blackZonePt = nodePoint(zoneId);
    const zoneLocks = visualState.locksPlaced.filter((lock) => lock.zoneId === zoneId);
    for (let i = 0; i < zoneLocks.length; i += 1) {
      const xOffset = (i - (zoneLocks.length - 1) / 2) * 18;
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
  });
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
  const lines = [
    `policy=${result.policy_name}`,
    `seed=${result.seed}`,
    `score=${s.score}`,
    `time=${s.time_elapsed_s.toFixed(2)}s`,
    `placed=${s.placed_resources.length}/8`,
    `returned=${s.returned_to_start}`,
    `violations=${result.legality_violations.length}`,
    `trace_steps=${result.trace.length}`
  ];

  if (policySupportsOverrides(policySelect.value)) {
    lines.splice(2, 0, `black_lock_carry=${currentPolicyOverrides().black_lock_carry_mode}`);
  } else {
    lines.splice(2, 0, "black_lock_carry=unsupported(policy default)");
  }
  if (policySupportsFixedRouteExperiment(policySelect.value)) {
    lines.splice(3, 0, `branch_order=${currentPolicyOverrides().branch_order}`);
    lines.splice(4, 0, `color_drop_timing=${currentPolicyOverrides().color_drop_timing}`);
    lines.splice(5, 0, `lock_clear_strategy=${currentPolicyOverrides().lock_clear_strategy}`);
  }

  summaryEl.textContent = lines.join("\n");

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
  const locksPlaced: Array<{ branchId: BranchId; zoneId: string }> = [];
  const placedCounts: Record<string, number> = { RED: 0, YELLOW: 0, BLUE: 0, GREEN: 0 };

  function applyCompletedStep(step: TraceStep): void {
    if (step.note === "lock_gripped") {
      const branchId = step.action.branchId;
      if (branchId && !heldLockBranches.includes(branchId)) heldLockBranches.push(branchId);
      return;
    }

    if (step.note === "lock_deposited") {
      const branchId = step.action.branchId ?? heldLockBranches[0];
      const zoneId = step.toNode;
      if (branchId && !locksPlaced.some((lock) => lock.branchId === branchId)) {
        locksPlaced.push({ branchId, zoneId });
      }
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
  stopTracePlayback(true);
  const config = configFromInputs();
  const policy = selectedExecutionPolicy();
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
    locksPlaced: result.state.placed_locks.map((lock) => ({ ...lock })),
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
  renderPolicyDetails(policySelect.value);
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

function scheduleActiveAnimationFrame(): void {
  if (!activeAnimation) return;
  const frame = (ts: number) => {
    if (!activeAnimation) return;
    if (activeAnimation.isPaused) return;
    if (!activeAnimation.startTs) {
      activeAnimation.startTs = ts - activeAnimation.pausedAtMs;
    }
    const elapsedMs = ts - activeAnimation.startTs;
    const t = Math.min(1, elapsedMs / activeAnimation.durationMs);
    const idx = t * (activeAnimation.poses.length - 1);
    const i = Math.floor(idx);
    const j = Math.min(i + 1, activeAnimation.poses.length - 1);
    const a = activeAnimation.poses[i];
    const b = activeAnimation.poses[j];
    const lt = idx - i;

    robotPose = {
      x: a.x + (b.x - a.x) * lt,
      y: a.y + (b.y - a.y) * lt,
      heading: a.heading + (b.heading - a.heading) * lt
    };

    visualState = deriveVisualState(activeAnimation.result, a.stepIdx, a.stepProgress);
    updateLivePanel(baseConfig.timeout_s);
    drawMap();

    if (t < 1) {
      animationHandle = requestAnimationFrame(frame);
    } else {
      visualState = deriveVisualState(activeAnimation.result, activeAnimation.result.trace.length - 1, 1);
      updateLivePanel(baseConfig.timeout_s);
      drawMap();
      stopTracePlayback(true);
    }
  };

  animationHandle = requestAnimationFrame(frame);
}

function playTrace(result: SimulationResult): void {
  stopTracePlayback(false);
  const poses = traceToPoses(result.trace);
  const simTotal = result.trace.reduce((acc, step) => acc + step.segment_time_s, 0);
  const speed = Number(speedInput.value) || 0.35;
  const msPerSimSecond = 420;
  const durationMs = Math.max(10000, (simTotal * msPerSimSecond) / speed);

  activeAnimation = {
    startTs: 0,
    pausedAtMs: 0,
    durationMs,
    poses,
    result,
    isPaused: false
  };
  pauseTraceBtn.disabled = false;
  pauseTraceBtn.textContent = "Pause Trace";
  scheduleActiveAnimationFrame();
}

function toggleTracePause(): void {
  if (!activeAnimation) return;
  if (activeAnimation.isPaused) {
    activeAnimation.isPaused = false;
    activeAnimation.startTs = 0;
    pauseTraceBtn.textContent = "Pause Trace";
    scheduleActiveAnimationFrame();
    return;
  }

  activeAnimation.isPaused = true;
  activeAnimation.pausedAtMs = activeAnimation.startTs ? performance.now() - activeAnimation.startTs : 0;
  pauseTraceBtn.textContent = "Resume Trace";
  if (animationHandle) {
    cancelAnimationFrame(animationHandle);
    animationHandle = 0;
  }
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
    latestBatch = ALL_POLICIES.map((p) => simulateBatch(config, withPolicyOverrides(p, currentPolicyOverrides()), runs));
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

policySelect.onchange = () => {
  syncStrategyKnobs();
  renderPolicyDetails(policySelect.value);
};

blackLockCarrySelect.onchange = () => {
  currentOverrides = currentPolicyOverrides();
  renderPolicyDetails(policySelect.value);
};

branchOrderSelect.onchange = () => {
  currentOverrides = currentPolicyOverrides();
  renderPolicyDetails(policySelect.value);
};

colorDropTimingSelect.onchange = () => {
  currentOverrides = currentPolicyOverrides();
  renderPolicyDetails(policySelect.value);
};

lockClearStrategySelect.onchange = () => {
  currentOverrides = currentPolicyOverrides();
  renderPolicyDetails(policySelect.value);
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
playBtn.onclick = () => {
  if (!latestResult) runRound();
  if (latestResult) playTrace(latestResult);
};
pauseTraceBtn.onclick = () => {
  toggleTracePause();
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

refreshMapEditorControls();
syncInfoPanels();
syncStrategyKnobs();
renderPolicyDetails(policySelect.value);
renderGameStrategy();
drawMap();
// runRound();  // Don't run on load - wait for user to click
summarizeBatch([]);
updateLivePanel(baseConfig.timeout_s);
summaryEl.textContent = "Run a round to see the latest score, legality, and trace depth.";
randomizationEl.textContent = "Run a round to reveal the seeded branch layout used by the simulator.";
