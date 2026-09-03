import type { Platform } from '../server/types/index.js';

export type LeasedCrawlJob = {
  id: string;
  tenantId: string;
  platform: Platform;
  mode: 'keyword' | 'account';
  keyword?: string;
  accountUrl?: string;
  accountName?: string;
  limit?: number;
  workerId: string;
  leaseToken: string;
  revision: number;
  leasedUntil: string;
};

export type CrawlCompletion =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: string };

export class CrawlWorkerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'CrawlWorkerHttpError';
  }
}

export function isLeaseLostError(error: unknown): boolean {
  return error instanceof CrawlWorkerHttpError
    && (error.status === 404 || error.status === 409);
}

type ClientOptions = {
  serverUrl: string;
  workerToken: string;
  workerId: string;
  fetchImpl?: typeof fetch;
};

function validWorkerId(value: string): boolean {
  return /^[A-Za-z0-9._:@-]{1,80}$/.test(value);
}

function validLeaseToken(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

export class CrawlWorkerClient {
  private readonly serverUrl: string;
  private readonly workerToken: string;
  readonly workerId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.workerToken = options.workerToken.trim();
    this.workerId = options.workerId.trim();
    this.fetchImpl = options.fetchImpl || fetch;
    if (!this.serverUrl) throw new Error('CRAWL_WORKER_SERVER_URL is required');
    if (!this.workerToken) throw new Error('CRAWL_WORKER_TOKEN is required');
    if (!validWorkerId(this.workerId)) throw new Error('CRAWL_WORKER_ID is invalid');
  }

  private async request<T>(pathName: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.serverUrl}${pathName}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-crawl-worker-token': this.workerToken,
        'x-crawl-worker-id': this.workerId,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      throw new CrawlWorkerHttpError(response.status, 'invalid_json_response');
    }
    if (!response.ok) {
      const code = String(payload.error || payload.message || response.statusText || 'worker_request_failed');
      throw new CrawlWorkerHttpError(response.status, code);
    }
    return payload as T;
  }

  async nextJob(): Promise<LeasedCrawlJob | null> {
    const data = await this.request<{ job: LeasedCrawlJob | null }>(
      `/api/overseas/crawl-worker/next?workerId=${encodeURIComponent(this.workerId)}`,
    );
    if (!data.job) return null;
    const job = data.job;
    const leaseDeadline = Date.parse(job.leasedUntil || '');
    if (job.workerId !== this.workerId
      || !validLeaseToken(String(job.leaseToken || ''))
      || !Number.isSafeInteger(job.revision)
      || job.revision < 1
      || !Number.isFinite(leaseDeadline)
      || leaseDeadline <= Date.now()) {
      throw new CrawlWorkerHttpError(502, 'invalid_lease_response');
    }
    return job;
  }

  async heartbeat(job: LeasedCrawlJob, revision: number): Promise<{ revision: number; leasedUntil: string }> {
    const data = await this.request<{ ok: boolean; revision: number; leasedUntil: string }>(
      `/api/overseas/crawl-worker/jobs/${encodeURIComponent(job.id)}/heartbeat`,
      {
        method: 'POST',
        body: JSON.stringify({
          workerId: this.workerId,
          leaseToken: job.leaseToken,
          revision,
        }),
      },
    );
    if (data.ok !== true
      || !Number.isSafeInteger(data.revision)
      || data.revision !== revision + 1
      || !Number.isFinite(Date.parse(data.leasedUntil || ''))) {
      throw new CrawlWorkerHttpError(502, 'invalid_heartbeat_response');
    }
    return { revision: data.revision, leasedUntil: data.leasedUntil };
  }

  async complete(job: LeasedCrawlJob, revision: number, completion: CrawlCompletion): Promise<void> {
    await this.request<{ ok: true }>(
      `/api/overseas/crawl-worker/jobs/${encodeURIComponent(job.id)}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...completion,
          workerId: this.workerId,
          leaseToken: job.leaseToken,
          revision,
        }),
      },
    );
  }
}
