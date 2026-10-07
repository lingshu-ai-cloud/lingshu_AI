import { randomUUID } from 'node:crypto';
import { SocialProgramError } from '../socialPrograms/service.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { WeeklyAgentPlanningState, WeeklyExecutionTask, WeeklyProductionStepKind } from '../../shared/contracts/socialProgram.js';
import { PACKAGES, type PackageRow } from '../socialPrograms/weeklyOperatingPackageSupport.js';
import { WEEKLY_AGENT_PLANNING } from '../socialPrograms/planningAuthority.js';
import { WEEKLY_EXECUTION_TASKS, type WeeklyExecutionTaskRow } from '../socialPrograms/executionTasks.js';
import { createSocialWeeklyExecutionWorker } from './socialWeeklyExecutionWorker.js';
import type { SocialWeeklyExecutionAdapter, WeeklyExecutionAdapterResult } from './socialWeeklyExecutionAdapter.js';

export const WEEKLY_PREPRODUCTION_STEPS: WeeklyProductionStepKind[] = ['business_outline', 'benchmark_collection', 'benchmark_scoring', 'director_analysis', 'business_schedule'];

/** Reconcile work already performed before formal dispatch against its frozen authority. */
export function createSocialWeeklyPlanningAdapter(dataStore: DataStore): SocialWeeklyExecutionAdapter {
  return { async execute(task) {
    const packages = await dataStore.list<PackageRow>(PACKAGES, { where: { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, version: task.packageVersion }, page: 1, perPage: 1 });
    const pkg = packages.items[0]?.payload;
    if (!pkg || !['draft', 'active'].includes(pkg.status) || pkg.packageId !== task.packageId || pkg.version !== task.packageVersion) return { status: 'blocked', code: 'weekly_package_not_executable', message: '本周任务包已被替代、停用或不存在。' };
    const rows = await dataStore.list<{ id: string; payload: WeeklyAgentPlanningState }>(WEEKLY_AGENT_PLANNING, {
      where: { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, package_version: task.packageVersion },
      sort: '-planning_version', page: 1, perPage: 1,
    });
    const plan = rows.items[0]?.payload;
    const blocked = (code: string, message: string): WeeklyExecutionAdapterResult => ({ status: 'blocked', code, message });
    if (!plan || plan.packageId !== task.packageId || plan.packageVersion !== task.packageVersion
      || plan.status !== 'dispatched' || !plan.userConfirmation || !plan.dispatch || !plan.detailedSchedule
      || plan.dispatch.packageVersion !== task.packageVersion
      || plan.dispatch.detailedScheduleRef.id !== plan.detailedSchedule.ref.id
      || plan.dispatch.detailedScheduleRef.version !== plan.detailedSchedule.ref.version) {
      return blocked('business_dispatch_required', '等待本周详细排期确认并正式派单。');
    }
    const step = task.schedule.stepKind;
    if (!WEEKLY_PREPRODUCTION_STEPS.includes(step)) return blocked('weekly_step_adapter_unavailable', '该步骤没有可用执行适配器。');
    const motherId = String(task.inputSnapshot.motherContentId ?? '');
    const slots = plan.skeleton.slots.filter(slot => !motherId || slot.motherContentId === motherId);
    const analyses = plan.directorAnalyses.filter(analysis => slots.some(slot => slot.slotId === analysis.slotId));
    if (!slots.length || (task.accountId && !slots.some(slot => slot.accountIds.includes(task.accountId!)))) {
      return blocked('frozen_schedule_input_missing', '冻结计划缺少对应内容或账号排期。');
    }
    if (step !== 'business_outline' && (!analyses.length || analyses.some(analysis =>
      analysis.packageVersion !== task.packageVersion || !analysis.benchmarkAccountRefs.length
      || !analysis.benchmarkVideoRefs.length || !analysis.benchmarkEvidenceRefs.length || !analysis.contentDirection.trim()))) {
      return blocked('qualified_benchmark_supply_required', '冻结计划缺少已评分对标证据及编导分析。');
    }
    if (step === 'business_schedule' && slots.some(slot => slot.publicationTaskIds.some(id =>
      !plan.dispatch!.scheduleItems.some(item => item.publicationTaskId === id)
      || !plan.detailedSchedule!.items.some(item => item.publicationTaskId === id)))) {
      return blocked('frozen_schedule_input_missing', '正式派单缺少对应详细排期条目。');
    }
    return { status: 'succeeded', resultRefs: [{ type: 'weekly_agent_planning', id: plan.planningId, version: plan.version }] };
  } };
}

export async function runSocialWeeklyExecutionScan(input: {
  dataStore?: DataStore;
  adapters: Partial<Record<WeeklyProductionStepKind, SocialWeeklyExecutionAdapter>>;
  workerId?: string;
  maxTasksPerTenant?: number;
  leaseDurationMs?: number;
}) {
  const dataStore = input.dataStore ?? store;
  const worker = createSocialWeeklyExecutionWorker(dataStore);
  const planningAuthority = createSocialWeeklyPlanningAdapter(dataStore);
  const workerId = input.workerId ?? `weekly-execution-${process.pid}-${randomUUID()}`;
  const tenants = new Set<string>();
  // Pagination matters: one large tenant must not starve later tenants.
  for (const status of ['queued', 'leased']) {
    for (let page = 1; ; page++) {
      const rows = await dataStore.list<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, { where: { status }, page, perPage: 500 });
      for (const row of rows.items) if (row.tenant_id && row.payload?.tenantId === row.tenant_id) tenants.add(row.tenant_id);
      if (page >= rows.totalPages || !rows.items.length) break;
    }
  }
  const report = { claimed: 0, succeeded: 0, pending: 0, blocked: 0, failed: 0 };
  for (const tenantId of tenants) {
    for (let count = 0; count < (input.maxTasksPerTenant ?? 25); count++) {
      let claim = await worker.claimNext({ tenantId, workerId, leaseDurationMs: input.leaseDurationMs ?? 120_000 });
      if (!claim) break;
      report.claimed++;
      let lostLease: unknown;
      let renewal = Promise.resolve();
      const timer = setInterval(() => {
        renewal = renewal.then(async () => {
          if (!lostLease) { try { claim = await worker.renew(claim!, { leaseDurationMs: input.leaseDurationMs ?? 120_000 }); } catch (error) { lostLease = error; } }
        });
      }, Math.max(100, Math.floor((input.leaseDurationMs ?? 120_000) / 3)));
      timer.unref?.();
      try {
        const adapter = input.adapters[claim.task.schedule.stepKind];
        const dispatchGate = await planningAuthority.execute({ ...claim.task, accountId: null, inputSnapshot: {}, schedule: { ...claim.task.schedule, stepKind: 'business_outline' } });
        const result = dispatchGate.status !== 'succeeded' ? dispatchGate : adapter ? await adapter.execute(claim.task) : { status: 'blocked' as const, code: 'weekly_step_adapter_unavailable', message: '该生产步骤暂缺执行适配器。' };
        clearInterval(timer);
        await renewal;
        if (lostLease) throw lostLease;
        if (result.status === 'succeeded') { await worker.complete(claim, result.resultRefs); report.succeeded++; }
        else { await worker.defer(claim, { code: result.code, message: result.message, retryDelayMs: result.status === 'pending' ? result.retryDelayMs : undefined, blockingReason: result.status === 'blocked' ? result.code : undefined }); report[result.status]++; }
      } catch (error) {
        clearInterval(timer);
        await renewal;
        report.failed++;
        if (!lostLease && error instanceof SocialProgramError && error.status === 409 && error.code.startsWith('weekly_execution_result')) {
          await worker.defer(claim, { code: error.code, message: error.message, blockingReason: error.code }).catch(() => undefined);
        } else if (!lostLease) await worker.fail(claim, { code: 'weekly_execution_adapter_failed', message: error instanceof Error ? error.message : String(error), retryable: true }).catch(() => undefined);
      } finally { clearInterval(timer); }
    }
  }
  return report;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export function initSocialWeeklyExecutionRuntime(adapters: Partial<Record<WeeklyProductionStepKind, SocialWeeklyExecutionAdapter>>): void {
  if (timer || process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED !== 'true') return;
  const workerId = `weekly-execution-${process.pid}-${randomUUID()}`;
  const tick = () => {
    if (running) return;
    running = true;
    void runSocialWeeklyExecutionScan({ adapters, workerId }).catch(error => console.error('[social-weekly-execution] scan unavailable:', error instanceof Error ? error.message : String(error))).finally(() => { running = false; });
  };
  timer = setInterval(tick, Math.max(1_000, Number(process.env.SOCIAL_WEEKLY_EXECUTION_INTERVAL_MS) || 15_000));
  timer.unref?.();
  tick();
}
