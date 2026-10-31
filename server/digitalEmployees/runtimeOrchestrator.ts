import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { reviewTodoService } from './reviewTodos.js';
import { store } from '../storage/index.js';
import { normalizeDigitalEmployeeConfig, type DigitalEmployeeConfig } from './domain.js';
import { beijingDate, latestDueReviewSlot, reviewScheduleFromCadence } from './runtimeSchedule.js';
import { readTenantPublishingReadiness } from './publishingRuntimeReadiness.js';
import { allocateReviewTodos, continueManagedOperatingCycle, generateScheduledRunReview, reconcileDigitalEmployeeRun } from '../routes/digitalEmployees.js';
import { ensureWeeklyImageQueue, weeklyImageProgress } from './weeklyImageQueueBridge.js';
import type { PlanRecord, RunRecord } from './records.js';

type StoredRecord = { id: string; [key: string]: unknown };
type RuntimeRun = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  started_at: string;
  product_profile?: unknown;
};
type RuntimeGoal = StoredRecord & { tenant_id: string; status: string; starts_at: string; ends_at: string };
type RuntimePlan = StoredRecord & { tenant_id: string; status: string; plan: unknown };
type RuntimeConfig = StoredRecord & { tenant_id: string; config: unknown };
type RuntimeTask = StoredRecord & {
  tenant_id: string;
  run_id: string;
  task_key: string;
  status: string;
  output?: unknown;
  blocked_reason?: string;
};
type RuntimeStudioProject = StoredRecord & { tenant_id: string; spec?: unknown; status?: string };

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

const RECOVERABLE_PUBLISHING_CHECKS = new Set([
  'social_accounts',
  'publishing_oauth_configuration',
  'publishing_account_connections',
]);
const EXTERNAL_PROVIDER_ACCOUNT_PATTERN = /账户欠费|欠费|充值|鉴权失败|API Key|account is not in good standing|overdue[ -]?payment|arrearage|invalid api key|unauthori[sz]ed|forbidden/i;

/** Only connection/authentication preflight waits may wake without a click. */
export function isRecoverableExternalPublishingWait(task: Pick<RuntimeTask, 'task_key' | 'status' | 'output'>): boolean {
  if (task.task_key !== 'content_release_approval' || task.status !== 'waiting_human') return false;
  const output = jsonValue<Record<string, unknown>>(task.output, {});
  if (output.dataStatus !== 'preflight_blocked') return false;
  const preflight = jsonValue<{ checks?: Array<{ key?: string; ready?: boolean }> }>(output.preflight, {});
  return (preflight.checks || []).some(check => check.ready === false && RECOVERABLE_PUBLISHING_CHECKS.has(String(check.key || '')));
}

/** Provider-account waits are retried after a bounded backoff, not blindly. */
export function externalContentProjectRecoveryDue(
  project: Pick<RuntimeStudioProject, 'spec' | 'status'>,
  runId: string,
  taskIds: Set<string>,
  now = new Date(),
): boolean {
  if (['completed', 'cancelled', 'superseded'].includes(String(project.status || ''))) return false;
  const spec = jsonValue<Record<string, unknown>>(project.spec, {});
  if (String(spec.workflowRunId || '') !== runId || !taskIds.has(String(spec.workflowTaskId || ''))) return false;
  const automation = jsonValue<Record<string, unknown>>(spec.automation, {});
  if (String(automation.status || '') !== 'blocked' && String(automation.stage || '') !== 'blocked') return false;
  const recoverable = automation.autoRecheckExternal === true
    || EXTERNAL_PROVIDER_ACCOUNT_PATTERN.test(String(automation.blocker || ''));
  if (!recoverable) return false;
  const retryAt = Date.parse(String(automation.retryAfter || ''));
  return !Number.isFinite(retryAt) || retryAt <= now.getTime();
}

async function waitingHumanExternalRecoveryDue(run: RuntimeRun, now: Date): Promise<boolean> {
  if (run.status !== 'waiting_human') return false;
  const taskResult = await store.list<RuntimeTask>('workflow_tasks', {
    where: { tenant_id: run.tenant_id, run_id: run.id }, perPage: 200,
  });
  const waitingTasks = taskResult.items.filter(task => task.status === 'waiting_human');
  const publishingTask = waitingTasks.find(isRecoverableExternalPublishingWait);
  if (publishingTask) {
    const config = await runConfig(run);
    const targets = (config?.publishingTargets || []).filter(target => target.weeklyCount === undefined || Number(target.weeklyCount) > 0);
    const targetPlatforms = [...new Set(targets.map(target => target.platform))];
    if (targetPlatforms.length) {
      const readiness = await readTenantPublishingReadiness(run.tenant_id, true, targetPlatforms);
      if (readiness.snapshot.ready) return true;
    }
  }
  const productionTaskIds = new Set(waitingTasks.filter(task => task.task_key === 'content_production').map(task => task.id));
  if (!productionTaskIds.size) return false;
  const projects = await store.list<RuntimeStudioProject>('studio_projects', {
    where: { tenant_id: run.tenant_id }, sort: '-updated_at', perPage: 500,
  });
  return projects.items.some(project => externalContentProjectRecoveryDue(project, run.id, productionTaskIds, now));
}

async function weeklyImagesOutstanding(run: RuntimeRun): Promise<boolean> {
  const goal = await tenantRecord<RuntimeGoal>('weekly_goals', run.goal_id, run.tenant_id);
  if (goal?.status !== 'active') return false;
  const plan = await tenantRecord<RuntimePlan>('weekly_plans', run.plan_id, run.tenant_id);
  if (!plan || plan.status !== 'approved') return false;
  const progress = await weeklyImageProgress(store, run.tenant_id, plan as unknown as PlanRecord);
  return progress.total > progress.succeeded + progress.blocked
    || String(run.pause_reason || '').startsWith('图片任务待处理：');
}

async function advanceWeeklyImages(run: RuntimeRun): Promise<void> {
  if (!['planning', 'running', 'waiting_external', 'waiting_approval', 'waiting_human'].includes(run.status)) return;
  const goal = await tenantRecord<RuntimeGoal>('weekly_goals', run.goal_id, run.tenant_id);
  if (goal?.status !== 'active') return;
  const plan = await tenantRecord<RuntimePlan>('weekly_plans', run.plan_id, run.tenant_id);
  if (!plan || plan.status !== 'approved') return;
  const body = jsonValue<Record<string, unknown>>(plan.plan, {});
  const grant = jsonValue<Record<string, unknown>>(body.contentGenerationAuthorization, {});
  const userId = String(grant.authorizedBy || '');
  if (!userId) return;
  await ensureWeeklyImageQueue({ store, tenantId: run.tenant_id, userId,
    plan: plan as unknown as PlanRecord, run: run as unknown as RunRecord });
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
        const externalRecoveryCandidate = status === 'waiting_human' && await waitingHumanExternalRecoveryDue(run, now);
        const imageCandidate = status === 'waiting_human' && await weeklyImagesOutstanding(run);
        if (!reopenCandidate && !reviewCandidate && !externalRecoveryCandidate && !imageCandidate) continue;
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
      // Image admission has its own progress; a human wait in the video branch
      // must not freeze other image slots.
      try { await advanceWeeklyImages(run); }
      catch (error) {
        if (error instanceof Error && error.message === 'local_store_reconciliation_required') throw error;
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ runId: run.id, tenantId: run.tenant_id, message: `weekly_image: ${message}` });
        console.error(`[digital-employee-runtime] weekly images for ${run.id} need attention:`, message);
      }
      const canReopen = run.status === 'succeeded' && normalizeContinuationPolicy((await runConfig(run))?.continuationPolicy).newCustomers === 'reopen' && await (async () => { const goal = await tenantRecord<RuntimeGoal>('weekly_goals', run.goal_id, run.tenant_id); return goal ? reviewSlotIsInGoal(now, goal) : false; })();
      const canRecoverExternalWait = run.status === 'waiting_human' && await waitingHumanExternalRecoveryDue(run, now);
      const canRecoverImages = run.status === 'waiting_human' && String(run.pause_reason || '').startsWith('图片任务待处理：');
      if (RECONCILABLE_STATUSES.has(run.status) || canReopen || canRecoverExternalWait || canRecoverImages) {
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
