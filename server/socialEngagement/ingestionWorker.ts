import type { PlatformCapabilityEvidence } from '../publishing/platformCapabilities.js';
import { PLATFORM_CAPABILITY_EVIDENCE_COLLECTION } from '../publishing/platformCapabilities.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { ingestEngagementEvents } from './ingestion.js';
import { createMetaCommentAdapter, createYouTubeCommentAdapter } from './platformAdapters.js';

const text = (value: unknown): string => String(value ?? '').trim();

export interface EngagementWorkerResult {
  targets: number;
  ingested: number;
  repeated: number;
  unavailable: number;
  errors: Array<{ tenantId: string; accountId: string; code: string }>;
}

export async function runEngagementIngestionScan(input: { dataStore?: DataStore; now?: Date } = {}): Promise<EngagementWorkerResult> {
  const dataStore = input.dataStore ?? store;
  const now = input.now ?? new Date();
  const evidenceRows = await dataStore.list<PlatformCapabilityEvidence>(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, {
    where: { capability: 'engagement.comments', status: 'verified' }, sort: '-verified_at', page: 1, perPage: 500,
  });
  const latest = new Map<string, PlatformCapabilityEvidence>();
  for (const evidence of evidenceRows.items) {
    const key = `${evidence.tenant_id}:${evidence.platform}:${evidence.account_id}`;
    if (!latest.has(key)) latest.set(key, evidence);
  }
  const result: EngagementWorkerResult = { targets: latest.size, ingested: 0, repeated: 0, unavailable: 0, errors: [] };
  for (const evidence of latest.values()) {
    const tenantId = text(evidence.tenant_id), accountId = text(evidence.account_id);
    try {
      if (evidence.expires_at && Date.parse(evidence.expires_at) <= now.getTime()) { result.unavailable += 1; continue; }
      const collection = evidence.platform === 'youtube' ? 'youtube_accounts' : 'social_accounts';
      const account = await dataStore.getById<Record<string, unknown> & { id: string }>(collection, accountId);
      if (!account || text(account.tenantId ?? account.tenant_id) !== tenantId || text(account.status) !== 'connected') {
        result.unavailable += 1; continue;
      }
      const adapter = evidence.platform === 'youtube'
        ? createYouTubeCommentAdapter(account, evidence.verified_at)
        : evidence.platform === 'facebook' || evidence.platform === 'instagram'
          ? createMetaCommentAdapter(account, evidence.platform, evidence.verified_at, process.env.META_GRAPH_VERSION?.trim() || 'v25.0')
          : null;
      if (!adapter) { result.unavailable += 1; continue; }
      const ingestion = await ingestEngagementEvents({
        tenantId, accountId, adapter, dataStore, now,
        verifyAccountOwnership: async (expectedTenant, expectedAccount, platform) => {
          const targetCollection = platform === 'youtube' ? 'youtube_accounts' : 'social_accounts';
          const owned = await dataStore.getById<Record<string, unknown> & { id: string }>(targetCollection, expectedAccount);
          return Boolean(owned && text(owned.tenantId ?? owned.tenant_id) === expectedTenant && text(owned.platform || platform) === platform);
        },
      });
      result.ingested += ingestion.items.length - ingestion.repeated;
      result.repeated += ingestion.repeated;
    } catch (error) {
      if (error instanceof Error && error.message === 'engagement_retry_not_due') continue;
      result.errors.push({ tenantId, accountId, code: error instanceof Error ? error.message : 'engagement_ingestion_failed' });
    }
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runEngagementIngestionScan();
    if (result.ingested || result.errors.length) console.log(`[engagement-ingestion-worker] targets=${result.targets} ingested=${result.ingested} repeated=${result.repeated} errors=${result.errors.length}`);
  } catch (error) {
    console.error('[engagement-ingestion-worker] cycle failed:', error instanceof Error ? error.message : error);
  } finally { running = false; }
}

export function initEngagementIngestionWorker(): void {
  if (process.env.SOCIAL_ENGAGEMENT_INGESTION_WORKER_ENABLED !== 'true' || timer) return;
  const configured = Number(process.env.SOCIAL_ENGAGEMENT_INGESTION_INTERVAL_MS || 60_000);
  const interval = Number.isFinite(configured) ? Math.min(Math.max(configured, 10_000), 15 * 60_000) : 60_000;
  void tick();
  timer = setInterval(() => { void tick(); }, interval);
  timer.unref?.();
  console.log(`[engagement-ingestion-worker] enabled interval=${interval}ms`);
}
