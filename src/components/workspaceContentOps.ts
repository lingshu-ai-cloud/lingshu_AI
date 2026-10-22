import type { OpsEvidence } from './ContentOpsDrilldowns';

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
  periodLabel: '参考预览 · 最近 30 天',
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
  coverage: ['facebook', 'instagram', 'tiktok', 'youtube'].map(platform => ({ platform, status: 'ready', note: '本地参考预览' })),
};

const hasContentOpsData = (overview: ContentOpsOverview | null) => Boolean(overview && (overview.kpis?.length || overview.trends?.length || overview.conclusions?.length || overview.topContents?.length || overview.learningEvents?.length));
export { contentOpsOverview, socialMetricsOpsOverview, MOCK_CONTENT_OPS_OVERVIEW, hasContentOpsData };
export type { ContentOpsOverview };
