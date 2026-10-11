export const labels: Readonly<Record<string, string>>;
export const roles: Readonly<Record<string, string>>;
export function day(value: string): string;
export function time(value: string): string;
export function week(now?: number, offset?: number): {start: string; end: string; days: Array<{date: string; label: string; number: number}>};
export function sortUrgency<T extends {id: string; priority?: string; dueAt?: string; createdAt?: string}>(items: T[], now?: number): T[];
export function scheduleNextAction(post: {status?: string}): string;
export function timestamp(value: string): string;
export interface ScheduleAssignment {
  role?: string; taskId?: string; runId?: string; title?: string; status?: string; stage?: string;
  plannedAt?: string; dueAt?: string; observedAt?: string; blockedReason?: string; nextAction?: string;
  waitMessage?: string; ownerName?: string; agentLabel?: string; matterId?: string; lastEvent?: {summary?: string};
}
export interface ScheduleAssignmentView extends ScheduleAssignment {
  id: string; title: string; statusLabel: string; stageLabel: string; timeLabel: string; dueLabel: string;
  observedLabel: string; blockedLabel: string; nextLabel: string; ownerLabel: string; lastEventLabel: string; needsIntervention: boolean;
}
export function buildAgentSchedule(schedule?: {availability?: string; items?: ScheduleAssignment[]}, agents?: Array<{role: string; label?: string}>): Array<{role: string; label: string; unavailable?: boolean; items: ScheduleAssignmentView[]}>;
