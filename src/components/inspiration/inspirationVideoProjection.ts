import type { AccountSpecialRecommendation, ContentFormat, Platform, TrendVideo, VideoAnalysisPayload } from '../../lib/inspirationTypes';
import type { SocialDiscoverySupplyItem } from '../../../shared/contracts/socialContentWorkflow';
import { trendFromEvidence } from '../../lib/inspirationDataQuality';
import { scoreSocialInspirationCandidate } from '../../../shared/socialInspirationStrategy';

export const PLATFORM_META: Record<Exclude<Platform, 'all'>, { label: string; color: string; bg: string }> = {
  tiktok:    { label: 'TikTok',    color: '#fff', bg: '#010101' },
  instagram: { label: 'Instagram', color: '#fff', bg: '#c13584' },
  youtube:   { label: 'YouTube',   color: '#fff', bg: '#ff0000' },
  facebook:  { label: 'Facebook',  color: '#fff', bg: '#1877f2' },
  linkedin:  { label: 'LinkedIn',  color: '#fff', bg: '#0A66C2' },
};
const PLATFORM_FALLBACK = { label: 'Unknown', color: '#fff', bg: '#64748b' };
export const getPlatformMeta = (p: string) => PLATFORM_META[p as Exclude<Platform, 'all'>] ?? PLATFORM_FALLBACK;

export const ACTIVE_PLATFORMS: Array<Exclude<Platform, 'all'>> = ['linkedin', 'facebook', 'youtube', 'tiktok', 'instagram'];

function contentFormatOfAnalysis(analysis?: VideoAnalysisPayload): ContentFormat {
  return analysis?.contentFormat === 'image' ? 'image' : 'video';
}

export interface CrawlerRecord {
  id: string;
  platform?: Exclude<Platform, 'all'>;
  title?: string;
  thumbnailUrl?: string;
  duration?: number;
  sourceUrl?: string;
  tags?: string;
  aiAnalysis?: string;
  status?: 'pending' | 'analyzed' | 'failed';
  videoFileId?: string;
  crawledAt?: string;
  canManage?: boolean;
}

function parseRecordTags(tags?: string): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function recordsToVideos(records: CrawlerRecord[]): TrendVideo[] {
  return records
    .filter((r): r is CrawlerRecord & { id: string; platform: Exclude<Platform, 'all'> } => Boolean(r.id && r.platform))
    .map(record => {
      let views = '—';
      let analysis: VideoAnalysisPayload = {};
      try {
        analysis = JSON.parse(record.aiAnalysis || '{}') as VideoAnalysisPayload;
        if (analysis.views) views = analysis.views;
      } catch {}
      const trend = trendFromEvidence(analysis);
      const title = record.title || 'Untitled crawled video';
      const tags = parseRecordTags(record.tags);
      // Image-post analysis can fail after collection even though the crawler
      // already returned usable source images. Keep that record visible so the
      // user can inspect the failure and retry instead of silently losing it.
      const firstCollectedImage = analysis.contentFormat === 'image' && Array.isArray(analysis.imageUrls)
        ? String(analysis.imageUrls.find(url => typeof url === 'string' && url.trim()) || '')
        : '';
      const recordThumbnail = record.thumbnailUrl
        || (record.videoFileId ? `/api/overseas/videos/${record.id}/thumbnail` : '')
        || firstCollectedImage;
      if (!analysis.gemini && analysis.contentFormat !== 'image') {
        analysis = {
          ...analysis,
          gemini: undefined,
          analysisSource: 'metadata-fallback',
          analysisQuality: 'metadata',
        };
      }
      if (analysis.analysisQuality === 'metadata' || analysis.analysisSource === 'metadata-fallback') analysis = { ...analysis, gemini: undefined };
      return {
        id: `crawl-${record.id}`,
        recordId: record.id,
        platform: record.platform,
        title,
        thumbnail: recordThumbnail,
        duration: Number(record.duration || 0),
        tags,
        views,
        trend,
        // videoFileId 是存储引用；实际文件是否存在由播放地址接口核验。
        videoUrl: record.videoFileId ? `/api/overseas/videos/${record.id}/media-url` : undefined,
        sourceUrl: record.sourceUrl,
        status: record.status,
        aiAnalysis: analysis,
        crawledAt: record.crawledAt,
        contentFormat: contentFormatOfAnalysis(analysis),
      canManage: Boolean(record.canManage),
      };
    })
    // 历史记录在后台回填 PocketBase 时仍展示封面，避免管理员视频池因存储迁移暂时变成空列表。
    // 同一 sourceUrl 只保留一条（demo 数据/多次采集可能带来 id 不同的重复视频）
    .filter((video, index, all) => !video.sourceUrl || all.findIndex(v => v.sourceUrl === video.sourceUrl) === index)
    .sort((a, b) => heatValue(b.views) - heatValue(a.views));
}

export function supplyItemsToVideos(items: SocialDiscoverySupplyItem[]): TrendVideo[] {
  const records = items.flatMap(item => {
    if (!ACTIVE_PLATFORMS.includes(item.platform as Exclude<Platform, 'all'>)) return [];
    const raw = item.raw || {};
    let analysis: Record<string, unknown> = {};
    if (typeof raw.aiAnalysis === 'string') {
      try { analysis = JSON.parse(raw.aiAnalysis) as Record<string, unknown>; } catch { analysis = {}; }
    } else if (raw.aiAnalysis && typeof raw.aiAnalysis === 'object' && !Array.isArray(raw.aiAnalysis)) {
      analysis = raw.aiAnalysis as Record<string, unknown>;
    }
    return [{
      ...raw,
      id: item.candidateId,
      platform: item.platform as Exclude<Platform, 'all'>,
      title: item.title,
      sourceUrl: item.sourceUrl,
      thumbnailUrl: item.thumbnailUrl || String(raw.thumbnailUrl || ''),
      aiAnalysis: JSON.stringify({ ...analysis, author: item.author || analysis.author, discoveryScore: item.score, discoveryBusinessModel: item.businessModel }),
      crawledAt: String(raw.crawledAt || ''),
    } satisfies CrawlerRecord];
  });
  const order = new Map(items.map((item, index) => [item.candidateId, index]));
  return recordsToVideos(records).sort((a, b) => (order.get(a.recordId || '') ?? 0) - (order.get(b.recordId || '') ?? 0));
}

export function metadataPanelFallback(video: TrendVideo): TrendVideo {
  if (video.aiAnalysis?.analysisSource === 'metadata-fallback' && video.aiAnalysis?.analysisQuality === 'metadata') {
    return { ...video, aiAnalysis: { ...video.aiAnalysis, gemini: undefined } };
  }
  return {
    ...video,
    aiAnalysis: {
      ...(video.aiAnalysis || {}),
      gemini: undefined,
      analysisSource: 'metadata-fallback',
      analysisQuality: 'metadata',
      geminiStatus: 'metadata_fallback',
      downloadStatus: 'metadata_only',
    },
  };
}

export function heatValue(views: string): number {
  const raw = String(views || '').toLowerCase().replace(/,/g, '');
  const n = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (raw.includes('亿') || raw.includes('b')) return n * 100000000;
  if (raw.includes('万')) return n * 10000;
  if (raw.includes('m') || raw.includes('百万')) return n * 1000000;
  if (raw.includes('k') || raw.includes('千')) return n * 1000;
  return n;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function reliablePublicViews(value: string): number {
  if (!/\d/.test(value) || /shares?|likes?|facebook|linkedin|instagram|tiktok|youtube|本地素材/i.test(value)) return 0;
  return heatValue(value);
}

export function inspirationScoresForVideo(video: TrendVideo) {
  const analysis = video.aiAnalysis;
  if (analysis?.discoveryScore) return {
    sourcePriority: analysis.discoveryScore.dimensions.platformPriority,
    contentOpportunityScore: analysis.discoveryScore.overall,
    relativePerformance: null,
    reasons: analysis.discoveryScore.reasons,
  };
  const relative = analysis?.publicBaseline?.relativeMultiple ?? analysis?.relativeViewMultiple ?? null;
  const ageDays = Math.max(0, (Date.now() - timeValue(video.crawledAt)) / 86_400_000);
  const freshness = ageDays <= 3 ? 1 : ageDays <= 7 ? 0.8 : ageDays <= 30 ? 0.5 : 0.2;
  const baselineTypeWeight = analysis?.accountBaselineLevel === 'low' ? 1
    : analysis?.accountBaselineLevel === 'medium' ? 0.8
      : analysis?.accountBaselineLevel === 'high' ? 0.65 : 0.5;
  const exactAnalysis = analysis?.analysisQuality === 'video' || analysis?.imageEvidence?.status === 'analyzed';
  return scoreSocialInspirationCandidate({
    platformWeight: 0.8,
    accountWeight: analysis?.sourceAccount ? 0.8 : 0.4,
    accountTypeWeight: baselineTypeWeight,
    industryRelevance: video.tags.length > 0 ? 0.7 : 0.4,
    strategyMatch: analysis?.keyword || analysis?.crawlRule ? 0.8 : 0.5,
    currentPerformance: relative,
    accountPlatformBaseline: relative === null ? null : 1,
    engagementQuality: analysis?.publicBaseline?.status === 'usable' ? 0.75 : 0.45,
    freshness,
    weeklyGoalRelevance: 0.5,
    structuralTransferability: exactAnalysis ? 0.9 : 0.4,
    evidenceQuality: exactAnalysis ? 0.85 : 0.3,
  });
}

export function candidateDimensionLabels(video: TrendVideo): { relevance: string; momentum: string; transferability: string } {
  const evidence = video.aiAnalysis?.candidateEvidence;
  const relevance = evidence?.relevance?.level === 'high' ? '强相关'
    : evidence?.relevance?.level === 'medium' ? '需核对' : evidence?.relevance?.level === 'low' ? '弱相关' : '相关性待确认';
  const momentum = evidence?.momentum?.level === 'rising' ? '正在起量'
    : evidence?.momentum?.level === 'high_performance' ? '高表现' : '趋势未知';
  const transferability = evidence?.transferability?.level === 'high' ? '易迁移'
    : evidence?.transferability?.level === 'medium' ? '可迁移' : evidence?.transferability?.level === 'low' ? '难迁移' : '迁移性待确认';
  return { relevance, momentum, transferability };
}

export function latestDiscoveryOrigin(video: TrendVideo) {
  return video.aiAnalysis?.discoveryOrigins?.at(-1);
}

export function discoverySupplyLabel(video: TrendVideo): string {
  const mode = latestDiscoveryOrigin(video)?.mode;
  return mode === 'momentum' ? '行业起量' : mode === 'account' ? '确认对标' : mode === 'innovation' ? '创新参考' : '来源待归类';
}

export function discoveryOriginTitle(video: TrendVideo): string {
  const origin = latestDiscoveryOrigin(video);
  return origin ? `范围 v${origin.scopeVersion} · 运行 ${origin.runId} · 依据 ${origin.queryRef}` : '历史素材尚无发现运行溯源';
}

export function specialRecommendationForVideo(video: TrendVideo, accountVideos: TrendVideo[], accountMedians: number[]): AccountSpecialRecommendation | null {
  const analysis = video.aiAnalysis;
  if (!analysis?.sourceAccount) return null;
  const currentViews = reliablePublicViews(video.views);
  const history = accountVideos.map(item => reliablePublicViews(item.views)).filter(value => value > 0);
  if (!currentViews || history.length < 8) return null;
  const baselineValue = median(history);
  if (!baselineValue) return null;
  const multiple = currentViews / baselineValue;
  let baselineLevel = analysis.accountBaselineLevel;
  if (!baselineLevel && accountMedians.length >= 3) {
    const sorted = [...accountMedians].sort((a, b) => a - b);
    const percentile = sorted.filter(value => value <= baselineValue).length / sorted.length;
    baselineLevel = percentile <= .3 ? 'low' : percentile <= .7 ? 'medium' : 'high';
  }
  if (!baselineLevel) return null;
  const baseline = baselineLevel === 'low' ? '低基线账号' : baselineLevel === 'medium' ? '中基线账号' : '高基线账号';
  const level = baselineLevel === 'low' && multiple >= 10 ? '极高'
    : baselineLevel === 'low' && multiple >= 5 ? '高'
    : baselineLevel === 'medium' && multiple >= 5 ? '高'
    : baselineLevel === 'high' && multiple >= 3 ? '较高' : null;
  if (!level) return null;
  return { level, baseline, multiple, message: `${baseline}跑出日常 ${multiple.toFixed(1)} 倍播放，内容结构具有${level}借鉴价值，建议优先拆解复用。` };
}

export function timeValue(value?: string): number {
  const t = value ? new Date(value).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}
