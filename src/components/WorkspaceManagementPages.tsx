import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  BrainCircuit, FileText, Search, Sparkles, ShieldCheck, UserRoundCog,
  Users, Database, Clock3, Plus, Trash2, Loader2, X, Play, Copy, ArrowRight,
  MessageCircle, Workflow, ChevronRight, BookOpenCheck,
  BarChart3, Target, CircleAlert, RefreshCw, PauseCircle, CheckCircle2,
  RotateCcw, Pencil, Download, Upload, History,
} from 'lucide-react';
import { authApi, authHeader, type EmployeeAccount, type OrganizationRole } from '../lib/auth';
import { studioApi, type StudioProject } from '../lib/studioApi';
import { productionSummary } from '../lib/shotProduction';
import { ContentOpsExecutionDialog, type ContentOpsExecutionIntent } from './ContentOpsExecutionDialog';
import { HighConfidenceInsights, PlatformTrends, type OpsEvidence } from './ContentOpsDrilldowns';
import {
  CONTENT_ACTION_STORAGE,
  consumeSessionPrefill,
  type ScriptLibraryActionPrefill,
} from '../lib/contentActionNavigation';
import { useModalFocus } from '../hooks/useModalFocus';
type ExactAnalysisDetail = {
  time?: string; timestamp?: string; environment?: string; shot?: string; camera?: string;
  angle?: string; composition?: string; visual?: string; subtitle?: string; dialogue?: string; audio?: string; note?: string; purpose?: string;
  onScreenText?: string; ambientSound?: string; bgm?: string; soundEffects?: string[];
  beats?: Array<{ time?: string; action?: string; dialogue?: string; onScreenText?: string }>;
  persistentState?: string; startState?: string; endState?: string; transitionToNext?: string;
  authenticity?: string; estimatedSpeechDuration?: number; dialogueFits?: boolean; confidence?: number; needsReview?: boolean;
  viralPotential?: { score?: number; mechanisms?: string[]; whyEffective?: string };
};
type AnalysisGlobalSettings = { visualStyle?: string; aspectRatio?: string; lighting?: string; subtitlePolicy?: string; audioPolicy?: string; identityConsistency?: string; productConsistency?: string; negativeConstraints?: string[] };
type FirstTenSeconds = { atmosphere?: string; audioVisual?: string; camera?: string; visuals?: string; voiceMusic?: string };
type CoarseStructure = { time?: string; frame?: string; label?: string; description?: string; desc?: string };

type ExactAnalysis = {
  analysisMode?: string;
  materialUrl?: string;
  materialPoster?: string;
  analyzedAt?: string;
  views?: string; caption?: string; sourceAccount?: string; sourceAccountName?: string;
  publicMetrics?: { likes?: string; comments?: string; shares?: string; plays?: string; observedAt?: string };
  baseRequirements?: string;
  globalSettings?: AnalysisGlobalSettings; firstTenSeconds?: FirstTenSeconds; coarseStructure?: CoarseStructure[]; structure?: string;
  scriptSummary15s?: { visualStyle?: string; coreEmotion?: string; competitors?: string[] };
  scriptDetails15s?: ExactAnalysisDetail[];
  hooks?: string[]; sellingPoints?: string[]; adaptTip?: string; theme?: string; mood?: string;
  gemini?: { baseRequirements?: string; globalSettings?: AnalysisGlobalSettings; firstTenSeconds?: FirstTenSeconds; coarseStructure?: CoarseStructure[]; structure?: string; scriptSummary15s?: { visualStyle?: string; coreEmotion?: string; competitors?: string[] }; scriptDetails15s?: ExactAnalysisDetail[]; hooks?: string[]; sellingPoints?: string[]; adaptTip?: string; theme?: string; mood?: string };
};

type ExactVideoRecord = {
  id: string;
  title?: string; platform?: string; thumbnailUrl?: string; sourceUrl?: string; videoUrl?: string;
  duration?: number; created?: string; updated?: string; crawledAt?: string; aiAnalysis?: ExactAnalysis | string;
};

type ContentOpsKpi = { id: string; label: string; value: string; change?: string; note?: string };
type ContentOpsConclusion = { id: string; title: string; detail: string; confidence: 'high' | 'medium'; evidenceCount: number; evidence?: OpsEvidence[]; methodology?: string; dataBoundary?: string };
type ContentOpsTrendPoint = { label: string; value: number; contributors?: OpsEvidence[]; dataBoundary?: string };
type ContentOpsTrend = { platform: string; metric: string; points: ContentOpsTrendPoint[] };
type ContentOpsTopContent = { id: string; title: string; platform: string; metricLabel: string; metricValue: string; thumbnailUrl?: string };
type ContentOpsLearningEvent = { id: string; occurredAt: string; title: string; detail: string; source?: string; evidenceCount?: number; status: 'learned' | 'confirmed' | 'adjusted' | 'observing' };
type ContentOpsOverview = {
  generatedAt?: string;
  periodLabel?: string;
  kpis: ContentOpsKpi[];
  conclusions: ContentOpsConclusion[];
  recommendations: ContentOpsConclusion[];
  trends: ContentOpsTrend[];
  topContents: ContentOpsTopContent[];
  learningEvents: ContentOpsLearningEvent[];
  coverage: Array<{ platform: string; status: 'ready' | 'pending' | 'unavailable'; note?: string }>;
};

const asArray = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
const opsEvidence = (value: unknown): OpsEvidence[] => asArray(value).flatMap((item, index) => {
  const title = String(item.title || item.contentTitle || '').trim();
  if (!title) return [];
  return [{ id: String(item.id || index), contentId: item.contentId == null ? undefined : String(item.contentId), title, platform: item.platform == null ? undefined : String(item.platform), metric: item.metric == null ? undefined : String(item.metric), value: item.value == null ? undefined : String(item.value), comparison: item.comparison == null ? undefined : String(item.comparison) }];
});
const contentOpsOverview = (payload: unknown): ContentOpsOverview => {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const confidence = (item: Record<string, unknown>): 'high' | 'medium' => item.confidence === 'high' ? 'high' : 'medium';
  const conclusions = (source: unknown): ContentOpsConclusion[] => asArray(source).flatMap((item, index) => {
    const title = String(item.title || item.summary || '').trim();
    const detail = String(item.detail || item.description || item.reason || '').trim();
    const evidenceCount = Number(item.evidenceCount || item.sampleSize || 0);
    if (!title || !detail || confidence(item) !== 'high' || evidenceCount < 1) return [];
    return [{ id: String(item.id || index), title, detail, confidence: 'high', evidenceCount, evidence: opsEvidence(item.evidence || item.relatedContents), methodology: item.methodology == null ? undefined : String(item.methodology), dataBoundary: item.dataBoundary == null ? undefined : String(item.dataBoundary) }];
  });
  return {
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
    periodLabel: typeof value.periodLabel === 'string' ? value.periodLabel : undefined,
    kpis: asArray(value.kpis).flatMap((item, index) => item.label && item.value !== undefined ? [{ id: String(item.id || index), label: String(item.label), value: String(item.value), change: item.change == null ? undefined : String(item.change), note: item.note == null ? undefined : String(item.note) }] : []),
    conclusions: conclusions(value.conclusions || value.highConfidenceInsights),
    recommendations: conclusions(value.recommendations || value.nextActions),
    trends: asArray(value.trends).flatMap(item => {
      const points = asArray(item.points).flatMap(point => Number.isFinite(Number(point.value)) && point.label ? [{ label: String(point.label), value: Number(point.value), contributors: opsEvidence(point.contributors || point.topContents), dataBoundary: point.dataBoundary == null ? undefined : String(point.dataBoundary) }] : []);
      return item.platform && item.metric && points.length > 1 ? [{ platform: String(item.platform), metric: String(item.metric), points }] : [];
    }),
    topContents: asArray(value.topContents).flatMap((item, index) => item.title && item.metricValue !== undefined ? [{ id: String(item.id || index), title: String(item.title), platform: String(item.platform || '未记录'), metricLabel: String(item.metricLabel || '表现'), metricValue: String(item.metricValue), thumbnailUrl: typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl : undefined }] : []),
    learningEvents: asArray(value.learningEvents || value.recentLearning).flatMap((item, index) => {
      const title = String(item.title || item.summary || '').trim();
      const detail = String(item.detail || item.description || '').trim();
      if (!title || !detail) return [];
      const status: ContentOpsLearningEvent['status'] = item.status === 'confirmed' || item.status === 'adjusted' || item.status === 'observing' ? item.status : 'learned';
      return [{ id: String(item.id || index), occurredAt: String(item.occurredAt || item.createdAt || item.updatedAt || ''), title, detail, source: item.source == null ? undefined : String(item.source), evidenceCount: Number.isFinite(Number(item.evidenceCount)) ? Number(item.evidenceCount) : undefined, status }];
    }),
    coverage: asArray(value.coverage).flatMap(item => item.platform ? [{ platform: String(item.platform), status: item.status === 'ready' ? 'ready' as const : item.status === 'unavailable' ? 'unavailable' as const : 'pending' as const, note: item.note == null ? undefined : String(item.note) }] : []),
  };
};

const METRIC_LABELS: Record<string, string> = { views: '播放量', reach: '覆盖人数', likes: '点赞', comments: '评论', shares: '分享', saves: '收藏', watchTimeMinutes: '观看分钟数', averageViewDurationSeconds: '平均观看时长（秒）', averageViewPercentage: '平均观看百分比', followers: '粉丝数', subscribers: '订阅数', profileViews: '主页访问', postsPublished: '发布内容' };
const socialMetricsOpsOverview = (overviewPayload: unknown, trendPayload: unknown): ContentOpsOverview => {
  const raw = overviewPayload && typeof overviewPayload === 'object' ? overviewPayload as Record<string, unknown> : {};
  const metrics = asArray(raw.metrics);
  const snapshotCount = Number(raw.snapshotCount || 0);
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.map(String) : [];
  const availableMetrics = metrics.filter(metric => metric.total !== null && metric.total !== undefined);
  const conclusions: ContentOpsConclusion[] = metrics.flatMap(metric => {
    const trend = metric.trend && typeof metric.trend === 'object' ? metric.trend as Record<string, unknown> : {};
    if (trend.available !== true || !Number.isFinite(Number(trend.changeRate))) return [];
    const rate = Number(trend.changeRate);
    const label = METRIC_LABELS[String(metric.key)] || String(metric.key || '指标');
    return [{ id: `trend-${String(metric.key)}`, title: `${label}${rate >= 0 ? '增长' : '下降'} ${Math.abs(rate).toFixed(1)}%`, detail: `本周期 ${Number(trend.current || 0).toLocaleString()}，上一周期 ${Number(trend.previous || 0).toLocaleString()}。`, confidence: 'high' as const, evidenceCount: snapshotCount }];
  }).slice(0, 3);
  const trendRaw = trendPayload && typeof trendPayload === 'object' ? trendPayload as Record<string, unknown> : {};
  const points = asArray(trendRaw.points).flatMap(point => point.date && Number.isFinite(Number(point.value)) ? [{ label: String(point.date), value: Number(point.value) }] : []);
  const expected = ['facebook', 'instagram', 'tiktok', 'youtube'];
  return {
    periodLabel: `最近 ${Math.max(7, Number(raw.periodDays || 30))} 天`,
    kpis: availableMetrics.slice(0, 6).map(metric => ({ id: String(metric.key), label: METRIC_LABELS[String(metric.key)] || String(metric.key), value: Number(metric.total).toLocaleString(), note: '已同步平台快照汇总' })),
    conclusions,
    recommendations: [],
    trends: trendRaw.available === true && points.length > 1 ? [{ platform: trendRaw.platform === 'all' ? '全部平台' : String(trendRaw.platform || '全部平台'), metric: METRIC_LABELS[String(trendRaw.metric)] || String(trendRaw.metric || '播放量'), points }] : [],
    topContents: [],
    learningEvents: [],
    coverage: expected.map(platform => ({ platform, status: platforms.includes(platform) ? 'ready' as const : 'pending' as const, note: platforms.includes(platform) ? '已取得指标快照' : '账号未连接或尚未完成指标同步' })),
  };
};

const MOCK_CONTENT_OPS_OVERVIEW: ContentOpsOverview = {
  generatedAt: new Date().toISOString(),
  periodLabel: '演示数据 · 最近 30 天',
  kpis: [
    { id: 'views', label: '总播放量', value: '286,430', change: '环比 +28.6%', note: '四平台已同步内容汇总' },
    { id: 'reach', label: '覆盖人数', value: '174,820', change: '环比 +19.4%', note: 'Facebook 与 Instagram 可用口径' },
    { id: 'engagement', label: '总互动', value: '18,764', change: '环比 +14.2%', note: '点赞、评论、分享与收藏' },
    { id: 'followers', label: '净增粉丝', value: '3,248', change: '环比 +31.8%', note: '已授权账号的可用粉丝指标' },
  ],
  conclusions: [
    { id: 'c1', title: '短教程是本月主要增长来源', detail: '12 条“使用方法 + 效果对比”内容贡献了 46% 新增播放，中位播放量较账号基线高 58%。', confidence: 'high', evidenceCount: 12, methodology: '将近 30 天已发布内容按现有标题与脚本标签分组，比较各组中位播放量与账号同期内容基线。', evidence: [{ title: '防晒乳正确用法：3 个最容易忽略的细节', platform: 'TikTok', metric: '播放量', value: '86,420', comparison: '高于账号同期内容基线 72%' }, { title: 'SPF 指数怎么选？一次讲清楚', platform: 'YouTube', metric: '平均观看百分比', value: '51%', comparison: '高于同期视频中位数 11 个百分点' }] },
    { id: 'c2', title: 'YouTube 开场留存改善', detail: '最近 6 条视频的平均观看百分比由 38% 提升至 47%，前置展示产品效果的内容表现更稳定。', confidence: 'high', evidenceCount: 6, methodology: '仅使用 YouTube Analytics 已返回的平均观看百分比，比较最近 6 条与此前同期内容。', dataBoundary: '可确认观看百分比改善，但当前数据不能单独证明是“前置展示产品效果”造成；创作结构来自现有脚本标签。', evidence: [{ title: 'SPF 指数怎么选？一次讲清楚', platform: 'YouTube', metric: '平均观看百分比', value: '51%' }, { title: '涂防晒最容易忽略的两个位置', platform: 'YouTube', metric: '平均观看百分比', value: '48%' }] },
    { id: 'c3', title: 'Instagram 收藏增长快于分享', detail: '教程类内容收藏率达 4.8%，但分享率仅 1.2%，用户认可实用价值，传播动机仍有提升空间。', confidence: 'high', evidenceCount: 9, evidence: [{ title: '涂抹前后效果对比｜7 天实测', platform: 'Instagram', metric: '收藏率 / 分享率', value: '5.2% / 1.4%' }] },
  ],
  recommendations: [
    { id: 'r1', title: '下周继续发布 3 条“问题—演示—结果”短教程', detail: '保留前 3 秒直接展示效果的结构，优先复用本月表现稳定的素材与镜头节奏。', confidence: 'high', evidenceCount: 12 },
    { id: 'r2', title: '为 Instagram 增加可转发的结论页', detail: '在结尾加入清单式总结和明确转发理由，观察下一批 5 条内容的分享率变化。', confidence: 'high', evidenceCount: 9 },
    { id: 'r3', title: '暂停扩大纯品牌口播投入', detail: '该类内容近 7 条的中位播放低于账号基线 23%，先小样本测试新开场再恢复规模化创作。', confidence: 'high', evidenceCount: 7 },
  ],
  trends: [
    { platform: '全部平台', metric: '每日新增播放', points: [18400, 22100, 19800, 26700, 31200, 35400, 42900].map((value, index) => ({ label: `08-${10 + index}`, value, contributors: index === 6 ? [{ title: '防晒乳正确用法：3 个最容易忽略的细节', platform: 'TikTok', metric: '当日新增播放', value: '18,640' }, { title: '涂抹前后效果对比｜7 天实测', platform: 'Instagram', metric: '当日新增覆盖', value: '9,820' }] : undefined })) },
    { platform: 'YouTube', metric: '每日观看分钟', points: [7200, 8100, 7900, 9300, 10800, 11700, 13400].map((value, index) => ({ label: `08-${10 + index}`, value, contributors: index === 6 ? [{ title: 'SPF 指数怎么选？一次讲清楚', platform: 'YouTube', metric: '当日观看分钟', value: '4,920' }] : undefined, dataBoundary: 'YouTube Analytics 返回频道级与内容级观看分钟；演示模式按日展示，生产环境只使用授权频道的已同步数据。' })) },
  ],
  topContents: [
    { id: 't1', title: '防晒乳正确用法：3 个最容易忽略的细节', platform: 'TikTok', metricLabel: '播放量', metricValue: '86,420' },
    { id: 't2', title: '涂抹前后效果对比｜7 天实测', platform: 'Instagram', metricLabel: '覆盖人数', metricValue: '51,680' },
    { id: 't3', title: 'SPF 指数怎么选？一次讲清楚', platform: 'YouTube', metricLabel: '观看时长', metricValue: '9,840 分钟' },
    { id: 't4', title: '不同肤质的防晒选择清单', platform: 'Facebook', metricLabel: '分享数', metricValue: '1,286' },
  ],
  learningEvents: [
    { id: 'l1', occurredAt: '2026-08-16T09:30:00+08:00', title: '形成“效果前置的短教程更易增长”经验', detail: '系统对比近 30 天同类内容后，发现前 3 秒直接展示结果的视频中位播放明显高于账号基线。', source: '四平台内容表现', evidenceCount: 12, status: 'learned' },
    { id: 'l2', occurredAt: '2026-08-14T16:10:00+08:00', title: '将 Instagram 分享率列为下一轮验证指标', detail: '收藏率已经稳定高于基线，但分享率仍偏低，Agent 将在下一批内容中观察“结论页 + 转发理由”的效果。', source: 'Instagram Insights', evidenceCount: 9, status: 'observing' },
    { id: 'l3', occurredAt: '2026-08-12T11:20:00+08:00', title: '调整对纯品牌口播的判断', detail: '不再建议直接停止该类内容，改为先用小样本测试新开场，防止短期流量波动被误判为长期经验。', source: '管理员纠正', evidenceCount: 7, status: 'adjusted' },
    { id: 'l4', occurredAt: '2026-08-09T14:00:00+08:00', title: '确认 YouTube 观看百分比作为开场质量指标', detail: '经过连续 6 条内容验证，平均观看百分比与效果画面前置呈现正相关，该经验已用于创作建议。', source: 'YouTube Analytics', evidenceCount: 6, status: 'confirmed' },
  ],
  coverage: ['facebook', 'instagram', 'tiktok', 'youtube'].map(platform => ({ platform, status: 'ready', note: '本地演示数据' })),
};

const hasContentOpsData = (overview: ContentOpsOverview | null) => Boolean(overview && (overview.kpis?.length || overview.trends?.length || overview.conclusions?.length || overview.topContents?.length || overview.learningEvents?.length));

const parseAnalysis = (value: ExactVideoRecord['aiAnalysis']): ExactAnalysis => {
  let parsed: ExactAnalysis = {};
  if (value && typeof value === 'object') parsed = value;
  else try { parsed = JSON.parse(String(value || '{}')) as ExactAnalysis; } catch { parsed = {}; }
  return {
    ...parsed,
    baseRequirements: parsed.baseRequirements || parsed.gemini?.baseRequirements,
    globalSettings: parsed.globalSettings || parsed.gemini?.globalSettings,
    firstTenSeconds: parsed.firstTenSeconds || parsed.gemini?.firstTenSeconds,
    coarseStructure: parsed.coarseStructure || parsed.gemini?.coarseStructure || [],
    structure: parsed.structure || parsed.gemini?.structure,
    scriptSummary15s: parsed.scriptSummary15s || parsed.gemini?.scriptSummary15s,
    scriptDetails15s: parsed.scriptDetails15s || parsed.gemini?.scriptDetails15s || [],
    hooks: parsed.hooks || parsed.gemini?.hooks || [],
    sellingPoints: parsed.sellingPoints || parsed.gemini?.sellingPoints || [],
    adaptTip: parsed.adaptTip || parsed.gemini?.adaptTip,
    theme: parsed.theme || parsed.gemini?.theme,
    mood: parsed.mood || parsed.gemini?.mood,
  };
};

const structuralDetailText = (detail: ExactAnalysisDetail) => [
  detail.environment ? `环境：${detail.environment}` : '',
  detail.shot ? `景别：${detail.shot}` : '',
  detail.camera ? `运镜：${detail.camera}` : '',
  detail.purpose ? `镜头功能：${detail.purpose}` : '',
  detail.visual ? `画面：${detail.visual}` : '',
  detail.audio ? `配乐/声音：${detail.audio}` : '',
].filter(Boolean).join('；');

async function loadAllExactVideoRecords(): Promise<ExactVideoRecord[]> {
  const loadPage = async (page: number) => {
    const response = await fetch(`/api/overseas/videos?page=${page}&perPage=100&contentFormat=video&crawlRange=all`, { headers: authHeader() });
    if (!response.ok) throw new Error('视频列表读取失败');
    return await response.json() as { items?: ExactVideoRecord[]; totalPages?: number };
  };
  const first = await loadPage(1);
  const totalPages = Math.max(1, Number(first.totalPages || 1));
  const rest = totalPages > 1 ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => loadPage(index + 2))) : [];
  return [first, ...rest].flatMap(result => Array.isArray(result.items) ? result.items : []);
}

const firstDraftMedia = (project: StudioProject) => {
  const snapshots = Array.isArray(project.spec?.materialSnapshots) ? project.spec.materialSnapshots as Array<Record<string, unknown>> : [];
  const kickoff = project.spec?.videoKickoff as { generatedVideo?: { url?: string; poster?: string }; video?: { videoUrl?: string; thumbnail?: string; aiAnalysis?: { materialUrl?: string; materialPoster?: string } } } | undefined;
  const snapshot = snapshots.find(item => item.type === 'video' && (item.url || item.poster)) || snapshots.find(item => item.url || item.poster);
  return {
    url: String(snapshot?.url || kickoff?.generatedVideo?.url || kickoff?.video?.aiAnalysis?.materialUrl || kickoff?.video?.videoUrl || ''),
    poster: String(snapshot?.poster || kickoff?.generatedVideo?.poster || kickoff?.video?.aiAnalysis?.materialPoster || kickoff?.video?.thumbnail || ''),
  };
};

const modeLabel = (mode: unknown) => ({ material: '素材库智能生成', clone: '爆款裂变', product: '产品信息生成' }[String(mode)] || '智能创作');
const formatDate = (value?: string) => value ? new Date(value).toLocaleDateString('zh-CN') : '时间未记录';
const draftProgress = (project: StudioProject) => {
  const spec = project.spec || {};
  const hasVideo = Boolean(spec.posterImageUrl)
    || (spec.storyboardVideoVersions && Object.keys(spec.storyboardVideoVersions as object).length > 0)
    || (Array.isArray(spec.productVideoVersions) && spec.productVideoVersions.length > 0);
  if (hasVideo) return '已生成成片';
  if (spec.cover || spec.coverTitle) return '封面制作';
  if ((Array.isArray(spec.selected) && spec.selected.length) || (spec.storyboardAssignments && Object.keys(spec.storyboardAssignments as object).length)) return '素材编排';
  if (String(spec.script || '').trim()) return '脚本已生成';
  return '已选创作模式';
};

function HoverMedia({ title, poster, url }: { title: string; poster?: string; url?: string }) {
  return <div className="relative aspect-video overflow-hidden bg-slate-100">
    {url ? <video src={url} poster={poster} muted loop playsInline preload="metadata" className="h-full w-full object-cover" onMouseEnter={event => void event.currentTarget.play().catch(() => {})} onMouseLeave={event => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} />
      : poster ? <img src={poster} alt={title} className="h-full w-full object-cover" />
        : <div className="flex h-full items-center justify-center text-emerald-500"><Play size={28} /></div>}
  </div>;
}

function PageShell({ icon, title, description, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace-management-page flex h-full flex-col bg-white">
      <header className="shrink-0 border-b border-border px-5 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-start gap-3">
          <span className="mt-1 flex h-6 w-6 items-center justify-center text-accent">{icon}</span>
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
            <p className="mt-1 text-xs leading-5 text-text-muted">{description}</p>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#f8faf7] px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl">
          {children}
        </div>
      </main>
    </div>
  );
}

export function ScriptLibraryPage({ socialContentTaskId }: { socialContentTaskId?: string | null } = {}) {
  const [tab, setTab] = useState<'inspiration' | 'studio'>('inspiration');
  const [videos, setVideos] = useState<Array<ExactVideoRecord & { analysis: ExactAnalysis }>>([]);
  const [drafts, setDrafts] = useState<StudioProject[]>([]);
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [videoTimeFilter, setVideoTimeFilter] = useState<'all' | '7d' | '30d'>('all');
  const [creationModeFilter, setCreationModeFilter] = useState('all');
  const [draftTimeFilter, setDraftTimeFilter] = useState<'all' | '7d' | '30d'>('all');
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<(ExactVideoRecord & { analysis: ExactAnalysis }) | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<StudioProject | null>(null);
  const [draftBusyId, setDraftBusyId] = useState('');
  const [actionError, setActionError] = useState('');
  const videoAnalysisDialogRef = useModalFocus<HTMLElement>({
    open: Boolean(selectedVideo),
    onClose: () => setSelectedVideo(null),
  });
  const draftDetailDialogRef = useModalFocus<HTMLElement>({
    open: Boolean(selectedDraft),
    onClose: () => setSelectedDraft(null),
  });

  useEffect(() => {
    const prefill = consumeSessionPrefill<ScriptLibraryActionPrefill>(CONTENT_ACTION_STORAGE.scriptLibrary);
    if (prefill?.tab) setTab(prefill.tab);
    else if (prefill?.projectId) setTab('studio');
    else if (prefill?.contentId) setTab('inspiration');
    if (typeof prefill?.query === 'string') setQuery(prefill.query);

    void Promise.all([
      loadAllExactVideoRecords(),
      studioApi.listProjects(),
    ])
      .then(([records, projects]) => {
        const exactVideos = records.map(record => ({ ...record, analysis: parseAnalysis(record.aiAnalysis) })).filter(record => record.analysis.analysisMode === 'exact' && (record.analysis.scriptDetails15s?.length || 0) > 0);
        const draftProjects = projects.filter(project => project.status === 'draft');
        setVideos(exactVideos);
        setDrafts(draftProjects);
        if (prefill?.openDetail && prefill.contentId) {
          const match = exactVideos.find(record => record.id === prefill.contentId);
          if (match) setSelectedVideo(match);
        }
        if (prefill?.openDetail && prefill.projectId) {
          const match = draftProjects.find(project => project.id === prefill.projectId);
          if (match) setSelectedDraft(match);
        }
      })
      .catch(() => { setVideos([]); setDrafts([]); })
      .finally(() => setLoading(false));
  }, []);

  const filteredVideos = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const timeFloor = videoTimeFilter === '7d' ? Date.now() - 7 * 86400000 : videoTimeFilter === '30d' ? Date.now() - 30 * 86400000 : 0;
    return videos.filter(item => {
      if (platformFilter !== 'all' && String(item.platform || '').toLowerCase() !== platformFilter) return false;
      const itemTime = Date.parse(item.crawledAt || item.created || item.updated || '');
      if (timeFloor && (!Number.isFinite(itemTime) || itemTime < timeFloor)) return false;
      if (!keyword) return true;
      return `${item.title || ''} ${item.analysis.baseRequirements || ''} ${item.analysis.scriptDetails15s?.map(detail => `${structuralDetailText(detail)} ${detail.dialogue || ''} ${detail.subtitle || ''}`).join(' ') || ''}`.toLowerCase().includes(keyword);
    });
  }, [videos, query, platformFilter, videoTimeFilter]);
  const filteredDrafts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const timeFloor = draftTimeFilter === '7d' ? Date.now() - 7 * 86400000 : draftTimeFilter === '30d' ? Date.now() - 30 * 86400000 : 0;
    return drafts.filter(item => {
      const mode = String(item.spec?.mode || '');
      if (creationModeFilter !== 'all' && mode !== creationModeFilter) return false;
      const itemTime = Date.parse(item.updatedAt || item.createdAt || '');
      if (timeFloor && (!Number.isFinite(itemTime) || itemTime < timeFloor)) return false;
      return !keyword || `${item.title} ${String(item.spec?.script || '')}`.toLowerCase().includes(keyword);
    });
  }, [drafts, query, creationModeFilter, draftTimeFilter]);
  const availablePlatforms = useMemo(() => [...new Set(videos.map(item => String(item.platform || '').toLowerCase()).filter(Boolean))].sort(), [videos]);
  const visibleCount = tab === 'inspiration' ? filteredVideos.length : filteredDrafts.length;

  const openSmartAssets = () => window.dispatchEvent(new CustomEvent('lingshu:navigate', { detail: { page: 'smartAssets', view: 'create', socialContentTaskId, socialContentPage: 'smartAssets' } }));
  const startViralClone = (item: ExactVideoRecord & { analysis: ExactAnalysis }) => {
    const analysis = item.analysis;
    localStorage.setItem('ow_video_kickoff', JSON.stringify({
      source: 'inspiration_analysis',
      video: {
        id: item.id, recordId: item.id, platform: item.platform || 'tiktok', title: item.title,
        thumbnail: item.thumbnailUrl || analysis.materialPoster, duration: item.duration || 0,
        sourceUrl: item.sourceUrl, videoUrl: analysis.materialUrl || item.videoUrl,
        status: 'analyzed', contentFormat: 'video',
        aiAnalysis: { ...analysis, gemini: analysis.gemini || { baseRequirements: analysis.baseRequirements, scriptSummary15s: analysis.scriptSummary15s, scriptDetails15s: analysis.scriptDetails15s } },
      },
      scriptType: 'storyboard', language: 'zh',
      referenceAnalysis: {
        title: item.title,
        visualStyle: analysis.scriptSummary15s?.visualStyle || '',
        coreEmotion: analysis.scriptSummary15s?.coreEmotion || '',
        details: analysis.scriptDetails15s || [],
      },
    }));
    setSelectedVideo(null);
    openSmartAssets();
  };
  const continueDraft = (project: StudioProject) => {
    localStorage.setItem('ow_studio_open_project', JSON.stringify({ projectId: project.id, at: Date.now() }));
    setSelectedDraft(null);
    openSmartAssets();
  };
  const copyDraft = async (project: StudioProject) => {
    setDraftBusyId(project.id); setActionError('');
    try {
      const saved = await studioApi.saveProject({ title: `${project.title || '未命名草稿'} · 副本`, status: 'draft', spec: JSON.parse(JSON.stringify(project.spec || {})), thumbSeed: project.thumbSeed });
      if (!saved.ok || !saved.project) throw new Error('复制失败，请稍后重试');
      setDrafts(current => [saved.project, ...current]);
      setSelectedDraft(saved.project);
    } catch (error) { setActionError(error instanceof Error ? error.message : '复制失败，请稍后重试'); }
    finally { setDraftBusyId(''); }
  };
  const deleteDraft = async (project: StudioProject) => {
    if (!window.confirm(`确认删除草稿“${project.title}”吗？此操作无法撤销。`)) return;
    setDraftBusyId(project.id); setActionError('');
    try {
      await studioApi.deleteProject(project.id);
      setDrafts(current => current.filter(item => item.id !== project.id));
      setSelectedDraft(null);
    } catch { setActionError('删除失败，请稍后重试'); }
    finally { setDraftBusyId(''); }
  };

  return (
    <PageShell icon={<FileText size={14} />} title="脚本库" description="管理可直接裂变的爆款视频和全部历史创作草稿，让成熟内容可以持续复用。">
      <div className="mb-4 flex gap-7 border-b border-border">
        <button type="button" onClick={() => { setTab('inspiration'); setQuery(''); }} className={`h-11 border-b-2 px-1 text-sm font-semibold transition-colors ${tab === 'inspiration' ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>可裂变爆款</button>
        <button type="button" onClick={() => { setTab('studio'); setQuery(''); }} className={`h-11 border-b-2 px-1 text-sm font-semibold transition-colors ${tab === 'studio' ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>历史创作</button>
      </div>
      <div className="mb-4 flex items-center gap-3 border-b border-border bg-white px-1 py-3">
        <Search size={16} className="text-text-muted" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'inspiration' ? '搜索视频标题或脚本详析' : '搜索草稿标题或脚本'} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted" />
        <span className="text-xs font-semibold text-text-muted">{visibleCount} 条</span>
      </div>
      <div className="mb-4 flex flex-wrap gap-3 border-b border-border bg-white px-1 py-3">
        {tab === 'inspiration' ? <>
          <label className="min-w-44 flex-1"><span className="mb-1 block text-[10px] font-bold text-text-muted">社媒平台</span><select value={platformFilter} onChange={event => setPlatformFilter(event.target.value)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><option value="all">全部平台</option>{availablePlatforms.map(platform => <option key={platform} value={platform}>{platform}</option>)}</select></label>
          <label className="min-w-44 flex-1"><span className="mb-1 block text-[10px] font-bold text-text-muted">入库时间</span><select value={videoTimeFilter} onChange={event => setVideoTimeFilter(event.target.value as 'all' | '7d' | '30d')} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><option value="all">全部时间</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label>
        </> : <>
          <label className="min-w-44 flex-1"><span className="mb-1 block text-[10px] font-bold text-text-muted">创作模式</span><select value={creationModeFilter} onChange={event => setCreationModeFilter(event.target.value)} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><option value="all">全部模式</option><option value="material">素材库智能生成</option><option value="clone">爆款裂变</option><option value="product">产品信息生成</option></select></label>
          <label className="min-w-44 flex-1"><span className="mb-1 block text-[10px] font-bold text-text-muted">更新时间</span><select value={draftTimeFilter} onChange={event => setDraftTimeFilter(event.target.value as 'all' | '7d' | '30d')} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-text-secondary"><option value="all">全部时间</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select></label>
        </>}
      </div>
      {loading ? (
        <div className="rounded-2xl border border-border bg-white p-10 text-center text-sm text-text-muted">正在读取脚本库…</div>
      ) : tab === 'inspiration' && filteredVideos.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredVideos.map(item => {
          const details = item.analysis.scriptDetails15s || [];
          const preview = [
            item.analysis.baseRequirements ? `基础要求：${item.analysis.baseRequirements}` : '',
            ...details.slice(0, 2).map(structuralDetailText),
          ].filter(Boolean).join('；');
          const tags = [...(item.analysis.hooks || []), ...(item.analysis.sellingPoints || [])].filter(Boolean).slice(0, 3);
          return <article key={item.id} className="overflow-hidden rounded-2xl border border-border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <HoverMedia title={item.title || '精确分析视频'} poster={item.thumbnailUrl || item.analysis.materialPoster} url={item.analysis.materialUrl || item.videoUrl || item.sourceUrl} />
            <div className="p-4"><div className="flex items-start justify-between gap-3"><h2 className="line-clamp-2 text-sm font-black text-text-primary">{item.title || '未命名视频'}</h2><span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">可直接裂变</span></div><p className="mt-2 line-clamp-3 text-xs leading-5 text-text-secondary">{preview || '点击查看完整脚本详析'}</p>{tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className="max-w-full truncate rounded-md bg-surface-2 px-2 py-1 text-[10px] font-bold text-text-secondary">{tag}</span>)}</div>}<p className="mt-3 text-[10px] font-bold text-text-muted">{item.platform || '社媒视频'} · {details.length} 个分析分镜 · {formatDate(item.crawledAt || item.created || item.updated)}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => setSelectedVideo(item)} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2">查看分析</button><button type="button" onClick={() => startViralClone(item)} className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700">开始裂变<ArrowRight size={13} /></button></div></div>
          </article>;
        })}</div>
      ) : tab === 'studio' && filteredDrafts.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filteredDrafts.map(project => {
          const media = firstDraftMedia(project); const script = String(project.spec?.script || '');
          return <article key={project.id} className="overflow-hidden rounded-2xl border border-border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <HoverMedia title={project.title} poster={media.poster} url={media.url} />
            {productionSummary(project.spec || {}) && <p className="px-4 pt-3 text-[10px] text-amber-700">{productionSummary(project.spec || {})}</p>}
            <div className="p-4"><button type="button" onClick={() => setSelectedDraft(project)} className="block w-full text-left"><div className="flex items-start justify-between gap-3"><h2 className="line-clamp-2 text-sm font-black text-text-primary">{project.title || '未命名草稿'}</h2><span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-700">{draftProgress(project)}</span></div><p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-text-secondary">{script || '草稿尚未生成脚本内容'}</p><p className="mt-3 flex items-center gap-1 text-[10px] text-text-muted"><Clock3 size={11} />{modeLabel(project.spec?.mode)} · {formatDate(project.updatedAt || project.createdAt)}</p></button><div className="mt-4 flex gap-2"><button type="button" onClick={() => continueDraft(project)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">继续创作<ArrowRight size={13} /></button><button type="button" disabled={draftBusyId === project.id} title="复制草稿" onClick={() => void copyDraft(project)} className="rounded-lg border border-border p-2 text-text-secondary hover:bg-surface-2 disabled:opacity-50"><Copy size={14} /></button><button type="button" disabled={draftBusyId === project.id} title="删除草稿" onClick={() => void deleteDraft(project)} className="rounded-lg border border-border p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-50">{draftBusyId === project.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}</button></div></div>
          </article>;
        })}</div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-white p-12 text-center">
          <Sparkles size={28} className="mx-auto text-emerald-500" />
          <h2 className="mt-3 text-sm font-bold text-text-primary">{tab === 'inspiration' ? '暂无可裂变爆款' : '暂无历史创作草稿'}</h2>
          <p className="mt-1 text-xs text-text-muted">{tab === 'inspiration' ? '在灵感大屏完成视频的全篇精确分析后，会自动进入这里。' : '在智能素材中保存草稿后，会自动进入这里。'}</p>
        </div>
      )}
      {actionError && <div className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded-xl bg-rose-600 px-4 py-3 text-xs font-bold text-white shadow-xl">{actionError}</div>}
      {selectedVideo && <div className="fixed inset-0 z-[100] bg-slate-950/45 backdrop-blur-sm" onClick={() => setSelectedVideo(null)}>
        <aside ref={videoAnalysisDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="script-library-video-dialog-title" className="ml-auto flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
          <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4"><div><h2 id="script-library-video-dialog-title" className="text-base font-black text-text-primary">{selectedVideo.title || '全篇精确分析'}</h2><p className="mt-1 text-xs text-text-muted">{selectedVideo.platform || '社媒视频'} · {selectedVideo.analysis.scriptDetails15s?.length || 0} 个分析分镜</p></div><button type="button" data-modal-initial-focus aria-label="关闭视频分析" onClick={() => setSelectedVideo(null)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button></header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><HoverMedia title={selectedVideo.title || ''} poster={selectedVideo.thumbnailUrl || selectedVideo.analysis.materialPoster} url={selectedVideo.analysis.materialUrl || selectedVideo.videoUrl || selectedVideo.sourceUrl} />
            <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[
              ['平台', selectedVideo.platform || '未记录'],
              ['播放', selectedVideo.analysis.publicMetrics?.plays || selectedVideo.analysis.views || '未记录'],
              ['入库时间', formatDate(selectedVideo.crawledAt || selectedVideo.created)],
              ['分析时间', formatDate(selectedVideo.analysis.analyzedAt)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-surface-2 px-3 py-2"><p className="text-[10px] font-bold text-text-muted">{label}</p><p className="mt-1 truncate text-xs font-black text-text-primary">{value}</p></div>)}</section>
            {(selectedVideo.analysis.theme || selectedVideo.analysis.mood || selectedVideo.analysis.hooks?.length || selectedVideo.analysis.sellingPoints?.length) && <section className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4"><h3 className="text-xs font-black text-emerald-800">为什么值得裂变</h3>{selectedVideo.analysis.theme && <p className="mt-2 text-xs leading-5 text-text-secondary"><b>主题：</b>{selectedVideo.analysis.theme}</p>}{selectedVideo.analysis.mood && <p className="mt-1 text-xs leading-5 text-text-secondary"><b>情绪：</b>{selectedVideo.analysis.mood}</p>}{selectedVideo.analysis.hooks?.length ? <p className="mt-1 text-xs leading-5 text-text-secondary"><b>内容钩子：</b>{selectedVideo.analysis.hooks.join('；')}</p> : null}{selectedVideo.analysis.sellingPoints?.length ? <p className="mt-1 text-xs leading-5 text-text-secondary"><b>卖点：</b>{selectedVideo.analysis.sellingPoints.join('；')}</p> : null}</section>}
            {selectedVideo.analysis.firstTenSeconds && Object.values(selectedVideo.analysis.firstTenSeconds).some(Boolean) && <section className="mt-4 rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">前 10 秒五维拆解</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{[
              ['氛围', selectedVideo.analysis.firstTenSeconds.atmosphere], ['声画配合', selectedVideo.analysis.firstTenSeconds.audioVisual], ['镜头', selectedVideo.analysis.firstTenSeconds.camera], ['画面', selectedVideo.analysis.firstTenSeconds.visuals], ['口播与音乐', selectedVideo.analysis.firstTenSeconds.voiceMusic],
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => <div key={label} className="rounded-lg bg-surface-2 px-3 py-2"><p className="text-[10px] font-black text-emerald-700">{label}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{value}</p></div>)}</div></section>}
            {(selectedVideo.analysis.scriptSummary15s?.visualStyle || selectedVideo.analysis.scriptSummary15s?.coreEmotion || selectedVideo.analysis.scriptSummary15s?.competitors?.length) && <section className="mt-4 rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">内容摘要</h3>{selectedVideo.analysis.scriptSummary15s?.visualStyle && <p className="mt-2 text-xs leading-5 text-text-secondary"><b>视觉风格：</b>{selectedVideo.analysis.scriptSummary15s.visualStyle}</p>}{selectedVideo.analysis.scriptSummary15s?.coreEmotion && <p className="mt-1 text-xs leading-5 text-text-secondary"><b>核心情绪：</b>{selectedVideo.analysis.scriptSummary15s.coreEmotion}</p>}{selectedVideo.analysis.scriptSummary15s?.competitors?.length ? <p className="mt-1 text-xs leading-5 text-text-secondary"><b>参考品牌/竞品：</b>{selectedVideo.analysis.scriptSummary15s.competitors.join('；')}</p> : null}</section>}
            {selectedVideo.analysis.globalSettings && Object.values(selectedVideo.analysis.globalSettings).some(value => Array.isArray(value) ? value.length : Boolean(value)) && <section className="mt-4 rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">全局制作要求</h3><div className="mt-2 space-y-1">{[
              ['视觉风格', selectedVideo.analysis.globalSettings.visualStyle], ['画幅', selectedVideo.analysis.globalSettings.aspectRatio], ['灯光', selectedVideo.analysis.globalSettings.lighting], ['字幕策略', selectedVideo.analysis.globalSettings.subtitlePolicy], ['声音策略', selectedVideo.analysis.globalSettings.audioPolicy], ['人物一致性', selectedVideo.analysis.globalSettings.identityConsistency], ['产品一致性', selectedVideo.analysis.globalSettings.productConsistency], ['避免事项', selectedVideo.analysis.globalSettings.negativeConstraints?.join('；')],
            ].filter(([, value]) => Boolean(value)).map(([label, value]) => <p key={label} className="text-xs leading-5 text-text-secondary"><b>{label}：</b>{value}</p>)}</div></section>}
            {selectedVideo.analysis.coarseStructure?.length ? <section className="mt-4 rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">内容结构</h3><div className="mt-3 space-y-2">{selectedVideo.analysis.coarseStructure.map((step, index) => <div key={`${step.time}-${index}`} className="flex gap-3 rounded-lg bg-surface-2 px-3 py-2"><span className="shrink-0 text-[10px] font-black text-emerald-700">{step.time || `阶段 ${index + 1}`}</span><p className="text-xs leading-5 text-text-secondary"><b>{step.label || step.frame || '内容阶段'}</b>{(step.description || step.desc) ? `：${step.description || step.desc}` : ''}</p></div>)}</div></section> : null}
            {selectedVideo.analysis.baseRequirements && <section className="mt-4 rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">基础要求</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-text-secondary">{selectedVideo.analysis.baseRequirements}</p></section>}
            <h3 className="mt-5 text-sm font-black text-text-primary">分镜脚本详析</h3><div className="mt-3 space-y-3">{(selectedVideo.analysis.scriptDetails15s || []).map((detail, index) => <section key={`${detail.time || detail.timestamp}-${index}`} className="rounded-xl border border-border p-4"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{detail.time || detail.timestamp || `分镜 ${index + 1}`}</span><strong className="text-xs text-text-primary">{detail.purpose || detail.shot || '脚本分镜'}</strong></div>{typeof detail.confidence === 'number' && <span className="text-[10px] font-bold text-text-muted">识别置信度 {Math.round(detail.confidence * 100)}%</span>}</div>{detail.environment && <p className="mt-2 text-xs leading-5 text-text-secondary"><b>环境：</b>{detail.environment}</p>}{(detail.shot || detail.camera || detail.angle || detail.composition) && <p className="mt-1 text-xs leading-5 text-text-secondary"><b>镜头设计：</b>{[detail.shot, detail.camera, detail.angle, detail.composition].filter(Boolean).join('；')}</p>}{detail.visual && <p className="mt-1 text-xs leading-5 text-text-secondary"><b>画面：</b>{detail.visual}</p>}{detail.onScreenText && <p className="mt-1 text-xs leading-5 text-text-secondary"><b>屏幕文字：</b>{detail.onScreenText}</p>}{(detail.bgm || detail.audio || detail.ambientSound || detail.soundEffects?.length) && <p className="mt-1 text-xs leading-5 text-text-secondary"><b>声音设计：</b>{[detail.bgm || detail.audio, detail.ambientSound, detail.soundEffects?.join('、')].filter(Boolean).join('；')}</p>}{(detail.startState || detail.endState || detail.transitionToNext || detail.persistentState) && <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2"><summary className="cursor-pointer text-[11px] font-bold text-text-muted">查看连续性与转场</summary><div className="mt-2 space-y-1 text-xs leading-5 text-text-secondary">{detail.startState && <p><b>开始状态：</b>{detail.startState}</p>}{detail.endState && <p><b>结束状态：</b>{detail.endState}</p>}{detail.persistentState && <p><b>持续状态：</b>{detail.persistentState}</p>}{detail.transitionToNext && <p><b>下镜转场：</b>{detail.transitionToNext}</p>}</div></details>}{detail.beats?.length ? <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2"><summary className="cursor-pointer text-[11px] font-bold text-text-muted">查看镜头内节拍（{detail.beats.length}）</summary><div className="mt-2 space-y-1">{detail.beats.map((beat, beatIndex) => <p key={beatIndex} className="text-xs leading-5 text-text-secondary">[{beat.time || '镜头内'}] {[beat.action, beat.dialogue ? `口播：${beat.dialogue}` : '', beat.onScreenText ? `字幕：${beat.onScreenText}` : ''].filter(Boolean).join('；')}</p>)}</div></details> : null}{(detail.dialogue || detail.subtitle) && <details className="mt-2 rounded-lg bg-surface-2 px-3 py-2"><summary className="cursor-pointer text-[11px] font-bold text-text-muted">查看原口播/字幕</summary><p className="mt-2 text-xs leading-5 text-text-secondary">{detail.dialogue || detail.subtitle}</p></details>}{detail.note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700"><b>复核备注：</b>{detail.note}</p>}</section>)}</div>
            {selectedVideo.analysis.adaptTip && <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"><h3 className="text-xs font-black text-emerald-800">改编建议</h3><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-text-secondary">{selectedVideo.analysis.adaptTip}</p></section>}
          </div><footer className="shrink-0 border-t border-border bg-white p-4"><button type="button" onClick={() => startViralClone(selectedVideo)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700"><Sparkles size={16} />开始爆款裂变<ArrowRight size={16} /></button></footer>
        </aside></div>}
      {selectedDraft && <div className="fixed inset-0 z-[100] bg-slate-950/45 backdrop-blur-sm" onClick={() => setSelectedDraft(null)}><aside ref={draftDetailDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="script-library-draft-dialog-title" className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onClick={event => event.stopPropagation()}><header className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 id="script-library-draft-dialog-title" className="text-base font-black text-text-primary">{selectedDraft.title}</h2><p className="mt-1 text-xs text-text-muted">{modeLabel(selectedDraft.spec?.mode)} · {draftProgress(selectedDraft)} · 更新于 {formatDate(selectedDraft.updatedAt || selectedDraft.createdAt)}</p></div><button type="button" data-modal-initial-focus aria-label="关闭草稿详情" onClick={() => setSelectedDraft(null)} className="rounded-lg p-2 text-text-muted hover:bg-surface-2"><X size={18} /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5"><HoverMedia title={selectedDraft.title} {...firstDraftMedia(selectedDraft)} /><h3 className="mt-5 text-sm font-black text-text-primary">草稿脚本</h3><pre className="mt-2 whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-xs leading-6 text-text-secondary">{String(selectedDraft.spec?.script || '草稿尚未生成脚本内容')}</pre></div><footer className="flex shrink-0 gap-2 border-t border-border bg-white p-4"><button type="button" onClick={() => continueDraft(selectedDraft)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white">继续创作<ArrowRight size={15} /></button><button type="button" disabled={draftBusyId === selectedDraft.id} onClick={() => void copyDraft(selectedDraft)} className="flex items-center gap-2 rounded-xl border border-border px-4 text-xs font-bold text-text-secondary"><Copy size={14} />复制</button><button type="button" disabled={draftBusyId === selectedDraft.id} onClick={() => void deleteDraft(selectedDraft)} className="rounded-xl border border-rose-200 px-4 text-rose-600"><Trash2 size={15} /></button></footer></aside></div>}
    </PageShell>
  );
}

export function AgentMemoryPage({ includeMockCustomers = false, mockCustomerScope = 'admin' }: { includeMockCustomers?: boolean; mockCustomerScope?: string } = {}) {
  type MemoryTab = 'content' | 'style' | 'customer' | 'strategy';
  type MemoryEditor =
    | { kind: 'customer-add'; customerId: string; customerName: string; key: string; value: string; expiresAt: string; existingKeys: string[] }
    | { kind: 'customer-edit'; id: string; key: string; value: string; expiresAt: string }
    | { kind: 'style-edit'; id: string; finalSent: string }
    | { kind: 'strategy-edit'; id: string; adjustment: string };
  type MemoryConfirm = { title: string; description: string; confirmLabel: string; danger?: boolean; action: () => Promise<unknown> | void };
  type ContentMemory = {
    id: string; kind: 'analysis' | 'draft'; title: string; source: string; updated?: string;
    description: string; tags: string[]; poster?: string; evidence: string[]; usage: string;
  };
  const [tab, setTab] = useState<MemoryTab>(includeMockCustomers ? 'style' : 'content');
  const [contentMemories, setContentMemories] = useState<ContentMemory[]>([]);
  const [styleProfile, setStyleProfile] = useState<Record<string, unknown> | null>(null);
  const [customerContexts, setCustomerContexts] = useState<Array<Record<string, unknown>>>([]);
  const [responseStrategies, setResponseStrategies] = useState<Array<Record<string, unknown>>>([]);
  const [styleEvidence, setStyleEvidence] = useState<Array<Record<string, unknown>>>([]);
  const [customerMemories, setCustomerMemories] = useState<Array<Record<string, unknown>>>([]);
  const [memoryAudit, setMemoryAudit] = useState<Array<Record<string, unknown>>>([]);
  const [memoryOverview, setMemoryOverview] = useState<Record<string, any> | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryLoadError, setMemoryLoadError] = useState('');
  const [memoryBusy, setMemoryBusy] = useState('');
  const [memoryNotice, setMemoryNotice] = useState('');
  const [memoryEditor, setMemoryEditor] = useState<MemoryEditor | null>(null);
  const [memoryConfirm, setMemoryConfirm] = useState<MemoryConfirm | null>(null);
  const [opsOverview, setOpsOverview] = useState<ContentOpsOverview | null>(null);
  const [executionIntent, setExecutionIntent] = useState<ContentOpsExecutionIntent | null>(null);
  const [opsLoading, setOpsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ContentMemory | null>(null);
  const memoryEditorDialogRef = useModalFocus<HTMLFormElement>({
    open: Boolean(memoryEditor),
    onClose: () => { if (!memoryBusy) setMemoryEditor(null); },
    closeOnEscape: () => !memoryBusy,
  });
  const memoryConfirmDialogRef = useModalFocus<HTMLElement>({
    open: Boolean(memoryConfirm),
    onClose: () => setMemoryConfirm(null),
  });
  const tabs: Array<{ id: MemoryTab; label: string; icon: typeof Sparkles }> = [
    { id: 'content', label: '内容运营经验', icon: Sparkles },
    { id: 'style', label: '沟通风格', icon: MessageCircle },
    { id: 'customer', label: '客户上下文', icon: Users },
    { id: 'strategy', label: '响应策略', icon: Workflow },
  ];

  const loadMemoryGovernance = async (silent = false) => {
    if (!silent) setMemoryLoading(true);
    setMemoryLoadError('');
    try {
      const headers = authHeader();
      const [overviewResponse, evidenceResponse, customerMemoryResponse, strategyResponse, auditResponse] = await Promise.all([
        fetch('/api/overseas/agent-memory/overview', { headers }),
        fetch('/api/overseas/agent-memory/style-evidence', { headers }),
        fetch('/api/overseas/agent-memory/customer-memories', { headers }),
        fetch('/api/overseas/agent-memory/strategies', { headers }),
        fetch('/api/overseas/agent-memory/audit', { headers }),
      ]);
      if (!overviewResponse.ok) throw new Error('智能体记忆暂时加载失败，请重试。');
      const [overview, evidence, customerMemory, strategies, audit] = await Promise.all([
        overviewResponse.json(),
        evidenceResponse.ok ? evidenceResponse.json() : { items: [] },
        customerMemoryResponse.ok ? customerMemoryResponse.json() : { items: [] },
        strategyResponse.ok ? strategyResponse.json() : { items: [] },
        auditResponse.ok ? auditResponse.json() : { items: [] },
      ]);
      setMemoryOverview(overview && typeof overview === 'object' ? overview : null);
      setStyleEvidence(Array.isArray(evidence.items) ? evidence.items : []);
      setCustomerMemories(Array.isArray(customerMemory.items) ? customerMemory.items : []);
      setResponseStrategies(Array.isArray(strategies.items) ? strategies.items : []);
      setMemoryAudit(Array.isArray(audit.items) ? audit.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : '智能体记忆暂时加载失败，请重试。';
      setMemoryLoadError(message);
      throw error;
    } finally {
      if (!silent) setMemoryLoading(false);
    }
  };

  const memoryMutation = async (busyKey: string, url: string, method: string, body?: Record<string, unknown>, successMessage?: string) => {
    setMemoryBusy(busyKey);
    setMemoryNotice('');
    try {
      const response = await fetch(url, {
        method,
        headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.message || payload.error || '操作失败'));
      const latency = Number(payload.latencyMs || payload.latency || 0);
      setMemoryNotice(successMessage || (busyKey === 'model-check'
        ? `模型连接正常${latency > 0 ? `，耗时 ${latency} ms` : ''}。`
        : '操作已保存，并写入审计记录。'));
      await loadMemoryGovernance(true);
      return payload;
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally {
      setMemoryBusy('');
    }
  };

  const addCustomerMemory = (customer: Record<string, unknown>, existingKeys: string[] = []) => {
    const customerId = String(customer.id || '');
    if (!customerId) return;
    const key = memoryKeyOptions.find(([value]) => !existingKeys.includes(value))?.[0];
    if (!key) return;
    setMemoryNotice('');
    setMemoryEditor({ kind: 'customer-add', customerId, customerName: String(customer.name || '该客户'), key, value: key === 'product_preference' ? String(customer.product || '') : '', expiresAt: '', existingKeys });
  };

  const editCustomerMemory = (memory: Record<string, unknown>) => {
    setMemoryNotice('');
    setMemoryEditor({ kind: 'customer-edit', id: String(memory.id), key: String(memory.key || 'other'), value: String(memory.value || ''), expiresAt: String(memory.expiresAt || '').slice(0, 10) });
  };

  const editStyleEvidence = (evidence: Record<string, unknown>) => {
    setMemoryNotice('');
    setMemoryEditor({ kind: 'style-edit', id: String(evidence.id), finalSent: String(evidence.finalSent || '') });
  };

  const editStrategy = (strategy: Record<string, unknown>) => {
    setMemoryNotice('');
    setMemoryEditor({ kind: 'strategy-edit', id: String(strategy.id), adjustment: String(strategy.adjustment || '') });
  };

  const submitMemoryEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!memoryEditor) return;
    let payload: unknown = null;
    if (memoryEditor.kind === 'customer-add' && memoryEditor.value.trim()) {
      if (memoryEditor.existingKeys.includes(memoryEditor.key)) {
        setMemoryNotice('这类客户记忆已经存在，请直接编辑原记录。');
        return;
      }
      payload = await memoryMutation(`customer-add-${memoryEditor.customerId}`, '/api/overseas/agent-memory/customer-memories', 'POST', {
        customerId: memoryEditor.customerId, key: memoryEditor.key, value: memoryEditor.value.trim(), evidence: '管理员根据客户上下文人工确认', sourceKind: 'human', status: 'confirmed', expiresAt: memoryEditor.expiresAt,
      });
    } else if (memoryEditor.kind === 'customer-edit' && memoryEditor.value.trim()) {
      payload = await memoryMutation(`customer-edit-${memoryEditor.id}`, `/api/overseas/agent-memory/customer-memories/${memoryEditor.id}`, 'PATCH', { value: memoryEditor.value.trim(), expiresAt: memoryEditor.expiresAt });
    } else if (memoryEditor.kind === 'style-edit' && memoryEditor.finalSent.trim()) {
      payload = await memoryMutation(`style-edit-${memoryEditor.id}`, `/api/overseas/agent-memory/style-evidence/${memoryEditor.id}`, 'PATCH', { finalSent: memoryEditor.finalSent.trim() });
    } else if (memoryEditor.kind === 'strategy-edit') {
      payload = await memoryMutation(`strategy-edit-${memoryEditor.id}`, `/api/overseas/agent-memory/strategies/${memoryEditor.id}`, 'PATCH', { adjustment: memoryEditor.adjustment.trim() });
    }
    if (payload) setMemoryEditor(null);
  };

  const exportMemoryBackup = async () => {
    setMemoryBusy('backup');
    setMemoryNotice('');
    try {
      const response = await fetch('/api/overseas/agent-memory/backup', { headers: authHeader() });
      if (!response.ok) throw new Error(String((await response.json().catch(() => ({}))).message || '备份导出失败'));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `agent-memory-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMemoryNotice('租户级记忆备份已导出。恢复时服务端会再次校验企业归属。');
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : '备份导出失败');
    } finally {
      setMemoryBusy('');
    }
  };

  const performRestoreMemoryBackup = async (file: File) => {
    setMemoryBusy('restore');
    setMemoryNotice('');
    try {
      const backup = JSON.parse(await file.text()) as Record<string, unknown>;
      const response = await fetch('/api/overseas/agent-memory/backup/restore', {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(backup),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.message || payload.error || '备份恢复失败'));
      setMemoryNotice(`备份恢复完成，共处理 ${Number(payload.restored || 0)} 条租户隔离记录。`);
      await loadMemoryGovernance(true);
    } catch (error) {
      setMemoryNotice(error instanceof Error ? error.message : '备份文件无效');
    } finally {
      setMemoryBusy('');
    }
  };

  const restoreMemoryBackup = (file: File) => {
    setMemoryConfirm({
      title: '恢复智能体记忆备份',
      description: '只接受当前企业导出的备份。同 ID 数据会更新，其他企业的数据不会被读取。',
      confirmLabel: '确认恢复',
      action: () => performRestoreMemoryBackup(file),
    });
  };

  useEffect(() => {
    void loadMemoryGovernance().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!memoryEditor && !memoryConfirm) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || memoryBusy) return;
      setMemoryEditor(null);
      setMemoryConfirm(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [memoryBusy, memoryConfirm, memoryEditor]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadAllExactVideoRecords(), studioApi.listProjects(),
      fetch('/api/overseas/enterprise/profile', { headers: authHeader() }).then(response => response.ok ? response.json() : {}),
      fetch('/api/overseas/customers', { headers: authHeader() }).then(response => response.ok ? response.json() : { items: [] }),
      fetch('/api/overseas/agent-memory/strategies', { headers: authHeader() }).then(response => response.ok ? response.json() : { items: [] }),
    ])
      .then(async ([records, projects, enterprise, customers, strategies]) => {
        if (!active) return;
        const mockCustomerContexts = includeMockCustomers && import.meta.env.DEV
          ? (await import('../mocks/customerProfiles')).createMockCustomers(mockCustomerScope).map(customer => ({
            id: customer.id,
            name: customer.name,
            product: customer.product,
            countryName: customer.countryName,
            language: customer.language,
            stage: customer.stage,
            summary: customer.summary,
            nextStep: customer.nextStep,
            intentSignals: customer.intentSignals,
            tags: [...customer.tags, '模拟场景'],
          }))
          : [];
        if (!active) return;
        const analyses: ContentMemory[] = records.map(record => ({ record, analysis: parseAnalysis(record.aiAnalysis) }))
          .filter(({ analysis }) => analysis.analysisMode === 'exact' && Boolean(analysis.scriptDetails15s?.length))
          .map(({ record, analysis }) => ({
            id: `analysis-${record.id}`, kind: 'analysis', title: record.title || '未命名精确分析',
            source: `灵感大屏 · ${record.platform || '平台未记录'}`,
            updated: analysis.analyzedAt || record.updated || record.crawledAt,
            description: analysis.baseRequirements || analysis.structure || structuralDetailText(analysis.scriptDetails15s?.[0] || {}) || '已完成全篇精确分析，可用于后续爆款裂变。',
            tags: [...(analysis.hooks || []), ...(analysis.sellingPoints || [])].filter(Boolean).slice(0, 4),
            poster: record.thumbnailUrl || analysis.materialPoster,
            evidence: [
              analysis.scriptDetails15s?.length ? `${analysis.scriptDetails15s.length} 个分析分镜` : '',
              analysis.hooks?.length ? `${analysis.hooks.length} 个内容钩子` : '',
              analysis.sellingPoints?.length ? `${analysis.sellingPoints.length} 个卖点` : '',
            ].filter(Boolean),
            usage: '可在脚本库查看完整分析，并作为爆款裂变的参考视频。',
          }));
        const drafts: ContentMemory[] = projects.filter(project => project.status === 'draft').map(project => {
          const media = firstDraftMedia(project);
          return {
            id: `draft-${project.id}`, kind: 'draft', title: project.title || '未命名创作草稿',
            source: `智能素材 · ${modeLabel(project.spec?.mode)}`,
            updated: project.updatedAt || project.createdAt,
            description: String(project.spec?.script || '').trim().slice(0, 240) || `当前进度：${draftProgress(project)}`,
            tags: [draftProgress(project), modeLabel(project.spec?.mode)], poster: media.poster,
            evidence: [String(project.spec?.script || '').trim() ? '已有创作脚本' : '', media.url || media.poster ? '已有创作素材' : ''].filter(Boolean),
            usage: '来自历史创作草稿，仅作为可继续编辑和复用的创作记录。',
          };
        });
        setContentMemories([...analyses, ...drafts].sort((a, b) => Date.parse(b.updated || '') - Date.parse(a.updated || '')));
        const enterpriseRecord = enterprise as { salesStyleProfile?: Record<string, unknown> };
        setStyleProfile(enterpriseRecord.salesStyleProfile || null);
        const customerPayload = customers as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
        const liveCustomerContexts = Array.isArray(customerPayload) ? customerPayload : Array.isArray(customerPayload.items) ? customerPayload.items : [];
        const liveIds = new Set(liveCustomerContexts.map(customer => String(customer.id || '')));
        setCustomerContexts([...liveCustomerContexts, ...mockCustomerContexts.filter(customer => !liveIds.has(customer.id))]);
        const strategyPayload = strategies as { items?: Array<Record<string, unknown>> };
        setResponseStrategies(Array.isArray(strategyPayload.items) ? strategyPayload.items : []);
      })
      .catch(() => active && setContentMemories([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [includeMockCustomers, mockCustomerScope]);

  useEffect(() => {
    let active = true;
    void fetch('/api/overseas/agent-memory/content-overview', { headers: authHeader() })
      .then(async response => {
        if (response.ok) return contentOpsOverview(await response.json());
        const [overviewResponse, trendResponse] = await Promise.all([
          fetch('/api/overseas/social-metrics/overview?days=30', { headers: authHeader() }),
          fetch('/api/overseas/social-metrics/trends?metric=views', { headers: authHeader() }),
        ]);
        if (!overviewResponse.ok) return null;
        const overview = await overviewResponse.json();
        const trend = trendResponse.ok ? await trendResponse.json() : null;
        return socialMetricsOpsOverview(overview, trend);
      })
      .then(result => {
        if (!active) return;
        // Synthetic operating metrics belong only to the explicitly opened
        // simulation workspace. Normal tenant pages must stay empty until a
        // real platform snapshot is available, including during development.
        setOpsOverview(includeMockCustomers && import.meta.env.DEV && !hasContentOpsData(result)
          ? MOCK_CONTENT_OPS_OVERVIEW
          : result);
      })
      .catch(() => {
        if (active) setOpsOverview(includeMockCustomers && import.meta.env.DEV ? MOCK_CONTENT_OPS_OVERVIEW : null);
      })
      .finally(() => { if (active) setOpsLoading(false); });
    return () => { active = false; };
  }, [includeMockCustomers]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return contentMemories;
    return contentMemories.filter(item => `${item.title} ${item.source} ${item.description} ${item.tags.join(' ')}`.toLowerCase().includes(keyword));
  }, [contentMemories, query]);

  const customerStageLabels: Record<string, string> = { lead: '新线索', inquiry: '需求确认', quoted: '已报价', won: '已成交', silent30: '沉默 30 天', silent60: '沉默 60 天' };
  const strategySourceLabels: Record<string, string> = { learned_custom: 'AI 学习 · 人工确认', human: '人工设置', system: '系统策略', mock_seed: '演示策略' };
  const customerMemoryStatusLabels: Record<string, string> = { confirmed: '已确认', pending: '待确认', conflict: '有冲突', paused: '已停用', expired: '已过期' };
  const memoryKeyOptions = [
    ['preferred_language', '常用语言'], ['preferred_tone', '沟通语气'], ['communication_preference', '沟通偏好'],
    ['product_preference', '产品偏好'], ['buying_context', '采购背景'], ['schedule_preference', '时间偏好'], ['other', '其他'],
  ];
  const memoryKeyLabels = Object.fromEntries(memoryKeyOptions) as Record<string, string>;
  const confirmMemoryAction = async () => {
    if (!memoryConfirm) return;
    const action = memoryConfirm.action;
    setMemoryConfirm(null);
    await action();
  };
  return (
    <PageShell icon={<BrainCircuit size={14} />} title="智能体记忆" description="查看智能体从真实业务中沉淀的经验，并明确每条记忆的来源、用途与使用边界。">
      <div className="mb-4 flex gap-6 overflow-x-auto border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { setTab(id); setQuery(''); }} className={`flex h-11 shrink-0 items-center justify-center gap-2 border-b-2 px-1 text-xs font-semibold transition-colors ${tab === id ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'}`}><Icon size={15} className={tab === id ? 'text-emerald-600' : ''} />{label}</button>)}
      </div>
      {tab !== 'content' && memoryLoadError && memoryOverview && <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800" role="alert"><span>{memoryLoadError} 当前仍显示上次成功加载的数据。</span><button type="button" onClick={() => void loadMemoryGovernance().catch(() => undefined)} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 font-black">重试</button></div>}
      {tab !== 'content' && memoryLoading ? <section className="rounded-2xl border border-border bg-white p-8 text-center shadow-sm" aria-live="polite"><Loader2 size={22} className="mx-auto animate-spin text-emerald-600" /><p className="mt-3 text-xs font-semibold text-text-muted">正在加载该企业的记忆记录…</p></section> : tab !== 'content' && memoryLoadError && !memoryOverview ? <section className="rounded-2xl border border-rose-100 bg-rose-50/60 p-6 text-center shadow-sm" role="alert"><CircleAlert size={22} className="mx-auto text-rose-600" /><h2 className="mt-3 text-sm font-black text-rose-900">记忆记录没有加载成功</h2><p className="mt-1 text-xs leading-5 text-rose-700">{memoryLoadError}</p><button type="button" onClick={() => void loadMemoryGovernance().catch(() => undefined)} className="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-xs font-black text-white">重新加载</button></section> : tab === 'content' ? <>
        <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4"><div><div className="flex items-center gap-2"><BarChart3 size={17} className="text-emerald-600" /><h2 className="text-sm font-black text-text-primary">内容运营监控</h2></div><p className="mt-1 text-xs leading-5 text-text-muted">只根据已授权平台实际返回并已同步的指标生成结论；没有时间序列时不推算趋势。</p></div>{opsOverview?.generatedAt && <span className="text-[10px] font-semibold text-text-muted">更新于 {formatDate(opsOverview.generatedAt)}</span>}</div>
          {opsLoading ? <div className="p-10 text-center text-xs text-text-muted"><Loader2 size={18} className="mx-auto mb-2 animate-spin text-emerald-600" />正在读取运营指标…</div> : opsOverview && (opsOverview.kpis.length || opsOverview.trends.length || opsOverview.conclusions.length || opsOverview.topContents.length) ? <div className="p-5">
            {opsOverview.periodLabel && <p className="mb-3 text-[11px] font-bold text-text-muted">统计口径：{opsOverview.periodLabel}</p>}
            {opsOverview.kpis.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{opsOverview.kpis.map(kpi => <div key={kpi.id} className="rounded-xl border border-border p-4"><p className="text-[11px] font-bold text-text-muted">{kpi.label}</p><div className="mt-2 flex items-end justify-between gap-2"><strong className="text-xl text-text-primary">{kpi.value}</strong>{kpi.change && <span className="text-[10px] font-black text-emerald-700">{kpi.change}</span>}</div>{kpi.note && <p className="mt-2 text-[10px] leading-4 text-text-muted">{kpi.note}</p>}</div>)}</div>}
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <HighConfidenceInsights conclusions={opsOverview.conclusions} />
              <section className="rounded-xl border border-border p-4"><div className="flex items-center gap-2"><Target size={15} className="text-emerald-600" /><h3 className="text-xs font-black text-text-primary">下一步创作方向</h3></div>{opsOverview.recommendations.length ? <ol className="mt-3 space-y-3">{opsOverview.recommendations.map((item, index) => <li key={item.id} className="flex gap-3 rounded-xl bg-surface-2 p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-black text-white">{index + 1}</span><div className="min-w-0 flex-1"><p className="text-xs font-black text-text-primary">{item.title}</p><p className="mt-1 text-xs leading-5 text-text-secondary">{item.detail}</p><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] font-bold text-text-muted">依据 {item.evidenceCount} 条已同步记录</p><button type="button" onClick={() => setExecutionIntent({ kind: 'recommendation', id: item.id, title: item.title, detail: item.detail, evidenceCount: item.evidenceCount })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black text-white hover:bg-emerald-700">生成创作方案</button></div></div></li>)}</ol> : <p className="mt-4 text-xs leading-5 text-text-muted">暂不生成创作建议。数据量或置信度不足时，保持空白比给出未经验证的方向更可靠。</p>}</section>
            </div>
            {(opsOverview.trends.length > 0 || opsOverview.topContents.length > 0) && <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {opsOverview.trends.length > 0 && <PlatformTrends trends={opsOverview.trends} />}
              {opsOverview.topContents.length > 0 && <section className="rounded-xl border border-border p-4"><h3 className="text-xs font-black text-text-primary">内容表现排行</h3><div className="mt-3 divide-y divide-border">{opsOverview.topContents.slice(0, 5).map((item, index) => <div key={item.id} className="flex items-center gap-3 py-3"><span className="w-5 text-center text-xs font-black text-emerald-700">{index + 1}</span>{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-10 w-16 rounded-lg bg-surface-2 object-cover" /> : <div className="h-10 w-16 rounded-lg bg-surface-2" />}<div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-text-primary">{item.title}</p><p className="mt-1 text-[10px] text-text-muted">{item.platform}</p></div><div className="shrink-0 text-right"><p className="text-xs font-black text-text-primary">{item.metricValue}</p><p className="text-[9px] text-text-muted">{item.metricLabel}</p><button type="button" onClick={() => setExecutionIntent({ kind: 'top-content', id: item.id, title: item.title, detail: `${item.platform} · ${item.metricLabel} ${item.metricValue}`, platform: item.platform.toLowerCase(), sourceMetric: item.metricLabel })} className="mt-1 text-[10px] font-black text-emerald-700 hover:underline">爆款裂变</button></div></div>)}</div></section>}
            </div>}
          </div> : <div className="p-6"><div className="flex gap-3 rounded-xl bg-amber-50 p-4"><CircleAlert size={18} className="mt-0.5 shrink-0 text-amber-600" /><div><h3 className="text-xs font-black text-amber-900">尚无可用于趋势分析的平台时序数据</h3><p className="mt-1 text-xs leading-5 text-amber-800">完成账号 OAuth 授权后，还需要定时同步至少两个时间点，才能计算真实涨跌。当前页面不会把灵感大屏的公开爆款数据当作企业账号经营结果。</p></div></div>{opsOverview?.coverage.length ? <div className="mt-3 flex flex-wrap gap-2">{opsOverview.coverage.map(item => <span key={item.platform} title={item.note} className={`rounded-full px-2.5 py-1 text-[10px] font-black ${item.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : item.status === 'unavailable' ? 'bg-rose-50 text-rose-700' : 'bg-surface-2 text-text-muted'}`}>{item.platform} · {item.status === 'ready' ? '数据已就绪' : item.status === 'unavailable' ? '平台不提供' : '等待同步'}</span>)}</div> : null}</div>}
        </section>
        {opsOverview?.learningEvents?.length ? <section className="mb-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Clock3 size={16} className="text-emerald-600" /><div><h2 className="text-sm font-black text-text-primary">最近学习</h2><p className="mt-1 text-xs leading-5 text-text-muted">查看 Agent 最近形成、验证或调整的内容运营经验。</p></div></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-black text-text-muted">{opsOverview.learningEvents.length} 条记录</span></div>
          <div className="relative mt-5 space-y-0 before:absolute before:bottom-3 before:left-[7px] before:top-3 before:w-px before:bg-emerald-100">{opsOverview.learningEvents.slice(0, 6).map(event => { const statusMeta = event.status === 'confirmed' ? ['已确认', 'bg-emerald-50 text-emerald-700'] : event.status === 'adjusted' ? ['已调整', 'bg-blue-50 text-blue-700'] : event.status === 'observing' ? ['观察中', 'bg-amber-50 text-amber-700'] : ['新学习', 'bg-violet-50 text-violet-700']; return <article key={event.id} className="relative flex gap-4 pb-5 last:pb-0"><span className="relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-4 border-white bg-emerald-500 shadow-sm" /><div className="min-w-0 flex-1 rounded-xl border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-black text-text-primary">{event.title}</p><p className="mt-1 text-[10px] font-semibold text-text-muted">{formatDate(event.occurredAt)}{event.source ? ` · ${event.source}` : ''}</p></div><span className={`rounded-full px-2 py-1 text-[9px] font-black ${statusMeta[1]}`}>{statusMeta[0]}</span></div><p className="mt-2 text-xs leading-5 text-text-secondary">{event.detail}</p>{typeof event.evidenceCount === 'number' && <p className="mt-2 text-[10px] font-bold text-text-muted">依据 {event.evidenceCount} 条已同步记录</p>}</div></article>; })}</div>
        </section> : null}
      </> : tab === 'style' ? <>
        <section className="mb-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ShieldCheck size={17} className="text-emerald-600" /><h2 className="text-sm font-black text-text-primary">沟通风格治理</h2></div><p className="mt-1 text-xs leading-5 text-text-muted">员工修改先进入证据池；管理员确认后才参与画像或候选策略。历史业务事实永远不能从风格样本中复用。</p></div>{memoryOverview?.canManage && <div className="flex max-w-full flex-wrap gap-2"><button type="button" disabled={Boolean(memoryBusy)} onClick={() => void memoryMutation('model-check', '/api/overseas/agent-memory/model-check', 'POST')} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-[11px] font-black text-emerald-700 disabled:opacity-50">{memoryBusy === 'model-check' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}模型连通检查</button><button type="button" disabled={Boolean(memoryBusy)} onClick={() => void memoryMutation('relearn', '/api/overseas/agent-memory/style/relearn', 'POST')} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black text-white disabled:opacity-50">{memoryBusy === 'relearn' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}重新学习</button><button type="button" disabled={Boolean(memoryBusy)} onClick={() => void exportMemoryBackup()} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-black text-text-secondary disabled:opacity-50"><Download size={13} />导出备份</button><label className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-[11px] font-black text-text-secondary ${memoryBusy ? 'pointer-events-none opacity-50' : ''}`}><Upload size={13} />恢复备份<input type="file" accept="application/json,.json" className="hidden" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) restoreMemoryBackup(file); }} /></label></div>}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl bg-surface-2 p-3"><p className="text-[10px] font-bold text-text-muted">待确认证据</p><strong className="mt-1 block text-lg text-text-primary">{Number(memoryOverview?.readiness?.pending || 0)}</strong></div><div className="rounded-xl bg-surface-2 p-3"><p className="text-[10px] font-bold text-text-muted">已确认人工修改</p><strong className="mt-1 block text-lg text-text-primary">{Number(memoryOverview?.readiness?.editedConfirmed || 0)}</strong></div><div className="rounded-xl bg-surface-2 p-3"><p className="text-[10px] font-bold text-text-muted">覆盖客户</p><strong className="mt-1 block text-lg text-text-primary">已覆盖 {Number(memoryOverview?.readiness?.customerCount || 0)} 位客户</strong><p className="mt-1 text-[10px] text-text-muted">启用候选策略至少需要 3 位</p></div><div className={`rounded-xl p-3 ${memoryOverview?.model?.configured ? 'bg-emerald-50' : 'bg-amber-50'}`}><p className="text-[10px] font-bold text-text-muted">生产学习模型</p><strong className={`mt-1 block text-xs ${memoryOverview?.model?.configured ? 'text-emerald-700' : 'text-amber-800'}`}>{memoryOverview?.model?.configured ? `${String(memoryOverview.model.backend)} · ${String(memoryOverview.model.styleModel)}` : '密钥未配置，禁止触发学习'}</strong></div></div>
          {memoryNotice && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary">{memoryNotice}</p>}
        </section>
        {styleProfile && ['greeting_style', 'quoting_stance', 'followup_rhythm', 'taboo_phrases'].some(key => Boolean(styleProfile[key])) && <><section className="mb-4 rounded-2xl border border-border bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-text-primary">当前只读风格画像</h2><p className="mt-1 text-xs text-text-muted">已确认样本聚合后的表达偏好；不作为价格、MOQ、认证、交期或其他企业事实来源。</p></section><div className="mb-4 grid gap-4 md:grid-cols-2">{([['greeting_style', '称呼与开场'], ['quoting_stance', '报价表达'], ['followup_rhythm', '跟进节奏'], ['taboo_phrases', '避免使用的措辞']] as const).map(([key, label]) => { const memory = styleProfile[key] as { value?: string | string[]; evidence?: string; manual?: boolean } | undefined; if (!memory) return null; return <section key={key} className="rounded-2xl border border-border bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-black text-text-primary">{label}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-black ${memory.manual ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{memory.manual ? '人工设置' : '自动提炼'}</span></div><p className="mt-3 text-sm leading-6 text-text-secondary">{Array.isArray(memory.value) ? memory.value.join('、') : memory.value || '尚未形成稳定画像'}</p><p className="mt-3 rounded-xl bg-surface-2 p-3 text-xs leading-5 text-text-muted"><b>聚合佐证：</b>{memory.evidence || '未提供'}</p></section>; })}</div></>}
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-black text-text-primary">原始干预证据</h2><p className="mt-1 text-xs leading-5 text-text-muted">保留 AI 草稿、员工最终回复、客户/节点、结果窗口与来源；展示内容已经脱敏。</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-black text-text-muted">{styleEvidence.length} 条</span></div>{styleEvidence.length ? <div className="mt-4 space-y-3">{styleEvidence.slice(0, 80).map(evidence => { const status = String(evidence.status || 'pending'); const busy = memoryBusy.endsWith(String(evidence.id)); return <article key={String(evidence.id)} className="rounded-xl border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'}`}>{status === 'confirmed' ? '已确认' : status === 'paused' ? '已停用' : '待确认'}</span>{Boolean(evidence.nodeId) && <span className="text-[10px] font-bold text-text-muted">节点 {String(evidence.nodeId)}</span>}{Boolean(evidence.customerId) && <span className="text-[10px] font-bold text-text-muted">客户 {String(evidence.customerId).slice(0, 10)}</span>}</div><p className="mt-2 text-xs leading-5 text-text-secondary"><b>客户触发：</b>{String(evidence.triggerMessage || '未记录')}</p></div><span className="text-[10px] text-text-muted">{formatDate(String(evidence.created || ''))}</span></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><div className="rounded-lg bg-rose-50/60 p-3"><p className="text-[10px] font-black text-rose-700">AI 原始草稿</p><p className="mt-1 text-xs leading-5 text-text-secondary">{String(evidence.draftOriginal || '未记录')}</p></div><div className="rounded-lg bg-emerald-50/60 p-3"><p className="text-[10px] font-black text-emerald-700">员工最终发送</p><p className="mt-1 text-xs leading-5 text-text-secondary">{String(evidence.finalSent || '未记录')}</p></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-[10px] leading-4 text-text-muted">来源：{String(evidence.evidenceSource || '历史员工回复')} · 删除仅影响学习证据，不删除原始会话</p>{memoryOverview?.canManage && <div className="flex flex-wrap gap-1.5"><button type="button" disabled={busy} onClick={() => void editStyleEvidence(evidence)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-black text-text-secondary"><Pencil size={11} className="mr-1 inline" />编辑</button>{status !== 'confirmed' && <button type="button" disabled={busy} onClick={() => void memoryMutation(`style-confirm-${evidence.id}`, `/api/overseas/agent-memory/style-evidence/${evidence.id}`, 'PATCH', { status: 'confirmed' })} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white"><CheckCircle2 size={11} className="mr-1 inline" />确认</button>}{status !== 'paused' && <button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '停用这条学习证据？', description: '停用后它不会继续影响风格学习，原始会话仍会保留。', confirmLabel: '确认停用', action: () => memoryMutation(`style-pause-${evidence.id}`, `/api/overseas/agent-memory/style-evidence/${evidence.id}`, 'PATCH', { status: 'paused' }) })} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-[10px] font-black text-amber-700"><PauseCircle size={11} className="mr-1 inline" />停用</button>}<button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '删除这条学习证据？', description: '只删除学习证据，不会删除原始会话。', confirmLabel: '删除证据', danger: true, action: () => memoryMutation(`style-delete-${evidence.id}`, `/api/overseas/agent-memory/style-evidence/${evidence.id}`, 'DELETE') })} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-black text-rose-600"><Trash2 size={11} className="mr-1 inline" />删除证据</button></div>}</div></article>; })}</div> : <p className="mt-5 text-xs text-text-muted">尚无原始证据。新的 AI 草稿与员工最终回复会先以“待确认”状态进入这里。</p>}</section>
      </> : tab === 'customer' ? <>
        <section className="mb-4 rounded-2xl border border-border bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-text-primary">已记录的客户上下文</h2><p className="mt-1 text-xs leading-5 text-text-muted">这仍是客户资料与会话上下文，不宣传为成熟的自动客户记忆；邮箱、电话和 WhatsApp 号码不会展示。管理员可将稳定偏好另行确认为客户私有记忆。</p></section>
        {memoryNotice && <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary" role="status">{memoryNotice}</p>}
        {customerContexts.length ? <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{customerContexts.map(customer => { const name = String(customer.name || '未命名客户'); const signals = Array.isArray(customer.intentSignals) ? customer.intentSignals.map(String) : []; const tags = Array.isArray(customer.tags) ? customer.tags.map(String) : []; const existingMemoryKeys = customerMemories.filter(memory => String(memory.customerId || '') === String(customer.id || '')).map(memory => String(memory.key || '')).filter(Boolean); const privateMemoryCount = existingMemoryKeys.length; const canAddMemoryType = memoryKeyOptions.some(([key]) => !existingMemoryKeys.includes(key)); return <section key={String(customer.id || name)} className="rounded-2xl border border-border bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-2"><h3 className="text-sm font-black text-text-primary">{name}</h3>{Boolean(customer.stage) && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{customerStageLabels[String(customer.stage)] || String(customer.stage)}</span>}</div><div className="mt-3 space-y-2 text-xs text-text-secondary">{Boolean(customer.product) && <p><b>关注产品：</b>{String(customer.product)}</p>}{Boolean(customer.countryName) && <p><b>市场：</b>{String(customer.countryName)}</p>}{Boolean(customer.language) && <p><b>语言：</b>{String(customer.language)}</p>}{Boolean(customer.summary) && <p className="line-clamp-3 leading-5"><b>客户摘要：</b>{String(customer.summary)}</p>}{Boolean(customer.nextStep) && <p className="line-clamp-2 leading-5"><b>下一步：</b>{String(customer.nextStep)}</p>}</div>{[...signals, ...tags].length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{[...signals, ...tags].slice(0, 5).map(value => <span key={value} className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-bold text-text-muted">{value}</span>)}</div>}{memoryOverview?.canManage && <div className="mt-4 space-y-2">{privateMemoryCount > 0 && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-[10px] font-black text-emerald-700">已记录 {privateMemoryCount} 类私有记忆，可在下方编辑</p>}{canAddMemoryType && <button type="button" disabled={Boolean(memoryBusy)} onClick={() => addCustomerMemory(customer, existingMemoryKeys)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 px-3 py-2 text-[10px] font-black text-emerald-700 disabled:opacity-50"><Plus size={12} />{privateMemoryCount > 0 ? '添加另一类记忆' : '确认为客户私有记忆'}</button>}</div>}</section>; })}</div> : <p className="mb-4 rounded-xl bg-surface-2 p-4 text-xs text-text-muted">尚无客户上下文。</p>}
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2"><div><h2 className="text-sm font-black text-text-primary">客户私有记忆治理</h2><p className="mt-1 text-xs leading-5 text-text-muted">仅在同一企业、同一客户的后续回复中使用；人工确认且较新的记录优先，过期记录自动退出检索。</p></div><span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-black text-text-muted">{customerMemories.length} 条</span></div>
          {customerMemories.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{customerMemories.map(memory => {
            const status = String(memory.status || 'pending');
            const busy = Boolean(memoryBusy);
            return <article key={String(memory.id)} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-black text-emerald-700">{String(memory.keyLabel || memoryKeyLabels[String(memory.key || '')] || '客户偏好')}</p><h3 className="mt-1 text-sm font-black text-text-primary">{String(memory.value || '')}</h3></div><span className={`rounded-full px-2 py-1 text-[9px] font-black ${status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : status === 'conflict' ? 'bg-rose-50 text-rose-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-surface-2 text-text-muted'}`}>{customerMemoryStatusLabels[status] || '待确认'}</span></div>
              <p className="mt-2 text-[10px] leading-4 text-text-muted">客户 {String(memory.customerId || '').slice(0, 12)} · {memory.sourceKind === 'ai_inferred' ? 'AI 推断' : '人工记录'}{memory.expiresAt ? ` · 过期 ${formatDate(String(memory.expiresAt))}` : ''}</p>
              {Boolean(memory.evidence) && <p className="mt-2 rounded-lg bg-surface-2 p-2 text-xs leading-5 text-text-secondary"><b>证据：</b>{String(memory.evidence)}</p>}
              {memoryOverview?.canManage && <div className="mt-3 flex flex-wrap gap-1.5"><button type="button" disabled={busy} onClick={() => editCustomerMemory(memory)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-black text-text-secondary disabled:opacity-50"><Pencil size={11} className="mr-1 inline" />编辑</button>{status !== 'confirmed' && <button type="button" disabled={busy} onClick={() => void memoryMutation(`customer-confirm-${memory.id}`, `/api/overseas/agent-memory/customer-memories/${memory.id}`, 'PATCH', { status: 'confirmed' })} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white disabled:opacity-50">确认</button>}{status !== 'paused' && <button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '停用这条客户记忆？', description: '停用后 AI 不再引用它，原始聊天不会被删除。', confirmLabel: '确认停用', action: () => memoryMutation(`customer-pause-${memory.id}`, `/api/overseas/agent-memory/customer-memories/${memory.id}`, 'PATCH', { status: 'paused' }) })} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-[10px] font-black text-amber-700 disabled:opacity-50">停用</button>}<button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '删除这条客户记忆？', description: '删除后 AI 不再引用它，原始聊天不会被删除。', confirmLabel: '删除记忆', danger: true, action: () => memoryMutation(`customer-delete-${memory.id}`, `/api/overseas/agent-memory/customer-memories/${memory.id}`, 'DELETE') })} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-black text-rose-600 disabled:opacity-50">删除</button></div>}
            </article>;
          })}</div> : <p className="mt-5 text-xs text-text-muted">尚无独立客户私有记忆。客户上下文字段不会自动变成长期记忆。</p>}
        </section>
      </> : tab === 'strategy' ? <>
        <section className="mb-4 rounded-2xl border border-border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-black text-text-primary">响应策略观察与治理</h2><p className="mt-1 text-xs leading-5 text-text-muted">候选策略至少需要 5 条证据、3 个客户和 2 个时间段；新启用从 10% 开始，当前比例以策略卡片为准。证据关联不等于成功率或因果贡献。</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-800">成功率暂不展示</span></div>{memoryNotice && <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-text-secondary">{memoryNotice}</p>}</section>
        {responseStrategies.length ? <div className="grid gap-4 md:grid-cols-2">{responseStrategies.map((strategy, index) => {
          const steps = Array.isArray(strategy.strategySteps) ? strategy.strategySteps.map(String) : [];
          const signals = Array.isArray(strategy.signals) ? strategy.signals.map(String) : [];
          const evidence = Array.isArray(strategy.evidence) ? strategy.evidence as Array<Record<string, unknown>> : [];
          const status = String(strategy.status || 'candidate');
          const busy = Boolean(memoryBusy);
          const rolloutPercent = Number(strategy.rolloutPercent ?? 10);
          return <section key={String(strategy.id || strategy.strategyId || index)} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black text-emerald-700">{strategySourceLabels[String(strategy.source || '')] || '策略记忆'} · v{Number(strategy.version || 1)}</p><h3 className="mt-1 text-sm font-black text-text-primary">{String(strategy.scenario || strategy.intent || strategy.strategyId || '未命名响应策略')}</h3></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${status === 'active' ? 'bg-emerald-50 text-emerald-700' : status === 'paused' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700'}`}>{status === 'active' ? `已启用 ${rolloutPercent}%` : status === 'paused' ? '已暂停' : '候选策略'}</span></div>
            {Boolean(strategy.adjustment) && <p className="mt-3 text-xs leading-6 text-text-secondary">{String(strategy.adjustment)}</p>}
            {signals.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{signals.slice(0, 5).map(signal => <span key={signal} className="rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">{signal}</span>)}</div>}
            {steps.length > 0 && <div className="mt-4 rounded-xl bg-surface-2 p-3"><p className="text-[10px] font-black text-text-muted">唯一推进目标下的建议动作</p><ol className="mt-2 space-y-1.5">{steps.map((step, stepIndex) => <li key={`${step}-${stepIndex}`} className="flex gap-2 text-xs leading-5 text-text-secondary"><span className="font-black text-emerald-600">{stepIndex + 1}.</span>{step}</li>)}</ol></div>}
            {Boolean(strategy.riskBoundary || strategy.escalate) && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"><b>风险边界：</b>{String(strategy.riskBoundary || strategy.escalate)}</p>}
            <details className="mt-3 rounded-xl border border-border px-3 py-2"><summary className="cursor-pointer text-[11px] font-black text-text-secondary">查看证据样本（展示 {evidence.length} 条 · 共关联 {Number(strategy.evidenceCount || 0)} 条 · 覆盖 {Number(strategy.evidenceCustomerCount || 0)} 位客户）</summary><div className="mt-3 space-y-2">{evidence.length ? evidence.map(item => <div key={String(item.id)} className="rounded-lg bg-surface-2 p-3 text-xs leading-5 text-text-secondary"><p><b>客户：</b>{String(item.buyer || '')}</p><p className="mt-1"><b>AI：</b>{String(item.aiDraft || '')}</p><p className="mt-1"><b>员工：</b>{String(item.humanFinal || '')}</p></div>) : <p className="text-xs text-text-muted">暂无可展示的脱敏证据。</p>}</div></details>
            {memoryOverview?.canManage && <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3"><button type="button" disabled={busy} onClick={() => editStrategy(strategy)} className="rounded-lg border border-border px-2.5 py-1.5 text-[10px] font-black text-text-secondary disabled:opacity-50"><Pencil size={11} className="mr-1 inline" />编辑</button>{status !== 'active' && <button type="button" disabled={busy} onClick={() => void memoryMutation(`strategy-active-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}`, 'PATCH', { status: 'active', rolloutPercent: 10 })} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white disabled:opacity-50"><Play size={11} className="mr-1 inline" />10% 启用</button>}{status === 'active' && <button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '暂停这条响应策略？', description: '暂停后新回复不再分流到该策略，历史证据和审计记录会保留。', confirmLabel: '确认暂停', action: () => memoryMutation(`strategy-pause-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}`, 'PATCH', { status: 'paused' }) })} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-[10px] font-black text-amber-700 disabled:opacity-50"><PauseCircle size={11} className="mr-1 inline" />暂停</button>}<button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '回滚这条响应策略？', description: '系统会恢复上一版本，并保留本次操作的审计记录。', confirmLabel: '确认回滚', action: () => memoryMutation(`strategy-rollback-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}/rollback`, 'POST') })} className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-[10px] font-black text-blue-700 disabled:opacity-50"><RotateCcw size={11} className="mr-1 inline" />回滚</button><button type="button" disabled={busy} onClick={() => setMemoryConfirm({ title: '删除这条响应策略？', description: '策略会被删除，关联证据和原始会话仍会保留。', confirmLabel: '删除策略', danger: true, action: () => memoryMutation(`strategy-delete-${strategy.id}`, `/api/overseas/agent-memory/strategies/${strategy.id}`, 'DELETE') })} className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-[10px] font-black text-rose-600 disabled:opacity-50"><Trash2 size={11} className="mr-1 inline" />删除策略</button></div>}
          </section>;
        })}</div> : <p className="rounded-xl bg-surface-2 p-4 text-xs text-text-muted">尚无响应策略记忆。确认足够证据并主动触发重新学习后，候选策略会出现在这里。</p>}
        <section className="mt-4 rounded-2xl border border-border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><History size={16} className="text-emerald-600" /><div><h2 className="text-sm font-black text-text-primary">最近使用与治理审计</h2><p className="mt-1 text-xs text-text-muted">记录哪条记忆、策略在何时影响了哪次回复，以及谁执行了确认、停用、删除或回滚。</p></div></div>{memoryAudit.length ? <div className="mt-4 divide-y divide-border">{memoryAudit.slice(0, 20).map(item => <div key={String(item.id)} className="flex flex-wrap items-start justify-between gap-2 py-3"><div><p className="text-xs font-black text-text-primary">{String(item.action || '审计事件')}</p><p className="mt-1 text-[10px] text-text-muted">{item.customerId ? `客户 ${String(item.customerId).slice(0, 12)} · ` : ''}{item.nodeId ? `节点 ${String(item.nodeId)} · ` : ''}记忆 {Array.isArray(item.memoryIds) ? item.memoryIds.length : 0} 条 · 策略 {Array.isArray(item.strategyIds) ? item.strategyIds.length : 0} 条</p></div><span className="text-[10px] text-text-muted">{formatDate(String(item.createdAt || ''))}</span></div>)}</div> : <p className="mt-4 text-xs text-text-muted">尚无审计记录。</p>}</section>
      </> : null}
      {memoryEditor && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4" role="presentation" onMouseDown={event => { if (!memoryBusy && event.currentTarget === event.target) setMemoryEditor(null); }}>
          <form ref={memoryEditorDialogRef} tabIndex={-1} onSubmit={submitMemoryEditor} role="dialog" aria-modal="true" aria-labelledby="agent-memory-editor-dialog-title" className="w-full max-w-lg rounded-2xl border border-border bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 id="agent-memory-editor-dialog-title" className="text-base font-black text-text-primary">{memoryEditor.kind === 'customer-add' ? `记录 ${memoryEditor.customerName} 的偏好` : memoryEditor.kind === 'customer-edit' ? '编辑客户私有记忆' : memoryEditor.kind === 'style-edit' ? '编辑员工最终回复' : '编辑响应策略'}</h2><p className="mt-1 text-xs leading-5 text-text-muted">{memoryEditor.kind === 'strategy-edit' ? '只记录对话方法，不在这里填写价格、MOQ、证书等企业事实。' : '内容会在服务端再次脱敏，并保留审计记录。'}</p></div>
              <button type="button" data-modal-initial-focus disabled={Boolean(memoryBusy)} onClick={() => setMemoryEditor(null)} aria-label="关闭编辑窗口" className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 disabled:opacity-50"><X size={16} /></button>
            </div>
            <div className="mt-5 space-y-4">
              {memoryEditor.kind === 'customer-add' && <label className="block text-xs font-bold text-text-secondary">记忆类型<select value={memoryEditor.key} onChange={event => setMemoryEditor({ ...memoryEditor, key: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:border-emerald-400">{memoryKeyOptions.filter(([value]) => !memoryEditor.existingKeys.includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              {(memoryEditor.kind === 'customer-add' || memoryEditor.kind === 'customer-edit') && <><label className="block text-xs font-bold text-text-secondary">记忆内容<textarea required rows={4} value={memoryEditor.value} onChange={event => setMemoryEditor({ ...memoryEditor, value: event.target.value })} placeholder="只写这位客户稳定的偏好或采购背景" className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-400" /></label><label className="block text-xs font-bold text-text-secondary">有效期（可选）<input type="date" value={memoryEditor.expiresAt} onChange={event => setMemoryEditor({ ...memoryEditor, expiresAt: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-border px-3 text-sm outline-none focus:border-emerald-400" /></label></>}
              {memoryEditor.kind === 'style-edit' && <label className="block text-xs font-bold text-text-secondary">员工最终发送内容<textarea required rows={5} value={memoryEditor.finalSent} onChange={event => setMemoryEditor({ ...memoryEditor, finalSent: event.target.value })} className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-400" /></label>}
              {memoryEditor.kind === 'strategy-edit' && <label className="block text-xs font-bold text-text-secondary">策略调整说明<textarea rows={5} value={memoryEditor.adjustment} onChange={event => setMemoryEditor({ ...memoryEditor, adjustment: event.target.value })} className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm leading-6 outline-none focus:border-emerald-400" /></label>}
            </div>
            {memoryNotice && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700" role="alert">{memoryNotice}</p>}
            <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={Boolean(memoryBusy)} onClick={() => setMemoryEditor(null)} className="rounded-xl border border-border px-4 py-2 text-xs font-black text-text-secondary disabled:opacity-50">取消</button><button type="submit" disabled={Boolean(memoryBusy)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-60">{memoryBusy && <Loader2 size={13} className="animate-spin" />}保存</button></div>
          </form>
        </div>
      )}
      {memoryConfirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/35 p-4" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) setMemoryConfirm(null); }}>
          <section ref={memoryConfirmDialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="agent-memory-confirm-dialog-title" className="w-full max-w-md rounded-2xl border border-border bg-white p-5 shadow-2xl">
            <h2 id="agent-memory-confirm-dialog-title" className="text-base font-black text-text-primary">{memoryConfirm.title}</h2><p className="mt-2 text-sm leading-6 text-text-secondary">{memoryConfirm.description}</p>
            <div className="mt-5 flex justify-end gap-2"><button type="button" data-modal-initial-focus onClick={() => setMemoryConfirm(null)} className="rounded-xl border border-border px-4 py-2 text-xs font-black text-text-secondary">取消</button><button type="button" onClick={() => void confirmMemoryAction()} className={`rounded-xl px-4 py-2 text-xs font-black text-white ${memoryConfirm.danger ? 'bg-rose-600' : 'bg-slate-950'}`}>{memoryConfirm.confirmLabel}</button></div>
          </section>
        </div>
      )}
      <ContentOpsExecutionDialog intent={executionIntent} onClose={() => setExecutionIntent(null)} />
    </PageShell>
  );
}

export function OrganizationPermissionsPage() {
  const roleDefinitions: Array<{ id: OrganizationRole; name: string; scope: string }> = [
    { id: 'super_admin', name: '超级管理员', scope: '全部系统权限，可以添加和管理管理员' },
    { id: 'admin', name: '管理员', scope: '管理组织成员、系统集成与全部业务数据' },
    { id: 'social_operator', name: '社媒运营专员', scope: '使用社媒运营、智能素材、账号管理与定时任务' },
    { id: 'customer_service', name: '客户服务专员', scope: '使用客户会话、客户资料、订单管理与定时任务' },
  ];
  const [members, setMembers] = useState<EmployeeAccount[]>([]);
  const [currentRole, setCurrentRole] = useState<OrganizationRole>('customer_service');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OrganizationRole>('social_operator');

  useEffect(() => {
    let active = true;
    Promise.all([authApi.employees(), authApi.me()])
      .then(([employees, session]) => {
        if (!active) return;
        setMembers(employees);
        setCurrentRole(session?.user.role || 'customer_service');
      })
      .catch(reason => active && setError(reason instanceof Error ? reason.message : '成员列表加载失败'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const canManage = currentRole === 'super_admin';
  const submitMember = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const employee = await authApi.addEmployee({ name, email, password, role });
      setMembers(items => [...items, employee]);
      setAdding(false); setName(''); setEmail(''); setPassword(''); setRole('social_operator');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '添加成员失败'); }
    finally { setSaving(false); }
  };

  const updateRole = async (member: EmployeeAccount, nextRole: OrganizationRole) => {
    setError('');
    try {
      await authApi.updateEmployeeRole(member.id, nextRole);
      setMembers(items => items.map(item => item.id === member.id ? { ...item, role: nextRole } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '角色更新失败'); }
  };

  const removeMember = async (member: EmployeeAccount) => {
    if (!window.confirm(`确认移除成员 ${member.name || member.email}？`)) return;
    setError('');
    try { await authApi.deleteEmployee(member.id); setMembers(items => items.filter(item => item.id !== member.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '成员移除失败'); }
  };

  const roles = roleDefinitions.map(definition => ({
    ...definition,
    count: members.filter(member => member.role === definition.id).length,
  }));
  return (
    <PageShell icon={<UserRoundCog size={14} />} title="组织与权限" description="管理组织成员、角色权限和数据访问范围。">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-white p-4"><Users size={18} className="text-emerald-600" /><p className="mt-3 text-2xl font-bold text-text-primary">{members.length}</p><p className="text-xs text-text-muted">组织成员</p></div>
        <div className="rounded-2xl border border-border bg-white p-4"><ShieldCheck size={18} className="text-emerald-600" /><p className="mt-3 text-2xl font-bold text-text-primary">{roles.length}</p><p className="text-xs text-text-muted">预设角色</p></div>
      </div>
      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-bold text-text-primary">角色权限</h2><p className="mt-1 text-xs text-text-muted">新成员加入后按角色获得最小必要权限；只有超级管理员可以添加管理员。</p></div>
        {roles.map(role => (
          <div key={role.name} className="flex items-center gap-4 border-b border-border px-5 py-4 last:border-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-text-muted"><ShieldCheck size={16} /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-bold text-text-primary">{role.name}</p><p className="truncate text-xs text-text-muted">{role.scope}</p></div>
            <span className="text-xs font-semibold text-text-muted">{role.count} 人</span>
          </div>
        ))}
      </section>
      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 className="text-sm font-bold text-text-primary">企业成员</h2><p className="mt-1 text-xs text-text-muted">同一企业、同一角色共享对应业务数据，企业之间保持隔离。</p></div>
          {canManage && <button type="button" onClick={() => setAdding(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><Plus size={14} />添加成员</button>}
        </div>
        {error && <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        {adding && canManage && <form onSubmit={submitMember} autoComplete="off" className="grid gap-3 border-b border-border bg-surface p-4 md:grid-cols-2">
          <input value={name} onChange={event => setName(event.target.value)} name="organization-member-name" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="成员姓名" className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <input required type="email" value={email} onChange={event => setEmail(event.target.value)} name="organization-member-email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder="登录邮箱" className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <input required minLength={8} type="password" value={password} onChange={event => setPassword(event.target.value)} name="organization-member-initial-password" autoComplete="new-password" data-1p-ignore data-lpignore="true" placeholder="初始密码（至少 8 位）" className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          <select value={role} onChange={event => setRole(event.target.value as OrganizationRole)} className="rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500">
            <option value="admin">管理员</option><option value="social_operator">社媒运营专员</option><option value="customer_service">客户服务专员</option>
          </select>
          <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-xs font-bold text-text-muted">取消</button><button disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">{saving && <Loader2 size={13} className="animate-spin" />}创建账号</button></div>
        </form>}
        {loading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin text-emerald-600" /></div> : members.map(member => (
          <div key={member.id} className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-sm font-black text-emerald-700">{(member.name || member.email)[0]?.toUpperCase()}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-text-primary">{member.name || member.email.split('@')[0]}{member.isCurrent && <span className="ml-2 text-[10px] text-emerald-600">当前账号</span>}</p><p className="truncate text-xs text-text-muted">{member.email}</p></div>
            {canManage && !member.isCurrent ? <select value={member.role} onChange={event => void updateRole(member, event.target.value as OrganizationRole)} className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-semibold"><option value="admin">管理员</option><option value="social_operator">社媒运营专员</option><option value="customer_service">客户服务专员</option></select> : <span className="text-xs font-semibold text-text-muted">{roleDefinitions.find(item => item.id === member.role)?.name}</span>}
            {canManage && !member.isCurrent && <button type="button" onClick={() => void removeMember(member)} title="移除成员" className="rounded-lg p-2 text-text-muted hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>}
          </div>
        ))}
      </section>
    </PageShell>
  );
}
