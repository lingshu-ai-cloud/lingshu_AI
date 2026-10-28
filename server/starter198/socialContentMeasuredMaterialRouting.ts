import type {SocialAssetSupplyPlan, SocialAssetSupplyShotPlan} from '../../shared/contracts/socialContentReplication.js';
import type {LocalMaterialSegmentRejection} from '../../shared/contracts/localMaterialSegmentProfile.js';
import type {SocialWorkflowMaterialClipCandidate} from './socialContentRecords.js';
import type {MeasuredSceneTime} from './socialContentMeasuredSceneTimeline.js';
import {themeMaterialRoutingRequests} from './socialContentThemeMaterialRouting.js';

type Segment = SocialAssetSupplyShotPlan['selectedMaterialSegment'];
export interface MeasuredMaterialPending {
  shotId: string;
  theme: NonNullable<SocialAssetSupplyShotPlan['materialRouting']>['materialType'];
  requiredSeconds: number;
  rejections: LocalMaterialSegmentRejection[];
  pendingReason: 'awaiting_theme_material';
}
export interface MeasuredMaterialChange {
  shotId: string;
  kind: 'retained' | 'trimmed' | 'extended' | 'rematched' | 'pending';
  previousSegment: Segment;
  selectedSegment: Segment;
}
export interface MeasuredMaterialRoutingResult {
  plan: SocialAssetSupplyPlan;
  pending: MeasuredMaterialPending[];
  changes: MeasuredMaterialChange[];
}

/** Pure projection over current inventory. It neither creates media nor changes
 * paid operation identities; the caller persists the result before rendering. */
export function reconcileMeasuredMaterialRouting(input: {
  tenantId: string;
  plan: SocialAssetSupplyPlan;
  timeline: MeasuredSceneTime[];
  candidates: SocialWorkflowMaterialClipCandidate[];
  requiredMaterials?: Record<string, string>;
  requiredMaterialRevisions?: Record<string, string>;
}): MeasuredMaterialRoutingResult {
  const plan = structuredClone(input.plan);
  const result: MeasuredMaterialRoutingResult = {plan, pending: [], changes: []};
  if (plan.materialRoutingPolicyVersion !== 'type-aware.v3') return result;
  if (!plan.shots.length || plan.shots.length !== input.timeline.length
    || new Set(plan.shots.map(shot => shot.shotId)).size !== plan.shots.length)
    throw Error('measured_material_timeline_changed');
  let end = 0;
  for (const [index, shot] of plan.shots.entries()) {
    const time = input.timeline[index]!;
    if (time.shotId !== shot.shotId || !Number.isFinite(time.start) || !Number.isFinite(time.end)
      || time.end <= time.start || Math.abs(time.start - end) > 1e-6)
      throw Error('measured_material_timeline_changed');
    end = time.end;
  }
  plan.shots = plan.shots.map((shot, index) => {
    const routing = shot.materialRouting;
    if (shot.sourceStrategy !== 'customer_real_asset' || !routing
      || routing.materialType === 'talking_head' || routing.materialType === 'unknown') return shot;
    const time = input.timeline[index]!;
    const requiredSeconds = time.end - time.start;
    const previousSegment = shot.selectedMaterialSegment;
    const request = {shotId: shot.shotId, function: shot.function,
      materialType: routing.materialType, plannedDurationSeconds: requiredSeconds};
    const match = (candidates: SocialWorkflowMaterialClipCandidate[]) => themeMaterialRoutingRequests({
      tenantId: input.tenantId, shots: [request], candidates, productRef: null,
    })[0]!;
    // Keep the existing source start only inside the currently analyzed range.
    // Reuse the same theme matcher for all rights, revision and tenant checks.
    const requiredMaterial = input.requiredMaterials?.[shot.shotId];
    const requiredRevision = input.requiredMaterialRevisions?.[shot.shotId];
    const eligibleCandidates = requiredMaterial ? input.candidates.filter(candidate => candidate.assetId === requiredMaterial
      && (!requiredRevision || candidate.sourceRevision === requiredRevision)) : input.candidates;
    const currentCandidates = previousSegment && Number.isFinite(previousSegment.startSeconds)
      ? eligibleCandidates.filter(candidate => candidate.sourceRef === previousSegment.sourceRef
        && candidate.segmentId === previousSegment.segmentId && candidate.timeRange
        && previousSegment.startSeconds >= candidate.timeRange.startSeconds
        && previousSegment.startSeconds + requiredSeconds <= candidate.timeRange.endSeconds + 1e-6)
        .map(candidate => ({...candidate, timeRange: {...candidate.timeRange!, startSeconds: previousSegment.startSeconds}}))
      : [];
    let selected = match(currentCandidates);
    const retainedSource = Boolean(selected.localVideoMatch && selected.selectedMaterialSegment);
    if (!retainedSource) selected = match(eligibleCandidates);
    const local = selected.localVideoMatch;
    const segment = selected.selectedMaterialSegment;
    if (!local || !segment) {
      const rejections = selected.localMaterialRejections ?? [];
      result.pending.push({shotId: shot.shotId, theme: routing.materialType,
        requiredSeconds, rejections, pendingReason: 'awaiting_theme_material'});
      result.changes.push({shotId: shot.shotId, kind: 'pending', previousSegment, selectedSegment: null});
      return {...shot, sourceRefs: [], selectedMaterialSegment: null,
        feasibility: 'goal_degraded', feasibilityReason: 'awaiting_theme_material',
        materialRouting: {...routing, pendingReason: 'awaiting_theme_material',
          localMatch: {state: 'missing', sourceRefs: [], evidenceRef: null, rejections}}};
    }
    const oldSeconds = previousSegment ? previousSegment.endSeconds - previousSegment.startSeconds : 0;
    const kind = !retainedSource ? 'rematched' : Math.abs(oldSeconds - requiredSeconds) <= 1e-6
      ? 'retained' : oldSeconds > requiredSeconds ? 'trimmed' : 'extended';
    result.changes.push({shotId: shot.shotId, kind, previousSegment, selectedSegment: segment});
    const {pendingReason: _pendingReason, ...matchedRouting} = routing;
    return {...shot, sourceRefs: [...local.sourceRefs], selectedMaterialSegment: segment,
      feasibility: 'full_fidelity', feasibilityReason: 'measured_theme_material_matched',
      materialRouting: {...matchedRouting, localMatch: {state: 'matched', sourceRefs: [...local.sourceRefs],
        evidenceRef: local.evidenceRef, productRef: local.productRef,
        sourceTier: local.sourceTier, reuseKind: local.reuseKind}}};
  });
  if (result.pending.length) {
    plan.overallFeasibility = 'goal_degraded';
    if (plan.status === 'ready') plan.status = 'goal_degraded';
  }
  return result;
}
