import { Router, type Request, type Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform } from '../types/index.js';
import { crawlVideosForTenant } from './videos.js';

export const crawlWorkerRouter = Router();

const COL = 'crawl_jobs';
const WORKER_TOKEN_HEADER = 'x-crawl-worker-token';
const WORKER_LEASE_MS = 10 * 60 * 1000;
const WORKER_HEARTBEAT_MS = Math.max(5_000, Math.floor(WORKER_LEASE_MS / 3));
const CLAIM_PAGE_SIZE = 100;
let cloudFallbackTimer: NodeJS.Timeout | null = null;
let cloudFallbackActive = false;

type CrawlJobStatus = 'queued' | 'running' | 'done' | 'failed';
type CrawlJobMode = 'keyword' | 'account';

interface CrawlJob {
  id: string;
  tenantId: string;
  requestedBy: string;
  platform: Platform;
  mode: CrawlJobMode;
  keyword: string;
  accountUrl: string;
  accountName: string;
  limit: number;
  status: CrawlJobStatus;
  workerId: string;
  attempts: number;
  resultJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  leasedUntil: string;
  finishedAt: string;
  leaseToken: string;
  revision: number;
}

export type CreateCrawlWorkerJobInput = {
  tenantId: string;
  requestedBy: string;
  platform: Platform;
  mode: CrawlJobMode;
  keyword?: string;
  accountUrl?: string;
  accountName?: string;
  limit?: number;
};

function workerToken(): string {
  return process.env.CRAWL_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-crawl-worker-token');
}

function equalSecret(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireWorker(req: Request, res: Response): boolean {
  const accepted = [workerToken(), String(process.env.CRAWL_WORKER_TOKEN_PREVIOUS || '').trim()].filter(Boolean);
  const actual = String(req.headers[WORKER_TOKEN_HEADER] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
  if (!accepted.some(expected => equalSecret(actual, expected))) {
    res.status(401).json({ error: 'worker_unauthorized' });
    return false;
  }
  return true;
}

type CrawlLeaseCredentials = { workerId: string; leaseToken: string; revision: number };

function leaseCredentials(req: Request): CrawlLeaseCredentials | null {
  const workerId = String(req.body?.workerId || req.headers['x-crawl-worker-id'] || '').trim().slice(0, 80);
  const leaseToken = String(req.body?.leaseToken || req.headers['x-crawl-lease-token'] || '').trim();
  const revision = Number(req.body?.revision ?? req.headers['x-crawl-lease-revision']);
  if (!workerId || !/^[A-Za-z0-9._:@-]{1,80}$/.test(workerId)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(leaseToken)) return null;
  if (!Number.isSafeInteger(revision) || revision < 1) return null;
  return { workerId, leaseToken, revision };
}

function publicJob(job: CrawlJob) {
  return {
    id: job.id,
    tenantId: job.tenantId,
    platform: job.platform,
    mode: job.mode,
    keyword: job.keyword,
    accountUrl: job.accountUrl,
    accountName: job.accountName,
    limit: Number(job.limit || 0),
    status: job.status,
    workerId: job.workerId || '',
    attempts: Number(job.attempts || 0),
    result: parseJson(job.resultJson),
    error: job.error || '',
    createdAt: job.createdAt || '',
    updatedAt: job.updatedAt || '',
    leasedUntil: job.leasedUntil || '',
    finishedAt: job.finishedAt || '',
  };
}

function parseJson(value: string): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function isLeaseExpired(job: CrawlJob): boolean {
  const leasedUntil = Date.parse(job.leasedUntil || '');
  return !Number.isFinite(leasedUntil) || leasedUntil <= Date.now();
}

function sameLease(job: CrawlJob, credentials: CrawlLeaseCredentials): boolean {
  return job.status === 'running'
    && job.workerId === credentials.workerId
    && job.leaseToken === credentials.leaseToken
    && Number(job.revision || 0) === credentials.revision
    && !isLeaseExpired(job);
}

async function claimCrawlJob(job: CrawlJob, workerId: string): Promise<CrawlJob | null> {
  const updatedAt = nowIso();
  const leasedUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
  const leaseToken = randomUUID();
  const revision = Number(job.revision || 0) + 1;
  const claimed = await store.compareAndSet<CrawlJob>(COL, job.id, {
    status: job.status,
    workerId: job.workerId || '',
    leasedUntil: job.leasedUntil || '',
    leaseToken: job.leaseToken || '',
    revision: Number(job.revision || 0),
  }, {
    status: 'running', workerId, leaseToken, revision,
    attempts: Number(job.attempts || 0) + 1,
    updatedAt, leasedUntil, error: '', finishedAt: '',
  });
  return claimed.ok ? claimed.record : null;
}

async function renewCrawlJobLease(job: CrawlJob, credentials: CrawlLeaseCredentials): Promise<CrawlJob | null> {
  if (!sameLease(job, credentials)) return null;
  const leasedUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
  const renewed = await store.compareAndSet<CrawlJob>(COL, job.id, {
    status: 'running', workerId: credentials.workerId, leaseToken: credentials.leaseToken,
    revision: credentials.revision, leasedUntil: job.leasedUntil,
  }, {
    leasedUntil,
    revision: credentials.revision + 1,
    updatedAt: nowIso(),
  });
  return renewed.ok ? renewed.record : null;
}

/**
 * Scan every page for a claimable record of one status. Filtering by status is
 * intentional: unrelated completed history must never hide the 101st queued
 * job. CAS remains the authority when concurrent pollers see the same page.
 */
async function claimFirstMatching(
  workerId: string,
  status: CrawlJobStatus,
  sort: string,
  predicate: (job: CrawlJob) => boolean,
): Promise<CrawlJob | null> {
  let page = 1;
  while (true) {
    const result = await store.list<CrawlJob>(COL, {
      where: { status },
      sort,
      page,
      perPage: CLAIM_PAGE_SIZE,
    });
    for (const candidate of result.items) {
      if (!predicate(candidate)) continue;
      const claimed = await claimCrawlJob(candidate, workerId);
      if (claimed) return claimed;
    }
    if (page >= Math.max(1, result.totalPages) || result.items.length === 0) return null;
    page += 1;
  }
}

function supportedWorkerPlatform(platform: string): platform is Platform {
  return platform === 'youtube' || platform === 'tiktok';
}

function cloudFallbackEnabled(): boolean {
  return process.env.CRAWL_WORKER_CLOUD_FALLBACK_ENABLED !== '0';
}

function durationEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cloudFallbackAfterMs(): number {
  return durationEnv('CRAWL_WORKER_CLOUD_FALLBACK_AFTER_MS', 120_000, 15_000, 24 * 60 * 60 * 1000);
}

function cloudFallbackPollMs(): number {
  return durationEnv('CRAWL_WORKER_CLOUD_FALLBACK_POLL_MS', 30_000, 10_000, 30 * 60 * 1000);
}

function shouldCloudFallback(job: CrawlJob): boolean {
  if (!supportedWorkerPlatform(job.platform)) return false;
  if (job.status === 'failed') return job.workerId !== 'cloud-fallback';
  if (job.status === 'queued') {
    const createdAt = Date.parse(job.createdAt || '');
    return Number.isFinite(createdAt) && Date.now() - createdAt >= cloudFallbackAfterMs();
  }
  return job.status === 'running' && isLeaseExpired(job);
}

function startCloudLeaseHeartbeat(initial: CrawlJob): {
  current: () => CrawlJob;
  lost: () => boolean;
  stop: () => Promise<void>;
} {
  let current = initial;
  let stopped = false;
  let lost = false;
  let inFlight = Promise.resolve();
  const pulse = () => {
    inFlight = inFlight.then(async () => {
      if (stopped || lost) return;
      const renewed = await renewCrawlJobLease(current, {
        workerId: current.workerId,
        leaseToken: current.leaseToken,
        revision: Number(current.revision || 0),
      });
      if (!renewed) {
        lost = true;
        return;
      }
      current = renewed;
    }).catch((error) => {
      // A transient datastore failure does not prove lease loss. The next pulse
      // may recover, while completion still fails closed once the lease expires.
      console.warn('[crawl-worker] cloud fallback heartbeat failed:', error instanceof Error ? error.message : error);
    });
  };
  const timer = setInterval(pulse, WORKER_HEARTBEAT_MS);
  timer.unref?.();
  return {
    current: () => current,
    lost: () => lost,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}

async function runClaimedCloudFallbackJob(claimed: CrawlJob): Promise<void> {
  const started = Date.now();
  const workerId = 'cloud-fallback';
  const heartbeat = startCloudLeaseHeartbeat(claimed);

  try {
    const result = await crawlVideosForTenant({
      tenantId: claimed.tenantId,
      platform: claimed.platform,
      mode: claimed.mode,
      keyword: claimed.keyword || '',
      accountUrl: claimed.accountUrl || '',
      accountName: claimed.accountName || '',
      limit: claimed.limit || 10,
      cloudFallback: true,
    });
    await heartbeat.stop();
    const current = heartbeat.current();
    const finishedAt = nowIso();
    if (heartbeat.lost() || isLeaseExpired(current)) throw new Error('crawl_worker_lease_expired_before_completion');
    const completed = await store.compareAndSet<CrawlJob>(COL, current.id, {
      status: 'running', workerId, leaseToken: current.leaseToken,
      revision: Number(current.revision || 0), leasedUntil: current.leasedUntil,
    }, {
      status: 'done',
      workerId,
      resultJson: JSON.stringify({
        platform: result.platform,
        requested: result.requested,
        imported: result.imported,
        refreshed: result.refreshed,
        skipped: result.skipped,
        skippedExisting: result.skippedExisting,
        returnedExisting: result.returnedExisting,
        total: result.total,
        source: `cloud-fallback:${result.source}`,
        message: `云端兜底完成：${result.message}`,
        elapsedMs: Date.now() - started,
      }),
      error: '',
      updatedAt: finishedAt,
      finishedAt,
      leasedUntil: '',
      leaseToken: '',
      revision: Number(current.revision || 0) + 1,
    });
    if (!completed.ok) return;
    await notifyScheduler(claimed.requestedBy);
  } catch (error) {
    await heartbeat.stop();
    const current = heartbeat.current();
    const finishedAt = nowIso();
    if (heartbeat.lost() || isLeaseExpired(current)) return;
    const failed = await store.compareAndSet<CrawlJob>(COL, current.id, {
      status: 'running', workerId, leaseToken: current.leaseToken,
      revision: Number(current.revision || 0), leasedUntil: current.leasedUntil,
    }, {
      status: 'failed',
      workerId,
      resultJson: '',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      updatedAt: finishedAt,
      finishedAt,
      leasedUntil: '',
      leaseToken: '',
      revision: Number(current.revision || 0) + 1,
    });
    if (failed.ok) await notifyScheduler(claimed.requestedBy);
  }
}

async function notifyScheduler(requestedBy: string): Promise<void> {
  if (!requestedBy.startsWith('scheduler:')) return;
  try {
    const { reconcileScheduledCrawlBatch } = await import('./scheduler.js');
    await reconcileScheduledCrawlBatch(requestedBy);
  } catch (error) {
    console.warn('[crawl-worker] scheduler result update failed:', error instanceof Error ? error.message : error);
  }
}

async function runCloudFallbackOnce(): Promise<void> {
  if (!cloudFallbackEnabled() || cloudFallbackActive) return;
  cloudFallbackActive = true;
  try {
    const workerId = 'cloud-fallback';
    const claimed = await claimFirstMatching(workerId, 'running', 'leasedUntil', shouldCloudFallback)
      || await claimFirstMatching(workerId, 'failed', 'createdAt', shouldCloudFallback)
      || await claimFirstMatching(workerId, 'queued', 'createdAt', shouldCloudFallback);
    if (!claimed) return;
    console.warn(`[crawl-worker] cloud fallback taking over ${claimed.id} ${claimed.platform} ${claimed.mode}`);
    await runClaimedCloudFallbackJob(claimed);
  } catch (error) {
    console.warn('[crawl-worker] cloud fallback failed:', error instanceof Error ? error.message : error);
  } finally {
    cloudFallbackActive = false;
  }
}

export function initCrawlWorkerCloudFallback(): void {
  if (cloudFallbackTimer || !cloudFallbackEnabled()) return;
  cloudFallbackTimer = setInterval(() => {
    void runCloudFallbackOnce();
  }, cloudFallbackPollMs());
  cloudFallbackTimer.unref?.();
}

export async function createCrawlWorkerJob(input: CreateCrawlWorkerJobInput): Promise<CrawlJob | null> {
  const createdAt = nowIso();
  return store.create<CrawlJob>(COL, {
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
    platform: input.platform,
    mode: input.mode,
    keyword: String(input.keyword || '').trim(),
    accountUrl: String(input.accountUrl || '').trim(),
    accountName: String(input.accountName || '').trim(),
    limit: Math.min(30, Math.max(1, Number(input.limit) || 10)),
    status: 'queued',
    workerId: '',
    attempts: 0,
    resultJson: '',
    error: '',
    createdAt,
    updatedAt: createdAt,
    leasedUntil: '',
    finishedAt: '',
    leaseToken: '',
    revision: 0,
  });
}

crawlWorkerRouter.post('/jobs', requireAuth, async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const platform = String(req.body?.platform || '');
  if (!supportedWorkerPlatform(platform)) {
    res.status(400).json({ error: 'local_worker_only_supports_youtube_tiktok' });
    return;
  }

  const mode = req.body?.mode === 'account' ? 'account' : 'keyword';
  const keyword = String(req.body?.keyword || '').trim();
  const accountUrl = String(req.body?.accountUrl || '').trim();
  if (mode === 'account' && !accountUrl) {
    res.status(400).json({ error: 'accountUrl_required' });
    return;
  }
  if (mode === 'keyword' && !keyword) {
    res.status(400).json({ error: 'keyword_required' });
    return;
  }

  const job = await createCrawlWorkerJob({
    tenantId,
    requestedBy: userId,
    platform,
    mode,
    keyword,
    accountUrl,
    accountName: String(req.body?.accountName || '').trim(),
    limit: Math.min(30, Math.max(1, Number(req.body?.limit) || 10)),
  });

  if (!job) {
    res.status(500).json({ error: 'job_create_failed' });
    return;
  }
  res.status(201).json({ job: publicJob(job) });
});

crawlWorkerRouter.get('/jobs', requireAuth, async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<CrawlJob>(COL, {
    where: { tenantId },
    sort: '-createdAt',
    page: 1,
    perPage: 50,
  });
  res.json({ items: result.items.map(publicJob) });
});

crawlWorkerRouter.get('/next', async (req, res) => {
  if (!requireWorker(req, res)) return;
  const workerId = String(req.query.workerId || req.headers['x-crawl-worker-id'] || '').trim().slice(0, 80);
  if (!/^[A-Za-z0-9._:@-]{1,80}$/.test(workerId)) {
    res.status(400).json({ error: 'valid_worker_id_required' });
    return;
  }
  const claimed = await claimFirstMatching(workerId, 'running', 'leasedUntil', candidate => (
    supportedWorkerPlatform(candidate.platform) && isLeaseExpired(candidate)
  )) || await claimFirstMatching(workerId, 'queued', 'createdAt', candidate => supportedWorkerPlatform(candidate.platform));
  if (claimed) {
    await notifyScheduler(claimed.requestedBy);
    res.json({ job: { ...publicJob(claimed), leaseToken: claimed.leaseToken, revision: claimed.revision } });
    return;
  }
  res.json({ job: null });
});

crawlWorkerRouter.post('/jobs/:id/heartbeat', async (req, res) => {
  if (!requireWorker(req, res)) return;
  const credentials = leaseCredentials(req);
  if (!credentials) { res.status(400).json({ error: 'lease_credentials_required' }); return; }
  const job = await store.getById<CrawlJob>(COL, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job_not_found' });
    return;
  }
  if (!sameLease(job, credentials)) { res.status(409).json({ error: 'lease_not_owned_or_expired' }); return; }
  const heartbeat = await renewCrawlJobLease(job, credentials);
  if (!heartbeat) { res.status(409).json({ error: 'lease_conflict' }); return; }
  res.json({ ok: true, leasedUntil: heartbeat.leasedUntil, revision: heartbeat.revision });
});

crawlWorkerRouter.post('/jobs/:id/complete', async (req, res) => {
  if (!requireWorker(req, res)) return;
  const credentials = leaseCredentials(req);
  if (!credentials) { res.status(400).json({ error: 'lease_credentials_required' }); return; }
  const job = await store.getById<CrawlJob>(COL, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job_not_found' });
    return;
  }
  if (!sameLease(job, credentials)) { res.status(409).json({ error: 'lease_not_owned_or_expired' }); return; }
  const ok = req.body?.ok !== false && !req.body?.error;
  const finishedAt = nowIso();
  const completed = await store.compareAndSet<CrawlJob>(COL, job.id, {
    status: 'running', workerId: credentials.workerId, leaseToken: credentials.leaseToken,
    revision: credentials.revision, leasedUntil: job.leasedUntil,
  }, {
    status: ok ? 'done' : 'failed',
    resultJson: JSON.stringify(req.body?.result || null),
    error: ok ? '' : String(req.body?.error || 'worker_failed').slice(0, 1000),
    updatedAt: finishedAt,
    finishedAt,
    leasedUntil: '',
    leaseToken: '',
    revision: credentials.revision + 1,
  });
  if (!completed.ok) { res.status(409).json({ error: 'lease_conflict' }); return; }
  await notifyScheduler(job.requestedBy);
  res.json({ ok: true, status: ok ? 'done' : 'failed' });
});
