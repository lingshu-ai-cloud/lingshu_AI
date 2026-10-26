import {PRODUCTION_BUDGET_POLICY,productionBudgetDuration,productionBudgetLimitCny,productionBudgetMaximumCny,productionBudgetExceeded} from '../../shared/contracts/productionBudgetPolicy.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {resolveSocialContentCostLineage} from './socialContentCostLineage.js';
import type {runSocialContentAutoProduction} from './socialContentProductionExecution.js';
import type {SocialContentTaskBrief} from '../../shared/contracts/socialContentWorkflow.js';

/** All retained production operations, including failed/unknown earlier runs
 * and child revisions. Selected media receipts alone omit TTS, QA and retries. */
export async function readSocialProductionBudgetEvidence(input:{
  execution:Parameters<typeof runSocialContentAutoProduction>[0];brief:SocialContentTaskBrief;
  scenes:NonNullable<Parameters<typeof productionBudgetDuration>[0]>['scenes'];
}){
  const {execution}=input;
  if(!execution.repository.dataStore)return null;
  const lineage=await resolveSocialContentCostLineage(execution);
  const ledger=new SocialContentTaskBudget(execution.runtime?.productionBudgetReadPorts?.ledgerRoot,{
    authorization:async()=>{throw Error('budget_evidence_read_only');},
    quote:async()=>{throw Error('budget_evidence_read_only');},assertCurrent:async()=>{},verifyRejection:async()=>false,
  });
  const status=ledger.status({tenantId:execution.tenantId,taskId:execution.taskId,
    ...(lineage.budgetTaskId!==execution.taskId?{budgetTaskId:lineage.budgetTaskId}:{}),runId:execution.runId,planHash:'0'.repeat(64)});
  if(!status)return null;
  const durationSeconds=productionBudgetDuration({...input.brief,scenes:input.scenes});
  const maximumCny=Math.min(productionBudgetMaximumCny(input.brief),status.limitCny);
  if(productionBudgetExceeded(status.retainedCny,maximumCny))
    throw Error(`user_input_required:production_budget_decision_required:retained=${status.retainedCny}:maximum=${maximumCny}`);
  return {policyVersion:PRODUCTION_BUDGET_POLICY,durationSeconds,maximumCny,
    retainedCny:status.retainedCny,acquisitionCny:status.acquisitionCny,budgetTaskId:lineage.budgetTaskId};
}
