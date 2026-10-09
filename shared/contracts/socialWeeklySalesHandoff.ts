export type WeeklySalesStatus = 'awaiting_claim' | 'in_progress' | 'awaiting_feedback' | 'handled' | 'needs_information';
export interface WeeklySalesHandoff {
  id: string; tenantId: string; programId: string; packageId: string; packageVersion: number;
  channel?: 'whatsapp'|'messenger'|'instagram'; runId: string; memberId: string; customerId: string; sourceInteractionId: string;
  sourceKind: 'new_inquiry' | 'existing_customer' | 'existing_contact'; sourceEvidence: Record<string, unknown>;
  ownerUserId: string; createdBy: string; claimDueAt: string; feedbackDueAt: string;
  approvedBatchId: string; approvedBatchVersion: number; approvedContentHash: string;
  status: WeeklySalesStatus; version: number; claimedAt: string | null;
  feedback: { result: string; evidenceInteractionIds: string[]; nextStep: string; nextDueAt: string; recordedAt: string } | null;
}
export function weeklySalesOverdue(item: WeeklySalesHandoff, now: number): 'claim' | 'feedback' | 'information' | null {
  if (item.status === 'awaiting_claim' && Date.parse(item.claimDueAt) < now) return 'claim';
  if (['in_progress', 'awaiting_feedback'].includes(item.status) && Date.parse(item.feedbackDueAt) < now) return 'feedback';
  if(item.status==='needs_information'&&item.feedback&&Date.parse(item.feedback.nextDueAt)<now)return 'information';
  return null;
}

export interface WeeklySalesSource { channel?:'whatsapp'|'messenger'|'instagram'; runId:string; memberId:string; customerId:string; customerName:string; sourceInteractionId:string; body:string; timestamp:number; sourceKind:'new_inquiry'|'existing_customer'|'existing_contact'; }
