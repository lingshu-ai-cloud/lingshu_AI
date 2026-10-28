import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import type {BenchmarkMaterialType} from '../../shared/benchmarkAnalysis.js';
import type {VideoAiAnalysis} from '../types/index.js';
import {repairVideoShotClassifications} from '../agents/qwenClassificationRepair.js';
import {createQwenClient} from '../agents/qwenClient.js';
import {getQwenProviderBinding} from '../agents/qwen.js';
import {productionBudgetDuration} from '../../shared/contracts/productionBudgetPolicy.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {recordCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {verifiedMissingLabelIdentity} from './socialContentMissingLabelIdentity.js';
import {prepareMissingLabelBudget} from './socialContentMissingLabelBudget.js';
import {socialRequestHash} from './socialContentValidation.js';
import {STARTER_COLLECTIONS} from './repository.js';

export const MISSING_LABEL_COMPLETION_STAGE='social.benchmark_label_completion';
export type MissingLabelOverlay={schemaVersion:'social-benchmark-label-completion.v1';
 tenantId:string;taskId:string;runId:string;planHash:string;
 sourceIdentity:NonNullable<Awaited<ReturnType<typeof verifiedMissingLabelIdentity>>>;
 labels:Array<{shotId:string;referenceShotId:string;materialType:BenchmarkMaterialType;classificationEvidence:string}>;
 operationId:string;requestHash:string;recordHash:string};

/** Classify trusted, already-observed facts once. No network is called without
 * the original film reservation. Unknown billing is recover-only. Source
 * analysis, script, shot count/order and sentence timings remain untouched. */
export async function autoCompleteMissingBenchmarkLabels(input:{
 repository:Parameters<typeof prepareMissingLabelBudget>[0]['repository'];tenantId:string;taskId:string;runId:string;
 detail:SocialContentTaskDetail;planHash:string;assertCurrent:()=>Promise<void>;
 ports?:Parameters<typeof prepareMissingLabelBudget>[0]['ports']&{
 send?:(request:Record<string,unknown>)=>Promise<unknown>;
 record?:typeof recordCurrentContentExecutionCheckpoint}}):Promise<MissingLabelOverlay|null>{
 const {detail}=input,plan=detail.assetSupplyPlan;
 if(plan?.materialRoutingPolicyVersion!=='type-aware.v3'||!input.repository.dataStore)return null;
 const pending=plan.shots.filter(shot=>shot.materialRouting?.materialType==='unknown'
   ||shot.materialRouting?.pendingReason==='material_label_unresolved');
 if(!pending.length)return null;
 const readRecord=(id:string)=>input.repository.dataStore!.getById<Record<string,unknown>>('trend_videos',id);
 const identityInput={tenantId:input.tenantId,detail,slotIds:pending.map(shot=>shot.shotId),readRecord};
 const sourceIdentity=await verifiedMissingLabelIdentity(identityInput);
 if(!sourceIdentity)return null;
 const sources=sourceIdentity.slots.map(slot=>detail.referenceVideoAnalysis!.shots.find(shot=>shot.shotId===slot.referenceShotId)!);
 // No observation means no honest text repair; don't spend money guessing from narration.
 if(sources.some(shot=>!shot.visualDescription?.trim()||!/\S.{2}/u.test(shot.visualDescription)))return null;
 const taskRows=await input.repository.list(STARTER_COLLECTIONS.socialContentTasks,input.tenantId,{where:{task_id:input.taskId},perPage:2});
 if(taskRows.totalItems!==1||taskRows.items.length!==1)throw Error('benchmark_label_task_missing');
 const sourceSnapshot=socialRequestHash({reference:taskRows.items[0]!.reference_video_analysis,script:taskRows.items[0]!.replication_script});
 const identity={tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,planHash:input.planHash,sourceIdentity};
 const inputHash=socialRequestHash(identity);
 const job=await readContentExecutionJob(input.repository.dataStore,input.tenantId,input.taskId,input.runId);
 if(!job)throw Error('benchmark_label_job_missing');
 const prior=job.checkpoints[MISSING_LABEL_COMPLETION_STAGE];
 if(prior){
  const overlay=prior.payload as MissingLabelOverlay;
  if(prior.version!=='1'||prior.inputHash!==inputHash||overlay.recordHash!==socialRequestHash({...overlay,recordHash:''})
   ||socialRequestHash({tenantId:overlay.tenantId,taskId:overlay.taskId,runId:overlay.runId,planHash:overlay.planHash,sourceIdentity:overlay.sourceIdentity})!==inputHash)
   throw Error('benchmark_label_completion_changed');
  return structuredClone(overlay);
 }
 const analysis={scriptDetails15s:sources.map(shot=>({time:`${shot.startSeconds}-${shot.endSeconds}`,
   visual:shot.visualDescription,materialType:'unknown',narrativeRole:'unknown'}))} as VideoAiAnalysis;
 let operationId='',requestHash='';
 const assertCurrent=async()=>{
  await input.assertCurrent();
  const rows=await input.repository.list(STARTER_COLLECTIONS.socialContentTasks,input.tenantId,{where:{task_id:input.taskId},perPage:2});
  if(rows.totalItems!==1||rows.items.length!==1||socialRequestHash({reference:rows.items[0]!.reference_video_analysis,script:rows.items[0]!.replication_script})!==sourceSnapshot)
   throw Error('benchmark_label_task_source_changed');
  const current=await verifiedMissingLabelIdentity(identityInput);
  if(socialRequestHash(current)!==socialRequestHash(sourceIdentity))throw Error('benchmark_label_source_changed');
 };
 let repaired:VideoAiAnalysis;
 try {repaired=await repairVideoShotClassifications({analysis,materialOnlyIndexes:sources.map((_,index)=>index+1),
  complete:async(prompt,maxTokens)=>{
   let model:string;
   try {model=(input.ports?.readBinding??getQwenProviderBinding)().materialModel;}
   catch {throw Error('user_input_required:benchmark_label_provider_unavailable');}
   const request={model,messages:[{role:'user',content:prompt}],response_format:{type:'json_object'},max_tokens:maxTokens};
   const budget=await prepareMissingLabelBudget({...input,durationSeconds:productionBudgetDuration({
    ...detail.brief,scenes:detail.agentWorkflow!.directorBrief.scenes}),request,assertCurrent});
   operationId=budget.intent.operationId;requestHash=budget.intent.inputContractHash;
   const response=await budget.permit.isProvenUnsubmitted?.(operationId)
    ?await budget.submit(input.ports?.send??(async body=>createQwenClient().chat.completions.create(body as any,{maxRetries:0})))
    :await budget.recoverResponse();
   const content=(response as {choices?:Array<{message?:{content?:unknown}}>})?.choices?.[0]?.message?.content;
   if(typeof content!=='string')throw Error('benchmark_label_provider_output_invalid');
   return content;
  }});} catch(error){
   const code=error instanceof Error?error.message:String(error);
   if(code.startsWith('exact_classification_')||code==='benchmark_label_provider_output_invalid')
    throw Error('user_input_required:benchmark_label_completion_unresolved:'+code);
   throw error;
 }
 await assertCurrent();
 const overlay:MissingLabelOverlay={schemaVersion:'social-benchmark-label-completion.v1',...identity,
  labels:sourceIdentity.slots.map((slot,index)=>({...slot,
   materialType:repaired.scriptDetails15s![index]!.materialType??'unknown',
   classificationEvidence:repaired.scriptDetails15s![index]!.classificationEvidence??''})),
  operationId,requestHash,recordHash:''};
 overlay.recordHash=socialRequestHash({...overlay,recordHash:''});
 await(input.ports?.record??recordCurrentContentExecutionCheckpoint)({stage:MISSING_LABEL_COMPLETION_STAGE,version:'1',inputHash,payload:overlay});
 return overlay;
}
