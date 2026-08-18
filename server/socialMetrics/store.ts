import { store } from '../storage/index.js';
import { normalizeMetricValues, type MetricSnapshot, type MetricValues } from './aggregation.js';

export const SOCIAL_METRICS_COLLECTION = 'social_metric_snapshots';

interface StoredMetricSnapshot extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  platform: string;
  account_id: string;
  content_id?: string;
  captured_at: string;
  value_kind?: string;
  metrics: unknown;
}

export interface SaveMetricSnapshotInput {
  tenantId: string;
  platform: 'facebook' | 'instagram' | 'tiktok' | 'youtube';
  accountId: string;
  contentId?: string;
  capturedAt?: string;
  valueKind?: 'cumulative' | 'daily';
  metrics: MetricValues;
  rawMetrics?: Record<string, unknown>;
}

export async function saveSocialMetricSnapshot(input: SaveMetricSnapshotInput): Promise<boolean> {
  const metrics = normalizeMetricValues(input.metrics);
  if (!input.tenantId || !input.accountId || Object.keys(metrics).length === 0) return false;
  const capturedAt = new Date(input.capturedAt || Date.now()).toISOString();
  const date = capturedAt.slice(0, 10);
  const contentId = input.contentId || '';
  const existing = await store.list<StoredMetricSnapshot>(SOCIAL_METRICS_COLLECTION, {
    where: {
      tenant_id: input.tenantId,
      platform: input.platform,
      account_id: input.accountId,
      content_id: contentId,
      snapshot_date: date,
    },
    page: 1,
    perPage: 1,
  });
  const data = {
    tenant_id: input.tenantId,
    platform: input.platform,
    account_id: input.accountId,
    content_id: contentId,
    snapshot_date: date,
    captured_at: capturedAt,
    value_kind: input.valueKind || 'cumulative',
    metrics,
    raw_metrics: input.rawMetrics || {},
  };
  if (existing.items[0]) return store.update(SOCIAL_METRICS_COLLECTION, existing.items[0].id, data);
  return Boolean(await store.create(SOCIAL_METRICS_COLLECTION, data));
}

export async function listSocialMetricSnapshots(tenantId: string, platform?: string): Promise<MetricSnapshot[]> {
  const result = await store.list<StoredMetricSnapshot>(SOCIAL_METRICS_COLLECTION, {
    where: { tenant_id: tenantId, ...(platform ? { platform } : {}) },
    sort: 'captured_at',
    page: 1,
    perPage: 5000,
  });
  return result.items.map(item => ({
    id: item.id,
    platform: String(item.platform || ''),
    accountId: String(item.account_id || ''),
    contentId: String(item.content_id || '') || undefined,
    capturedAt: String(item.captured_at || ''),
    valueKind: (item.value_kind === 'daily' ? 'daily' : 'cumulative') as MetricSnapshot['valueKind'],
    metrics: normalizeMetricValues(item.metrics),
  })).filter(item => item.platform && item.accountId && item.capturedAt);
}
