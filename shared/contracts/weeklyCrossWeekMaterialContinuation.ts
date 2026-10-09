import type {VersionedSocialRef} from './socialProgram.js';
export interface CrossWeekMaterialSource {packageId:string;packageVersion:number;consumerTaskId:string;requestId:string;expectedSourceInputHash:string}
export interface ConfirmCrossWeekMaterialContinuation {source:CrossWeekMaterialSource;targetConsumerTaskId:string;requirementId:string;verificationDueAt:string;reason:string}
export interface CrossWeekMaterialContinuation {
 continuationId:string;ref:VersionedSocialRef;version:1;tenantId:string;programId:string;
 source:CrossWeekMaterialSource;sourceTaskInputHash:string;target:{packageId:string;packageVersion:number;consumerTaskId:string;publicationTaskId:string;requirementId:string;requirement:string;inputHash:string;verificationDueAt:string};
 originalUploadDueAt:string;originalOwnerUserId:string;confirmedBy:string;confirmedAt:string;reason:string;recordHash:string;
}
export interface CrossWeekMaterialContinuationView {item:CrossWeekMaterialContinuation;attachment:'attached'|'pending';materialStatus:'pending_verification'|'ready'|'cancelled';consumerVerification:CrossWeekMaterialConsumerVerification|null;sourceTaskStatus:string;countsAsNewMotherContent:false;startsProduction:false}
export interface CrossWeekMaterialContinuationCandidate {
 source:CrossWeekMaterialSource;sourceTaskStatus:string;originalOwnerUserId:string;originalUploadDueAt:string;sourceMaterialStatus:string;
 targetConsumerTaskId:string;targetPublicationTaskId:string;requirementId:string;requirement:string;latestVerificationAt:string|null;
 gap:string|null;
}
export interface CrossWeekMaterialContinuationCandidates {scope:{tenantId:string;programId:string;packageId:string;packageVersion:number};items:CrossWeekMaterialContinuationCandidate[];gaps:string[]}

/** Identity of an actual embedded submission review, not a fabricated standalone datastore row. */
export interface CrossWeekMaterialConsumerVerification {verificationId:string;requestId:string;submissionVersion:number;consumerTaskId:string;completedAt:string;reviewedBy:string;decision:'accepted';consumerDecision:{taskId:string;accepted:true;factCheck:string;rightsCheck:string;visualCheck:string};materialRefs:Array<{recordId:string;sha256:string;type:'image'|'video';byteSize:number}>;recordHash:string}
