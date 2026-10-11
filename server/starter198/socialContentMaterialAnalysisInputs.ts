import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentReplication.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';

/** Product first-frame supply has its own registered-image identity and visual
 * QA. Keep those images available to that adapter without separately buying
 * general-purpose material analysis that the adapter never consumes. */
export function socialContentMaterialAnalysisInputs(input: {
  assets: SocialProductionAsset[];
  plan: SocialAssetSupplyPlan | null;
  policyVersion?: string;
}) {
  if (!input.plan) return { analyze: input.assets, productReferences: [] as SocialProductionAsset[] };
  const shots = input.plan.shots;
  const refs = new Set(shots.flatMap(shot => shot.sourceRefs));
  const animation = shots.some(shot => shot.sourceStrategy === 'customer_product_image_animation');
  const selected = input.assets.filter(asset => refs.has(asset.id) || refs.has(asset.sourceId)
    || (animation && asset.type === 'image'));
  const independentProduct = (shot: typeof shots[number]) => input.policyVersion === 'type-aware.v1'
    && shot.sourceStrategy === 'aigc_product_scene_replication'
    && !shot.fallbackSourceStrategy
    && ['enterprise_authored_product_first_frame_i2v', 'reference_first_frame_product_replacement_i2v']
      .includes(shot.materialRouting?.generation?.method || '');
  const productReferences = selected.filter(asset => asset.type === 'image'
    && shots.some(shot => independentProduct(shot) && shot.sourceRefs.some(ref => ref === asset.id || ref === asset.sourceId))
    && !shots.some(shot => !independentProduct(shot) && shot.sourceRefs.some(ref => ref === asset.id || ref === asset.sourceId))
    && !animation);
  const kept = new Set(productReferences);
  return { analyze: selected.filter(asset => !kept.has(asset)), productReferences };
}
