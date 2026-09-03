import { createHmac, timingSafeEqual } from 'node:crypto';
import { registerHealthCheck, registerWorkerHeartbeat, recordWorkerHeartbeat, markWorkerStopped } from '../ops/health.js';
import { incrementMetric, setGauge, structuredLog } from '../ops/observability.js';
import { store } from '../storage/index.js';
import { compareAndSetRecord, createRecordIfAbsent, workerIdentity } from './reliableKernel.js';
import { validateOutboxWebhookTarget } from './outboxWebhookSecurity.js';
import { nextFairPage } from '../storage/pagination.js';

type OutboxRecord = {
  id: string;
  tenant_id: string;
  run_id: string;
  event_id: string;
  sequence: number;
  topic: string;
  payload: unknown;
  status: string;
  attempt: number;
  available_at: string;
  created_at: string;
  delivered_at: string;
  lease_owner: string;
  lease_expires_at: string;
  error_detail: string;
};

type RunEventRecord = {
  id: string;
  tenant_id: string;
  run_id: string;
  task_id?: string;
  sequence: number;
  type: string;
  level: string;
  summary: string;
  payload: unknown;
  occurred_at: string;
};

export type OutboxDispatchResult = 'delivered' | 'retried' | 'dead_letter' | 'not_claimed';

const WORKER_NAME = 'digital-employee-outbox';
const DEFAULT_MAX_ATTEMPTS = 8;
let lastReconcileAt = 0;
const outboxStatusPages = new Map<string, number>();

function positiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error || 'outbox_delivery_failed').slice(0, 2_000);
}

export function outboxRetryDelayMs(attempt: number, baseMs = 1_000, maxMs = 15 * 60_000): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(attempt) - 1));
  return Math.min(maxMs, Math.max(100, baseMs) * (2 ** exponent));
}

export function signOutboxPayload(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function signatureMatches(body: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(signOutboxPayload(body, secret));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Repair the only non-atomic boundary in event creation. run_events remains
 * the source of truth, so a process crash after writing an event but before
 * writing its outbox row cannot permanently lose webhook delivery.
 */
export async function reconcileRunEventOutbox(nowMs = Date.now()): Promise<number> {
  const intervalMs = positiveInteger(process.env.DIGITAL_EMPLOYEE_OUTBOX_RECONCILE_MS, 300_000, 10_000, 86_400_000);
  if (lastReconcileAt && nowMs - lastReconcileAt < intervalMs) return 0;
  const perPage = 500;
  const maxRecords = positiveInteger(process.env.DIGITAL_EMPLOYEE_OUTBOX_RECONCILE_MAX_RECORDS, 250_000, 1_000, 1_000_000);
  const knownEventIds = new Set<string>();
  for (let page = 1, scanned = 0; scanned < maxRecords; page += 1) {
    const result = await store.list<OutboxRecord>('digital_employee_outbox', { page, perPage, sort: '-created_at' });
    for (const item of result.items) knownEventIds.add(item.event_id);
    scanned += result.items.length;
    if (page >= result.totalPages || result.items.length === 0) break;
  }
  let repaired = 0;
  for (let page = 1, scanned = 0; scanned < maxRecords; page += 1) {
    const result = await store.list<RunEventRecord>('run_events', { page, perPage, sort: '-occurred_at' });
    for (const event of result.items) {
      if (knownEventIds.has(event.id)) continue;
      const created = await createRecordIfAbsent<OutboxRecord>({
        store,
        collection: 'digital_employee_outbox',
        uniqueWhere: { tenant_id: event.tenant_id, event_id: event.id },
        data: {
          tenant_id: event.tenant_id,
          run_id: event.run_id,
          event_id: event.id,
          sequence: event.sequence,
          topic: 'digital_employee.run_event',
          payload: event,
          status: 'pending',
          attempt: 0,
          available_at: new Date(nowMs).toISOString(),
          created_at: new Date(nowMs).toISOString(),
          delivered_at: '',
          lease_owner: '',
          lease_expires_at: '',
          error_detail: '',
        },
      });
      knownEventIds.add(event.id);
      if (created.created) repaired += 1;
    }
    scanned += result.items.length;
    if (page >= result.totalPages || result.items.length === 0) break;
  }
  if (repaired) {
    incrementMetric('digital_employee_outbox_repaired_total', {}, repaired);
    structuredLog('warn', 'digital_employee.outbox.repaired', { repaired });
  }
  lastReconcileAt = nowMs;
  return repaired;
}

export function outboxWebhookConfig(env: NodeJS.ProcessEnv = process.env): {
  mode: 'internal' | 'webhook';
  url?: string;
  secret?: string;
  timeoutMs: number;
} {
  const rawUrl = String(env.DIGITAL_EMPLOYEE_EVENT_WEBHOOK_URL || '').trim();
  const timeoutMs = positiveInteger(env.DIGITAL_EMPLOYEE_EVENT_WEBHOOK_TIMEOUT_MS, 5_000, 500, 30_000);
  if (!rawUrl) return { mode: 'internal', timeoutMs };
  const url = validateOutboxWebhookTarget({
    rawUrl,
    production: env.NODE_ENV === 'production',
    allowedOrigins: env.DIGITAL_EMPLOYEE_EVENT_WEBHOOK_ALLOWED_ORIGINS,
  });
  const secret = String(env.DIGITAL_EMPLOYEE_EVENT_WEBHOOK_SECRET || '').trim();
  if (!secret) throw new Error('digital_employee_webhook_secret_required');
  return { mode: 'webhook', url: url.toString(), secret, timeoutMs };
}

async function deliver(record: OutboxRecord): Promise<'internal' | 'webhook'> {
  const config = outboxWebhookConfig();
  if (config.mode === 'internal') return 'internal';
  const body = JSON.stringify({
    id: record.event_id,
    topic: record.topic,
    tenantId: record.tenant_id,
    runId: record.run_id,
    sequence: record.sequence,
    occurredAt: record.created_at,
    payload: json(record.payload),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('digital_employee_webhook_timeout')), config.timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(config.url!, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Lingshu-Event-Id': record.event_id,
        'Idempotency-Key': record.event_id,
        'X-Lingshu-Signature': signOutboxPayload(body, config.secret!),
      },
      body,
    });
    if (!response.ok) throw new Error(`digital_employee_webhook_http_${response.status}`);
    return 'webhook';
  } finally {
    clearTimeout(timeout);
  }
}

function dateExpired(value: unknown, nowMs: number): boolean {
  const timestamp = Date.parse(String(value || ''));
  return !Number.isFinite(timestamp) || timestamp <= nowMs;
}

async function claim(record: OutboxRecord, owner: string, nowMs: number): Promise<OutboxRecord | null> {
  const isPending = record.status === 'pending' && dateExpired(record.available_at, nowMs);
  const isStaleProcessing = record.status === 'processing' && dateExpired(record.lease_expires_at, nowMs);
  if (!isPending && !isStaleProcessing) return null;
  const expected: Record<string, string | number | boolean> = { status: record.status };
  if (record.status === 'processing') {
    expected.lease_owner = record.lease_owner || '';
    expected.lease_expires_at = record.lease_expires_at || '';
  }
  const claimed = await compareAndSetRecord<OutboxRecord>({
    store,
    collection: 'digital_employee_outbox',
    id: record.id,
    expected,
    patch: {
      status: 'processing',
      lease_owner: owner,
      lease_expires_at: new Date(nowMs + 30_000).toISOString(),
      error_detail: '',
    },
  });
  return claimed.ok ? claimed.record : null;
}

export async function dispatchOutboxRecord(record: OutboxRecord, owner: string, nowMs = Date.now()): Promise<OutboxDispatchResult> {
  const claimed = await claim(record, owner, nowMs);
  if (!claimed) return 'not_claimed';
  try {
    const target = await deliver(claimed);
    const completed = await compareAndSetRecord<OutboxRecord>({
      store,
      collection: 'digital_employee_outbox',
      id: claimed.id,
      expected: { status: 'processing', lease_owner: owner },
      patch: {
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        lease_owner: '',
        lease_expires_at: '',
        error_detail: '',
      },
    });
    if (!completed.ok) return 'not_claimed';
    incrementMetric('digital_employee_outbox_delivered_total', { target, topic: claimed.topic });
    return 'delivered';
  } catch (error) {
    const attempt = Math.max(0, Number(claimed.attempt || 0)) + 1;
    const maxAttempts = positiveInteger(process.env.DIGITAL_EMPLOYEE_OUTBOX_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS, 1, 50);
    const dead = attempt >= maxAttempts;
    const failed = await compareAndSetRecord<OutboxRecord>({
      store,
      collection: 'digital_employee_outbox',
      id: claimed.id,
      expected: { status: 'processing', lease_owner: owner },
      patch: {
        status: dead ? 'dead_letter' : 'pending',
        attempt,
        available_at: dead ? '' : new Date(Date.now() + outboxRetryDelayMs(attempt)).toISOString(),
        lease_owner: '',
        lease_expires_at: '',
        error_detail: errorMessage(error),
      },
    });
    if (!failed.ok) return 'not_claimed';
    incrementMetric('digital_employee_outbox_delivery_failures_total', { terminal: dead, topic: claimed.topic });
    structuredLog(dead ? 'error' : 'warn', 'digital_employee.outbox.delivery_failed', {
      eventId: claimed.event_id,
      runId: claimed.run_id,
      attempt,
      deadLetter: dead,
      error: errorMessage(error),
    });
    return dead ? 'dead_letter' : 'retried';
  }
}

export async function runDigitalEmployeeOutboxOnce(owner = workerIdentity('outbox-worker')): Promise<{ scanned: number; delivered: number; retried: number; deadLetter: number }> {
  const nowMs = Date.now();
  await reconcileRunEventOutbox(nowMs);
  const pendingPage = outboxStatusPages.get('pending') || 1;
  const processingPage = outboxStatusPages.get('processing') || 1;
  const [pending, processing] = await Promise.all([
    store.list<OutboxRecord>('digital_employee_outbox', { where: { status: 'pending' }, sort: 'id', page: pendingPage, perPage: 50 }),
    store.list<OutboxRecord>('digital_employee_outbox', { where: { status: 'processing' }, sort: 'id', page: processingPage, perPage: 50 }),
  ]);
  outboxStatusPages.set('pending', nextFairPage(pendingPage, pending.totalPages));
  outboxStatusPages.set('processing', nextFairPage(processingPage, processing.totalPages));
  const records = [...pending.items, ...processing.items].slice(0, 100);
  let delivered = 0;
  let retried = 0;
  let deadLetter = 0;
  for (const record of records) {
    const outcome = await dispatchOutboxRecord(record, owner, nowMs);
    if (outcome === 'delivered') delivered += 1;
    if (outcome === 'retried') retried += 1;
    if (outcome === 'dead_letter') deadLetter += 1;
  }
  setGauge('digital_employee_outbox_pending', pending.totalItems);
  setGauge('digital_employee_outbox_processing', processing.totalItems);
  recordWorkerHeartbeat(WORKER_NAME, { scanned: records.length, delivered, retried, deadLetter });
  return { scanned: records.length, delivered, retried, deadLetter };
}

async function outboxHealth() {
  const [pending, dead] = await Promise.all([
    store.list<OutboxRecord>('digital_employee_outbox', { where: { status: 'pending' }, sort: 'created_at', perPage: 1 }),
    store.list<OutboxRecord>('digital_employee_outbox', { where: { status: 'dead_letter' }, perPage: 1 }),
  ]);
  const oldest = pending.items[0] ? Date.parse(pending.items[0].created_at) : NaN;
  const oldestAgeSeconds = Number.isFinite(oldest) ? Math.max(0, Math.round((Date.now() - oldest) / 1_000)) : 0;
  const maxBacklog = positiveInteger(process.env.DIGITAL_EMPLOYEE_OUTBOX_MAX_BACKLOG, 1_000, 1, 1_000_000);
  const maxAgeSeconds = positiveInteger(process.env.DIGITAL_EMPLOYEE_OUTBOX_MAX_AGE_SECONDS, 300, 10, 86_400);
  setGauge('digital_employee_outbox_pending', pending.totalItems);
  setGauge('digital_employee_outbox_dead_letter', dead.totalItems);
  setGauge('digital_employee_outbox_oldest_age_seconds', oldestAgeSeconds);
  const ok = dead.totalItems === 0 && pending.totalItems <= maxBacklog && oldestAgeSeconds <= maxAgeSeconds;
  return {
    ok,
    ...(ok ? {} : { message: dead.totalItems ? 'digital_employee_outbox_dead_letter' : 'digital_employee_outbox_backlog' }),
    details: { pending: pending.totalItems, deadLetter: dead.totalItems, oldestAgeSeconds, maxBacklog, maxAgeSeconds },
  };
}

export type OutboxWorkerHandle = { stop: () => Promise<void> };
let activeHandle: OutboxWorkerHandle | null = null;

export function initDigitalEmployeeOutboxWorker(): OutboxWorkerHandle {
  if (activeHandle) return activeHandle;
  const intervalMs = positiveInteger(process.env.DIGITAL_EMPLOYEE_OUTBOX_POLL_MS, 2_000, 250, 60_000);
  const unregisterHeartbeat = registerWorkerHeartbeat(WORKER_NAME, { staleAfterMs: Math.max(10_000, intervalMs * 5), critical: true });
  const unregisterHealth = registerHealthCheck('digital-employee-outbox-backlog', outboxHealth, { critical: false, timeoutMs: 5_000 });
  const owner = workerIdentity('outbox-worker');
  let stopping = false;
  let cycleBusy = false;
  let running: Promise<unknown> = Promise.resolve();
  const cycle = () => {
    if (stopping || cycleBusy) return;
    cycleBusy = true;
    running = runDigitalEmployeeOutboxOnce(owner)
      .catch(error => {
        incrementMetric('digital_employee_outbox_cycle_failures_total');
        structuredLog('error', 'digital_employee.outbox.cycle_failed', { error: errorMessage(error) });
        recordWorkerHeartbeat(WORKER_NAME, { error: errorMessage(error) });
      })
      .finally(() => { cycleBusy = false; });
  };
  recordWorkerHeartbeat(WORKER_NAME, { state: 'starting' });
  cycle();
  const timer = setInterval(cycle, intervalMs);
  timer.unref?.();
  activeHandle = {
    stop: async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(timer);
      await running;
      markWorkerStopped(WORKER_NAME, { state: 'stopped' });
      unregisterHealth();
      unregisterHeartbeat();
      activeHandle = null;
    },
  };
  return activeHandle;
}
