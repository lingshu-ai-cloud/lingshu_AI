import { authHeader } from './auth';
import { recordsToVideos } from '../components/inspiration/inspirationVideoProjection';
import { isDisplayableVideoAnalysis } from './inspirationDataQuality';
import type { TrendVideo } from './inspirationTypes';

type ViralRecord = {
  id?: string; platform?: string; title?: string; thumbnailUrl?: string; duration?: number;
  sourceUrl?: string; tags?: string; aiAnalysis?: string; status?: TrendVideo['status'];
  videoFileId?: string; crawledAt?: string; canManage?: boolean;
};

const PLATFORMS = new Set<TrendVideo['platform']>(['tiktok', 'instagram', 'youtube', 'facebook', 'linkedin']);

export function viralRecordToVideo(record: ViralRecord): TrendVideo | null {
  if (!record.id || !PLATFORMS.has(record.platform as TrendVideo['platform'])) return null;
  const video = recordsToVideos([{ ...record, id: record.id, platform: record.platform as Exclude<TrendVideo['platform'], 'all'> }])[0];
  if (!video || video.contentFormat === 'image' || !isDisplayableVideoAnalysis(video.aiAnalysis, video.status)) return null;
  if (!/^https?:\/\//i.test(video.sourceUrl || '') && !video.videoUrl) return null;
  return video;
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
