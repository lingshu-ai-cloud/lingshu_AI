import type { CreationReply } from '../../shared/contracts/contentCreationDialogue.js';
import type { SocialAssetSupplyShotRequest } from '../../shared/socialContentAssetSupply.js';
import type { SocialWorkflowMaterialClipCandidate } from './socialContentMaterialCandidateSupport.js';
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
    const type = node.type === 'talking_head' && plan.selection.guided?.presenterMode === 'none' ? selected?.type || 'product' : node.type;
    const productId = candidate?.productId || plan.selection.productIds[input.shots.indexOf(shot) % plan.selection.productIds.length];
    const productRef = candidate?.productRef || plan.products.find(row => row.id === productId)?.name || null;
    const request: SocialAssetSupplyShotRequest = { ...shot, materialType: type, productRef: type === 'product' ? productRef : null,
      plannedDurationSeconds: shot.plannedDurationSeconds ?? node.duration,
      ...(candidate ? { visualContract: candidate.visualContract, requestedDescription: candidate.visualContract.action.path || candidate.label } : {}) };
    const result = materialRoutingRequests({ ...input, shots: [request], candidates });
    if (selected && (result[0]?.selectedMaterialSegment?.segmentId !== selected.segmentId || result[0]?.selectedMaterialSegment?.sourceRef !== candidate?.sourceRef)) throw new SocialContentWorkflowError('guided_creation_selected_segment_not_admitted', 409);
    return result;
  });
}

export function guidedProductIdentityGroups(plan: { selection: { productIds: string[] }; products: Array<{ id: string; name: string }> }, candidates: SocialWorkflowMaterialClipCandidate[], primary: { productRef: string; imageIds: string[] }) {
  return plan.selection.productIds.map(id => {
    const productRef = plan.products.find(row => row.id === id)?.name || id;
    const imageIds = [...new Set(candidates.filter(row => row.productId === id && row.mediaType === 'image' && row.materialRoles.includes('product')).map(row => row.assetId))].slice(0, 4);
    return { productRef, imageIds: imageIds.length ? imageIds : productRef === primary.productRef ? primary.imageIds : [] };
  }).filter(row => row.imageIds.length);
}
