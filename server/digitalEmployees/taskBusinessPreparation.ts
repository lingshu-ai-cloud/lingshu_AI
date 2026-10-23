import type { DataStore } from '../storage/datastore.js';
import type { EventRecord } from '../routes/digitalEmployeeRecords.js';
import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { followupDraftDue } from './continuationPolicy.js';
import { type TaskFailure } from './taskRetry.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { type browserExecutionEnabled } from './browserSessions.js';
import { type currentExecutionAdapters } from './executionAdapters.js';
import { type ensureDigitalEmployeeSocialCollectionTask, type runScheduledTaskNow, type scheduledExecutionState } from '../routes/scheduler.js';
import { type EnterpriseProfile } from '../routes/enterprise.js';
import { type BusinessSnapshot } from './businessSnapshot.js';
import { type advanceAutomatedContentProduction } from './contentProduction.js';
import { type getTenantFollowupDispatchStatus } from './followupDispatchWorker.js';
import { shouldRunScheduledCollection } from './scheduledCollectionProof.js';
import { followupScheduleFromCadence, socialScheduleFromCadence } from './runtimeSchedule.js';
import { goalInput } from './overviewProjection.js';
import { DEFAULT_FOLLOWUP_SEGMENT_CRITERIA, type createCustomerSegmentSnapshot, type createFollowupBatch } from './customerWorkflow.js';
import { type DigitalEmployeeConfig } from './domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ContentBatchPlanRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';

export interface TaskBusinessPreparationDependencies {
  store: DataStore;
  tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null>;
  first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T | null>;
  collectionLimitForInventoryGap(task: TaskRecord, fallback: number): number;
  currentExecutionAdapters: typeof currentExecutionAdapters;
  browserExecutionEnabled: typeof browserExecutionEnabled;
  ensureDigitalEmployeeSocialCollectionTask: typeof ensureDigitalEmployeeSocialCollectionTask;
  scheduledExecutionState: typeof scheduledExecutionState;
  runScheduledTaskNow: typeof runScheduledTaskNow;
  advanceAutomatedContentProduction: typeof advanceAutomatedContentProduction;
  createCustomerSegmentSnapshot: typeof createCustomerSegmentSnapshot;
  createFollowupBatch: typeof createFollowupBatch;
  getTenantFollowupDispatchStatus: typeof getTenantFollowupDispatchStatus;
  appendEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    type: string;
    level?: 'info' | 'warning' | 'error' | 'success';
    summary: string;
    payload?: Record<string, unknown>;
  }): Promise<EventRecord>;
  appendAudit(input: {
    tenantId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  ensureFrozenEnterpriseProfileForRun(
    tenantId: string,
    plan: PlanRecord | null,
    fallbackConfig: DigitalEmployeeConfig,
    boundAt: string,
  ): Promise<EnterpriseProfile>;
  executeInTaskBrowser<T>(input: { tenantId: string; run: RunRecord; task: TaskRecord }, label: string, action: () => Promise<T>): Promise<T>;
}

/** Prepare business resources through the existing browser, queue and provider ports. */
export function createTaskBusinessPreparation(deps: TaskBusinessPreparationDependencies) {
  const { store, tenantRecord, first, collectionLimitForInventoryGap,
    currentExecutionAdapters,
    browserExecutionEnabled,
    ensureDigitalEmployeeSocialCollectionTask,
    scheduledExecutionState,
    runScheduledTaskNow,
    advanceAutomatedContentProduction,
    createCustomerSegmentSnapshot,
    createFollowupBatch,
    getTenantFollowupDispatchStatus,
    appendEvent, appendAudit, ensureFrozenEnterpriseProfileForRun, executeInTaskBrowser } = deps;
  async function prepareObserveBusinessResource(input: {
    tenantId: string;
    goal: GoalRecord;
    run: RunRecord;
    task: TaskRecord;
    config: DigitalEmployeeConfig;
    snapshot: BusinessSnapshot;
  }): Promise<boolean> {
    const adapter = currentExecutionAdapters()?.prepare;
    if (adapter) return adapter(input);
    // Set up the scheduled record before opening its existing production control.
    // This only saves configuration; runScheduledTaskNow remains behind the click.
    if (browserExecutionEnabled() && input.task.task_key === 'scheduled_source_collection'
      && !jsonObject<Array<Record<string, unknown>>>(input.task.business_refs, []).some(ref => ref.type === 'scheduled_task')) {
      const schedule = socialScheduleFromCadence(input.config.socialCadence);
      const collectionLimit = collectionLimitForInventoryGap(input.task, schedule.limit);
      const ensured = await ensureDigitalEmployeeSocialCollectionTask({ tenantId: input.tenantId,
        workflowRunId: input.run.id, workflowTaskId: input.task.id,
        keywords: input.config.focusProducts || goalInput(input.goal).scope || input.config.primaryBusiness,
        ...schedule,
        limit: collectionLimit,
        confirmedWeeklyBoundary: {
          businessGoal: goalInput(input.goal).objective,
          products: input.config.focusProducts.split(/[、，,；;\n]/).map(value => value.trim()).filter(Boolean),
          market: goalInput(input.goal).scope || input.config.targetMarkets,
          language: input.config.videoLanguages[0] || input.config.videoDefaults?.language || 'en',
          audience: input.config.customerProfile,
          platforms: schedule.platforms,
          lookbackDays: schedule.dateWindowDays,
          resultLimit: collectionLimit,
          approvedBy: input.goal.owner_id,
          workflowRunId: input.run.id,
          workflowTaskId: input.task.id,
        },
      });
      if (!ensured || ensured.pendingReason) {
        const reason = ensured?.pendingReason || '待编导确认采集范围';
        await store.update(COLLECTION.tasks, input.task.id, { blocked_reason: reason, updated_at: new Date().toISOString() });
        input.task.blocked_reason = reason;
        return false;
      }
      const refs = [{ type: 'scheduled_task', id: ensured.task.id, taskType: ensured.task.taskType, cronExpr: ensured.task.cronExpr }];
      await store.update(COLLECTION.tasks, input.task.id, { business_refs: refs, updated_at: new Date().toISOString() });
      input.task.business_refs = refs;
      if (ensured.created || ensured.updated) {
        await appendEvent({ tenantId: input.tenantId, runId: input.run.id, taskId: input.task.id,
          type: 'business.resource.prepared', level: 'info', summary: '已准备原定时采集配置，等待浏览器点击执行',
          payload: { businessRefs: refs, schedule, externalPublishPerformed: false } });
        await appendAudit({ tenantId: input.tenantId, userId: input.goal.owner_id || 'digital_employee_agent',
          action: 'digital_employee.scheduler.prepared', targetType: 'scheduled_task', targetId: ensured.task.id,
          metadata: { runId: input.run.id, taskId: input.task.id, schedule } });
      }
    }
    // Work starts at a real production-page button click. Observer-only checks
    // and approval decisions retain their existing authorization paths.
    if (['scheduled_source_collection', 'content_production', 'customer_segmentation', 'followup_batch_draft'].includes(input.task.task_key)) {
      const labels: Record<string, string> = { scheduled_source_collection: '执行社媒采集', content_production: '执行下一步制作', customer_segmentation: '生成客户分层', followup_batch_draft: '生成跟进草稿' };
      return executeInTaskBrowser(input, labels[input.task.task_key], () => prepareObserveBusinessResourceDirect(input));
    }
    return prepareObserveBusinessResourceDirect(input);
  }
  async function prepareObserveBusinessResourceDirect(input: {
    tenantId: string; goal: GoalRecord; run: RunRecord; task: TaskRecord;
    config: DigitalEmployeeConfig; snapshot: BusinessSnapshot;
  }): Promise<boolean> {
    const { tenantId, goal, run, task, config, snapshot } = input;
    const actorId = goal.owner_id || 'digital_employee_agent';
    let runEnterpriseProfile: EnterpriseProfile | null = null;
    const frozenRunFacts = async () => {
      if (runEnterpriseProfile) return runEnterpriseProfile;
      const plan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
      runEnterpriseProfile = await ensureFrozenEnterpriseProfileForRun(tenantId, plan, config, run.started_at);
      return runEnterpriseProfile;
    };
    if (task.task_key === 'scheduled_source_collection') {
      const collectionSchedule = socialScheduleFromCadence(config.socialCadence);
      const collectionLimit = collectionLimitForInventoryGap(task, collectionSchedule.limit);
      const ensured = await ensureDigitalEmployeeSocialCollectionTask({
        tenantId,
        workflowRunId: run.id,
        workflowTaskId: task.id,
        keywords: config.focusProducts || goalInput(goal).scope || config.primaryBusiness,
        cronExpr: collectionSchedule.cronExpr,
        cronLabel: collectionSchedule.cronLabel,
        platforms: collectionSchedule.platforms,
        limit: collectionLimit,
        dateWindowDays: collectionSchedule.dateWindowDays,
        dedupeWindowDays: collectionSchedule.dedupeWindowDays,
        confirmedWeeklyBoundary: {
          businessGoal: goalInput(goal).objective,
          products: config.focusProducts.split(/[、，,；;\n]/).map(value => value.trim()).filter(Boolean),
          market: goalInput(goal).scope || config.targetMarkets,
          language: config.videoLanguages[0] || config.videoDefaults?.language || 'en',
          audience: config.customerProfile,
          platforms: collectionSchedule.platforms,
          lookbackDays: collectionSchedule.dateWindowDays,
          resultLimit: collectionLimit,
          approvedBy: actorId,
          workflowRunId: run.id,
          workflowTaskId: task.id,
        },
      });
      if (!ensured || ensured.pendingReason) {
        const reason = ensured?.pendingReason || '待编导确认采集范围';
        await store.update(COLLECTION.tasks, task.id, { blocked_reason: reason, updated_at: new Date().toISOString() });
        task.blocked_reason = reason;
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'business.resource.awaiting_director_approval', level: 'warning', summary: reason, payload: { externalPublishPerformed: false } });
        return false;
      }
      const refs = [{ type: 'scheduled_task', id: ensured.task.id, taskType: ensured.task.taskType, cronExpr: ensured.task.cronExpr }];
      await store.update(COLLECTION.tasks, task.id, { business_refs: refs, updated_at: new Date().toISOString() });
      task.business_refs = refs;
      if (ensured.created || ensured.updated) {
        const action = ensured.created ? 'created' : 'updated';
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: `business.resource.${action}`, level: 'success', summary: `已${ensured.created ? '创建' : '更新'}社媒内容采集计划：${ensured.task.cronLabel}`, payload: { businessRefs: refs, schedule: collectionSchedule, externalPublishPerformed: false } });
        await appendAudit({ tenantId, userId: actorId, action: `digital_employee.scheduler.${action}`, targetType: 'scheduled_task', targetId: ensured.task.id, metadata: { runId: run.id, taskId: task.id, schedule: collectionSchedule } });
      }
      const taskOutput = jsonObject<Record<string, unknown>>(task.output, {});
      const previousFailure = taskOutput.executionFailure as TaskFailure | undefined;
      const priorExecutionState = scheduledExecutionState(ensured.task.lastResult);
      const shouldRunNow = shouldRunScheduledCollection({
        enabled: ensured.task.enabled,
        created: ensured.created,
        updated: ensured.updated,
        lastRun: ensured.task.lastRun,
        executionState: priorExecutionState,
        rerunRequestedAt: String(taskOutput.rerunRequestedAt || ''),
        retryAt: previousFailure?.retryAt,
      });
      if (shouldRunNow) {
        try {
          const firstRun = await runScheduledTaskNow({ tenantId, taskId: ensured.task.id });
          const nextRefs = refs.map(ref => ({ ...ref, firstRunState: firstRun.state, lastRun: firstRun.lastRun || '' }));
          await store.update(COLLECTION.tasks, task.id, { business_refs: nextRefs, updated_at: new Date().toISOString() });
          task.business_refs = nextRefs;
          await appendEvent({
            tenantId,
            runId: run.id,
            taskId: task.id,
            type: 'business.resource.first_run',
            level: firstRun.state === 'failed' || firstRun.state === 'worker_offline' ? 'warning' : 'success',
            summary: `定时采集首轮执行：${firstRun.state}`,
            payload: { businessRefs: nextRefs, state: firstRun.state, lastRun: firstRun.lastRun || '', resultSummary: firstRun.result.slice(0, 500) },
          });
          await appendAudit({ tenantId, userId: actorId, action: 'digital_employee.scheduler.first_run', targetType: 'scheduled_task', targetId: ensured.task.id, metadata: { runId: run.id, taskId: task.id, state: firstRun.state } });
          if (['failed', 'worker_offline', 'no_data'].includes(firstRun.state)) {
            throw new Error(`scheduled_source_collection_${firstRun.state}: ${firstRun.result.slice(0, 1000)}`);
          }
        } catch (error) {
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'business.resource.first_run_failed', level: 'warning', summary: '定时采集已创建，首轮执行未成功', payload: { error: error instanceof Error ? error.message : 'scheduled_first_run_failed' } });
          throw error;
        }
      }
      return true;
    }
    if (task.task_key === 'content_production') {
      const batchPlan = await first<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { tenant_id: tenantId, run_id: run.id }, '-created_at');
      const result = await advanceAutomatedContentProduction({
        tenantId,
        runId: run.id,
        taskId: task.id,
        config,
        goal: goalInput(goal),
        enterpriseProfile: await frozenRunFacts(),
        ...(batchPlan ? { batchPlanId: batchPlan.id, contentOrders: jsonObject(batchPlan.orders, []) } : {}),
      });
      const refs: Array<Record<string, unknown>> = [...result.projectRefs, ...result.knowledgeGaps];
      const refsChanged = JSON.stringify(jsonObject<Array<Record<string, unknown>>>(task.business_refs, [])) !== JSON.stringify(refs);
      await store.update(COLLECTION.tasks, task.id, {
        business_refs: refs,
        updated_at: new Date().toISOString(),
      });
      task.business_refs = refs;
      if (result.changed || refsChanged) {
        await appendEvent({
          tenantId,
          runId: run.id,
          taskId: task.id,
          type: result.ready ? 'content.production.completed' : 'content.production.progressed',
          level: result.blocker ? 'warning' : 'success',
          summary: result.blocker ? `${result.summary}：${result.blocker}` : result.summary,
          payload: { businessRefs: refs, knowledgeGaps: result.knowledgeGaps, blocker: result.blocker, externalPublishPerformed: false },
        });
      }
      return result.changed || refsChanged;
    }
    if (task.task_key === 'customer_segmentation' && Number(snapshot.customer.total.value || 0) > 0) {
      const followupSchedule = followupScheduleFromCadence(config.followupCadence);
      if (!followupDraftDue({ schedule: followupSchedule.draft, startedAt: run.started_at, startsAt: goal.starts_at, endsAt: goal.ends_at, policy: normalizeContinuationPolicy(config.continuationPolicy).missedFollowup, reopened: Boolean(jsonObject<Record<string, unknown>>(task.output, {}).reopenedForNewCustomers) })) return false;
      const result = await createCustomerSegmentSnapshot({
        tenantId,
        goalId: goal.id,
        runId: run.id,
        taskId: task.id,
        userId: actorId,
        criteria: await (async () => {
          const plan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
          const pack = plan ? jsonObject<{ businessPackage?: WeeklyPackage }>(plan.plan, {}).businessPackage : undefined;
          return { ...DEFAULT_FOLLOWUP_SEGMENT_CRITERIA, ...(pack?.authorization.customerIds.length ? { includeCustomerIds: pack.authorization.customerIds } : {}) };
        })(),
        idempotent: true,
      });
      const refs = [{ type: 'customer_segment', id: result.segment.id, version: result.segment.version, memberCount: result.segment.member_count }];
      await store.update(COLLECTION.tasks, task.id, { business_refs: refs, updated_at: new Date().toISOString() });
      task.business_refs = refs;
      if (result.created) {
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'business.resource.created', level: 'success', summary: `已冻结客户分层快照（${result.segment.member_count} 人）`, payload: { businessRefs: refs, excludedCount: result.segment.excluded_count } });
        await appendAudit({ tenantId, userId: actorId, action: 'customer_segment.created', targetType: 'customer_segment', targetId: result.segment.id, metadata: { runId: run.id, taskId: task.id, memberCount: result.segment.member_count } });
      }
      return result.created;
    }
    if (task.task_key === 'followup_batch_draft') {
      const segments = await store.list<StoredRecord>(COLLECTION.segments, {
        where: { tenant_id: tenantId, run_id: run.id }, sort: '-version', perPage: 100,
      });
      const segment = segments.items.find(item => ['generated', 'active', 'ready'].includes(String(item.status || '')));
      if (!segment) return false;
      const followupSchedule = followupScheduleFromCadence(config.followupCadence);
      const result = await createFollowupBatch({
        tenantId,
        goalId: goal.id,
        runId: run.id,
        taskId: task.id,
        segmentId: segment.id,
        userId: actorId,
        idempotent: true,
        deliveryPolicy: {
          workdaysOnly: followupSchedule.workdaysOnly,
          sendWindowStartHour: followupSchedule.sendWindowStartHour,
          sendWindowEndHour: followupSchedule.sendWindowEndHour,
          contactWindowDays: followupSchedule.contactWindowDays,
          maxContactsPerWindow: followupSchedule.maxContactsPerWindow,
        },
        enterpriseProfile: await frozenRunFacts(),
      });
      const refs = [{ type: 'followup_batch', id: result.batch.id, version: result.batch.version, contentHash: result.batch.content_hash, itemCount: result.items.length }];
      await store.update(COLLECTION.tasks, task.id, { business_refs: refs, updated_at: new Date().toISOString() });
      task.business_refs = refs;
      if (result.created) {
        const worker = await getTenantFollowupDispatchStatus(tenantId);
        const workerMode = worker.authorization.scheduledFollowupSendAllowed ? 'scheduled' : 'manual_only';
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'business.resource.created', level: 'success', summary: `已生成 ${result.items.length} 条逐客跟进草稿`, payload: { businessRefs: refs, bulkWorkerStatus: workerMode, messagingAuthorization: worker.authorization, messagesSent: 0 } });
        await appendAudit({ tenantId, userId: actorId, action: 'followup_batch.created', targetType: 'followup_batch', targetId: result.batch.id, metadata: { runId: run.id, taskId: task.id, itemCount: result.items.length, bulkWorkerStatus: workerMode, messagingAuthorization: worker.authorization } });
      }
      return result.created;
    }
    return false;
  }
  return { prepareObserveBusinessResource };
}
