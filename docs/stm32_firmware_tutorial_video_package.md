# STM32 Firmware Tutorial Video Package

Status: `Lightweight narrated slide package`

Source material:

- `docs/stm32_firmware_implementation_guide.md`
- `generated/stm32/generated_layouts.h`
- `generated/stm32/generated_plan_table.h`
- `generated/stm32/generated_plan_table_lifo.h`
- `generated/stm32/generated_routes.h`

## Goal

This package is a ready-to-render tutorial outline for explaining how STM32 firmware should use the generated planning files in this repository.

It is designed for:

- a narrated slide video
- a screen-recorded walkthrough
- a future Remotion or presentation-based render

Recommended runtime: `7 to 9 minutes`

Recommended audience:

- firmware teammates integrating the generated STM32 headers
- robotics teammates who need a practical mental model of the offline-planning-to-firmware pipeline

## Video Promise

By the end of the tutorial, the viewer should understand:

1. what each generated file contains
2. how firmware selects a layout and plan
3. how an action becomes a route lookup and manipulator call
4. how to ship a safe bring-up path before full layout inference

## Presentation Style

Tone:

- practical
- implementation-focused
- not simulator-heavy
- aimed at embedded developers

Visual style:

- dark code editor screenshots or clean monospace slides
- simple node-flow diagrams
- one core idea per slide

## Slide Plan

### Slide 1: Title

On-screen title:

`How STM32 Firmware Uses Generated Planning Tables`

Supporting text:

`From offline planner output to a real match-state machine`

Visual:

- show the four generated files as a stack:
  - `generated_layouts.h`
  - `generated_plan_table.h`
  - `generated_plan_table_lifo.h`
  - `generated_routes.h`

Narration:

This tutorial shows how the STM32 firmware should consume the generated planning tables from this repository. The goal is not to run the simulator onboard. The goal is to store compact tables in flash, decode them on the microcontroller, and execute a real match program through navigation and manipulator state machines.

### Slide 2: Big Picture

On-screen title:

`Offline Planning, Onboard Execution`

Bullets:

- plan expensive strategy work on the PC
- compile compact tables into firmware
- choose a layout
- decode actions
- execute routes and manipulator tasks

Visual:

- flow diagram: `PC planner -> generated C tables -> STM32 match FSM -> robot movement`

Narration:

The project splits the problem in two. Expensive search and planning happen offline on the PC. The generated results are exported as C tables. Then the STM32 firmware reads those tables, selects the right plan, and turns each high-level action into navigation and manipulator work on the actual robot.

### Slide 3: Generated File Roles

On-screen title:

`What Each Generated File Means`

Table:

- `generated_layouts.h`: legal field layouts
- `generated_plan_table.h`: default action plan per layout
- `generated_plan_table_lifo.h`: alternate plan if carried resources must drop in true LiFo order
- `generated_routes.h`: compact route primitives between important nodes

Narration:

Think of these files as an interface contract. Layouts describe the field content. Plan tables describe what the robot should do for a chosen layout. Routes describe how to travel between important nodes. None of these files are direct motor commands. They are compact strategic data that firmware still has to interpret.

### Slide 4: Layout Table

On-screen title:

`Layouts: Field Content, Not Motion`

Code snippet:

```c
extern const uint16_t g_layout_count;
extern const layout_desc_t g_layouts[576];
```

Callouts:

- `g_layout_count` should be `576`
- `slots[branch][0]` and `slots[branch][1]` store the two resource colors for each branch
- use for inference, debugging, and validation

Narration:

The layout table says what colors appear in each branch slot for every legal field arrangement. Firmware can use it to filter layout candidates as it observes colors on the robot. But it should not treat this table as a motion script. It only describes field content.

### Slide 5: Plan Table

On-screen title:

`Plans: High-Level Tasks Per Layout`

Code snippet:

```c
extern const plan_desc_t g_plan_table[576];
```

Key points:

- one precomputed plan row per `layout_id`
- `action_count` tells how many entries are active
- actions are logical tasks, not wheel commands

Show action types:

- `ACT_PICK_LOCK`
- `ACT_DROP_LOCK`
- `ACT_PICK_RESOURCE`
- `ACT_DROP_RESOURCE`
- `ACT_RETURN_START`
- `ACT_END_ROUND`

Narration:

Once firmware knows the layout, it loads exactly one plan row. Each action tells the robot what kind of task to perform next, like picking a lock, dropping a resource, or returning to start. The firmware still has to resolve target nodes, fetch routes, and update match state after success.

### Slide 6: Route Table

On-screen title:

`Routes: Junction Decisions Between Nodes`

Code snippet:

```c
extern const route_entry_t g_route_table[NODE_ID_T_COUNT][NODE_ID_T_COUNT];
```

Key points:

- indexed by `from_node` and `to_node`
- `valid` must be checked
- `step_count` tells how many route steps are active

Route steps:

- `STEP_STRAIGHT`
- `STEP_LEFT`
- `STEP_RIGHT`
- `STEP_ENTER_BRANCH`
- `STEP_STOP_ON_MARKER`

Narration:

The route table is the bridge between strategy and motion. A route entry does not tell the motors what PWM to output. Instead it gives compact junction-level decisions that a navigation state machine can consume while line following and detecting markers.

### Slide 7: Recommended Firmware Modules

On-screen title:

`Suggested Firmware Architecture`

Boxes:

- `app_match`
- `app_match_state`
- `app_layout_inference`
- `app_plan_executor`
- `app_route`
- `app_nav_fsm`
- `app_manipulator`
- `app_fallback`

Narration:

The guide recommends a HAL-style split so planning logic, navigation, and manipulation stay decoupled. `app_match` coordinates the round. `app_match_state` stores logical progress. `app_plan_executor` decodes the current action. `app_route` wraps route lookups. `app_nav_fsm` handles closed-loop movement. `app_manipulator` handles pickup and drop behavior. `app_fallback` covers failure paths and uncertain inference states.

### Slide 8: Core Runtime State

On-screen title:

`What Firmware Needs To Track`

Highlight these concepts:

- current logical node
- held and cleared lock masks
- picked and dropped resource masks
- inventory count
- elapsed time
- current plan step index
- layout tracker bitset

Narration:

The generated files are static flash data, but execution still needs runtime state. Firmware should track where the robot logically is, what it is carrying, which branch tasks are complete, how many layouts remain possible, and which action index is currently active. Keeping this state explicit makes retries, debugging, and fallback behavior much easier.

### Slide 9: The Core Lookup Sequence

On-screen title:

`The Most Important Pattern`

Show numbered flow:

1. select `layout_id`
2. load `plan = &g_plan_table[layout_id]`
3. read `plan->actions[state->plan_step_index]`
4. resolve the target node
5. load `route = &g_route_table[current_node][target_node]`
6. navigate
7. manipulate if needed
8. update state
9. advance `plan_step_index`

Narration:

This is the core firmware-side pattern to remember. The generated plan does not directly move the robot. Instead the firmware repeatedly chooses the current action, resolves the destination node, looks up a route, runs navigation, performs the physical action, updates logical state, and only then advances to the next action.

### Slide 10: Action Decoding Map

On-screen title:

`How To Decode Actions`

Visual mapping:

- `ACT_PICK_LOCK(branch)` -> `NODE_LOCK_<branch>`
- `ACT_DROP_LOCK(branch)` -> nearest black zone
- `ACT_PICK_RESOURCE(branch, slot)` -> `NODE_R_<branch>_<slot>`
- `ACT_DROP_RESOURCE(color)` -> matching score zone
- `ACT_RETURN_START` -> `NODE_START`
- `ACT_END_ROUND` -> finish immediately

Narration:

Each action type has a consistent decode rule. Pick-lock actions map directly to branch lock nodes. Pick-resource actions map to one of the two branch slot nodes. Drop-resource actions map by color to scoring zones. Drop-lock is special because firmware must choose the nearest black zone dynamically. End-round is also special because it needs no route lookup at all.

### Slide 11: Match FSM

On-screen title:

`Top-Level Match State Machine`

State list:

- `MATCH_IDLE`
- `MATCH_WAIT_START`
- `MATCH_SELECT_LAYOUT`
- `MATCH_SELECT_ACTION`
- `MATCH_NAVIGATE`
- `MATCH_MANIPULATE`
- `MATCH_APPLY_RESULT`
- `MATCH_FALLBACK`
- `MATCH_FINISHED`
- `MATCH_ABORTED`

Narration:

The cleanest way to run all this on STM32 is with a scheduler-driven match state machine. One state chooses the layout. One selects the current action. One runs navigation. One runs the manipulator. One applies the result. This structure makes timing, retries, and timeout handling much easier than trying to do everything inside one giant function.

### Slide 12: Bring-Up Path 1

On-screen title:

`First Milestone: Known Layout Mode`

Bullets:

- skip inference at first
- hardcode or provide one `layout_id`
- load the plan
- execute action by action

Narration:

The fastest way to validate the architecture is to ignore onboard inference first. Start with a known layout identifier, load that plan from flash, and prove that the robot can execute action after action in the right order. This is the best first milestone because it isolates navigation, manipulation, and state updates before adding inference complexity.

### Slide 13: Bring-Up Path 2

On-screen title:

`Full Layout Inference`

Bullets:

- begin with all `576` candidates active
- apply observed colors from sensed slots
- eliminate mismatches
- lock `layout_id` when one candidate remains

Narration:

Once the known-layout path works, firmware can graduate to full inference mode. The tracker starts with all legal layouts active. Every observed branch slot color removes inconsistent candidates. When only one layout remains, firmware locks that identifier and loads the matching plan. Until then, the robot should stay in a safe observation or fallback behavior.

### Slide 14: End-To-End Example

On-screen title:

`One Action, End To End`

Example sequence:

1. current action is `ACT_PICK_RESOURCE`
2. decode branch and slot
3. resolve target node like `NODE_R_BLUE_1`
4. fetch route from current node
5. run `NavFsm`
6. call `Manipulator_PickResource`
7. update masks and current node
8. advance plan index

Narration:

Here is the full mental model in one example. If the next action is pick-resource on the blue branch first slot, firmware resolves the target node, gets the route, navigates there, performs the pickup, updates the logical state, and then advances the plan index. That same pattern repeats across most action types with only the decode rule and completion logic changing.

### Slide 15: Safety And Fallbacks

On-screen title:

`What To Do When Things Go Wrong`

Bullets:

- invalid route lookup is a configuration fault
- repeated manipulator failure should trigger fallback
- uncertain layout should not start omniscient execution too early
- stop cleanly on timeout or fatal failure

Narration:

A practical firmware integration needs explicit fallback policy. If a route entry is invalid, that is a table or integration error and should be treated seriously. If manipulation fails repeatedly, firmware should retry only within safe limits and then switch to fallback behavior. And if layout inference is still ambiguous, the robot should not pretend it knows the plan.

### Slide 16: Closing

On-screen title:

`Implementation Checklist`

Checklist:

- include generated headers in firmware
- build match state and layout tracker
- implement plan decoding
- wrap route lookup
- connect navigation FSM
- connect manipulator FSM
- validate known-layout mode
- add inference mode

Narration:

The key idea is simple: offline planning gives you compact strategic data, and firmware turns that data into robust closed-loop execution. Start with a known layout, validate the action decode and route flow, then add inference once the basics are solid. If you keep the responsibilities separated, the generated files become a very practical embedded interface.

## Recommended Asset List

Use these visuals when rendering later:

1. A simple pipeline diagram for the planner-to-firmware flow
2. Code screenshots from the generated STM32 headers
3. A table or card layout showing action-type mappings
4. A state machine diagram for the match FSM
5. A candidate-filtering animation for layout inference
6. A final checklist slide

## Suggested Rendering Notes

If rendering later in slides, screen recording, or Remotion:

- keep code at large monospace sizes
- animate only one idea at a time
- highlight `layout_id`, `action`, `target_node`, and `route`
- use color carefully so branch and zone mappings stay visually distinct
- avoid dense full-screen code dumps; crop to only the symbols being discussed

## Presenter Notes

Important emphasis points:

- the generated files are data, not direct motor behavior
- route steps are navigation decisions, not wheel velocities
- `ACT_DROP_LOCK` needs dynamic black-zone selection
- known-layout bring-up should come before full inference
- logical state updates matter just as much as physical actuation
