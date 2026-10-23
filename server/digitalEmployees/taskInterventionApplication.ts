import type { DataStore } from '../storage/datastore.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type ConfigRecord, type CorrectionRecord, type EventRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';
import { type DigitalEmployeeConfig, buildTaskOutput, buildWeeklyPlan } from './domain.js';
import { goalInput, publicConfig } from './overviewProjection.js';
import type { buildBusinessSnapshot, BusinessSnapshot } from './businessSnapshot.js';
import type { readAuthorizedWhatsAppCustomers as getWhatsAppCustomers } from '../whatsapp/authorizedCustomerRead.js';
import { withDigitalEmployeeRunLock } from './runControl.js';
import { compilePackage, packageTaskForKey } from './weeklyPackage.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { taskCorrectionInvalidatesWeeklyAuthorization, directorDecisionInvalidatesWeeklyAuthorization } from './weeklyAuthorizationInvalidation.js';
import { viralCoverageBypassAllowed } from './viralAnalysisCoverage.js';
import { downstreamTasks, irreversibleEffects } from './taskCorrectionSafety.js';
import { followupRunHasExternalReceipt } from './customerWorkflow.js';
import { invalidatePublishingAuthorizationForRun } from './publishingExecution.js';
import { resumeContentExecutionJobsForRun } from '../contentExecution/durableQueue.js';
import { applyDirectorDecision, DIRECTOR_DECISION_LABELS, DIRECTOR_REASON_LABELS, type DirectorDecision, type DirectorDecisionReason } from '../../src/lib/directorDecision.js';

export type TaskControlAction = 'retry' | 'skip' | 'manual_complete' | 'replan';
export class TaskControlError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
export interface TaskInterventionDependencies {
  store: DataStore;
  tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null>;
  first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T | null>;
  requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T>;
  configForTenant(tenantId: string): Promise<ConfigRecord | null>;
  executionConfigForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig;
  buildBusinessSnapshot: typeof buildBusinessSnapshot;
  getWhatsAppCustomers: typeof getWhatsAppCustomers;
  observeTaskProof(tenantId: string, run: RunRecord, task: TaskRecord, snapshot: BusinessSnapshot, tasks: TaskRecord[]): Promise<{ ready: boolean; proof: Record<string, unknown>; businessRefs: Array<Record<string, unknown>> }>;
  advanceRun(tenantId: string, runId: string): Promise<void>;
  supersedeAffectedBusinessState(tenantId: string, run: RunRecord, affected: TaskRecord[], now: string): Promise<void>;
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
  appendAuthorizationRequiredEvent(input: {
    tenantId: string;
    runId: string;
    taskId?: string;
    reason: 'content_changed' | 'package_adjusted' | 'critical_business_change';
    changedFields?: string[];
  }): Promise<void>;
}

/** Shared application authority for Web, assistant decisions and mobile retries. */
export function createTaskInterventionApplication(deps: TaskInterventionDependencies) {
  const { store, tenantRecord, first, requiredCreate, configForTenant, executionConfigForPlan,
    buildBusinessSnapshot, getWhatsAppCustomers, observeTaskProof, advanceRun,
    appendEvent, appendAudit, appendAuthorizationRequiredEvent, supersedeAffectedBusinessState } = deps;
  async function applyTaskControl(input: {
    tenantId: string;
    userId: string;
    taskId: string;
    action: TaskControlAction;
    scope: 'one_off' | 'rule_candidate';
    instruction: string;
    rerunDownstream: boolean;
    output?: Record<string, unknown>;
    businessRefs?: Array<Record<string, unknown>>;
    enabledWorkflows?: DigitalEmployeeConfig['enabledWorkflows'];
    expectedTaskVersion?: string;
  }): Promise<{ runId: string; goalId: string }> {
    const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, input.tenantId);
    if (!initialTask) throw new TaskControlError(404, 'task_not_found');
    return withDigitalEmployeeRunLock(input.tenantId, initialTask.run_id, async () => {
      const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, input.tenantId);
      if (!task) throw new TaskControlError(404, 'task_not_found');
      if (input.expectedTaskVersion !== undefined
        && String(task.task_version ?? task.updated_at ?? '').trim() !== input.expectedTaskVersion) {
        throw new TaskControlError(409, 'task_version_conflict');
      }
      const [run, goal, plan, configRecord, allTasks] = await Promise.all([
        tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, input.tenantId),
        tenantRecord<GoalRecord>(COLLECTION.goals, task.goal_id, input.tenantId),
        tenantRecord<PlanRecord>(COLLECTION.plans, task.plan_id, input.tenantId),
        configForTenant(input.tenantId),
        store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: input.tenantId, run_id: task.run_id }, sort: 'sequence', perPage: 100 }),
      ]);
      const tenantConfig = publicConfig(configRecord);
      if (!run || !goal || !plan || !tenantConfig) throw new TaskControlError(409, 'correction_context_missing');
      const config = executionConfigForPlan(plan, tenantConfig);
      const validatedInputRefs: Array<Record<string, unknown>> = [];
      for (const ref of input.businessRefs || []) {
        const validated = await canonicalEvidenceRef(input.tenantId, ref);
        if (!validated) throw new TaskControlError(400, 'evidence_reference_invalid', { message: '证据必须引用当前租户内已存在的业务记录。' });
        validatedInputRefs.push(validated);
      }
      if (run.status === 'cancelled') throw new TaskControlError(409, 'run_cancelled', { message: '已取消的运行不能再纠偏。' });
      const resumePausedRun = run.status === 'paused' && ['retry', 'replan'].includes(input.action);
      if (run.status === 'paused' && !resumePausedRun) throw new TaskControlError(409, 'run_controlled_by_human', { message: '请先恢复运行。' });
      if (allTasks.items.some(item => item.id === task.id && item.status === 'handed_off')) {
        throw new TaskControlError(409, 'task_handed_off', { message: '请先将人工接管任务交还数字员工。' });
      }
      if (input.action === 'manual_complete' && task.execution_mode === 'approval') {
        throw new TaskControlError(409, 'approval_decision_required', { message: '审批节点必须通过正式审批接口决策，不能用人工完成绕过。' });
      }
      if (task.task_key === 'viral_analysis' && ['skip', 'manual_complete'].includes(input.action)) {
        const snapshot = await buildBusinessSnapshot(input.tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
        const coverage = await observeTaskProof(input.tenantId, run, task, snapshot, allTasks.items);
        if (!viralCoverageBypassAllowed(task.task_key, input.action, coverage.ready)) {
          throw new TaskControlError(409, 'viral_analysis_exact_coverage_required', {
            message: '本周复刻独立制作视频的精确分析尚未覆盖完整，不能跳过或人工完成该节点。',
            proof: coverage.proof,
          });
        }
      }
      const downstream = downstreamTasks(allTasks.items, task, input.rerunDownstream);
      const replanConfig = input.action === 'replan' && input.enabledWorkflows ? { ...config, enabledWorkflows: input.enabledWorkflows } : config;
      const savedPackage = plan ? jsonObject<{ businessPackage?: WeeklyPackage }>(plan.plan, {}).businessPackage : undefined;
      const replanDraft = input.action === 'replan' ? savedPackage ? compilePackage(savedPackage, goalInput(goal), replanConfig) : buildWeeklyPlan(goalInput(goal), replanConfig) : null;
      const replannedKeys = new Set(replanDraft?.tasks.map(item => item.key) || []);
      const affected = input.action === 'replan'
        ? [...new Map([...downstream, ...allTasks.items.filter(item => !replannedKeys.has(item.task_key))].map(item => [item.id, item])).values()]
        : downstream;
      if (affected.some(item => item.status === 'handed_off')) {
        throw new TaskControlError(409, 'task_handed_off', { message: '受影响任务中存在人工接管节点，请先交还数字员工。' });
      }
      const irreversibleGuardTasks = input.action === 'manual_complete' ? affected.filter(item => item.id !== task.id) : affected;
      const irreversible = await irreversibleEffects({ store, tenantId: input.tenantId, run,
        affected: irreversibleGuardTasks, followupRunHasExternalReceipt });
      if (irreversible.length) {
        throw new TaskControlError(409, 'irreversible_external_effect', {
          message: '受影响节点已有真实发布或发送回执，不能回滚或自动重跑。',
          effects: irreversible,
        });
      }
      let verifiedExternal: Awaited<ReturnType<typeof observeTaskProof>> | null = null;
      if (input.action === 'manual_complete' && ['platform_publish', 'followup_dispatch'].includes(task.task_key)) {
        const snapshot = await buildBusinessSnapshot(input.tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
        verifiedExternal = await observeTaskProof(input.tenantId, run, task, snapshot, allTasks.items);
        if (!verifiedExternal.ready) {
          throw new TaskControlError(409, 'external_receipt_required', { message: '发布/发送节点只能依据当前 run 的真实平台回执完成。', proof: verifiedExternal.proof });
        }
      }
      const previousCorrection = await first<CorrectionRecord>(COLLECTION.corrections, { tenant_id: input.tenantId, task_id: task.id }, '-version');
      const version = Number(previousCorrection?.version || task.correction_version || 0) + 1;
      const now = new Date().toISOString();
      const beforeState = {
        runStatus: run.status,
        tasks: affected.map(item => ({
          id: item.id,
          taskKey: item.task_key,
          status: item.status,
          taskVersion: Number(item.task_version || 1),
          correctionVersion: Number(item.correction_version || 0),
          output: jsonObject(item.output, {}),
          businessRefs: jsonObject(item.business_refs, []),
        })),
      };
      if (savedPackage && plan && taskCorrectionInvalidatesWeeklyAuthorization(input.action)) {
        const priorBody = jsonObject<Record<string, unknown>>(plan.plan, {});
        await store.update(COLLECTION.plans, plan.id, { plan: { ...priorBody, packageApprovedBy: '', packageGrantInvalidatedAt: now } });
        await invalidatePublishingAuthorizationForRun(input.tenantId, run.id);
        await appendAuthorizationRequiredEvent({
          tenantId: input.tenantId,
          runId: run.id,
          taskId: task.id,
          reason: 'package_adjusted',
          changedFields: input.action === 'replan' ? ['enabledWorkflows', 'weeklyPackage'] : ['taskExecution'],
        });
      }
      const correction = await requiredCreate<CorrectionRecord>(COLLECTION.corrections, {
        tenant_id: input.tenantId,
        goal_id: run.goal_id,
        run_id: run.id,
        task_id: task.id,
        version,
        scope: input.scope,
        instruction: input.instruction,
        rerun_downstream: input.rerunDownstream,
        before_state: beforeState,
        after_state: { action: input.action, runStatus: 'running', correctionVersion: version, appliedToCurrentRun: true, longTermRuleActivated: false },
        affected_task_ids: affected.map(item => item.id),
        business_refs: affected.flatMap(item => jsonObject<unknown[]>(item.business_refs, [])),
        status: 'applying',
        created_by: input.userId,
        created_at: now,
      });
      const resetTask = async (item: TaskRecord, isCurrent: boolean) => {
        await store.update(COLLECTION.tasks, item.id, {
          status: 'pending',
          output: isCurrent
            ? { ...jsonObject<Record<string, unknown>>(item.output, {}), executionFailure: undefined, waitState: undefined, correctionInput: { id: correction.id, version, scope: input.scope, instruction: input.instruction, action: input.action }, rerunRequestedAt: now }
            : { rerunRequestedByCorrection: correction.id, correctionVersion: version, rerunRequestedAt: now },
          blocked_reason: '',
          owner_id: packageTaskForKey(savedPackage, item.task_key)?.ownerId || '',
          business_refs: (packageTaskForKey(savedPackage, item.task_key)?.sourceProjectIds || []).map(id => ({ type: 'studio_project', id })),
          task_version: Number(item.task_version || 1) + 1,
          correction_version: isCurrent ? version : Number(item.correction_version || 0),
          updated_at: now,
        });
      };
      if (input.action === 'replan') {
        const effectiveConfig = replanConfig;
        const replanned = replanDraft!;
        const plannedByKey = new Map(replanned.tasks.map(item => [item.key, item]));
        const resetIds = new Set(downstream.map(item => item.id));
        const removedOrReset = allTasks.items.filter(item => !plannedByKey.has(item.task_key) || resetIds.has(item.id));
        await supersedeAffectedBusinessState(input.tenantId, run, removedOrReset, now);
        for (const existing of allTasks.items) {
          const planned = plannedByKey.get(existing.task_key);
          if (!planned) {
            await store.update(COLLECTION.tasks, existing.id, {
              status: 'skipped',
              output: { previousStatus: existing.status, previousOutput: jsonObject(existing.output, {}), completionMode: 'replanned_out', correctionId: correction.id, replannedAt: now },
              blocked_reason: '已从当前周计划移除', owner_id: '', correction_version: existing.id === task.id ? version : Number(existing.correction_version || 0), updated_at: now,
            });
            continue;
          }
          const shouldReset = resetIds.has(existing.id);
          await store.update(COLLECTION.tasks, existing.id, {
            title: planned.title, description: planned.description, agent_role: planned.agentRole, kind: planned.kind,
            sequence: planned.sequence, priority: planned.priority, requires_approval: planned.requiresApproval, depends_on: planned.dependsOn,
            business_domain: planned.businessDomain, capability_key: planned.capabilityKey, destination: planned.destination,
            destination_view: planned.destinationView || '', status_source: planned.statusSource, execution_mode: planned.executionMode, external_effect: planned.externalEffect,
            ...(shouldReset ? {
              status: 'pending', output: { replannedByCorrection: correction.id, correctionVersion: version, replannedAt: now }, blocked_reason: '', owner_id: '', business_refs: [], task_version: Number(existing.task_version || 1) + 1,
            } : {}),
            correction_version: existing.id === task.id ? version : Number(existing.correction_version || 0), updated_at: now,
          });
          plannedByKey.delete(existing.task_key);
        }
        const newTaskIds: string[] = [];
        for (const planned of plannedByKey.values()) {
          const created = await requiredCreate<TaskRecord>(COLLECTION.tasks, {
            tenant_id: input.tenantId, goal_id: goal.id, plan_id: plan.id, run_id: run.id,
            task_key: planned.key, title: planned.title, description: planned.description, agent_role: planned.agentRole, kind: planned.kind,
            status: 'pending', sequence: planned.sequence, priority: planned.priority, requires_approval: planned.requiresApproval, depends_on: planned.dependsOn,
            output: { replannedByCorrection: correction.id, replannedAt: now }, blocked_reason: '', owner_id: packageTaskForKey(savedPackage, planned.key)?.ownerId || '',
            business_domain: planned.businessDomain, capability_key: planned.capabilityKey, destination: planned.destination, destination_view: planned.destinationView || '',
            status_source: planned.statusSource, execution_mode: planned.executionMode, external_effect: planned.externalEffect, business_refs: [], task_version: 1, correction_version: 0,
            created_at: now, updated_at: now,
          });
          newTaskIds.push(created.id);
        }
        await store.update(COLLECTION.plans, plan.id, { status: 'approved', plan: { ...replanned, configSnapshot: effectiveConfig, replannedAt: now, correctionId: correction.id } });
        await store.update(COLLECTION.corrections, correction.id, {
          affected_task_ids: [...affected.map(item => item.id), ...newTaskIds],
          after_state: { action: input.action, runStatus: 'running', correctionVersion: version, planTaskKeys: replanned.tasks.map(item => item.key), enabledWorkflows: effectiveConfig.enabledWorkflows, newTaskIds, longTermRuleActivated: false },
        });
      } else if (input.action === 'retry') {
        await supersedeAffectedBusinessState(input.tenantId, run, affected, now);
        for (const item of affected) await resetTask(item, item.id === task.id);
      } else {
        const downstreamOnly = downstream.filter(item => item.id !== task.id);
        await supersedeAffectedBusinessState(input.tenantId, run, input.action === 'skip' ? affected : downstreamOnly, now);
        for (const item of downstreamOnly) await resetTask(item, false);
        if (input.action === 'skip') {
          await store.update(COLLECTION.tasks, task.id, {
            status: 'skipped',
            output: { previousOutput: jsonObject(task.output, {}), completionMode: 'skipped_by_human', note: input.instruction, correctionId: correction.id, completedAt: now },
            blocked_reason: '', owner_id: input.userId, correction_version: version, updated_at: now,
          });
        } else {
          const businessRefs = verifiedExternal?.businessRefs || (validatedInputRefs.length ? validatedInputRefs : jsonObject<Array<Record<string, unknown>>>(task.business_refs, []));
          const output = verifiedExternal
            ? { ...buildTaskOutput(task.task_key, goalInput(goal), config), ...input.output, completionMode: 'human_verified_receipt', note: input.instruction, proof: verifiedExternal.proof, businessRefs, completedAt: now }
            : { ...jsonObject<Record<string, unknown>>(task.output, {}), ...input.output, completionMode: 'manual', note: input.instruction, businessRefs, completedAt: now };
          await store.update(COLLECTION.tasks, task.id, {
            status: 'succeeded', output, business_refs: businessRefs, blocked_reason: '', owner_id: input.userId, correction_version: version, updated_at: now,
          });
        }
      }
      if (resumePausedRun) {
        await resumeContentExecutionJobsForRun({
          dataStore: store,
          tenantId: input.tenantId,
          runId: run.id,
          origin: 'workflow_run_pause',
          now: new Date(now),
        });
      }
      await Promise.all([
        store.update(COLLECTION.corrections, correction.id, { status: input.scope === 'rule_candidate' ? 'rule_candidate_pending_review' : 'applied_once' }),
        store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', pause_reason: '', completed_at: '' }),
        store.update(COLLECTION.goals, run.goal_id, { status: 'active', updated_at: now }),
      ]);
      const review = await first<StoredRecord & { tenant_id: string }>(COLLECTION.reviews, { tenant_id: input.tenantId, run_id: run.id });
      if (review) await store.update(COLLECTION.reviews, review.id, { status: 'stale_after_correction' });
      await appendEvent({
        tenantId: input.tenantId, runId: run.id, taskId: task.id, type: `task.${input.action}`, level: 'warning',
        summary: `${task.title} 已执行${({ retry: '重试', skip: '跳过', manual_complete: '人工完成', replan: '重新规划' } as Record<TaskControlAction, string>)[input.action]}`,
        payload: { correctionId: correction.id, version, action: input.action, scope: input.scope, rerunDownstream: input.rerunDownstream, affectedTaskIds: affected.map(item => item.id), longTermRuleActivated: false },
      });
      await appendAudit({ tenantId: input.tenantId, userId: input.userId, action: `workflow_task.${input.action}`, targetType: 'workflow_task', targetId: task.id, metadata: { correctionId: correction.id, runId: run.id, version, scope: input.scope, rerunDownstream: input.rerunDownstream, affectedTaskIds: affected.map(item => item.id) } });
      return { runId: run.id, goalId: run.goal_id };
    });
  }
  async function canonicalEvidenceRef(tenantId: string, raw: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const type = String(raw.type || '').trim();
    const id = String(raw.id || raw.recordId || '').trim();
    if (!type || !id) return null;
    const collectionByType: Record<string, { collection: string; tenantField: 'tenant_id' | 'tenantId' }> = {
      studio_project: { collection: 'studio_projects', tenantField: 'tenant_id' },
      trend_video: { collection: 'trend_videos', tenantField: 'tenantId' },
      post: { collection: 'posts', tenantField: 'tenant_id' },
      customer_segment: { collection: COLLECTION.segments, tenantField: 'tenant_id' },
      followup_batch: { collection: COLLECTION.followupBatches, tenantField: 'tenant_id' },
    };
    const mapping = collectionByType[type];
    if (mapping) {
      const record = await store.getById<StoredRecord>(mapping.collection, id).catch(() => null);
      if (!record || String(record[mapping.tenantField] || '') !== tenantId) return null;
      return { ...raw, type, id: record.id };
    }
    if (type === 'scheduled_task') {
      const records = await store.list<StoredRecord>('scheduled_tasks', { where: { tenant_id: tenantId }, perPage: 500 });
      const record = records.items.find(item => item.id === id || String(item.task_id || '') === id);
      return record ? { ...raw, type, id: String(record.task_id || record.id), recordId: record.id } : null;
    }
    if (type === 'customer') {
      const customer = (await getWhatsAppCustomers(tenantId)).find(item => String(item.id || '') === id);
      return customer ? { ...raw, type, id } : null;
    }
    return null;
  }
  async function decideDirectorDirection(input: {
    tenantId: string; userId: string; taskId: string; decision: DirectorDecision;
    reason?: DirectorDecisionReason; contentId: string; applyToSimilar: boolean;
  }): Promise<{ runId: string; goalId: string }> {
    const { tenantId, userId } = input;
    const decision = input.decision;
    const reason = input.reason as DirectorDecisionReason;
    const contentId = input.contentId.trim().slice(0, 120);
    if (!['continue', 'adjust', 'abandon'].includes(decision)) throw new TaskControlError(400, 'invalid_director_decision');
    if (!contentId) throw new TaskControlError(400, 'director_content_required');
    if (decision !== 'continue' && !(reason in DIRECTOR_REASON_LABELS)) throw new TaskControlError(400, 'director_reason_required');
    const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, tenantId);
    if (!task) throw new TaskControlError(404, 'task_not_found');
    const plan = await tenantRecord<PlanRecord>(COLLECTION.plans, task.plan_id, tenantId);
    if (!plan) throw new TaskControlError(409, 'correction_context_missing');
    const original = jsonObject<Record<string, unknown>>(plan.plan, {});
    const pack = original.businessPackage as WeeklyPackage | undefined;
    if (!pack) throw new TaskControlError(409, 'weekly_package_missing');
    let taskControlApplied = false;
    try {
      const now = new Date().toISOString();
      const applied = applyDirectorDecision({ pack, contentId, decision, ...(decision !== 'continue' ? { reason } : {}), applyToSimilar: input.applyToSimilar === true, now });
      const invalidatesAuthorization = directorDecisionInvalidatesWeeklyAuthorization(decision);
      await store.update(COLLECTION.plans, plan.id, { plan: {
        ...original,
        businessPackage: applied.pack,
        ...(invalidatesAuthorization ? { packageApprovedBy: '', packageGrantInvalidatedAt: now } : {}),
      } });
      if (decision === 'continue') {
        await appendEvent({ tenantId, runId: task.run_id, taskId: task.id, type: 'director.continue', level: 'info', summary: `${task.title}：人工选择继续当前内容方向`, payload: { contentId, affectedContentIds: applied.affectedContentIds } });
        await appendAudit({ tenantId, userId, action: 'director_direction.continue', targetType: 'workflow_task', targetId: task.id, metadata: { runId: task.run_id, contentId, affectedContentIds: applied.affectedContentIds } });
        await advanceRun(tenantId, task.run_id);
        return { runId: task.run_id, goalId: task.goal_id };
      }
      const instruction = `${DIRECTOR_DECISION_LABELS[decision]}当前内容方向；原因：${DIRECTOR_REASON_LABELS[reason]}。${input.applyToSimilar === true ? '同时调整本周同类内容。' : '仅作用于当前内容。'}`;
      const runTasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: task.run_id }, sort: 'sequence', perPage: 100 });
      const routingTask = runTasks.items.find(item => item.task_key === 'content_mode_routing');
      if (!routingTask) throw new Error('director_routing_task_missing');
      const result = await applyTaskControl({ tenantId, userId, taskId: routingTask.id, action: 'retry', scope: 'one_off', instruction, rerunDownstream: true });
      taskControlApplied = true;
      await invalidatePublishingAuthorizationForRun(tenantId, task.run_id);
      await appendAuthorizationRequiredEvent({ tenantId, runId: task.run_id, taskId: task.id, reason: 'package_adjusted', changedFields: ['directorDecision'] });
      await appendAudit({ tenantId, userId, action: `director_direction.${decision}`, targetType: 'weekly_content', targetId: contentId, metadata: { runId: task.run_id, taskId: task.id, routingTaskId: routingTask.id, reason, applyToSimilar: input.applyToSimilar === true, affectedContentIds: applied.affectedContentIds, replacementContentId: applied.replacementContentId } });
      await advanceRun(tenantId, result.runId);
      return result;
    } catch (error) {
      if (!taskControlApplied) await store.update(COLLECTION.plans, plan.id, { plan: original }).catch(() => undefined);
      const message = error instanceof Error ? error.message : 'director_decision_failed';
      throw new TaskControlError(message === 'director_content_not_found' ? 404 : 409, message);
    }
  }
  async function attachTaskEvidence({ tenantId, userId, taskId, businessRefs }: {
    tenantId: string; userId: string; taskId: string; businessRefs?: Array<Record<string, unknown>>;
  }): Promise<{ runId: string; goalId: string }> {
    const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, taskId, tenantId);
    if (!initialTask) throw new TaskControlError(404, 'task_not_found');
    return withDigitalEmployeeRunLock(tenantId, initialTask.run_id, async () => {
    const rawRefs = Array.isArray(businessRefs) ? businessRefs.slice(0, 50) : [];
    if (!rawRefs.length) throw new TaskControlError(400, 'business_refs_required');
    const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, taskId, tenantId);
    if (!task) throw new TaskControlError(404, 'task_not_found');
    const canonical: Array<Record<string, unknown>> = [];
    for (let index = 0; index < rawRefs.length; index += 1) {
      const validated = await canonicalEvidenceRef(tenantId, rawRefs[index]);
      if (!validated) {
        throw new TaskControlError(400, 'evidence_reference_invalid', { message: '证据必须引用当前租户内已存在的业务记录。', index, type: rawRefs[index]?.type || '', id: rawRefs[index]?.id || '' });
      }
      canonical.push(validated);
    }
    const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId);
    if (!run) throw new TaskControlError(409, 'evidence_context_missing');
    const now = new Date().toISOString();
    const [runTasks, pendingApprovals] = await Promise.all([
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
      store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id, status: 'pending' }, perPage: 100 }),
    ]);
    const downstreamIds = new Set(downstreamTasks(runTasks.items, task, true).map(item => item.id));
    for (const approval of pendingApprovals.items.filter(item => downstreamIds.has(item.task_id))) {
      await store.update(COLLECTION.approvals, approval.id, { status: 'superseded', decision_note: '上游业务证据变更，需重新预检与审批', decided_at: now });
      if (approval.task_id !== task.id) {
        const approvalTask = runTasks.items.find(item => item.id === approval.task_id);
        if (approvalTask) await store.update(COLLECTION.tasks, approvalTask.id, { status: 'pending', blocked_reason: '', task_version: Number(approvalTask.task_version || 1) + 1, updated_at: now });
      }
    }
    const existing = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []);
    const merged = [...new Map([...existing, ...canonical].map(ref => [`${String(ref.type || '')}:${String(ref.id || '')}`, ref])).values()];
    const shouldResetTask = ['waiting_external', 'waiting_approval', 'waiting_human', 'pending'].includes(task.status);
    const shouldReconcile = !['succeeded', 'failed', 'cancelled', 'paused'].includes(run.status);
    await Promise.all([
      store.update(COLLECTION.tasks, task.id, { business_refs: merged, ...(shouldResetTask ? { status: 'pending', blocked_reason: '' } : {}), task_version: Number(task.task_version || 1) + 1, updated_at: now }),
      shouldReconcile ? store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', pause_reason: '', completed_at: '' }) : Promise.resolve(false),
    ]);
    await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.evidence_attached', level: 'info', summary: `${task.title} 已关联 ${canonical.length} 条租户内业务证据`, payload: { businessRefs: canonical } });
    await appendAudit({ tenantId, userId, action: 'workflow_task.evidence_attached', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, businessRefs: canonical } });
    if (shouldReconcile) await advanceRun(tenantId, run.id);
    return { runId: run.id, goalId: run.goal_id };
    });
  }
  return { applyTaskControl, decideDirectorDirection, attachTaskEvidence };
}
export type TaskInterventionApplication = ReturnType<typeof createTaskInterventionApplication>;
