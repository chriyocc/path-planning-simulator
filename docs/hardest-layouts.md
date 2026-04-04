# Hardest Layouts Report

This document summarizes the slowest legal layouts in the simulator based on an exact sweep over all `576` legal layouts.

## Scope

Selected policies:

- `Optimal_Omniscient`
- `Inference_ExpectedValue`
- `BusRoute_Parametric`
- `Bus_RevealedAfterPickup`
- `Inference_BusHybrid`

Ranking rule:

- overall hardest layouts are ranked by highest mean completion time across those five policies
- per-policy hardest layouts are ranked by that individual policy's completion time

Artifacts:

- JSON: [generated/hardest-layouts.json](/Users/yoyojun/Documents/GitHub/path-planning-simulator/generated/hardest-layouts.json)
- CSV: [generated/hardest-layouts.csv](/Users/yoyojun/Documents/GitHub/path-planning-simulator/generated/hardest-layouts.csv)

## Overall Hardest Layouts

Top 12 by mean completion time across the selected policies:

| Rank | Layout ID | Mean | Slowest Policy | Slowest Time |
|---|---:|---:|---|---:|
| 1 | 111 | 222.07s | `Inference_BusHybrid` | 240.59s |
| 2 | 69 | 221.76s | `Inference_BusHybrid` | 239.44s |
| 3 | 553 | 221.52s | `Inference_BusHybrid` | 234.69s |
| 4 | 212 | 221.17s | `BusRoute_Parametric` | 234.74s |
| 5 | 408 | 221.13s | `Inference_BusHybrid` | 233.54s |
| 6 | 567 | 221.06s | `BusRoute_Parametric` | 240.19s |
| 7 | 429 | 220.90s | `BusRoute_Parametric` | 240.19s |
| 8 | 254 | 220.78s | `BusRoute_Parametric` | 234.74s |
| 9 | 529 | 220.56s | `Inference_BusHybrid` | 229.24s |
| 10 | 552 | 220.32s | `Inference_BusHybrid` | 233.54s |
| 11 | 234 | 220.25s | `BusRoute_Parametric` | 230.99s |
| 12 | 49 | 220.17s | `BusRoute_Parametric` | 240.19s |

## Practical Stress-Test Set

If you want a compact set of layouts to reuse for debugging and tuning, these are the most valuable:

- `111`
- `69`
- `212`
- `567`
- `429`
- `254`
- `49`
- `553`

Why these:

- they are near the top of the overall hardest list
- or they recur in the per-policy hardest sets
- together they cover both bus-family pain points and hybrid/inference pain points

## Per-Policy Patterns

### Bus-family pain points

These layouts are especially bad for the bus-style policies:

- `423`
- `429`
- `567`
- `573`
- `206`
- `212`
- `254`
- `260`

`BusRoute_Parametric` is worst on:

- `48`
- `49`
- `96`
- `97`
- `423`
- `429`
- `567`
- `573`

`Bus_RevealedAfterPickup` is worst on:

- `423`
- `429`
- `567`
- `573`
- `206`
- `212`
- `254`
- `260`

### Hybrid pain points

`Inference_BusHybrid` is worst on:

- `61`
- `63`
- `109`
- `111`
- `67`
- `69`
- `115`
- `117`

### Inference-expected pain points

`Inference_ExpectedValue` is worst on:

- `514`
- `46`
- `368`
- `382`
- `520`
- `16`
- `157`
- `160`

## Contrarian Take

There is no single universal “hardest layout.”

Different policy families suffer from different layout families:

- bus-family policies struggle more on the `423 / 429 / 567 / 573` cluster and the `206 / 212 / 254 / 260` cluster
- `Inference_BusHybrid` struggles more on the `61 / 63 / 67 / 69 / 109 / 111 / 115 / 117` cluster
- `Inference_ExpectedValue` has a different slower-tail pattern again, with `514` standing out

So if you benchmark only one or two layouts, you can easily choose a policy winner for the wrong reason.

## Recommended Usage

Use the artifacts in two ways:

1. For quick regression tests, use the practical stress-test set above.
2. For policy-specific tuning, use the per-policy hardest lists from the JSON/CSV files.

If needed, the next useful extension would be a second report that also includes the actual slot-color placements for each hard layout ID so you can inspect *why* each layout is difficult.
