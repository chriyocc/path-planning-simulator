# RoboSurvivor 2026 Path Planning Simulator

Browser-based TypeScript simulator for comparing routing policies, visualizing traces, and exporting the two firmware-facing artifacts that are actually used downstream.

## What the app does

- Simulates one RoboSurvivor round on a graph-based map with seeded branch randomization.
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
- Batch mode ranks every policy on the same seed range for fair comparison.

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

## Project structure

- [`src/main.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/main.ts): browser UI, playback, exports, and map editor wiring.
- [`src/policies.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/policies.ts): policy decision logic.
- [`src/simulator.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/simulator.ts): round execution and legality checks.
- [`src/firmware.ts`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/src/firmware.ts): firmware-facing export data.
- [`docs/rules_matrix.md`](/Users/yoyojun/Documents/GitHub/path-planning-simulator/docs/rules_matrix.md): sign-off checklist for rules and policy assumptions.

## Notes

- Keep the same seed when comparing policies on a single layout.
- Use batch mode instead of one-off runs when you want a meaningful policy comparison.
- Geometry edits change edge distances, so route timing and heuristic choices can shift after map edits.
