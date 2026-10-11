import { classifySocialAssetSupplyMaterialType, type SocialAssetSupplyShotRequest } from '../../shared/socialContentAssetSupply.js';
import { normalizeSceneVisualContract, scoreSceneVisualCompatibility } from '../../shared/sceneVisualContract.js';
import type { SocialReferenceShotAnalysis } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialWorkflowMaterialClipCandidate } from './socialContentRecords.js';
import { socialRequestHash } from './socialContentValidation.js';

const actionRequirements = [
  /旋转|转圈|晃|摇|rotat|shake|wobbl/i,
  /滚动|滚落|roll|tumble/i,
  /输送|流水线|传送带|conveyor/i,
  /灌装|注液|fill|dispens/i,
  /手持|手握|hold|grip/i,
  /涂抹|上脸|apply|applying|rub/i,
];
const affirmative = (text: string) => text.split(/[；;。\n]/)
  .filter(clause => !/禁止|不得|不能|没有|未见|without|\b(?:no|not)\s/i.test(clause)).join('；');

/** Uses analyzed, tenant-scoped segments rather than treating inventory presence as a match. */
export function materialRoutingRequests(input: {
  policyVersion?: 'type-aware.v1';
  tenantId: string;
  shots: SocialAssetSupplyShotRequest[];
  candidates: SocialWorkflowMaterialClipCandidate[];
  referenceShots?: SocialReferenceShotAnalysis[];
  productRef: string | null;
}): SocialAssetSupplyShotRequest[] {
  if (input.policyVersion !== 'type-aware.v1') return input.shots;
  return input.shots.map(original => {
    const shot = { ...original, productRef: original.productRef ?? input.productRef };
    const materialType = classifySocialAssetSupplyMaterialType(shot, input.referenceShots);
    const reference = input.referenceShots?.find(item => item.shotId === shot.referenceShotId);
    const holdingProduct = materialType === 'product' && /手持|手握|拿|hold|grip/i.test(shot.requestedDescription ?? '');
    const expected = normalizeSceneVisualContract(shot.visualContract ?? reference?.visualContract ?? {
      subjects: materialType === 'product' ? holdingProduct ? ['person', 'product'] : ['product']
        : materialType === 'factory' ? ['factory'] : ['person', 'product'],
      interaction: { kind: materialType === 'factory' ? 'factory_process' : materialType === 'consumer_demo'
        ? 'person_using_product' : holdingProduct ? 'person_holding_product' : 'product_only_display',
        description: shot.requestedDescription ?? '' },
      action: { path: shot.requestedDescription ?? '' },
      productRef: materialType === 'product' ? shot.productRef : null,
      productPolicy: materialType === 'product' ? 'locked' : 'open',
    });
    const description = affirmative([shot.requestedDescription, expected.action.path,
      expected.interaction.description].filter(Boolean).join('；'));
    const required = actionRequirements.filter(pattern => pattern.test(description));
    const candidates = input.candidates.filter(candidate => {
      if (candidate.origin !== 'my_materials' || candidate.mediaType !== 'video' || !candidate.timeRange
        || candidate.timeRange.endSeconds - candidate.timeRange.startSeconds < 3) return false;
      if (materialType === 'talking_head' || materialType === 'unknown') return false;
      if (materialType === 'factory' && !candidate.materialRoles.includes('factory')) return false;
      if (materialType === 'consumer_demo' && !candidate.materialRoles.includes('person_usage')) return false;
      if (materialType === 'product' && (!shot.productRef || String(candidate.productRef ?? '').trim().toLocaleLowerCase()
        !== shot.productRef.trim().toLocaleLowerCase())) return false;
      const visual = candidate.visualContract;
      const observed = affirmative([visual.action.path, visual.interaction.description,
        ...visual.subjects.map(subject => subject.description)].join('；'));
      return required.every(pattern => pattern.test(observed)) && scoreSceneVisualCompatibility(expected, visual) >= 0.72;
    }).sort((a, b) => scoreSceneVisualCompatibility(expected, b.visualContract)
      - scoreSceneVisualCompatibility(expected, a.visualContract) || a.assetId.localeCompare(b.assetId));
    const match = candidates[0];
    if (!match?.timeRange) return { ...shot, materialType };
    const segment = { sourceRef: match.sourceRef, segmentId: match.segmentId,
      startSeconds: match.timeRange.startSeconds, endSeconds: match.timeRange.endSeconds };
    return { ...shot, materialType, selectedMaterialSegment: segment,
      localVideoMatch: { sourceRefs: [match.sourceRef], semanticMatch: 'verified' as const,
        productRef: match.productRef,
        evidenceRef: `material-visual-match:${input.tenantId}:${socialRequestHash({ shotId: shot.shotId, expected,
          sourceRef: match.sourceRef, segment, visual: match.visualContract })}` } };
  });
}
