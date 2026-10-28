import type { VersionedSocialRef, WeeklyExecutionTask, WeeklyProductionStepKind } from './socialProgram.js';

export const WEEKLY_TASK_WORKSPACE_SCHEMA_VERSION = 'weekly-task-workspace.v1' as const;

export type WeeklyTaskWorkspaceKind = 'planning'|'inspiration'|'materials'|'content'|'publishing'|'customer'|'review'|'template';
export type WeeklyTaskWorkspacePhase = 'waiting_upstream'|'ready'|'running'|'waiting_human'|'blocked'|'completed'|'cancelled';
export type WeeklyTaskWorkspaceNextActionCode = 'wait_upstream'|'wait_automatic_retry'|'resolve_task_blocker'|'review_output'|'none';

export type WeeklyTaskWorkspaceRuntime = {
  pauseReasons: Array<{code:string;message:string;retryable:boolean|null;occurredAt:string|null}>;
  completedWork: Array<{executionTaskId:string;stepKind:WeeklyProductionStepKind;finishedAt:string|null;resultRefs:VersionedSocialRef[]}>;
  actualCost: {status:'none'|'known'|'unknown';totalCny:number|null;evidenceRefs:string[]};
  recovery: {
    taskAttempt:number;
    taskMaximumAttempts:number;
    recoveredFromDeadLetterAt:string|null;
    jobId:string|null;
    jobStatus:string|null;
    jobAttempt:number|null;
    reconciliationAttempt:number|null;
    retryClass:string|null;
    nextAttemptAt:string|null;
    providerReceipts:Array<{provider:string;requestId:string;state:string;providerTaskId:string|null;updatedAt:string}>;
  };
  checkpoints:Array<{key:string;version:string;inputHash:string;updatedAt:string}>;
  /** Read-only, scoped summary of blocked measured-material slots. */
  pendingMaterials:Array<{shotId:string;theme:'factory'|'product'|'consumer_demo'|'general';requiredSeconds:number;reason:'awaiting_theme_material'}>;
  /** Initial planning blockers; durations are reference estimates, not voice measurements. */
  initialMaterialBlocks:Array<{shotId:string;materialType:'talking_head'|'factory'|'product'|'consumer_demo'|'general';reason:'awaiting_shoot'|'awaiting_theme_material';referenceDurationSeconds:number|null;shootingTaskId:string|null}>;
  /** Existing frozen request status before a content run exists; not material verification. */
  preRunMaterialRequests:Array<{requestId:string;requirement:string;status:'missing'|'pending_verification'|'accepted'|'rejected'|'cancelled'}>;
  /** Hash-verified evidence for the currently blocked render, never an acceptance. */
  videoQuality: {mediaSha256:string;qualityInputHash?:string;subtitleStatus:'passed'|'blocked'|'unknown';timelineStatus:'passed'|'blocked'|'unknown';samples:Array<{frameSha256?:string;atSeconds:number;subtitlePresent:boolean|null;font:boolean|null;fontSize:boolean|null;color:boolean|null}>}|null;
  nextActions:Array<{code:WeeklyTaskWorkspaceNextActionCode;label:string;userRequired:boolean}>;
  mayChargeAgain:{status:'possible'|'not_expected'|'unknown';reason:string};
};

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
  /** Live, read-only projection. It is rebuilt from authoritative execution,
   * queue, checkpoint and settled-ledger records and is never a new workflow. */
  runtime: WeeklyTaskWorkspaceRuntime;
  createdAt: string;
  updatedAt: string;
};
