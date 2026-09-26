import type { PerformanceEvaluation, ReviewContentAggregate } from '../../shared/contracts/socialReview.js';

const metricValue = (content: ReviewContentAggregate, key: 'views' | 'comments' | 'shares' | 'saves') => content.metrics[key]?.availability === 'available' ? content.metrics[key]!.value : null;

export class PerformanceEvaluator {
  evaluate(content: ReviewContentAggregate, minimumOwnedContent = 2): PerformanceEvaluation {
    const evidenceRefs = [...new Set([...(content.publicationReceiptRefs || []), ...content.metricSnapshotRefs])];
    const reasons: string[] = [];
    const boundaries: string[] = [];
    if (content.evidenceKind !== 'owned_content_result') reasons.push('external_reference_is_not_customer_performance');
    if (content.attributionStatus !== 'attributed') reasons.push(content.attributionStatus === 'unavailable' ? 'attribution_unavailable' : 'attribution_unknown');
    if (content.confounders?.length) reasons.push('confounding_variables_present');
    if (!(content.publicationReceiptRefs || []).length) reasons.push('publication_receipt_missing');
    const views = metricValue(content, 'views');
    const baselineViews = content.baseline?.views;
    if (views === null) reasons.push('performance_metric_unavailable');
    if (typeof baselineViews !== 'number' || baselineViews <= 0) reasons.push('relative_baseline_missing');
    const attributable = content.evidenceKind === 'owned_content_result' && content.attributionStatus === 'attributed' && Boolean(content.publicationReceiptRefs?.length);
    const sufficient = attributable && !content.confounders?.length && evidenceRefs.length >= minimumOwnedContent && views !== null && typeof baselineViews === 'number' && baselineViews > 0;
    const score = sufficient ? views! / baselineViews! : null;
    if (!sufficient) boundaries.push('No promotion: customer result evidence is insufficient or cannot be attributed.');
    const action = !sufficient ? 'observe' : score! >= 1.5 ? 'scale' : score! >= 0.9 ? 'retest' : 'observe';
    reasons.push(action === 'scale' ? 'owned_result_exceeds_relative_baseline' : action === 'retest' ? 'owned_result_near_relative_baseline' : 'owned_result_not_ready_to_expand');
    return { contentId: content.contentId, action, score, attributable, sufficient, evidenceRefs, boundaries, reasons };
  }
}
