import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import type {SocialWorkflowMaterialClipCandidate} from './socialContentRecords.js';
import type {MeasuredSceneTime} from './socialContentMeasuredSceneTimeline.js';
import {reconcileMeasuredMaterialRouting} from './socialContentMeasuredMaterialRouting.js';

/** Derive a local-only execution projection after the immutable original plan
 * was verified. A user-requested rework must not silently select its old source. */
export function routeSceneReworkMaterials(input:{tenantId:string;plan:SocialAssetSupplyPlan;
  timeline:MeasuredSceneTime[];candidates:SocialWorkflowMaterialClipCandidate[];affectedSceneIds:string[];
  excludedSourceRefs?:Record<string,string>}) {
  if (!input.affectedSceneIds.length || new Set(input.affectedSceneIds).size !== input.affectedSceneIds.length)
    throw Error('scene_rework_selection_invalid');
  const original = input.plan;
  if (input.affectedSceneIds.some(id => !original.shots.some(shot => shot.shotId === id)))
    throw Error('scene_rework_scene_mapping_missing');
  const eligibleByShot = new Map(original.shots.filter(shot => input.affectedSceneIds.includes(shot.shotId))
    .map(shot => [shot.shotId, input.candidates.filter(candidate => candidate.sourceRef !== (shot.selectedMaterialSegment?.sourceRef??input.excludedSourceRefs?.[shot.shotId]))]));
  let projected = structuredClone(original);
  const pending: string[] = [];
  for (const shotId of input.affectedSceneIds) {
    const index = projected.shots.findIndex(shot => shot.shotId === shotId), shot = projected.shots[index]!;
    if (shot.sourceStrategy !== 'customer_real_asset' || !shot.materialRouting
      || ['talking_head','unknown'].includes(shot.materialRouting.materialType))
      throw Error('scene_rework_theme_route_not_supported');
    const routed = reconcileMeasuredMaterialRouting({tenantId:input.tenantId,plan:projected,
      timeline:input.timeline,candidates:eligibleByShot.get(shotId)!});
    if (routed.pending.some(item => item.shotId === shotId)) { pending.push(shotId); continue; }
    const replacement = routed.plan.shots[index]!;
    if (!replacement.selectedMaterialSegment || replacement.selectedMaterialSegment.sourceRef === (shot.selectedMaterialSegment?.sourceRef??input.excludedSourceRefs?.[shotId]))
      throw Error('scene_rework_replacement_source_invalid');
    projected.shots[index] = replacement;
  }
  return {plan:projected,pending};
}
