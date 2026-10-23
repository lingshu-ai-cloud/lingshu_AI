import { authHeader } from './auth';
import { isDisplayableVideoAnalysis, trendFromEvidence } from './inspirationDataQuality';
import type { TrendVideo, VideoAnalysisPayload } from './inspirationTypes';

type ViralRecord = {
  id?: string; platform?: string; title?: string; thumbnailUrl?: string; duration?: number;
  sourceUrl?: string; tags?: string; aiAnalysis?: string; status?: TrendVideo['status'];
  videoFileId?: string; crawledAt?: string; canManage?: boolean;
};

const PLATFORMS = new Set<TrendVideo['platform']>(['tiktok', 'instagram', 'youtube', 'facebook', 'linkedin']);

export function viralRecordToVideo(record: ViralRecord): TrendVideo | null {
  if (!record.id || !PLATFORMS.has(record.platform as TrendVideo['platform'])) return null;
  let analysis: VideoAnalysisPayload = {};
  try { analysis = JSON.parse(record.aiAnalysis || '{}') as VideoAnalysisPayload; }
  catch { /* invalid analysis stays visible with source metadata */ }
  if (analysis.contentFormat === 'image') return null;
  const sourceUrl = String(record.sourceUrl || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl) && !record.videoFileId) return null;
  if (!isDisplayableVideoAnalysis(analysis, record.status)) return null;
  return {
    id: `crawl-${record.id}`,
    recordId: record.id,
    platform: record.platform as TrendVideo['platform'],
    title: record.title?.trim() || '未命名视频',
    thumbnail: record.thumbnailUrl || (record.videoFileId ? `/api/overseas/videos/${encodeURIComponent(record.id)}/thumbnail` : ''),
    duration: Number(record.duration || 0),
    tags: [],
    views: String(analysis.views || '—'),
    trend: trendFromEvidence(analysis),
    videoUrl: record.videoFileId ? `/api/overseas/videos/${encodeURIComponent(record.id)}/media-url` : undefined,
    sourceUrl,
    status: record.status,
    aiAnalysis: analysis,
    crawledAt: record.crawledAt,
    contentFormat: 'video',
    canManage: Boolean(record.canManage),
  };
}

export async function fetchViralFeed(signal: AbortSignal): Promise<TrendVideo[]> {
  const response = await fetch('/api/overseas/videos?page=1&perPage=100&contentFormat=video&crawlRange=all', {
    headers: authHeader(), signal,
  });
  if (!response.ok) throw new Error(`爆款视频加载失败（HTTP ${response.status}）`);
  const body = await response.json() as { items?: ViralRecord[] };
  if (!Array.isArray(body.items)) throw new Error('爆款视频列表格式异常');
  return body.items.map(viralRecordToVideo).filter((video): video is TrendVideo => Boolean(video))
    .filter((video, index, items) => !video.sourceUrl || items.findIndex(item => item.sourceUrl === video.sourceUrl) === index)
    .sort((a, b) => (Date.parse(b.crawledAt || '') || 0) - (Date.parse(a.crawledAt || '') || 0) || a.id.localeCompare(b.id));
}

export async function fetchViralFirstRow(signal: AbortSignal): Promise<TrendVideo[]> {
  return (await fetchViralFeed(signal)).slice(0, 4);
}
