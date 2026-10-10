import { createHash } from 'node:crypto';
import type {
  AccountContentSyncPage,
  ExternalSocialContent,
  SocialChannelId,
  SocialDataSource,
  SocialMetricSnapshot,
  SocialMetricValue,
  SocialSyncCursor,
} from '../../shared/contracts/socialChannels.js';

export class SocialMonitorError extends Error {
  constructor(readonly code: string, readonly status = 400, message = code) {
    super(message);
    this.name = 'SocialMonitorError';
  }
}

const text = (value: unknown): string => String(value ?? '').trim();
const validId = (value: unknown): boolean => /^[a-z0-9:_-]{1,300}$/i.test(text(value));
const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const METRIC_NAMES = [
  'views',
  'likes',
  'comments',
  'shares',
  'favorites',
  'completionRate',
  'followerDelta',
  'attributedInquiries',
] as const;

export type NormalizedMetricName = (typeof METRIC_NAMES)[number];

function metricValue(value: unknown): SocialMetricValue {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function freshness(source: SocialDataSource, capturedAt: string, now: Date): Pick<SocialMetricSnapshot, 'freshness' | 'freshnessReason'> {
  const captured = new Date(capturedAt).getTime();
  if (!Number.isFinite(captured) || captured > now.getTime() + 60_000) {
    return { freshness: 'unknown', freshnessReason: 'capture_time_invalid' };
  }
  const thresholds: Record<SocialDataSource, number> = {
    official_api: 25 * 60 * 60 * 1_000,
    assisted_browser: 2 * 60 * 60 * 1_000,
    public_page: 24 * 60 * 60 * 1_000,
    manual_import: 30 * 24 * 60 * 60 * 1_000,
  };
  return now.getTime() - captured <= thresholds[source]
    ? { freshness: 'fresh' }
    : { freshness: 'stale', freshnessReason: 'source_snapshot_expired' };
}

export interface ProviderContentItem {
  externalContentId: string;
  publicUrl?: string;
  title?: string;
  publishedAt?: string;
  status?: ExternalSocialContent['status'];
  linkedPackageId?: string;
  metrics?: Partial<Record<NormalizedMetricName, unknown>>;
  providerObservedAt?: string;
  rawFields?: Record<string, unknown>;
}

export interface NormalizeAccountContentPageInput {
  tenantId: string;
  channelId: SocialChannelId;
  accountId: string;
  source: SocialDataSource;
  coverage: AccountContentSyncPage['coverage'];
  capturedAt: string;
  items: ProviderContentItem[];
  opaqueCursor?: string;
  lastSuccessfulSyncAt?: string;
  nextRetryAt?: string;
  now?: Date;
}

function safePublicUrl(value: unknown): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return undefined;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return undefined; }
}

export function normalizeAccountContentPage(input: NormalizeAccountContentPageInput): AccountContentSyncPage {
  if (!validId(input.tenantId) || !validId(input.accountId)) {
    throw new SocialMonitorError('social_monitor_identity_invalid');
  }
  const capturedAt = new Date(input.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new SocialMonitorError('social_monitor_capture_time_invalid');
  const now = input.now ?? new Date();
  const seen = new Set<string>();
  const items: ExternalSocialContent[] = [];
  const metricSnapshots: SocialMetricSnapshot[] = [];
  for (const raw of input.items) {
    const externalContentId = text(raw.externalContentId);
    if (!validId(externalContentId) || seen.has(externalContentId)) {
      throw new SocialMonitorError('social_monitor_content_id_invalid');
    }
    seen.add(externalContentId);
    const item: ExternalSocialContent = {
      schemaVersion: 'external-social-content.v1',
      tenantId: text(input.tenantId),
      channelId: input.channelId,
      accountId: text(input.accountId),
      externalContentId,
      ...(safePublicUrl(raw.publicUrl) ? { publicUrl: safePublicUrl(raw.publicUrl) } : {}),
      ...(text(raw.title) ? { title: text(raw.title).slice(0, 500) } : {}),
      ...(text(raw.publishedAt) && Number.isFinite(new Date(text(raw.publishedAt)).getTime())
        ? { publishedAt: new Date(text(raw.publishedAt)).toISOString() } : {}),
      status: ['published', 'private', 'deleted', 'processing'].includes(text(raw.status))
        ? raw.status as ExternalSocialContent['status'] : 'unknown',
      ...(validId(raw.linkedPackageId) ? { linkedPackageId: text(raw.linkedPackageId) } : {}),
      source: input.source,
      observedAt: capturedAt.toISOString(),
    };
    items.push(item);
    const metrics = Object.fromEntries(METRIC_NAMES.map(name => [name, metricValue(raw.metrics?.[name])])) as unknown as SocialMetricSnapshot['metrics'];
    const unavailableMetrics = METRIC_NAMES.filter(name => metrics[name] === null);
    const snapshotSubject = {
      tenantId: item.tenantId,
      channelId: item.channelId,
      accountId: item.accountId,
      externalContentId,
      source: input.source,
      capturedAt: capturedAt.toISOString(),
      metrics,
    };
    metricSnapshots.push({
      schemaVersion: 'social-metric-snapshot.v1',
      snapshotId: `sms_${sha256(snapshotSubject).slice(0, 24)}`,
      ...snapshotSubject,
      ...(text(raw.providerObservedAt) && Number.isFinite(new Date(text(raw.providerObservedAt)).getTime())
        ? { providerObservedAt: new Date(text(raw.providerObservedAt)).toISOString() } : {}),
      ...freshness(input.source, capturedAt.toISOString(), now),
      unavailableMetrics,
      ...(raw.rawFields ? { rawFieldDigest: sha256(raw.rawFields) } : {}),
    });
  }
  const opaqueCursor = text(input.opaqueCursor) || undefined;
  const cursorSubject = {
    tenantId: text(input.tenantId),
    channelId: input.channelId,
    accountId: text(input.accountId),
    source: input.source,
    opaqueCursor,
    capturedAt: capturedAt.toISOString(),
  };
  const cursor: SocialSyncCursor = {
    schemaVersion: 'social-sync-cursor.v1',
    tenantId: cursorSubject.tenantId,
    channelId: input.channelId,
    accountId: cursorSubject.accountId,
    source: input.source,
    ...(opaqueCursor ? { opaqueCursor } : {}),
    ...(text(input.lastSuccessfulSyncAt) ? { lastSuccessfulSyncAt: text(input.lastSuccessfulSyncAt) } : {}),
    ...(text(input.nextRetryAt) ? { nextRetryAt: text(input.nextRetryAt) } : {}),
    capturedAt: capturedAt.toISOString(),
    cursorDigest: sha256(cursorSubject),
  };
  return { items, metricSnapshots, cursor, source: input.source, coverage: input.coverage };
}
