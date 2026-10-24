import type { TrendVideo } from '../../lib/inspirationTypes';
import type { BusinessModelFilter } from './inspirationDashboardContracts';

export function inspirationDiscoveryCategory(video: TrendVideo): Exclude<BusinessModelFilter, 'all'> | null {
  const analysis = video.aiAnalysis;
  // Account identity on its own also appears on keyword discoveries. Only the
  // explicit homepage collection provenance establishes a benchmark source.
  if (analysis?.crawlRule === '对标账号主页'
    && /^https:\/\//i.test(analysis.sourceAccount || analysis.sourceAccountUrl || '')) return 'benchmark';
  if (analysis?.discoveryBusinessModel === 'b2b') return 'b2b';
  if (analysis?.discoveryBusinessModel === 'd2c') return 'industry';
  // Unknown/mixed evidence does not prove a non-B2B classification.
  return null;
}

export function newestCrawledFirst(a: TrendVideo, b: TrendVideo): number {
  const time = (item: TrendVideo) => Date.parse(item.crawledAt || '') || 0;
  return time(b) - time(a) || a.id.localeCompare(b.id);
}
