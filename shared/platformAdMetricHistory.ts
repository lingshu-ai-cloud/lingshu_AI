export type PlatformAdMetricValues = { spend: number | null; impressions: number | null; clicks: number | null; results: number | null };
export type PlatformAdMetricResource = { provider: 'meta' | 'tiktok'; accountId: string; campaignId: string; currency: string; metricDefinition: string; metricLabel: string; reportTimezone: string; daily: Array<PlatformAdMetricValues & { date: string }> };
export type PlatformAdMetricSnapshot = Omit<PlatformAdMetricResource, 'daily'> & { id: string; date: string; values: PlatformAdMetricValues; reportedAt: string; updatedAt: string };
export type PlatformAdMetricHistory = { items: PlatformAdMetricSnapshot[]; window: { since: string; until: string }; source: 'local_snapshots'; dataNote: string };
