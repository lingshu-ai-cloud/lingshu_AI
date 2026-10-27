import { productionFailureState } from './productionPreflight.js';
import { reopenNoDataCustomerBranch } from './customerReentry.js';
import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { nextTaskFailure, taskRetryDue, type TaskFailure } from './taskRetry.js';
import { analysisWait, basicTaskWait, collectionWait, waitState, workflowStatusForWait } from './executionDiagnostics.js';
import { packageTaskForKey } from './weeklyPackage.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { readTenantPublishingReadiness } from './publishingRuntimeReadiness.js';
import { migrateLegacyPublishingPlanAccountBindings } from './publishingPlanAccountMigration.js';
import { store } from '../storage/index.js';
import { type BusinessSnapshot } from './businessSnapshot.js';
import { getTenantFollowupDispatchStatus } from './followupDispatchWorker.js';
import { publishingTargetPlatforms } from './publishingTargets.js';

import { mustInvalidateContentDownstream } from './dependencyInvalidation.js';
import { mustReobserveSucceededCollection, scheduledCollectionFailureCanRetry } from './scheduledCollectionProof.js';
import { withDigitalEmployeeRunLock } from './runControl.js';
import { goalInput, publicConfig } from './overviewProjection.js';
import { availableTaskActions } from './weeklyReviewProjection.js';
import { downstreamTasks } from './taskCorrectionSafety.js';
import { destinationLabel, hasSucceededApprovalAncestor, recordBelongsToTask, taskExecutionMetadata, taskScope } from './taskEvidenceProjection.js';
import { DEFAULT_FOLLOWUP_SEGMENT_CRITERIA, eligibleFollowupCustomerIds, applyFollowupBatchDecision, type FollowupBatchRecord } from './customerWorkflow.js';
import { buildTaskOutput, normalizeDigitalEmployeeConfig } from './domain.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './records.js';
import type { DigitalEmployeeApplicationPorts } from './applicationPorts.js';

export function createDigitalEmployeeRunCoordinator(deps: Pick<DigitalEmployeeApplicationPorts, 'appendEvent' | 'appendAudit' | 'tenantRecord' | 'configForTenant' | 'restoreExecutionOnlyInvalidatedAuthorization' | 'executionConfigForPlan' | 'getWhatsAppCustomers' | 'dependenciesReady' | 'supersedeAffectedBusinessState' | 'bindWeeklyViralLibraryToPackage' | 'buildBusinessSnapshot' | 'observeTaskProof' | 'approvalPreflight' | 'first' | 'applyPackageGrant' | 'createApproval' | 'prepareObserveBusinessResource' | 'prepareContentBatchPlan' | 'ensureContentBatchPlan' | 'executeInTaskBrowser' | 'sourceCollectionFailureReason' | 'completeReview'>) {
  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const restoreExecutionOnlyInvalidatedAuthorization: DigitalEmployeeApplicationPorts['restoreExecutionOnlyInvalidatedAuthorization'] = (...args) => deps.restoreExecutionOnlyInvalidatedAuthorization(...args);

  const executionConfigForPlan: DigitalEmployeeApplicationPorts['executionConfigForPlan'] = (...args) => deps.executionConfigForPlan(...args);

  const getWhatsAppCustomers: DigitalEmployeeApplicationPorts['getWhatsAppCustomers'] = (...args) => deps.getWhatsAppCustomers(...args);

  const dependenciesReady: DigitalEmployeeApplicationPorts['dependenciesReady'] = (...args) => deps.dependenciesReady(...args);

  const supersedeAffectedBusinessState: DigitalEmployeeApplicationPorts['supersedeAffectedBusinessState'] = (...args) => deps.supersedeAffectedBusinessState(...args);

  const bindWeeklyViralLibraryToPackage: DigitalEmployeeApplicationPorts['bindWeeklyViralLibraryToPackage'] = (...args) => deps.bindWeeklyViralLibraryToPackage(...args);

  const buildBusinessSnapshot: DigitalEmployeeApplicationPorts['buildBusinessSnapshot'] = (...args) => deps.buildBusinessSnapshot(...args);

  const observeTaskProof: DigitalEmployeeApplicationPorts['observeTaskProof'] = (...args) => deps.observeTaskProof(...args);

  const approvalPreflight: DigitalEmployeeApplicationPorts['approvalPreflight'] = (...args) => deps.approvalPreflight(...args);

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const applyPackageGrant: DigitalEmployeeApplicationPorts['applyPackageGrant'] = (...args) => deps.applyPackageGrant(...args);

  const createApproval: DigitalEmployeeApplicationPorts['createApproval'] = (...args) => deps.createApproval(...args);

  const prepareObserveBusinessResource: DigitalEmployeeApplicationPorts['prepareObserveBusinessResource'] = (...args) => deps.prepareObserveBusinessResource(...args);

  const prepareContentBatchPlan: DigitalEmployeeApplicationPorts['prepareContentBatchPlan'] = (...args) => deps.prepareContentBatchPlan(...args);

  const ensureContentBatchPlan: DigitalEmployeeApplicationPorts['ensureContentBatchPlan'] = (...args) => deps.ensureContentBatchPlan(...args);

  function executeInTaskBrowser<T>(input: { tenantId: string; run: RunRecord; task: TaskRecord }, label: string, action: () => Promise<T>): Promise<T> {
    return deps.executeInTaskBrowser<T>(input, label, action);
  }

  const sourceCollectionFailureReason: DigitalEmployeeApplicationPorts['sourceCollectionFailureReason'] = (...args) => deps.sourceCollectionFailureReason(...args);

  const completeReview: DigitalEmployeeApplicationPorts['completeReview'] = (...args) => deps.completeReview(...args);

  async function advanceRun(tenantId: string, runId: string): Promise<void> {
    await withDigitalEmployeeRunLock(tenantId, runId, () => advanceRunUnlocked(tenantId, runId));
  }

  const queuedRunAdvances = new Set<string>();

  function queueDigitalEmployeeRunAdvance(tenantId: string, runId: string): void {
    const key = `${tenantId}:${runId}`;
    if (queuedRunAdvances.has(key)) return;
    queuedRunAdvances.add(key);
    setImmediate(() => {
      void advanceRun(tenantId, runId)
        .catch(error => console.error(`[digital-employee-run] queued advance ${runId} failed:`, error instanceof Error ? error.message : error))
        .finally(() => queuedRunAdvances.delete(key));
    });
  }

  async function reconcileDigitalEmployeeRun(tenantId: string, runId: string): Promise<void> {
    await advanceRun(tenantId, runId);
  }

  async function migrateLegacyPublishingBindingsForRun(
    tenantId: string,
    run: RunRecord,
    plan: PlanRecord | null,
    tasks: TaskRecord[],
  ): Promise<boolean> {
    if (!plan) return false;
    const approvalTask = tasks.find(task => task.task_key === 'content_release_approval'
      && task.status === 'waiting_human'
      && jsonObject<Record<string, unknown>>(task.output, {}).dataStatus === 'preflight_blocked');
    if (!approvalTask) return false;
    const planBody = jsonObject<Record<string, unknown>>(plan.plan, {});
    const snapshot = normalizeDigitalEmployeeConfig(jsonObject(planBody.configSnapshot, {}));
    const targetPlatforms = publishingTargetPlatforms(snapshot.publishingTargets
      .filter(target => target.weeklyCount === undefined || Number(target.weeklyCount) > 0));
    if (!targetPlatforms.length) return false;
    const readiness = await readTenantPublishingReadiness(tenantId, true, targetPlatforms);
    if (!readiness.snapshot.ready) return false;
    const now = new Date().toISOString();
    const migration = migrateLegacyPublishingPlanAccountBindings(planBody, readiness.connectedAccounts, now);
    if (!migration.changed) return false;
    const updated = store.compareAndSwap
      ? await store.compareAndSwap(COLLECTION.plans, plan.id, { tenant_id: tenantId, goal_id: run.goal_id, plan: plan.plan }, { plan: migration.plan })
      : await store.update(COLLECTION.plans, plan.id, { plan: migration.plan });
    if (!updated) return false;
    plan.plan = migration.plan;
    const approvals = await store.list<ApprovalRecord>(COLLECTION.approvals, {
      where: { tenant_id: tenantId, task_id: approvalTask.id, status: 'pending' }, perPage: 100,
    });
    for (const approval of approvals.items) {
      await store.update(COLLECTION.approvals, approval.id, {
        status: 'superseded',
        decision_note: '发布账号已从历史本地占位记录迁移到真实连接，需要重新确认发布审批。',
        decided_at: now,
      });
    }
    const output = {
      ...jsonObject<Record<string, unknown>>(approvalTask.output, {}),
      dataStatus: 'preflight_retry',
      waitState: undefined,
      publishingAccountBindingMigration: { version: 1, migratedAt: now, replacements: migration.replacements },
    };
    await store.update(COLLECTION.tasks, approvalTask.id, {
      status: 'pending',
      task_version: Number(approvalTask.task_version || 1) + 1,
      output,
      blocked_reason: '',
      updated_at: now,
    });
    approvalTask.status = 'pending';
    approvalTask.task_version = Number(approvalTask.task_version || 1) + 1;
    approvalTask.output = output;
    approvalTask.blocked_reason = '';
    await appendEvent({
      tenantId,
      runId: run.id,
      taskId: approvalTask.id,
      type: 'publishing.account_bindings_migrated',
      level: 'warning',
      summary: '已将历史本地占位账号安全迁移到唯一真实连接，正在重新核验发布审批',
      payload: { replacements: migration.replacements, packageRevision: migration.plan.businessPackage?.revision },
    });
    await appendAudit({
      tenantId,
      userId: 'digital_employee_runtime',
      action: 'publishing.account_bindings_migrated',
      targetType: 'weekly_plan',
      targetId: plan.id,
      metadata: { runId: run.id, taskId: approvalTask.id, replacements: migration.replacements },
    });
    return true;
  }

  async function advanceRunUnlocked(tenantId: string, runId: string): Promise<void> {
    const run = await tenantRecord<RunRecord>(COLLECTION.runs, runId, tenantId);
    if (!run || ['paused', 'cancelled', 'failed'].includes(run.status)) return;
    const [goal, configRecord, plan, taskResult] = await Promise.all([
      tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId),
      configForTenant(tenantId),
      tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
    ]);
    const tenantConfig = publicConfig(configRecord);
    // Independent insertions own their production project and proof recovery.
    // Never feed them into batch dependency scopes or run paid batch work for them.
    const independentTasks = taskResult.items.filter(task => jsonObject<Record<string, unknown>>(task.output, {}).assistantIndependent);
    if (independentTasks.length) {
      const { recoverIndependentContentTask } = await import('../assistant/independentWeeklyContent.js');
      for (const task of independentTasks) {
        const projectId = String(jsonObject<Record<string, unknown>>(task.output, {}).projectId || '');
        const project = projectId ? await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', projectId, tenantId) : null;
        if (project) await recoverIndependentContentTask(store, tenantId, task as any, project as any);
      }
      taskResult.items = taskResult.items.filter(task => !independentTasks.includes(task));
    }
    if (!goal || !tenantConfig) throw new Error('run_context_missing');
    const recoverableApprovalFailure = taskResult.items.some(task => task.requires_approval
      && task.status === 'failed'
      && jsonObject<Record<string, unknown>>(task.output, {}).dataStatus === 'execution_failed');
    const reobservableUserInputWait = taskResult.items.some(task => ['waiting_external', 'waiting_human'].includes(task.status)
      && ['input', 'manual'].includes(String(jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(task.output, {}).waitState, {}).kind || '')));
    await restoreExecutionOnlyInvalidatedAuthorization(tenantId, goal, run, plan);
    if (run.status === 'waiting_human' && !recoverableApprovalFailure && !reobservableUserInputWait) return;
    await migrateLegacyPublishingBindingsForRun(tenantId, run, plan, taskResult.items);
    const config = executionConfigForPlan(plan, tenantConfig);
    const packageBody = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
    let businessPackage = packageBody.businessPackage as WeeklyPackage | undefined;
    let videoTask = businessPackage?.tasks.find(t => t.templateId === 'production');
    if (videoTask?.videoPlans) goal.scope = { ...jsonObject<Record<string, unknown>>(goal.scope, {}), description: goalInput(goal).scope, videoPlans: videoTask.videoPlans };
    let reopened = false;
    if (normalizeContinuationPolicy(config.continuationPolicy).newCustomers === 'reopen') {
      const criteria = { ...DEFAULT_FOLLOWUP_SEGMENT_CRITERIA, ...(businessPackage?.authorization.customerIds.length ? { includeCustomerIds: businessPackage.authorization.customerIds } : {}) };
      reopened = await reopenNoDataCustomerBranch({ tenantId, run, tasks: taskResult.items, startsAt: goal.starts_at, endsAt: goal.ends_at, customerIds: eligibleFollowupCustomerIds(await getWhatsAppCustomers(tenantId), criteria), onReopened: async customerIds => { await appendEvent({tenantId,runId:run.id,type:'customer.no_data_reopened',summary:`新增 ${customerIds.length} 位符合条件客户，重新生成分层与草稿，发送仍需审批`,payload:{customerIds,messagesSent:0}}); } });
    }
    if (run.status === 'succeeded' && !reopened) return;
    await store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'business', pause_reason: '' });
    let businessSnapshot: BusinessSnapshot | null = null;
    for (const task of taskResult.items) {
      // A content project can change after the worker recorded a terminal failure
      // (for example, after a successful retry with a new presenter/reference
      // version).  Do not leave the business workflow permanently owned by a
      // historical provider error when its linked draft is newer than the task.
      if (task.task_key === 'content_production' && task.status === 'failed') {
        const refs = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []);
        const projectIds = refs.filter(ref => ref.type === 'studio_project').map(ref => String(ref.id || '')).filter(Boolean);
        const projects = await Promise.all(projectIds.map(id => tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', id, tenantId)));
        const taskUpdatedAt = Date.parse(String((task as any).updated || task.updated_at || (task as any).created || task.created_at || '')) || 0;
        const superseded = projects.some(project => project && String(project.status) === 'draft'
          && (Date.parse(String((project as any).updated || project.updated_at || (project as any).created || project.created_at || '')) || 0) > taskUpdatedAt);
        if (superseded) {
          const output = { ...jsonObject<Record<string, unknown>>(task.output, {}), dataStatus: 'reconciled',
            executionFailure: undefined, waitState: undefined, reconciledAt: new Date().toISOString() };
          await store.update(COLLECTION.tasks, task.id, { status: 'pending', output, blocked_reason: '', updated_at: new Date().toISOString() });
          task.status = 'pending'; task.output = output; task.blocked_reason = '';
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.failure_superseded', level: 'success', summary: '制作草稿已有新版本，已撤销历史失败并重新核验' });
        }
      }
      // Approval nodes only prepare an immutable review package; they do not
      // perform the external effect. A historical preflight/package exception
      // is safe to re-observe after its inputs or validation logic changes.
      // Explicit user rejection does not carry execution_failed and remains
      // terminal.
      if (task.requires_approval && task.status === 'failed'
        && jsonObject<Record<string, unknown>>(task.output, {}).dataStatus === 'execution_failed') {
        const output = {
          ...jsonObject<Record<string, unknown>>(task.output, {}),
          dataStatus: 'preflight_retry',
          executionFailure: undefined,
          waitState: undefined,
          retriedAt: new Date().toISOString(),
        };
        await store.update(COLLECTION.tasks, task.id, {
          status: 'pending', output, blocked_reason: '', updated_at: new Date().toISOString(),
        });
        task.status = 'pending'; task.output = output; task.blocked_reason = '';
        await appendEvent({
          tenantId, runId: run.id, taskId: task.id, type: 'approval.preflight_retry', level: 'info',
          summary: `${task.title}：重新核验审批前置条件`,
        });
      }
      const dependencyStateReady = dependenciesReady(task, taskResult.items);
      if (mustInvalidateContentDownstream(task.task_key, task.status, dependencyStateReady)) {
        const affected = downstreamTasks(taskResult.items, task, true)
          .filter(item => mustInvalidateContentDownstream(item.task_key, item.status, false));
        const now = new Date().toISOString();
        await supersedeAffectedBusinessState(tenantId, run, affected, now);
        for (const item of affected) {
          const output = { ...jsonObject<Record<string, unknown>>(item.output, {}), dataStatus: 'dependency_pending', waitState: undefined, invalidatedAt: now };
          await store.update(COLLECTION.tasks, item.id, { status: 'pending', output, business_refs: [], blocked_reason: '', updated_at: now });
          item.status = 'pending'; item.output = output; item.business_refs = []; item.blocked_reason = '';
        }
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.downstream_invalidated', level: 'warning', summary: `${task.title}：上游证据失效，已停止并回退 ${affected.length} 个下游节点`, payload: { affectedTaskIds: affected.map(item => item.id) } });
        continue;
      }
      if (['succeeded', 'skipped', 'cancelled', 'handed_off'].includes(task.status)
        && !mustReobserveSucceededCollection(task.task_key, task.status)) continue;
      if (task.status === 'failed' && !jsonObject<Record<string, any>>(task.output, {}).executionFailure?.retryAt) continue;
      if (!dependencyStateReady) {
        // A previously observed downstream wait is stale when an upstream proof
        // is later downgraded (for example, a scheduled collection whose real
        // provider run finished failed). Return it to dependency-pending so the
        // actual upstream failure remains the primary card and pause reason.
        if (['waiting_external', 'waiting_human', 'waiting_approval'].includes(task.status)) {
          const output = { ...jsonObject<Record<string, unknown>>(task.output, {}), dataStatus: 'dependency_pending', waitState: undefined };
          await store.update(COLLECTION.tasks, task.id, { status: 'pending', output, blocked_reason: '', updated_at: new Date().toISOString() });
          task.status = 'pending'; task.output = output; task.blocked_reason = '';
        }
        continue;
      }
      if (task.task_key.startsWith('review_todo_')) {
        const reason = '请按本任务的执行要求完成业务操作，并提交验收记录；尚未自动完成。';
        await store.update(COLLECTION.tasks, task.id, { status: 'waiting_human', blocked_reason: reason, output: { waitState: { kind: 'manual', message: reason, requiresAttention: true } }, updated_at: new Date().toISOString() });
        task.status = 'waiting_human';
        continue;
      }
      const metadata = taskExecutionMetadata(task, plan);
      const previousFailure = jsonObject<Record<string, unknown>>(task.output, {}).executionFailure as TaskFailure | undefined;
      if (!taskRetryDue(previousFailure)) continue;
      try {
        // Inventory is checked before any crawler is created. A reference is
        // reusable when it is tenant-owned, production-ready and bound one-to-one
        // to this week's clone videos. A prior week does not permanently consume
        // the reference; only duplicate use inside this week is rejected.
        if (task.task_key === 'scheduled_source_collection' && videoTask?.videoPlans?.length) {
          const rebound = await bindWeeklyViralLibraryToPackage({ tenantId, run, goal, plan, config, pack: businessPackage! });
          businessPackage = rebound.pack;
          packageBody.businessPackage = rebound.pack;
          videoTask = rebound.pack.tasks.find(item => item.templateId === 'production');
          if (videoTask?.videoPlans) goal.scope = { ...jsonObject<Record<string, unknown>>(goal.scope, {}), description: goalInput(goal).scope, videoPlans: videoTask.videoPlans };
          const inventory = rebound.inventory;
          const inventoryPreflight = {
            requiredCount: inventory.requiredCount,
            reusableCount: inventory.reusableCount,
            missingCount: inventory.missingCount,
            selectedReferenceIds: inventory.selectedReferenceIds,
            checkedAt: new Date().toISOString(),
            source: 'tenant_viral_library_exact_analysis_minus_prior_production_handoffs',
          };
          if (inventory.ready) {
            const refs = inventory.selectedReferenceIds.map(id => ({ type: 'trend_video', id, reuse: 'unused_exact_library' }));
            const output = { dataStatus: 'not_required', summary: `爆款库已有 ${inventory.reusableCount} 条未使用且完成精确分析的参考，本周已直接锁定，无需重新采集。`, inventoryPreflight, referenceIds: inventory.selectedReferenceIds };
            await store.update(COLLECTION.tasks, task.id, { status: 'skipped', output, business_refs: refs, blocked_reason: '', updated_at: new Date().toISOString() });
            task.status = 'skipped'; task.output = output; task.business_refs = refs; task.blocked_reason = '';
            await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.inventory_reused', summary: output.summary, payload: inventoryPreflight });
            continue;
          }
          const previousOutput = jsonObject<Record<string, unknown>>(task.output, {});
          const summary = inventory.requiredCount
            ? `爆款库可直接使用 ${inventory.reusableCount}/${inventory.requiredCount} 条，还缺 ${inventory.missingCount} 条；只采集并分析缺口。`
            : '本周计划没有需要爆款参考的独立视频；将按已确认的社媒采集目标继续。';
          task.output = { ...previousOutput, inventoryPreflight, inventorySummary: summary };
          await store.update(COLLECTION.tasks, task.id, { output: task.output, updated_at: new Date().toISOString() });
        }
        if (task.task_key === 'viral_analysis' && videoTask?.videoPlans?.length && videoTask.videoPlans.every(video => video.route !== 'clone')) {
          const output = { dataStatus: 'not_required', summary: '本轮视频均未指定爆款裂变，无需等待参考分析。' };
          await store.update(COLLECTION.tasks, task.id, { status: 'skipped', output, blocked_reason: '', updated_at: new Date().toISOString() });
          task.status = 'skipped'; task.output = output; task.blocked_reason = '';
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.not_required', summary: output.summary });
          continue;
        }
        const emptyCustomerUpstream = ['followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'].includes(task.task_key)
          && taskResult.items.some(item => ['customer_segmentation', 'followup_batch_draft'].includes(item.task_key)
            && jsonObject<Record<string, unknown>>(item.output, {}).dataStatus === 'no_data');
        if (emptyCustomerUpstream) {
          const output = { dataStatus: 'no_data', summary: '暂无符合条件的客户，本轮不生成或发送跟进任务。', messagesSent: 0 };
          await store.update(COLLECTION.tasks, task.id, { status: 'skipped', output, blocked_reason: '', updated_at: new Date().toISOString() });
          task.status = 'skipped'; task.output = output; task.blocked_reason = '';
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.no_data', summary: `${task.title}：暂无符合条件的客户`, payload: output });
          continue;
        }
        if (task.owner_id && ['context_readiness', 'scheduled_source_collection', 'viral_analysis', 'content_production', 'customer_segmentation', 'followup_batch_draft'].includes(task.task_key)) {
          businessSnapshot ||= await buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
          const observation = task.task_key === 'context_readiness'
            ? { ready: businessSnapshot.readiness.some(item => item.key === 'enterprise' && item.status === 'ready'), businessRefs: [], proof: {} }
            : await observeTaskProof(tenantId, run, task, businessSnapshot, taskResult.items);
          task.status = observation.ready ? 'succeeded' : 'waiting_external';
          task.blocked_reason = observation.ready ? '' : ('blockedReason' in observation && observation.blockedReason
            ? String(observation.blockedReason)
            : `等待 ${packageTaskForKey(businessPackage, task.task_key)?.ownerName || '指定成员'} 在业务工作台完成`);
          await store.update(COLLECTION.tasks, task.id, { status: task.status, blocked_reason: task.blocked_reason, output: { proof: observation.proof, assignedMember: task.owner_id }, ...(observation.businessRefs.length ? { business_refs: observation.businessRefs } : {}), updated_at: new Date().toISOString() });
          continue;
        }
        if (
          metadata.executionMode !== 'approval'
          && !metadata.automaticExecutionAllowed
          && !hasSucceededApprovalAncestor(task, taskResult.items)
        ) {
          const reason = '当前自主等级不允许自动执行此动作，请人工完成或调整配置后用于下一期计划。';
          const output = {
            ...buildTaskOutput(task.task_key, goalInput(goal), config),
            dataStatus: 'autonomy_blocked',
            autonomyMode: config.autonomyMode,
            policySource: metadata.policySource,
            waitState: waitState('input', reason),
            availableActions: availableTaskActions(task),
          };
          await store.update(COLLECTION.tasks, task.id, { status: 'waiting_human', output, blocked_reason: reason, updated_at: new Date().toISOString() });
          if (task.status !== 'waiting_human' || task.blocked_reason !== reason) {
            await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'policy.autonomy_blocked', level: 'warning', summary: `${task.title}：${reason}`, payload: { autonomyMode: config.autonomyMode, externalEffect: metadata.externalEffect, policySource: metadata.policySource } });
          }
          task.status = 'waiting_human';
          task.output = output;
          task.blocked_reason = reason;
          continue;
        }
        if (metadata.executionMode === 'approval') {
          businessSnapshot ||= await buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
          const preflight = await approvalPreflight(tenantId, run, task, taskResult.items, businessSnapshot);
          if (!preflight.ready) {
            const existingApproval = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, task_id: task.id });
            if (existingApproval?.status === 'pending') {
              await store.update(COLLECTION.approvals, existingApproval.id, { status: 'superseded', decision_note: preflight.reason, decided_at: new Date().toISOString() });
            }
            const output = {
              ...buildTaskOutput(task.task_key, goalInput(goal), config),
              dataStatus: 'preflight_blocked',
              preflight,
              waitState: waitState('input', preflight.reason),
              availableActions: availableTaskActions(task),
            };
            await store.update(COLLECTION.tasks, task.id, {
              status: 'waiting_human', output, business_refs: preflight.businessRefs, blocked_reason: preflight.reason, updated_at: new Date().toISOString(),
            });
            if (task.status !== 'waiting_human' || task.blocked_reason !== preflight.reason) {
              await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.preflight_blocked', level: 'warning', summary: `${task.title}：${preflight.reason}`, payload: { checks: preflight.checks, businessRefs: preflight.businessRefs, destination: metadata.destination } });
            }
            task.status = 'waiting_human';
            task.output = output;
            task.business_refs = preflight.businessRefs;
            task.blocked_reason = preflight.reason;
            continue;
          }
          if (task.requires_approval && !task.owner_id && await applyPackageGrant(tenantId, goal, run, task, taskResult.items, plan)) {
            task.status = 'succeeded'; task.blocked_reason = ''; continue;
          }
          if (task.requires_approval) {
            const approval = await createApproval(tenantId, goal, run, task, taskResult.items);
            await store.update(COLLECTION.tasks, task.id, { status: 'waiting_approval', business_refs: preflight.businessRefs, blocked_reason: '等待负责人审批', updated_at: new Date().toISOString() });
            if (task.status !== 'waiting_approval') {
              await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.requested', level: 'warning', summary: `${task.title}：资源预检通过，已进入人工审批`, payload: { approvalId: approval.id, riskLevel: approval.risk_level, subjectVersion: approval.subject_version, contentHash: approval.content_hash, checks: preflight.checks } });
            }
            task.status = 'waiting_approval';
            task.blocked_reason = '等待负责人审批';
            task.business_refs = preflight.businessRefs;
            continue;
          }
        }
        if (metadata.executionMode === 'observe' || metadata.executionMode === 'draft_executor') {
          businessSnapshot ||= await buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
          if (task.task_key === 'viral_analysis' && businessPackage && videoTask?.videoPlans?.length) {
            const rebound = await bindWeeklyViralLibraryToPackage({ tenantId, run, goal, plan, config, pack: businessPackage });
            businessPackage = rebound.pack;
            packageBody.businessPackage = rebound.pack;
            videoTask = rebound.pack.tasks.find(item => item.templateId === 'production');
            if (videoTask?.videoPlans) goal.scope = { ...jsonObject<Record<string, unknown>>(goal.scope, {}), description: goalInput(goal).scope, videoPlans: videoTask.videoPlans };
          }
          const createdResource = task.task_key === 'customer_segmentation' && businessSnapshot.customer.total.value === 0 ? false : metadata.executionMode === 'draft_executor'
            ? await prepareObserveBusinessResource({ tenantId, goal, run, task, config, snapshot: businessSnapshot })
            : await prepareObserveBusinessResource({ tenantId, goal, run, task, config, snapshot: businessSnapshot });
          if (createdResource) businessSnapshot = await buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
          const observation = await observeTaskProof(tenantId, run, task, businessSnapshot, taskResult.items);
          if (task.task_key === 'scheduled_source_collection'
            && 'collectionState' in observation && observation.collectionState === 'failed') {
            throw new Error(`scheduled_source_collection_result_failed: ${String('blockedReason' in observation ? observation.blockedReason : '平台采集未返回可用内容')}`);
          }
          const canonicalBusinessRefs = observation.businessRefs.length
            ? observation.businessRefs
            : jsonObject<Record<string, unknown>[]>(task.business_refs, []);
          const baseOutput = buildTaskOutput(task.task_key, goalInput(goal), config);
          const followupWorker = task.task_key === 'followup_dispatch'
            ? await getTenantFollowupDispatchStatus(tenantId)
            : null;
          const followupWorkerMode = followupWorker?.authorization.scheduledFollowupSendAllowed ? 'scheduled' : 'manual_only';
          const noCustomerData = task.task_key === 'customer_attribution' && !observation.ready
            || task.task_key === 'customer_segmentation' && (businessSnapshot.customer.total.value === 0
              || observation.ready && observation.businessRefs.length > 0 && observation.businessRefs.every(ref => 'memberCount' in ref && Number(ref.memberCount) === 0));
          if (noCustomerData) {
            const output = { ...baseOutput, dataStatus: 'no_data', summary: '暂无符合条件的客户，本轮继续其他任务。', proof: observation.proof, messagesSent: 0 };
            await store.update(COLLECTION.tasks, task.id, { status: 'skipped', output, business_refs: canonicalBusinessRefs, blocked_reason: '', updated_at: new Date().toISOString() });
            task.status = 'skipped'; task.output = output; task.blocked_reason = '';
            await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.no_data', summary: `${task.title}：暂无符合条件的客户`, payload: output });
            continue;
          }
          const output: Record<string, unknown> = {
            ...baseOutput,
            dataStatus: observation.ready ? 'verified' : 'waiting_external',
            observedAt: businessSnapshot.generatedAt,
            proof: observation.proof,
            businessRefs: canonicalBusinessRefs,
            availableActions: observation.ready ? [] : availableTaskActions(task),
            ...(task.task_key === 'platform_publish' ? { externalPublishPerformed: observation.ready } : {}),
            ...(task.task_key === 'followup_dispatch' ? {
              messagesSent: Number(observation.proof.value || 0),
              bulkWorkerStatus: observation.ready ? 'receipt_observed' : followupWorkerMode,
              messagingAuthorization: followupWorker?.authorization,
              dispatchPreflight: 'dispatchPreflight' in observation ? observation.dispatchPreflight : null,
            } : {}),
          };
          if (!observation.ready) {
            let diagnostic = 'waitState' in observation ? observation.waitState : undefined;
            const reason = 'blockedReason' in observation ? String(observation.blockedReason || '') : '';
            if (!diagnostic && task.task_key === 'viral_analysis') {
              const scope = taskScope(task, taskResult.items);
              const videos = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
              const scopedVideos = videos.items.filter(item => recordBelongsToTask(item, run, scope));
              const jobs = await store.list<StoredRecord>('crawl_jobs', { where: { tenantId }, perPage: 500 });
              const scopedJobs = jobs.items.filter(job => [...scope.refIds].some(id => String(job.requestedBy || '').startsWith(`scheduler:${id}:run:`)));
              diagnostic = scopedVideos.length
                ? analysisWait(scopedVideos)
                : collectionWait(scopedJobs);
            }
            if (!diagnostic && ['content_production', 'content_quality_gate'].includes(task.task_key)) {
              diagnostic = reason ? waitState('input', reason) : waitState('processing', '内容任务正在推进，等待制作或质检结果回写。');
            }
            if (!diagnostic && task.task_key === 'customer_segmentation' && !Number(businessSnapshot.customer.total.value || 0)) {
              diagnostic = waitState('data', '当前没有客户数据，尚不能生成客户分层。');
            }
            if (!diagnostic && task.task_key === 'followup_dispatch' && 'dispatchPreflight' in observation) {
              const preflight = observation.dispatchPreflight;
              const itemWait = 'followupWaitState' in observation ? observation.followupWaitState : null;
              diagnostic = itemWait && ['service', 'input', 'manual'].includes(itemWait.kind) ? itemWait : preflight && preflight.authorized && preflight.batchApproved && !preflight.blocked && !Object.keys(preflight.blockers).length
                ? waitState(preflight.future > 0 ? 'scheduled' : 'processing', reason)
                : waitState('manual', reason);
            }
            diagnostic ||= basicTaskWait(task.task_key, reason || (task.task_key === 'customer_segmentation' ? `等待客户跟进节奏到期：${config.followupCadence}` : ''));
            output.waitState = diagnostic;
            const observedBlocker = 'blockedReason' in observation ? String(observation.blockedReason || '').trim() : '';
            const blockedReason = diagnostic.message || observedBlocker || (task.task_key === 'customer_segmentation'
              ? `等待客户跟进节奏到期：${config.followupCadence}`
              : task.task_key === 'followup_dispatch'
                ? '真实发送预检：尚未取得可核验的发送条件或渠道回执'
                : `等待真实业务结果，请前往「${destinationLabel(metadata.destination)}」完成或检查该节点`);
            const waitStatus = workflowStatusForWait(diagnostic);
            if (waitStatus === 'waiting_human') output.dataStatus = 'input_required';
            const taskUpdate = { status: waitStatus, output, business_refs: canonicalBusinessRefs, blocked_reason: blockedReason, updated_at: new Date().toISOString() };
            await Promise.all([
              store.update(COLLECTION.tasks, task.id, taskUpdate),
              store.update(COLLECTION.runs, run.id, { status: waitStatus, current_controller: waitStatus === 'waiting_external' ? 'agent' : 'human', pause_reason: blockedReason }),
            ]);
            if (task.status !== taskUpdate.status) {
              await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: waitStatus === 'waiting_human' ? 'task.input_required' : waitStatus === 'waiting_approval' ? 'approval.requested' : 'task.waiting_external', level: 'warning', summary: waitStatus === 'waiting_human' ? `${task.title}：${blockedReason}` : waitStatus === 'waiting_approval' ? `${task.title}：等待负责人审批` : `${task.title}：等待业务工作台真实回写`, payload: { destination: metadata.destination, statusSource: metadata.statusSource, proof: observation.proof, businessRefs: canonicalBusinessRefs } });
            }
            task.status = taskUpdate.status;
            task.output = output;
            task.business_refs = canonicalBusinessRefs;
            task.blocked_reason = blockedReason;
            continue;
          }
          if (task.status !== 'running') {
            await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: task.status === 'waiting_external' ? 'task.reconciled' : 'task.started', summary: `${task.agent_role} Agent 核验：${task.title}`, payload: { statusSource: metadata.statusSource } });
          }
          await store.update(COLLECTION.tasks, task.id, { status: 'succeeded', output, business_refs: canonicalBusinessRefs, blocked_reason: '', updated_at: new Date().toISOString() });
          task.status = 'succeeded';
          task.output = output;
          task.business_refs = canonicalBusinessRefs;
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.completed', level: 'success', summary: `${task.title} 已由真实业务数据验证`, payload: { proof: observation.proof, businessRefs: canonicalBusinessRefs } });
          continue;
        }
        if (task.task_key === 'content_mode_routing') {
          const input = { tenantId, goal, run, task, plan, config };
          // Reconciliation checks readiness without clicking or rewriting a blocked batch.
          const prepared = await prepareContentBatchPlan(input);
          if (prepared.draft.status === 'blocked') {
            const reason = prepared.draft.blocker || '内容生产条件尚未满足';
            const previous = jsonObject<Record<string, unknown>>(task.output, {});
            const priorCheck = jsonObject<Record<string, unknown>>(previous.routingCheck, {});
            const sameWait = task.status === 'waiting_human' && priorCheck.reason === reason;
            const checks = sameWait ? Number(priorCheck.count || 0) + 1 : 1;
            const output = { ...previous, dataStatus: 'blocked', routingCheck: { reason, count: checks, checkedAt: new Date().toISOString() }, waitState: { kind: 'input', message: reason, requiresAttention: true } };
            await store.update(COLLECTION.tasks, task.id, { status: 'waiting_human', output, blocked_reason: reason, updated_at: new Date().toISOString() });
            task.status = 'waiting_human'; task.output = output; task.blocked_reason = reason;
            if (!sameWait) await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.routing_waiting', level: 'warning', summary: `等待内容生产条件：${reason}` });
            continue;
          }
          const batch = prepared.existing?.status === 'planned'
            ? await ensureContentBatchPlan(input, prepared)
            : await executeInTaskBrowser({ tenantId, run, task }, '生成内容制作订单', () => ensureContentBatchPlan(input, prepared));
          const refs = [{ type: 'content_batch_plan', id: batch.record.id, orderCount: batch.draft.orders.length }, ...batch.draft.orders.map(order => ({ type: 'content_order', id: order.id, batchPlanId: batch.record.id, route: order.route, platform: order.platform, productId: order.productId }))];
          const output = { ...buildTaskOutput(task.task_key, goalInput(goal), config), batchPlanId: batch.record.id, orders: batch.draft.orders, coverage: batch.draft.coverage, routing: { eligibleRoutes: batch.draft.eligibleRoutes, disabledRoutes: batch.draft.disabledRoutes }, dataStatus: batch.draft.status };
          if (batch.draft.status === 'blocked') {
            const blocker = batch.draft.blocker || '内容生产条件尚未满足';
            const blockedOutput = { ...output, waitState: waitState('input', blocker), dataStatus: 'input_required' };
            await Promise.all([
              store.update(COLLECTION.tasks, task.id, { status: 'waiting_human', output: blockedOutput, business_refs: refs, blocked_reason: blocker, updated_at: new Date().toISOString() }),
              store.update(COLLECTION.runs, run.id, { status: 'waiting_human', current_controller: 'human', pause_reason: blocker }),
            ]);
            task.status = 'waiting_human'; task.output = blockedOutput; task.business_refs = refs; task.blocked_reason = blocker;
            continue;
          }
          await store.update(COLLECTION.tasks, task.id, { status: 'succeeded', output, business_refs: refs, blocked_reason: '', updated_at: new Date().toISOString() });
          task.status = 'succeeded'; task.output = output; task.business_refs = refs;
          if (batch.created) await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'content.batch_plan.created', level: 'success', summary: `已生成 ${batch.draft.orders.length} 条可追溯内容订单`, payload: { batchPlanId: batch.record.id, businessRefs: refs } });
          continue;
        }
        await store.update(COLLECTION.tasks, task.id, { status: 'running', updated_at: new Date().toISOString() });
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.started', summary: `${task.agent_role} Agent 开始：${task.title}` });
        let output = buildTaskOutput(task.task_key, goalInput(goal), config);
        if (task.task_key === 'goal_decomposition' && businessPackage?.directorPlan) {
          const director = businessPackage.directorPlan;
          output = { ...output, directorBrief: { packageRevision: businessPackage.revision, productionBudget: director.productionBudget, paidMediaBudget: director.paidMediaBudget, productionSpent: director.productionSpent, productionReserved: director.productionReserved, originalTarget: director.originalTarget, platformVersionTarget: director.platformVersionTarget, publishTarget: director.publishTarget, collectionBrief: director.collectionBrief, qualityStandard: director.qualityStandard, autonomyMode: config.autonomyMode } };
        }
        if (metadata.executionMode === 'approval' && !task.requires_approval) {
          if (task.task_key === 'followup_batch_approval') {
            const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
            if (batch) await applyFollowupBatchDecision({ tenantId, batchId: batch.id, decision: 'approved', userId: 'approval_policy', approvalId: '' });
          }
          output = { ...output, approvalSkippedByPolicy: true, policyVerifiedAt: new Date().toISOString() };
        }
        await store.update(COLLECTION.tasks, task.id, { status: 'succeeded', output, blocked_reason: '', updated_at: new Date().toISOString() });
        task.status = 'succeeded';
        task.output = output;
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.completed', level: 'success', summary: `${task.title} 已完成`, payload: { output } });
      } catch (error) {
        // A failed step must not abort independent branches in the same run.
        // Do not automatically repeat uncertain writes or external effects.
        const safeToRetry = task.task_key === 'scheduled_source_collection'
          ? scheduledCollectionFailureCanRetry(error)
          : metadata.externalEffect === 'none' && metadata.executionMode !== 'draft_executor';
        const failure = nextTaskFailure(previousFailure, safeToRetry);
        const failed = productionFailureState(error, failure.retryAt);
        const reason = task.task_key === 'scheduled_source_collection' ? sourceCollectionFailureReason(error) : failed.reason;
        const output = { ...jsonObject<Record<string, unknown>>(task.output, {}), dataStatus: 'execution_failed', executionFailure: failure, waitState: waitState(failed.kind, reason), availableActions: availableTaskActions(task) };
        await store.update(COLLECTION.tasks, task.id, { status: failed.status, output, blocked_reason: reason, updated_at: new Date().toISOString() });
        task.status = failed.status; task.output = output; task.blocked_reason = reason;
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.execution_failed', level: 'error', summary: `${task.title}：执行异常`, payload: { attempts: failure.attempts, retryAt: failure.retryAt, error: error instanceof Error ? error.message.slice(0, 500) : 'task_execution_failed' } });
      }
    }
    const remaining = taskResult.items.filter(task => !['succeeded', 'skipped'].includes(task.status));  if (remaining.length) {
      const handedOff = remaining.find(task => task.status === 'handed_off');
      const waitingApproval = remaining.find(task => task.status === 'waiting_approval');
      const directBlocks = remaining.filter(task => ['waiting_external', 'waiting_approval', 'waiting_human', 'handed_off', 'failed', 'cancelled'].includes(task.status));
      const dependencyBlocks = remaining
        .filter(task => task.status === 'pending')
        .map(task => {
          const upstream = jsonObject<string[]>(task.depends_on, []).filter(key => {
            const dependency = taskResult.items.find(item => item.task_key === key);
            return !dependency || !['succeeded', 'skipped'].includes(dependency.status);
          });
          return upstream.length ? `${task.title}等待：${upstream.join('、')}` : `${task.title}待执行`;
        });
      const reasons = [...new Set([
        ...directBlocks.map(task => task.blocked_reason || `${task.title}：${task.status}`),
        ...dependencyBlocks,
      ])];
      const failedTask = remaining.find(task => task.status === 'failed' && !jsonObject<Record<string, any>>(task.output, {}).executionFailure?.retryAt);
      const needsHumanInput = remaining.find(task => ['waiting_external', 'waiting_human'].includes(task.status)
        && ['input', 'manual'].includes(String(jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(task.output, {}).waitState, {}).kind || '')));
      const status = handedOff || failedTask || needsHumanInput ? 'waiting_human' : waitingApproval ? 'waiting_approval' : 'waiting_external';
      await store.update(COLLECTION.runs, run.id, {
        status,
        current_controller: handedOff || failedTask || needsHumanInput || waitingApproval ? 'human' : 'agent',
        pause_reason: reasons.slice(0, 6).join('；'),
      });
      return;
    }
    await completeReview(tenantId, goal, run, taskResult.items);
    const completedAt = new Date().toISOString();
    await Promise.all([
      store.update(COLLECTION.runs, run.id, { status: 'succeeded', current_controller: 'agent', completed_at: completedAt }),
      store.update(COLLECTION.goals, goal.id, { status: 'completed', updated_at: completedAt }),
    ]);
    await appendEvent({ tenantId, runId: run.id, type: 'workflow.completed', level: 'success', summary: '本周最小闭环已完成，周复盘已生成' });
  }

  return { advanceRun, queueDigitalEmployeeRunAdvance, reconcileDigitalEmployeeRun };
}
