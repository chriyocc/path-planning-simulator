export type NodeKind =
  | "START"
  | "JUNCTION"
  | "BRANCH_ENTRY"
  | "BRANCH_SLOT"
  | "BLACK_ZONE"
  | "COLOR_ZONE";

export type LineType = "SOLID" | "DASHED" | "ZIGZAG" | "SINE";
export type TurnCostClass = "NONE" | "LIGHT" | "HEAVY";

export type ResourceColor = "RED" | "YELLOW" | "BLUE" | "GREEN" | "BLACK";
export type BranchId = "RED" | "YELLOW" | "BLUE" | "GREEN";

export interface Node {
  id: string;
  kind: NodeKind;
  x_mm: number;
  y_mm: number;
  meta?: {
    branchId?: BranchId;
    slotIndex?: number;
    color?: ResourceColor;
  };
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  distance_mm: number;
  line_type: LineType;
  bidirectional: boolean;
  turn_cost_class: TurnCostClass;
}

export interface Branch {
  branch_id: BranchId;
  difficulty: LineType;
  resource_points: number;
  lock_node: string;
  resource_slot_nodes: [string, string];
  entry_node: string;
}

export interface Graph {
  nodes: Record<string, Node>;
  edges: Edge[];
  adjacency: Record<string, Edge[]>;
  branches: Record<BranchId, Branch>;
  startNodeId: string;
  mainJunctionId: string;
  blackZoneIds: string[];
  colorZoneNodeIds: Record<Exclude<ResourceColor, "BLACK">, string>;
}

export interface MapSpec {
  nodes: Node[];
  edges: Edge[];
  branches: Branch[];
  startNodeId: string;
  mainJunctionId: string;
  blackZoneIds: string[];
  colorZoneNodeIds: Record<Exclude<ResourceColor, "BLACK">, string>;
}

export interface SpeedProfile {
  SOLID: number;
  DASHED: number;
  ZIGZAG: number;
  SINE: number;
}

export interface RecoveryProfile {
  line_lost_s: number;
  recovery_s: number;
}

export interface RobotProfile {
  carry_capacity: number;
  pickup_s: number;
  drop_s: number;
  junction_decision_s: number;
  speed_mm_s_by_line_type: SpeedProfile;
  turn_penalty_s: Record<TurnCostClass, number>;
  recovery_profile: RecoveryProfile;
}

export interface RoundRandomization {
  branch_to_resources: Record<BranchId, [ResourceColor, ResourceColor]>;
}

export interface InventoryItem {
  color: ResourceColor;
  sourceBranch: BranchId;
}

export interface RoundState {
  current_node: string;
  branch_to_resources: Record<BranchId, [ResourceColor, ResourceColor]>;
  locks_cleared: Record<BranchId, boolean>;
  picked_slots: Record<string, boolean>;
  inventory: InventoryItem[];
  holding_locks_for_branches: BranchId[];
  holding_lock_for_branch: BranchId | null;
  placed_locks: Array<{ branchId: BranchId; zoneId: string }>;
  placed_resources: Array<{ color: Exclude<ResourceColor, "BLACK">; sourceBranch: BranchId }>;
  score: number;
  time_elapsed_s: number;
  started_navigation: boolean;
  reached_main_junction: boolean;
  completed: boolean;
  returned_to_start: boolean;
}

export type ActionType =
  | "MOVE_TO"
  | "PICK_LOCK"
  | "DROP_LOCK"
  | "PICK_RESOURCE"
  | "DROP_RESOURCE"
  | "RETURN_START"
  | "END_ROUND";

export interface Action {
  type: ActionType;
  targetNodeId?: string;
  branchId?: BranchId;
  slotNodeId?: string;
  color?: Exclude<ResourceColor, "BLACK">;
}

export interface Observation {
  remaining_time_s: number;
  unlocked_branches: BranchId[];
  locked_branches: BranchId[];
  inventory_count: number;
  all_resources_delivered: boolean;
}

export interface TraceStep {
  action: Action;
  fromNode: string;
  toNode: string;
  path: string[];
  segment_time_s: number;
  total_time_s: number;
  score_after: number;
  note?: string;
}

export interface SimulationConfig {
  map: Graph;
  robot: RobotProfile;
  timeout_s: number;
  return_bonus: number;
  navigation_bonus: {
    leave_start: number;
    reach_main_junction: number;
  };
  lock_points: {
    grip: number;
    place: number;
  };
}

export interface SimulationResult {
  seed: number;
  state: RoundState;
  trace: TraceStep[];
  legality_violations: string[];
  policy_name: string;
}

export interface BatchResult {
  policy_name: string;
  runs: number;
  mean_score: number;
  completion_rate: number;
  mean_time_s: number;
  p50_time_s: number;
  p90_time_s: number;
  violations_count: number;
  top_seed_samples: Array<{ seed: number; score: number; time_s: number }>;
}

export interface StrategyPolicy {
  name: string;
  nextAction(state: RoundState, observation: Observation, config: SimulationConfig): Action;
}

export interface RouteRow {
  from_node: string;
  to_node: string;
  turn_sequence: string[];
  expected_segment_time_s: number;
}

export interface FirmwarePlanExport {
  route_table: RouteRow[];
  policy_rules: Array<{ guard: string; action: string }>;
  fsm_states: Array<"IDLE" | "NAVIGATE" | "ALIGN_PICK" | "ALIGN_DROP" | "DECIDE" | "ERROR_RECOVERY" | "RETURN_HOME">;
  notes: string[];
}
