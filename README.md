# RoboSurvivor 2026 Strategy Simulator

Web + TypeScript topological simulator for RoboSurvivor 2026.

## What it includes
- Deterministic map graph and line-type edges.
- Seeded randomization of 8 colored resources across 4 branches.
- FSM-friendly action simulation with legality checks.
- Five strategy policies:
  - `Baseline_SingleCarry`
  - `BusRoute_Parametric`
  - `ValueAware_Deadline`
  - `AdaptiveSafe`
  - `Optimal_Omniscient`
- Monte Carlo batch evaluation and policy ranking.
- Visual playback on Canvas with map overlay and robot trace.
- Editable map geometry in the browser.
- Batch loading toast while Monte Carlo evaluation is running.
- Firmware-facing exports:
  - `route_table.json`
  - `policy_rules.json`
  - `fsm_contract.md`

## Current map model
- Four bottom branches contain cargo in this order:
  - black lock
  - first colored resource
  - second colored resource
- Resource pickup order is enforced per branch:
  - slot 1 must be picked before slot 2
- The top section contains two valid black lock drop zones:
  - `BLACK_ZONE`
  - `BLACK_ZONE_RIGHT`
- The black-zone area is modeled as a rectangle with connecting top and bottom edges, and policies/simulator choose the nearest valid black zone for lock drops.

## Current simulator rules
- Carry capacity applies to total carried items:
  - black locks
  - colored resources
- Multiple black locks can be carried if capacity allows.
- Deposited locks are tracked by the exact black zone they were dropped into.
- Colored resources can only be scored after the corresponding branch lock has been delivered.
- If the robot is already at the correct color zone for a carried resource, the heuristic policies will unload immediately before leaving the zone.

## Policy notes
- `Baseline_SingleCarry` is intentionally conservative and behaves like a one-by-one fallback policy.
- `BusRoute_Parametric` is the main heuristic capacity-aware policy and can opportunistically chain a second lock when it is time-efficient.
- `ValueAware_Deadline` is deadline-sensitive and prioritizes higher-value branches/resources under tighter time budgets.
- `AdaptiveSafe` switches between conservative and deadline-aware heuristics based on remaining time.
- `Optimal_Omniscient` uses the planner and assumes full knowledge of the randomized layout for benchmarking.

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

## Development notes
- Default carry capacity in the UI is `2`.
- Default line speeds are configured in [src/simulator.ts](/Users/yoyojun/Documents/New%20project/src/simulator.ts), including the current `SINE` tuning.
- The map editor updates node positions and recomputes edge distances from geometry.

## Rules gate

Use [rules_matrix.md](/Users/yoyojun/Documents/New%20project/docs/rules_matrix.md) as the mandatory sign-off checklist before policy freeze.
