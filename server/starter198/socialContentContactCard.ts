import type { SocialAssetSupplyPlan, SocialContentTaskBrief } from '../../shared/contracts/socialContentWorkflow.js';
import { isContactGraphicScene } from '../../shared/socialMaterialScenePurpose.js';

/** Supplies confirmed task copy to the existing graphic renderer, never reference identities or contact details. */
export function bindTaskContactCards(plan: SocialAssetSupplyPlan, brief: Pick<SocialContentTaskBrief, 'callToAction'>): SocialAssetSupplyPlan {
  return { ...plan, shots: plan.shots.map(shot => {
    if (shot.sourceStrategy !== 'motion_graphics' || shot.materialRouting?.materialType !== 'general'
      || shot.truthBoundary.subject !== 'none' || !shot.visualContract
      || !isContactGraphicScene(shot.visualContract, shot.requestedDescription ?? '')) return shot;
    return { ...shot, functionalEquivalentReplacement: { ...shot.functionalEquivalentReplacement,
      required: true, description: brief.callToAction?.trim() || '联系了解更多',
      reason: '使用当前任务已确认的行动引导重新制作收尾卡片，不借用参考头像、品牌或联系方式' } };
  }) };
}
