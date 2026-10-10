import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform } from '../types/index.js';
import { crawlVideosForTenant } from './videos.js';

export const crawlWorkerRouter = Router();

const COL = 'crawl_jobs';
const WORKER_TOKEN_HEADER = 'x-crawl-worker-token';
const MAX_ATTEMPTS = 3;
const WORKER_LEASE_MS = 10 * 60 * 1000;
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
  dateFrom?: string;
  dateTo?: string;
  status: CrawlJobStatus;
  workerId: string;
  attempts: number;
  resultJson: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  leasedUntil: string;
  finishedAt: string;
}

export type CreateCrawlWorkerJobInput = {
  tenantId: string;
  requestedBy: string;
  platform: Platform;
  mode: CrawlJobMode;
  idempotencyKey?: string;
  keyword?: string;
  accountUrl?: string;
  accountName?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  completed?: { result?: Record<string, unknown>; error?: string };
};

function workerToken(): string {
  return process.env.CRAWL_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-crawl-worker-token');
}

function requireWorker(req: Parameters<Router['get']>[1] extends (...args: infer P) => unknown ? P[0] : never, res: any): boolean {
  const expected = workerToken();
  const actual = String(req.headers[WORKER_TOKEN_HEADER] || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '');
  if (!expected || actual !== expected) {
    res.status(401).json({ error: 'worker_unauthorized' });
    return false;
  }
  return true;
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
    dateFrom: job.dateFrom,
    dateTo: job.dateTo,
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

function supportedWorkerPlatform(platform: string): platform is Platform {
  return platform === 'youtube' || platform === 'tiktok';
}

function cloudFallbackEnabled(): boolean {
  return process.env.CRAWL_WORKER_CLOUD_FALLBACK_ENABLED !== '0';
}

function cloudFallbackAfterMs(): number {
  return Math.max(15_000, Number(process.env.CRAWL_WORKER_CLOUD_FALLBACK_AFTER_MS || 120_000));
}

function cloudFallbackPollMs(): number {
  return Math.max(10_000, Number(process.env.CRAWL_WORKER_CLOUD_FALLBACK_POLL_MS || 30_000));
}

function shouldCloudFallback(job: CrawlJob): boolean {
  if (!['youtube','tiktok','instagram','facebook'].includes(job.platform) || job.attempts >= MAX_ATTEMPTS) return false;
  if (job.status === 'failed') return !['cloud-fallback', 'inline'].includes(job.workerId);
  if (job.status === 'queued') {
    const createdAt = Date.parse(job.createdAt || '');
    return Number.isFinite(createdAt) && Date.now() - createdAt >= cloudFallbackAfterMs();
  }
  return job.status === 'running' && isLeaseExpired(job);
}

export async function runCloudFallbackJob(job: CrawlJob, crawl = crawlVideosForTenant): Promise<void> {
  const started = Date.now();
  const workerId = 'cloud-fallback';
  const startedAt = nowIso();
  const attempts = Number(job.attempts || 0) + 1;
  await store.update(COL, job.id, {
    status: 'running',
    workerId,
    attempts: Number(job.attempts || 0) + 1,
    updatedAt: startedAt,
    leasedUntil: new Date(Date.now() + WORKER_LEASE_MS).toISOString(),
    error: '',
  });

  const ownsLease = async () => {
    const current = await store.getById<CrawlJob>(COL, job.id);
    return current?.status === 'running' && current.workerId === workerId && current.attempts === attempts;
  };
  const heartbeat = setInterval(() => {
    void (async () => {
      if (await ownsLease()) await store.update(COL, job.id, { leasedUntil: new Date(Date.now() + WORKER_LEASE_MS).toISOString(), updatedAt: nowIso() });
    })().catch(error => console.warn('[crawl-worker] fallback heartbeat failed:', error));
  }, 60_000);
  heartbeat.unref?.();
  await notifyScheduler(job.requestedBy);
  try {
    const result = await crawl({
      tenantId: job.tenantId,
      platform: job.platform,
      mode: job.mode,
      keyword: job.keyword || '',
      accountUrl: job.accountUrl || '',
      accountName: job.accountName || '',
      limit: job.limit || 10,
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      cloudFallback: true,
      deferAnalysis: true,
      disableBackfill: true,
    });
    if (!await ownsLease()) return;
    const finishedAt = nowIso();
    await store.update(COL, job.id, {
      status: 'done',
      workerId,
      resultJson: JSON.stringify({
        outcome: result.outcome,
        candidateIds: result.candidateIds,
        analysisPending: result.analysisPending,
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
    });
    await notifyScheduler(job.requestedBy);
  } catch (error) {
    if (!await ownsLease()) return;
    const finishedAt = nowIso();
    await store.update(COL, job.id, {
      status: 'failed',
      workerId,
      resultJson: '',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      updatedAt: finishedAt,
      finishedAt,
      leasedUntil: '',
    });
    await notifyScheduler(job.requestedBy);
  } finally {
    clearInterval(heartbeat);
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

async function expireExhaustedJobs(jobs: CrawlJob[]): Promise<void> {
  for (const job of jobs) {
    if (job.attempts < MAX_ATTEMPTS || (job.status !== 'queued' && !(job.status === 'running' && isLeaseExpired(job)))) continue;
    const finishedAt = nowIso();
    await store.update(COL, job.id, { status: 'failed', workerId: 'cloud-fallback', error: '采集多次中断且执行锁已过期，已停止自动重试，请重新执行。', finishedAt, updatedAt: finishedAt, leasedUntil: '' });
    job.status = 'failed';
    job.workerId = 'cloud-fallback';
    await notifyScheduler(job.requestedBy);
  }
}

async function listCrawlWorkerJobs(): Promise<CrawlJob[]> {
  const jobs: CrawlJob[] = [];
  for (let page = 1; ; page += 1) {
    const result = await store.list<CrawlJob>(COL, { sort: 'createdAt', page, perPage: 100 });
    jobs.push(...result.items);
    if (page >= result.totalPages || result.items.length < 100) return jobs;
  }
}

async function runCloudFallbackOnce(): Promise<void> {
  if (!cloudFallbackEnabled() || cloudFallbackActive) return;
  cloudFallbackActive = true;
  try {
    const jobs = await listCrawlWorkerJobs();
    await expireExhaustedJobs(jobs);
    const job = jobs.find(shouldCloudFallback);
    if (!job) return;
    console.warn(`[crawl-worker] cloud fallback taking over ${job.id} ${job.platform} ${job.mode}`);
    await runCloudFallbackJob(job);
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
  const id=input.idempotencyKey ? createHash('sha256').update(`${input.tenantId}:${input.idempotencyKey}`).digest('hex').slice(0,15) : undefined;
  if(id){const existing=await store.getById<CrawlJob>(COL,id);if(existing){if(existing.tenantId!==input.tenantId||existing.platform!==input.platform||existing.mode!==input.mode||existing.accountUrl!==String(input.accountUrl||'').trim()||existing.keyword!==String(input.keyword||'').trim())throw Error('crawl_idempotency_scope_changed');return existing;}}
  const createdAt = nowIso();
  return store.create<CrawlJob>(COL, {
    ...(id?{id}:{}),
    tenantId: input.tenantId,
    requestedBy: input.requestedBy,
    platform: input.platform,
    mode: input.mode,
    keyword: String(input.keyword || '').trim(),
    accountUrl: String(input.accountUrl || '').trim(),
    accountName: String(input.accountName || '').trim(),
    limit: Math.min(30, Math.max(1, Number(input.limit) || 10)),
    dateFrom: input.dateFrom || '',
    dateTo: input.dateTo || '',
    status: input.completed ? (input.completed.error ? 'failed' : 'done') : 'queued',
    workerId: input.completed ? 'inline' : '',
    attempts: 0,
    resultJson: input.completed?.result ? JSON.stringify(input.completed.result) : '',
    error: input.completed?.error || '',
    createdAt,
    updatedAt: createdAt,
    leasedUntil: '',
    finishedAt: input.completed ? createdAt : '',
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
  if (!requireWorker(req as any, res)) return;
  const workerId = String(req.query.workerId || req.headers['x-crawl-worker-id'] || 'mac-worker').slice(0, 80);
  const jobs = await listCrawlWorkerJobs();
  await expireExhaustedJobs(jobs);
  const job = jobs.find(item => item.status === 'queued' || (item.status === 'running' && isLeaseExpired(item)));
  if (!job) {
    res.json({ job: null });
    return;
  }
  const updatedAt = nowIso();
  const leasedUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
  await store.update(COL, job.id, {
    status: 'running',
    workerId,
    attempts: Number(job.attempts || 0) + 1,
    updatedAt,
    leasedUntil,
    error: '',
  });
  await notifyScheduler(job.requestedBy);
  res.json({
    job: publicJob({
      ...job,
      status: 'running',
      workerId,
      attempts: Number(job.attempts || 0) + 1,
      updatedAt,
      leasedUntil,
      error: '',
    }),
  });
});

function workerOwnsJob(job: CrawlJob, req: any): boolean {
  return job.status === 'running' && !isLeaseExpired(job)
    && job.workerId === String(req.headers['x-crawl-worker-id'] || '')
    && job.attempts === Number(req.body?.attempts);
}

crawlWorkerRouter.post('/jobs/:id/heartbeat', async (req, res) => {
  if (!requireWorker(req as any, res)) return;
  const job = await store.getById<CrawlJob>(COL, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job_not_found' });
    return;
  }
  if (!workerOwnsJob(job, req)) { res.status(409).json({ error: 'stale_worker_lease' }); return; }
  const leasedUntil = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
  await store.update(COL, job.id, { leasedUntil, updatedAt: nowIso() });
  res.json({ ok: true, leasedUntil });
});

crawlWorkerRouter.post('/jobs/:id/complete', async (req, res) => {
  if (!requireWorker(req as any, res)) return;
  const job = await store.getById<CrawlJob>(COL, req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job_not_found' });
    return;
  }
  if (!workerOwnsJob(job, req)) { res.status(409).json({ error: 'stale_worker_lease' }); return; }
  const ok = req.body?.ok !== false && !req.body?.error;
  const finishedAt = nowIso();
  await store.update(COL, job.id, {
    status: ok ? 'done' : 'failed',
    resultJson: JSON.stringify(req.body?.result || null),
    error: ok ? '' : String(req.body?.error || 'worker_failed').slice(0, 1000),
    updatedAt: finishedAt,
    finishedAt,
    leasedUntil: '',
  });
  await notifyScheduler(job.requestedBy);
  res.json({ ok: true, status: ok ? 'done' : 'failed' });
});
