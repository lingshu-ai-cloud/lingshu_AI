import type { BenchmarkMaterialType } from '../../shared/benchmarkAnalysis.js';
import { classifySocialAssetSupplyMaterialType, type SocialAssetSupplyShotRequest } from '../../shared/socialContentAssetSupply.js';
import { normalizeLocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import type { LocalMaterialSegmentRejectionReason } from '../../shared/contracts/localMaterialSegmentProfile.js';
import type { materialRoutingRequests } from './socialContentMaterialRoutingRequests.js';
import { socialRequestHash } from './socialContentValidation.js';

/** The benchmark's observed label is authoritative; a description is not a label. */
export function themeMaterialType(shot: SocialAssetSupplyShotRequest,
  referenceShots?: Parameters<typeof materialRoutingRequests>[0]['referenceShots']): BenchmarkMaterialType {
  const reference = referenceShots?.find(row => row.shotId === shot.referenceShotId);
  if (reference) return reference.materialType ?? 'unknown';
  if (shot.materialType && shot.materialType !== 'unknown') return shot.materialType;
  // Non-reference creations retain the existing semantic classifier. A missing
  // reference identity or label on a benchmark task must never be inferred.
  if (!shot.referenceShotId && !referenceShots?.length && !shot.materialType)
    return classifySocialAssetSupplyMaterialType(shot);
  return 'unknown';
}

/** V3 changes semantic matching, while retaining tenant, source, rights and usable file evidence. */
export function themeMaterialRoutingRequests(input: Parameters<typeof materialRoutingRequests>[0]): SocialAssetSupplyShotRequest[] {
  const uses = new Map<string, number>();
  const windows = new Map<string, Array<{ startSeconds: number; endSeconds: number }>>();
  return input.shots.map(original => {
    const { localVideoMatch: _match, selectedMaterialSegment: _segment, fixedYieldArchetypeId: _archetype,
      materialReusePolicy: _reuse, localMaterialRejections: _rejections, ...shot } = original;
    const materialType = themeMaterialType(shot, input.referenceShots);
    if (materialType === 'talking_head' || materialType === 'unknown') return { ...shot, materialType };
    const reference = input.referenceShots?.find(row => row.shotId === shot.referenceShotId);
    const duration = shot.plannedDurationSeconds ?? (reference ? reference.endSeconds - reference.startSeconds : undefined);
    const usableWindow = (candidate: typeof input.candidates[number]) => {
      const range = candidate.timeRange;
      if (!range || !Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds)
        || range.startSeconds < 0 || range.endSeconds <= range.startSeconds) return null;
      const needed = duration ?? range.endSeconds - range.startSeconds;
      if (!Number.isFinite(needed) || needed <= 0) return null;
      let startSeconds = range.startSeconds;
      for (const used of [...(windows.get(candidate.assetId) ?? [])].sort((a, b) => a.startSeconds - b.startSeconds)) {
        if (used.endSeconds <= startSeconds) continue;
        if (startSeconds + needed <= used.startSeconds + 1e-6) break;
        startSeconds = Math.max(startSeconds, used.endSeconds);
      }
      if (startSeconds + needed <= range.endSeconds + 1e-6) return { startSeconds, endSeconds: startSeconds + needed };
      // Diversity is a preference, not a supply gate. Reuse a trusted source
      // window when it independently covers this slot; never extend its bytes.
      return range.startSeconds + needed <= range.endSeconds + 1e-6
        ? { startSeconds: range.startSeconds, endSeconds: range.startSeconds + needed } : null;
    };
    const rejected: NonNullable<SocialAssetSupplyShotRequest['localMaterialRejections']> = [];
    const candidates = input.candidates.filter(candidate => {
      const profile = normalizeLocalMaterialSegmentProfile(candidate.segmentProfile);
      const reasons: LocalMaterialSegmentRejectionReason[] = [];
      if (!profile) reasons.push('segment_profile_missing');
      else {
        // Archetype, product identity, action, framing and confidence scores are
        // not V3 topic requirements. Retain factual source/permission failures.
        reasons.push(...profile.rejectionReasons.filter(reason => ![
          'archetype_unclassified', 'analysis_confidence_low', 'human_review_required',
        ].includes(reason)));
        if (profile.tenantId !== input.tenantId || profile.assetId !== candidate.assetId
          || profile.segmentId !== candidate.segmentId) reasons.push('tenant_mismatch');
        if (profile.sourceRevision !== candidate.sourceRevision) reasons.push('source_revision_mismatch');
        if (profile.materialType !== materialType) reasons.push('material_type_mismatch');
      }
      if (candidate.origin !== 'my_materials') reasons.push('local_ownership_missing');
      if (candidate.synthetic) reasons.push('synthetic_source');
      if (candidate.mediaType !== 'video') reasons.push('non_video_source');
      if (!usableWindow(candidate)) reasons.push('duration_insufficient');
      if (reasons.length) rejected.push({ assetId: candidate.assetId, segmentId: candidate.segmentId,
        sourceRevision: candidate.sourceRevision ?? null, reasons: [...new Set(reasons)] });
      return !reasons.length;
    }).sort((a, b) => (uses.get(a.assetId) ?? 0) - (uses.get(b.assetId) ?? 0)
      || b.matchScore - a.matchScore || a.assetId.localeCompare(b.assetId));
    const match = candidates[0];
    if (!match) return { ...shot, materialType, localMaterialRejections: rejected.slice(0, 20) };
    const range = usableWindow(match)!;
    uses.set(match.assetId, (uses.get(match.assetId) ?? 0) + 1);
    windows.set(match.assetId, [...(windows.get(match.assetId) ?? []), range]);
    const segment = { sourceRef: match.sourceRef, segmentId: match.segmentId, ...range,
      ...(match.footageEvidence ? { footageEvidence: structuredClone(match.footageEvidence) } : {}) };
    return { ...shot, materialType, selectedMaterialSegment: segment,
      localVideoMatch: { sourceRefs: [match.sourceRef], semanticMatch: 'verified', reuseKind: 'direct_cut',
        sourceTier: materialType === 'product' ? 'product_local' : materialType === 'factory' ? 'factory_local' : 'other_local',
        productRef: match.productRef,
        evidenceRef: `material-theme-match:${input.tenantId}:${socialRequestHash({ shotId: shot.shotId, materialType,
          segment, profile: match.segmentProfile })}` } };
  });
}
