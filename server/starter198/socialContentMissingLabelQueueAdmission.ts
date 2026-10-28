import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import {validateSentenceSlots} from './socialContentSentenceSlotMapping.js';

type LabelDetail=Pick<SocialContentTaskDetail,'brief'|'assetSupplyPlan'|'agentWorkflow'|'referenceVideoAnalysis'|'replicationScript'|'sources'>;
/** Admit only the original worker's label-completion work. This is not a
 * production review approval, a material substitution or paid-call permission. */
function queueInputCompletion(detail:LabelDetail,labelsOnly:boolean):boolean {
 try {
  const {brief,assetSupplyPlan:plan,agentWorkflow:workflow,referenceVideoAnalysis:reference,replicationScript:script}=detail;
  const pin=brief.referenceReuse;
  if(brief.materialRoutingPolicyVersion!=='type-aware.v3'||brief.creationMode!=='viral_replication'
   ||brief.productionApproach==='shooting_plan'||!pin||!reference||!script||!workflow||!plan
   ||plan.materialRoutingPolicyVersion!=='type-aware.v3'||plan.status==='requires_rights_confirmation'
   ||!pin.recordId||!pin.analysisId||!/^[a-f0-9]{64}$/.test(pin.contentSha256)||!/^[a-f0-9]{64}$/.test(pin.analysisHash)
   ||pin.recordId!==reference.referenceRecordId||script.referenceAnalysisId!==reference.analysisId
   ||reference.status!=='ready'||reference.coverage?.fullTimelineCovered!==true||!['draft','review_required','confirmed'].includes(script.status)
   ||detail.sources.filter(source=>source.sourceId===reference.referenceSourceId&&source.kind==='reference_link'&&source.status==='active').length!==1)return false;
  const {directorBrief:director,executionPlan:execution,executionPlanReview:review}=workflow;
  if(director.status==='blocked'||review.approved||review.executionPlanId!==execution.executionPlanId
   ||review.executionPlanVersion!==execution.version||review.directorBriefId!==director.directorBriefId
   ||review.directorBriefVersion!==director.version||!director.scenes.length
   ||script.shots.length!==director.scenes.length||plan.shots.length!==director.scenes.length
   ||execution.scenes.length!==director.scenes.length||review.sceneResults.length!==director.scenes.length)return false;
  const pending=new Set(plan.shots.filter(shot=>Boolean(shot.materialRouting?.pendingReason)).map(shot=>shot.shotId));
  if(!pending.size||new Set(director.scenes.map(scene=>scene.sceneId)).size!==director.scenes.length)return false;
  const allowedReasons=new Set(['material_insufficient','capability_mismatch']);
  const pendingMessages={
   material_label_unresolved:['分镜标签补充分析后仍无法确定，需要用户介入或确认','确认该槽位标签后恢复原任务'],
   awaiting_theme_material:['待补素材：没有匹配当前分镜标签主题的素材','补充匹配主题的素材后恢复原槽位任务'],
   awaiting_shoot:['待拍：本地无已录入并绑定授权的数字人','完成待拍任务后将素材关联原槽位，恢复原任务'],
  };
  for(const [index,scene] of director.scenes.entries()){
   const scripted=script.shots[index]!,supply=plan.shots[index]!,planned=execution.scenes[index]!,result=review.sceneResults[index]!;
   const refs=reference.shots.filter(shot=>shot.shotId===scene.referenceShotId);
   if(scripted.shotId!==scene.sceneId||supply.shotId!==scene.sceneId||planned.sceneId!==scene.sceneId
    ||result.sceneId!==scene.sceneId||!scene.referenceShotId||scripted.referenceShotId!==scene.referenceShotId
    ||refs.length!==1)return false;
   if(pending.has(scene.sceneId)){
    const routing=supply.materialRouting!,reason=routing.pendingReason!,messages=pendingMessages[reason];
    if(!messages||labelsOnly&&reason!=='material_label_unresolved')return false;
    const materialType=routing.materialType;
    if(reason==='material_label_unresolved'
      ?materialType!=='unknown'||Boolean(refs[0]!.materialType&&refs[0]!.materialType!=='unknown')||!refs[0]!.visualDescription?.trim()
      :refs[0]!.materialType!==materialType||(reason==='awaiting_shoot'?materialType!=='talking_head'
        :!['factory','product','consumer_demo','general'].includes(materialType)))return false;
    const allowedCriteria=new Set([messages[0],'没有可执行的推荐候选']);
    const allowedRevisions=new Set([messages[1],'补充候选素材或可用能力后重新提交']);
    if(result.approved||!result.reasonCodes.length||result.reasonCodes.some(reason=>!allowedReasons.has(reason))
     ||!result.failedCriteria.length||result.failedCriteria.some(reason=>!allowedCriteria.has(reason))
     ||result.requiredRevision.some(reason=>!allowedRevisions.has(reason)))return false;
   }else if(supply.materialRouting?.pendingReason||!result.approved||result.reasonCodes.length
      ||result.failedCriteria.length||result.requiredRevision.length)return false;
  }
  if(!review.reasonCodes.length||review.reasonCodes.some(reason=>!allowedReasons.has(reason))
   ||review.failedCriteria.some(reason=>!review.sceneResults.some(result=>result.failedCriteria.includes(reason)))
   ||review.requiredRevision.some(reason=>!review.sceneResults.some(result=>result.requiredRevision.includes(reason))))return false;
  // Same sentence records must survive across all of their fixed visual slots.
  return Boolean(validateSentenceSlots(director.scenes.map(scene=>({shotId:scene.sceneId,
   spokenText:scene.audioLayers.voiceover??'',lines:scene.voiceoverLines}))));
 }catch{return false;}
}

/** Queue the existing input-required nodes, never approve production. */
export function canQueueV3InputCompletion(detail:LabelDetail):boolean{return queueInputCompletion(detail,false);}
/** Compatibility predicate for label-only graph/derived-review authority. */
export function canQueueMissingBenchmarkLabelCompletion(detail:LabelDetail):boolean{return queueInputCompletion(detail,true);}
