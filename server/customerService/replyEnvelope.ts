import { customerReplyEnvelopeSchema, type CustomerReplyEnvelope } from '../../shared/contracts/customerReply.js';
import { buildCustomerServiceDecision } from './decision.js';
export function customerReplyEnvelope(value: Record<string, unknown>, requestId: string, factVersion: string|null): CustomerReplyEnvelope {
  const verification = value.verification && typeof value.verification === 'object' ? value.verification as {status:string;issues:string[]} : {status:'review_required',issues:['reply_verification_missing']};
  const degraded = value.generationSource==='degraded'||['safe_fallback','source_preserved'].includes(verification.status);
  const handoff = value.handoffRequired === true;
  const deterministic = ['deterministic','meaning_preserved','playbook'].includes(verification.status) || Boolean(value.decision);
  const draft = typeof value.draft === 'string' ? value.draft : '';
  return customerReplyEnvelopeSchema.parse({ ...value, schemaVersion:1, requestId, status:degraded?'degraded':handoff?'waiting_human':draft?'succeeded':'blocked',
    generationSource:degraded?'degraded':deterministic?'deterministic':'provider_generated',
    enterpriseFactVersion:typeof value.enterpriseFactVersion==='string'?value.enterpriseFactVersion:factVersion,
    draft, messages:Array.isArray(value.messages)?value.messages.map(String):draft?[draft]:[],
    translatedDraft:typeof value.translatedDraft==='string'?value.translatedDraft:'', translatedMessages:Array.isArray(value.translatedMessages)?value.translatedMessages.map(String):[],
    verification, code:degraded?'customer_reply_degraded':!draft&&!handoff?'customer_reply_empty':null,retryable:false,
    decision:value.decision??buildCustomerServiceDecision({execution:handoff?'human_required':'draft',safety:{verificationStatus:verification.status,issues:verification.issues}}),
  }) as CustomerReplyEnvelope;
}
