import { buildSceneTimings } from "../lib/timing";

export type SceneKind = "title" | "bullets" | "code" | "flow" | "checklist";

export type TutorialScene = {
  id: string;
  title: string;
  eyebrow: string;
  durationInSeconds: number;
  kind: SceneKind;
  body: string[];
  code?: string;
  accent: string;
};

export const tutorialScenes: TutorialScene[] = [
  {
    id: "title",
    title: "How STM32 Firmware Uses Generated Planning Tables",
    eyebrow: "STM32 Firmware Tutorial",
    durationInSeconds: 8,
    kind: "title",
    body: [
      "generated_layouts.h",
      "generated_plan_table.h",
      "generated_plan_table_lifo.h",
      "generated_routes.h"
    ],
    accent: "#ff6b6b"
  },
  {
    id: "big-picture",
    title: "Offline Planning, Onboard Execution",
    eyebrow: "Big Picture",
    durationInSeconds: 8,
    kind: "flow",
    body: ["PC planner", "generated C tables", "STM32 match FSM", "robot movement"],
    accent: "#f4a261"
  },
  {
    id: "file-roles",
    title: "What Each Generated File Means",
    eyebrow: "Interface Contract",
    durationInSeconds: 9,
    kind: "bullets",
    body: [
      "Layouts describe legal field content.",
      "Plan tables describe high-level tasks per layout.",
      "LiFo plan tables are only for forced stack-drop mechanics.",
      "Routes describe compact node-to-node navigation decisions."
    ],
    accent: "#e9c46a"
  },
  {
    id: "layouts",
    title: "Layouts: Field Content, Not Motion",
    eyebrow: "generated_layouts.h",
    durationInSeconds: 8,
    kind: "code",
    body: [
      "g_layout_count should be 576.",
      "slots[branch][0] and slots[branch][1] store branch resource colors.",
      "Use layouts for inference, validation, and debug output."
    ],
    code: "extern const uint16_t g_layout_count;\nextern const layout_desc_t g_layouts[576];",
    accent: "#2a9d8f"
  },
  {
    id: "plan-table",
    title: "Plans: High-Level Tasks Per Layout",
    eyebrow: "generated_plan_table.h",
    durationInSeconds: 9,
    kind: "code",
    body: [
      "One precomputed plan row exists for each layout_id.",
      "action_count limits the active actions in that row.",
      "Actions are logical tasks, not wheel or motor commands."
    ],
    code:
      "typedef enum {\n  ACT_PICK_LOCK,\n  ACT_DROP_LOCK,\n  ACT_PICK_RESOURCE,\n  ACT_DROP_RESOURCE,\n  ACT_RETURN_START,\n  ACT_END_ROUND,\n} action_type_t;",
    accent: "#00b4d8"
  },
  {
    id: "routes",
    title: "Routes: Junction Decisions Between Nodes",
    eyebrow: "generated_routes.h",
    durationInSeconds: 9,
    kind: "code",
    body: [
      "Routes are indexed by from_node and to_node.",
      "valid must be checked before execution.",
      "steps[] are junction-level decisions for a navigation FSM."
    ],
    code:
      "extern const route_entry_t g_route_table[NODE_ID_T_COUNT][NODE_ID_T_COUNT];\n\nSTEP_STRAIGHT\nSTEP_LEFT\nSTEP_RIGHT\nSTEP_ENTER_BRANCH\nSTEP_STOP_ON_MARKER",
    accent: "#48cae4"
  },
  {
    id: "modules",
    title: "Suggested Firmware Architecture",
    eyebrow: "HAL-Style Split",
    durationInSeconds: 10,
    kind: "bullets",
    body: [
      "app_match coordinates the round.",
      "app_match_state stores logical runtime state.",
      "app_plan_executor decodes the active plan action.",
      "app_route, app_nav_fsm, app_manipulator, and app_fallback isolate execution concerns."
    ],
    accent: "#4361ee"
  },
  {
    id: "runtime-state",
    title: "What Firmware Needs To Track",
    eyebrow: "Runtime Data",
    durationInSeconds: 9,
    kind: "bullets",
    body: [
      "Current logical node",
      "Held and cleared lock masks",
      "Picked and dropped resource masks",
      "Inventory count, elapsed time, and plan_step_index"
    ],
    accent: "#3a86ff"
  },
  {
    id: "lookup-sequence",
    title: "The Most Important Pattern",
    eyebrow: "Core Lookup Sequence",
    durationInSeconds: 10,
    kind: "flow",
    body: [
      "select layout_id",
      "load the plan row",
      "read the current action",
      "resolve target_node",
      "lookup route",
      "navigate",
      "manipulate",
      "update state",
      "advance plan_step_index"
    ],
    accent: "#8338ec"
  },
  {
    id: "action-decode",
    title: "How To Decode Actions",
    eyebrow: "Action Mapping",
    durationInSeconds: 11,
    kind: "bullets",
    body: [
      "ACT_PICK_LOCK(branch) -> NODE_LOCK_<branch>",
      "ACT_DROP_LOCK(branch) -> nearest black zone",
      "ACT_PICK_RESOURCE(branch, slot) -> NODE_R_<branch>_<slot>",
      "ACT_DROP_RESOURCE(color) -> matching scoring zone",
      "ACT_RETURN_START -> NODE_START, ACT_END_ROUND -> finish now"
    ],
    accent: "#ff006e"
  },
  {
    id: "match-fsm",
    title: "Top-Level Match State Machine",
    eyebrow: "Scheduler-Driven Control",
    durationInSeconds: 10,
    kind: "flow",
    body: [
      "MATCH_WAIT_START",
      "MATCH_SELECT_LAYOUT",
      "MATCH_SELECT_ACTION",
      "MATCH_NAVIGATE",
      "MATCH_MANIPULATE",
      "MATCH_APPLY_RESULT",
      "MATCH_FALLBACK",
      "MATCH_FINISHED"
    ],
    accent: "#fb5607"
  },
  {
    id: "known-layout",
    title: "First Milestone: Known Layout Mode",
    eyebrow: "Bring-Up Path 1",
    durationInSeconds: 9,
    kind: "checklist",
    body: [
      "Skip inference at first.",
      "Provide one layout_id manually.",
      "Load the matching plan row from flash.",
      "Prove action ordering, routing, and state updates."
    ],
    accent: "#ffbe0b"
  },
  {
    id: "inference",
    title: "Full Layout Inference",
    eyebrow: "Bring-Up Path 2",
    durationInSeconds: 10,
    kind: "checklist",
    body: [
      "Start with all 576 candidates active.",
      "Apply onboard color observations.",
      "Clear inconsistent layouts.",
      "Lock the layout when one candidate remains."
    ],
    accent: "#8ac926"
  },
  {
    id: "example",
    title: "One Action, End To End",
    eyebrow: "Worked Example",
    durationInSeconds: 10,
    kind: "flow",
    body: [
      "ACT_PICK_RESOURCE",
      "decode branch and slot",
      "resolve NODE_R_BLUE_1",
      "lookup route",
      "run NavFsm",
      "call Manipulator_PickResource",
      "update masks and current node",
      "advance plan index"
    ],
    accent: "#06d6a0"
  },
  {
    id: "fallback",
    title: "What To Do When Things Go Wrong",
    eyebrow: "Fallback Policy",
    durationInSeconds: 9,
    kind: "bullets",
    body: [
      "Invalid routes are configuration faults.",
      "Manipulator retries should be bounded.",
      "Do not execute omniscient plans before inference is trustworthy.",
      "Stop cleanly on timeout or fatal failure."
    ],
    accent: "#ef476f"
  },
  {
    id: "closing",
    title: "Implementation Checklist",
    eyebrow: "Closeout",
    durationInSeconds: 9,
    kind: "checklist",
    body: [
      "Include generated headers in firmware.",
      "Build match state and layout tracker.",
      "Implement plan decoding and route lookup.",
      "Connect navigation and manipulator FSMs.",
      "Validate known-layout mode before inference mode."
    ],
    accent: "#118ab2"
  }
];

export const getTutorialDurationInFrames = (fps: number): number => {
  return buildSceneTimings(tutorialScenes, fps).reduce(
    (total, scene) => total + scene.durationInFrames,
    0
  );
};
