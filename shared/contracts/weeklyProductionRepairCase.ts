import type {VersionedSocialRef} from './socialProgram.js';

export type WeeklyProductionRepairCaseState =
  | 'awaiting_capacity'
  | 'ready'
  | 'running'
  | 'awaiting_audit'
  | 'resolved'
  | 'cancelled';

export interface WeeklyProductionRepairCase {
  schemaVersion:'weekly-production-repair-case.v1';
  caseId:string;
  version:1;
  requestId:string;
  requestHash:string;
  tenantId:string;
  programId:string;
  packageId:string;
  packageVersion:number;
  publicationTaskId:string;
  accountId:string;
  qualityTaskId:string;
  approvalTaskId:string;
  kind:'technical_scene_repair';
  trigger:{
    type:'verified_quality_failure';
    blocker:'weekly_quality_audit_actual_repair_required';
    qualityContextHash:string;
    failedReceiptIds:string[];
  };
  parent:{
    taskId:string;
    runId:string;
    artifactRef:VersionedSocialRef;
    artifactHash:string;
    sceneCacheHash:string;
  };
  affectedSceneIds:string[];
  ownerUserId:string;
  reviewerUserId:string;
  deadlineAt:string;
  affectedPublishWindow:string;
  estimatedDurationMinutes:number;
  maximumCostCny:number;
  state:WeeklyProductionRepairCaseState;
  execution:{operationId:string;runId:string;jobId:string}|null;
  childArtifactRef:VersionedSocialRef|null;
  createdBy:string;
  createdAt:string;
  updatedAt:string;
  recordHash:string;
}
