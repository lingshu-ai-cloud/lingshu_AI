import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import { buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { productionReferenceAdmission } from '../../shared/productionReferenceAdmission.js';

type TrendVideoEvidence = {
  id: string;
  aiAnalysis?: unknown;
  duration?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
};

export type ViralAnalysisCoverage = {
  ready: boolean;
  requiredCount: number;
  completedCount: number;
  validRecords: TrendVideoEvidence[];
  invalidReferenceIds: string[];
  blockedReason: string;
};

type ContentBatchEvidence = {
  run_id?: unknown;
  orders?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * A record is usable by the Content Agent only when it contains a completed,
 * parseable shot timeline. A truthy `gemini` envelope alone is not production
 * evidence and must never advance the weekly workflow.
 */
export function hasParseableExactVideoAnalysis(record: TrendVideoEvidence): boolean {
  const analysis = object(record.aiAnalysis);
  const duration = Number(record.duration);
  const evidenceRevision = String(record.updatedAt || record.updated_at || analysis.analysisRunId || `analysis:${record.id}`).trim();
  const normalized = buildBenchmarkAnalysis({
    analysis,
    videoId: record.id,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    evidenceRevision,
  });
  return productionReferenceAdmission(normalized).ready;
}

function cloneMasters(plans: VideoCreationPlan[]): VideoCreationPlan[] {
  const masters = plans.filter(plan => plan.route === 'clone' && plan.productionRole !== 'platform_adaptation');
  const seen = new Set<string>();
  return masters.filter((plan, index) => {
    const family = String(plan.contentFamilyId || plan.masterContentId || plan.contentId || `master-${index}`);
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  });
}

export function evaluateViralAnalysisCoverage(
  plans: VideoCreationPlan[],
  candidateRecords: TrendVideoEvidence[],
  options: { explicitReferenceIds?: Iterable<string> } = {},
): ViralAnalysisCoverage {
  const masters = cloneMasters(plans);
  const requiredCount = masters.length;
  const recordsById = new Map(candidateRecords.map(record => [record.id, record]));
  const validRecords = [...new Map(candidateRecords.filter(hasParseableExactVideoAnalysis).map(record => [record.id, record])).values()];
  const planReferenceIds = masters.map(plan => String(plan.referenceId || '').trim()).filter(Boolean);
  const explicitIds = [...new Set(options.explicitReferenceIds === undefined ? planReferenceIds : [...options.explicitReferenceIds])];
  const invalidReferenceIds = explicitIds.filter(id => !recordsById.has(id) || !hasParseableExactVideoAnalysis(recordsById.get(id)!));
  const completedCount = validRecords.length;
  const ready = requiredCount > 0 && invalidReferenceIds.length === 0 && completedCount >= requiredCount;
  const missing = Math.max(0, requiredCount - completedCount);
  const reasons = [
    requiredCount === 0 ? '本周计划尚未形成可核验的复刻独立制作视频，不能提前完成对标分析节点' : '',
    missing ? `本周 ${requiredCount} 条复刻独立制作视频需要 ${requiredCount} 条独立且可解析的精确分析，当前仅完成 ${completedCount} 条，还缺 ${missing} 条` : '',
    invalidReferenceIds.length ? `指定参考尚无可解析精确分析：${invalidReferenceIds.join('、')}` : '',
  ].filter(Boolean);
  return {
    ready, requiredCount, completedCount, validRecords, invalidReferenceIds,
    blockedReason: ready ? '' : reasons.join('；') || '对标视频精确分析尚未覆盖本周复刻独立制作视频',
  };
}

/**
 * References inserted by automatic matrix recommendation are discovery hints,
 * not user authority to reuse evidence from an older workflow run. A direct
 * reference without an automatic provenance marker remains reusable for the
 * explicit-reference workflow.
 */
export function reusableExplicitReferenceIds(plans: VideoCreationPlan[]): string[] {
  return [...new Set(plans.flatMap(plan => {
    if (plan.route !== 'clone' || !plan.referenceId) return [];
    const generatedFrom = String(plan.planningEvidence?.generatedFrom || '').trim();
    // `planningEvidence.generatedFrom` is a typed automatic-matrix provenance
    // marker. Treat every present value as automatic so newly added matrix
    // variants cannot accidentally gain cross-run reuse authority.
    return generatedFrom ? [] : [plan.referenceId];
  }))];
}

export function canSkipCollectionForExplicitReferences(
  plans: VideoCreationPlan[], records: TrendVideoEvidence[],
): boolean {
  const clonePlans = plans.filter(plan => plan.route === 'clone');
  if (!clonePlans.length || plans.some(plan => plan.route !== 'clone')) return false;
  const explicitIds = new Set(reusableExplicitReferenceIds(plans));
  const byId = new Map(records.map(record => [record.id, record]));
  return clonePlans.every(plan => Boolean(plan.referenceId)
    && explicitIds.has(plan.referenceId)
    && Boolean(byId.get(plan.referenceId))
    && hasParseableExactVideoAnalysis(byId.get(plan.referenceId)!));
}

/** References become "used" only after they entered a persisted production
 * handoff. Merely previewing or recommending a reference in a draft does not
 * consume it. The active run is excluded so reconciliation stays idempotent. */
export function usedViralReferenceIdsFromBatches(
  batches: ContentBatchEvidence[], excludeRunId = '',
): string[] {
  const ids = batches.flatMap(batch => {
    if (excludeRunId && String(batch.run_id || '').trim() === excludeRunId) return [];
    const orders = Array.isArray(batch.orders) ? batch.orders : (() => {
      try { return typeof batch.orders === 'string' ? JSON.parse(batch.orders) : []; }
      catch { return []; }
    })();
    return Array.isArray(orders) ? orders.flatMap(value => {
      const order = object(value);
      const videoPlan = object(order.videoPlan);
      const variants = Array.isArray(order.deliveryVariants) ? order.deliveryVariants.map(object) : [];
      const evidenceRefs = Array.isArray(order.evidenceRefs) ? order.evidenceRefs.map(object) : [];
      return [
        String(order.referenceId || '').trim(),
        ...[videoPlan, ...variants].map(item => String(item.referenceId || '').trim()),
        ...evidenceRefs.filter(ref => ref.type === 'exact_analysis').map(ref => String(ref.id || '').trim()),
      ].filter(Boolean);
    }) : [];
  });
  return [...new Set(ids)];
}

export type PlannedReferenceReuse = {
  ready: boolean;
  requiredCount: number;
  reusableCount: number;
  selectedReferenceIds: string[];
  missingCount: number;
};

/** A frozen weekly plan may reuse already analyzed library material when every
 * clone master has its own usable reference. User-explicit references may be
 * reused intentionally; automatic recommendations must be unused. */
export function evaluatePlannedReferenceReuse(
  plans: VideoCreationPlan[], records: TrendVideoEvidence[], usedReferenceIds: Iterable<string>,
): PlannedReferenceReuse {
  const masters = cloneMasters(plans);
  const explicit = new Set(reusableExplicitReferenceIds(plans));
  const used = new Set(usedReferenceIds);
  const byId = new Map(records.map(record => [record.id, record]));
  const selectedReferenceIds = masters.map(plan => String(plan.referenceId || '').trim()).filter(Boolean);
  const reusable = selectedReferenceIds.filter((id, index) => selectedReferenceIds.indexOf(id) === index
    && Boolean(byId.get(id))
    && hasParseableExactVideoAnalysis(byId.get(id)!)
    && (explicit.has(id) || !used.has(id)));
  const ready = masters.length > 0
    && selectedReferenceIds.length === masters.length
    && new Set(selectedReferenceIds).size === masters.length
    && reusable.length === masters.length;
  return {
    ready,
    requiredCount: masters.length,
    reusableCount: reusable.length,
    selectedReferenceIds: ready ? selectedReferenceIds : reusable,
    missingCount: Math.max(0, masters.length - reusable.length),
  };
}

export function viralCoverageBypassAllowed(
  taskKey: string, action: string, coverageReady: boolean,
): boolean {
  return taskKey !== 'viral_analysis' || !['skip', 'manual_complete'].includes(action) || coverageReady;
}
