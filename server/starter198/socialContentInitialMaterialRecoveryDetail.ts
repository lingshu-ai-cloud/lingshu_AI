import type {ContentExecutionJob} from '../contentExecution/durableQueue.js';
import type {Starter198Repository} from './repository.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {readGraphContextSnapshot} from './socialContentGraphContextSnapshots.js';
import {readMissingLabelRuntimeOverlay} from './socialContentMissingLabelOverlay.js';
import {socialObject} from './socialContentValidation.js';

/** User selections are validated against the same pre-recovery slot plan as
 * the worker, rather than a fresh inventory projection that already includes
 * the uploaded replacement. */
export async function readInitialMaterialRecoveryDetail(input:{repository:Starter198Repository;tenantId:string;taskId:string;
 job:ContentExecutionJob}){
 const scope={repository:input.repository,tenantId:input.tenantId,taskId:input.taskId};
 const binding=input.job.checkpoints['social.executor'],payload=socialObject(binding?.payload);
 const context=payload?.executor==='langgraph'?readGraphContextSnapshot(payload):null;
 const graph=context?await import('./socialContentProductionGraph.js'):null;
 const original=context?await graph!.readSocialProductionGraphDetail(scope,context):await readSocialTaskDetail(scope);
 if(!original)return null;
 const overlay=await readMissingLabelRuntimeOverlay({...scope,runId:input.job.runId,detail:original,
  planHash:context?binding!.inputHash:undefined});
 return overlay?(context?graph!.readSocialProductionGraphDetail({...scope,missingLabelOverlay:overlay},context)
  :readSocialTaskDetail({...scope,missingLabelOverlay:overlay})):original;
}
