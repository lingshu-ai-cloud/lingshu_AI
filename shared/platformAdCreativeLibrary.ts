import type { PlatformAdCreative } from './platformAdCreatives.js';
export interface AdCreativeLibraryItem {
  key: string;
  task: { id: string; name: string; version: number; goal: string; status: string };
  connection: { id: string; accountId: string; name: string; currency: string; provider: string };
  binding: PlatformAdCreative | null;
  execution: { id: string; campaignId: string; adsetId: string; creativeId: string; adId: string } | null;
  mapping: 'creation_binding' | 'verified_existing' | 'platform_only' | 'local_only';
}
export interface AdCreativeLibraryPage {
  items: AdCreativeLibraryItem[]; page: number; perPage: number; totalItems: number; totalPages: number; truncated: boolean;
}
export interface AdCreativeReport {
  source: 'provider'; scope: 'ad'; adId: string; accountId: string; videoId: string; pageId: string;
  configuredStatus: string; effectiveStatus: string; issues: Array<{ code: number; message: string }>;
  currency: string; reportTimezone: string; reportedAt: string; window: { since: string; until: string };
  metricLabel: string; spend: number | null; impressions: number | null; clicks: number | null;
  results: number | null; costPerResult: number | null; daily: Array<{ date: string; spend: number | null; impressions: number | null; clicks: number | null; results: number | null }>;
  actionReportTime: 'impression'; useUnifiedAttributionSetting: true;
  attributionSpec: Array<{ event_type: string; window_days: number }>;
}
export interface AdCreativePreview { videoId: string; thumbnailUrl: string; width: number | null; height: number | null; duration: number | null; videoStatus: string; checkedAt: string }
