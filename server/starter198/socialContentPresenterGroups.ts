import {freezePresenterMotherSegments} from '../../shared/contracts/presenterMotherSegments.js';
import type {SocialDirectorBriefScene} from '../../shared/contracts/socialContentAgentContract.js';
import type {SocialAssetSupplyPlan,SocialReferenceShotAnalysis,SocialReferenceVideoAnalysis} from '../../shared/contracts/socialContentReplication.js';
import {paidProductionHash,presenterGroupContractHash,type FrozenPaidProduction,type FrozenPresenterGroup} from './socialContentPaidOperationPlan.js';

const normalized=(value:string|null|undefined)=>(value??'').normalize('NFKC').trim().replace(/\s+/g,' ');
const known=(value:string)=>Boolean(value&&!/^(?:unknown|未确认.*|未知.*)$/i.test(value));

/** Exact compatibility from the existing reference/visual contract. No prose
 * classifier, similarity guess, SKU inference or extra provider request.
 * Incomplete evidence splits a shot rather than asking the user or blocking it.
 */
export function presenterVisualCompatibilityHash(input:{
 sceneId:string;reference?:SocialReferenceShotAnalysis;referenceSourceId:string;
 director?:SocialDirectorBriefScene;
 presenterAssetId:string;aspectRatio:string;
 productBinding?:SocialAssetSupplyPlan['shots'][number]['enterpriseProductAssetLock'];
}):string{
 const reference=input.reference,visual=reference?.visualContract??input.director?.visualContract;
 const camera=visual?.camera??reference?.shotLanguage??input.director?.shotLanguage;
 const background=normalized(visual?.environment.description)||normalized(reference?.visualDescription)||normalized(input.director?.targetVisual);
 const fields={background,shotSize:normalized(camera?.shotSize),angle:normalized(camera&&'angle' in camera?camera.angle:camera?.cameraAngle),movement:normalized(camera?.movement),composition:normalized(camera?.composition)};
 const incomplete=!Object.values(fields).every(known);
 return paidProductionHash({version:'presenter-visual-compatibility.v2',referenceSourceId:input.referenceSourceId,
  presenterAssetId:input.presenterAssetId,aspectRatio:input.aspectRatio,...fields,
  environment:visual?{kind:visual.environment.kind,description:normalized(visual.environment.description),details:visual.environment.details.map(normalized).sort()}:null,
  interaction:visual?{kind:visual.interaction.kind,contactArea:normalized(visual.interaction.contactArea),productUsage:visual.productUsage.kind}:null,
  action:visual?{start:normalized(visual.action.startState),path:normalized(visual.action.path),peak:normalized(visual.action.peakState),end:normalized(visual.action.endState)}:reference?.action??input.director?.action??null,
  productBinding:input.productBinding??null,
  ...(incomplete?{isolatedSceneId:input.sceneId}:{})});
}

/** The original frozen scenes and the shared mother-segment freezer own both
 * financial and provider grouping. Never maintain a second temporal algorithm.
 */
export function freezeSocialPresenterBudgetGroups(input:{
 taskId:string;scenes:FrozenPaidProduction['scenes'];directorScenes:SocialDirectorBriefScene[];
 shots:SocialAssetSupplyPlan['shots'];reference:SocialReferenceVideoAnalysis|null|undefined;aspectRatio:string;groupingPolicy?:'visual.v2'|'legacy.v1';
}):{scenes:FrozenPaidProduction['scenes'];presenterGroups:FrozenPresenterGroup[]}{
 const shots=new Map(input.shots.map(shot=>[shot.shotId,shot]));
 const directors=new Map(input.directorScenes.map(scene=>[scene.sceneId,scene]));
 const references=new Map((input.reference?.shots??[]).map(shot=>[shot.shotId,shot]));
 const identities=new Map<string,string>();
 const visualVersion=input.groupingPolicy!=='legacy.v1';
 const scenes=input.scenes.map(scene=>{
  const shot=shots.get(scene.shotId),ids=[...new Set(shot?.digitalHumanPlan?.presenterAssetIds?.length?shot.digitalHumanPlan.presenterAssetIds:shot?.sourceRefs??[])];
  if(scene.presenterSpeech!=='whole_track'||shot?.sourceStrategy!=='authorized_digital_presenter'||ids.length!==1)return{...scene};
  identities.set(scene.shotId,ids[0]!);
  if(!visualVersion)return{...scene};
  const director=directors.get(scene.shotId),reference=references.get(director?.referenceShotId??'');
  const originalSourceHash=!reference&&director?paidProductionHash({version:'presenter-original-scene.v1',sceneId:director.sceneId,targetVisual:director.targetVisual,visualContract:director.visualContract??null,action:director.action,shotLanguage:director.shotLanguage,duration:director.duration,aspectRatio:input.aspectRatio}):undefined;
  return{...scene,visualCompatibilityHash:presenterVisualCompatibilityHash({sceneId:scene.shotId,reference,director,referenceSourceId:reference?(input.reference?.referenceSourceId??''):`original:${originalSourceHash??scene.shotId}`,presenterAssetId:ids[0]!,aspectRatio:input.aspectRatio,productBinding:shot.enterpriseProductAssetLock})};
 });
 const presenterGroups:FrozenPresenterGroup[]=[];
 if(identities.size){
  const grouping=freezePresenterMotherSegments({taskId:input.taskId,referenceAnalysisHash:paidProductionHash(input.reference??null),slots:scenes.map(scene=>{
   const director=directors.get(scene.shotId);if(!director)throw Error(`presenter_mother_director_scene_missing:${scene.shotId}`);
   return{slotId:scene.shotId,referenceShotId:director.referenceShotId??scene.shotId,startSeconds:director.duration.startSeconds,endSeconds:director.duration.endSeconds,spokenText:scene.spokenText,materialType:identities.has(scene.shotId)?'talking_head':'unknown',frontFacing:identities.has(scene.shotId),lipSyncRequired:identities.has(scene.shotId),visualCompatibilityHash:scene.visualCompatibilityHash};
  })});
  for(const segment of grouping.groups){
   const members=scenes.filter(scene=>segment.memberSlotIds.includes(scene.shotId));
   const staticReferenceImageCount=2+(shots.get(segment.memberSlotIds[0]!)?.enterpriseProductAssetLock?.referenceImageIds.length??0);
   const originalHashes=visualVersion?[...new Set(segment.memberSlotIds.map(shotId=>{const director=directors.get(shotId);if(!director||references.has(director.referenceShotId??''))return undefined;return paidProductionHash({version:'presenter-original-scene.v1',sceneId:director.sceneId,targetVisual:director.targetVisual,visualContract:director.visualContract??null,action:director.action,shotLanguage:director.shotLanguage,duration:director.duration,aspectRatio:input.aspectRatio});}).filter(Boolean))] as string[]:[];
   if(originalHashes.length>1)throw Error(`presenter_original_scene_group_ambiguous:${segment.segmentId}`);
   const group:FrozenPresenterGroup={groupId:segment.segmentId,shotIds:segment.memberSlotIds,durationSeconds:members.reduce((sum,scene)=>sum+scene.durationSeconds,0),spokenText:members.map(scene=>scene.spokenText).join(' '),presenterAssetId:identities.get(segment.memberSlotIds[0]!)!,...(visualVersion?{visualCompatibilityHash:segment.visualCompatibilityHash,staticReferenceImageCount,firstFramePipeline:'background-first.v2' as const,...(originalHashes[0]?{sceneSourceKind:'original_scene' as const,sceneSourceContractHash:originalHashes[0]}:{})}:{}),contractHash:''};
   group.contractHash=presenterGroupContractHash(group);presenterGroups.push(group);
  }
 }
 for(const scene of scenes){
  const shot=shots.get(scene.shotId);
  if(shot?.sourceStrategy!=='authorized_digital_presenter'||shot.digitalHumanPlan?.method!=='reenact'||(shot.digitalHumanPlan as typeof shot.digitalHumanPlan&{silentMotion?:boolean}).silentMotion!==true)continue;
  const ids=[...new Set(shot.digitalHumanPlan.presenterAssetIds)];if(ids.length!==1)throw Error('motion_presenter_identity_ambiguous');
  const group:FrozenPresenterGroup={groupId:`presenter-motion:${scene.shotId}`,shotIds:[scene.shotId],durationSeconds:scene.durationSeconds,spokenText:scene.spokenText,presenterAssetId:ids[0]!,executionKind:'seedance_motion',...(visualVersion?{staticReferenceImageCount:2+(shot.enterpriseProductAssetLock?.referenceImageIds.length??0)}:{}),contractHash:''};
  group.contractHash=presenterGroupContractHash(group);presenterGroups.push(group);
 }
 presenterGroups.sort((a,b)=>scenes.findIndex(scene=>scene.shotId===a.shotIds[0])-scenes.findIndex(scene=>scene.shotId===b.shotIds[0]));
 return{scenes,presenterGroups};
}
