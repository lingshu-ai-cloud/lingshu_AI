import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';
import type {SocialReferenceVideoAnalysis} from '../../shared/contracts/socialContentReplication.js';
import type {FrozenPresenterGroup} from './socialContentPaidOperationPlan.js';
import {socialRequestHash} from './socialContentValidation.js';

type Composition = {background:string;framing:string;camera:string;composition:string};
export type SocialPresenterSceneComposition = Composition & (
 | {source:{kind:'reference_scene'};referenceSourceId:string;referenceShotId:string;startSeconds:number;endSeconds:number;referenceFirstFrameUrl:string}
 | {source:{kind:'original_scene';sceneId:string;sceneContractHash:string;promptHash:string};prompt:string;sceneContract:ReturnType<typeof originalPresenterSceneContract>}
);

/** Same payload as the existing frozen budget group; no fabricated source media. */
export function originalPresenterSceneContract(scene:SocialDirectorBriefScene,aspectRatio:string){
 return {version:'presenter-original-scene.v1',sceneId:scene.sceneId,targetVisual:scene.targetVisual,
  visualContract:scene.visualContract??null,action:scene.action,shotLanguage:scene.shotLanguage,duration:scene.duration,aspectRatio};
}

/** Projection only: the frozen groups remain the owner of execution/grouping. */
export function buildSocialPresenterSceneSources(input:{groups:readonly FrozenPresenterGroup[];directorScenes:readonly SocialDirectorBriefScene[];reference:SocialReferenceVideoAnalysis|null|undefined;aspectRatio:string}){
 const directors=new Map(input.directorScenes.map(scene=>[scene.sceneId,scene]));
 const references=new Map((input.reference?.shots??[]).map(shot=>[shot.shotId,shot]));
 return input.groups.map(group=>({groupId:group.groupId,compositions:group.shotIds.map((shotId):SocialPresenterSceneComposition=>{
  const scene=directors.get(shotId);
  if(!scene)throw Error(`presenter_scene_source_director_missing:${shotId}`);
  if(scene.referenceShotId){
   const reference=references.get(scene.referenceShotId);
   if(group.sceneSourceKind==='original_scene'||!reference?.materialEvidence?.firstFrameRef)
    throw Error(`presenter_first_frame_reference_composition_missing:${shotId}`);
   const match=/\/videos\/([^/]+)\//.exec(reference.materialEvidence.firstFrameRef);
   return {source:{kind:'reference_scene'},referenceSourceId:match?decodeURIComponent(match[1]!):'reference-video',
    referenceShotId:reference.shotId,startSeconds:reference.startSeconds,endSeconds:reference.endSeconds,
    referenceFirstFrameUrl:reference.materialEvidence.firstFrameRef,background:reference.visualDescription,
    framing:reference.shotLanguage?.shotSize||'未确认景别',
    camera:group.visualCompatibilityHash?[reference.shotLanguage?.cameraAngle,reference.shotLanguage?.movement].filter(Boolean).join('；')||'未确认机位':reference.shotLanguage?.movement||'未确认机位',
    composition:reference.shotLanguage?.composition||'未确认构图'};
  }
  const sceneContract=originalPresenterSceneContract(scene,input.aspectRatio),sceneContractHash=socialRequestHash(sceneContract);
  if(group.sceneSourceKind!=='original_scene'||group.sceneSourceContractHash!==sceneContractHash)
   throw Error(`presenter_original_scene_contract_changed:${shotId}`);
  if(!scene.targetVisual.trim()||!input.aspectRatio.trim()||!Number.isFinite(scene.duration.targetSeconds)||scene.duration.targetSeconds<=0)
   throw Error(`presenter_original_scene_contract_incomplete:${shotId}`);
  // Structured authored direction, not invented CV/ASR or a reference frame.
  const prompt=JSON.stringify(sceneContract);
  return {source:{kind:'original_scene',sceneId:scene.sceneId,sceneContractHash,promptHash:socialRequestHash(prompt)},prompt,sceneContract,
   background:scene.visualContract?.environment.description||scene.targetVisual,
   framing:scene.shotLanguage.shotSize,camera:[scene.shotLanguage.cameraAngle,scene.shotLanguage.movement].filter(Boolean).join('；'),composition:scene.shotLanguage.composition};
 })}));
}

/** Reconstruct the same source projection at the mother-video handoff. New
 * original groups require their canonical frozen budget source, never a made-up
 * reference URL; historical reference groups retain their original fallback. */
export function buildSocialPresenterMotherSceneSources(input:{
 groups:readonly {segmentId:string;members:readonly {slotId:string}[]}[];
 requirements:readonly import('./socialContentPaidOperationPlan.js').PaidStageRequirement[];
 frozenGroups?:readonly FrozenPresenterGroup[];directorScenes:readonly SocialDirectorBriefScene[];
 reference:SocialReferenceVideoAnalysis|null|undefined;aspectRatio:string;
}){
 const groups=input.groups.map(group=>{
  const matches=input.requirements.filter(item=>item.presenterGroupId===group.segmentId);
  const requirement=matches[0];
  if(matches.length!==1||!requirement?.presenterGroupContractHash||!requirement.presenterAssetId
   ||socialRequestHash(requirement.presenterGroupShotIds)!==socialRequestHash(group.members.map(member=>member.slotId)))throw Error(`presenter_first_frame_group_requirement_missing:${group.segmentId}`);
  const frozen=input.frozenGroups?.find(item=>item.groupId===group.segmentId);
  if(frozen&&(frozen.contractHash!==requirement.presenterGroupContractHash||frozen.presenterAssetId!==requirement.presenterAssetId
   ||socialRequestHash(frozen.shotIds)!==socialRequestHash(requirement.presenterGroupShotIds)))throw Error(`presenter_mother_budget_group_changed:${group.segmentId}`);
  return frozen??{groupId:group.segmentId,shotIds:group.members.map(member=>member.slotId),durationSeconds:Number(requirement.durationSeconds),spokenText:requirement.text||'',presenterAssetId:requirement.presenterAssetId,contractHash:requirement.presenterGroupContractHash,...(requirement.presenterVisualCompatibilityHash?{visualCompatibilityHash:requirement.presenterVisualCompatibilityHash}:{})};
 });
 const sources=buildSocialPresenterSceneSources({...input,groups});
 return groups.map((group,index)=>({groupId:group.groupId,presenterGroupContractHash:group.contractHash,presenterAssetId:group.presenterAssetId,compositions:sources[index]!.compositions}));
}
