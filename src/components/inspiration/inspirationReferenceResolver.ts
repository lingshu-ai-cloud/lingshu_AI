import type { Platform, TrendVideo } from '../../lib/inspirationTypes';
import { ACTIVE_PLATFORMS, recordsToVideos, type CrawlerRecord } from './inspirationVideoProjection';
import { normalizedReferenceText, videoMatchesReference, type InspirationReferenceTarget } from './inspirationReferenceTarget';

type ReadOnlyFetcher = (url: string, init: { headers: Record<string, string> }) => Promise<Pick<Response, 'ok' | 'json'>>;

export type ResolvedInspirationReference = { video: TrendVideo; source: 'record' | 'weekly-plan-snapshot' };

function frozenWeeklyReference(target: InspirationReferenceTarget): TrendVideo {
  const platform = ACTIVE_PLATFORMS.includes(target.platform as Exclude<Platform, 'all'>)
    ? target.platform as Exclude<Platform, 'all'>
    : 'tiktok';
  return {
    id: `weekly-reference-${target.referenceId || normalizedReferenceText(target.title)}`,
    platform,
    title: target.title || '周计划爆款参考',
    thumbnail: target.thumbnailUrl,
    duration: target.duration,
    tags: [],
    views: '—',
    trend: 'stable',
    sourceUrl: target.sourceUrl || undefined,
    status: 'analyzed',
    contentFormat: 'video',
    aiAnalysis: {
      benchmarkAnalysis: target.benchmarkAnalysis,
      analysisSource: 'weekly-plan-snapshot',
      analysisQuality: 'snapshot',
      geminiStatus: 'analyzed',
      gemini: { theme: target.title || '周计划爆款参考' },
    },
  };
}

/** Only reads the current inventory and source record; missing records use the frozen weekly evidence. */
export async function resolveInspirationReference(input: {
  target: InspirationReferenceTarget;
  loadedVideos: TrendVideo[];
  headers: Record<string, string>;
  fetcher: ReadOnlyFetcher;
}): Promise<ResolvedInspirationReference> {
  const { target, loadedVideos, headers, fetcher } = input;
  const normalizedId = target.referenceId.replace(/^crawl-/, '');
  let match = loadedVideos.find(video => videoMatchesReference(video, target));
  if (!match && normalizedId) {
    try {
      const response = await fetcher(`/api/overseas/videos/${encodeURIComponent(normalizedId)}`, { headers });
      if (response.ok) match = recordsToVideos([await response.json() as CrawlerRecord])[0];
    } catch {
      // Keep searching the tenant's read-only inventory by title if direct lookup fails.
    }
  }
  if (!match && target.title) {
    try {
      const searchTitle = normalizedReferenceText(target.title).split(' ').slice(0, 10).join(' ');
      const response = await fetcher(`/api/overseas/videos?page=1&perPage=100&contentFormat=video&crawlRange=all&search=${encodeURIComponent(searchTitle)}`, { headers });
      if (response.ok) {
        const payload = await response.json() as { items?: CrawlerRecord[] };
        match = recordsToVideos(payload.items || []).find(video => videoMatchesReference(video, target));
      }
    } catch {
      // A removed reference still has its frozen weekly-plan analysis below.
    }
  }
  return match ? { video: match, source: 'record' } : { video: frozenWeeklyReference(target), source: 'weekly-plan-snapshot' };
}
