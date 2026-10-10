export interface WeeklyNativeSendRecoveryScope {tenantId:string;programId:string;packageId:string;packageVersion:number}
export interface WeeklyNativeSendRecovery {
 id:string;version:number;status:'awaiting_receipt'|'resolved';channel:'messenger'|'instagram';
 tenantId:string;programId:string;packageId:string;packageVersion:number;runId:string;taskId:string;batchId:string;batchVersion:number;batchHash:string;itemId:string;itemHash:string;memberId:string;customerId:string;
 requestId:string;originalActorUserId:string;weeklyAuthorityHash:string;intentHash:string;bodyHash:string;recipientHash:string;recipientMasked:string;accountId:string;accountAuthorityHash:string;selectionHash:string;
 ownerUserId:string;createdBy:string;deadlineAt:string;reason:string;createdAt:string;resolvedAt:string|null;
 gap:string;overdue:boolean;
 resolvedProof?:{taskId:string;runId:string;requestId:string;providerMessageId:string;evidenceHash:string;verifiedAt:string};
}
export interface WeeklyNativeSendRecoverySource {channel:'messenger'|'instagram';runId:string;taskId:string;batchId:string;itemId:string;customerId:string;requestId:string;recipientMasked:string;status:'sending'|'unknown'|'accepted';gap:string;canCreate:boolean}
