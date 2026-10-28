import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import type {Starter198Repository} from './repository.js';
import type {MissingLabelOverlay} from './socialContentMissingLabelCompletion.js';
import {MISSING_LABEL_COMPLETION_STAGE} from './socialContentMissingLabelCompletion.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {verifiedMissingLabelIdentity} from './socialContentMissingLabelIdentity.js';
import {socialRequestHash} from './socialContentValidation.js';

/** Only the runtime view receives labels. Persisted reference analysis and the
 * graph's admitted business authority remain byte-for-byte unchanged. */
export function projectMissingLabelOverlay(input:{tenantId:string;taskId:string;runId:string;
 reference:SocialContentTaskDetail['referenceVideoAnalysis'];overlay:MissingLabelOverlay}){
 const {overlay,reference}=input;
 if(!reference||overlay.schemaVersion!=='social-benchmark-label-completion.v1'
  ||overlay.recordHash!==socialRequestHash({...overlay,recordHash:''})||overlay.tenantId!==input.tenantId
  ||overlay.taskId!==input.taskId||overlay.runId!==input.runId
  ||overlay.sourceIdentity.referenceAnalysisId!==reference.analysisId
  ||overlay.sourceIdentity.referenceAnalysisVersion!==reference.version
  ||overlay.sourceIdentity.recordId!==reference.referenceRecordId
  ||!overlay.labels.length||new Set(overlay.labels.map(row=>row.shotId)).size!==overlay.labels.length
  ||overlay.labels.length!==overlay.sourceIdentity.slots.length
  ||overlay.labels.some(row=>!['talking_head','factory','product','consumer_demo','general','unknown'].includes(row.materialType)
   ||!overlay.sourceIdentity.slots.some(slot=>slot.shotId===row.shotId&&slot.referenceShotId===row.referenceShotId)
   ||reference.shots.filter(shot=>shot.shotId===row.referenceShotId).length!==1
   ||(row.materialType!=='unknown'&&(!row.classificationEvidence||row.classificationEvidence.length<2
    ||!reference.shots.find(shot=>shot.shotId===row.referenceShotId)!.visualDescription.includes(row.classificationEvidence)))))throw Error('benchmark_label_overlay_invalid');
 return {...structuredClone(reference),shots:reference.shots.map(shot=>{
  const labels=overlay.labels.filter(row=>row.referenceShotId===shot.shotId);
  if(!labels.length)return structuredClone(shot);
  if(new Set(labels.map(row=>row.materialType)).size!==1)throw Error('benchmark_label_overlay_conflicting_reference');
  return {...structuredClone(shot),materialType:labels[0]!.materialType};
 })};
}
export async function readMissingLabelRuntimeOverlay(input:{repository:Starter198Repository;tenantId:string;taskId:string;runId:string;
 detail:SocialContentTaskDetail;planHash?:string}):Promise<MissingLabelOverlay|null>{
 if(!input.repository.dataStore||input.detail.brief.materialRoutingPolicyVersion!=='type-aware.v3')return null;
 const job=await readContentExecutionJob(input.repository.dataStore,input.tenantId,input.taskId,input.runId);
 const checkpoint=job?.checkpoints[MISSING_LABEL_COMPLETION_STAGE];
 if(!checkpoint)return null;
 const overlay=checkpoint.payload as MissingLabelOverlay;
 const expected=socialRequestHash({tenantId:input.tenantId,taskId:input.taskId,runId:input.runId,
  planHash:overlay.planHash,sourceIdentity:overlay.sourceIdentity});
 if(checkpoint.version!=='1'||checkpoint.inputHash!==expected||(input.planHash&&input.planHash!==overlay.planHash))
  throw Error('benchmark_label_overlay_checkpoint_changed');
 projectMissingLabelOverlay({...input,reference:input.detail.referenceVideoAnalysis,overlay});
 const actual=await verifiedMissingLabelIdentity({tenantId:input.tenantId,detail:input.detail,
  slotIds:overlay.labels.map(row=>row.shotId),readRecord:id=>input.repository.dataStore!.getById<Record<string,unknown>>('trend_videos',id)});
 if(socialRequestHash(actual)!==socialRequestHash(overlay.sourceIdentity))throw Error('benchmark_label_overlay_source_changed');
 return overlay;
}
