import type { MetaMetricValues } from './metaPerformance.js';
import type { MetaAdAsset } from './adAccountDirectory.js';
export type MetaAudienceDimension = 'age' | 'gender' | 'country';
export interface MetaBusinessOverview {
  source: 'provider' | 'local_preview'; accountId: string; accountName: string; currency: string; timezone: string;
  window: { since: string; until: string }; reportedAt: string;
  actionReportTime: 'impression'; useUnifiedAttributionSetting: true;
  totals: MetaMetricValues | null;
  daily: Array<MetaMetricValues & { date: string }>;
  audiences: Array<{ dimension: MetaAudienceDimension; available: boolean; rows: Array<{ label: string; impressions: number | null; clicks: number | null }>; note: string }>;
  topVideos: Array<{ adId: string; name: string; metrics: MetaMetricValues; asset: MetaAdAsset }>;
  videoRankingComplete: boolean; warnings: string[];
}
