import { createHash } from 'node:crypto';
import type { FrozenWeeklyReview, VersionedQuotaReference, WeeklyPromotionDecision } from '../../shared/contracts/socialReview.js';
import { PerformanceEvaluator } from './performanceEvaluator.js';

export class PromotionAllocator {
  constructor(private evaluator = new PerformanceEvaluator()) {}

  allocate(snapshot: FrozenWeeklyReview, previous?: VersionedQuotaReference): { decisions: WeeklyPromotionDecision[]; quota: VersionedQuotaReference } {
    const decisions = snapshot.contents.filter(item => item.evidenceKind === 'owned_content_result').map(content => {
      const evaluation = this.evaluator.evaluate(content);
      const decisionId = `pd_${createHash('sha256').update(`${snapshot.snapshotId}\0${content.publicationTaskId || content.contentId}\0${content.accountId}`).digest('hex').slice(0, 20)}`;
      const sampleBlocked = snapshot.sampleSufficiency.status !== 'sufficient';
      return { decisionId, snapshotId: snapshot.snapshotId, contentId: content.contentId, ...(content.publicationTaskId ? { publicationTaskId: content.publicationTaskId } : {}), action: sampleBlocked ? 'observe' : evaluation.action, evidenceRefs: evaluation.evidenceRefs, reasons: sampleBlocked ? [...evaluation.reasons, 'weekly_sample_insufficient'] : evaluation.reasons, boundaries: sampleBlocked ? [...evaluation.boundaries, 'Weekly sample sufficiency gate prevents promotion.'] : evaluation.boundaries } satisfies WeeklyPromotionDecision;
    });
    const allocations = decisions.filter(decision => decision.action !== 'observe').map(decision => {
      const content = snapshot.contents.find(item => item.contentId === decision.contentId
        && (!decision.publicationTaskId || item.publicationTaskId === decision.publicationTaskId))!;
      return { businessDirection: content.businessDirection, accountId: content.accountId, action: decision.action as 'scale' | 'retest', contentCount: decision.action === 'scale' ? 2 : 1, sourceDecisionIds: [decision.decisionId] };
    });
    const version = (previous?.version || 0) + 1;
    const quotaId = previous?.quotaId || `quota_${createHash('sha256').update(`${snapshot.tenantId}\0${snapshot.weekRef}`).digest('hex').slice(0, 20)}`;
    return { decisions, quota: { quotaId, version, sourceSnapshotId: snapshot.snapshotId, ...(snapshot.programId ? { programId: snapshot.programId } : {}), ...(previous ? { previousQuotaRef: `${previous.quotaId}:v${previous.version}` } : {}), allocations, stopConditions: ['attribution_lost', 'metric_source_unavailable', 'maintenance_capacity_exceeded'] } };
  }
}
