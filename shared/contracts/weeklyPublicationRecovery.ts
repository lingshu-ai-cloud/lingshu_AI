export interface WeeklyPublicationRecoveryScope{tenantId:string;programId:string;packageId:string;packageVersion:number}
export interface WeeklyPublicationRecovery {
 id:string;version:number;status:'awaiting_receipt'|'resume_requested';tenantId:string;programId:string;packageId:string;packageVersion:number;
 taskId:string;publicationTaskId:string;motherContentId:string;adaptationOfPublicationTaskId:string|null;referenceSource:string|null;
 assignmentId:string;assignmentHash:string;publicationInputHash:string;taskInputHash:string;publicationPackageId:string;publicationPackageHash:string;productionResultId:string;accountId:string;accountIdentityHash:string;platform:string;attemptId:string;attemptStartedAt:string;attemptProvider:string;providerReceiptId:string|null;
 ownerUserId:string;createdBy:string;deadlineAt:string;reason:string;createdAt:string;resumedAt:string|null;
 gap:string;overdue:boolean;originalTaskStatus:string;
 completionProof?:{actualFinishedAt:string;taskId:string;attemptId:string;platformPostId:string;providerReceiptId:string;evidenceHash:string;verifiedAt:string};
}
export interface WeeklyPublicationRecoverySource{taskId:string;publicationTaskId:string;motherContentId:string;adaptationOfPublicationTaskId:string|null;accountId:string;platform:string;attemptId:string;attemptStatus:string;gap:string}
export interface WeeklyPublicationExecutionDetail extends WeeklyPublicationRecoveryScope {
 taskId:string;publicationTaskId:string;accountId:string;platform:string;
 assignmentId:string;assignmentHash:string;assignmentStatus:string;publicationPackageId:string;productionResultId:string;
 attemptId:string;attemptStatus:'in_flight'|'published'|'failed'|'unknown';attemptProvider:string;attemptStartedAt:string;
 providerReceiptId:string|null;platformPostId:string|null;platformUrl:string|null;resolvedAt:string|null;
 taskStatus:string;gap:string;canRecoverOriginalAttempt:boolean;
}
