import { normalizeVideoPlan, type VideoCreationPlan } from '../../shared/contracts/videoCreationPlan.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from './domain.js';
import { buildWeeklyOperatingContext } from './weeklyPackage.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
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
  score: number;
  factors: string[];
}

const text = (value: unknown, limit = 500) => String(value ?? '').trim().slice(0, limit);
const contentAngles = ['买家决策问题', '产品实测演示', '工艺与过程证据', '选型避坑', '使用场景验证'] as const;
const record = (value: unknown): Record<string, any> => {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
};

/**
 * Weekly planning uses the same configurable 1080p Seedance rate as the
 * production service. This is deliberately a conservative plan estimate:
 * settlement is still reconciled from the provider receipt after execution.
 */
export function estimateHighestTierVideoCostCny(duration: number): number {
  return estimateSeedanceCostCny(Math.max(1, Number(duration) || 30), '1080p');
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
    const analysis = record(video.aiAnalysis);
    const gemini = record(analysis.gemini);
    const candidate = record(analysis.candidateEvidence);
    const relevance = text(record(candidate.relevance).level);
    const transferability = text(record(candidate.transferability).level);
    const momentum = text(record(candidate.momentum).level);
    const exact = analysis.analysisMode === 'exact' && analysis.analysisQuality === 'video' && Object.keys(gemini).length > 0;
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
      sourceUrl: previewUrl(video.sourceUrl, video.videoUrl, video.url, analysis.sourceUrl, analysis.videoUrl),
      theme,
      hook: hooks[0] || theme,
      evidenceRequirement: sellingPoints[0] ? `用企业资料核验并呈现：${sellingPoints[0]}` : '必须使用企业资料或素材库中的可核验事实与画面',
      benchmarkAccount: benchmark ? text(benchmark.accountName || benchmark.handle || benchmark.accountUrl, 300) : text(analysis.sourceAccountName || analysis.author, 300),
      exact,
      score: Math.max(0, Math.min(100, Math.round(score))),
      factors: [...new Set(factors)].slice(0, 8),
    }];
  }).sort((left, right) => right.score - left.score || numericViews(right.views) - numericViews(left.views) || left.id.localeCompare(right.id));
}

function publishDate(startsAt: string, endsAt: string, index: number, total: number): string {
  const start = Date.parse(`${startsAt}T00:00:00Z`);
  const end = Date.parse(`${endsAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const days = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  const offset = Math.min(days - 1, Math.floor(index * days / Math.max(1, total)));
  return new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Enriches the deterministic matrix quota with tenant evidence. It never
 * invents a reference: every weekly video slot is paired one-to-one with a
 * persisted exact viral-video analysis. A shortage remains visible as a
 * blocker instead of silently falling back to an unrelated content route.
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
  const used = new Set<string>();
  const plans = production.videoPlans.map((source, index, all) => {
    const plan = normalizeVideoPlan(source);
    const row = input.pack.matrixPlan?.find(item => item.accountId === plan.matrix?.accountId);
    const rowPlans = all.filter(item => item.matrix?.accountId === plan.matrix?.accountId);
    const slot = Math.max(1, rowPlans.indexOf(source) + 1);
    const requiredCount = row?.weeklyCount || rowPlans.length || all.length;
    const ranked = rankContentReferences({
      videos: input.videos,
      benchmarks: input.benchmarks,
      platform: plan.platform,
      productName: plan.productName,
      audience: row?.audience || plan.matrix?.audience || input.config.customerProfile,
      direction: row?.contentDirection || plan.theme,
    });
    const reference = ranked.find(item => item.exact && !used.has(item.id));
    if (reference) used.add(reference.id);
    const placeholder = !plan.referenceId && !plan.buyerProblem
      && (plan.theme === '介绍产品的用途与特点' || /待编导确认/.test(plan.theme));
    const mayClone = input.config.enabledWorkflows.includes('viral_clone');
    const angle = contentAngles[(slot - 1) % contentAngles.length];
    const matrixTheme = row ? `${row.contentDirection.replace(/[。；;\s]+$/u, '')}｜${angle}` : `${plan.theme}｜${angle}`;
    const generatedFrom = reference?.benchmarkAccount && reference.exact
      ? 'matrix_benchmark_viral' as const
      : reference?.exact ? 'matrix_viral' as const : 'matrix_product' as const;
    const theme = placeholder ? reference?.theme || matrixTheme : plan.theme;
    return normalizeVideoPlan({
      ...plan,
      contentId: plan.contentId || `weekly-${input.goal.startsAt}-${index + 1}`,
      plannedPublishDate: plan.plannedPublishDate || publishDate(input.goal.startsAt, input.goal.endsAt, index, all.length),
      buyerProblem: plan.buyerProblem || reference?.hook || matrixTheme,
      evidenceRequirement: plan.evidenceRequirement || reference?.evidenceRequirement || '必须使用企业资料或素材库中的可核验事实与画面',
      theme,
      route: mayClone ? 'clone' : plan.route,
      referenceId: mayClone ? reference?.id || '' : plan.referenceId,
      estimatedCost: Number(plan.estimatedCost) > 0 ? Number(plan.estimatedCost) : estimateHighestTierVideoCostCny(plan.duration),
      publication: plan.publication?.title ? plan.publication : publicationCopyForPlan({ plan, reference, productName: plan.productName, theme }),
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
          `矩阵要求 ${requiredCount} 条`,
          ...(reference?.factors || []),
          reference?.exact ? '参考内容已具备可执行精确分析' : '爆款视频数量不足，补齐后才能确认周计划',
        ],
      },
    });
  });
  const productionBudget = Math.round(plans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0) * 100) / 100;
  const result: WeeklyPackage = {
    ...input.pack,
    directorPlan: input.pack.directorPlan
      ? { ...input.pack.directorPlan, productionBudget }
      : input.pack.directorPlan,
    tasks: input.pack.tasks.map(task => task.templateId === 'production' ? { ...task, videoPlans: plans } : task),
  };
  return { ...result, operatingContext: buildWeeklyOperatingContext(result, input.goal, input.config) };
}
