import {createHash} from 'node:crypto';
import {createWeeklyCandidateDynamicExactPaidRequests,type WeeklyCandidateDynamicExactPlan} from './weeklyCandidateExactPaidRequests.js';
import {inspectWeeklyExactSupplierEnvelopes} from './weeklyCandidateExactProviderEnvelope.js';

const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest=/^[a-f0-9]{64}$/;
const fail=(code:string):never=>{throw Error(`weekly_candidate_exact_conservative_${code}`);};

/** Must read platform-side audit originals, not the worker journal or a
 * caller-supplied summary. The audit records usage, not the actual bill. */
export interface WeeklyCandidateExactAuditReader {
 readOriginalAuditRequest:(input:{requestId:string;operationId:string;candidateId:string})=>Promise<{
  requestId:string;apiKeyId:string;model:string;status:number;
  usage:{prompt_tokens:number;completion_tokens:number;total_tokens:number};sourceEvidenceHash:string;
 }|null>;
}

/** A signed upper-bound budget occupation, never an actual-fee settlement.
 * Only response-recorded requests with an observed platform Request ID can be
 * matched to independent audit usage. Unknown POST outcomes remain blocked. */
export async function readWeeklyCandidateExactConservativeSettlement(input:{root:string;authorizationId:string;authorizationHash:string;
 plan:WeeklyCandidateDynamicExactPlan;auditApiKeyId:string;assertCurrent:()=>Promise<void>;reader?:WeeklyCandidateExactAuditReader}){
 if(!input.reader)return null;
 await input.assertCurrent();
 const journal=createWeeklyCandidateDynamicExactPaidRequests({root:input.root,authorizationHash:input.authorizationHash,plan:input.plan,assertCurrent:input.assertCurrent});
 const recorded=await journal.readRecordedChildren();
 if(!recorded.entries.length||recorded.entries.some(e=>e.state!=='response_recorded'||!e.response?.responseId||!e.response.providerRequestId))return null;
 const requestIds=recorded.entries.map(e=>e.response!.providerRequestId!);
 if(new Set(requestIds).size!==requestIds.length)return fail('duplicate_audit_request');
 const auditHashes:string[]=[];
 for(const entry of recorded.entries){
  const local=entry.response!,requestId=local.providerRequestId!;
  const audit=await input.reader.readOriginalAuditRequest({requestId,operationId:input.plan.operationId,candidateId:input.plan.candidateId});
  if(!audit)return null;
  const localUsage=local.usage as Partial<typeof audit.usage>|null;
  if(!digest.test(audit.sourceEvidenceHash)||audit.requestId!==requestId||audit.apiKeyId!==input.auditApiKeyId||
   audit.model!==input.plan.model||audit.status!==200||!localUsage||
   audit.usage?.prompt_tokens!==localUsage.prompt_tokens||audit.usage?.completion_tokens!==localUsage.completion_tokens||
   audit.usage?.total_tokens!==localUsage.total_tokens)fail('audit_original_changed');
  auditHashes.push(audit.sourceEvidenceHash);
 }
 const envelope=inspectWeeklyExactSupplierEnvelopes({operationId:input.plan.operationId,candidateId:input.plan.candidateId,mediaSha256:input.plan.mediaSha256,
  endpoint:input.plan.endpoint,credentialSha256:input.plan.credentialSha256,model:input.plan.model,maximumTotalCny:input.plan.maximumTotalCny,
  requests:recorded.entries.map(e=>({requestHash:e.requestHash,maximumInputTokens:e.maximumInputTokens,maximumOutputTokens:e.maximumOutputTokens})),
  responses:recorded.entries.map(e=>({requestHash:e.requestHash,response:e.response!}))});
 if(envelope.reservedUpperBoundCny>input.plan.maximumTotalCny+1e-9)return fail('authorized_ceiling_exceeded');
 return {status:'completed' as const,settlementBasis:'conservative_upper_bound' as const,operationId:input.plan.operationId,
  authorizationHash:input.authorizationHash,mediaSha256:input.plan.mediaSha256,providerRequestHash:envelope.requestSetHash,
  providerReceiptRef:`qwen-audit-upper-bound:${input.plan.operationId}:${sha(auditHashes)}`,
  ledgerOutcomeHash:sha({basis:'conservative_upper_bound',journal:recorded.ledgerHash,auditHashes,requestIds,
   reservedUpperBoundCny:envelope.reservedUpperBoundCny}),authorizationId:input.authorizationId,
  requestCount:envelope.requestCount,recordedUpperBoundCny:envelope.reservedUpperBoundCny};
}
