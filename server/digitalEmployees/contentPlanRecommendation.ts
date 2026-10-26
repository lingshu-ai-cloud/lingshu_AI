import { balancedWeeklyPublishSlots, publishDateForAccountSlot } from '../../shared/contracts/weeklyPublishSchedule.js';
import { normalizeVideoPlan, type VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from './domain.js';
import { buildWeeklyOperatingContext } from './weeklyPackage.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { buildBenchmarkAnalysis, type BenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { includedAdaptationCostRange, masterVideoCostRange, MASTER_VIDEO_COST_POINT_CNY } from '../../shared/contracts/contentCostModel.js';
import { isDiscoveryVideoEligible } from '../../shared/contracts/discoveryVideoPolicy.js';
import { productionReferenceAdmission, type ProductionReferenceAdmission } from '../../shared/productionReferenceAdmission.js';
import { referenceContentIdentity, sameReferenceContent, type ReferenceContentIdentity } from './referenceContentIdentity.js';
import { estimateSeedanceCostCny } from '../lib/seedanceBudget.js';

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
  productionReady: boolean;
  contentRelevant: boolean;
  admission: ProductionReferenceAdmission;
  score: number;
  factors: string[];
  analysis: BenchmarkAnalysis;
  contentIdentity: ReferenceContentIdentity;
  caption: string;
  tags: string[];
  captionReuseAuthorized: boolean;
  identityTerms: Array<{ text: string; kind: 'company' | 'brand' | 'product' }>;
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

const money = (value: number) => Math.round(value * 100) / 100;

/** Pre-production authorization envelope derived from the exact frozen
 * storyboard and the same provider rates used by the native executor. The
 * lower value covers one 480p attempt; the upper value reserves one paid
 * regeneration for every generated shot. Two first-frame calls per shot are
 * reserved conservatively so product-composite shots cannot exceed approval. */
export function verifiedStoryboardProviderCostRange(analysis: BenchmarkAnalysis | undefined): {
  minCny: number;
  maxCny: number;
  basis: 'verified_storyboard_provider_envelope';
} | null {
  const shots = analysis?.shots || [];
  if (!analysis?.timelineComplete || !shots.length || shots.some(shot => shot.start === null || shot.end === null)) return null;
  const firstFrameCny = Number(process.env.STORYBOARD_AIGC_FIRST_FRAME_ESTIMATED_CNY || 0.3);
  const geometryEnabled = process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED === 'true';
  const geometryCny = geometryEnabled ? Number(process.env.STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY || 0.1) : 0;
  if (!Number.isFinite(firstFrameCny) || firstFrameCny <= 0 || !Number.isFinite(geometryCny) || geometryCny < 0) return null;
  const oneAttempt = shots.reduce((sum, shot) => {
    const duration = Math.max(4, Math.ceil(Number(shot.end) - Number(shot.start)));
    return sum + firstFrameCny * 2 + geometryCny + estimateSeedanceCostCny(duration, '480p');
  }, 0);
  const minCny = money(oneAttempt);
  return { minCny, maxCny: money(oneAttempt * 2), basis: 'verified_storyboard_provider_envelope' };
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
  companyName?: string;
}): NonNullable<VideoCreationPlan['publication']> {
  const productName = text(input.productName || input.plan.productName || '本周主推产品', 80);
  const subject = text(input.reference?.hook || input.theme || input.plan.theme || '买家最关心的问题', 160);
  const companyName = text(input.companyName, 120);
  const replacements = (input.reference?.identityTerms || []).flatMap(term => {
    const to = term.kind === 'product' ? productName : companyName;
    return term.text && to && term.text.toLocaleLowerCase() !== to.toLocaleLowerCase()
      ? [{ from: term.text, to, kind: term.kind }]
      : [];
  }).filter((item, index, items) => items.findIndex(candidate => candidate.from.toLocaleLowerCase() === item.from.toLocaleLowerCase()) === index);
  const replaceFacts = (value: string) => replacements.reduce((copy, item) => copy.replace(new RegExp(item.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), item.to), value);
  const authorizedReuse = Boolean(input.reference?.captionReuseAuthorized && input.reference.caption);
  const title = text(`✨ ${subject}｜${productName}`, 300);
  const caption = authorizedReuse
    ? text(replaceFacts(input.reference!.caption), 2_000)
    : text(`✨ ${subject}\n用 ${productName} 的真实画面与可核验信息，帮助目标买家快速判断是否匹配需求。${input.plan.matrix?.cta ? ` ${input.plan.matrix.cta}` : ''}`, 2_000);
  const normalizedProduct = productName.replace(/[^\p{L}\p{N}]+/gu, '');
  const sourceTags = authorizedReuse ? input.reference!.tags.map(replaceFacts) : [];
  return {
    title,
    caption,
    tags: [...new Set((sourceTags.length ? sourceTags : [normalizedProduct, 'B2B', '产品实拍', '采购决策']).map(tag => tag.replace(/^#+/, '').trim()).filter(Boolean))].slice(0, 20),
    status: 'planned',
    generatedBy: 'business_agent',
    copyMode: authorizedReuse ? 'authorized_source_reuse' : 'canonical_original',
    sourceReferenceId: input.reference?.id || '',
    factReplacements: replacements,
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
  const productionPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const selectedNames = new Set(productionPlans.map(source => normalizeVideoPlan(source).productName).filter(Boolean));
  const diversifyFamilies = products.length > 1 && selectedNames.size <= 1;
  const familyProducts = new Map<string, (typeof products)[number]>();
  let nextProductIndex = 0;
  return {
    ...pack,
    tasks: pack.tasks.map(task => task.templateId !== 'production' ? task : {
      ...task,
      videoPlans: (task.videoPlans || []).map(source => {
        const current = normalizeVideoPlan(source);
        const familyId = current.contentFamilyId || current.masterContentId || current.contentId;
        if (diversifyFamilies && familyId && !familyProducts.has(familyId)) {
          familyProducts.set(familyId, products[nextProductIndex % products.length]);
          nextProductIndex += 1;
        }
        const selected = diversifyFamilies && familyId
          ? familyProducts.get(familyId)
          : products.find(product => product.name === current.productName || product.id === current.productName) || fallback;
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
    if (!['linkedin', 'facebook', 'instagram', 'tiktok', 'youtube'].includes(platform)) return [];
    const analysis = record(video.aiAnalysis);
    const gemini = record(analysis.gemini);
    const sourceUrl = previewUrl(video.sourceUrl, video.videoUrl, video.url);
    const storedSource = text(video.videoFileId || analysis.videoObjectKey || analysis.videoFileId, 2_000);
    const exact = analysis.analysisMode === 'exact'
      && ['video', 'video_review_required'].includes(String(analysis.analysisQuality || ''))
      && Object.keys(gemini).length > 0;
    // A tenant-owned video with durable stored bytes is a valid library
    // candidate even when it was uploaded locally and therefore has no public
    // discovery URL. Public crawl policy still applies to records without
    // owned bytes so metadata-only rows cannot enter production.
    if (!isDiscoveryVideoEligible({ platform, duration: Number(video.duration || 0), sourceUrl })
      && !(exact && storedSource)) return [];
    const candidate = record(analysis.candidateEvidence);
    const relevance = text(record(candidate.relevance).level);
    const transferability = text(record(candidate.transferability).level);
    const momentum = text(record(candidate.momentum).level);
    const exactReviewRequired = analysis.analysisMode === 'exact' && analysis.analysisQuality === 'video_review_required';
    const benchmarkAnalysis = buildBenchmarkAnalysis({
      analysis,
      videoId: video.id,
      duration: Number(video.duration || 0),
      evidenceRevision: text(video.updatedAt || video.updated_at || analysis.evidenceRevision || analysis.analysisRunId || `analysis:${video.id}`, 160),
    });
    const benchmark = benchmarkFor(video, input.benchmarks);
    const admission = productionReferenceAdmission(benchmarkAnalysis);
    const publicBaseline = record(analysis.publicBaseline);
    const relativeMultiple = Number(analysis.relativeViewMultiple || publicBaseline.relativeMultiple || 0);
    const title = text(video.title || analysis.caption || video.id);
    const theme = text(gemini.theme || title);
    const hooks = Array.isArray(gemini.hooks) ? gemini.hooks.map((item: unknown) => text(item)).filter(Boolean) : [];
    const sellingPoints = Array.isArray(gemini.sellingPoints) ? gemini.sellingPoints.map((item: unknown) => text(item)).filter(Boolean) : [];
    const rawTags = Array.isArray(video.tags) ? video.tags : typeof video.tags === 'string' ? (() => { try { return JSON.parse(video.tags); } catch { return []; } })() : [];
    const identityTerms = (Array.isArray(gemini.identityEntities) ? gemini.identityEntities : [])
      .flatMap((item: unknown) => {
        const entity = record(item);
        const kind = String(entity.type);
        const value = text(entity.text, 160);
        return value && ['company', 'brand', 'product'].includes(kind) ? [{ text: value, kind: kind as 'company' | 'brand' | 'product' }] : [];
      });
    const haystack = new Set(tokens(title, theme, analysis.caption, hooks.join(' '), sellingPoints.join(' ')));
    const overlap = desiredTokens.filter(item => haystack.has(item)).length;
    const contentRelevant = overlap > 0
      || ['high', 'medium'].includes(relevance)
      // Older exact analyses predate the candidate-relevance envelope. When
      // their normalized production evidence is ready, keep them usable as
      // structural references instead of forcing a new crawl solely because
      // that optional classifier field is absent. An explicit low relevance
      // decision remains authoritative and is never overridden.
      || (!relevance && admission.ready && Boolean(theme));
    const factors: string[] = [];
    let score = 0;
    if (platform === input.platform) { score += 24; factors.push('同平台'); }
    if (exact && admission.ready) { score += 28; factors.push('全片精确分析已通过编导交接'); }
    else if (exact) factors.push('分析证据已生成，制作前待复核');
    if (exactReviewRequired || !admission.ready) factors.push(...admission.blockers.slice(0, 2));
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
      productionReady: exact && admission.ready,
      contentRelevant,
      admission,
      score: Math.max(0, Math.min(100, Math.round(score))),
      factors: [...new Set(factors)].slice(0, 8),
      analysis: benchmarkAnalysis,
      contentIdentity: referenceContentIdentity(video),
      caption: text(analysis.caption, 2_000),
      tags: Array.isArray(rawTags) ? rawTags.map((item: unknown) => text(item, 80).replace(/^#+/, '')).filter(Boolean).slice(0, 20) : [],
      captionReuseAuthorized: analysis.usage === 'editable' || analysis.captionReuseAuthorized === true,
      identityTerms,
    }];
  }).sort((left, right) => right.score - left.score || numericViews(right.views) - numericViews(left.views) || left.id.localeCompare(right.id));
}

export { publishDateForAccountSlot } from '../../shared/contracts/weeklyPublishSchedule.js';

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
  const used: RankedContentReference[] = [];
  const unused = (candidate: RankedContentReference) => !used.some(existing =>
    sameReferenceContent(existing.contentIdentity, candidate.contentIdentity));
  const enriched = new Map<number, VideoCreationPlan>();
  const explicitSchedule = (plan: VideoCreationPlan) => Boolean(plan.plannedPublishDate && plan.plannedPublishDate >= input.goal.startsAt
    && plan.plannedPublishDate <= input.goal.endsAt && (!plan.plannedPublishAt || Number.isFinite(Date.parse(plan.plannedPublishAt))));
  const publishSlots = balancedWeeklyPublishSlots(
    input.goal.startsAt,
    input.goal.endsAt,
    normalized.map(plan => `${plan.platform}:${plan.matrix?.accountId || 'planned'}`),
    undefined,
    normalized.map(plan => explicitSchedule(plan) ? plan.plannedPublishAt || plan.plannedPublishDate : undefined),
  );
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
    const existingReferenceId = anchor.plan.referenceId;
    // Preserve an explicit/frozen reference; do not silently replace it while
    // enriching its visible diagnostics. Only new picks require full admission.
    const reference = existingReferenceId ? ranked.find(item => item.id === existingReferenceId)
      : ranked.find(item => item.productionReady && item.contentRelevant && unused(item));
    const awaitingReview = ranked.find(item => item.exact && !item.productionReady && unused(item));
    if (reference) used.push(reference);
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
      const effectiveRoute = placeholder && mayClone ? 'clone' : plan.route;
      const providerRange = master && effectiveRoute === 'clone'
        ? verifiedStoryboardProviderCostRange(reference?.analysis || plan.benchmarkAnalysis)
        : null;
      const costRange = master ? providerRange || masterVideoCostRange() : includedAdaptationCostRange();
      enriched.set(index, normalizeVideoPlan({
        ...plan,
        contentId: plan.contentId || `weekly-${input.goal.startsAt}-${index + 1}`,
        contentFamilyId: familyId,
        plannedPublishDate: explicitSchedule(plan) ? plan.plannedPublishDate : publishSlots[index]?.date || publishDateForAccountSlot(input.goal.startsAt, input.goal.endsAt, slot - 1, requiredCount),
        plannedPublishAt: explicitSchedule(plan) ? plan.plannedPublishAt : publishSlots[index]?.scheduledAt || '',
        buyerProblem: plan.buyerProblem || reference?.hook || matrixTheme,
        evidenceRequirement: plan.evidenceRequirement || reference?.evidenceRequirement || '必须使用企业资料或素材库中的可核验事实与画面',
        theme,
        // Preserve explicit historic routes; only new placeholders enter clone.
        route: effectiveRoute,
        referenceId: mayClone && reference ? reference.id : plan.referenceId,
        estimatedCost: master ? costRange.minCny : 0,
        estimatedCostRange: costRange,
        publication: publicationCopyForPlan({ plan, reference, productName: plan.productName, theme, companyName: input.config.companyName }),
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
            `独立制作视频 ${familyIndex + 1}/${groups.size} · 本账号发布位 ${slot}/${requiredCount}`,
            ...(reference?.factors || []),
            reference?.productionReady ? '参考内容已具备可执行精确分析'
              : reference ? `制作前待复核：${reference.admission.blockers.slice(0, 3).join('；')}`
                : awaitingReview ? `参考分析待复核：${awaitingReview.admission.blockers.slice(0, 3).join('；')}`
                  : '爆款视频数量不足，补齐后才能确认周计划',
            master ? '独立制作视频承担一次生产成本' : '跨平台轻适配包含在完整制作成本中',
          ],
        },
        ...(reference?.analysis ? { benchmarkAnalysis: reference.analysis } : {}),
      }));
    });
  });
  const plans = normalized.map((plan, index) => enriched.get(index) || plan);
  const budgetMode = input.pack.directorPlan?.productionBudgetMode === 'economy' ? 'economy' : 'protected';
  const productionBudgetMin = Math.round(plans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || 0), 0) * 100) / 100;
  const productionBudgetMax = Math.round(plans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || 0), 0) * 100) / 100;
  const productionBudget = budgetMode === 'economy' ? productionBudgetMin : productionBudgetMax;
  const result: WeeklyPackage = {
    ...input.pack,
    directorPlan: input.pack.directorPlan
      ? { ...input.pack.directorPlan, productionBudgetMode: budgetMode, productionBudget, productionBudgetMin, productionBudgetMax }
      : input.pack.directorPlan,
    tasks: input.pack.tasks.map(task => task.templateId === 'production' ? { ...task, videoPlans: plans } : task),
  };
  return { ...result, operatingContext: buildWeeklyOperatingContext(result, input.goal, input.config) };
}
