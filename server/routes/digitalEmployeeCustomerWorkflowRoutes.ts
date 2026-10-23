import { createCustomerTaskNavigationRouter } from './customerTaskNavigation.js';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';

import { dispatchFollowupBatch, getTenantFollowupDispatchStatus } from '../digitalEmployees/followupDispatchWorker.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { publicConfig } from '../digitalEmployees/overviewProjection.js';
import { createCustomerSegmentSnapshot, createFollowupBatch, configureFollowupItemTemplate, getCustomerSegment, getCustomerSegmentMembers, getFollowupBatch, getFollowupBatchItems, type FollowupBatchRecord } from '../digitalEmployees/customerWorkflow.js';

import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type ApprovalRecord, type GoalRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeCustomerWorkflowRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'tenantRecord' | 'appendEvent' | 'appendAudit' | 'advanceRun' | 'buildOverview' | 'configForTenant' | 'ensureFrozenEnterpriseProfileForRun' | 'executionConfigForPlan' | 'first'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const advanceRun: DigitalEmployeeApplicationPorts['advanceRun'] = (...args) => deps.advanceRun(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const configForTenant: DigitalEmployeeApplicationPorts['configForTenant'] = (...args) => deps.configForTenant(...args);

  const ensureFrozenEnterpriseProfileForRun: DigitalEmployeeApplicationPorts['ensureFrozenEnterpriseProfileForRun'] = (...args) => deps.ensureFrozenEnterpriseProfileForRun(...args);

  const executionConfigForPlan: DigitalEmployeeApplicationPorts['executionConfigForPlan'] = (...args) => deps.executionConfigForPlan(...args);

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  const customerWorkflowQueues = new Map<string, Promise<void>>();

  function registerPostRunsRunIdCustomerSegments() {
    digitalEmployeesRouter.post('/runs/:runId/customer-segments', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      await withLocalQueue(customerWorkflowQueues, `${tenantId}:${req.params.runId}:segment`, async () => {
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
        if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
        if (['succeeded', 'cancelled'].includes(run.status)) { res.status(409).json({ error: '历史运行只可查看，请新建目标' }); return; }
        const [goal, tasks] = await Promise.all([
          tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId),
          store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
        ]);
        const task = tasks.items.find(item => item.task_key === 'customer_segmentation');
        if (!goal || !task) { res.status(409).json({ error: 'customer_segmentation_context_missing' }); return; }
        const result = await createCustomerSegmentSnapshot({
          tenantId,
          goalId: goal.id,
          runId: run.id,
          taskId: task.id,
          userId,
          name: String(req.body?.name || '').trim().slice(0, 200),
          criteria: req.body?.criteria || {},
          idempotent: false,
        });
        const businessRefs = [{ type: 'customer_segment', id: result.segment.id, version: result.segment.version, memberCount: result.segment.member_count }];
        await store.update(COLLECTION.tasks, task.id, { business_refs: businessRefs, updated_at: new Date().toISOString() });
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'customer.segment.created', level: 'success', summary: `已保存客户分层快照（纳入 ${result.segment.member_count} 人，排除 ${result.segment.excluded_count} 人）`, payload: { businessRefs, criteriaHash: result.segment.criteria_hash } });
        await appendAudit({ tenantId, userId, action: 'customer_segment.created', targetType: 'customer_segment', targetId: result.segment.id, metadata: { runId: run.id, taskId: task.id, version: result.segment.version, memberCount: result.segment.member_count } });
        await advanceRun(tenantId, run.id);
        res.status(201).json(await buildOverview(tenantId, goal.id));
      });
    });
  }

  function registerGetCustomerSegmentsSegmentId() {
    digitalEmployeesRouter.get('/customer-segments/:segmentId', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const segment = await getCustomerSegment(tenantId, req.params.segmentId);
      if (!segment) { res.status(404).json({ error: 'customer_segment_not_found' }); return; }
      const members = await getCustomerSegmentMembers(tenantId, segment.id);
      res.json({ segment: { ...segment, criteria: jsonObject(segment.criteria, {}), exclusion_summary: jsonObject(segment.exclusion_summary, {}) }, members: members.map(member => ({ ...member, inclusion_reasons: jsonObject(member.inclusion_reasons, []), exclusion_reasons: jsonObject(member.exclusion_reasons, []), customer_snapshot: jsonObject(member.customer_snapshot, {}) })) });
    });
  }

  function registerPostCustomerSegmentsSegmentIdFollowupBatches() {
    digitalEmployeesRouter.post('/customer-segments/:segmentId/followup-batches', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const segment = await getCustomerSegment(tenantId, req.params.segmentId);
      if (!segment) { res.status(404).json({ error: 'customer_segment_not_found' }); return; }
      await withLocalQueue(customerWorkflowQueues, `${tenantId}:${segment.run_id}:followup`, async () => {
        const [run, goal, tasks] = await Promise.all([
          tenantRecord<RunRecord>(COLLECTION.runs, segment.run_id, tenantId),
          tenantRecord<GoalRecord>(COLLECTION.goals, segment.goal_id, tenantId),
          store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: segment.run_id }, perPage: 100 }),
        ]);
        const task = tasks.items.find(item => item.task_key === 'followup_batch_draft');
        if (!run || !goal || !task) { res.status(409).json({ error: 'followup_batch_context_missing' }); return; }
        if (['succeeded', 'cancelled'].includes(run.status)) { res.status(409).json({ error: '历史运行只可查看，请新建目标' }); return; }
        const [plan, configRecord] = await Promise.all([
          tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
          configForTenant(tenantId),
        ]);
        const currentConfig = publicConfig(configRecord);
        if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
        const enterpriseProfile = await ensureFrozenEnterpriseProfileForRun(
          tenantId,
          plan,
          executionConfigForPlan(plan, currentConfig),
          run.started_at,
        );
        const result = await createFollowupBatch({
          tenantId,
          goalId: goal.id,
          runId: run.id,
          taskId: task.id,
          segmentId: segment.id,
          userId,
          name: String(req.body?.name || '').trim().slice(0, 200),
          idempotent: false,
          enterpriseProfile,
        });
        const refs = [{ type: 'followup_batch', id: result.batch.id, version: result.batch.version, contentHash: result.batch.content_hash, itemCount: result.items.length }];
        await store.update(COLLECTION.tasks, task.id, { business_refs: refs, updated_at: new Date().toISOString() });
        const worker = await getTenantFollowupDispatchStatus(tenantId);
        const workerMode = worker.authorization.scheduledFollowupSendAllowed ? 'scheduled' : 'manual_only';
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'followup.batch.created', level: 'success', summary: `已保存 ${result.items.length} 条逐客跟进草稿，等待审批`, payload: { businessRefs: refs, blockedItems: result.items.filter(item => item.status === 'blocked').length, bulkWorkerStatus: workerMode, messagingAuthorization: worker.authorization, messagesSent: 0 } });
        await appendAudit({ tenantId, userId, action: 'followup_batch.created', targetType: 'followup_batch', targetId: result.batch.id, metadata: { runId: run.id, taskId: task.id, version: result.batch.version, itemCount: result.items.length, bulkWorkerStatus: workerMode, messagingAuthorization: worker.authorization } });
        await advanceRun(tenantId, run.id);
        res.status(201).json(await buildOverview(tenantId, goal.id));
      });
    });
  }

  function registerUseRunsRunIdCustomerTaskNavigation() {
    digitalEmployeesRouter.use('/runs/:runId/customer-task-navigation',createCustomerTaskNavigationRouter(store));
  }

  function registerGetRunsRunIdCustomerWorkspace() {
    digitalEmployeesRouter.get('/runs/:runId/customer-workspace', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
      if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
      const segment = await first<StoredRecord & { tenant_id: string }>('customer_segments', { tenant_id: tenantId, run_id: run.id }, '-version');
      const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
      const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 });
      res.json({ scope: {tenantId,runId:run.id}, tasks: tasks.items.map(task => ({ id: task.id, run_id: run.id, title: task.title, task_key: task.task_key, status: task.status, blocker_reason: task.blocker_reason })), readOnly: ['succeeded', 'cancelled'].includes(run.status), segment, members: segment ? await getCustomerSegmentMembers(tenantId, segment.id) : [], batch, items: batch ? await getFollowupBatchItems(tenantId, batch.id) : [] });
    });
  }

  function registerPostFollowupBatchesBatchIdRevise() {
    digitalEmployeesRouter.post('/followup-batches/:batchId/revise', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const batch = await getFollowupBatch(tenantId, req.params.batchId);
      if (!batch) { res.status(404).json({ error: 'followup_batch_not_found' }); return; }
      await withDigitalEmployeeRunLock(tenantId, batch.run_id, () => withLocalQueue(customerWorkflowQueues, `${tenantId}:${batch.run_id}:followup`, async () => {
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, batch.run_id, tenantId);
        if (!run || ['cancelled', 'succeeded'].includes(run.status)) { res.status(409).json({ error: 'run_not_editable' }); return; }
        const latest = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
        if (latest?.id !== batch.id || Number(req.body?.version) !== Number(batch.version)) { res.status(409).json({ error: 'batch_version_changed' }); return; }
        if (!['draft', 'rejected', 'pending_approval'].includes(String(latest.status))) { res.status(409).json({ error: '当前批次已批准或进入执行，不能直接覆盖，请先终止发送' }); return; }
        const oldItems = await getFollowupBatchItems(tenantId, batch.id);
        const overrides: Record<string, string> = {};
        if (req.body?.regenerate !== true) {
          for (const item of oldItems) {
            const body = req.body?.drafts?.[item.customer_id];
            if (typeof body !== 'string' || !body.trim() || body.length > 2000) { res.status(400).json({ error: '请填写所有客户的有效回复' }); return; }
            overrides[item.customer_id] = body;
          }
        }
        try {
          const [plan, configRecord] = await Promise.all([
            tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
            configForTenant(tenantId),
          ]);
          const currentConfig = publicConfig(configRecord);
          if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
          const enterpriseProfile = await ensureFrozenEnterpriseProfileForRun(
            tenantId,
            plan,
            executionConfigForPlan(plan, currentConfig),
            run.started_at,
          );
          const result = await createFollowupBatch({ tenantId, goalId: batch.goal_id, runId: batch.run_id, taskId: batch.task_id, segmentId: batch.segment_id, userId,
            idempotent: false, revisionNote: String(req.body?.note || '').slice(0, 1500), draftOverrides: req.body?.regenerate === true ? undefined : overrides, deliveryPolicy: jsonObject(batch.delivery_policy, {}), enterpriseProfile });
          const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
          for (const task of tasks.items.filter(task => ['followup_batch_draft', 'followup_batch_approval', 'followup_dispatch', 'weekly_review'].includes(task.task_key))) {
            await store.update(COLLECTION.tasks, task.id, { status: 'pending', blocked_reason: '', output: {}, business_refs: task.task_key === 'followup_batch_draft' ? [{ type: 'followup_batch', id: result.batch.id }] : [], updated_at: new Date().toISOString() });
          }
          const approvals = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id, status: 'pending' }, perPage: 100 });
          for (const approval of approvals.items.filter(approval => tasks.items.some(task => task.id === approval.task_id && task.task_key === 'followup_batch_approval'))) await store.update(COLLECTION.approvals, approval.id, { status: 'superseded' });
          await store.update(COLLECTION.runs, run.id, { status: 'running', completed_at: '', pause_reason: '', current_controller: 'agent' });
          await store.update(COLLECTION.goals, run.goal_id, { status: 'active' });
          await appendAudit({ tenantId, userId, action: 'followup_batch.revised', targetType: 'followup_batch', targetId: result.batch.id, metadata: { priorBatchId: batch.id, version: result.batch.version } });
          await advanceRun(tenantId, run.id);
          res.json(await buildOverview(tenantId, run.goal_id));
        } catch (error) { res.status(409).json({ error: error instanceof Error ? error.message : '修订失败' }); }
      }));
    });
  }

  async function configureWorkflowFollowupTemplate(
    input: Parameters<typeof configureFollowupItemTemplate>[0],
    resolver?: Parameters<typeof configureFollowupItemTemplate>[1],
  ) {
    const batch = await getFollowupBatch(input.tenantId, input.batchId);
    if (!batch) throw new Error('followup_batch_not_found');
    return withDigitalEmployeeRunLock(input.tenantId, batch.run_id, async () => {
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, batch.run_id, input.tenantId);
      if (!run || ['cancelled', 'succeeded', 'failed'].includes(run.status)) throw new Error('run_not_editable');
      const latest = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: input.tenantId, run_id: run.id }, '-version');
      if (latest?.id !== batch.id) throw new Error('batch_version_changed');
      const result = await configureFollowupItemTemplate(input, resolver);
      const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: input.tenantId, run_id: run.id }, perPage: 100 });
      const affected = tasks.items.filter(task => ['followup_batch_draft', 'followup_batch_approval', 'followup_dispatch', 'weekly_review'].includes(task.task_key));
      for (const task of affected) await store.update(COLLECTION.tasks, task.id, {
        status: 'pending', blocked_reason: '', output: {},
        business_refs: task.task_key === 'followup_batch_draft' ? [{ type: 'followup_batch', id: result.batch.id }] : [],
        updated_at: new Date().toISOString(),
      });
      const approvals = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: input.tenantId, run_id: run.id, status: 'pending' }, perPage: 100 });
      for (const approval of approvals.items.filter(item => affected.some(task => task.id === item.task_id && task.task_key === 'followup_batch_approval'))) {
        await store.update(COLLECTION.approvals, approval.id, { status: 'superseded' });
      }
      // Configuration must never resume a paused or human-controlled run.
      if (!['paused', 'waiting_human'].includes(run.status)) {
        await store.update(COLLECTION.runs, run.id, { status: 'running', completed_at: '', pause_reason: '' });
      }
      return result;
    });
  }

  function registerPostFollowupBatchesBatchIdDispatch() {
    digitalEmployeesRouter.post('/followup-batches/:batchId/dispatch', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const batch = await getFollowupBatch(tenantId, req.params.batchId);
      if (!batch) { res.status(404).json({ error: 'followup_batch_not_found' }); return; }
      try {
        const result = await dispatchFollowupBatch(tenantId, batch.id, { mode: 'manual' });
        await appendAudit({ tenantId, userId, action: 'followup_batch.dispatch_requested', targetType: 'followup_batch', targetId: batch.id, metadata: { runId: batch.run_id, ...result } });
        if (result.sent > 0) await advanceRun(tenantId, batch.run_id);
        res.status(202).json({ ok: true, worker: await getTenantFollowupDispatchStatus(tenantId), result, overview: await buildOverview(tenantId) });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'followup_dispatch_failed';
        const isPolicyConflict = code === 'followup_batch_not_approved_for_current_version'
          || code.startsWith('workflow_run_')
          || code.startsWith('customer_message_send_not_authorized:');
        res.status(isPolicyConflict ? 409 : 502).json({ error: code });
      }
    });
  }

  return { configureWorkflowFollowupTemplate, registerPostRunsRunIdCustomerSegments, registerGetCustomerSegmentsSegmentId, registerPostCustomerSegmentsSegmentIdFollowupBatches, registerUseRunsRunIdCustomerTaskNavigation, registerGetRunsRunIdCustomerWorkspace, registerPostFollowupBatchesBatchIdRevise, registerPostFollowupBatchesBatchIdDispatch };
}
