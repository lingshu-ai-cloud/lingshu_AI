import type { CreationReply } from '../../shared/contracts/contentCreationDialogue.js';
import type { SocialAssetSupplyShotRequest } from '../../shared/socialContentAssetSupply.js';
import type { SocialWorkflowMaterialClipCandidate } from './socialContentMaterialCandidateSupport.js';
import { normalizeLocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { SocialContentWorkflowError } from './socialContentValidation.js';

/** Reuse canonical profile/rights/semantic admission, restricting each chosen node to its exact segment. */
export function guidedMaterialRoutingRequests(plan: CreationReply, input: Parameters<typeof materialRoutingRequests>[0]) {
  return input.shots.flatMap(shot => {
    const node = plan.guided?.nodes.find(node => `guided-${node.id}` === shot.shotId);
    if (!node) throw new SocialContentWorkflowError('guided_creation_node_changed', 409);
    const selected = plan.guided?.candidates.find(row => row.id === node.selectedCandidateId);
    const candidates = selected ? input.candidates.filter(row => row.assetId === selected.sourceId && row.segmentId === selected.segmentId) : [];
    const candidate = candidates[0];
    if (selected) {
      const profile = normalizeLocalMaterialSegmentProfile(candidate?.segmentProfile);
      if (!candidate || candidate.origin !== 'my_materials' || candidate.mediaType !== 'video' || candidate.synthetic === true
        || candidate.segmentProfile?.productionEligible !== true || !profile?.productionEligible
        || profile.tenantId !== input.tenantId || profile.assetId !== candidate.assetId || profile.segmentId !== candidate.segmentId
        || profile.sourceRevision !== candidate.sourceRevision || !profile.commercialUseApproved || !profile.derivativeUseAllowed) {
        throw new SocialContentWorkflowError('guided_creation_selected_segment_not_admitted', 409);
      }
    }
    const type = node.type === 'talking_head' && plan.selection.guided?.presenterMode === 'none' && !(input.shots.indexOf(shot) === 0 && plan.selection.guided?.scene?.hook?.usage === 'editable') ? selected?.type || 'product' : node.type;
    if (type === 'talking_head' && candidate && (normalizeLocalMaterialSegmentProfile(candidate.segmentProfile)?.materialType !== 'talking_head' || !candidate.materialRoles.includes('presenter'))) throw new SocialContentWorkflowError('guided_creation_selected_segment_not_admitted', 409);
    const productId = candidate?.productId || plan.selection.productIds[input.shots.indexOf(shot) % plan.selection.productIds.length];
    const productRef = candidate?.productRef || plan.products.find(row => row.id === productId)?.name || null;
    const request: SocialAssetSupplyShotRequest = { ...shot, materialType: type, productRef: type === 'product' ? productRef : null,
      plannedDurationSeconds: shot.plannedDurationSeconds ?? node.duration,
      ...(candidate ? { visualContract: candidate.visualContract, requestedDescription: candidate.visualContract.action.path || candidate.label } : {}) };
    const reviewedMaterialBindings = type === 'talking_head' && candidate ? (profile => profile?.rightsEvidenceRefs.filter(ref => profile.commercialUseApprovalEvidenceRefs.includes(ref)).slice(0,1).map(rightsEvidenceRef => ({ shotId:shot.shotId, assetId:candidate.assetId, segmentId:candidate.segmentId, sourceRef:candidate.sourceRef, sourceRevision:candidate.sourceRevision, rightsEvidenceRef })) || [])(normalizeLocalMaterialSegmentProfile(candidate.segmentProfile)) : [];
    const result = materialRoutingRequests({ ...input, shots: [request], candidates, reviewedMaterialBindings });
    if (selected && (result[0]?.selectedMaterialSegment?.segmentId !== selected.segmentId || result[0]?.selectedMaterialSegment?.sourceRef !== candidate?.sourceRef)) throw new SocialContentWorkflowError('guided_creation_selected_segment_not_admitted', 409);
    const hook = plan.selection.guided?.scene?.hook;
    if (input.shots.indexOf(shot) === 0 && hook?.usage === 'editable') {
      if (!candidate?.timeRange || candidate.assetId !== hook.materialId || candidate.timeRange.startSeconds > hook.startSeconds || candidate.timeRange.endSeconds < hook.endSeconds || !result[0]?.selectedMaterialSegment) throw new SocialContentWorkflowError('guided_creation_hook_range_unavailable', 409);
      result[0].selectedMaterialSegment = { ...result[0].selectedMaterialSegment, startSeconds: hook.startSeconds, endSeconds: hook.endSeconds };
    }
    return result;
  });
}

export function guidedProductIdentityGroups(plan: CreationReply, candidates: SocialWorkflowMaterialClipCandidate[], primary: { productRef: string; imageIds: string[] }) {
  return plan.selection.productIds.map(id => {
    const productRef = plan.products.find(row => row.id === id)?.name || id;
    const imageIds = [...new Set(candidates.filter(row => row.productId === id && row.mediaType === 'image' && row.materialRoles.includes('product')).map(row => row.assetId))].slice(0, 4);
    return { productRef, imageIds: imageIds.length ? imageIds : productRef === primary.productRef ? primary.imageIds : [] };
  }).filter(row => row.imageIds.length);
}
