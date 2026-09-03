import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { crawlVideosForTenant } from '../server/routes/videos.js';
import {
  CrawlWorkerClient,
  isLeaseLostError,
  type CrawlCompletion,
  type LeasedCrawlJob,
} from './crawl-worker-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

function durationEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

const SERVER_URL = (process.env.CRAWL_WORKER_SERVER_URL || process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const WORKER_TOKEN = process.env.CRAWL_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-crawl-worker-token');
const WORKER_ID = process.env.CRAWL_WORKER_ID || `mac-${process.env.USER || 'worker'}`;
const POLL_MS = durationEnv('CRAWL_WORKER_POLL_MS', 15_000, 5_000, 300_000);
const HEARTBEAT_MS = durationEnv('CRAWL_WORKER_HEARTBEAT_MS', 60_000, 5_000, 120_000);
const RUN_ONCE = process.env.CRAWL_WORKER_ONCE === '1';
let stopped = false;
const client = new CrawlWorkerClient({ serverUrl: SERVER_URL, workerToken: WORKER_TOKEN, workerId: WORKER_ID });

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runJob(job: LeasedCrawlJob): Promise<void> {
  const started = Date.now();
  let revision = job.revision;
  let leaseLost = false;
  let heartbeatStopped = false;
  let heartbeatInFlight = Promise.resolve();
  const heartbeat = () => {
    heartbeatInFlight = heartbeatInFlight.then(async () => {
      if (heartbeatStopped || leaseLost) return;
      try {
        const renewed = await client.heartbeat(job, revision);
        revision = renewed.revision;
        job.leasedUntil = renewed.leasedUntil;
      } catch (error) {
        if (isLeaseLostError(error)) {
          leaseLost = true;
          console.warn(`[crawl-worker] lease lost ${job.id}; stale result will not be submitted`);
          return;
        }
        console.warn(`[crawl-worker] heartbeat failed ${job.id}:`, error instanceof Error ? error.message : error);
      }
    });
  };
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
  console.log(`[crawl-worker] running ${job.id} ${job.platform} ${job.mode}`);
  let completion: CrawlCompletion;
  try {
    const result = await crawlVideosForTenant({
      tenantId: job.tenantId,
      platform: job.platform,
      mode: job.mode,
      keyword: job.keyword || '',
      accountUrl: job.accountUrl || '',
      accountName: job.accountName || '',
      limit: job.limit || 10,
      // A local worker processes exactly the requested amount. Failed analysis
      // must not recursively fan out into replacement downloads.
      disableBackfill: true,
    });
    completion = {
      ok: true,
      result: {
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    completion = { ok: false, error: message };
  } finally {
    heartbeatStopped = true;
    clearInterval(heartbeatTimer);
    await heartbeatInFlight;
  }

  if (leaseLost) return;
  try {
    await client.complete(job, revision, completion);
    if (completion.ok) console.log(`[crawl-worker] done ${job.id}: ${completion.result.message || 'completed'}`);
    else console.warn(`[crawl-worker] failed ${job.id}: ${completion.error}`);
  } catch (error) {
    if (isLeaseLostError(error)) {
      console.warn(`[crawl-worker] completion rejected after lease loss ${job.id}`);
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  console.log(`[crawl-worker] ${WORKER_ID} polling ${SERVER_URL} every ${POLL_MS}ms`);
  console.log('[crawl-worker] platforms: YouTube/TikTok local cookies; FB/IG should stay on Apify server path');
  const drain = (signal: string) => {
    if (!stopped) console.log(`[crawl-worker] ${signal} received; draining the active lease before shutdown`);
    stopped = true;
  };
  process.on('SIGINT', () => drain('SIGINT'));
  process.on('SIGTERM', () => drain('SIGTERM'));
  while (!stopped) {
    try {
      const job = await client.nextJob();
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
}

void main();
