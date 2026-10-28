import type {ContentExecutionJob} from '../contentExecution/durableQueue.js';
import {assertCurrentContentExecutionActive,assertSocialContentOrderActive} from '../contentExecution/context.js';
import type {Starter198Repository} from './repository.js';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import type {SocialContentAutoProductionRuntime,SocialGraphApprovedContext} from './socialContentProductionExecution.js';
import {autoCompleteMissingBenchmarkLabels} from './socialContentMissingLabelCompletion.js';
import {readMissingLabelRuntimeOverlay} from './socialContentMissingLabelOverlay.js';
import {blockOnMissingBenchmarkLabels} from './socialContentMissingLabelBlock.js';
import {canQueueV3InputCompletion} from './socialContentMissingLabelQueueAdmission.js';

/** Repair labels before graph state admission, while retaining the original
 * frozen graph and the independently verified live business authority. */
export async function completeGraphBenchmarkLabels(input:{repository:Starter198Repository;job:ContentExecutionJob;
 detail:SocialContentTaskDetail;approvedContext:SocialGraphApprovedContext;planHash:string;runtime?:SocialContentAutoProductionRuntime}){
 const plan=input.detail.assetSupplyPlan,review=input.detail.agentWorkflow?.executionPlanReview;
 if(plan?.materialRoutingPolicyVersion!=='type-aware.v3'||!plan.shots.some(shot=>shot.materialRouting?.materialType==='unknown'
  ||shot.materialRouting?.pendingReason))return;
 if(!review?.approved&&!canQueueV3InputCompletion(input.detail))return;
 const scope={repository:input.repository,tenantId:input.job.tenantId,taskId:input.job.taskId,runId:input.job.runId};
 const graph=await import('./socialContentProductionGraph.js');
 const assertCurrent=async()=>{
  await assertCurrentContentExecutionActive();
  if(input.repository.dataStore)await assertSocialContentOrderActive(input.repository.dataStore,scope.tenantId,scope.taskId);
  const live=await graph.readSocialProductionGraphDetail(scope,input.approvedContext);
  if(!live||live.runId!==input.job.runId||graph.socialProductionGraphInput(live,input.approvedContext).inputHash!==input.planHash)
   throw Error('benchmark_label_graph_authority_changed');
 };
 await assertCurrent();
 const budgetPorts=input.runtime?.productionBudgetReadPorts;
 const overlay=await readMissingLabelRuntimeOverlay({...scope,detail:input.detail,planHash:input.planHash})
  ??await autoCompleteMissingBenchmarkLabels({...scope,detail:input.detail,planHash:input.planHash,assertCurrent,
   ports:{ledgerRoot:budgetPorts?.ledgerRoot,readTariff:budgetPorts?.readTariff,assertNewSubmit:budgetPorts?.assertNewSubmit,
    ...input.runtime?.benchmarkLabelCompletionPorts}});
 const repaired=overlay?await graph.readSocialProductionGraphDetail({...scope,missingLabelOverlay:overlay},input.approvedContext):input.detail;
 if(!repaired)throw Error('benchmark_label_runtime_detail_missing');
 await blockOnMissingBenchmarkLabels({...scope,taskVersion:repaired.version,plan:repaired.assetSupplyPlan,...(overlay?{analysisStatus:'completed_unresolved' as const}:{}),
  sourceIdentity:{detail:input.detail,readRecord:input.repository.dataStore?id=>input.repository.dataStore!.getById<Record<string,unknown>>('trend_videos',id):undefined}});
 if(repaired.assetSupplyPlan?.shots.some(shot=>shot.materialRouting?.pendingReason)){
  const {admitSocialContentProduction}=await import('./socialContentProductionAdmission.js');
  await admitSocialContentProduction({...scope,userId:input.job.userId,graphPhase:'assets',graphApprovedContext:input.approvedContext,runtime:input.runtime});
 }
}
