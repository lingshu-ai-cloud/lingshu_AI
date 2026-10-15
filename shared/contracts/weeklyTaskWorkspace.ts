import type { VersionedSocialRef, WeeklyExecutionTask, WeeklyProductionStepKind } from './socialProgram.js';

export const WEEKLY_TASK_WORKSPACE_SCHEMA_VERSION = 'weekly-task-workspace.v1' as const;

export type WeeklyTaskWorkspaceKind = 'planning'|'inspiration'|'materials'|'content'|'publishing'|'customer'|'review'|'template';
export type WeeklyTaskWorkspacePhase = 'waiting_upstream'|'ready'|'running'|'waiting_human'|'blocked'|'completed'|'cancelled';

export type WeeklyTaskWorkspace = {
  schemaVersion: typeof WEEKLY_TASK_WORKSPACE_SCHEMA_VERSION;
  workspaceId: string;
  tenantId: string;
  programId: string;
  packageId: string;
  packageVersion: number;
  executionTaskId: string;
  taskIdempotencyKey: string;
  stepKind: WeeklyProductionStepKind;
  kind: WeeklyTaskWorkspaceKind;
  phase: WeeklyTaskWorkspacePhase;
  title: string;
  responsibleActor: WeeklyExecutionTask['schedule']['responsibleActor'];
  taskStatus: WeeklyExecutionTask['status'];
  scheduledStartAt: string|null;
  scheduledFinishAt: string|null;
  upstreamTaskIds: string[];
  blockingCodes: string[];
  resultRefs: VersionedSocialRef[];
  contentTaskId: string|null;
  runId: string|null;
  accountId: string|null;
  publicationTaskId: string|null;
  createdAt: string;
  updatedAt: string;
};
