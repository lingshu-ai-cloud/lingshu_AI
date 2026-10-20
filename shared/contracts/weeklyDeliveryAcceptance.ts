import type {VersionedSocialRef,WeeklyExecutionTaskStatus} from './socialProgram.js';

export const WEEKLY_DELIVERY_ACCEPTANCE_SCHEMA='weekly-delivery-acceptance.v1' as const;
export type WeeklyDeliveryAcceptanceScope={tenantId:string;programId:string;packageId:string;packageVersion:number};
export type WeeklyDeliveryAcceptanceBlocker={code:string;publicationTaskId:string|null;message:string};
export type WeeklyDeliveryAcceptanceItem={
 publicationTaskId:string;cardId:string;deliveryStatus:string;contentTaskId:string|null;runId:string|null;
 artifactRefs:VersionedSocialRef[];
 quality:{taskId:string|null;status:WeeklyExecutionTaskStatus|null;evidenceRefs:VersionedSocialRef[]};
 userApproval:{taskId:string|null;status:WeeklyExecutionTaskStatus|null;approvalRef:VersionedSocialRef|null;artifactRef:VersionedSocialRef|null};
 publication:{taskId:string|null;status:WeeklyExecutionTaskStatus|null;receiptRefs:VersionedSocialRef[]};
 actualCost:{status:'known'|'unknown';totalCny:number|null;evidenceRefs:string[]};
};
export type WeeklyDeliveryAcceptancePreview=WeeklyDeliveryAcceptanceScope&{
 schemaVersion:typeof WEEKLY_DELIVERY_ACCEPTANCE_SCHEMA;evidenceHash:string;ready:boolean;
 items:WeeklyDeliveryAcceptanceItem[];blockers:WeeklyDeliveryAcceptanceBlocker[];
 totalActualCost:{status:'known'|'unknown';totalCny:number|null;evidenceRefs:string[]};
 authorizesPublishing:false;
};
export type WeeklyDeliveryAcceptanceReceipt=WeeklyDeliveryAcceptancePreview&{
 receiptId:string;receiptVersion:number;acceptedBy:string;acceptedAt:string;recordHash:string;
};
