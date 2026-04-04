# STM32 Firmware Implementation Guide For Generated Planning Tables

Status: `Formal implementation guide for the firmware teammate`

Related files:

- `generated/stm32/generated_layouts.h`
- `generated/stm32/generated_plan_table.h`
- `generated/stm32/generated_plan_table_lifo.h`
- `generated/stm32/generated_routes.h`
- `docs/arc2026_strategy_manual.md`
- `docs/stm32_strategy_implementation.md`

## 1. Purpose

This document explains how STM32 firmware should consume the generated planning tables from this repository and turn them into a real match program.

This guide is not about running the TypeScript simulator on the robot.

This guide is about:

- reading the generated C tables from flash
- selecting the correct plan
- decoding each high-level action
- converting action targets into route-table lookups
- executing the action through a closed-loop navigation and manipulator state machine
- updating match state after each successful action
- supporting both:
  - a simple fixed `layout_id` bring-up mode
  - the full onboard layout-inference mode

The core project idea is:

1. Do expensive planning offline on the PC.
2. Store compact plan and route tables in STM32 firmware.
3. Let the robot execute those plans using line following, junction decisions, and manipulator logic.

## 2. What The Generated Tables Mean

The generated files are an interface contract between this repository and the STM32 firmware.

### 2.1 `generated_layouts.*`

This file defines the legal field layouts.

Important symbols:

```c
extern const uint16_t g_layout_count;
extern const layout_desc_t g_layouts[576];
```

Meaning:

- `g_layout_count` is expected to be `576`
- `g_layouts[layout_id]` gives the two resource colors for each branch
- `slots[branch][0]` means first slot color
- `slots[branch][1]` means second slot color

Use this for:

- layout inference
- debugging
- validating observed colors against candidates

Do not use this as a motion script. It only describes field content.

### 2.2 `generated_plan_table.*`

This file contains the normal plan table.

Important symbols:

```c
extern const plan_desc_t g_plan_table[576];
```

Meaning:

- each `layout_id` maps to exactly one precomputed action list
- `action_count` tells how many actions are valid
- `actions[i]` contains one high-level task

These actions are not motor commands. They are high-level tasks such as:

- pick a lock
- drop a lock
- pick a resource
- drop a resource
- return to start

### 2.3 `generated_plan_table_lifo.*`

This file contains an alternate plan table that assumes true LiFo behavior for carried resources.

Important symbols:

```c
extern const plan_desc_t g_plan_table_lifo[576];
```

Use this only if the real mechanical design and manipulator behavior truly force LiFo drop order.

If the robot can choose which carried resource to drop, the normal `g_plan_table` is the default table.

### 2.4 `generated_routes.*`

This file contains compact route primitives between important nodes.

Important symbols:

```c
extern const route_entry_t g_route_table[NODE_ID_T_COUNT][NODE_ID_T_COUNT];
```

Meaning:

- each entry maps `from_node -> to_node`
- `valid` should be `1` for legal generated pairs
- `step_count` tells how many route steps are active
- `steps[]` contains compact junction-level navigation instructions

The route steps are currently:

- `STEP_STRAIGHT`
- `STEP_LEFT`
- `STEP_RIGHT`
- `STEP_ENTER_BRANCH`
- `STEP_STOP_ON_MARKER`

These are not wheel speeds. They are route decisions for a navigation FSM.

## 3. Firmware Architecture

The STM32 side should be split into clear HAL-style modules.

Recommended module layout:

- `Core/Inc/app_match.h`
- `Core/Src/app_match.c`
- `Core/Inc/app_match_state.h`
- `Core/Src/app_match_state.c`
- `Core/Inc/app_layout_inference.h`
- `Core/Src/app_layout_inference.c`
- `Core/Inc/app_plan_executor.h`
- `Core/Src/app_plan_executor.c`
- `Core/Inc/app_route.h`
- `Core/Src/app_route.c`
- `Core/Inc/app_nav_fsm.h`
- `Core/Src/app_nav_fsm.c`
- `Core/Inc/app_manipulator.h`
- `Core/Src/app_manipulator.c`
- `Core/Inc/app_fallback.h`
- `Core/Src/app_fallback.c`

Recommended responsibility split:

### 3.1 `app_match`

Top-level match coordinator.

Responsibilities:

- initialize runtime state
- select known-layout mode or inference mode
- call the plan executor
- call navigation/manipulator FSM ticks
- advance to next action after success
- stop on timeout or end-of-round

### 3.2 `app_match_state`

Logical match state only.

Responsibilities:

- current logical node
- cleared locks
- picked slots
- dropped resources
- held inventory summary
- plan step index
- timeout state

This module should not directly drive motors.

### 3.3 `app_layout_inference`

Candidate filtering over the `576` legal layouts.

Responsibilities:

- start with all layouts active
- apply color observations
- remove inconsistent layouts
- report candidate count
- lock a unique `layout_id` when possible

### 3.4 `app_plan_executor`

Pure plan decoding and action targeting.

Responsibilities:

- return current action from selected plan
- translate action into a target node
- decide whether a route lookup is needed
- decide when an action is logically complete

### 3.5 `app_route`

Thin wrapper around `g_route_table`.

Responsibilities:

- validate lookups
- expose route step sequences
- choose nearest black zone for `DROP_LOCK`

### 3.6 `app_nav_fsm`

Closed-loop line-following and junction execution state machine.

Responsibilities:

- consume one route entry
- line follow until marker/junction
- execute left/right/straight/branch decisions
- stop at target marker
- report route success or failure

### 3.7 `app_manipulator`

Pickup and drop routines.

Responsibilities:

- pick black lock
- drop black lock
- pick colored resource
- drop colored resource
- return success/failure/timeout

### 3.8 `app_fallback`

Fallback behavior when the ideal plan cannot continue.

Responsibilities:

- safe behavior before layout is uniquely known
- safe behavior if route execution fails
- safe behavior if manipulator action fails repeatedly

## 4. Core Runtime Data Structures

The exact struct layout can vary, but the firmware should contain equivalents of the following.

### 4.1 Match state

```c
typedef struct
{
    node_id_t current_node;
    uint8_t locks_cleared_mask;
    uint8_t locks_held_mask;
    uint8_t picked_slots_mask;
    uint8_t dropped_slots_mask;
    uint8_t resource_inventory_count;
    uint8_t holding_black_lock_count;
    uint8_t returned_to_start;
    uint8_t all_actions_complete;
    uint16_t elapsed_ds;
    uint8_t plan_step_index;
} match_state_t;
```

Suggested bit usage:

- `locks_cleared_mask`: bit per branch
- `locks_held_mask`: bit per branch
- `picked_slots_mask`: 8 bits for the 8 colored slots
- `dropped_slots_mask`: 8 bits for the 8 colored slots

### 4.2 Layout tracker

```c
typedef struct
{
    uint16_t active_mask[36];
    uint16_t remaining_count;
    int16_t locked_layout_id;
} layout_tracker_t;
```

Reason:

- `36 * 16 = 576` bits
- efficient enough for a small MCU
- deterministic and easy to debug

### 4.3 Plan runtime

```c
typedef enum
{
    PLAN_MODE_NORMAL = 0,
    PLAN_MODE_LIFO = 1
} plan_mode_t;

typedef struct
{
    const plan_desc_t *plan;
    uint16_t layout_id;
    plan_mode_t mode;
} plan_runtime_t;
```

### 4.4 Navigation execution state

```c
typedef enum
{
    NAV_IDLE = 0,
    NAV_RUNNING,
    NAV_REACHED_TARGET,
    NAV_FAILED,
    NAV_TIMEOUT
} nav_status_t;

typedef struct
{
    route_entry_t route;
    uint8_t route_step_index;
    uint8_t active;
    node_id_t target_node;
} nav_runtime_t;
```

### 4.5 Action result

```c
typedef enum
{
    ACTION_RESULT_BUSY = 0,
    ACTION_RESULT_DONE,
    ACTION_RESULT_FAILED,
    ACTION_RESULT_TIMEOUT
} action_result_t;
```

## 5. Required Firmware Functions

The exact names may change, but the firmware needs equivalents of these functions.

## 5.1 Top-level match functions

```c
void Match_Init(void);
void Match_Reset(match_state_t *state);
void Match_StartKnownLayout(uint16_t layout_id, plan_mode_t mode);
void Match_StartInference(plan_mode_t mode);
void Match_Tick(void);
uint8_t Match_IsFinished(void);
```

Expected behavior:

- initialize modules and state
- start a run
- advance execution every scheduler tick
- stop on `ACT_END_ROUND`, timeout, or fatal failure

## 5.2 Layout inference functions

```c
void LayoutTracker_Init(layout_tracker_t *tracker);
void LayoutTracker_Reset(layout_tracker_t *tracker);
void LayoutTracker_ApplyObservation(layout_tracker_t *tracker,
                                    branch_id_t branch,
                                    uint8_t slot_index,
                                    color_id_t observed_color);
uint16_t LayoutTracker_GetRemainingCount(const layout_tracker_t *tracker);
int16_t LayoutTracker_GetLockedLayoutId(const layout_tracker_t *tracker);
```

Expected behavior:

- start with all 576 layouts active
- clear candidates that disagree with each observation
- set `locked_layout_id` when one candidate remains

## 5.3 Plan selection and decoding functions

```c
void PlanExecutor_Load(plan_runtime_t *runtime, uint16_t layout_id, plan_mode_t mode);
const plan_action_t *PlanExecutor_GetCurrentAction(const plan_runtime_t *runtime,
                                                   const match_state_t *state);
uint8_t PlanExecutor_IsFinished(const plan_runtime_t *runtime,
                                const match_state_t *state);
void PlanExecutor_Advance(match_state_t *state);
node_id_t PlanExecutor_ResolveTargetNode(const plan_action_t *action,
                                         const match_state_t *state);
```

Expected behavior:

- load the plan row from generated flash data
- read current action using `plan_step_index`
- resolve target node for route lookup

## 5.4 Route access functions

```c
const route_entry_t *Route_Get(node_id_t from_node, node_id_t to_node);
node_id_t Route_GetNearestBlackZone(node_id_t from_node);
uint8_t Route_IsValid(node_id_t from_node, node_id_t to_node);
```

Expected behavior:

- wrap `g_route_table`
- hide black-zone selection logic in one place

## 5.5 Navigation FSM functions

```c
void NavFsm_Init(nav_runtime_t *nav);
void NavFsm_StartRoute(nav_runtime_t *nav, node_id_t target_node, const route_entry_t *route);
void NavFsm_Tick(nav_runtime_t *nav);
nav_status_t NavFsm_GetStatus(const nav_runtime_t *nav);
void NavFsm_Reset(nav_runtime_t *nav);
```

Expected behavior:

- execute route steps through closed-loop line following
- stop exactly at the marker for the target node
- report success or failure

## 5.6 Manipulator functions

```c
action_result_t Manipulator_PickLock(branch_id_t branch);
action_result_t Manipulator_DropLock(branch_id_t branch);
action_result_t Manipulator_PickResource(branch_id_t branch, uint8_t slot_index);
action_result_t Manipulator_DropResource(color_id_t color);
```

Expected behavior:

- act only when robot is already at the correct target node
- return busy until motion finishes
- return done only when the physical action has succeeded

## 6. How To Refer To The Tables In Firmware

This is the most important firmware-side pattern.

## 6.1 Accessing one layout

```c
const layout_desc_t *layout = &g_layouts[layout_id];
color_id_t red_slot_1 = (color_id_t)layout->slots[BRANCH_RED][0];
color_id_t red_slot_2 = (color_id_t)layout->slots[BRANCH_RED][1];
```

Use cases:

- layout inference
- debugging UART logs
- validating expected slot colors

## 6.2 Accessing one plan

```c
const plan_desc_t *plan = &g_plan_table[layout_id];
uint8_t action_count = plan->action_count;
const plan_action_t *action = &plan->actions[step_index];
```

LiFo variant:

```c
const plan_desc_t *plan = &g_plan_table_lifo[layout_id];
```

## 6.3 Accessing one route

```c
const route_entry_t *route = &g_route_table[from_node][to_node];

if (route->valid == 0U)
{
    /* treat as fatal route configuration error */
}
```

## 6.4 Typical lookup sequence

Typical plan execution lookup order:

1. Select `layout_id`
2. Read `plan = &g_plan_table[layout_id]`
3. Read current action `plan->actions[state->plan_step_index]`
4. Resolve target node from that action
5. Read `route = &g_route_table[state->current_node][target_node]`
6. Execute route through navigation FSM
7. Execute manipulator step if needed
8. Update match state
9. Increment `plan_step_index`

## 7. Action Decoding Rules

The firmware must decode each `plan_action_t` consistently.

## 7.1 `ACT_PICK_LOCK`

Encoding:

```c
type = ACT_PICK_LOCK
arg0 = branch_id_t
arg1 = 0
```

Meaning:

- go to `NODE_LOCK_<branch>`
- pick that branch's black lock

Target-node mapping:

- `BRANCH_RED -> NODE_LOCK_RED`
- `BRANCH_YELLOW -> NODE_LOCK_YELLOW`
- `BRANCH_BLUE -> NODE_LOCK_BLUE`
- `BRANCH_GREEN -> NODE_LOCK_GREEN`

## 7.2 `ACT_DROP_LOCK`

Encoding:

```c
type = ACT_DROP_LOCK
arg0 = branch_id_t
arg1 = 0
```

Meaning:

- go to the nearest black zone
- drop that branch's black lock
- mark the branch as cleared

Important:

- the target is not directly stored as one fixed node
- firmware must choose between `NODE_BLACK_ZONE` and `NODE_BLACK_ZONE_RIGHT`

## 7.3 `ACT_PICK_RESOURCE`

Encoding:

```c
type = ACT_PICK_RESOURCE
arg0 = branch_id_t
arg1 = slot_index
```

Meaning:

- go to the resource slot node in that branch
- pick the resource from the requested slot

Mapping:

- `arg1 = 0 -> first slot`
- `arg1 = 1 -> second slot`

Examples:

- `{ ACT_PICK_RESOURCE, BRANCH_BLUE, 0 } -> NODE_R_BLUE_1`
- `{ ACT_PICK_RESOURCE, BRANCH_GREEN, 1 } -> NODE_R_GREEN_2`

## 7.4 `ACT_DROP_RESOURCE`

Encoding:

```c
type = ACT_DROP_RESOURCE
arg0 = color_id_t
arg1 = 0
```

Meaning:

- go to the matching scoring zone
- drop one resource of that color

Mapping:

- `COLOR_RED -> NODE_ZONE_RED`
- `COLOR_YELLOW -> NODE_ZONE_YELLOW`
- `COLOR_BLUE -> NODE_ZONE_BLUE`
- `COLOR_GREEN -> NODE_ZONE_GREEN`

## 7.5 `ACT_RETURN_START`

Encoding:

```c
type = ACT_RETURN_START
arg0 = 0
arg1 = 0
```

Meaning:

- go to `NODE_START`

## 7.6 `ACT_END_ROUND`

Encoding:

```c
type = ACT_END_ROUND
arg0 = 0
arg1 = 0
```

Meaning:

- stop normal plan execution
- mark plan complete

No route lookup is needed.

## 8. Recommended HAL-Style Control Flow

The top-level control should look like a periodic scheduler-driven application.

### 8.1 High-level match state machine

```c
typedef enum
{
    MATCH_IDLE = 0,
    MATCH_WAIT_START,
    MATCH_SELECT_LAYOUT,
    MATCH_SELECT_ACTION,
    MATCH_NAVIGATE,
    MATCH_MANIPULATE,
    MATCH_APPLY_RESULT,
    MATCH_FALLBACK,
    MATCH_FINISHED,
    MATCH_ABORTED
} match_fsm_state_t;
```

### 8.2 Top-level tick pseudocode

```c
void Match_Tick(void)
{
    switch (g_match_fsm_state)
    {
    case MATCH_IDLE:
        break;

    case MATCH_WAIT_START:
        if (StartCondition_IsTrue())
        {
            g_match_fsm_state = MATCH_SELECT_LAYOUT;
        }
        break;

    case MATCH_SELECT_LAYOUT:
        Match_SelectLayoutStep();
        break;

    case MATCH_SELECT_ACTION:
        Match_SelectActionStep();
        break;

    case MATCH_NAVIGATE:
        Match_NavigateStep();
        break;

    case MATCH_MANIPULATE:
        Match_ManipulateStep();
        break;

    case MATCH_APPLY_RESULT:
        Match_ApplyResultStep();
        break;

    case MATCH_FALLBACK:
        Match_FallbackStep();
        break;

    case MATCH_FINISHED:
    case MATCH_ABORTED:
    default:
        break;
    }
}
```

## 9. Bring-Up Path 1: Known `layout_id`

This is the simplest first working version.

### 9.1 Goal

Ignore onboard inference at first.

Instead:

- hardcode or externally provide one `layout_id`
- load the matching plan
- execute that plan

### 9.2 Start sequence

```c
void Match_StartKnownLayout(uint16_t layout_id, plan_mode_t mode)
{
    Match_Reset(&g_match_state);
    PlanExecutor_Load(&g_plan_runtime, layout_id, mode);
    g_selected_layout_id = layout_id;
    g_layout_locked = 1U;
    g_match_fsm_state = MATCH_WAIT_START;
}
```

### 9.3 Selection step

```c
static void Match_SelectActionStep(void)
{
    const plan_action_t *action;
    node_id_t target_node;
    const route_entry_t *route;

    if (PlanExecutor_IsFinished(&g_plan_runtime, &g_match_state) != 0U)
    {
        g_match_fsm_state = MATCH_FINISHED;
        return;
    }

    action = PlanExecutor_GetCurrentAction(&g_plan_runtime, &g_match_state);

    if (action->type == ACT_END_ROUND)
    {
        g_match_fsm_state = MATCH_FINISHED;
        return;
    }

    target_node = PlanExecutor_ResolveTargetNode(action, &g_match_state);

    if (target_node == g_match_state.current_node)
    {
        g_match_fsm_state = MATCH_MANIPULATE;
        return;
    }

    route = Route_Get(g_match_state.current_node, target_node);
    NavFsm_StartRoute(&g_nav_runtime, target_node, route);
    g_pending_target_node = target_node;
    g_match_fsm_state = MATCH_NAVIGATE;
}
```

### 9.4 Expected result

If this mode works, the robot should:

- select one plan row from flash
- execute actions in order
- move from node target to node target
- update state after each action
- return to start if the plan ends with `ACT_RETURN_START`

This is the first milestone to validate before adding inference.

## 10. Bring-Up Path 2: Full Layout Inference

This is the complete target architecture.

### 10.1 Goal

The robot should not require a human to type the final layout number.

Instead:

- start with all `576` layouts active
- observe colors onboard
- filter the candidate set
- lock a unique `layout_id` once enough evidence exists
- then execute the matching plan

### 10.2 Initialization

```c
void Match_StartInference(plan_mode_t mode)
{
    Match_Reset(&g_match_state);
    LayoutTracker_Init(&g_layout_tracker);
    g_plan_mode = mode;
    g_layout_locked = 0U;
    g_selected_layout_id = 0U;
    g_match_fsm_state = MATCH_WAIT_START;
}
```

### 10.3 Observation function

Suggested observation event:

```c
typedef struct
{
    branch_id_t branch;
    uint8_t slot_index;
    color_id_t color;
} layout_observation_t;
```

Example:

- "yellow branch first slot is blue"
- `branch = BRANCH_YELLOW`
- `slot_index = 0`
- `color = COLOR_BLUE`

### 10.4 Applying observations

```c
void LayoutTracker_ApplyObservation(layout_tracker_t *tracker,
                                    branch_id_t branch,
                                    uint8_t slot_index,
                                    color_id_t observed_color)
{
    uint16_t layout_id;

    for (layout_id = 0; layout_id < g_layout_count; layout_id++)
    {
        if (LayoutTracker_IsCandidateActive(tracker, layout_id) == 0U)
        {
            continue;
        }

        if (g_layouts[layout_id].slots[branch][slot_index] != observed_color)
        {
            LayoutTracker_ClearCandidate(tracker, layout_id);
        }
    }

    tracker->remaining_count = LayoutTracker_Recount(tracker);
    tracker->locked_layout_id = LayoutTracker_FindUnique(tracker);
}
```

### 10.5 Layout selection policy

Recommended rule:

- if `remaining_count == 1`, lock that layout immediately
- if `remaining_count > 1`, continue collecting observations or use fallback policy
- do not start omniscient plan execution until the plan is trustworthy enough

### 10.6 Transition to plan execution

```c
if ((g_layout_locked == 0U) &&
    (LayoutTracker_GetLockedLayoutId(&g_layout_tracker) >= 0))
{
    g_selected_layout_id = (uint16_t)LayoutTracker_GetLockedLayoutId(&g_layout_tracker);
    PlanExecutor_Load(&g_plan_runtime, g_selected_layout_id, g_plan_mode);
    g_layout_locked = 1U;
}
```

## 10.7 Alternative Runtime Path: `BusRoute_Parametric` On STM32

This repository also contains a strong heuristic policy, `BusRoute_Parametric`.

Unlike the omniscient planner path, the bus policy does not need:

- a known `layout_id` before action selection
- a precomputed `g_plan_table[layout_id]` action script
- a full onboard state-space planner

Instead, it makes a fresh local decision at each step using runtime state such as:

- current node
- cleared branches
- held black locks
- carried colored resources
- carry capacity
- nearest black zone
- value-per-time estimates for nearby locks and resources

This is often easier to deploy on STM32 because the firmware logic is more explicit and less table-driven.

The tradeoff is the opposite of the omniscient path:

- less flash used for high-level planning scripts
- less dependence on exact layout identification
- more runtime decision logic inside firmware
- heuristic quality instead of guaranteed global optimality

### 10.7.1 What the bus policy should still reuse

Even when implementing the bus policy, firmware should still reuse existing generated and shared infrastructure:

- `generated_routes.*`
  - still the best source for node-to-node route execution
- `generated_layouts.*`
  - optional for debugging or future inference-aware upgrades
- navigation FSM
- manipulator FSM
- match-state bookkeeping

The main difference is:

- omniscient mode reads one precomputed action from `g_plan_table`
- bus mode computes the next action onboard from the current logical state

One important alignment detail from the simulator bus policy is:

- after an immediate color drop
- if exactly one colored resource remains
- and finishing that remaining drop is still cheap

the bus policy should finish that remaining cargo before reopening new lock work.

### 10.7.2 Recommended firmware runtime state for bus mode

The bus policy needs slightly richer runtime bookkeeping than a fixed plan executor because it decides online.

Suggested struct:

```c
typedef struct
{
    uint8_t active;
    node_id_t current_target;
    uint8_t has_pending_action;
    plan_action_t pending_action;
} bus_exec_runtime_t;

typedef struct
{
    node_id_t current_node;
    uint8_t locks_cleared_mask;
    uint8_t locks_held_mask;
    uint8_t picked_slots_mask;
    uint8_t dropped_slots_mask;
    uint8_t carrying_color_counts[4];
    uint8_t carrying_total_count;
    uint8_t carry_capacity;
} bus_state_view_t;
```

Notes:

- `carrying_color_counts[4]` is useful because the bus policy often asks:
  - "can I drop a matching color immediately?"
  - "which color drop gives the best value per travel time?"
- `locks_held_mask` should allow more than one black lock if capacity allows
- `pending_action` is useful because action selection and action execution should remain separate

### 10.7.3 Core bus policy rules in firmware order

A practical STM32 implementation should keep the decision ladder simple and deterministic.

Recommended decision order:

1. If already standing on a valid color zone for carried cargo, drop that color immediately.
2. If that immediate drop leaves exactly one cheap remaining carried color, finish that drop before reopening work.
3. If holding black locks and currently at a black zone, keep dropping until no held locks remain.
4. If holding one black lock, no resources, and spare capacity remains, consider taking a second lock before visiting black zone.
5. If holding black locks and no useful extra lock chain exists, go to the nearest black zone and drop.
6. If inventory is full, choose the best color drop by value-per-time.
7. Otherwise compare:
   - next lock pickup candidate
   - next resource pickup candidate
   - next color drop candidate
8. Choose the highest-scoring legal action.
9. When all resources are scored and nothing is carried, return to start.

This is intentionally simpler than copying every TypeScript helper exactly.

The STM32 goal is:

- preserve the same strategic shape
- keep the logic readable and debuggable
- avoid overfitting firmware to simulator-only abstractions

### 10.7.4 Decision function skeleton

Recommended pattern:

```c
static uint8_t BusPolicy_DecideNextAction(const match_state_t *state,
                                          plan_action_t *out_action)
{
    branch_id_t best_branch;
    color_id_t best_color;
    slot_ref_t best_slot;

    if (BusPolicy_TryImmediateColorDrop(state, out_action) != 0U)
    {
        return 1U;
    }

    if (BusPolicy_TryFinishCheapRemainingColor(state, out_action) != 0U)
    {
        return 1U;
    }

    if (BusPolicy_TryFlushHeldLocksAtBlackZone(state, out_action) != 0U)
    {
        return 1U;
    }

    if (BusPolicy_TryChainExtraLock(state, &best_branch) != 0U)
    {
        out_action->type = ACT_PICK_LOCK;
        out_action->arg0 = (uint8_t)best_branch;
        out_action->arg1 = 0U;
        return 1U;
    }

    if (BusPolicy_TryDepositHeldLock(state, out_action) != 0U)
    {
        return 1U;
    }

    if (BusPolicy_InventoryIsFull(state) != 0U)
    {
        best_color = BusPolicy_ChooseBestDropColor(state);
        out_action->type = ACT_DROP_RESOURCE;
        out_action->arg0 = (uint8_t)best_color;
        out_action->arg1 = 0U;
        return 1U;
    }

    if (BusPolicy_ChooseBestPickup(state, &best_branch, &best_slot) != 0U)
    {
        out_action->type = ACT_PICK_RESOURCE;
        out_action->arg0 = (uint8_t)best_branch;
        out_action->arg1 = (uint8_t)best_slot.slot_index;
        return 1U;
    }

    if (BusPolicy_ChooseBestLock(state, &best_branch) != 0U)
    {
        out_action->type = ACT_PICK_LOCK;
        out_action->arg0 = (uint8_t)best_branch;
        out_action->arg1 = 0U;
        return 1U;
    }

    if (BusPolicy_ChooseBestDropColorIfAny(state, &best_color) != 0U)
    {
        out_action->type = ACT_DROP_RESOURCE;
        out_action->arg0 = (uint8_t)best_color;
        out_action->arg1 = 0U;
        return 1U;
    }

    if (Match_AllResourcesDelivered(state) != 0U)
    {
        out_action->type = ACT_RETURN_START;
        out_action->arg0 = 0U;
        out_action->arg1 = 0U;
        return 1U;
    }

    out_action->type = ACT_END_ROUND;
    out_action->arg0 = 0U;
    out_action->arg1 = 0U;
    return 1U;
}
```

This sample is intentionally not a copy-paste of the simulator implementation.

It shows the correct firmware architecture idea:

- choose one legal high-level action
- store it as `pending_action`
- let the existing route/manipulator pipeline execute it

### 10.7.5 Example value-per-time lock choice

One of the most important bus-policy helpers is selecting the next lock by simple value-per-time scoring.

Example:

```c
static uint8_t BusPolicy_ChooseBestLock(const match_state_t *state,
                                        branch_id_t *out_branch)
{
    uint8_t found = 0U;
    float best_score = -1000000.0f;
    branch_id_t branch;

    for (branch = BRANCH_RED; branch <= BRANCH_GREEN; branch++)
    {
        node_id_t lock_node;
        node_id_t black_zone;
        float to_lock_s;
        float to_black_s;
        float total_s;
        float branch_value;
        float score;

        if (Match_IsBranchCleared(state, branch) != 0U)
        {
            continue;
        }

        if (Match_IsLockAlreadyHeld(state, branch) != 0U)
        {
            continue;
        }

        if (Match_CurrentLoad(state) >= Match_CarryCapacity(state))
        {
            continue;
        }

        lock_node = Match_LockNodeForBranch(branch);
        black_zone = Route_GetNearestBlackZone(state->current_node);
        to_lock_s = Route_EstimateTravelSeconds(state->current_node, lock_node);
        to_black_s = Route_EstimateTravelSeconds(lock_node, black_zone);

        total_s = to_lock_s + ROBOT_PICKUP_S + to_black_s + ROBOT_DROP_S;
        branch_value = Match_BranchPointValue(branch) * 2.0f;
        score = branch_value / total_s;

        if ((found == 0U) || (score > best_score))
        {
            found = 1U;
            best_score = score;
            *out_branch = branch;
        }
    }

    return found;
}
```

This is not mathematically optimal.

That is fine.

It is small, explainable, and close to what a real STM32 teammate can tune safely.

### 10.7.6 Integrating bus decisions into `Match_Tick()`

The easiest firmware pattern is:

- keep `MATCH_SELECT_ACTION`
- but in bus mode, fill `pending_action` by calling `BusPolicy_DecideNextAction()`
- then execute it using the same navigation/manipulator flow already used for table-driven actions

Example:

```c
static void Match_SelectActionStep(void)
{
    node_id_t target_node;
    const route_entry_t *route;

    if (g_match_mode == MATCH_MODE_BUS)
    {
        if (BusPolicy_DecideNextAction(&g_match_state, &g_pending_action) == 0U)
        {
            g_match_fsm_state = MATCH_ABORTED;
            return;
        }
    }
    else
    {
        const plan_action_t *plan_action;

        if (PlanExecutor_IsFinished(&g_plan_runtime, &g_match_state) != 0U)
        {
            g_match_fsm_state = MATCH_FINISHED;
            return;
        }

        plan_action = PlanExecutor_GetCurrentAction(&g_plan_runtime, &g_match_state);
        g_pending_action = *plan_action;
    }

    if (g_pending_action.type == ACT_END_ROUND)
    {
        g_match_fsm_state = MATCH_FINISHED;
        return;
    }

    target_node = PlanExecutor_ResolveTargetNode(&g_pending_action, &g_match_state);

    if (target_node == g_match_state.current_node)
    {
        g_match_fsm_state = MATCH_MANIPULATE;
        return;
    }

    route = Route_Get(g_match_state.current_node, target_node);
    NavFsm_StartRoute(&g_nav_runtime, target_node, route);
    g_pending_target_node = target_node;
    g_match_fsm_state = MATCH_NAVIGATE;
}
```

This is the key architectural takeaway:

- bus mode and omniscient mode should share the same lower execution layers
- only the action-selection layer changes

### 10.7.7 Recommended practical bring-up order for bus mode

Bring bus mode up in small stages:

1. Implement immediate color drop.
2. Implement held-lock deposit to nearest black zone.
3. Implement simple next-lock selection.
4. Implement simple next-resource selection.
5. Add second-lock chaining when capacity allows.
6. Add value-per-time tuning after the base version works.

Do not start by trying to mirror every TypeScript branch exactly.

First get:

- legal behavior
- predictable movement
- understandable logs

Then improve heuristic quality.

### 10.7.8 When bus mode is the better firmware choice

The bus policy is usually the better STM32-first path when:

- the team wants a deployable real-match strategy quickly
- onboard layout inference is incomplete or unreliable
- firmware memory/debug simplicity matters more than perfect optimality
- the teammate wants a policy that can still behave reasonably if sensing is imperfect

The omniscient path is still valuable for:

- benchmarking
- validating route and manipulator execution
- generating upper-bound reference runs

But for real onboard autonomy, the bus policy is often the more practical firmware implementation target.

## 11. Step-By-Step Action Execution

This section disassembles what firmware must do for each action.

## 11.1 `ACT_PICK_LOCK`

Expected sequence:

1. Read current action.
2. Decode branch from `arg0`.
3. Resolve target node `NODE_LOCK_<branch>`.
4. Look up `g_route_table[current_node][target_node]`.
5. Execute route with `NavFsm`.
6. When route completes, call `Manipulator_PickLock(branch)`.
7. If success:
   - set held-lock bit
   - keep branch uncleared
   - set `current_node = target_node`
   - increment `plan_step_index`
8. If failure:
   - retry or enter fallback depending on policy

Expected result:

- the robot is physically holding that branch's black lock
- firmware logical state says the lock is held

## 11.2 `ACT_DROP_LOCK`

Expected sequence:

1. Read current action.
2. Decode branch from `arg0`.
3. Choose nearest black zone using current node.
4. Look up route to that black zone.
5. Execute route with `NavFsm`.
6. Call `Manipulator_DropLock(branch)`.
7. If success:
   - clear held-lock bit for branch
   - set cleared-lock bit for branch
   - set `current_node = black_zone_node`
   - increment `plan_step_index`

Expected result:

- the branch is now unlocked for legal resource pickup

## 11.3 `ACT_PICK_RESOURCE`

Expected sequence:

1. Read current action.
2. Decode `branch` and `slot_index`.
3. Resolve target node `NODE_R_<branch>_<1 or 2>`.
4. Look up route.
5. Execute route.
6. Call `Manipulator_PickResource(branch, slot_index)`.
7. If success:
   - set picked-slot bit
   - increment inventory count
   - set `current_node = target_node`
   - increment `plan_step_index`

Expected result:

- the requested resource has been physically collected
- match state records the slot as picked

## 11.4 `ACT_DROP_RESOURCE`

Expected sequence:

1. Read current action.
2. Decode target color from `arg0`.
3. Resolve target zone node.
4. Look up route.
5. Execute route.
6. Call `Manipulator_DropResource(color)`.
7. If success:
   - decrement inventory count
   - set dropped-slot bit for the correct carried item
   - set `current_node = zone_node`
   - increment `plan_step_index`

Expected result:

- one matching colored resource is scored

Implementation note:

- if using normal table mode, your manipulator/state logic must support the normal drop semantics assumed by the planner
- if your real hardware behaves as true LiFo, use `g_plan_table_lifo`

## 11.5 `ACT_RETURN_START`

Expected sequence:

1. Resolve target node `NODE_START`
2. Look up route
3. Execute route
4. On success:
   - set `returned_to_start = 1`
   - set `current_node = NODE_START`
   - increment `plan_step_index`

Expected result:

- robot returns home before end-of-round

## 11.6 `ACT_END_ROUND`

Expected sequence:

1. Stop action selection
2. Stop navigation
3. Set match finished flag

Expected result:

- clean end of execution

## 12. Example Target Resolution Function

This is the main conversion from plan action to route-table target.

```c
node_id_t PlanExecutor_ResolveTargetNode(const plan_action_t *action,
                                         const match_state_t *state)
{
    switch (action->type)
    {
    case ACT_PICK_LOCK:
        switch (action->arg0)
        {
        case BRANCH_RED:    return NODE_LOCK_RED;
        case BRANCH_YELLOW: return NODE_LOCK_YELLOW;
        case BRANCH_BLUE:   return NODE_LOCK_BLUE;
        case BRANCH_GREEN:  return NODE_LOCK_GREEN;
        default:            return NODE_START;
        }

    case ACT_DROP_LOCK:
        return Route_GetNearestBlackZone(state->current_node);

    case ACT_PICK_RESOURCE:
        if (action->arg1 == 0U)
        {
            switch (action->arg0)
            {
            case BRANCH_RED:    return NODE_R_RED_1;
            case BRANCH_YELLOW: return NODE_R_YELLOW_1;
            case BRANCH_BLUE:   return NODE_R_BLUE_1;
            case BRANCH_GREEN:  return NODE_R_GREEN_1;
            default:            return NODE_START;
            }
        }
        else
        {
            switch (action->arg0)
            {
            case BRANCH_RED:    return NODE_R_RED_2;
            case BRANCH_YELLOW: return NODE_R_YELLOW_2;
            case BRANCH_BLUE:   return NODE_R_BLUE_2;
            case BRANCH_GREEN:  return NODE_R_GREEN_2;
            default:            return NODE_START;
            }
        }

    case ACT_DROP_RESOURCE:
        switch (action->arg0)
        {
        case COLOR_RED:    return NODE_ZONE_RED;
        case COLOR_YELLOW: return NODE_ZONE_YELLOW;
        case COLOR_BLUE:   return NODE_ZONE_BLUE;
        case COLOR_GREEN:  return NODE_ZONE_GREEN;
        default:           return NODE_START;
        }

    case ACT_RETURN_START:
        return NODE_START;

    case ACT_END_ROUND:
    default:
        return state->current_node;
    }
}
```

## 13. Example Route Wrapper

```c
const route_entry_t *Route_Get(node_id_t from_node, node_id_t to_node)
{
    return &g_route_table[from_node][to_node];
}

node_id_t Route_GetNearestBlackZone(node_id_t from_node)
{
    const route_entry_t *left_route;
    const route_entry_t *right_route;

    left_route = &g_route_table[from_node][NODE_BLACK_ZONE];
    right_route = &g_route_table[from_node][NODE_BLACK_ZONE_RIGHT];

    if (left_route->valid == 0U)
    {
        return NODE_BLACK_ZONE_RIGHT;
    }

    if (right_route->valid == 0U)
    {
        return NODE_BLACK_ZONE;
    }

    if (left_route->step_count <= right_route->step_count)
    {
        return NODE_BLACK_ZONE;
    }

    return NODE_BLACK_ZONE_RIGHT;
}
```

This simple heuristic is acceptable as a first implementation because the generated route table is already compact and legal.

## 14. Motor Code And Motion Primitive Layer

Simple motor functions like `go_straight()` and `turn_right()` are a good idea, but they belong at the bottom of the stack.

They should not be the only execution layer.

The correct layering is:

1. Motor driver layer
2. Motion primitive layer
3. Navigation FSM layer
4. Plan execution layer

### 14.1 Why motor functions alone are not enough

The generated route table does not mean:

- drive left motor at `x`
- drive right motor at `y`
- wait `t` milliseconds

It means:

- follow the line until the next decision point
- at that junction, go left or right or straight
- possibly enter a branch
- stop on the correct marker

So this is not an open-loop motion-script problem.

It is a closed-loop navigation problem built on top of simple motor primitives.

### 14.2 Recommended firmware stack

```text
Plan table action
-> resolve target node
-> route-table lookup
-> navigation FSM executes route steps
-> motion primitive performs one step
-> motor driver controls H-bridge / PWM
```

### 14.3 Recommended layer boundaries

#### Layer A. Motor driver

This layer directly touches PWM, GPIO, timers, and motor direction pins.

Example functions:

```c
void Motor_Init(void);
void Motor_Stop(void);
void Motor_SetDuty(int16_t left_pwm, int16_t right_pwm);
void Motor_SetBrake(uint8_t enable);
```

Responsibilities:

- set wheel speed and direction
- stop immediately when required
- expose a clean low-level interface to the upper layers

This layer should not know anything about routes, nodes, layouts, or plan actions.

#### Layer B. Motion primitives

This layer uses motor control plus sensors to perform one closed-loop movement behavior.

Example functions:

```c
typedef enum
{
    MOTION_IDLE = 0,
    MOTION_LINE_FOLLOW,
    MOTION_TURN_LEFT,
    MOTION_TURN_RIGHT,
    MOTION_GO_STRAIGHT_THROUGH_JUNCTION,
    MOTION_ENTER_BRANCH,
    MOTION_STOP_ON_MARKER
} motion_mode_t;

typedef enum
{
    MOTION_RESULT_BUSY = 0,
    MOTION_RESULT_DONE,
    MOTION_RESULT_FAILED,
    MOTION_RESULT_TIMEOUT
} motion_result_t;

void Motion_Init(void);
void Motion_StartLineFollow(void);
void Motion_StartTurnLeft(void);
void Motion_StartTurnRight(void);
void Motion_StartGoStraightThroughJunction(void);
void Motion_StartEnterBranch(void);
void Motion_StartStopOnMarker(void);
void Motion_Tick(void);
motion_result_t Motion_GetResult(void);
void Motion_Reset(void);
```

Responsibilities:

- follow a line using line sensors
- detect junction arrival
- turn left or right based on sensors
- enter a branch and re-acquire the line
- stop on a marker reliably

This is the layer where your teammate's idea belongs.

Functions like:

```c
void go_straight(void);
void turn_right(void);
```

are acceptable as primitive-entry concepts, but in a real STM32 program they are better written as:

```c
void Motion_StartGoStraightThroughJunction(void);
void Motion_StartTurnRight(void);
```

because the action is not instant. It starts, runs, and later reports completion.

#### Layer C. Navigation FSM

This layer reads one `route_entry_t` and executes its `steps[]` one by one.

Example functions:

```c
void NavFsm_Init(nav_runtime_t *nav);
void NavFsm_StartRoute(nav_runtime_t *nav,
                       node_id_t target_node,
                       const route_entry_t *route);
void NavFsm_Tick(nav_runtime_t *nav);
nav_status_t NavFsm_GetStatus(const nav_runtime_t *nav);
void NavFsm_Reset(nav_runtime_t *nav);
```

Responsibilities:

- load one route
- dispatch motion primitives for each route step
- wait until the current primitive completes
- move to the next route step
- report route success when the target marker is reached

#### Layer D. Plan executor

This layer reads `plan_action_t`, resolves the target node, and calls the navigation layer.

Example functions:

```c
const plan_action_t *PlanExecutor_GetCurrentAction(const plan_runtime_t *runtime,
                                                   const match_state_t *state);
node_id_t PlanExecutor_ResolveTargetNode(const plan_action_t *action,
                                         const match_state_t *state);
```

Responsibilities:

- pick the next high-level action
- convert it to a target node
- trigger route execution
- request manipulator actions after navigation completes

### 14.4 Example motor layer

```c
void Motor_Stop(void)
{
    Motor_SetDuty(0, 0);
}

void Motor_SetDuty(int16_t left_pwm, int16_t right_pwm)
{
    /* Example only:
       - set GPIO direction pins from the sign
       - set timer PWM compare from the magnitude
    */
}
```

This is intentionally small. The motor layer should stay dumb and predictable.

### 14.5 Example motion primitives

```c
void Motion_StartTurnRight(void)
{
    g_motion.mode = MOTION_TURN_RIGHT;
    g_motion.result = MOTION_RESULT_BUSY;
    g_motion.state = 0U;
}

void Motion_Tick(void)
{
    switch (g_motion.mode)
    {
    case MOTION_TURN_RIGHT:
        Motion_TurnRightTick();
        break;

    case MOTION_GO_STRAIGHT_THROUGH_JUNCTION:
        Motion_GoStraightTick();
        break;

    case MOTION_LINE_FOLLOW:
        Motion_LineFollowTick();
        break;

    case MOTION_ENTER_BRANCH:
        Motion_EnterBranchTick();
        break;

    case MOTION_STOP_ON_MARKER:
        Motion_StopOnMarkerTick();
        break;

    case MOTION_IDLE:
    case MOTION_TURN_LEFT:
    default:
        break;
    }
}
```

Example right-turn behavior:

```c
static void Motion_TurnRightTick(void)
{
    if (LineSensors_RightBranchDetected())
    {
        Motor_SetDuty(+TURN_PWM, -TURN_PWM);
    }
    else if (LineSensors_CenterAligned())
    {
        Motor_Stop();
        g_motion.result = MOTION_RESULT_DONE;
        g_motion.mode = MOTION_IDLE;
    }
    else
    {
        Motor_SetDuty(+TURN_PWM, -TURN_PWM);
    }
}
```

This is still only an example. The exact sensor logic depends on your robot.

### 14.6 Example navigation FSM using route steps

```c
void NavFsm_Tick(nav_runtime_t *nav)
{
    const route_step_t *step;

    if (nav->active == 0U)
    {
        return;
    }

    if (Motion_GetResult() == MOTION_RESULT_BUSY)
    {
        Motion_Tick();
        return;
    }

    if (Motion_GetResult() == MOTION_RESULT_FAILED)
    {
        nav->active = 0U;
        nav->status = NAV_FAILED;
        return;
    }

    if (nav->route_step_index >= nav->route.step_count)
    {
        nav->active = 0U;
        nav->status = NAV_REACHED_TARGET;
        return;
    }

    step = &nav->route.steps[nav->route_step_index];

    switch (*step)
    {
    case STEP_LEFT:
        Motion_StartTurnLeft();
        break;

    case STEP_RIGHT:
        Motion_StartTurnRight();
        break;

    case STEP_STRAIGHT:
        Motion_StartGoStraightThroughJunction();
        break;

    case STEP_ENTER_BRANCH:
        Motion_StartEnterBranch();
        break;

    case STEP_STOP_ON_MARKER:
        Motion_StartStopOnMarker();
        break;

    default:
        nav->active = 0U;
        nav->status = NAV_FAILED;
        return;
    }

    nav->route_step_index++;
}
```

This is the key point:

- the route table drives the navigation FSM
- the navigation FSM drives motion primitives
- the motion primitives drive the motors



## 15. Expected Result At Runtime

If the firmware integration is correct, the program should behave like this:

### 15.1 Before start

- tables are present in flash
- match state is reset
- route and plan modules are initialized
- either:
  - a fixed `layout_id` is selected
  - or all `576` layouts are active in the tracker

### 15.2 After start

- firmware chooses a plan or begins inference
- current action is decoded
- a target node is resolved
- the matching route entry is loaded

### 15.3 During navigation

- navigation FSM consumes route steps one by one
- junction decisions match `STEP_LEFT`, `STEP_RIGHT`, `STEP_STRAIGHT`, or `STEP_ENTER_BRANCH`
- the robot stops on the target marker

### 15.4 During manipulation

- the manipulator routine runs only after target arrival
- on success, logical match state is updated
- the next plan action becomes active

### 15.5 At end of round

- plan reaches `ACT_RETURN_START` then `ACT_END_ROUND`, or
- timeout/failure triggers stop or fallback

### 15.6 Observable debug output

Recommended UART log style:

```text
[MATCH] layout_id=173 locked=1 mode=NORMAL
[PLAN] step=4 type=ACT_PICK_RESOURCE arg0=BRANCH_BLUE arg1=1
[ROUTE] from=NODE_BLACK_ZONE_RIGHT to=NODE_R_BLUE_2 valid=1 steps=6
[NAV] route complete target=NODE_R_BLUE_2
[MANIP] pick resource branch=BLUE slot=2 result=done
[STATE] plan_step_index=5 current_node=NODE_R_BLUE_2 picked_mask=0x12
```

If you can produce logs like this, debugging integration becomes much easier.

## 16. What Firmware Must Not Assume

The firmware must not assume:

- that plan actions are motor primitives
- that route steps are open-loop motion durations
- that `ACT_DROP_LOCK` always goes to the same black zone
- that the simulator UI state is needed onboard
- that the planner will run on the STM32

The firmware should assume only:

- generated tables are the offline contract
- route entries are navigation intent
- actions are high-level tasks
- physical execution is still closed-loop and sensor-driven

## 17. Recommended Implementation Order

Your should build this in the following order.

### Stage 1. Table integration

- compile generated headers and sources into STM32 project
- verify symbols are visible
- print representative table entries over UART

### Stage 2. Known-layout execution

- hardcode one `layout_id`
- load one plan row
- decode actions
- resolve target nodes
- print route lookups over UART

### Stage 3. Navigation integration

- connect `g_route_table` to line-following and junction code
- reach target markers reliably

### Stage 4. Manipulator integration

- run pickup/drop routines at target nodes
- update match state correctly

### Stage 5. Full plan execution

- execute full action list
- confirm plan-step advancement and return-to-start behavior

### Stage 6. Layout inference

- add candidate tracker over `g_layouts`
- lock `layout_id` from observations
- switch from fallback to exact plan execution

## 18. Final Implementation Checklist

- Generated table files compile inside the STM32 project.
- `g_layouts`, `g_plan_table`, `g_plan_table_lifo`, and `g_route_table` can all be read at runtime.
- One `layout_id` can be selected and mapped to one plan row.
- Each action type is decoded correctly.
- Each action resolves to the correct target node.
- Each target node produces a valid route lookup.
- Navigation FSM can execute route steps reliably.
- Manipulator FSM can report busy, done, and failed states cleanly.
- Match state is updated only after confirmed action success.
- `ACT_DROP_LOCK` chooses the nearest valid black zone.
- `ACT_RETURN_START` returns to `NODE_START`.
- `ACT_END_ROUND` stops execution cleanly.
- UART logs clearly show layout, plan step, route lookup, and action result.
- Layout inference can reduce candidates from `576` to one locked layout.

## 19. Summary

The generated tables are not the whole firmware. They are the planning contract.

The STM32 program still needs to provide:

- a match state machine
- a navigation FSM
- a manipulator FSM
- layout inference
- action-result handling
- fallback behavior

The clean mental model is:

1. `g_layouts` tells firmware what a legal layout looks like.
2. `g_plan_table[layout_id]` tells firmware what high-level tasks to do.
3. `g_route_table[from][to]` tells firmware how to travel between important nodes.
4. Firmware closes the loop with sensors, line following, manipulation, and state updates.

That is how this repository is meant to be executed on the STM32 side.



------



Yes. For this project, the clean stack from top to bottom is:

1. Match strategy layer
2. Plan execution layer
3. Route lookup layer
4. Navigation FSM layer
5. Motion primitive layer
6. Sensor interpretation layer
7. Motor driver layer
8. HAL / hardware layer

Below is the full version in project terms.

**1. Match Strategy Layer**

This is the top brain of the robot.

It decides:
- are we using fixed `layout_id` or inference mode
- which plan table to use
- whether we continue normal execution or fallback
- when the whole round is finished

Typical file:
- `app_match.c`

Typical responsibilities:
- start match
- select layout
- select current action
- handle timeout
- trigger fallback if needed

Example:
```c
typedef enum
{
    MATCH_IDLE = 0,
    MATCH_WAIT_START,
    MATCH_SELECT_LAYOUT,
    MATCH_SELECT_ACTION,
    MATCH_NAVIGATE,
    MATCH_MANIPULATE,
    MATCH_APPLY_RESULT,
    MATCH_FALLBACK,
    MATCH_FINISHED,
    MATCH_ABORTED
} match_fsm_state_t;

static match_fsm_state_t g_match_state_fsm;
static match_state_t g_match_state;
static plan_runtime_t g_plan_runtime;

void Match_Tick(void)
{
    switch (g_match_state_fsm)
    {
    case MATCH_WAIT_START:
        if (StartButton_Pressed())
        {
            g_match_state_fsm = MATCH_SELECT_LAYOUT;
        }
        break;

    case MATCH_SELECT_LAYOUT:
        if (g_layout_locked != 0U)
        {
            PlanExecutor_Load(&g_plan_runtime, g_selected_layout_id, PLAN_MODE_NORMAL);
            g_match_state_fsm = MATCH_SELECT_ACTION;
        }
        else
        {
            g_match_state_fsm = MATCH_FALLBACK;
        }
        break;

    case MATCH_SELECT_ACTION:
        Match_SelectActionStep();
        break;

    case MATCH_NAVIGATE:
        Match_NavigateStep();
        break;

    case MATCH_MANIPULATE:
        Match_ManipulateStep();
        break;

    case MATCH_APPLY_RESULT:
        Match_ApplyResultStep();
        break;

    case MATCH_FALLBACK:
        Fallback_Tick();
        break;

    case MATCH_FINISHED:
    case MATCH_ABORTED:
    case MATCH_IDLE:
    default:
        break;
    }
}
```

**2. Plan Execution Layer**

This layer reads the generated plan table.

It answers:
- what is the current action
- what does `arg0` mean
- what target node does this action imply
- when do we increment `plan_step_index`

Typical file:
- `app_plan_executor.c`

Typical responsibilities:
- load `g_plan_table[layout_id]`
- get current `plan_action_t`
- convert action to target node

Example:
```c
typedef struct
{
    const plan_desc_t *plan;
    uint16_t layout_id;
    plan_mode_t mode;
} plan_runtime_t;

void PlanExecutor_Load(plan_runtime_t *runtime, uint16_t layout_id, plan_mode_t mode)
{
    runtime->layout_id = layout_id;
    runtime->mode = mode;

    if (mode == PLAN_MODE_LIFO)
    {
        runtime->plan = &g_plan_table_lifo[layout_id];
    }
    else
    {
        runtime->plan = &g_plan_table[layout_id];
    }
}

const plan_action_t *PlanExecutor_GetCurrentAction(const plan_runtime_t *runtime,
                                                   const match_state_t *state)
{
    if (state->plan_step_index >= runtime->plan->action_count)
    {
        return NULL;
    }

    return &runtime->plan->actions[state->plan_step_index];
}
```

Target-node resolution:
```c
node_id_t PlanExecutor_ResolveTargetNode(const plan_action_t *action,
                                         const match_state_t *state)
{
    switch (action->type)
    {
    case ACT_PICK_LOCK:
        switch (action->arg0)
        {
        case BRANCH_RED:    return NODE_LOCK_RED;
        case BRANCH_YELLOW: return NODE_LOCK_YELLOW;
        case BRANCH_BLUE:   return NODE_LOCK_BLUE;
        case BRANCH_GREEN:  return NODE_LOCK_GREEN;
        default:            return state->current_node;
        }

    case ACT_DROP_LOCK:
        return Route_GetNearestBlackZone(state->current_node);

    case ACT_PICK_RESOURCE:
        if (action->arg1 == 0U)
        {
            switch (action->arg0)
            {
            case BRANCH_RED:    return NODE_R_RED_1;
            case BRANCH_YELLOW: return NODE_R_YELLOW_1;
            case BRANCH_BLUE:   return NODE_R_BLUE_1;
            case BRANCH_GREEN:  return NODE_R_GREEN_1;
            default:            return state->current_node;
            }
        }
        else
        {
            switch (action->arg0)
            {
            case BRANCH_RED:    return NODE_R_RED_2;
            case BRANCH_YELLOW: return NODE_R_YELLOW_2;
            case BRANCH_BLUE:   return NODE_R_BLUE_2;
            case BRANCH_GREEN:  return NODE_R_GREEN_2;
            default:            return state->current_node;
            }
        }

    case ACT_DROP_RESOURCE:
        switch (action->arg0)
        {
        case COLOR_RED:    return NODE_ZONE_RED;
        case COLOR_YELLOW: return NODE_ZONE_YELLOW;
        case COLOR_BLUE:   return NODE_ZONE_BLUE;
        case COLOR_GREEN:  return NODE_ZONE_GREEN;
        default:           return state->current_node;
        }

    case ACT_RETURN_START:
        return NODE_START;

    default:
        return state->current_node;
    }
}
```

**3. Route Lookup Layer**

This layer wraps `g_route_table`.

It answers:
- how do I go from current node to target node
- which black zone is closer
- is a route valid

Typical file:
- `app_route.c`

Example:
```c
const route_entry_t *Route_Get(node_id_t from_node, node_id_t to_node)
{
    return &g_route_table[from_node][to_node];
}

uint8_t Route_IsValid(node_id_t from_node, node_id_t to_node)
{
    return (g_route_table[from_node][to_node].valid != 0U) ? 1U : 0U;
}

node_id_t Route_GetNearestBlackZone(node_id_t from_node)
{
    const route_entry_t *left_route = &g_route_table[from_node][NODE_BLACK_ZONE];
    const route_entry_t *right_route = &g_route_table[from_node][NODE_BLACK_ZONE_RIGHT];

    if (left_route->valid == 0U)
    {
        return NODE_BLACK_ZONE_RIGHT;
    }

    if (right_route->valid == 0U)
    {
        return NODE_BLACK_ZONE;
    }

    if (left_route->step_count <= right_route->step_count)
    {
        return NODE_BLACK_ZONE;
    }

    return NODE_BLACK_ZONE_RIGHT;
}
```

**4. Navigation FSM Layer**

This is where route steps become actual robot behavior.

It answers:
- what route step am I currently executing
- did I reach the next junction
- should I turn left/right/straight
- have I reached the target marker

Typical file:
- `app_nav_fsm.c`

Example:
```c
typedef enum
{
    NAV_IDLE = 0,
    NAV_RUNNING,
    NAV_REACHED_TARGET,
    NAV_FAILED,
    NAV_TIMEOUT
} nav_status_t;

typedef struct
{
    route_entry_t route;
    uint8_t route_step_index;
    uint8_t active;
    node_id_t target_node;
    nav_status_t status;
} nav_runtime_t;

void NavFsm_StartRoute(nav_runtime_t *nav,
                       node_id_t target_node,
                       const route_entry_t *route)
{
    nav->route = *route;
    nav->route_step_index = 0U;
    nav->active = 1U;
    nav->target_node = target_node;
    nav->status = NAV_RUNNING;
    Motion_Reset();
}
```

Tick function:
```c
void NavFsm_Tick(nav_runtime_t *nav)
{
    route_step_t step;

    if (nav->active == 0U)
    {
        return;
    }

    Motion_Tick();

    if (Motion_GetResult() == MOTION_RESULT_BUSY)
    {
        return;
    }

    if (Motion_GetResult() == MOTION_RESULT_FAILED)
    {
        nav->active = 0U;
        nav->status = NAV_FAILED;
        return;
    }

    if (nav->route_step_index >= nav->route.step_count)
    {
        nav->active = 0U;
        nav->status = NAV_REACHED_TARGET;
        return;
    }

    step = (route_step_t)nav->route.steps[nav->route_step_index];

    switch (step)
    {
    case STEP_LEFT:
        Motion_StartTurnLeft();
        break;

    case STEP_RIGHT:
        Motion_StartTurnRight();
        break;

    case STEP_STRAIGHT:
        Motion_StartGoStraightThroughJunction();
        break;

    case STEP_ENTER_BRANCH:
        Motion_StartEnterBranch();
        break;

    case STEP_STOP_ON_MARKER:
        Motion_StartStopOnMarker();
        break;

    default:
        nav->active = 0U;
        nav->status = NAV_FAILED;
        return;
    }

    nav->route_step_index++;
}
```

**5. Motion Primitive Layer**

This is where your original idea fits.

This layer answers:
- how do I perform one left turn
- how do I cross one junction straight
- how do I enter one branch
- how do I stop on one marker

Typical file:
- `app_motion.c`

State:
```c
typedef enum
{
    MOTION_IDLE = 0,
    MOTION_LINE_FOLLOW,
    MOTION_TURN_LEFT,
    MOTION_TURN_RIGHT,
    MOTION_STRAIGHT_THROUGH_JUNCTION,
    MOTION_ENTER_BRANCH,
    MOTION_STOP_ON_MARKER
} motion_mode_t;

typedef enum
{
    MOTION_RESULT_BUSY = 0,
    MOTION_RESULT_DONE,
    MOTION_RESULT_FAILED,
    MOTION_RESULT_TIMEOUT
} motion_result_t;

typedef struct
{
    motion_mode_t mode;
    motion_result_t result;
    uint8_t junction_latched;
    uint16_t timeout_ticks;
} motion_runtime_t;

static motion_runtime_t g_motion;
```

Start functions:
```c
void Motion_StartTurnRight(void)
{
    g_motion.mode = MOTION_TURN_RIGHT;
    g_motion.result = MOTION_RESULT_BUSY;
    g_motion.junction_latched = 0U;
    g_motion.timeout_ticks = 0U;
}

void Motion_StartGoStraightThroughJunction(void)
{
    g_motion.mode = MOTION_STRAIGHT_THROUGH_JUNCTION;
    g_motion.result = MOTION_RESULT_BUSY;
    g_motion.junction_latched = 0U;
    g_motion.timeout_ticks = 0U;
}
```

Tick dispatcher:
```c
void Motion_Tick(void)
{
    switch (g_motion.mode)
    {
    case MOTION_TURN_RIGHT:
        Motion_TurnRightTick();
        break;

    case MOTION_TURN_LEFT:
        Motion_TurnLeftTick();
        break;

    case MOTION_STRAIGHT_THROUGH_JUNCTION:
        Motion_GoStraightTick();
        break;

    case MOTION_ENTER_BRANCH:
        Motion_EnterBranchTick();
        break;

    case MOTION_STOP_ON_MARKER:
        Motion_StopOnMarkerTick();
        break;

    case MOTION_LINE_FOLLOW:
        Motion_LineFollowTick();
        break;

    case MOTION_IDLE:
    default:
        break;
    }
}
```

Your earlier function, improved:
```c
static void Motion_TurnRightTick(void)
{
    sensor_snapshot_t s = Sensors_GetSnapshot();

    if (s.junction_detected == 0U)
    {
        Motor_SetDuty(+TURN_PWM, -TURN_PWM);
        return;
    }

    if ((g_motion.junction_latched == 0U) && (s.right_branch_confirmed != 0U))
    {
        g_motion.junction_latched = 1U;
        Motor_SetDuty(+TURN_PWM, -TURN_PWM);
        return;
    }

    if ((g_motion.junction_latched != 0U) && (s.center_aligned != 0U))
    {
        Motor_Stop();
        g_motion.result = MOTION_RESULT_DONE;
        g_motion.mode = MOTION_IDLE;
        return;
    }

    Motor_SetDuty(+TURN_PWM, -TURN_PWM);
}
```

**6. Sensor Interpretation Layer**

This layer converts raw sensor values into useful navigation events.

It answers:
- is the robot centered on the line
- is there a left branch
- is this a T junction
- is a marker detected
- has the robot exited the junction region

Typical file:
- `app_sensors_nav.c`

Example:
```c
typedef struct
{
    uint8_t center_aligned;
    uint8_t left_branch_confirmed;
    uint8_t right_branch_confirmed;
    uint8_t t_junction_confirmed;
    uint8_t junction_detected;
    uint8_t marker_detected;
    uint8_t line_lost;
} sensor_snapshot_t;

sensor_snapshot_t Sensors_GetSnapshot(void)
{
    sensor_snapshot_t s;
    uint16_t raw_left   = IR_Read(0);
    uint16_t raw_mid_l  = IR_Read(1);
    uint16_t raw_mid    = IR_Read(2);
    uint16_t raw_mid_r  = IR_Read(3);
    uint16_t raw_right  = IR_Read(4);

    s.center_aligned = (raw_mid > THRESH_LINE) ? 1U : 0U;
    s.left_branch_confirmed = ((raw_left > THRESH_LINE) && (raw_mid > THRESH_LINE)) ? 1U : 0U;
    s.right_branch_confirmed = ((raw_right > THRESH_LINE) && (raw_mid > THRESH_LINE)) ? 1U : 0U;
    s.t_junction_confirmed = ((raw_left > THRESH_LINE) &&
                              (raw_mid > THRESH_LINE) &&
                              (raw_right > THRESH_LINE)) ? 1U : 0U;
    s.junction_detected = (s.left_branch_confirmed ||
                           s.right_branch_confirmed ||
                           s.t_junction_confirmed) ? 1U : 0U;
    s.marker_detected = MarkerSensor_Read();
    s.line_lost = ((raw_left < THRESH_LINE) &&
                   (raw_mid_l < THRESH_LINE) &&
                   (raw_mid < THRESH_LINE) &&
                   (raw_mid_r < THRESH_LINE) &&
                   (raw_right < THRESH_LINE)) ? 1U : 0U;

    return s;
}
```

Important: this layer should debounce events. Raw sensors are noisy.

**7. Motor Driver Layer**

This layer converts desired wheel commands into PWM and GPIO.

It answers:
- what PWM should left and right motors get
- should a motor go forward or reverse
- should the motors stop or brake

Typical file:
- `bsp_motor.c`

Example:
```c
void Motor_SetDuty(int16_t left_pwm, int16_t right_pwm)
{
    Motor_SetOne(MOTOR_LEFT, left_pwm);
    Motor_SetOne(MOTOR_RIGHT, right_pwm);
}

static void Motor_SetOne(motor_id_t motor, int16_t pwm)
{
    GPIO_TypeDef *dir_port;
    uint16_t dir_pin;
    TIM_HandleTypeDef *htim;
    uint32_t channel;
    uint16_t abs_pwm;

    abs_pwm = (pwm >= 0) ? (uint16_t)pwm : (uint16_t)(-pwm);

    if (motor == MOTOR_LEFT)
    {
        dir_port = L_DIR_GPIO_Port;
        dir_pin = L_DIR_Pin;
        htim = &htim1;
        channel = TIM_CHANNEL_1;
    }
    else
    {
        dir_port = R_DIR_GPIO_Port;
        dir_pin = R_DIR_Pin;
        htim = &htim1;
        channel = TIM_CHANNEL_2;
    }

    HAL_GPIO_WritePin(dir_port, dir_pin, (pwm >= 0) ? GPIO_PIN_SET : GPIO_PIN_RESET);
    __HAL_TIM_SET_COMPARE(htim, channel, abs_pwm);
}

void Motor_Stop(void)
{
    Motor_SetDuty(0, 0);
}
```

**8. HAL / Hardware Layer**

This is the very bottom.

It answers:
- how do I read ADC
- how do I set PWM
- how do I read GPIO
- how do I use timers and interrupts

Typical files:
- `main.c`
- `tim.c`
- `adc.c`
- `gpio.c`
- `stm32xxxx_hal_*.c`

Example:
```c
uint16_t IR_Read(uint8_t channel_index)
{
    HAL_ADC_Start(&hadc1);
    HAL_ADC_PollForConversion(&hadc1, 10);
    return (uint16_t)HAL_ADC_GetValue(&hadc1);
}

uint8_t MarkerSensor_Read(void)
{
    return (HAL_GPIO_ReadPin(MARKER_GPIO_Port, MARKER_Pin) == GPIO_PIN_SET) ? 1U : 0U;
}
```

**Where layout inference fits**

This sits near the top, beside the match layer, not near motors.

Stack-wise:
- `app_match`
  - may call `app_layout_inference`
  - may call `app_plan_executor`
- but motor code never touches layout inference

Example:
```c
void LayoutTracker_ApplyObservation(layout_tracker_t *tracker,
                                    branch_id_t branch,
                                    uint8_t slot_index,
                                    color_id_t observed_color)
{
    uint16_t layout_id;

    for (layout_id = 0; layout_id < g_layout_count; layout_id++)
    {
        if (LayoutTracker_IsCandidateActive(tracker, layout_id) == 0U)
        {
            continue;
        }

        if (g_layouts[layout_id].slots[branch][slot_index] != observed_color)
        {
            LayoutTracker_ClearCandidate(tracker, layout_id);
        }
    }
}
```

**Complete end-to-end flow**

One action execution in the real firmware should look like this:

1. `Match_Tick()` asks for current plan action
2. `PlanExecutor_GetCurrentAction()` returns, for example, `ACT_PICK_RESOURCE`
3. `PlanExecutor_ResolveTargetNode()` returns `NODE_R_BLUE_2`
4. `Route_Get(current_node, NODE_R_BLUE_2)` returns a `route_entry_t`
5. `NavFsm_StartRoute()` starts executing route steps
6. `NavFsm_Tick()` dispatches route steps one by one
7. `Motion_StartTurnRight()` or `Motion_StartGoStraightThroughJunction()` runs
8. `Motion_Tick()` uses sensor interpretation
9. sensor layer decides whether junction/marker/line-loss happened
10. motor layer drives wheels through HAL
11. when target is reached, manipulator function runs
12. match state updates
13. `plan_step_index++`

**The shortest summary**

Top to bottom:

1. `Match / strategy`
2. `Layout inference`
3. `Plan executor`
4. `Route lookup`
5. `Navigation FSM`
6. `Motion primitives`
7. `Sensor interpretation`
8. `Motor driver`
9. `STM32 HAL`

If you want, I can turn this into a clean diagram and also give you one concrete worked example:
`ACT_PICK_LOCK(BRANCH_RED)` from top layer all the way down to PWM calls.
