import type { VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';

type TrendVideoEvidence = { id: string; aiAnalysis?: unknown };

export type ViralAnalysisCoverage = {
  ready: boolean;
  requiredCount: number;
  completedCount: number;
  validRecords: TrendVideoEvidence[];
  invalidReferenceIds: string[];
  blockedReason: string;
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
  const gemini = object(analysis.gemini);
  const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
  return analysis.analysisMode === 'exact'
    && ['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''))
    && details.length > 0
    && details.every(raw => {
      const shot = object(raw);
      const time = String(shot.time || shot.timestamp || '').trim();
      const visual = String(shot.visual || '').trim();
      return /\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—~至]\s*\d+(?:\.\d+)?/i.test(time) && Boolean(visual);
    });
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
    requiredCount === 0 ? '本周计划尚未形成可核验的复刻原创母版，不能提前完成对标分析节点' : '',
    missing ? `本周 ${requiredCount} 条复刻原创母版需要 ${requiredCount} 条独立且可解析的精确分析，当前仅完成 ${completedCount} 条，还缺 ${missing} 条` : '',
    invalidReferenceIds.length ? `指定参考尚无可解析精确分析：${invalidReferenceIds.join('、')}` : '',
  ].filter(Boolean);
  return {
    ready, requiredCount, completedCount, validRecords, invalidReferenceIds,
    blockedReason: ready ? '' : reasons.join('；') || '对标视频精确分析尚未覆盖本周复刻原创母版',
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

export function viralCoverageBypassAllowed(
  taskKey: string, action: string, coverageReady: boolean,
): boolean {
  return taskKey !== 'viral_analysis' || !['skip', 'manual_complete'].includes(action) || coverageReady;
}
