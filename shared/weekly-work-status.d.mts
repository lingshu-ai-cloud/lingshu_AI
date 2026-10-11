export type WeeklyWorkPhase = 'preparing' | 'queued' | 'running' | 'blocked' | 'paused' | 'finished' | 'unknown';
export type WeeklyWorkOutcome = 'succeeded' | 'failed' | 'cancelled' | null;

export type WeeklyWorkStatus = {
  phase: WeeklyWorkPhase;
  outcome: WeeklyWorkOutcome;
  runId: string;
  title: string;
  description: string;
  currentTaskId: string;
  currentTaskTitle: string;
  controller: string;
  completedTasks: number;
  totalTasks: number;
  startedAt: string;
  blocker: string;
};

export interface WorkStatusTask { id: string; run_id: string; status: string; sequence: number; title: string; blocked_reason?: string; agent_role?: string; }
export interface WorkStatusInput {
  goal: {id: string} | null;
  run: {id: string; goal_id: string; status: string; current_controller?: string; pause_reason?: string; started_at?: string} | null;
  plan?: {businessPackage?: {detailGeneration?: {status?: string; readyCount?: number; blockedCount?: number}}} | null;
  tasks: WorkStatusTask[];
}
export function weeklyWorkStatus(data: WorkStatusInput): WeeklyWorkStatus | null;
export function taskExecutionStatus(task?: {status?: string; blocked_reason?: string; next?: string}): {phase: WeeklyWorkPhase | 'waiting'; statusLabel: string; blocker: string; next: string; outcome: WeeklyWorkOutcome};
