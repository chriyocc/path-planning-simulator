# STM32 HTML Slides Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone HTML slideshow app for the STM32 firmware tutorial and wire root commands for local development and build output.

**Architecture:** A new `slides/` subproject will use Vite and React, import the existing tutorial scene data from the video project, and provide browser navigation, print-friendly layout, and a small tested helper layer for slide index control.

**Tech Stack:** Vite, React, TypeScript, Vitest

---

## Chunk 1: Root Wiring

### Task 1: Add root slideshow scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add install, dev, build, and test scripts for the slideshow subproject**

## Chunk 2: Subproject Scaffold

### Task 2: Create the slideshow package

**Files:**
- Create: `slides/package.json`
- Create: `slides/tsconfig.json`
- Create: `slides/vite.config.ts`
- Create: `slides/index.html`
- Create: `slides/src/main.tsx`

- [ ] **Step 1: Define package dependencies and scripts**
- [ ] **Step 2: Configure Vite and TypeScript**
- [ ] **Step 3: Add the browser entrypoint**

## Chunk 3: Test-First Helper Layer

### Task 3: Add navigation helper tests

**Files:**
- Create: `slides/tests/navigation.test.ts`
- Create: `slides/src/lib/navigation.ts`

- [ ] **Step 1: Write failing tests for clamping and next/previous navigation**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement the minimal helper logic**
- [ ] **Step 4: Re-run tests to verify success**

## Chunk 4: Slide UI

### Task 4: Build the slideshow interface

**Files:**
- Create: `slides/src/App.tsx`
- Create: `slides/src/styles.css`
- Create: `slides/src/components/SlideView.tsx`
- Create: `slides/src/components/ControlBar.tsx`

- [ ] **Step 1: Render the imported tutorial scenes**
- [ ] **Step 2: Add keyboard and button navigation**
- [ ] **Step 3: Add a presenter-style side panel**
- [ ] **Step 4: Make slides print-friendly**

## Chunk 5: Verification

### Task 5: Validate the workflow

**Files:**
- Modify if needed: `slides/package-lock.json`

- [ ] **Step 1: Install dependencies**
- [ ] **Step 2: Run slideshow tests**
- [ ] **Step 3: Build the slideshow**
- [ ] **Step 4: Confirm root scripts work**
