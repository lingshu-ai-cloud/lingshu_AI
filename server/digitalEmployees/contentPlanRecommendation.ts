import { normalizeVideoPlan, type VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from './domain.js';
import { buildWeeklyOperatingContext } from './weeklyPackage.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { buildBenchmarkAnalysis, type BenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { includedAdaptationCostRange, masterVideoCostRange, MASTER_VIDEO_COST_POINT_CNY } from '../../shared/contracts/contentCostModel.js';
import { isDiscoveryVideoEligible } from '../../shared/contracts/discoveryVideoPolicy.js';

type EvidenceRecord = { id: string; [key: string]: unknown };
type BenchmarkAccount = {
  id: string;
  platform?: string;
  accountUrl?: string;
  accountName?: string;
  handle?: string;
};

export interface RankedContentReference {
  id: string;
  platform: VideoCreationPlan['platform'];
  title: string;
  views: string;
  thumbnailUrl: string;
  sourceUrl: string;
  theme: string;
  hook: string;
  evidenceRequirement: string;
  benchmarkAccount: string;
  exact: boolean;
  score: number;
  factors: string[];
  analysis: BenchmarkAnalysis;
}

const text = (value: unknown, limit = 500) => String(value ?? '').trim().slice(0, limit);
const contentAngles = ['买家决策问题', '产品实测演示', '工艺与过程证据', '选型避坑', '使用场景验证'] as const;
const record = (value: unknown): Record<string, any> => {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
};

/** Compatibility helper for callers that need a point estimate. Weekly
 * planning uses a blended per-master cost, while settlement remains receipt based. */
export function estimateHighestTierVideoCostCny(duration: number): number {
  void duration;
  return MASTER_VIDEO_COST_POINT_CNY;
}

function tokens(...values: unknown[]): string[] {
  return [...new Set(values.flatMap(value => text(value, 1_000).toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter(value => value.length >= 2))];
}

function numericViews(value: unknown): number {
  const raw = text(value, 80).toLowerCase().replace(/,/g, '');
  const match = raw.match(/([\d.]+)\s*([kmb万亿])?/i);
  if (!match) return 0;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : match[2] === '万' ? 10_000 : match[2] === '亿' ? 100_000_000 : 1;
  return Number(match[1] || 0) * multiplier;
}

function previewUrl(...values: unknown[]): string {
  const candidate = values.map(value => text(value, 2_000)).find(value => /^(?:https?:\/\/|\/api\/|\/media\/|\/covers\/|\/generated\/)/i.test(value));
  return candidate || '';
}

export function publicationCopyForPlan(input: {
  plan: VideoCreationPlan;
  reference?: RankedContentReference;
  productName: string;
  theme: string;
}): NonNullable<VideoCreationPlan['publication']> {
  const productName = text(input.productName || input.plan.productName || '本周主推产品', 80);
  const subject = text(input.reference?.hook || input.theme || input.plan.theme || '买家最关心的问题', 160);
  const title = text(`${productName}｜${subject}`, 300);
  const caption = text(`${subject}。本条视频将结合 ${productName} 的真实产品画面与可核验信息，帮助目标买家快速判断是否匹配需求。${input.plan.matrix?.cta ? ` ${input.plan.matrix.cta}` : ''}`, 2_000);
  const normalizedProduct = productName.replace(/[^\p{L}\p{N}]+/gu, '');
  return {
    title,
    caption,
    tags: [...new Set([normalizedProduct, input.plan.platform, 'B2B', '产品实拍', '采购决策'].filter(Boolean))].slice(0, 8),
    status: 'planned',
    generatedBy: 'business_agent',
  };
}

/** Backend authority for product defaults: a blank selector can never silently
 * produce a plan with no product. Focus-product ordering is already reflected
 * by the evidence loader, so the first item is the deterministic default. */
export function bindDefaultProductsToPackage(
  pack: WeeklyPackage,
  products: Array<{ id: string; name: string; materialIds: string[] }>,
): WeeklyPackage {
  const fallback = products[0];
  return {
    ...pack,
    tasks: pack.tasks.map(task => task.templateId !== 'production' ? task : {
      ...task,
      videoPlans: (task.videoPlans || []).map(source => {
        const current = normalizeVideoPlan(source);
        const selected = products.find(product => product.name === current.productName || product.id === current.productName) || fallback;
        return normalizeVideoPlan({
          ...current,
          productId: selected?.id || '',
          productName: selected?.name || '',
          materialIds: selected?.materialIds || [],
        });
      }),
    }),
  };
}

function benchmarkFor(video: EvidenceRecord, accounts: BenchmarkAccount[]): BenchmarkAccount | undefined {
  const analysis = record(video.aiAnalysis);
  const source = [analysis.sourceAccount, analysis.sourceAccountName, analysis.author, video.author]
    .map(value => text(value, 500).toLowerCase())
    .filter(Boolean);
  return accounts.find(account => {
    if (account.platform && account.platform !== video.platform) return false;
    return [account.accountUrl, account.accountName, account.handle]
      .map(value => text(value, 500).toLowerCase())
      .filter(Boolean)
      .some(identity => source.some(item => item === identity || item.includes(identity) || identity.includes(item)));
  });
}

export function rankContentReferences(input: {
  videos: EvidenceRecord[];
  benchmarks: BenchmarkAccount[];
  platform: VideoCreationPlan['platform'];
  productName: string;
  audience: string;
  direction: string;
}): RankedContentReference[] {
  const desiredTokens = tokens(input.productName, input.audience, input.direction);
  return input.videos.flatMap(video => {
    const platform = text(video.platform) as VideoCreationPlan['platform'];
    if (!['facebook', 'instagram', 'tiktok', 'youtube'].includes(platform)) return [];
    const sourceUrl = previewUrl(video.sourceUrl, video.videoUrl, video.url);
    if (!isDiscoveryVideoEligible({ platform, duration: Number(video.duration || 0), sourceUrl })) return [];
    const analysis = record(video.aiAnalysis);
    const gemini = record(analysis.gemini);
    const candidate = record(analysis.candidateEvidence);
    const relevance = text(record(candidate.relevance).level);
    const transferability = text(record(candidate.transferability).level);
    const momentum = text(record(candidate.momentum).level);
    const exactReviewRequired = analysis.analysisMode === 'exact' && analysis.analysisQuality === 'video_review_required';
    const exact = analysis.analysisMode === 'exact'
      && ['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''))
      && Object.keys(gemini).length > 0;
    const benchmarkAnalysis = buildBenchmarkAnalysis({
      analysis,
      videoId: video.id,
      duration: Number(video.duration || 0),
      evidenceRevision: text(video.updatedAt || video.updated_at || analysis.evidenceRevision || analysis.analysisRunId || `analysis:${video.id}`, 160),
    });
    const benchmark = benchmarkFor(video, input.benchmarks);
    const publicBaseline = record(analysis.publicBaseline);
    const relativeMultiple = Number(analysis.relativeViewMultiple || publicBaseline.relativeMultiple || 0);
    const title = text(video.title || analysis.caption || video.id);
    const theme = text(gemini.theme || title);
    const hooks = Array.isArray(gemini.hooks) ? gemini.hooks.map((item: unknown) => text(item)).filter(Boolean) : [];
    const sellingPoints = Array.isArray(gemini.sellingPoints) ? gemini.sellingPoints.map((item: unknown) => text(item)).filter(Boolean) : [];
    const haystack = new Set(tokens(title, theme, analysis.caption, hooks.join(' '), sellingPoints.join(' ')));
    const overlap = desiredTokens.filter(item => haystack.has(item)).length;
    const factors: string[] = [];
    let score = 0;
    if (platform === input.platform) { score += 24; factors.push('同平台'); }
    if (exact) { score += 28; factors.push('全片精确分析'); }
    if (exactReviewRequired) factors.push('精确分析已完成，发布前需轻量复核');
    if (benchmark) { score += 18; factors.push(`来自对标账号 ${text(benchmark.accountName || benchmark.handle || benchmark.accountUrl, 80)}`); }
    if (relevance === 'high') { score += 10; factors.push('业务相关性高'); }
    else if (relevance === 'medium') score += 5;
    if (transferability === 'high') { score += 9; factors.push('结构可迁移'); }
    else if (transferability === 'medium') score += 4;
    if (['rising', 'high_performance'].includes(momentum)) { score += 5; factors.push('热度信号有效'); }
    if (relativeMultiple > 0) { score += Math.min(8, relativeMultiple * 2); factors.push(`账号基线 ${relativeMultiple.toFixed(1)}×`); }
    if (overlap) { score += Math.min(8, overlap * 2); factors.push('产品/受众语义匹配'); }
    const views = text(video.views || analysis.views || record(analysis.publicMetrics).plays, 80);
    if (numericViews(views) >= 10_000) { score += 4; factors.push('公开热度较高'); }
    return [{
      id: video.id,
      platform,
      title,
      views,
      thumbnailUrl: previewUrl(video.thumbnailUrl, video.coverUrl, video.thumbnail, analysis.thumbnailUrl, analysis.coverUrl),
      sourceUrl: previewUrl(sourceUrl, analysis.sourceUrl, analysis.videoUrl),
      theme,
      hook: hooks[0] || theme,
      evidenceRequirement: sellingPoints[0] ? `用企业资料核验并呈现：${sellingPoints[0]}` : '必须使用企业资料或素材库中的可核验事实与画面',
      benchmarkAccount: benchmark ? text(benchmark.accountName || benchmark.handle || benchmark.accountUrl, 300) : text(analysis.sourceAccountName || analysis.author, 300),
      exact,
      score: Math.max(0, Math.min(100, Math.round(score))),
      factors: [...new Set(factors)].slice(0, 8),
      analysis: benchmarkAnalysis,
    }];
  }).sort((left, right) => right.score - left.score || numericViews(right.views) - numericViews(left.views) || left.id.localeCompare(right.id));
}

/**
 * Spread one account's own publishing slots across the whole operating week.
 * Every account starts from the same weekly axis, so several accounts can run
 * in parallel instead of one account exhausting all of its posts first.
 */
export function publishDateForAccountSlot(startsAt: string, endsAt: string, slotIndex: number, accountTotal: number): string {
  const start = Date.parse(`${startsAt}T00:00:00Z`);
  const end = Date.parse(`${endsAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const days = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  const total = Math.max(1, Math.floor(accountTotal) || 1);
  const index = Math.max(0, Math.min(total - 1, Math.floor(slotIndex) || 0));
  const offset = total === 1
    ? Math.floor((days - 1) / 2)
    : Math.round(index * (days - 1) / (total - 1));
  return new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Enriches the deterministic matrix quota with tenant evidence. It never
 * invents a reference: each weekly original is paired one-to-one with a
 * persisted exact viral-video analysis. Platform adaptations inherit that
 * reference and structure. A shortage remains visible as a blocker.
 */
export function enrichPackageWithContentSignals(input: {
  pack: WeeklyPackage;
  goal: WeeklyGoalInput;
  config: DigitalEmployeeConfig;
  videos: EvidenceRecord[];
  benchmarks: BenchmarkAccount[];
}): WeeklyPackage {
  const production = input.pack.tasks.find(task => task.templateId === 'production');
  if (!production?.videoPlans?.length) return input.pack;
  const normalized = production.videoPlans.map(normalizeVideoPlan);
  const groups = new Map<string, Array<{ plan: VideoCreationPlan; index: number }>>();
  normalized.forEach((plan, index) => {
    const familyId = plan.contentFamilyId || plan.contentId || `weekly-master-${index + 1}`;
    const current = groups.get(familyId) || [];
    current.push({ plan, index });
    groups.set(familyId, current);
  });
  const used = new Set<string>();
  const enriched = new Map<number, VideoCreationPlan>();
  [...groups.entries()].forEach(([familyId, members], familyIndex) => {
    const anchor = members.find(item => item.plan.platform === 'tiktok')
      || members.find(item => item.plan.productionRole !== 'platform_adaptation')
      || members[0]!;
    const anchorRow = input.pack.matrixPlan?.find(item => item.accountId === anchor.plan.matrix?.accountId);
    const ranked = rankContentReferences({
      videos: input.videos,
      benchmarks: input.benchmarks,
      platform: anchor.plan.platform,
      productName: anchor.plan.productName,
      audience: anchorRow?.audience || anchor.plan.matrix?.audience || input.config.customerProfile,
      direction: anchorRow?.contentDirection || anchor.plan.theme,
    });
    const reference = ranked.find(item => item.exact && !used.has(item.id));
    if (reference) used.add(reference.id);
    const mayClone = input.config.enabledWorkflows.includes('viral_clone');
    const angle = contentAngles[familyIndex % contentAngles.length];
    const matrixTheme = anchorRow
      ? `${anchorRow.contentDirection.replace(/[。；;\s]+$/u, '')}｜${angle}`
      : `${anchor.plan.theme}｜${angle}`;
    const generatedFrom = reference?.benchmarkAccount && reference.exact
      ? 'matrix_benchmark_viral' as const
      : reference?.exact ? 'matrix_viral' as const : 'matrix_product' as const;
    members.forEach(({ plan, index }) => {
      const row = input.pack.matrixPlan?.find(item => item.accountId === plan.matrix?.accountId);
      const rowPlans = normalized.filter(item => item.matrix?.accountId === plan.matrix?.accountId);
      const slot = Math.max(1, rowPlans.findIndex(item => item.contentId === plan.contentId) + 1);
      const requiredCount = row?.weeklyCount || rowPlans.length || normalized.length;
      const placeholder = !plan.referenceId && !plan.buyerProblem
        && (plan.theme === '介绍产品的用途与特点' || /待编导确认/.test(plan.theme));
      const theme = placeholder ? reference?.theme || matrixTheme : plan.theme;
      const master = plan.productionRole !== 'platform_adaptation';
      enriched.set(index, normalizeVideoPlan({
        ...plan,
        contentId: plan.contentId || `weekly-${input.goal.startsAt}-${index + 1}`,
        contentFamilyId: familyId,
        plannedPublishDate: publishDateForAccountSlot(input.goal.startsAt, input.goal.endsAt, slot - 1, requiredCount),
        buyerProblem: plan.buyerProblem || reference?.hook || matrixTheme,
        evidenceRequirement: plan.evidenceRequirement || reference?.evidenceRequirement || '必须使用企业资料或素材库中的可核验事实与画面',
        theme,
        // Preserve explicit historic routes; only new placeholders enter clone.
        route: placeholder && mayClone ? 'clone' : plan.route,
        referenceId: mayClone && reference ? reference.id : plan.referenceId,
        estimatedCost: master ? MASTER_VIDEO_COST_POINT_CNY : 0,
        estimatedCostRange: master ? masterVideoCostRange() : includedAdaptationCostRange(),
        publication: publicationCopyForPlan({ plan, reference, productName: plan.productName, theme }),
        ...(mayClone && reference && plan.referenceId && plan.referenceId !== reference.id ? { preproduction: undefined } : {}),
        planningEvidence: {
          generatedFrom,
          matrixAccountId: row?.accountId || plan.matrix?.accountId || '',
          requiredCount,
          slot,
          referenceTitle: reference?.title || '',
          referenceViews: reference?.views || '',
          referenceThumbnailUrl: reference?.thumbnailUrl || '',
          referenceSourceUrl: reference?.sourceUrl || '',
          benchmarkAccount: reference?.benchmarkAccount || '',
          matchScore: reference?.score || 0,
          factors: [
            `原创母版 ${familyIndex + 1}/${groups.size} · 本账号发布位 ${slot}/${requiredCount}`,
            ...(reference?.factors || []),
            reference?.exact ? '参考内容已具备可执行精确分析' : '爆款视频数量不足，补齐后才能确认周计划',
            master ? '原创母版承担一次生产成本' : '跨平台轻适配包含在母版成本中',
          ],
        },
        ...(reference?.analysis ? { benchmarkAnalysis: reference.analysis } : {}),
      }));
    });
  });
  const plans = normalized.map((plan, index) => enriched.get(index) || plan);
  const productionBudget = Math.round(plans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0) * 100) / 100;
  const productionBudgetMin = Math.round(plans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || 0), 0) * 100) / 100;
  const productionBudgetMax = Math.round(plans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || 0), 0) * 100) / 100;
  const result: WeeklyPackage = {
    ...input.pack,
    directorPlan: input.pack.directorPlan
      ? { ...input.pack.directorPlan, productionBudget, productionBudgetMin, productionBudgetMax }
      : input.pack.directorPlan,
    tasks: input.pack.tasks.map(task => task.templateId === 'production' ? { ...task, videoPlans: plans } : task),
  };
  return { ...result, operatingContext: buildWeeklyOperatingContext(result, input.goal, input.config) };
}
