import {socialPaidIntentOperation} from '../lib/socialContentTaskBudgetAuthority.js';
import {SocialContentTaskBudget,type SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import {resolveSocialContentCostLineage} from './socialContentCostLineage.js';
import {socialRequestHash} from './socialContentValidation.js';
import type {Starter198Repository} from './repository.js';
import type {SceneReworkCostPolicy} from './socialContentSceneReworkCostPolicy.js';
import {assertVoiceDrivenFilmDuration,VOICE_DRIVEN_FILM_MAXIMUM_CNY} from '../../shared/contracts/productionBudgetPolicy.js';

/** A confirmed repair quote is an incremental permission, never a fresh film
 * budget. Retain its full envelope in the root ledger before adapter execution. */
export async function reserveSceneReworkFilmBudget(input:{repository:Starter198Repository;
  policy:SceneReworkCostPolicy;assertCurrent:()=>Promise<void>;ledgerRoot?:string;voiceDriven?:boolean;
}){
  const {scope:repair,quote}=input.policy;
  const lineage=await resolveSocialContentCostLineage({repository:input.repository,tenantId:repair.tenantId,taskId:repair.taskId});
  const scope:SocialTaskBudgetScope={tenantId:repair.tenantId,taskId:repair.taskId,
    ...(lineage.budgetTaskId!==repair.taskId?{budgetTaskId:lineage.budgetTaskId}:{}),runId:repair.runId,planHash:quote.planHash};
  const operation=quote.provider==='heygen'?socialPaidIntentOperation(scope,quote.presenterPlan.operations[0]!.intent):{operationId:`scene-rework:${repair.operationId}`,fingerprint:input.voiceDriven?quote.recordHash:socialRequestHash(input.policy),
    provider:quote.provider,model:quote.model,accountRef:quote.tariffSourceRef,stage:'scene_rework',shotId:null};
  const operations=quote.provider==='heygen'?quote.presenterPlan.operations.map(row=>socialPaidIntentOperation(scope,row.intent)):[operation];
  const ledger:SocialContentTaskBudget=new SocialContentTaskBudget(input.ledgerRoot,{
    assertCurrent:input.assertCurrent,
    authorization:async()=>{
      const existing=ledger.status(scope);
      if(!existing)throw Error('user_input_required:production_budget_decision_required:original_film_ledger_missing');
      if(input.voiceDriven){
        // Other operations retain their full reserved bounds, including unknown
        // outcomes. They do not consume a second approval when the cumulative
        // film remains in budget; each original permit still forbids resubmit.
        if(existing.limitCny!==VOICE_DRIVEN_FILM_MAXIMUM_CNY||existing.authorizedLimitCny!==VOICE_DRIVEN_FILM_MAXIMUM_CNY
          ||existing.hasCorrectionAuthorization||existing.productionDurationSeconds===undefined)
          throw Error('scene_rework_original_film_policy_invalid');
        assertVoiceDrivenFilmDuration(existing.productionDurationSeconds);
      }
      return {maximumCny:existing.limitCny,productionDurationSeconds:existing.productionDurationSeconds,
        maximumExecutionCny:lineage.maximumAdditionalCostCny??undefined,authorizationRef:`scene-rework-confirmed:${input.voiceDriven?quote.recordHash:input.policy.recordHash}`};
    },
    quote:async(_scope,operation)=>quote.provider==='heygen'?quote.presenterPlan.operations.find(row=>row.intent.operationId===operation.operationId)!.quote:({upperBoundCny:quote.totalUpperBoundCny,quoteRef:quote.recordHash,validUntil:quote.validUntil}),
    verifyRejection:async()=>false,
  });
  await ledger.reserveBatch(scope,operations);
  return {ledger,scope,operation,operations,async beforeExecute(){
    await input.assertCurrent();
    // Recheck cumulative occupancy under the same lock before every adapter.
    await ledger.reserveBatch(scope,operations);
    if(quote.provider!=='heygen')await ledger.markOutcome(scope,operation.operationId,'unknown',`scene-rework:${repair.operationId}`);
  }};
}

/** Preview and reserve only the exact server-priced repair against the original
 * film ledger. The authenticated actor and durable admission lease are supplied
 * by the admission service; no price or original authority comes from a client. */
export async function sceneReworkOverageDecision(input:{repository:Starter198Repository;policy:SceneReworkCostPolicy;
  sourceRunId:string;actorUserId:string;assertCurrent:()=>Promise<void>;ledgerRoot?:string;previewHash?:string}) {
  const {scope:repair,quote}=input.policy;
  if(repair.actorUserId!==input.actorUserId)throw Error('scene_rework_overage_actor_conflict');
  const lineage=await resolveSocialContentCostLineage({repository:input.repository,tenantId:repair.tenantId,taskId:repair.taskId});
  if(lineage.budgetTaskId!==repair.taskId || lineage.maximumAdditionalCostCny!==null)
    throw Error('scene_rework_overage_original_film_required');
  const scope:SocialTaskBudgetScope={tenantId:repair.tenantId,taskId:repair.taskId,runId:repair.runId,planHash:quote.planHash};
  const operation=quote.provider==='heygen'?socialPaidIntentOperation(scope,quote.presenterPlan.operations[0]!.intent):{operationId:`scene-rework:${repair.operationId}`,fingerprint:quote.recordHash,
    provider:quote.provider,model:quote.model,accountRef:quote.tariffSourceRef,stage:'scene_rework',shotId:null};
  const operations=quote.provider==='heygen'?quote.presenterPlan.operations.map(row=>socialPaidIntentOperation(scope,row.intent)):[operation];
  let ledger:SocialContentTaskBudget;
  ledger=new SocialContentTaskBudget(input.ledgerRoot,{
    assertCurrent:input.assertCurrent,
    authorization:async()=>{
      const current=ledger.status(scope);
      const original=current?.entries.filter(e=>(e.executionTaskId??repair.taskId)===repair.taskId
        && e.stage!=='scene_rework' && e.status!=='rejected' && e.authorizationRef).sort((a,b)=>a.operationId.localeCompare(b.operationId))[0];
      if(!current || !original || current.limitCny!==VOICE_DRIVEN_FILM_MAXIMUM_CNY
        ||current.authorizedLimitCny!==VOICE_DRIVEN_FILM_MAXIMUM_CNY||current.hasCorrectionAuthorization
        ||current.productionDurationSeconds===undefined||!original.authorizationRef)throw Error('scene_rework_overage_original_film_required');
      assertVoiceDrivenFilmDuration(current.productionDurationSeconds);
      return {maximumCny:VOICE_DRIVEN_FILM_MAXIMUM_CNY,productionDurationSeconds:current.productionDurationSeconds,
        authorizationRef:original.authorizationRef};
    },
    quote:async(_scope,operation)=>quote.provider==='heygen'?quote.presenterPlan.operations.find(row=>row.intent.operationId===operation.operationId)!.quote:({upperBoundCny:quote.totalUpperBoundCny,quoteRef:quote.recordHash,validUntil:quote.validUntil}),
    verifyRejection:async()=>false,
  });
  if(input.previewHash){
    await ledger.reserveUserApprovedOverageBatch(scope,operations,{previewHash:input.previewHash,actorUserId:input.actorUserId,
      authorizationRef:`scene-rework-user-choice:${socialRequestHash([repair.tenantId,repair.taskId,input.sourceRunId,repair.runId,repair.operationId,input.actorUserId,input.previewHash])}`});
    return null;
  }
  const preview=await ledger.previewOverageBatch(scope,operations);
  const plannedCny=preview.quotes.reduce((sum,quote)=>sum+Math.round(quote.upperBoundCny*1e6),0)/1e6;
  return {previewHash:preview.previewHash,retainedCny:preview.retainedMicros/1e6,
    plannedCny,totalCny:(preview.retainedMicros/1e6)+plannedCny,
    extraCny:preview.extraMicros/1e6};
}
