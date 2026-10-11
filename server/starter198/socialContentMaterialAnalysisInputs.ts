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
  const animationRefs = new Set(shots.filter(shot => shot.sourceStrategy === 'customer_product_image_animation')
    .flatMap(shot => shot.sourceRefs));
  const selected = input.assets.filter(asset => refs.has(asset.id) || refs.has(asset.sourceId)
    || (animation && animationRefs.size === 0 && asset.type === 'image'));
  const independentProduct = (shot: typeof shots[number]) => input.policyVersion === 'type-aware.v1'
    && ['aigc_product_scene_replication', 'customer_product_image_animation'].includes(shot.sourceStrategy)
    && !shot.fallbackSourceStrategy
    && (shot.sourceStrategy === 'customer_product_image_animation'
      || ['enterprise_authored_product_first_frame_i2v', 'reference_first_frame_product_replacement_i2v']
        .includes(shot.materialRouting?.generation?.method || ''));
  const productReferences = selected.filter(asset => asset.type === 'image'
    && shots.some(shot => independentProduct(shot) && shot.sourceRefs.some(ref => ref === asset.id || ref === asset.sourceId))
    && !shots.some(shot => !independentProduct(shot) && shot.sourceRefs.some(ref => ref === asset.id || ref === asset.sourceId)));
  const kept = new Set(productReferences);
  return { analyze: selected.filter(asset => !kept.has(asset)), productReferences };
}
