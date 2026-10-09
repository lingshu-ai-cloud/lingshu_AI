export interface WeeklyCustomerSendRecovery {
 channel:'whatsapp';id:string;tenantId:string;programId:string;packageId:string;packageVersion:number;
 runId:string;taskId:string;batchId:string;itemId:string;customerId:string;
 ownerUserId:string;createdBy:string;deadlineAt:string;reason:string;
 batchVersion:number;batchContentHash:string;itemContentHash:string;claimTokenHash:string;memberId:string;recipientMasked:string;recipientHash:string;sourceRef:{type:'weekly_customer_followup_batch';id:string;version:number};
 resolvedProof?:{taskId:string;runId:string;receiptIds:string[];evidenceHash:string;verifiedAt:string};status:'awaiting_receipt'|'resolved';version:number;createdAt:string;resolvedAt:string|null;
}

export interface WeeklyCustomerSendRecoverySource {channel:'whatsapp';runId:string;taskId:string;batchId:string;itemId:string;customerId:string;memberId:string;recipientMasked:string;status:string;claimTokenHash:string;batchVersion:number;reason:string;canCreate:boolean}
