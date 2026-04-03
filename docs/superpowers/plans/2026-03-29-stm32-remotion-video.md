# STM32 Remotion Video Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Remotion subproject for the STM32 firmware tutorial and wire root scripts so the repo can preview and render the video locally.

**Architecture:** The existing simulator package remains unchanged except for root script delegation. A new `video/` subproject contains Remotion dependencies, typed tutorial content, animation helpers, the main composition, and tests for pure helper logic.

**Tech Stack:** Remotion, React, TypeScript, Vitest, npm prefix scripts

---

## Chunk 1: Root Wiring

### Task 1: Add root proxy scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update scripts for video workflows**
- [ ] **Step 2: Keep existing simulator scripts intact**
- [ ] **Step 3: Add delegated commands for install, studio, render, and test**

## Chunk 2: Video Subproject Scaffold

### Task 2: Create the standalone package

**Files:**
- Create: `video/package.json`
- Create: `video/tsconfig.json`
- Create: `video/remotion.config.ts`
- Create: `video/src/index.ts`
- Create: `video/src/Root.tsx`

- [ ] **Step 1: Define package dependencies and scripts**
- [ ] **Step 2: Configure TypeScript for the subproject**
- [ ] **Step 3: Register the main composition entrypoint**

## Chunk 3: Test-First Helper Layer

### Task 3: Write tests for content timing helpers

**Files:**
- Create: `video/tests/tutorialData.test.ts`
- Create: `video/src/content/tutorialData.ts`
- Create: `video/src/lib/timing.ts`

- [ ] **Step 1: Write failing tests for duration and structure**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement minimal helper logic**
- [ ] **Step 4: Run tests to verify they pass**

## Chunk 4: Composition UI

### Task 4: Build the tutorial composition

**Files:**
- Create: `video/src/compositions/Stm32FirmwareTutorial.tsx`
- Create: `video/src/components/SceneFrame.tsx`
- Create: `video/src/components/SceneTitle.tsx`
- Create: `video/src/components/BulletList.tsx`
- Create: `video/src/components/CodeCard.tsx`
- Create: `video/src/components/FlowDiagram.tsx`

- [ ] **Step 1: Add the overall layout shell**
- [ ] **Step 2: Build reusable scene primitives**
- [ ] **Step 3: Map tutorial content into animated scenes**
- [ ] **Step 4: Keep all motion frame-driven**

## Chunk 5: Verify Local Workflow

### Task 5: Install and verify the new workflow

**Files:**
- Modify if needed: `video/package-lock.json`

- [ ] **Step 1: Install subproject dependencies**
- [ ] **Step 2: Run video tests**
- [ ] **Step 3: Render the tutorial locally**
- [ ] **Step 4: Confirm output path and commands are usable from repo root**
