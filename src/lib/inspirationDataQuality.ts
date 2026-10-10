export type InspirationTrend = 'hot' | 'rising' | 'stable';

export function trendFromEvidence(analysis: {
  publicBaseline?: ({ relativeMultiple?: number | null } & Record<string, unknown>);
  relativeViewMultiple?: number | null;
}): InspirationTrend {
  const multiple = analysis.publicBaseline?.relativeMultiple ?? analysis.relativeViewMultiple;
  if (typeof multiple !== 'number' || !Number.isFinite(multiple)) return 'stable';
  if (multiple >= 3) return 'hot';
  if (multiple >= 1.5) return 'rising';
  return 'stable';
}

export function displayDuration(duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return '时长未知';
  return `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`;
}

export function canProcessVideo(video: { contentFormat: string; duration: number }): boolean {
  return video.contentFormat === 'image' || (Number.isFinite(video.duration) && video.duration > 0);
}

export function resultEmptyState(total: number, search: string, hasFilters: boolean): 'no-data' | 'no-match' {
  return total === 0 && !search.trim() && !hasFilters ? 'no-data' : 'no-match';
}

export function sourceScopeLabel(video: { aiAnalysis?: { crawlRule?: string }; sourceUrl?: string }): string {
  const rule = String(video.aiAnalysis?.crawlRule || '').trim();
  if (/主页|账号|profile|channel/i.test(rule)) return '账号主页采集';
  return video.sourceUrl ? '视频级原链接' : '本地素材';
}
