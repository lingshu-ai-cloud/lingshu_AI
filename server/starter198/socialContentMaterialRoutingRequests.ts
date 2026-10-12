import { classifySocialAssetSupplyMaterialType, type SocialAssetSupplyShotRequest } from '../../shared/socialContentAssetSupply.js';
import { normalizeSceneVisualContract, scoreSceneVisualCompatibility, type SocialSceneVisualContract } from '../../shared/sceneVisualContract.js';
import type { SocialReferenceShotAnalysis } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialWorkflowMaterialClipCandidate } from './socialContentRecords.js';
import { socialRequestHash } from './socialContentValidation.js';

const actionRequirements = [
  // Camera wording such as "横向摇移" is not a required subject action.
  /旋转|转圈|晃一圈|晃动|摇动|摇晃|rotat|shake|wobbl/i,
  /滚动|滚落|roll|tumble/i,
  /输送|流水线|传送带|conveyor/i,
  /灌装|注液|fill|dispens/i,
  /手持|手握|hold|grip/i,
  /涂抹|上脸|apply|applying|rub/i,
];
const affirmative = (text: string) => (text.split(/须避免[:：]?|负面提示[:：]?|negative\s*prompt[:：]?|\bavoid[:：]?/i, 1)[0] ?? '').split(/[；;。，,\n]/)
  .filter(clause => !/禁止|不得|不能|没有|未见|不添加|不出现|without|\b(?:no|not)\s/i.test(clause)).join('；');

function consumerSemanticScore(expected: SocialSceneVisualContract, candidate: SocialWorkflowMaterialClipCandidate): number {
  if (candidate.productId || candidate.productRef) return scoreSceneVisualCompatibility(expected, candidate.visualContract);
  // Candidate construction projects the task's authoritative product identity
  // into every visual contract. For a genuinely product-unbound usage clip,
  // that projection is planning context rather than observed package evidence.
  // Neutralize it only for semantic scoring; a candidate with any observed
  // product identity continues through the strict product-compatibility path.
  const withoutProductIdentity = (contract: SocialSceneVisualContract): SocialSceneVisualContract => normalizeSceneVisualContract({
    ...contract,
    productUsage: { ...contract.productUsage, productId: null, productRef: null },
    product: { policy: 'open', requestedProductId: null, requestedProductRef: null, source: 'inventory_open' },
  });
  return scoreSceneVisualCompatibility(withoutProductIdentity(expected), withoutProductIdentity(candidate.visualContract));
}

/** Uses analyzed, tenant-scoped segments rather than treating inventory presence as a match. */
export function materialRoutingRequests(input: {
  policyVersion?: 'type-aware.v1';
  tenantId: string;
  shots: SocialAssetSupplyShotRequest[];
  candidates: SocialWorkflowMaterialClipCandidate[];
  referenceShots?: SocialReferenceShotAnalysis[];
  productRef: string | null;
  /** False only after task-level budget allocation reserves presenter cost and
   * determines that this product shot cannot afford packaging-first-frame I2V. */
  productGenerationAllowed?: boolean;
}): SocialAssetSupplyShotRequest[] {
  if (input.policyVersion !== 'type-aware.v1') return input.shots;
  return input.shots.map(original => {
    // Re-evaluate evidence against this inventory; a prior plan's proof is not current evidence.
    const { localVideoMatch: _priorMatch, selectedMaterialSegment: _priorSegment, ...current } = original;
    const shot = { ...current, productRef: original.productRef ?? input.productRef };
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
    // Preserve the planned contract used to match the source. The Director
    // otherwise has no subjects for non-reference baselines and cannot review
    // the same match against the actual material contract.
    const plannedShot = ['product', 'factory', 'consumer_demo'].includes(materialType)
      ? { ...shot, visualContract: expected } : shot;
    const required = actionRequirements.filter(pattern => pattern.test(description));
    const evidenceDuration = expected.evidence.sourceRange
      ? expected.evidence.sourceRange.endSeconds - expected.evidence.sourceRange.startSeconds : NaN;
    // A local clip only has to cover this edit slot. Requiring every analyzed
    // source segment to be three seconds discarded exact 0.5–1 second reference
    // beats even when the owned segment was substantially longer than the slot.
    const requiredDuration = Number.isFinite(shot.plannedDurationSeconds) && Number(shot.plannedDurationSeconds) > 0
      ? Number(shot.plannedDurationSeconds)
      : Number.isFinite(evidenceDuration) && evidenceDuration > 0 ? evidenceDuration : 3;
    const candidates = input.candidates.filter(candidate => {
      if (candidate.synthetic || candidate.origin !== 'my_materials' || candidate.mediaType !== 'video' || !candidate.timeRange
        || candidate.timeRange.endSeconds - candidate.timeRange.startSeconds + 0.001 < requiredDuration) return false;
      if (materialType === 'talking_head' || materialType === 'unknown') return false;
      if (materialType === 'factory' && !candidate.materialRoles.includes('factory')) return false;
      if (materialType === 'consumer_demo' && (!candidate.materialRoles.includes('person_usage')
        || candidate.materialRoles.includes('factory') || candidate.materialRoles.includes('presenter'))) return false;
      if (materialType === 'consumer_demo' && (candidate.productId || candidate.productRef) && shot.productRef) {
        const identity = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/^product:/, '');
        if (![candidate.productId, candidate.productRef].map(identity).filter(Boolean).includes(identity(shot.productRef))) return false;
      }
      if (materialType === 'product' && (!shot.productRef || String(candidate.productRef ?? '').trim().toLocaleLowerCase()
        !== shot.productRef.trim().toLocaleLowerCase())) return false;
      const visual = candidate.visualContract;
      const observed = affirmative([visual.action.path, visual.interaction.description,
        ...visual.subjects.map(subject => subject.description)].join('；'));
      const visualScore = materialType === 'consumer_demo' ? consumerSemanticScore(expected, candidate)
        : scoreSceneVisualCompatibility(expected, visual);
      // Factory footage is selected by its analyzed factory role and observed
      // process action. Cosmetic differences from the reference must not erase
      // a real tenant-owned filling, conveyor or inspection candidate.
      const minimumVisualScore = materialType === 'factory' ? (required.length ? 0.4 : 0.6)
        // Consumer b-roll preserves the real hand/person-use function while the
        // reference's set dressing may differ. The role exclusions above keep
        // factory and presenter footage out of this bounded fallback.
        : materialType === 'consumer_demo' ? 0.6 : 0.72;
      return required.every(pattern => pattern.test(observed)) && visualScore >= minimumVisualScore;
    }).sort((a, b) => (materialType === 'consumer_demo' ? consumerSemanticScore(expected, b) - consumerSemanticScore(expected, a)
      : scoreSceneVisualCompatibility(expected, b.visualContract) - scoreSceneVisualCompatibility(expected, a.visualContract))
      || a.assetId.localeCompare(b.assetId));
    let match = candidates[0];
    let sourceTier: NonNullable<NonNullable<SocialAssetSupplyShotRequest['localVideoMatch']>['sourceTier']> | undefined
      = materialType === 'product' && match ? 'product_high_fidelity_local' : undefined;
    if (materialType === 'product' && !match && input.productGenerationAllowed === false) {
      const identity = (value: unknown) => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/^product:/, '');
      const executable = input.candidates.filter(candidate => candidate.origin === 'my_materials'
        && candidate.mediaType === 'video' && !candidate.synthetic && candidate.timeRange
        && candidate.timeRange.endSeconds - candidate.timeRange.startSeconds + 0.001 >= requiredDuration);
      const tiered = executable.map(candidate => {
        const exactProduct = Boolean(shot.productRef && [candidate.productId, candidate.productRef]
          .map(identity).filter(Boolean).includes(identity(shot.productRef)));
        const tier = exactProduct && candidate.materialRoles.includes('product') ? 3
          : candidate.materialRoles.includes('factory') ? 4 : 5;
        return { candidate, tier, score: scoreSceneVisualCompatibility(expected, candidate.visualContract) };
      }).sort((a, b) => a.tier - b.tier || b.score - a.score || a.candidate.assetId.localeCompare(b.candidate.assetId));
      match = tiered[0]?.candidate;
      sourceTier = tiered[0]?.tier === 3 ? 'product_local' : tiered[0]?.tier === 4 ? 'factory_local'
        : tiered[0] ? 'other_local' : undefined;
    }
    if (!match?.timeRange) return { ...plannedShot, materialType };
    const segment = { sourceRef: match.sourceRef, segmentId: match.segmentId,
      startSeconds: match.timeRange.startSeconds, endSeconds: match.timeRange.endSeconds };
    return { ...plannedShot, materialType, selectedMaterialSegment: segment,
      localVideoMatch: { sourceRefs: [match.sourceRef], semanticMatch: 'verified' as const,
        ...(sourceTier ? { sourceTier } : {}),
        productRef: match.productRef,
        evidenceRef: `material-visual-match:${input.tenantId}:${socialRequestHash({ shotId: shot.shotId, expected,
          sourceRef: match.sourceRef, segment, visual: match.visualContract })}` } };
  });
}
