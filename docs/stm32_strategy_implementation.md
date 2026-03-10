# STM32 Implementation Guide For The Main Strategy

## Purpose

This document explains how to implement the main strategy from `docs/arc2026_strategy_manual.md` on an STM32 robot.

The target strategy is:

1. Precompute all legal layouts offline.
2. Precompute a high-level action plan for each layout.
3. Store those plans in firmware-readable tables.
4. Let the robot infer the active layout onboard.
5. Execute the selected plan through a closed-loop line-following state machine.
6. Fall back to a simpler heuristic if plan execution becomes unreliable.

This is the important idea:

- planning is done offline on a PC
- sensing and execution are done onboard on the STM32
- firmware stores high-level actions, not raw motor scripts

That separation is the reason this approach is realistic for an embedded robot.

## Big Idea

The strategy manual says the official layout space is only `576` legal layouts because:

- row 1 is a permutation of `R/G/B/Y`
- row 2 is a permutation of `R/G/B/Y`
- total layouts = `24 * 24 = 576`

That is small enough to precompute offline.

So the STM32 does not need to run a heavy planner during the match. It only needs to:

- maintain a candidate set of legal layouts
- remove layouts that disagree with observed colors
- choose the matching plan once the layout is known enough
- execute one high-level action at a time

This is much better than trying to do full optimal search on the microcontroller during a run.

## What Comes From The Current Code

The current repo already separates the problem into three layers that map well to firmware:

### 1. Planner

File: `src/planner.ts`

What it does:

- computes an optimal high-level action sequence for a known layout
- reasons over state such as:
  - current node
  - held locks
  - cleared locks
  - picked resources
  - dropped resources

Why it matters for STM32:

- this should stay offline
- use it on a PC to generate plan tables before competition
- do not port this whole search directly to STM32 unless you have a very strong reason

### 2. Simulator

File: `src/simulator.ts`

What it does:

- executes actions like `PICK_LOCK`, `DROP_LOCK`, `PICK_RESOURCE`, `DROP_RESOURCE`, `RETURN_START`
- updates:
  - node position
  - inventory
  - unlocked branches
  - score
  - timeout state
- enforces legality rules

Why it matters for STM32:

- this file is the best reference for match logic
- firmware should replicate the rule logic and execution sequencing, not the browser UI
- the STM32 side should have a much smaller state machine, but the same rule meaning

### 3. Firmware Export

File: `src/firmware.ts`

What it does:

- converts a simulated result into:
  - `route_table`
  - `policy_rules`

Why it matters for STM32:

- this is already the closest thing to a firmware-facing interface in the repo
- `route_table.json` is a good starting point for a flash-stored navigation/action table
- `policy_rules.json` is a good starting point for guard logic and fallback rules

## Recommended STM32 Architecture

Split the embedded software into six modules.

### 1. `layout_inference`

Responsibility:

- store the candidate set of legal layouts
- apply observations to remove impossible layouts
- expose:
  - candidate count
  - locked layout index if unique
  - best current plan index if not unique

Suggested C data:

```c
typedef struct {
    uint16_t active_mask[36]; // enough bits for 576 layouts
    uint16_t remaining_count;
    int16_t locked_layout_id; // -1 if not unique yet
} layout_tracker_t;
```

Observation examples:

- first slot of yellow branch is blue
- second slot of green branch is red

Each observation removes layouts that do not match.

### 2. `plan_table`

Responsibility:

- hold precomputed plans in flash
- map `layout_id -> action list`

Suggested action representation:

```c
typedef enum {
    ACT_PICK_LOCK,
    ACT_DROP_LOCK,
    ACT_PICK_RESOURCE,
    ACT_DROP_RESOURCE,
    ACT_RETURN_START,
    ACT_END_ROUND
} action_type_t;

typedef struct {
    action_type_t type;
    uint8_t arg0;
    uint8_t arg1;
} plan_action_t;
```

Example encoding:

- `ACT_PICK_LOCK, BRANCH_RED, 0`
- `ACT_PICK_RESOURCE, BRANCH_BLUE, SLOT_1`
- `ACT_DROP_RESOURCE, COLOR_YELLOW, 0`

Do not store:

- motor PWM values
- hardcoded movement durations
- open-loop turn scripts

Those are too fragile.

### 3. `nav_graph` or `junction_router`

Responsibility:

- map action targets to route segments or junction decisions
- translate high-level target nodes into navigation commands

This should be simpler than the TypeScript router.

Instead of full dynamic routing onboard, precompute compact route primitives such as:

- from `START` to `LOCK_RED`
- from `LOCK_RED` to nearest black zone
- from `LOCK_BLUE` to `ZONE_YELLOW`

Suggested representation:

```c
typedef struct {
    uint8_t from_node;
    uint8_t to_node;
    uint8_t step_count;
    uint8_t steps[12];
} route_entry_t;
```

Where `steps[]` are junction actions like:

- straight
- left
- right
- enter branch
- leave branch

### 4. `match_state`

Responsibility:

- track the current logical match state

Suggested state fields:

```c
typedef struct {
    uint8_t current_node;
    uint8_t locks_cleared_mask;
    uint8_t locks_held_mask;
    uint8_t picked_slots_mask;
    uint8_t dropped_slots_mask;
    uint16_t time_elapsed_ds;
    uint8_t plan_step_index;
    uint8_t fallback_mode;
} match_state_t;
```

This is the embedded equivalent of the state handled in `src/simulator.ts`.

### 5. `executor_fsm`

Responsibility:

- execute one high-level action using closed-loop behavior
- report success, timeout, or failure

Suggested states:

- `IDLE`
- `NAVIGATE`
- `ALIGN_PICK`
- `ALIGN_DROP`
- `DECIDE`
- `ERROR_RECOVERY`
- `RETURN_HOME`

That matches the state list already described in the firmware export code and strategy notes.

### 6. `fallback_policy`

Responsibility:

- handle cases where:
  - layout is still ambiguous
  - the selected plan cannot continue
  - the robot drifts too far from the expected route

Keep this simple.

A good first fallback is:

- drop held lock if carrying one
- if carrying colors, score nearest valid color
- otherwise unlock nearest remaining branch

That is close in spirit to the simpler heuristic policies in `src/policies.ts`.

## Firmware Control Flow

The STM32 runtime should look like this:

1. Boot and initialize sensors, motor control, line sensors, gripper, and timers.
2. During setup, optionally record legal observations while the robot is moved by hand.
3. At round start:
   - initialize candidate set to all `576`
   - initialize `match_state`
   - if setup observations exist, filter candidate set immediately
4. Main loop:
   - if layout is unique, use its plan
   - otherwise continue inference and use fallback policy
   - fetch next high-level action
   - execute it through `executor_fsm`
   - update `match_state`
   - if a new color observation is made, filter candidates again
5. If execution fails badly, switch to fallback mode.
6. If all resources are delivered, return to start and end round.

## How The TypeScript Code Maps To STM32 Logic

### Layout randomization model

File: `src/randomization.ts`

Meaning for firmware:

- use the same logical layout model offline
- do not randomize onboard
- onboard only stores the set of all legal layouts and eliminates impossible ones

### Optimal plan computation

File: `src/planner.ts`

Meaning for firmware:

- run this offline on a PC
- export the chosen action list for each layout
- convert node names and branch identifiers into compact numeric enums

### Rule enforcement

File: `src/simulator.ts`

Important rules you should preserve in firmware:

- cannot pick a resource before its branch lock is cleared
- slot 1 must be picked before slot 2
- carrying capacity includes both locks and colored resources
- all locks and all resources must be completed before perfect completion logic

The exact score values can stay in firmware constants.

### Firmware-facing export

File: `src/firmware.ts`

Meaning for firmware:

- use it as the first reference for:
  - route table format
  - guard rule structure
  - state machine names

This file is not a complete firmware implementation, but it is the cleanest bridge between simulator and embedded design.

## Suggested Offline Build Pipeline

Implement a PC-side export pipeline like this:

1. Enumerate all `576` legal layouts.
2. For each layout:
   - instantiate simulator state
   - compute optimal plan
   - convert plan to compact action table
3. Emit generated C files:
   - `generated_layouts.h`
   - `generated_plan_table.c`
   - `generated_routes.c`
4. Compile those generated files into the STM32 firmware before impound.

Useful output structure:

```c
extern const uint16_t g_layout_count;
extern const layout_desc_t g_layouts[576];
extern const plan_desc_t g_plan_table[576];
extern const route_entry_t g_routes[ROUTE_COUNT];
```

This is the right place to spend engineering effort. Do not hand-write the 576 layout table.

## Recommended STM32 Code Structure

Suggested files:

- `Core/Src/layout_inference.c`
- `Core/Src/plan_executor.c`
- `Core/Src/route_table.c`
- `Core/Src/match_state.c`
- `Core/Src/fallback_policy.c`
- `Core/Src/line_follow_fsm.c`
- `Core/Inc/generated_layouts.h`
- `Core/Inc/generated_plan_table.h`

Suggested ownership:

- route following owns movement
- executor owns action progression
- match state owns legality bookkeeping
- layout inference owns candidate elimination

Do not mix all of this into one giant `main.c`.

## Practical First Version

The strongest first STM32 version is not the most complicated one.

Build this first:

1. Offline precompute all layouts and plans.
2. Store the tables in flash.
3. Support deterministic candidate filtering from observed slot colors.
4. Run a simple executor FSM.
5. Add a simple heuristic fallback.

Do not start with:

- Bayesian inference
- online re-planning
- dynamic graph search on the microcontroller
- low-level prerecorded motion scripts

That would raise complexity without improving your first competition-ready system enough.

## Why "Take All Black Locks First" Might Help Or Hurt

This is relevant because your simulator already experiments with similar knobs.

Possible advantages:

- every branch becomes legally open early
- later resource collection becomes simpler
- resource decisions are less constrained by unlock state

Possible disadvantages:

- early time is spent unlocking instead of scoring
- if navigation to black zones is expensive, this can waste time
- if timeout is tight, delayed scoring may reduce final score

So this is not a universally better strategy.

Correct engineering approach:

- keep it as a selectable policy or override in simulation
- compare on the same seeds
- only move it into the STM32 default strategy if the batch results support it

## Implementation Advice

- Keep the STM32 responsible for execution, not for solving the whole optimization problem.
- Generate tables offline and compile them into flash.
- Use compact numeric encodings for nodes, branches, colors, and actions.
- Keep the runtime state machine explicit and debuggable.
- Mirror simulator legality rules in firmware constants and assertions.
- Log enough telemetry over UART to compare expected plan step vs actual executed step.

## Final Recommendation

If you want the strategy in `docs/arc2026_strategy_manual.md` to work on a real STM32 robot, the best implementation path is:

- offline planner on PC
- generated action tables in firmware
- onboard layout inference by elimination
- closed-loop line-following FSM
- simple fallback heuristic when plan execution is uncertain

That is the most defensible and practical version of the big idea in this repo.
