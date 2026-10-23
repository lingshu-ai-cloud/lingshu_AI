import type { MetaMetricValues } from './metaPerformance.js';

export interface MetaAccountHistory {
  source: 'provider'; accountId: string; accountName: string; currency: string; timezone: string;
  reportedAt: string; scope: 'maximum'; complete: boolean; hasAccountSpend: boolean | null;
  billing: { prepay: boolean | null; settingsUrl: string; error?: string };
  items: Array<{ adId: string; adName: string; campaignId: string; campaignName: string;
    since: string; until: string; metrics: MetaMetricValues }>;
}
