import { pauseContentExecutionJobsForRun, resumeContentExecutionJobsForRun } from '../contentExecution/durableQueue.js';
import { type Request, type Response } from 'express';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { type BusinessSnapshot } from '../digitalEmployees/businessSnapshot.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { planWorkflowHandoffAdmission, planWorkflowHandoffReturn } from '../digitalEmployees/workflowHandoffPolicy.js';
import { cancelDigitalEmployeeRun as cancelDigitalEmployeeRunApplication } from '../digitalEmployees/runCancellation.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type GoalRecord, type HandoffRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeRunControlRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'digitalEmployeesRouter' | 'tenantRecord' | 'buildBusinessSnapshot' | 'advanceRun' | 'appendEvent' | 'appendAudit' | 'buildOverview' | 'activeWorkflowHandoffsForRun' | 'handoffPolicyIdentity' | 'requiredCreate' | 'first'>) {
  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const buildBusinessSnapshot: DigitalEmployeeApplicationPorts['buildBusinessSnapshot'] = (...args) => deps.buildBusinessSnapshot(...args);

  const advanceRun: DigitalEmployeeApplicationPorts['advanceRun'] = (...args) => deps.advanceRun(...args);

  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const activeWorkflowHandoffsForRun: DigitalEmployeeApplicationPorts['activeWorkflowHandoffsForRun'] = (...args) => deps.activeWorkflowHandoffsForRun(...args);

  const handoffPolicyIdentity: DigitalEmployeeApplicationPorts['handoffPolicyIdentity'] = (...args) => deps.handoffPolicyIdentity(...args);

  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  function registerPostRunsRunIdReconcile() {
    digitalEmployeesRouter.post('/runs/:runId/reconcile', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
      if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
      const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
      if (!goal) { res.status(409).json({ error: 'run_context_missing' }); return; }
      const [beforeTasks, beforeSnapshot] = await Promise.all([
        store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
        buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at }),
      ]);
      await advanceRun(tenantId, run.id);
      const [currentRun, currentTasks, snapshot] = await Promise.all([
        tenantRecord<RunRecord>(COLLECTION.runs, run.id, tenantId),
        store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
        buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at }),
      ]);
      const stateFingerprint = (runStatus: string, tasks: TaskRecord[], business: BusinessSnapshot) => JSON.stringify({
        runStatus,
        tasks: tasks.map(task => [task.id, task.status, task.blocked_reason]),
        metrics: [
          business.content.scheduledAutomations.value,
          business.content.exactAnalyses.value,
          business.content.contentProjects.value,
          business.content.completedWorks.value,
          business.content.scheduledPosts.value,
          business.content.publishedPosts.value,
          business.customer.attributed.value,
          business.customer.segmentSnapshots.value,
          business.customer.followupDrafts.value,
          business.customer.outreachSent.value,
        ],
      });
      const changed = stateFingerprint(run.status, beforeTasks.items, beforeSnapshot)
        !== stateFingerprint(currentRun?.status || run.status, currentTasks.items, snapshot);
      if (changed) {
        await appendEvent({
          tenantId,
          runId: run.id,
          type: 'workflow.reconciled',
          level: 'info',
          summary: '内容或客户工作台出现新事实，运行状态已刷新',
          payload: {
            runStatus: currentRun?.status || run.status,
            snapshotAt: snapshot.generatedAt,
            scheduledAutomations: snapshot.content.scheduledAutomations.value,
            publishedPosts: snapshot.content.publishedPosts.value,
            segmentSnapshots: snapshot.customer.segmentSnapshots.value,
            followupDrafts: snapshot.customer.followupDrafts.value,
            sentReceipts: snapshot.customer.outreachSent.value,
            dataGaps: snapshot.dataGaps,
          },
        });
        await appendAudit({ tenantId, userId, action: 'workflow.reconciled', targetType: 'workflow_run', targetId: run.id, metadata: { snapshotAt: snapshot.generatedAt, runStatus: currentRun?.status || run.status } });
      }
      res.json(await buildOverview(tenantId, run.goal_id));
    });
  }

  function registerPostTasksTaskIdHandoff() {
    digitalEmployeesRouter.post('/tasks/:taskId/handoff', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
      if (!initialTask) { res.status(404).json({ error: 'task_not_found' }); return; }
      await withDigitalEmployeeRunLock(tenantId, initialTask.run_id, async () => {
        const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
        if (!task) { res.status(404).json({ error: 'task_not_found' }); return; }
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId);
        if (!run || !['waiting_external', 'waiting_approval', 'running', 'paused', 'waiting_human'].includes(run.status)) { res.status(409).json({ error: 'run_not_handoff_ready' }); return; }
        const activeHandoffs = await activeWorkflowHandoffsForRun(tenantId, run.id);
        const admission = planWorkflowHandoffAdmission(activeHandoffs.map(handoffPolicyIdentity), { taskId: task.id, userId });
        if (admission.kind === 'conflict') {
          res.status(409).json({ error: admission.code, activeTaskIds: admission.activeHandoffs.map(handoff => handoff.taskId) });
          return;
        }
        if (task.status === 'handed_off' && task.owner_id === userId) {
          if (admission.kind !== 'reuse') { res.status(409).json({ error: 'handoff_context_missing' }); return; }
          await pauseContentExecutionJobsForRun({ dataStore: store, tenantId, runId: run.id, origin: 'workflow_handoff' });
          res.json(await buildOverview(tenantId));
          return;
        }
        if (!['waiting_external', 'waiting_approval', 'waiting_human', 'running', 'failed', 'pending'].includes(task.status)) { res.status(409).json({ error: 'task_not_handoff_ready' }); return; }
        const now = new Date().toISOString();
        const existingSession = admission.kind === 'reuse'
          ? activeHandoffs.find(handoff => handoff.id === admission.handoff.id) || null
          : null;
        const session = existingSession || await requiredCreate<HandoffRecord>(COLLECTION.handoffs, {
          tenant_id: tenantId,
          run_id: run.id,
          task_id: task.id,
          status: 'active',
          taken_by: userId,
          snapshot: {
            taskStatus: task.status,
            taskOutput: jsonObject(task.output, {}),
            blockedReason: task.blocked_reason,
            runStatus: run.status,
            runController: run.current_controller,
            runPauseReason: run.pause_reason,
            externalActionsPerformed: false,
            constraints: ['接管期间 Agent 停止外部写入与费用消耗'],
          },
          started_at: now,
          returned_at: '',
        });
        // Persist the fail-closed run state before touching individual jobs. If a
        // later job update fails, a replay repairs it while every provider boundary
        // remains blocked by waiting_human.
        await store.update(COLLECTION.runs, run.id, { status: 'waiting_human', current_controller: userId, pause_reason: '人工完整接管' });
        await pauseContentExecutionJobsForRun({ dataStore: store, tenantId, runId: run.id, origin: 'workflow_handoff', now: new Date(now) });
        await store.update(COLLECTION.tasks, task.id, { status: 'handed_off', owner_id: userId, blocked_reason: '人工完整接管', updated_at: now });
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'handoff.started', level: 'warning', summary: `${task.title} 已由人工完整接管`, payload: { handoffId: session.id } });
        await appendAudit({ tenantId, userId, action: 'handoff.started', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, handoffId: session.id } });
        res.json(await buildOverview(tenantId));
      });
    });
  }

  function registerPostTasksTaskIdReturnToAgent() {
    digitalEmployeesRouter.post('/tasks/:taskId/return-to-agent', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
      if (!initialTask) { res.status(404).json({ error: 'task_not_found' }); return; }
      await withDigitalEmployeeRunLock(tenantId, initialTask.run_id, async () => {
        const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
        if (!task || task.status !== 'handed_off') { res.status(409).json({ error: 'task_not_handed_off' }); return; }
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId);
        const activeHandoffs = run ? await activeWorkflowHandoffsForRun(tenantId, run.id) : [];
        const handoff = activeHandoffs.filter(item => item.task_id === task.id).at(-1) || null;
        if (!run || !handoff) { res.status(409).json({ error: 'handoff_context_missing' }); return; }
        if (run.status !== 'waiting_human') { res.status(409).json({ error: 'run_not_handed_off' }); return; }
        const note = String(req.body?.note || '').trim().slice(0, 1000);
        const now = new Date().toISOString();
        const handoffSnapshot = jsonObject<Record<string, unknown>>(handoff.snapshot, {});
        const restorePausedRun = String(handoffSnapshot.runStatus || '') === 'paused';
        const nextRunStatus = restorePausedRun ? 'paused' : task.requires_approval ? 'waiting_approval' : 'running';
        const nextController = restorePausedRun
          ? String(handoffSnapshot.runController || 'human')
          : task.requires_approval ? 'human' : 'agent';
        const nextPauseReason = restorePausedRun ? String(handoffSnapshot.runPauseReason || '人工暂停') : '';
        const returnPlan = planWorkflowHandoffReturn(activeHandoffs.map(handoffPolicyIdentity), handoff.id);
        await Promise.all([
          store.update(COLLECTION.handoffs, handoff.id, { status: 'returned', returned_at: now, snapshot: { ...handoffSnapshot, returnNote: note } }),
          store.update(COLLECTION.tasks, task.id, { status: task.requires_approval ? 'waiting_approval' : 'pending', owner_id: '', blocked_reason: task.requires_approval ? '等待负责人审批' : '', updated_at: now }),
        ]);
        // Re-read after closing the selected session. Historical data may contain
        // more than one active handoff for a run; no production pause is released
        // until the final active session has been returned.
        const remainingActiveHandoffs = await activeWorkflowHandoffsForRun(tenantId, run.id);
        const verifiedReturnPlan = planWorkflowHandoffReturn(remainingActiveHandoffs.map(handoffPolicyIdentity), handoff.id);
        if (verifiedReturnPlan.canResumeRun) {
          // The run is still waiting_human while the handoff-owned job pause is
          // released, so provider boundaries remain fail-closed during transition.
          await resumeContentExecutionJobsForRun({ dataStore: store, tenantId, runId: run.id, origin: 'workflow_handoff', now: new Date(now) });
          await store.update(COLLECTION.runs, run.id, { status: nextRunStatus, current_controller: nextController, pause_reason: nextPauseReason });
        } else {
          await store.update(COLLECTION.runs, run.id, {
            status: 'waiting_human',
            current_controller: verifiedReturnPlan.remainingController || returnPlan.remainingController || 'human',
            pause_reason: '人工完整接管',
          });
        }
        const stillHandedOff = verifiedReturnPlan.remainingActiveHandoffs.length;
        await appendEvent({
          tenantId,
          runId: run.id,
          taskId: task.id,
          type: 'handoff.returned',
          level: 'success',
          summary: stillHandedOff ? `${task.title} 已交还，另有 ${stillHandedOff} 项人工接管仍在进行` : `${task.title} 已交还数字员工`,
          payload: {
            note,
            externalActionsPerformed: false,
            remainingActiveHandoffIds: verifiedReturnPlan.remainingActiveHandoffs.map(item => item.id),
          },
        });
        await appendAudit({ tenantId, userId, action: 'handoff.returned', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, handoffId: handoff.id, remainingActiveHandoffIds: verifiedReturnPlan.remainingActiveHandoffs.map(item => item.id) } });
        if (verifiedReturnPlan.canResumeRun && !task.requires_approval && !restorePausedRun) await advanceRun(tenantId, run.id);
        res.json(await buildOverview(tenantId));
      });
    });
  }

  function registerPostRunsRunIdPause() {
    digitalEmployeesRouter.post('/runs/:runId/pause', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      await withDigitalEmployeeRunLock(tenantId, req.params.runId, async () => {
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
        if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
        // A run that is waiting for human input is still active work. Operators
        // must be able to stop it before publication without discarding completed
        // production or quality results.
        if (['running', 'waiting_external', 'waiting_approval', 'waiting_human'].includes(run.status)) {
          const now = new Date();
          await store.update(COLLECTION.runs, run.id, { status: 'paused', pause_reason: String(req.body?.reason || '人工暂停').slice(0, 500), current_controller: 'human' });
          await pauseContentExecutionJobsForRun({ dataStore: store, tenantId, runId: run.id, origin: 'workflow_run_pause', now });
          await appendEvent({ tenantId, runId: run.id, type: 'workflow.paused', level: 'warning', summary: '运行已由人工暂停' });
          await appendAudit({ tenantId, userId, action: 'workflow.paused', targetType: 'workflow_run', targetId: run.id });
        } else if (run.status === 'paused') {
          // Idempotent replay repairs jobs if a previous request persisted the
          // fail-closed run state but was interrupted before finishing the batch.
          await pauseContentExecutionJobsForRun({ dataStore: store, tenantId, runId: run.id, origin: 'workflow_run_pause' });
        }
        res.json(await buildOverview(tenantId));
      });
    });
  }

  function registerPostRunsRunIdResume() {
    digitalEmployeesRouter.post('/runs/:runId/resume', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      await withDigitalEmployeeRunLock(tenantId, req.params.runId, async () => {
        const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
        if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
        if (run.status === 'paused') {
          const pendingApproval = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, run_id: run.id, status: 'pending' });
          await resumeContentExecutionJobsForRun({ dataStore: store, tenantId, runId: run.id, origin: 'workflow_run_pause' });
          await store.update(COLLECTION.runs, run.id, { status: pendingApproval ? 'waiting_approval' : 'running', pause_reason: '', current_controller: pendingApproval ? 'human' : 'agent' });
          await appendEvent({ tenantId, runId: run.id, type: 'workflow.resumed', level: 'success', summary: pendingApproval ? '运行已恢复，继续等待审批' : '运行已恢复' });
          await appendAudit({ tenantId, userId, action: 'workflow.resumed', targetType: 'workflow_run', targetId: run.id });
          if (!pendingApproval) await advanceRun(tenantId, run.id);
        }
        res.json(await buildOverview(tenantId));
      });
    });
  }

  async function cancelDigitalEmployeeRunRoute(req: Request, res: Response): Promise<void> {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      await cancelDigitalEmployeeRunApplication({ tenantId, userId, runId: req.params.runId, reason: String(req.body?.reason || '') });
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && 'code' in error) {
        res.status(Number(error.status)).json({ error: String(error.code) });
        return;
      }
      throw error;
    }
    res.json(await buildOverview(tenantId));
  }

  function registerPostRunsRunIdCancel() {
    digitalEmployeesRouter.post('/runs/:runId/cancel', cancelDigitalEmployeeRunRoute);
  }

  return { registerPostRunsRunIdReconcile, registerPostTasksTaskIdHandoff, registerPostTasksTaskIdReturnToAgent, registerPostRunsRunIdPause, registerPostRunsRunIdResume, registerPostRunsRunIdCancel };
}
