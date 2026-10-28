import { socialInsightQueries } from '../../shared/socialInsightQueries.mjs';
import type { SocialInsightReport, SocialInsightVideo } from '../../shared/socialInsightReport.js';
import { apifyTikTokItemToCrawledVideo } from '../routes/videoCrawlerProviderProjection.js';
export function insightPeriod(now = new Date()): SocialInsightReport['period'] {
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${today}T00:00:00+08:00`) - 6 * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  return { from, to: today, timeZone: 'Asia/Shanghai' };
}
const number = (...values: unknown[]): number | null => {
  const v = values.find(value => value !== undefined && value !== null && value !== '');
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
};
export function snapshotReport(keyword: string, rows: Record<string, unknown>[], now = new Date()): SocialInsightReport {
  const period = insightPeriod(now), videos: SocialInsightVideo[] = [], seen = new Map<string, SocialInsightVideo>();
  const allowedQueries = new Set(socialInsightQueries(keyword));
  const start = Date.parse(`${period.from}T00:00:00+08:00`), end = Math.min(now.getTime(), Date.parse(`${period.to}T23:59:59.999+08:00`));
  for (const row of rows.slice(0, 30)) {
    const video = apifyTikTokItemToCrawledVideo(row, keyword);
    if (!video || !video.uploadedAt || !Number.isFinite(Date.parse(video.uploadedAt))) continue;
    const published = Date.parse(video.uploadedAt);
    if (published < start || published > end) continue;
    const url = new URL(video.sourceUrl);
    if (url.protocol !== 'https:' || !/(^|\.)tiktok\.com$/.test(url.hostname) || !/\/video\/\d+/.test(url.pathname)) continue;
    const id = /\/video\/(\d+)/.exec(url.pathname)![1];
    const query = typeof row.searchQuery === 'string' && allowedQueries.has(row.searchQuery) ? row.searchQuery : null;
    const prior = seen.get(id);
    if (prior) { if (query && !prior.searchQueries?.includes(query)) prior.searchQueries = [...(prior.searchQueries || []), query]; continue; }
    let thumbnailUrl: string | null = null;
    try { const thumb = new URL(video.thumbnailUrl || ''); if (thumb.protocol === 'https:' && !thumb.username && !thumb.password) thumbnailUrl = thumb.href; } catch { /* Missing cover remains missing. */ }
    const item: SocialInsightVideo = { id, ...(query ? {searchQueries: [query]} : {}), caption: String(row.text || row.description || row.desc || row.title || '').trim().slice(0, 2000), url: url.origin + url.pathname, thumbnailUrl, title: video.title,
      publishedAt: new Date(published).toISOString(), views: number(row.playCount, row.views, row.viewCount),
      likes: number(row.diggCount, row.likes, row.likeCount), comments: number(row.commentCount, row.comments),
      shares: number(row.shareCount, row.shares) };
    videos.push(item); seen.set(id, item);
  }
  const ranked = [...videos].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 10);
  const counts = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start + i * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
    return { label: day.slice(5), value: videos.filter(v => new Date(Date.parse(v.publishedAt) + 8 * 3600000).toISOString().startsWith(day)).length };
  });
  return { version: 1, keyword, platform: 'tiktok', period, collectedAt: now.toISOString(), sampleCount: videos.length, videos,
    charts: [{ id: 'views', title: '样本视频播放量快照', type: 'bar', unit: '次', data: ranked.map(v => ({ label: v.title.slice(0, 20), value: v.views, videoId: v.id })) },
      { id: 'published', title: '样本发布日期分布', type: 'bar', unit: '条', data: counts }], analysisMarkdown: '',
    limitations: ['本报告仅覆盖关键词检索返回的最多30条TikTok公开视频样本，不代表全平台榜单或完整市场。',
      '时间范围为北京时间近7个自然日，今天截至采集时刻；缺少可核验发布日期或日期超出范围的内容已排除。',
      '播放与互动为采集时的累计快照；单次采集无法证明增长、趋势、销售或受众所在国家。',
      '缺失指标保留为空；未读取视频画面、音轨或字幕，仅依据公开配文与指标分析。',
      ...(rows.length !== videos.length ? [`供应商返回${rows.length}条，去重与格式/发布日期核验后保留${videos.length}条。`] : [])] };
}
export function validateInsightAnalysis(text: string, report: SocialInsightReport): void {
  if (!text.trim() || text.length > 14000) throw Error('social_insight_analysis_invalid');
  const urls = text.match(/https?:\/\/[^\s)\]<>]+/g) || [];
  if (!urls.length || urls.some(url => !report.videos.some(v => v.url === url))) throw Error('social_insight_analysis_sources_invalid');
}
