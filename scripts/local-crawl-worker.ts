import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { crawlVideosForTenant } from '../server/routes/videos.js';
import type { Platform } from '../server/types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
// Use the same configuration precedence as the API process. Otherwise a
// separately started worker misses shared provider/database credentials.
dotenv.config({ path: path.join(os.homedir(), '.config', 'lingshu-ai', '.env') });
dotenv.config({ path: path.join(os.homedir(), '.config', 'lingshu-ai', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

type CrawlJob = {
  id: string;
  attempts: number;
  tenantId: string;
  platform: Platform;
  mode: 'keyword' | 'account';
  keyword?: string;
  accountUrl?: string;
  accountName?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
};

const SERVER_URL = (process.env.CRAWL_WORKER_SERVER_URL || (process.env.NODE_ENV === 'production' ? process.env.PUBLIC_ORIGIN : '') || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.CRAWL_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-crawl-worker-token');
const WORKER_ID = process.env.CRAWL_WORKER_ID || `mac-${process.env.USER || 'worker'}`;
const POLL_MS = Math.max(5_000, Number(process.env.CRAWL_WORKER_POLL_MS || 15_000));
const HEARTBEAT_MS = Math.max(15_000, Number(process.env.CRAWL_WORKER_HEARTBEAT_MS || 60_000));
const RUN_ONCE = process.env.CRAWL_WORKER_ONCE === '1';
let stopped = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function workerHeaders(): Record<string, string> {
  if (!WORKER_TOKEN) throw new Error('CRAWL_WORKER_TOKEN is required');
  return {
    'Content-Type': 'application/json',
    'x-crawl-worker-token': WORKER_TOKEN,
    'x-crawl-worker-id': WORKER_ID,
  };
}

async function api<T>(pathName: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SERVER_URL}${pathName}`, {
    ...init,
    headers: {
      ...workerHeaders(),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(String(json.error || json.message || res.statusText));
  }
  return json as T;
}

async function nextJob(): Promise<CrawlJob | null> {
  const data = await api<{ job: CrawlJob | null }>(`/api/overseas/crawl-worker/next?workerId=${encodeURIComponent(WORKER_ID)}`);
  return data.job;
}

async function completeJob(job: CrawlJob, payload: Record<string, unknown>): Promise<void> {
  await api(`/api/overseas/crawl-worker/jobs/${encodeURIComponent(job.id)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, attempts: job.attempts }),
  });
}

async function heartbeatJob(job: CrawlJob): Promise<void> {
  await api(`/api/overseas/crawl-worker/jobs/${encodeURIComponent(job.id)}/heartbeat`, { method: 'POST', body: JSON.stringify({ attempts: job.attempts }) });
}

export function localCrawlWorkerFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cookies|login|sign in|not a bot/i.test(message)) return '本地 Worker 登录态不可用，请在 Safari/Chrome 登录目标平台后重试。';
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return '本地 Worker 执行超时，请检查网络或降低单次采集数量后重试。';
  if (/GEMINI_API_KEY\s+is\s+not\s+set/i.test(message)) return 'Gemini 未配置，请配置后重试或切换到已配置的 Qwen。';
  if (/video_analysis_hard_timeout|exact_chunk_timeout|qwen[^\n]*(?:timeout|timed out|超时)/i.test(message)) return 'Qwen 分析超时，请重试或改用策略分析。';
  return message.slice(0, 500) || 'worker_failed';
}

async function runJob(job: CrawlJob): Promise<void> {
  const started = Date.now();
  const heartbeat = setInterval(() => {
    void heartbeatJob(job).catch(error => {
      console.warn(`[crawl-worker] heartbeat failed ${job.id}:`, error instanceof Error ? error.message : error);
    });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  console.log(`[crawl-worker] running ${job.id} ${job.platform} ${job.mode}`);
  try {
    const result = await crawlVideosForTenant({
      tenantId: job.tenantId,
      platform: job.platform,
      mode: job.mode,
      keyword: job.keyword || '',
      accountUrl: job.accountUrl || '',
      accountName: job.accountName || '',
      limit: job.limit || 10,
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      // A local worker processes exactly the requested amount. Failed analysis
      // must not recursively fan out into replacement downloads.
      disableBackfill: true,
    });
    await completeJob(job, {
      ok: true,
      result: {
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
        source: result.source,
        message: result.message,
        elapsedMs: Date.now() - started,
      },
    });
    console.log(`[crawl-worker] done ${job.id}: ${result.message}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeJob(job, { ok: false, error: localCrawlWorkerFailureMessage(error) });
    console.warn(`[crawl-worker] failed ${job.id}: ${message}`);
  } finally {
    clearInterval(heartbeat);
  }
}

async function main(): Promise<void> {
  console.log(`[crawl-worker] ${WORKER_ID} polling ${SERVER_URL} every ${POLL_MS}ms`);
  console.log('[crawl-worker] platforms: YouTube/TikTok local cookies; FB/IG should stay on Apify server path');
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });
  while (!stopped) {
    try {
      const job = await nextJob();
      if (job) {
        await runJob(job);
        if (RUN_ONCE) stopped = true;
      } else {
        if (RUN_ONCE) stopped = true;
        await sleep(POLL_MS);
      }
    } catch (error) {
      console.warn('[crawl-worker] poll failed:', error instanceof Error ? error.message : error);
      await sleep(POLL_MS);
    }
  }
  console.log('[crawl-worker] stopped');
  if (RUN_ONCE) process.exit(0);
}

void main();
