import type { WeeklyMaterialPorts } from '../socialPrograms/weeklyMaterialRequests.js';
import { checkWeeklyEnterpriseFactSupplement, WEEKLY_ENTERPRISE_FACT_STEPS } from './weeklyEnterpriseFactSupplement.js';
import { runWeeklyHumanMaterialRecoveryScan } from './weeklyHumanMaterialRecoveryScan.js';
import { materializeWeeklyCustomerChannelAuthorizationException, runWeeklyCustomerChannelAuthorizationExceptionScan } from './weeklyCustomerChannelAuthorizationExceptions.js';
import { materializeWeeklySupplementException, runWeeklySupplementExceptionScan } from './weeklySupplementExceptionMaterializer.js';
import {weeklyExecutionObservation} from './weeklyExecutionObservation.js';
import { runWeeklyDeadlineRecoveryScan, type DeadlineRecoveryEvidenceReader } from './socialWeeklyDeadlineRecovery.js';
import { randomUUID } from 'node:crypto';
import { SocialProgramError } from '../socialPrograms/service.js';
import { SocialContentWorkflowError } from '../starter198/socialContentValidation.js';
import { assertWeeklyPlanningCoverage } from '../socialPrograms/weeklyPlanningCoverage.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { WeeklyAgentPlanningState, WeeklyExecutionTask, WeeklyProductionStepKind } from '../../shared/contracts/socialProgram.js';
import { PACKAGES, type PackageRow } from '../socialPrograms/weeklyOperatingPackageSupport.js';
import { WEEKLY_AGENT_PLANNING } from '../socialPrograms/planningAuthority.js';
import { ownedDiagnosisReady } from '../socialPrograms/ownedReferenceDiagnosis.js';
import { WEEKLY_EXECUTION_TASKS, type WeeklyExecutionTaskRow } from '../socialPrograms/executionTasks.js';
import { createSocialWeeklyExecutionWorker } from './socialWeeklyExecutionWorker.js';
import { createWeeklyExecutionContinuationService } from '../socialPrograms/weeklyExecutionContinuations.js';
import type { SocialWeeklyExecutionAdapter, WeeklyExecutionAdapterResult } from './socialWeeklyExecutionAdapter.js';

import {TEMPLATE_EXECUTION_INPUT_BLOCKERS} from '../socialPrograms/templateExecutionBlockingCodes.js';

export const WEEKLY_PREPRODUCTION_STEPS: WeeklyProductionStepKind[] = ['business_outline', 'benchmark_collection', 'benchmark_scoring', 'director_analysis', 'business_schedule'];

/** Reconcile work already performed before formal dispatch against its frozen authority. */
export function createSocialWeeklyPlanningAdapter(dataStore: DataStore): SocialWeeklyExecutionAdapter {
  return { async execute(task) {
    const packages = await dataStore.list<PackageRow>(PACKAGES, { where: { tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, version: task.packageVersion }, page: 1, perPage: 1 });
    const pkg = packages.items[0]?.payload;
    if (!pkg || !['draft', 'active'].includes(pkg.status) || pkg.packageId !== task.packageId || pkg.version !== task.packageVersion) return { status: 'blocked', code: 'weekly_package_not_executable', message: '本周任务包已被替代、停用或不存在。' };
    if(task.schedule.stepKind==='business_outline'&&pkg.socialContentPackage?.publicationTasks?.length&&pkg.socialContentPackage.publicationTasks.every(p=>p.inventoryReuseRef)){
      try{const {readWeeklyInventoryOutlineEvidence}=await import('./weeklyInventoryOutlineEvidence.js');const result=await readWeeklyInventoryOutlineEvidence(dataStore,task);return {status:'succeeded',resultRefs:result.resultRefs};}
      catch(error){if(error instanceof SocialProgramError)return {status:'blocked',code:error.code,message:error.message};throw error;}
    }
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
    const coverage = plan.dispatch.coverage;
    if (coverage) {
      try { assertWeeklyPlanningCoverage(plan, coverage, plan.userConfirmation.selectedSlotIds); }
      catch (error) { if (error instanceof SocialProgramError) return blocked(error.code, error.message); throw error; }
      if (JSON.stringify(plan.detailedSchedule.coverage) !== JSON.stringify(coverage)) return blocked('weekly_partial_coverage_changed', '实际派单与确认排期的母版范围不一致。');
      if (task.publicationTaskId && (!plan.skeleton.slots.some(slot => coverage.selectedSlotIds.includes(slot.slotId) && slot.publicationTaskIds.includes(task.publicationTaskId!)) || !plan.dispatch.scheduleItems.some(item => item.publicationTaskId === task.publicationTaskId))) return blocked('weekly_slot_not_dispatched', '此条目尚未确认派单，保留原来源配额等待补齐。');
    }
    const motherId = String(task.inputSnapshot.motherContentId ?? '');
    if ('referenceSourcePolicy' in task.inputSnapshot && (!task.inputSnapshot.referenceSourcePolicy || JSON.stringify(task.inputSnapshot.referenceSourcePolicy) !== JSON.stringify(plan.referenceSourcePolicy) || JSON.stringify(plan.referenceSourcePolicy) !== JSON.stringify(pkg.referenceSourcePolicy))) return blocked('reference_source_policy_required', '本任务参考来源配额尚未明确冻结或与计划版本不一致。');
    const slots = plan.skeleton.slots.filter(slot => (!coverage || coverage.selectedSlotIds.includes(slot.slotId)) && (!motherId || slot.motherContentId === motherId) && (!task.accountId || slot.accountIds.includes(task.accountId)));
    const analyses = plan.directorAnalyses.filter(analysis => slots.some(slot => slot.slotId === analysis.slotId));
    if (task.inputSnapshot.referenceSource && slots.some(slot => slot.referenceSource !== task.inputSnapshot.referenceSource)) return blocked('reference_source_allocation_mismatch', '母版来源与冻结任务不一致，不能用外部参考替换自有配额。');
    if (plan.referenceSourcePolicy?.profile === 'b2b_cold_start' && slots.some(slot => slot.referenceSource === 'owned')) return blocked('cold_start_external_reference_required', '零基础首周仅允许外部参考。');
    if (['benchmark_scoring', 'director_analysis'].includes(step) && slots.some(slot => slot.referenceSource === 'owned' && !analyses.some(analysis => analysis.slotId === slot.slotId && ownedDiagnosisReady(analysis) && JSON.stringify(analysis.ownedReferenceDiagnosis!.policy) === JSON.stringify(plan.referenceSourcePolicy)))) return blocked('owned_reference_diagnosis_pending', '自有参考需完整播放、赞转评和冻结调性分析；缺项保留待诊断，不改成外部。');
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
  now?: Date;
  readRecoveryEvidence?: DeadlineRecoveryEvidenceReader;
  humanMaterialPorts?: WeeklyMaterialPorts;
}) {
  const dataStore = input.dataStore ?? store;
  const deadlineRecovery = await runWeeklyDeadlineRecoveryScan({ dataStore, now: input.now, readEvidence: input.readRecoveryEvidence });
  const supplementRecovery = await runWeeklySupplementExceptionScan({ store: dataStore, now: input.now });
  const customerAuthorizationRecovery = await runWeeklyCustomerChannelAuthorizationExceptionScan({ store: dataStore, now: input.now });
  const humanMaterialRecovery = await runWeeklyHumanMaterialRecoveryScan({ store: dataStore, now: input.now, materialPorts: input.humanMaterialPorts });
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
      let claim = await worker.claimNext({ tenantId, workerId, now: input.now, leaseDurationMs: input.leaseDurationMs ?? 120_000 });
      if (!claim) break;
      report.claimed++;
      let lostLease: unknown;
      let renewal = Promise.resolve();
      const timer = setInterval(() => {
        renewal = renewal.then(async () => {
          if (!lostLease) { try { claim = await worker.renew(claim!, { leaseDurationMs: input.leaseDurationMs ?? 120_000, now: input.now }); } catch (error) { lostLease = error; } }
        });
      }, Math.max(100, Math.floor((input.leaseDurationMs ?? 120_000) / 3)));
      timer.unref?.();
      let validatingCompletion = false;
      try {
        const adapter = input.adapters[claim.task.schedule.stepKind];
        let dispatchGate:WeeklyExecutionAdapterResult;
        try{const {readWeeklyInventoryExecutionGate}=await import('./weeklyInventoryOutlineEvidence.js');const inventoryGate=await readWeeklyInventoryExecutionGate(dataStore,claim.task);dispatchGate=inventoryGate?{status:'succeeded',resultRefs:inventoryGate.resultRefs}:await planningAuthority.execute({ ...claim.task, accountId: null, inputSnapshot: {}, schedule: { ...claim.task.schedule, stepKind: 'business_outline' } });}
        catch(error){if(error instanceof SocialProgramError)dispatchGate={status:'blocked',code:error.code,message:error.message};else throw error;}
        if (dispatchGate.status === 'succeeded' && WEEKLY_ENTERPRISE_FACT_STEPS.has(claim.task.schedule.stepKind)) {
          const facts = await checkWeeklyEnterpriseFactSupplement({ store: dataStore, task: claim.task, now: input.now });
          if (facts.applicable && !facts.ready) dispatchGate = { status: 'blocked', code: facts.code, message: facts.reason };
        }
        const continuationPending = claim.task.inputSnapshot.weeklyContinuationPending;
        const continuationRef = claim.task.inputSnapshot.weeklyContinuationRef;
        let continuationResult: WeeklyExecutionAdapterResult | undefined;
        if (dispatchGate.status === 'succeeded' && (continuationPending || continuationRef)) {
          try {
            if (!continuationRef) throw new SocialProgramError('weekly_execution_continuation_verification_required', 409, '等待核验原任务复用记录；不能重新启动制作。');
            const ref = continuationRef as import('../../shared/contracts/socialProgram.js').VersionedSocialRef;
            const read = await createWeeklyExecutionContinuationService(dataStore).readValidated({ tenantId: claim.task.tenantId, programId: claim.task.programId, packageId: claim.task.packageId, targetVersion: claim.task.packageVersion, targetTaskId: claim.task.taskId, ref });
            continuationResult = read.status === 'ready' ? { status: 'succeeded', resultRefs: [ref] }
              : { status: read.status, code: read.code ?? 'weekly_continuation_waiting_real_source_settlement', message: '正在核对原任务的真实产物或运行结果；不会启动新版本制作。' };
          } catch (error) {
            if (!(error instanceof SocialProgramError) && !(error instanceof SocialContentWorkflowError)) throw error;
            continuationResult = { status: 'blocked', code: error.code, message: error.message };
          }
        }
        const result = dispatchGate.status !== 'succeeded' ? dispatchGate : continuationResult
          ? continuationResult
          : adapter ? await adapter.execute(claim.task) : { status: 'blocked' as const, code: 'weekly_step_adapter_unavailable', message: '该生产步骤暂缺执行适配器。' };
        clearInterval(timer);
        await renewal;
        if (lostLease) throw lostLease;
        if (result.status === 'succeeded') { validatingCompletion = true; await worker.complete(claim, result.resultRefs, input.now); report.succeeded++; }
        else {
          await worker.defer(claim, { now: input.now, code: result.code, message: result.message, progress: result.progress, retryDelayMs: result.status === 'pending' ? result.retryDelayMs : undefined, blockingReason: result.status === 'blocked' ? result.code : undefined });
          if (result.status === 'blocked') {
            await materializeWeeklySupplementException({ store: dataStore, task: claim.task, gapCode: result.code, now: input.now });
            await materializeWeeklyCustomerChannelAuthorizationException({ store: dataStore, task: claim.task, gapCode: result.code, now: input.now });
          }
          report[result.status]++;
        }
      } catch (error) {
        clearInterval(timer);
        await renewal;
        report.failed++;
        const templateInputBlocked = error instanceof SocialProgramError && [400,403,409].includes(error.status) && TEMPLATE_EXECUTION_INPUT_BLOCKERS.has(error.code);
        if (!lostLease && ((error instanceof SocialProgramError && [400,403,409].includes(error.status) && TEMPLATE_EXECUTION_INPUT_BLOCKERS.has(error.code)) || validatingCompletion && ((error instanceof SocialProgramError && [400, 401, 403, 404, 409, 422].includes(error.status)) || (error instanceof SocialContentWorkflowError && ([400, 401, 403, 404, 409, 422].includes(error.status) || ['social_content_file_integrity_violation', 'social_content_file_record_invalid'].includes(error.code)))))) {
          await worker.defer(claim, { now: input.now, code: error.code, message: error.message, blockingReason: error.code }).catch(() => undefined);
          if(templateInputBlocked){report.failed--;report.blocked++;}
        } else if (!lostLease) await worker.fail(claim, { now: input.now, code: 'weekly_execution_adapter_failed', message: error instanceof Error ? error.message : String(error), retryable: true }).catch(() => undefined);
      } finally { clearInterval(timer); }
    }
  }
  const humanMaterialAfterExecution = await runWeeklyHumanMaterialRecoveryScan({ store: dataStore, now: input.now, materialPorts: input.humanMaterialPorts });
  return { ...report, deadlineRecovery, supplementRecovery, customerAuthorizationRecovery, humanMaterialRecovery, humanMaterialAfterExecution };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export function initSocialWeeklyExecutionRuntime(adapters: Partial<Record<WeeklyProductionStepKind, SocialWeeklyExecutionAdapter>>, options: { readRecoveryEvidence?: DeadlineRecoveryEvidenceReader } = {}): void {
  if(timer)return;
  if(process.env.SOCIAL_WEEKLY_EXECUTION_WORKER_ENABLED!=='true'){weeklyExecutionObservation.initialize(false);return;}
  const workerId = `weekly-execution-${process.pid}-${randomUUID()}`;
  const tick = () => {
    if (running) return;
    running = true;
    void weeklyExecutionObservation.scan(()=>runSocialWeeklyExecutionScan({ adapters, workerId, readRecoveryEvidence: options.readRecoveryEvidence })).catch(error => console.error('[social-weekly-execution] scan unavailable:', error instanceof Error ? error.message : String(error))).finally(() => { running = false; });
  };
  timer = setInterval(tick, Math.max(1_000, Number(process.env.SOCIAL_WEEKLY_EXECUTION_INTERVAL_MS) || 15_000));
  timer.unref?.();
  weeklyExecutionObservation.initialize(true,workerId);
  tick();
}
