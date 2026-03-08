# ARC RoboSurvivor 2026 Strategy Manual

Status: `Based on official rulebook at /Users/yoyojun/Library/Mobile Documents/com~apple~CloudDocs/My UNI/CYBERTRON/ARC/RULEBOOK_MARKDOWN.md`

## 1. Purpose

This manual defines the team's recommended technical direction for ARC RoboSurvivor 2026 and records where the current simulator matches or diverges from the official rulebook.

Primary goal:

- Build a legal, robust, high-scoring autonomous system
- Avoid relying on rule-gray behavior as the main competition plan
- Use simulation as a planning tool, not as an unverified substitute for the official rules

## 2. Official Rules That Matter Most

These rule points directly shape the strategy architecture:

- The robot must be fully autonomous, and remote controls for human operation are not allowed.
- The robot is impounded before rounds; no code changes or physical modifications are allowed after impound.
- During the 3-minute setup, the robot may be moved by hand anywhere on the field to calibrate sensors.
- During setup, no laptop connection, code download, or autonomous driving is allowed.
- Resource arrangement is randomized once by judges after impound and remains the same for all teams in that round.
- The first row contains exactly one each of `R/G/B/Y`.
- The second row contains exactly one each of `R/G/B/Y`.
- Colored resources may only be scored if the corresponding branch has been unlocked by placing that branch's black lock in the black zone.
- A perfect run requires all 8 colored resources placed correctly, all 4 black locks placed correctly, and return to start before timeout.
- Tie-breaker priority starts with faster completion time.

## 3. Consequence For Planning

The official row constraints reduce the legal layout count.

Official rulebook model:

- First row is a permutation of `R/G/B/Y`: `4! = 24`
- Second row is a permutation of `R/G/B/Y`: `4! = 24`
- Total legal layouts: `24 * 24 = 576`

## 4. Recommended Competition Architecture

### 4.1 Main Plan

Recommended main path:

1. Offline, enumerate all `576` legal layouts.
2. For each layout, compute the best high-level action plan.
3. Store layout-to-plan tables in firmware-accessible data.
4. During setup, legally calibrate and, if useful, read layout information using onboard sensors while the robot is moved by hand.
5. At run start, the robot uses the known or inferred layout index to select the corresponding precomputed plan.
6. The robot executes that plan through a line-following state machine.
7. If execution deviates too much, fall back to a simpler heuristic policy.

### 4.2 What We Store

Store high-level task plans, not raw motor timings.

Examples of high-level actions:

- `PICK_LOCK(RED)`
- `DROP_LOCK(RED)`
- `PICK_RESOURCE(R_BLUE_1)`
- `DROP_RESOURCE(YELLOW)`
- `RETURN_START`

Do not store:

- fixed PWM sequences
- fixed left/right time scripts
- open-loop dead-reckoning motion scripts between zones

Reason:

- The rulebook requires line tracing.
- Real execution error makes pre-expanded low-level scripts fragile.

### 4.3 Why This Path Is Strong

- It keeps online computation very small.
- It still allows near-optimal task sequencing.
- It aligns with the field being fixed.
- It respects the round-level randomization structure.
- It preserves a clean separation between planning and control.

## 4A. Scheme A: Gray-Zone Manual Layout Selection

This is the gray-zone scheme the team has discussed. It is documented here so everyone understands what it is, why it is attractive, and why it is not recommended as the official main approach.

### 4A.1 Flow

1. Before impound or before competition day, precompute all `576` legal layouts and store a plan table onboard.
2. After the round layout is revealed, a human observes the field layout.
3. A human or phone tool computes the corresponding layout index.
4. During setup or before start, the human inputs that layout index into the robot.
5. The robot directly loads the matching plan and executes it after start.

### 4A.2 Why It Is Attractive

- Simplest decision logic onboard
- No need for online layout inference
- Direct access to the exact precomputed optimal plan

### 4A.3 Why It Is Gray-Zone

The official rulebook does not explicitly contain a sentence saying "manual pre-start layout index entry is forbidden." However, it does clearly require autonomy and clearly bans human remote control during the run.

Risk factors:

- A referee may interpret manual layout index entry as human-provided environment interpretation rather than robot autonomy.
- The team would be relying on a permissive interpretation instead of a clearly safe one.
- This is hard to defend consistently if challenged.

### 4A.4 Team Position

- Record for reference only
- Do not use as the official main strategy
- Do not build the project around this assumption

## 4B. Scheme B: Recommended Autonomous Layout Inference

This is the recommended main competition scheme.

### 4B.1 Core Idea

Do not tell the robot which layout is active.

Instead:

- preload all `576` legal layouts
- let the robot observe resource colors by itself
- eliminate impossible layouts from a candidate set
- switch to the matching optimal plan once the layout is uniquely identified or sufficiently constrained

### 4B.2 Flow

1. Offline, generate all `576` legal layouts.
2. Offline, compute the best plan for each layout.
3. Store all layouts and plans onboard.
4. At run start, initialize `candidate_set = all 576 layouts`.
5. The robot performs legal autonomous observation during the run using onboard sensors.
6. After each observation, remove any candidate layout inconsistent with what was observed.
7. If the candidate set becomes size `1`, lock the layout index.
8. Load the corresponding optimal plan.
9. Continue execution with normal closed-loop navigation and manipulation.
10. If the layout is still not unique, keep using a safe heuristic while collecting more observations.

### 4B.3 Why It Avoids Gray-Zone Risk

- No human tells the robot the answer.
- No external device provides the layout number.
- All environment interpretation happens onboard.
- The robot remains autonomous in both sensing and decision-making.

### 4B.4 Why This Is Easier Than It Sounds

Because the rulebook constrains the layout space to `576`, the robot does not need complex full-probability reasoning in the first implementation.

A simple deterministic candidate filter is enough:

- observe a slot color
- remove all layouts that disagree
- repeat

This is often easier and more robust than a full Bayesian system.

### 4B.5 Optional Extension

If sensor readings are noisy, the team can later upgrade from deterministic elimination to a probabilistic model such as Bayesian filtering. That is an optimization, not a requirement for the first working version.

### 4B.6 Team Position

- This is the official recommended strategy direction.
- This should be the basis for firmware, simulator evolution, and task allocation.

## 5. Compliance Interpretation

## 5.1 Low-Risk / Recommended

- Precompute all legal layouts offline before competition day.
- Burn all plan tables into firmware before impound.
- During setup, manually move the robot to colored markers for sensor calibration.
- During setup, allow the robot electronics to read sensors while it is moved by hand.
- During the run, let the robot choose its plan autonomously from onboard data.
- Prefer onboard layout inference over human-provided layout identification.

## 5.2 High-Risk / Not Recommended As Main Plan

- A human looks at the layout, computes the layout number on a phone, and manually tells the robot which table to use.

Why this is not recommended:

- The rulebook clearly requires autonomy.
- The rulebook clearly bans remote control during the run.
- The text does not explicitly say "manual pre-start table input is DQ", but this behavior is vulnerable to a referee interpreting it as human-provided decision input rather than robot autonomy.

Team decision:

- Do not use manual layout-number input as the main official strategy.
- Treat this as `Scheme A`, a documented gray-zone path, not the team's primary competition path.

## 5.3 Setup-Phase Field Reading

The rulebook explicitly allows manual placement of the robot anywhere on the field to calibrate sensors during the 3-minute setup.

This means:

- Hand-carried sensor reading during setup is legally supportable.

Constraints:

- no laptop
- no code download
- no autonomous movement
- return to start before setup ends

Team decision:

- Setup-phase sensor reading may be used, but only in a way that still looks like calibration and remains operationally simple.
- The main strategy must still be robust enough to run even if setup-phase reading is incomplete or noisy.

## 6. Current Simulator Alignment Check

This section compares the current project implementation against the official rulebook.

### 6.1 Matches Official Rules

- Timeout is `600s`.
- Leave-start bonus is `+5`.
- Reach-junction bonus is `+10`.
- Lock scoring is `+10` secure and `+20` place.
- Perfect-run bonus is `+40`.
- Colored resource placement points are modeled as `20/30/40/50`.
- Unlock-before-pick is enforced.
- Slot 1 before slot 2 in a branch is enforced, which is consistent with the physical branch order modeled by the simulator.
- A black lock can be picked, carried, and dropped separately from colored resources.

### 6.2 Remaining Gaps Against Official Rules

The following sections describe what is still not modeled after the latest fixes.

#### A. Wrong placement behavior is not modeled

Current simulator:

- `DROP_RESOURCE(color)` only allows dropping a matching color already in inventory and then immediately awards branch-based placement points.

Official rulebook:

- Wrong placement yields `0`.

Problem:

- The simulator cannot represent an attempted wrong placement outcome.

Impact:

- The simulator is optimistic about delivery correctness.
- It is unsuitable for studying placement-classification error and its scoring consequences.

#### B. Toppled resource behavior is not modeled

Official rulebook includes:

- toppled resources
- unreachable resources removed by referee
- no reset by referee

Current simulator:

- no topple dynamics
- no resource loss due to collisions
- no referee removals

Impact:

- The simulator underestimates mechanical error cost.

#### C. Retry flow is not modeled

Official rulebook includes:

- derailment
- stalling
- retry behavior
- held colored resources lost on retry
- held black locks returned to original position on retry

Current simulator:

- no retry mechanic exists in the scoring loop

Impact:

- The simulator is useful for ideal autonomous planning, but not yet for realistic match resilience analysis.

#### D. Capacity is assumed, not rule-backed

Current simulator default:

- `carry_capacity = 2`

Official rulebook:

- does not clearly define a carry-capacity limit in the text reviewed

Impact:

- The simulator imposes a design assumption that may or may not match practical judging.
- Multi-carry policy conclusions should be treated as team assumptions, not official game law, until clarified.

#### E. Route model is topological, not sensor-faithful

Current simulator:

- navigation is represented by shortest-path graph travel

Official rulebook:

- requires line following and penalizes derailment and short-cutting

Impact:

- The simulator is good for task-order optimization
- It is not sufficient as a full execution-risk simulator

## 7. Team Interpretation Of The Simulator

The current simulator is still valuable, but we should redefine what it is for.

Use it for:

- route-order planning
- action-order planning
- comparing high-level policies
- generating precomputed plan tables

Do not treat it as authoritative for:

- final official score prediction
- retry behavior
- topple behavior
- real-world control robustness
- formal legality beyond the rules already encoded

## 8. Required Simulator Fixes

Priority `P1`:

- Add optional wrong-placement simulation path.
- Add retry and held-object penalty handling.
- Add toppled-resource modeling if the team wants robustness simulation.

## 9. Team Operating Guidance

### 9.1 Main Official Strategy

- Use the official `576`-layout precompute model.
- Use onboard sensing plus legal setup calibration.
- Use a high-level action plan table.
- Execute through a line-following closed-loop state machine.

### 9.2 Backup Strategy

- Keep a simpler heuristic policy available onboard.
- If plan lookup fails, identification is uncertain, or execution drifts too far, switch to the backup policy.

### 9.3 What Not To Rely On

- human-provided layout index
- open-loop motion scripts
- simulator score totals without correcting scoring
- simulator assumptions that are not explicitly in the rulebook

## 10. Immediate Next Steps

1. Build a `576`-layout indexer and precompute export pipeline.
2. Add optional wrong-placement modeling.
3. Add retry and held-item penalty modeling.
4. Decide whether setup-phase field reading will be used operationally, and if yes, define a strict SOP.
