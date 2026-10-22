import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { pbGet, pbListStrict } from '../storage/pb.js';
import { readDemoAccountRegistry } from '../lib/demoAccounts.js';
import { syncVideoAdminAlertsFromRecords, type VideoAdminAlert, type VideoFailureRecord } from '../lib/videoAdminAlerts.js';
import { matchesCrawlRange, matchesVideoSearch } from './videos.js';
import { store } from '../storage/index.js';
import { listLocalTenants } from '../lib/localTenants.js';

export type VideoAlertAccountType = 'trial' | 'customer' | 'admin' | 'unknown';

export interface VideoAlertAccountMeta {
  accountType: VideoAlertAccountType;
  accountTypeLabel: string;
  tenantName: string;
  accountEmail: string;
}

export function localAccountId(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'demo';
}

export function accountTypeLabel(type: VideoAlertAccountType): string {
  if (type === 'trial') return '试用账号';
  if (type === 'customer') return '正式账号';
  if (type === 'admin') return '管理员账号';
  return '未知账号';
}

export async function listAllPbRecords<T extends Record<string, unknown>>(collection: string, sort?: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await pbListStrict<T>(collection, { page, perPage: 500, sort });
    items.push(...result.items);
    totalPages = Math.max(1, Math.min(100, result.totalPages || 1));
    page += 1;
  } while (page <= totalPages);
  return items;
}

export let videoAlertSyncAt = 0;
export let videoAlertSyncResult: VideoAlertReconciliation | null = null;
export let videoAlertSyncPromise: Promise<VideoAlertReconciliation> | null = null;

export interface VideoAlertReconciliation {
  ok: boolean;
  source: 'pocketbase' | 'snapshot' | 'alerts-only';
  scanned: number;
  synced: number;
  warning?: string;
}

export type InspirationContentFormat = 'video' | 'image';

export function recordAnalysis(record: Record<string, unknown>): Record<string, unknown> {
  const value = record.aiAnalysis;
  let analysis: Record<string, unknown> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) analysis = { ...(value as Record<string, unknown>) };
  try {
    if (!Object.keys(analysis).length) {
      const parsed = JSON.parse(String(value || '{}')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) analysis = parsed as Record<string, unknown>;
    }
  } catch { /* malformed legacy analysis remains empty */ }
  const compressed = typeof analysis.imageEvidenceGzip === 'string' ? analysis.imageEvidenceGzip : '';
  if (!analysis.imageEvidence && compressed) {
    try { analysis.imageEvidence = JSON.parse(gunzipSync(Buffer.from(compressed, 'base64')).toString('utf8')); }
    catch { /* keep evidence unavailable rather than inventing it */ }
  }
  delete analysis.imageEvidenceGzip;
  delete analysis.imageEvidenceEncoding;
  return analysis;
}

export function isAdminInspirationRecord(record: Record<string, unknown>, contentFormat: InspirationContentFormat): boolean {
  const analysis = recordAnalysis(record);
  if (
    analysis.seededFromRecordId ||
    analysis.analysisSource === 'demo-local-video' ||
    String(analysis.crawlRule || '').includes('演示素材')
  ) return false;

  if (contentFormat === 'image') {
    if (analysis.userVisible === false) return false;
    const sourceUrl = String(record.sourceUrl || '').trim();
    const thumbnailUrl = String(record.thumbnailUrl || '').trim();
    if (analysis.contentFormat !== 'image' || !sourceUrl || !thumbnailUrl) return false;
    if (/\/(?:search|explore\/tags)\b/i.test(sourceUrl)) return false;
    return String(record.platform || '') !== 'instagram' || /\/p\//i.test(sourceUrl);
  }

  if (analysis.contentFormat === 'image') return false;
  // Crawling and full-video analysis are separate pipeline stages. Genuine
  // records should appear immediately after collection, with their current
  // pending/analyzed state, instead of disappearing until Gemini finishes.
  const sourceUrl = String(record.sourceUrl || '').trim();
  const title = String(record.title || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl) || !title || String(record.status || '') === 'failed') return false;
  const pendingDownloadStatus = String(analysis.downloadStatus || '');
  const pendingGeminiStatus = String(analysis.geminiStatus || '');
  if (pendingDownloadStatus === 'manual_required' || pendingDownloadStatus === 'failed' || pendingGeminiStatus === 'video_failed') return false;
  if (analysis.analysisQuality !== 'video' || !analysis.gemini) return true;
  // A precise re-analysis must not make an already valid benchmark disappear
  // while the replacement analysis is queued, or after that upgrade fails.
  // The original video-level evidence remains useful and the drawer needs the
  // live record so it can show progress/failure instead of reverting to cache.
  if (analysis.requestedAnalysisMode === 'exact' || analysis.analysisMode === 'exact') return true;
  const analysisSource = String(analysis.analysisSource || '');
  const geminiStatus = String(analysis.geminiStatus || '');
  const downloadStatus = String(analysis.downloadStatus || '');
  const videoFetchStatus = String(analysis.videoFetchStatus || '');
  if (analysisSource === 'metadata-fallback' || geminiStatus === 'metadata_fallback' || downloadStatus === 'metadata_only') return false;
  return (!geminiStatus || geminiStatus === 'analyzed')
    && (!downloadStatus || downloadStatus === 'analyzed' || videoFetchStatus === 'direct_url' || videoFetchStatus === 'fetched');
}

export async function listAdminInspirationVideos(input: {
  page: number;
  perPage: number;
  platform?: string;
  status?: string;
  contentFormat: InspirationContentFormat;
  search?: string;
  crawlRange?: string;
}) {
  const records: Record<string, unknown>[] = [];
  const seenSourceUrls = new Set<string>();
  const where: Record<string, string> = { contentFormat: input.contentFormat };
  if (input.platform) where.platform = input.platform;
  if (input.status) where.status = input.status;
  let scanPage = 1;
  let totalPages = 1;
  do {
    const result = await store.list<Record<string, unknown>>('trend_videos', {
      where: Object.keys(where).length ? where : undefined,
      sort: '-crawledAt',
      page: scanPage,
      perPage: 100,
    });
    for (const record of result.items) {
      if (!isAdminInspirationRecord(record, input.contentFormat)) continue;
      const sourceUrl = String(record.sourceUrl || '').trim();
      if (sourceUrl && seenSourceUrls.has(sourceUrl)) continue;
      if (sourceUrl) seenSourceUrls.add(sourceUrl);
      records.push(record);
    }
    totalPages = Math.max(1, Math.min(100, result.totalPages || 1));
    scanPage += 1;
  } while (scanPage <= totalPages);

  records.sort((a, b) => {
    const aTime = Date.parse(String(a.crawledAt || ''));
    const bTime = Date.parse(String(b.crawledAt || ''));
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });

  const ranged = records.filter(record => matchesCrawlRange(record, input.crawlRange));
  const matched = input.search?.trim() ? ranged.filter(record => matchesVideoSearch(record, input.search!)) : ranged;
  const totalItems = matched.length;
  const start = (input.page - 1) * input.perPage;
  return {
    items: matched.slice(start, start + input.perPage).map(record => ({
      ...record,
      aiAnalysis: JSON.stringify(recordAnalysis(record)),
    })),
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / input.perPage)),
    page: input.page,
    perPage: input.perPage,
  };
}

export const inspirationListCache = new Map<string, {
  expiresAt: number;
  value?: Awaited<ReturnType<typeof listAdminInspirationVideos>>;
  pending?: Promise<Awaited<ReturnType<typeof listAdminInspirationVideos>>>;
}>();

export const INSPIRATION_LIST_CACHE_MS = 5_000;

export async function cachedAdminInspirationVideos(input: Parameters<typeof listAdminInspirationVideos>[0]) {
  const key = JSON.stringify(input);
  const now = Date.now();
  const cached = inspirationListCache.get(key);
  if (cached?.value && cached.expiresAt > now) return cached.value;
  if (cached?.pending) return cached.pending;

  // Status changes from explicit analysis actions must be visible on the next
  // dashboard poll. A five-minute stale response made completed records disappear
  // or revert to their old button state.
  if (cached?.value) inspirationListCache.delete(key);

  const pending = listAdminInspirationVideos(input)
    .then(value => {
      inspirationListCache.set(key, { value, expiresAt: Date.now() + INSPIRATION_LIST_CACHE_MS });
      return value;
    })
    .catch(error => {
      inspirationListCache.delete(key);
      throw error;
    });
  inspirationListCache.set(key, { pending, expiresAt: now + INSPIRATION_LIST_CACHE_MS });
  return pending;
}

export function readTrendVideoSnapshot(): VideoFailureRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data/trend-videos.json'), 'utf8')) as unknown;
    if (Array.isArray(parsed)) return parsed as VideoFailureRecord[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)) {
      return (parsed as { items: VideoFailureRecord[] }).items;
    }
  } catch {
    // Snapshot is optional; the live PocketBase collection remains primary.
  }
  return [];
}

export async function reconcileStoredVideoAlerts(): Promise<VideoAlertReconciliation> {
  if (Date.now() - videoAlertSyncAt < 30_000 && videoAlertSyncResult) return videoAlertSyncResult;
  if (videoAlertSyncPromise) return videoAlertSyncPromise;

  videoAlertSyncPromise = (async () => {
    try {
      const records = await listAllPbRecords<VideoFailureRecord & Record<string, unknown>>('trend_videos', '-crawledAt');
      return {
        ok: true,
        source: 'pocketbase' as const,
        scanned: records.length,
        synced: syncVideoAdminAlertsFromRecords(records),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const snapshot = readTrendVideoSnapshot();
      if (snapshot.length) {
        console.warn(`[admin] video alert reconciliation using local snapshot after PocketBase failure: ${detail}`);
        return {
          ok: true,
          source: 'snapshot' as const,
          scanned: snapshot.length,
          synced: syncVideoAdminAlertsFromRecords(snapshot),
          warning: '实时视频数据库暂不可用，当前已从本地视频快照回扫失败记录。',
        };
      }
      console.warn('[admin] video alert reconciliation unavailable:', detail);
      return {
        ok: false,
        source: 'alerts-only' as const,
        scanned: 0,
        synced: 0,
        warning: '实时视频数据库和本地快照均不可用，当前仅显示已经写入的历史告警。',
      };
    }
  })();
  try {
    videoAlertSyncResult = await videoAlertSyncPromise;
    videoAlertSyncAt = Date.now();
    return videoAlertSyncResult;
  } finally {
    videoAlertSyncPromise = null;
  }
}

export async function enrichVideoAlerts(alerts: VideoAdminAlert[]) {
  const directory = new Map<string, VideoAlertAccountMeta>();
  const setAccount = (tenantId: string, input: Partial<VideoAlertAccountMeta>) => {
    if (!tenantId) return;
    const existing = directory.get(tenantId);
    const accountType = input.accountType && input.accountType !== 'unknown'
      ? input.accountType
      : existing?.accountType || 'unknown';
    directory.set(tenantId, {
      accountType,
      accountTypeLabel: accountTypeLabel(accountType),
      tenantName: input.tenantName || existing?.tenantName || tenantId,
      accountEmail: input.accountEmail || existing?.accountEmail || '',
    });
  };

  const registry = readDemoAccountRegistry();
  for (const entry of Object.values(registry)) {
    const type: VideoAlertAccountType = entry.status === 'admin'
      ? 'admin'
      : entry.status === 'customer'
        ? 'customer'
        : 'trial';
    const slug = localAccountId(entry.email);
    const tenantIds = new Set([
      String(entry.tenantId || ''),
      `local_tenant_trial_${slug}`,
      `local_tenant_${slug}`,
      ...(type === 'admin' ? [`local_tenant_admin_${slug}`] : []),
    ]);
    for (const tenantId of tenantIds) {
      setAccount(tenantId, {
        accountType: type,
        tenantName: entry.email.split('@')[0] || entry.email,
        accountEmail: entry.email,
      });
    }
  }

  for (const tenant of listLocalTenants()) {
    const plan = tenant.subscriptionPlan.toLowerCase();
    const status = tenant.subscriptionStatus.toLowerCase();
    const accountType: VideoAlertAccountType = plan === 'trial' || status === 'trialing' ? 'trial' : 'customer';
    setAccount(tenant.id, {
      accountType,
      tenantName: tenant.companyName || tenant.name || tenant.id,
      accountEmail: tenant.registeredEmail || '',
    });
  }

  for (const alert of alerts) {
    if (directory.has(alert.tenantId)) continue;
    if (alert.tenantId.startsWith('local_tenant_trial_')) {
      setAccount(alert.tenantId, { accountType: 'trial' });
    } else if (alert.tenantId.startsWith('local_tenant_customer_')) {
      setAccount(alert.tenantId, { accountType: 'customer' });
    } else if (alert.tenantId.startsWith('local_tenant_admin_')) {
      setAccount(alert.tenantId, { accountType: 'admin' });
    }
  }

  try {
    const [tenants, users] = await Promise.all([
      listAllPbRecords<Record<string, unknown>>('tenants', 'name'),
      listAllPbRecords<Record<string, unknown>>('users', 'email'),
    ]);
    for (const tenant of tenants) {
      const tenantId = bodyText(tenant.id || tenant.tenantId);
      if (!tenantId) continue;
      const plan = bodyText(tenant.subscriptionPlan || tenant.plan).toLowerCase();
      const status = bodyText(tenant.subscriptionStatus || tenant.status).toLowerCase();
      const type: VideoAlertAccountType = plan === 'trial' || status === 'trialing'
        ? 'trial'
        : plan === 'admin' || status === 'admin'
          ? 'admin'
          : 'customer';
      const accountEmail = bodyText(tenant.registeredEmail)
        || bodyText(users.find(user => bodyText(user.tenantId) === tenantId)?.email);
      setAccount(tenantId, {
        accountType: type,
        tenantName: bodyText(tenant.name || tenant.companyName || tenant.company) || tenantId,
        accountEmail,
      });
    }
  } catch (error) {
    console.warn('[admin] video alert account metadata unavailable:', error instanceof Error ? error.message : error);
  }

  return alerts.map(alert => {
    const fallbackType: VideoAlertAccountType = alert.tenantId.includes('_trial_')
      ? 'trial'
      : alert.tenantId.includes('_customer_')
        ? 'customer'
        : 'unknown';
    const account = directory.get(alert.tenantId) || {
      accountType: fallbackType,
      accountTypeLabel: accountTypeLabel(fallbackType),
      tenantName: alert.tenantId,
      accountEmail: '',
    };
    return { ...alert, ...account };
  });
}

export async function safePbGet(collection: string, id?: string | null) {
  if (!id) return null;
  try {
    return await pbGet(collection, id);
  } catch {
    return null;
  }
}

export function bodyText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
