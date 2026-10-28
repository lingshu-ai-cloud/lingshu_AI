import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSocialContentTaskBudgetAuthority,type SocialPaidOperationIntent,type SocialVerifiedAccountTariff} from '../lib/socialContentTaskBudgetAuthority.js';
import {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import {createQwenMaaSPublishedTariffReader,createSocialContentLocalPublishedTariffReader} from '../lib/socialContentPublishedTariffs.js';
import type {MaterialAnalysisPaidCall} from '../digitalEmployees/materialAnalysisPaidOperation.js';
import {submitMaterialAnalysisPaidRequest} from '../digitalEmployees/materialAnalysisPaidOperation.js';
import {getQwenProviderBinding} from '../agents/qwen.js';
import {qwenVisionInputLimit} from '../lib/qwenVisionInputLimit.js';
import {productionBillingAccountRef} from './socialContentProductionBudgetRoutes.js';
import {createSocialContentPaidRuntimePorts} from './socialContentPaidRuntimePorts.js';
import {resolveSocialContentCostLineage} from './socialContentCostLineage.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {carryForwardWeeklyCandidateExactProductionCost} from '../runtime/weeklyCandidateExactProductionEscrowPorts.js';
import {requireSocialTask} from './socialContentRecords.js';
import {socialJson,socialObject} from './socialContentValidation.js';
import type {Starter198Repository} from './repository.js';
import {socialRequestHash} from './socialContentValidation.js';
import {assertVoiceDrivenFilmDuration,VOICE_DRIVEN_FILM_MAXIMUM_CNY} from '../../shared/contracts/productionBudgetPolicy.js';

/** An early analysis operation shares the film ledger. It does not invent the
 * still-unknown downstream production route or authorize another film budget. */
export async function prepareMissingLabelBudget(input:{repository:Starter198Repository;tenantId:string;taskId:string;runId:string;
 planHash:string;durationSeconds:number;request:Record<string,unknown>;assertCurrent:()=>Promise<void>;
 ports?:{ledgerRoot?:string;readBinding?:typeof getQwenProviderBinding;
 readTariff?:(intent:SocialPaidOperationIntent)=>Promise<SocialVerifiedAccountTariff|null>;
 persistProviderReceipt?:MaterialAnalysisPaidCall['persistProviderReceipt'];readProviderReceipt?:(ref:string)=>Promise<unknown>;assertNewSubmit?:()=>Promise<void>;
 carryForwardWeeklyExactCost?:typeof carryForwardWeeklyCandidateExactProductionCost}}){
 if(!/^[a-f0-9]{64}$/.test(input.planHash))throw Error('benchmark_label_budget_scope_invalid');
 assertVoiceDrivenFilmDuration(input.durationSeconds);
 const readBinding=()=>{try{return(input.ports?.readBinding??getQwenProviderBinding)();}catch{throw Error('user_input_required:benchmark_label_provider_unavailable');}};
 const binding=readBinding(),model=binding.materialModel;
 const request=structuredClone(input.request),ceiling=qwenVisionInputLimit(model);
 // Text-only repair uses the model's accepted-context bound, not a guessed
 // tokenizer formula. Keep the actual request smaller than that hard ceiling.
 if(request.model!==model||!Array.isArray(request.messages)||!request.messages.length
   ||request.messages.some((row:any)=>row?.role!=='user'||typeof row.content!=='string')
   ||!Number.isSafeInteger(request.max_tokens)||Number(request.max_tokens)<=0||Number(request.max_tokens)>32768
   ||Buffer.byteLength(JSON.stringify(request),'utf8')>ceiling)throw Error('benchmark_label_budget_request_invalid');
 const lineage=await resolveSocialContentCostLineage(input);
 const scope={tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,planHash:input.planHash,
   ...(lineage.budgetTaskId!==input.taskId?{budgetTaskId:lineage.budgetTaskId}:{})};
 const requestHash=socialRequestHash(request);
 const requestSha256=createHash('sha256').update(JSON.stringify(request)).digest('hex');
 const intent:SocialPaidOperationIntent={operationId:`benchmark-label:${socialRequestHash({scope,requestHash})}`,
  provider:'qwen',model,accountRef:productionBillingAccountRef('qwen',binding.baseUrl,binding.credentialSha256),
  stage:'benchmark_material_label',shotId:null,inputContractHash:requestHash,
  maximumUnits:{inputTokens:ceiling,outputTokens:Number(request.max_tokens)}};
 const assertCurrent=async()=>{
  await input.assertCurrent();
  if(socialRequestHash(readBinding())!==socialRequestHash(binding)
    ||(await resolveSocialContentCostLineage(input)).lineageHash!==lineage.lineageHash)
    throw Error('benchmark_label_budget_authority_changed');
 };
 const readProviderBinding=async()=>({provider:'qwen',model,baseUrl:binding.baseUrl,credentialSha256:binding.credentialSha256});
 const maas=createQwenMaaSPublishedTariffReader({readProviderBinding});
 const published=createSocialContentLocalPublishedTariffReader({readProviderBinding});
 const plan={scope,authorizationRef:`voice-driven-film:${lineage.lineageHash}`,maximumCny:VOICE_DRIVEN_FILM_MAXIMUM_CNY,
  productionDurationSeconds:input.durationSeconds,maximumExecutionCny:lineage.maximumAdditionalCostCny??undefined,paidOperations:[intent]};
 // Adopt the same verified pre-production receipt before the early operation,
 // rather than waiting for a downstream stage that unresolved labels cannot reach.
 if(lineage.kind==='original'&&input.repository.dataStore){
  const row=await requireSocialTask(input),brief=socialObject(socialJson(row.brief));
  if(socialObject(brief?._weeklyAuthority)){
   const carryBudget=new SocialContentTaskBudget(input.ports?.ledgerRoot,{assertCurrent,
    authorization:async()=>({maximumCny:plan.maximumCny,productionDurationSeconds:plan.productionDurationSeconds,authorizationRef:plan.authorizationRef}),
    quote:async()=>{throw Error('benchmark_label_carry_never_quotes');},verifyRejection:async()=>false});
   await(input.ports?.carryForwardWeeklyExactCost??carryForwardWeeklyCandidateExactProductionCost)({store:input.repository.dataStore,
    escrowRoot:process.env.WEEKLY_CANDIDATE_EXACT_LEDGER_ROOT?.trim()||process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR?.trim()||'',
    scope,taskRow:row,budget:carryBudget,mode:'carry'});
  }
 }
 const authority=createSocialContentTaskBudgetAuthority({ledgerRoot:input.ports?.ledgerRoot,ports:{assertCurrent,
  readApprovedPlan:async()=>plan,readVerifiedTariff:input.ports?.readTariff??(async row=>await maas.read(row)||await published.read(row)),
  verifyRejection:async()=>false}});
 const reserved=await authority.prepareAndReserve(scope).catch((error:unknown)=>{
  const reason=error instanceof Error?error.message:String(error);
  if(/^social_task_budget_/.test(reason))throw Error(`user_input_required:production_budget_decision_required:benchmark_label:${reason}`);
  throw error;
 });
 const permit=createSocialContentPaidOperationPermit({...reserved,
  root:path.join(input.ports?.ledgerRoot||process.env.SOCIAL_CONTENT_TASK_BUDGET_DIR||'data/social-content-task-budget','.permits'),
  assertCurrent,assertNewSubmit:input.ports?.assertNewSubmit});
 const runtime=createSocialContentPaidRuntimePorts({scope,assertCurrent});
 const paidCall:MaterialAnalysisPaidCall={requirementKey:intent.operationId,intent,permit,
  measureInputTokens:async actual=>{if(socialRequestHash(actual)!==requestHash)throw Error('benchmark_label_paid_request_changed');return ceiling;},
  persistProviderReceipt:input.ports?.persistProviderReceipt??runtime.material.persistProviderReceipt};
 return {scope,intent,reserved,permit,
  async recoverResponse():Promise<unknown>{
   const prior=await permit.assertRecovery(intent.operationId);
   if(prior.status!=='completed'||!prior.receiptRef)throw Error('user_input_required:benchmark_label_paid_result_unknown');
   if(input.ports?.readProviderReceipt)return input.ports.readProviderReceipt(prior.receiptRef);
   const hash=prior.receiptRef.match(/^production-provider-receipt:([a-f0-9]{64})$/)?.[1];
   if(!hash)throw Error('benchmark_label_provider_receipt_invalid');
   const bytes=await fs.readFile(path.join(process.env.SOCIAL_CONTENT_PROVIDER_RECEIPT_DIR||'data/social-content-provider-receipts',hash+'.json'),'utf8');
   const row=JSON.parse(bytes);
   if(createHash('sha256').update(bytes).digest('hex')!==hash||socialRequestHash(row.scope)!==socialRequestHash(scope)
    ||row.requestSha256!==requestSha256)throw Error('benchmark_label_provider_receipt_changed');
   return row.response;
  },
  async submit<T>(send:(request:Record<string,unknown>)=>Promise<T>):Promise<T>{
   if(!await permit.isProvenUnsubmitted?.(intent.operationId))throw Error('user_input_required:benchmark_label_paid_result_unknown');
   await assertCurrent();
   return submitMaterialAnalysisPaidRequest(request,paidCall,send);
  }};
}
