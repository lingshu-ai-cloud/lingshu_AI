import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { reviewTodoService } from './reviewTodos.js';
import { store } from '../storage/index.js';
import { normalizeDigitalEmployeeConfig, type DigitalEmployeeConfig } from './domain.js';
import { beijingDate, latestDueReviewSlot, reviewScheduleFromCadence } from './runtimeSchedule.js';
import { allocateReviewTodos, continueManagedOperatingCycle, generateScheduledRunReview, reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';

type StoredRecord = { id: string; [key: string]: unknown };
type RuntimeRun = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  started_at: string;
  product_profile?: unknown;
};
type RuntimeGoal = StoredRecord & { tenant_id: string; starts_at: string; ends_at: string };
type RuntimePlan = StoredRecord & { tenant_id: string; plan: unknown };
type RuntimeConfig = StoredRecord & { tenant_id: string; config: unknown };

const RECONCILABLE_STATUSES = new Set(['planning', 'running', 'waiting_external', 'waiting_approval']);
const REVIEWABLE_STATUSES = new Set([...RECONCILABLE_STATUSES, 'waiting_human', 'succeeded', 'failed']);
const DEDICATED_WORKFLOW_PROFILES = new Set(['starter_198', 'starter_social_content']);

export interface RuntimeCycleResult {
  scanned: number;
  reconciled: number;
  reviewsGenerated: number;
  cyclesContinued?: number;
  errors: Array<{ runId: string; tenantId: string; message: string }>;
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

async function listRuns(limit: number, now: Date): Promise<RuntimeRun[]> {
  const byId = new Map<string, RuntimeRun>();
  // Active work is queried explicitly so a large history of completed runs can
  // never hide a still-running workflow outside the global newest page.
  for (const status of RECONCILABLE_STATUSES) {
    let page = 1;
    while (byId.size < limit && page <= 20) {
      const result = await store.list<RuntimeRun>('workflow_runs', {
        where: { status }, page, perPage: Math.min(100, limit - byId.size), sort: '-started_at',
      });
      result.items.forEach(run => {
        if (!DEDICATED_WORKFLOW_PROFILES.has(String(run.product_profile || ''))) byId.set(run.id, run);
      });
      if (page >= result.totalPages || !result.items.length) break;
      page += 1;
    }
    if (byId.size >= limit) break;
  }
  // Historical completion volume must not consume the current-cycle budget.
  for (const status of ['succeeded', 'waiting_human', 'failed']) {
    let page = 1;
    while (byId.size < limit) {
      const result = await store.list<RuntimeRun>('workflow_runs', {
        where: { status }, page, perPage: 100, sort: '-started_at',
      });
      for (const run of result.items) {
        if (DEDICATED_WORKFLOW_PROFILES.has(String(run.product_profile || ''))) continue;
        const goal = await tenantRecord<RuntimeGoal>('weekly_goals', run.goal_id, run.tenant_id);
        if (!goal) continue;
        const config = await runConfig(run);
        const reopenCandidate = status === 'succeeded' && reviewSlotIsInGoal(now, goal) && normalizeContinuationPolicy(config?.continuationPolicy).newCustomers === 'reopen';
        const schedule = config ? reviewScheduleFromCadence(config.reviewSchedule) : null;
        const slot = schedule ? latestDueReviewSlot(schedule, now) : null;
        const reviewCandidate = slot && slot.getTime() >= Date.parse(run.started_at || '') && reviewSlotIsInGoal(slot, goal);
        if (!reopenCandidate && !reviewCandidate) continue;
        byId.set(run.id, run);
        if (byId.size >= limit) break;
      }
      if (!result.items.length || page >= result.totalPages) break;
      page += 1;
    }
  }
  return [...byId.values()].sort((left, right) => Date.parse(right.started_at || '') - Date.parse(left.started_at || ''));
}

async function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
  const record = await store.getById<T>(collection, id);
  return record?.tenant_id === tenantId ? record : null;
}

async function runConfig(run: RuntimeRun): Promise<DigitalEmployeeConfig | null> {
  const plan = await tenantRecord<RuntimePlan>('weekly_plans', run.plan_id, run.tenant_id);
  const planBody = jsonValue<Record<string, unknown>>(plan?.plan, {});
  if (planBody.configSnapshot) return normalizeDigitalEmployeeConfig(jsonValue(planBody.configSnapshot, {}));
  const records = await store.list<RuntimeConfig>('digital_employee_configs', {
    where: { tenant_id: run.tenant_id }, sort: '-updated_at', page: 1, perPage: 1,
  });
  return records.items[0] ? normalizeDigitalEmployeeConfig(jsonValue(records.items[0].config, {})) : null;
}

export function reviewSlotIsInGoal(slot: Date, goal: Pick<RuntimeGoal, 'starts_at' | 'ends_at'>): boolean {
  const date = beijingDate(slot);
  return Boolean(goal.starts_at && goal.ends_at && date >= goal.starts_at && date <= goal.ends_at);
}

async function reviewIfDue(run: RuntimeRun, now: Date): Promise<boolean> {
  if (!REVIEWABLE_STATUSES.has(run.status)) return false;
  const [goal, config] = await Promise.all([
    tenantRecord<RuntimeGoal>('weekly_goals', run.goal_id, run.tenant_id),
    runConfig(run),
  ]);
  if (!goal || !config) return false;
  const schedule = reviewScheduleFromCadence(config.reviewSchedule);
  if (!schedule) return false;
  const slot = latestDueReviewSlot(schedule, now);
  const startedAt = Date.parse(run.started_at || '');
  if (!Number.isFinite(startedAt) || slot.getTime() < startedAt || !reviewSlotIsInGoal(slot, goal)) return false;
  return generateScheduledRunReview({ tenantId: run.tenant_id, runId: run.id, scheduleSlot: slot.toISOString() });
}

/** Opted-in tenants are scanned independently of manual review-todo boards. */
export async function runManagedOperatingContinuations(now = new Date()): Promise<{ continued: number; errors: RuntimeCycleResult['errors'] }> {
  const result = { continued: 0, errors: [] as RuntimeCycleResult['errors'] };
  for (let page = 1; page <= 20; page++) {
    const configs = await store.list<RuntimeConfig>('digital_employee_configs', { where: { status: 'active' }, page, perPage: 100 });
    for (const row of configs.items) {
      const config = normalizeDigitalEmployeeConfig(jsonValue(row.config, {}));
      if (!row.tenant_id || !config.managedPublishingGrant?.enabled) continue;
      try {
        const runs = await store.list<RuntimeRun>('workflow_runs', { where: { tenant_id: row.tenant_id }, sort: '-started_at', perPage: 100 });
        const latest = runs.items.find(run => !DEDICATED_WORKFLOW_PROFILES.has(String(run.product_profile || '')));
        if (!latest) continue;
        let sourceRunId = latest.id;
        if (latest.status === 'initializing') {
          const goal = await tenantRecord<RuntimeGoal>('weekly_goals', latest.goal_id, row.tenant_id);
          const scope = jsonValue<{ managedContinuation?: { sourceRunId?: string } }>(goal?.scope, {});
          if (!scope.managedContinuation?.sourceRunId) continue;
          sourceRunId = scope.managedContinuation.sourceRunId;
        } else if (latest.status !== 'succeeded') continue;
        if (await continueManagedOperatingCycle(row.tenant_id, sourceRunId, now)) result.continued += 1;
      } catch (error) {
        result.errors.push({ tenantId: row.tenant_id, runId: '', message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!configs.items.length || page >= configs.totalPages) break;
  }
  return result;
}

/** One bounded, tenant-safe pass. Each run fails independently. */
export async function runDigitalEmployeeRuntimeCycle(now = new Date()): Promise<RuntimeCycleResult> {
  const maxRuns = integerEnv('DIGITAL_EMPLOYEE_RUNTIME_MAX_RUNS', 200, 1, 1000);
  // starter_198 has a separate fail-closed executor and must never fall into
  // the legacy reconciler's permissive task fallback.
  const runs = (await listRuns(maxRuns, now)).filter(run => run.id
    && run.tenant_id
    && !DEDICATED_WORKFLOW_PROFILES.has(String(run.product_profile || ''))
    && REVIEWABLE_STATUSES.has(run.status));
  const result: RuntimeCycleResult = { scanned: runs.length, reconciled: 0, reviewsGenerated: 0, errors: [] };
  for (const run of runs) {
    try {
      const canReopen = run.status === 'succeeded' && normalizeContinuationPolicy((await runConfig(run))?.continuationPolicy).newCustomers === 'reopen' && await (async () => { const goal = await tenantRecord<RuntimeGoal>('weekly_goals', run.goal_id, run.tenant_id); return goal ? reviewSlotIsInGoal(now, goal) : false; })();
      if (RECONCILABLE_STATUSES.has(run.status) || canReopen) {
        await reconcileDigitalEmployeeRun(run.tenant_id, run.id);
        result.reconciled += 1;
      }
      if (await reviewIfDue(run, now)) result.reviewsGenerated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ runId: run.id, tenantId: run.tenant_id, message });
      console.error(`[digital-employee-runtime] run ${run.id} failed:`, message);
    }
  }
  const continuation = await runManagedOperatingContinuations(now);
  result.cyclesContinued = continuation.continued;
  result.errors.push(...continuation.errors);
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let cycleRunning = false;

async function guardedCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    try { await reviewTodoService.runDue(allocateReviewTodos); } catch (error) { console.error('[review-todos] scheduler unavailable:', (error as Error).message); }
    const result = await runDigitalEmployeeRuntimeCycle();
    if (result.reconciled || result.reviewsGenerated || result.cyclesContinued || result.errors.length) {
      console.log(`[digital-employee-runtime] scanned=${result.scanned} reconciled=${result.reconciled} reviews=${result.reviewsGenerated} cycles=${result.cyclesContinued || 0} errors=${result.errors.length}`);
    }
  } catch (error) {
    console.error('[digital-employee-runtime] cycle failed:', error instanceof Error ? error.message : error);
  } finally {
    cycleRunning = false;
  }
}

export function initDigitalEmployeeRuntime(): void {
  if (process.env.DIGITAL_EMPLOYEE_RUNTIME_ENABLED === 'false' || timer) return;
  const intervalMs = integerEnv('DIGITAL_EMPLOYEE_RUNTIME_INTERVAL_MS', 60_000, 10_000, 15 * 60_000);
  void guardedCycle();
  timer = setInterval(() => { void guardedCycle(); }, intervalMs);
  timer.unref?.();
  console.log(`[digital-employee-runtime] enabled interval=${intervalMs}ms`);
}

export function stopDigitalEmployeeRuntime(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
