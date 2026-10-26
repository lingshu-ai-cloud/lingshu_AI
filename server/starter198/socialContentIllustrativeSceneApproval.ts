import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import { enterpriseScenePurpose } from '../../shared/socialMaterialScenePurpose.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';
export function assertIllustrativeSceneSelection(detail: SocialContentTaskDetail | null, ids: string[]): void {
  if (!detail || ids.some(id => {
    const shot=detail.assetSupplyPlan?.shots.find(shot=>shot.shotId===id);
    return !shot || shot.materialRouting?.materialType!=='general' || shot.truthBoundary.subject!=='none'
      || shot.truthBoundary.customerEvidenceRequired || !shot.visualContract || !enterpriseScenePurpose(shot.visualContract,shot.requestedDescription??'');
  })) throw new SocialContentWorkflowError('social_illustrative_scene_not_eligible',400);
}
