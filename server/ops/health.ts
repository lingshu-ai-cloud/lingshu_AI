import { pbFetch } from '../storage/pb.js';
import { validateCanonicalPocketBaseSchema } from '../storage/canonicalSchema.js';
import { dataVolumeHealthCheck } from './dataVolumeHealth.js';
import { oauthConfigurationHealthCheck } from '../lib/oauthConfig.js';

export type HealthCheckResult = {
  ok: boolean;
  message?: string;
  details?: Record<string, unknown>;
};

type HealthCheckRegistration = {
  name: string;
  critical: boolean;
  timeoutMs: number;
  check: () => HealthCheckResult | Promise<HealthCheckResult>;
};

export type HealthSnapshot = {
  status: 'ready' | 'not_ready' | 'degraded';
  checkedAt: string;
  checks: Array<HealthCheckResult & { name: string; critical: boolean; durationMs: number }>;
};

const checks = new Map<string, HealthCheckRegistration>();
const workerHeartbeats = new Map<string, { lastBeatAt: number; details?: Record<string, unknown>; stopped?: boolean }>();
let draining = false;

export function setProcessDraining(value = true): void {
  draining = value;
}

export function registerHealthCheck(
  name: string,
  check: HealthCheckRegistration['check'],
  options: { critical?: boolean; timeoutMs?: number } = {},
): () => void {
  const registration: HealthCheckRegistration = {
    name,
    check,
    critical: options.critical !== false,
    timeoutMs: Math.max(100, Math.min(30_000, options.timeoutMs ?? 3_000)),
  };
  checks.set(name, registration);
  return () => {
    if (checks.get(name) === registration) checks.delete(name);
  };
}

export function registerWorkerHeartbeat(
  name: string,
  options: { staleAfterMs?: number; critical?: boolean; timeoutMs?: number } = {},
): () => void {
  const staleAfterMs = Math.max(1_000, options.staleAfterMs ?? 60_000);
  workerHeartbeats.set(name, { lastBeatAt: 0 });
  const unregister = registerHealthCheck(`worker:${name}`, () => {
    const state = workerHeartbeats.get(name);
    if (!state || state.stopped) return { ok: false, message: state?.stopped ? 'worker_stopped' : 'worker_not_registered' };
    if (!state.lastBeatAt) return { ok: false, message: 'worker_has_not_heartbeat' };
    const ageMs = Date.now() - state.lastBeatAt;
    const reportedState = String(state.details?.state || state.details?.status || '').toLowerCase();
    if (reportedState === 'starting') {
      return { ok: false, message: 'worker_starting', details: { ageMs, ...state.details } };
    }
    if (state.details?.error || reportedState === 'error' || reportedState === 'failed') {
      return { ok: false, message: 'worker_reported_error', details: { ageMs, ...state.details } };
    }
    return ageMs <= staleAfterMs
      ? { ok: true, details: { ageMs, ...state.details } }
      : { ok: false, message: 'worker_heartbeat_stale', details: { ageMs, staleAfterMs, ...state.details } };
  }, { critical: options.critical, timeoutMs: options.timeoutMs });
  return () => {
    unregister();
    workerHeartbeats.delete(name);
  };
}

export function recordWorkerHeartbeat(name: string, details?: Record<string, unknown>): void {
  const current = workerHeartbeats.get(name);
  workerHeartbeats.set(name, { lastBeatAt: Date.now(), details, stopped: current?.stopped && false });
}

export function markWorkerStopped(name: string, details?: Record<string, unknown>): void {
  const current = workerHeartbeats.get(name);
  workerHeartbeats.set(name, { lastBeatAt: current?.lastBeatAt ?? 0, details, stopped: true });
}

async function withTimeout<T>(name: string, work: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${name}_healthcheck_timeout`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runReadinessChecks(): Promise<HealthSnapshot> {
  const results = await Promise.all([...checks.values()].map(async registration => {
    const startedAt = performance.now();
    try {
      const result = await withTimeout(registration.name, registration.check, registration.timeoutMs);
      return { ...result, name: registration.name, critical: registration.critical, durationMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      return {
        ok: false,
        name: registration.name,
        critical: registration.critical,
        durationMs: Math.round(performance.now() - startedAt),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  if (draining) results.unshift({ ok: false, name: 'process-draining', critical: true, durationMs: 0, message: 'process_is_draining' });
  const criticalFailure = results.some(result => result.critical && !result.ok);
  const optionalFailure = results.some(result => !result.critical && !result.ok);
  return {
    status: criticalFailure ? 'not_ready' : optionalFailure ? 'degraded' : 'ready',
    checkedAt: new Date().toISOString(),
    checks: results,
  };
}

export async function pocketBaseHealthCheck(): Promise<HealthCheckResult> {
  const response = await pbFetch('/api/health');
  if (!response.ok) return { ok: false, message: `pocketbase_health_${response.status}` };
  return { ok: true };
}

let schemaCache: { expiresAt: number; result: HealthCheckResult } | null = null;
let schemaCheckInFlight: Promise<HealthCheckResult> | null = null;

export async function canonicalSchemaHealthCheck(): Promise<HealthCheckResult> {
  if (schemaCache && schemaCache.expiresAt > Date.now()) return schemaCache.result;
  if (schemaCheckInFlight) return schemaCheckInFlight;
  schemaCheckInFlight = (async () => {
    const schema = await validateCanonicalPocketBaseSchema();
    const result: HealthCheckResult = schema.ok
      ? { ok: true, details: { version: schema.version } }
      : { ok: false, message: 'pocketbase_schema_drift', details: { version: schema.version, issues: schema.issues.slice(0, 20), issueCount: schema.issues.length } };
    schemaCache = { expiresAt: Date.now() + 10_000, result };
    return result;
  })().finally(() => { schemaCheckInFlight = null; });
  return schemaCheckInFlight;
}

export function registerCoreReadinessChecks(): void {
  registerHealthCheck('pocketbase', pocketBaseHealthCheck, { critical: true, timeoutMs: 3_000 });
  registerHealthCheck('pocketbase-schema', canonicalSchemaHealthCheck, { critical: true, timeoutMs: 8_000 });
  registerHealthCheck('app-data-volume', dataVolumeHealthCheck, { critical: true, timeoutMs: 5_000 });
  registerHealthCheck('oauth-configuration', oauthConfigurationHealthCheck, { critical: true, timeoutMs: 1_000 });
}
