# RoboSurvivor 2026 Strategy Simulator

Web + TypeScript topological simulator for RoboSurvivor 2026

## What it includes
- Deterministic map graph and line-type edges.
- Seeded randomization of 8 colored resources across 4 branches.
- FSM-friendly action simulation with legality checks.
- Four strategy policies:
  - `Baseline_SingleCarry`
  - `BusRoute_Parametric`
  - `ValueAware_Deadline`
  - `AdaptiveSafe`
- Monte Carlo batch evaluation and policy ranking.
- Visual playback on Canvas with map overlay and robot trace.
- Firmware-facing exports:
  - `route_table.json`
  - `policy_rules.json`
  - `fsm_contract.md`

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL in a browser.

## Tests

```bash
npm test
```

## Build

```bash
npm run build
```

## Generate firmware artifacts

```bash
npm run generate:artifacts
```

Outputs are written to `artifacts/`.

## Rules gate

Use [rules_matrix.md](/Users/yoyojun/Documents/New%20project/docs/rules_matrix.md) as the mandatory sign-off checklist before policy freeze.
