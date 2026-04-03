# Single Source Policy Compare Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UI action that compares all policies on the currently selected single-run source, whether that source comes from a direct layout id or a seed.

**Architecture:** Keep the new feature separate from the existing batch ranking. Add one new compare button, one new results panel, and a formatter/helper so the comparison output stays easy to test. Use the current `batchSource` control only to decide whether to simulate by `layout_id` or `seed`.

**Tech Stack:** TypeScript, Vite, Vitest

---

## Chunk 1: Comparison Output

### Task 1: Add formatter coverage first

**Files:**
- Modify: `/Users/yoyojun/Documents/GitHub/path-planning-simulator/tests/runtime-panels.test.ts`
- Modify: `/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/runtimePanels.ts`

- [ ] Step 1: Write a failing test for single-source comparison formatting.
- [ ] Step 2: Run `npm test -- tests/runtime-panels.test.ts` and confirm the new test fails for the missing formatter.
- [ ] Step 3: Implement the minimal formatter in `src/runtimePanels.ts`.
- [ ] Step 4: Re-run `npm test -- tests/runtime-panels.test.ts` and confirm it passes.

## Chunk 2: UI Wiring

### Task 2: Add compare button and panel

**Files:**
- Modify: `/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/main.ts`

- [ ] Step 1: Add a `Compare Policies` button near the round actions controls.
- [ ] Step 2: Add a dedicated sidebar panel for the single-source comparison output.
- [ ] Step 3: Implement a handler that runs all policies against the current source mode without replacing the active playback result.
- [ ] Step 4: Render the formatted comparison output into the new panel.

## Chunk 3: Verification

### Task 3: Verify feature behavior

**Files:**
- Modify: `/Users/yoyojun/Documents/GitHub/path-planning-simulator/tests/runtime-panels.test.ts`

- [ ] Step 1: Re-run `npm test -- tests/runtime-panels.test.ts`.
- [ ] Step 2: Run `npm run build`.
- [ ] Step 3: If needed, run the relevant simulator/UI tests that cover nearby behavior.
