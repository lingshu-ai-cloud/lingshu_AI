import {SocialContentTaskBudget,type SocialTaskBudgetScope} from '../lib/socialContentTaskBudget.js';
import {resolveSocialContentCostLineage} from './socialContentCostLineage.js';
import {socialRequestHash} from './socialContentValidation.js';
import type {Starter198Repository} from './repository.js';
import type {SceneReworkCostPolicy} from './socialContentSceneReworkCostPolicy.js';

/** A confirmed repair quote is an incremental permission, never a fresh film
 * budget. Retain its full envelope in the root ledger before adapter execution. */
export async function reserveSceneReworkFilmBudget(input:{repository:Starter198Repository;
  policy:SceneReworkCostPolicy;assertCurrent:()=>Promise<void>;ledgerRoot?:string;
}){
  const {scope:repair,quote}=input.policy;
  const lineage=await resolveSocialContentCostLineage({repository:input.repository,tenantId:repair.tenantId,taskId:repair.taskId});
  const scope:SocialTaskBudgetScope={tenantId:repair.tenantId,taskId:repair.taskId,
    ...(lineage.budgetTaskId!==repair.taskId?{budgetTaskId:lineage.budgetTaskId}:{}),runId:repair.runId,planHash:quote.planHash};
  const operation={operationId:`scene-rework:${repair.operationId}`,fingerprint:socialRequestHash(input.policy),
    provider:quote.provider,model:quote.model,accountRef:quote.tariffSourceRef,stage:'scene_rework',shotId:null};
  const ledger:SocialContentTaskBudget=new SocialContentTaskBudget(input.ledgerRoot,{
    assertCurrent:input.assertCurrent,
    authorization:async()=>{
      const existing=ledger.status(scope);
      if(!existing)throw Error('user_input_required:production_budget_decision_required:original_film_ledger_missing');
      return {maximumCny:existing.limitCny,productionDurationSeconds:existing.productionDurationSeconds,
        maximumExecutionCny:lineage.maximumAdditionalCostCny??undefined,authorizationRef:`scene-rework-confirmed:${input.policy.recordHash}`};
    },
    quote:async()=>({upperBoundCny:quote.totalUpperBoundCny,quoteRef:quote.recordHash,validUntil:quote.validUntil}),
    verifyRejection:async()=>false,
  });
  await ledger.reserveBatch(scope,[operation]);
  return {async beforeExecute(){
    await input.assertCurrent();
    // Recheck cumulative occupancy under the same lock before every adapter.
    await ledger.reserveBatch(scope,[operation]);
    await ledger.markOutcome(scope,operation.operationId,'unknown',`scene-rework:${repair.operationId}`);
  }};
}
