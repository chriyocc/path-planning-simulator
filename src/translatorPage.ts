import { appPageHref } from "./appRoutes";
import {
  BRANCH_ID_LABELS,
  COLOR_ID_LABELS,
  SLOT_ID_LABELS,
  type TutorialPlanMode,
  buildPlanForPlacement,
  buildTutorialExecution,
  clampTutorialLayoutId,
  createDefaultTutorialPlacement,
  findLayoutIdForPlacement,
  formatLayoutMeaning,
  formatPlanRowMeaning,
  getPlacementForLayoutId,
  parsePlanRowText,
  validatePlacementRows
} from "./translator";
import type { BranchId } from "./types";

type Placement = ReturnType<typeof createDefaultTutorialPlacement>;

const BRANCHES: BranchId[] = ["RED", "YELLOW", "BLUE", "GREEN"];
const COLORS = ["RED", "YELLOW", "BLUE", "GREEN"] as const;

function renderTutorialResult(container: HTMLElement, title: string, placement: Placement | null, planText: string, actionCount: number, steps: ReturnType<typeof buildTutorialExecution>, layoutId: number | null): void {
  const layoutLines = placement ? formatLayoutMeaning(placement) : [];
  const planLines = formatPlanRowMeaning({
    action_count: actionCount,
    actions: Array.from({ length: 32 }, (_, index) => ({
      type: index < actionCount ? "ACT_PICK_LOCK" : "ACT_END_ROUND",
      arg0: 0,
      arg1: 0
    }))
  });
  container.innerHTML = `
    <div class="translator-result-card">
      <h3>${title}</h3>
      ${layoutId === null ? "" : `<p class="translator-result-meta">layout_id = ${layoutId}</p>`}
      ${placement ? `<div class="translator-result-block"><h4>Layout Meaning</h4><ul>${layoutLines.map((line) => `<li>${line}</li>`).join("")}</ul></div>` : ""}
      <div class="translator-result-block">
        <h4>Plan Row Meaning</h4>
        ${planLines.map((line) => `<p>${line}</p>`).join("")}
        <pre>${planText}</pre>
      </div>
      <div class="translator-result-block">
        <h4>Step-by-Step Human Instructions</h4>
        <ol class="translator-step-list">
          ${steps.map((step) => `<li><p><code>${step.raw}</code></p><p>${step.decoded}</p><p><strong>Meaning:</strong> ${step.meaning}</p><p><strong>Current node:</strong> ${step.currentNode}</p><p><strong>Target node:</strong> ${step.targetNode}</p><p><strong>Route-table connection:</strong> ${step.routeConnection}</p><p><strong>Lookup:</strong> <code>${step.routeLookup}</code></p><p><strong>Route entry content:</strong> ${step.routeEntry}</p></li>`).join("")}
        </ol>
      </div>
    </div>
  `;
}

function planToCompactText(actionCount: number, steps: ReturnType<typeof buildTutorialExecution>): string {
  return `.action_count = ${actionCount}, .actions = { ${steps.map((step) => `{ ${step.raw} }`).join(", ")} }`;
}

export function renderTranslatorPage(app: HTMLDivElement): void {
  const appBaseHref = import.meta.env.BASE_URL;
  app.innerHTML = `
    <main class="translator-page">
      <header class="translator-hero">
        <p class="eyebrow">STM32 Tutorial</p>
        <h1>Plan Translator</h1>
        <p class="hero-copy">Teach teammates how <code>g_layouts</code>, <code>g_plan_table</code>, <code>g_plan_table_lifo</code>, and <code>g_route_table</code> connect. Start with a color placement, choose the plan table, decode each action, then see which target node firmware uses for the route lookup.</p>
        <nav class="page-nav">
          <a class="page-link-button" href="${appPageHref("simulator", appBaseHref)}">Open Simulator</a>
          <a href="${appPageHref("translator", appBaseHref)}">Refresh Translator</a>
        </nav>
      </header>

      <section class="translator-grid">
        <article class="section-card">
          <h2>What This Page Teaches</h2>
          <ul class="translator-bullets">
            <li><code>g_layouts</code> tells which colors exist in each branch slot.</li>
            <li><code>g_plan_table</code> is the normal omniscient export, while <code>g_plan_table_lifo</code> is the true-LiFo constrained export.</li>
            <li>Each action uses <code>type</code>, <code>arg0</code>, and <code>arg1</code> to encode branch, color, or slot references.</li>
            <li>The decoded action becomes a target node such as <code>NODE_R_GREEN_2</code> or <code>NODE_ZONE_RED</code>.</li>
            <li>Firmware then uses <code>g_route_table[current_node][target_node]</code> to travel there.</li>
            <li>This tutorial now shows the actual looked-up route entry content, including <code>valid</code>, <code>step_count</code>, <code>steps</code>, and the underlying node path.</li>
          </ul>
        </article>

        <article class="section-card">
          <h2>What To Refer To</h2>
          <ul class="translator-bullets">
            <li>Layout ID: which legal 4x2 color placement is active.</li>
            <li>Action type: pick lock, drop lock, pick resource, drop resource, or return home.</li>
            <li><code>arg0</code>: branch ID or color ID.</li>
            <li><code>arg1</code>: slot index when the action is <code>ACT_PICK_RESOURCE</code>.</li>
            <li>Target node: the node ID firmware uses to query <code>g_route_table</code>.</li>
          </ul>
          <div class="translator-legend">
            <p><strong>Branch IDs</strong>: ${BRANCH_ID_LABELS.map((branch, index) => `${index} = ${branch}`).join(", ")}</p>
            <p><strong>Color IDs</strong>: ${COLOR_ID_LABELS.map((color, index) => `${index} = ${color}`).join(", ")}</p>
            <p><strong>Slot IDs</strong>: ${SLOT_ID_LABELS.map((slot, index) => `${index} = ${slot}`).join(", ")}</p>
          </div>
        </article>
      </section>

      <section class="translator-grid">
        <article class="section-card">
          <h2>Manual Color Placement</h2>
          <p class="hero-copy">This is the main learning path. Set the two resource colors for each branch, and the page explains the matching generated plan.</p>
          <label>Plan Table
            <select id="manualPlanMode">
              <option value="normal">Normal g_plan_table</option>
              <option value="lifo">LiFo g_plan_table_lifo</option>
            </select>
          </label>
          <div class="translator-alt-input">
            <h3>Use Layout ID Instead</h3>
            <p class="translator-alt-copy">Layout ID is an alternative way to choose the exact same legal placement. Enter any legal id from <code>0</code> to <code>575</code> and the color grid will sync automatically.</p>
            <label class="translator-inline-field">Layout ID
              <input id="manualLayoutId" type="number" min="0" max="575" step="1" placeholder="0" />
            </label>
          </div>
          <div id="placementEditor" class="translator-placement-grid"></div>
          <p id="placementStatus" class="translator-status"></p>
          <div id="manualResult"></div>
        </article>

        <article class="section-card">
          <h2>Paste Plan Row</h2>
          <p class="hero-copy">If a teammate already copied one row from <code>generated_plan_table.c</code> or <code>generated_plan_table_lifo.c</code>, paste it here to decode the action list.</p>
          <textarea id="planRowInput" class="translator-textarea" spellcheck="false" placeholder="{ .action_count = 3, .actions = { { ACT_PICK_LOCK, 0, 0 }, { ACT_DROP_LOCK, 0, 0 }, { ACT_RETURN_START, 0, 0 } } }"></textarea>
          <div class="row">
            <button id="translatePlanRow">Translate Plan Row</button>
          </div>
          <p id="planRowStatus" class="translator-status"></p>
          <div id="pasteResult"></div>
        </article>
      </section>
    </main>
  `;

  const placementEditor = document.getElementById("placementEditor") as HTMLDivElement;
  const placementStatus = document.getElementById("placementStatus") as HTMLParagraphElement;
  const manualResult = document.getElementById("manualResult") as HTMLDivElement;
  const manualPlanMode = document.getElementById("manualPlanMode") as HTMLSelectElement;
  const manualLayoutIdInput = document.getElementById("manualLayoutId") as HTMLInputElement;
  const planRowInput = document.getElementById("planRowInput") as HTMLTextAreaElement;
  const translatePlanRowBtn = document.getElementById("translatePlanRow") as HTMLButtonElement;
  const planRowStatus = document.getElementById("planRowStatus") as HTMLParagraphElement;
  const pasteResult = document.getElementById("pasteResult") as HTMLDivElement;

  let placement = createDefaultTutorialPlacement();
  let selectedPlanMode: TutorialPlanMode = "normal";

  function readPlacementFromEditor(): Placement {
    const nextPlacement = createDefaultTutorialPlacement();
    placementEditor.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
      const branch = select.dataset.branch as BranchId;
      const slot = Number(select.dataset.slot) as 0 | 1;
      nextPlacement[branch][slot] = select.value as Placement[typeof branch][typeof slot];
    });
    return nextPlacement;
  }

  function renderPlacementEditor(): void {
    placementEditor.innerHTML = BRANCHES.map((branch) => `
      <div class="translator-placement-card">
        <h3>${branch}</h3>
        <label>First slot
          <select data-branch="${branch}" data-slot="0">
            ${COLORS.map((color) => `<option value="${color}" ${placement[branch][0] === color ? "selected" : ""}>${color}</option>`).join("")}
          </select>
        </label>
        <label>Second slot
          <select data-branch="${branch}" data-slot="1">
            ${COLORS.map((color) => `<option value="${color}" ${placement[branch][1] === color ? "selected" : ""}>${color}</option>`).join("")}
          </select>
        </label>
      </div>
    `).join("");

    placementEditor.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
      select.onchange = () => {
        placement = readPlacementFromEditor();
        updateManualPlacementResult();
      };
    });
  }

  function syncPlacementEditorFromState(): void {
    placementEditor.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
      const branch = select.dataset.branch as BranchId;
      const slot = Number(select.dataset.slot) as 0 | 1;
      select.value = placement[branch][slot];
    });
  }

  function updateManualPlacementResult(): void {
    const errors = validatePlacementRows(placement);
    if (errors.length > 0) {
      manualLayoutIdInput.value = "";
      placementStatus.textContent = errors.join(" ");
      manualResult.innerHTML = "";
      return;
    }

    const layoutId = findLayoutIdForPlacement(placement);
    if (layoutId === null) {
      manualLayoutIdInput.value = "";
      placementStatus.textContent = "This placement is not a legal layout.";
      manualResult.innerHTML = "";
      return;
    }

    manualLayoutIdInput.value = String(layoutId);
    const plan = buildPlanForPlacement(placement, selectedPlanMode);
    const steps = buildTutorialExecution(plan);
    placementStatus.textContent = `Matched legal layout ${layoutId}. This explanation is using ${selectedPlanMode === "lifo" ? "g_plan_table_lifo" : "g_plan_table"}.`;
    renderTutorialResult(
      manualResult,
      selectedPlanMode === "lifo" ? "Manual Placement Tutorial (LiFo)" : "Manual Placement Tutorial",
      placement,
      planToCompactText(plan.action_count, steps),
      plan.action_count,
      steps,
      layoutId
    );
  }

  translatePlanRowBtn.onclick = () => {
    try {
      const parsed = parsePlanRowText(planRowInput.value);
      const steps = buildTutorialExecution(parsed);
      planRowStatus.textContent = "Plan row decoded successfully.";
      renderTutorialResult(
        pasteResult,
        "Pasted Plan Tutorial",
        null,
        planRowInput.value.trim(),
        parsed.action_count,
        steps,
        null
      );
    } catch (error) {
      planRowStatus.textContent = error instanceof Error ? error.message : "Failed to parse the plan row.";
      pasteResult.innerHTML = "";
    }
  };

  manualLayoutIdInput.onchange = () => {
    const layoutId = clampTutorialLayoutId(Number(manualLayoutIdInput.value));
    manualLayoutIdInput.value = String(layoutId);
    placement = getPlacementForLayoutId(layoutId);
    syncPlacementEditorFromState();
    updateManualPlacementResult();
  };

  manualPlanMode.onchange = () => {
    selectedPlanMode = manualPlanMode.value as TutorialPlanMode;
    updateManualPlacementResult();
  };

  renderPlacementEditor();
  updateManualPlacementResult();
}
