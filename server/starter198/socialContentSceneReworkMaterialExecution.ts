import type {Starter198Repository} from './repository.js';
import type {StoredSocialSceneCache} from './socialContentSceneReworkService.js';
import type {SocialSceneReworkIntent} from './socialContentSceneRework.js';
import {verifyStoredSceneReworkMeasuredVoice} from './socialContentSceneReworkMeasuredVoice.js';
import {routeSceneReworkMaterials} from './socialContentSceneReworkMaterialRouting.js';
import {prepareMeasuredLocalMaterialSupply} from './socialContentMeasuredMaterialPreparation.js';
import {readSocialTaskDetail,buildSocialWorkflowMaterialCandidates} from './socialContentRecords.js';
import {readMaterialLibrary} from '../lib/materialLibrary.js';
import {socialRequestHash} from './socialContentValidation.js';
import type {taskProductionAssets} from './socialContentProductionSupport.js';

/** Uses the current tenant inventory and source bytes. Saved selections are
 * replayed exactly: recovery must not silently pick a different material. */
export async function prepareSceneReworkMaterial(input:{repository:Starter198Repository;
  context:StoredSocialSceneCache & {intent:SocialSceneReworkIntent};outputDirectory:string;
  frozen?:Record<string,{sourceRef:string;segmentHash:string;bytesSha256:string;candidateHash:string}>;
  readTaskDetail?:typeof readSocialTaskDetail;loadProductionAssets?:typeof taskProductionAssets}) {
  const {context,repository}=input, {cache,intent,plan,baseline}=context;
  const ids=intent.affectedSceneIds.filter(id=>plan.shots.some(shot=>shot.shotId===id
    && shot.sourceStrategy==='customer_real_asset' && shot.materialRouting
    && !['talking_head','unknown'].includes(shot.materialRouting.materialType)));
  if(!ids.length)return null;
  if(!cache.measuredVoiceProof)throw Error('scene_rework_measured_voice_proof_missing');
  const timing=await verifyStoredSceneReworkMeasuredVoice(repository,cache);
  const detail=await (input.readTaskDetail??readSocialTaskDetail)({repository,tenantId:intent.tenantId,taskId:intent.taskId});
  if(!detail)throw Error('scene_rework_task_missing');
  const inventory=await (repository.materialLibrary??readMaterialLibrary)(intent.tenantId,{dataStore:repository.dataStore});
  if(inventory.status==='unavailable')throw Error('material_inventory_unavailable');
  const candidates=buildSocialWorkflowMaterialCandidates({records:inventory.items,tenantId:intent.tenantId,
    themeOnly:true,deferVideoSkuFilter:true,themeId:detail.theme?.themeId??null,
    voiceoverRows:baseline.scenes.map(scene=>({cueId:scene.sceneId,text:scene.voiceover||scene.narration||''}))}).candidates;
  const allowed=input.frozen ? candidates.filter(candidate=>Object.values(input.frozen!).some(row=>row.sourceRef===candidate.sourceRef)) : candidates;
  const excludedSourceRefs=Object.fromEntries(cache.scenes.filter(scene=>ids.includes(scene.sceneId))
    .flatMap(scene=>scene.result.sourceRef ? [[scene.sceneId,scene.result.sourceRef]] : []));
  const route=routeSceneReworkMaterials({tenantId:intent.tenantId,plan,timeline:timing.timeline,candidates:allowed,affectedSceneIds:ids,excludedSourceRefs});
  if(route.pending.length)throw Error(`user_input_required:awaiting_theme_material:${route.pending.join(',')}`);
  const requiredMaterials:Record<string,string>={};
  for(const id of ids){const segment=route.plan.shots.find(shot=>shot.shotId===id)!.selectedMaterialSegment!;
    const frozen=input.frozen?.[id];if(input.frozen&&(!frozen||frozen.sourceRef!==segment.sourceRef||frozen.segmentHash!==socialRequestHash(segment)))throw Error('scene_rework_material_selection_changed');
    requiredMaterials[id]=segment.sourceRef;
  }
  const prepared=await prepareMeasuredLocalMaterialSupply({repository,tenantId:intent.tenantId,taskId:intent.taskId,
    runId:intent.executionRunId,plan:route.plan,baseline,timeline:timing.timeline,voiceSha256:timing.wholeTrackSha256,
    materialCandidates:allowed,requiredMaterials,selectedShotIds:ids,availableAssets:[],outputDirectory:input.outputDirectory,
    sources:detail.sources,productRef:detail.brief.productRef,themeId:detail.theme?.themeId??null,
    productionMode:detail.brief.productionMode??'concept_preview',loadProductionAssets:input.loadProductionAssets});
  const frozen:Record<string,{sourceRef:string;segmentHash:string;bytesSha256:string;candidateHash:string}>={};
  for(const id of ids){const segment=prepared.effectivePlan.shots.find(shot=>shot.shotId===id)!.selectedMaterialSegment!;
    const source=prepared.evidence.sourceBytes.find(row=>row.sourceRef===segment.sourceRef);
    if(!source)throw Error('scene_rework_material_bytes_missing');
    const matches=allowed.filter(candidate=>candidate.sourceRef===segment.sourceRef&&candidate.segmentId===segment.segmentId);
    if(matches.length!==1)throw Error('scene_rework_material_candidate_ambiguous');
    frozen[id]={sourceRef:segment.sourceRef,segmentHash:socialRequestHash(segment),bytesSha256:source.sha256,candidateHash:socialRequestHash(matches[0])};
    if(input.frozen&&socialRequestHash(input.frozen[id])!==socialRequestHash(frozen[id]))throw Error('scene_rework_material_selection_changed');
  }
  return {plan:prepared.effectivePlan,assets:prepared.assets,frozen};
}
