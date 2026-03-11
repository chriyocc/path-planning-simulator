# RoboSurvivor 2026 Path Planning Simulator

Browser-based TypeScript simulator for comparing routing policies, visualizing traces, and exporting the two firmware-facing artifacts that are actually used downstream.

## What the app does

- Simulates one RoboSurvivor round on a graph-based map with layout-id-first selection and optional seed-based reproduction.
- Compares five policies:
  - `Baseline_SingleCarry`
  - `BusRoute_Parametric`
  - `ValueAware_Deadline`
  - `AdaptiveSafe`
  - `Optimal_Omniscient`
- Animates the robot trace on the canvas map.
- Lets you edit node geometry and line types in the browser.
- Exports:
  - `route_table.json`
  - `policy_rules.json`

## Artifact status

- `route_table.json` is necessary if you want the selected run converted into a node-by-node motion table for firmware.
- `policy_rules.json` is necessary if you want compact guard/action rules alongside the route output.
- `fsm_contract.md` was not required by the app runtime, not needed by the simulator UI, and not part of the practical export path, so it has been removed from the generated artifacts.

## UI highlights

- Each major section includes an `Info` button with detailed explanations.
- The selected policy now shows a plain-language explanation and its decision flow.
- Trace playback supports pause/resume.
- Batch mode can compare policies over seed sampling or an exact sweep of all 576 legal layouts.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL in your browser.

## Test

```bash
npm test
```

## Build

```bash
npm run build
```

## Generate artifacts

```bash
npm run generate:artifacts
```

Generated files are written to [`artifacts/`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/artifacts).

## Generate STM32 C tables

```bash
npm run generate:stm32
```

Generated files are written to [`generated/stm32/`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/generated/stm32), including:

- normal omniscient export:
  `generated_plan_table.c/.h`
- true-LiFo constrained export:
  `generated_plan_table_lifo.c/.h`
- shared layout and route tables:
  `generated_layouts.*`
  `generated_routes.*`

## Project structure

- [`src/main.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/main.ts): browser UI, playback, exports, and map editor wiring.
- [`src/policies.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/policies.ts): policy decision logic.
- [`src/simulator.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/simulator.ts): round execution and legality checks.
- [`src/firmware.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/firmware.ts): firmware-facing export data.
- [`docs/rules_matrix.md`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/docs/rules_matrix.md): sign-off checklist for rules and policy assumptions.

## Notes

- Use `layout_id` on the main page when you want to discuss or reproduce one exact legal field arrangement.
- Use the advanced `seed` field when you want to map a seeded random case back to a layout ID.
- Use `Exact layout sweep` batch mode for the strongest uniform benchmark across all 576 legal layouts.
- Geometry edits change edge distances, so route timing and heuristic choices can shift after map edits.
