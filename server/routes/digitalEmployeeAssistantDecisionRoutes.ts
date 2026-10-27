import { createHash } from 'node:crypto';
import { contentGenerationAuthorization } from '../../shared/contracts/contentGenerationAuthorization.js';
import { listTenantEmployees } from './auth.js';
import { type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { pauseContentExecutionJobsForRun } from '../contentExecution/durableQueue.js';
import { type Request, type Response } from 'express';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { isDigitalEmployeeOperatingGoal } from '../digitalEmployees/overviewGoalScope.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { planWorkflowHandoffAdmission } from '../digitalEmployees/workflowHandoffPolicy.js';
import { AssistantDecisionValidationError, executeAssistantDecisionCommand, approvalDecisionVersion, weeklyPlanDecisionVersion, workflowTaskDecisionVersion } from '../digitalEmployees/assistantDecisionCenter.js';
import { normalizeAssistantDecisionPage, normalizeAssistantDecisionExecutionReceipt, type AssistantDecisionExecutionReceipt, type AssistantDecisionActionId, type AssistantDecisionCard } from '../../shared/contracts/assistantDecisionCenter.js';
import { createAssistantDecisionFeedForRequest } from '../digitalEmployees/assistantDecisionFeedService.js';
import { customerApprovalRequestHash } from '../digitalEmployees/customerTaskApprovalNavigation.js';
import { decideDigitalEmployeeApproval as decideDigitalEmployeeApprovalUseCase, DigitalEmployeeApprovalDecisionError } from '../digitalEmployees/approvalDecision.js';
import { starter198Repository } from '../starter198/repository.js';
import { starter198OrgRole } from '../starter198/profile.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { runStarter198Command, Starter198CommandError } from '../starter198/commands.js';
import { createStarter198ApprovalDecisionPort } from '../starter198/approvalDecision.js';
import { createStarter198QuoteDecisionPort } from '../starter198/quoteDecision.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type GoalRecord, type HandoffRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../digitalEmployees/records.js';
import type { DigitalEmployeeApplicationPorts } from '../digitalEmployees/applicationPorts.js';

export function createDigitalEmployeeAssistantDecisionRoutes(deps: Pick<DigitalEmployeeApplicationPorts, 'committedDigitalEmployeeOperatingGoals' | 'first' | 'tenantRecord' | 'activeWorkflowHandoffsForRun' | 'handoffPolicyIdentity' | 'requiredCreate' | 'appendEvent' | 'appendAudit' | 'digitalEmployeesRouter' | 'weeklyGoalFactRebuildTargetCommitted' | 'approveGoalForReview' | 'buildOverview' | 'applyTaskControl' | 'queueDigitalEmployeeRunAdvance'>) {
  const committedDigitalEmployeeOperatingGoals: DigitalEmployeeApplicationPorts['committedDigitalEmployeeOperatingGoals'] = (...args) => deps.committedDigitalEmployeeOperatingGoals(...args);

  function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
    return deps.first<T>(collection, where, sort);
  }

  function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
    return deps.tenantRecord<T>(collection, id, tenantId);
  }

  const activeWorkflowHandoffsForRun: DigitalEmployeeApplicationPorts['activeWorkflowHandoffsForRun'] = (...args) => deps.activeWorkflowHandoffsForRun(...args);

  const handoffPolicyIdentity: DigitalEmployeeApplicationPorts['handoffPolicyIdentity'] = (...args) => deps.handoffPolicyIdentity(...args);

  function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
    return deps.requiredCreate<T>(collection, payload);
  }

  const appendEvent: DigitalEmployeeApplicationPorts['appendEvent'] = (...args) => deps.appendEvent(...args);

  const appendAudit: DigitalEmployeeApplicationPorts['appendAudit'] = (...args) => deps.appendAudit(...args);

  const digitalEmployeesRouter = deps.digitalEmployeesRouter;

  const weeklyGoalFactRebuildTargetCommitted: DigitalEmployeeApplicationPorts['weeklyGoalFactRebuildTargetCommitted'] = (...args) => deps.weeklyGoalFactRebuildTargetCommitted(...args);

  const approveGoalForReview: DigitalEmployeeApplicationPorts['approveGoalForReview'] = (...args) => deps.approveGoalForReview(...args);

  const buildOverview: DigitalEmployeeApplicationPorts['buildOverview'] = (...args) => deps.buildOverview(...args);

  const applyTaskControl: DigitalEmployeeApplicationPorts['applyTaskControl'] = (...args) => deps.applyTaskControl(...args);

  const queueDigitalEmployeeRunAdvance: DigitalEmployeeApplicationPorts['queueDigitalEmployeeRunAdvance'] = (...args) => deps.queueDigitalEmployeeRunAdvance(...args);

  const starterAssistantApprovalDecision = createStarter198ApprovalDecisionPort();

  const starterAssistantQuoteDecision = createStarter198QuoteDecisionPort();

  const assistantDecisionFeedForRequest = createAssistantDecisionFeedForRequest({
    committedGoals: committedDigitalEmployeeOperatingGoals,
    first,
    tenantRecord,
  });

  class AssistantDecisionCommandError extends Error {
    constructor(readonly code: string, readonly status: number, readonly details: Record<string, unknown> = {}) {
      super(code);
      this.name = 'AssistantDecisionCommandError';
    }
  }

  function assertAssistantDecisionVersion(decision: AssistantDecisionCard, currentVersion: string): void {
    if (decision.subject.version !== currentVersion) {
      throw new AssistantDecisionValidationError('assistant_decision_changed', 409, { currentVersion });
    }
  }

  async function takeOverWorkflowTask(input: { tenantId: string; userId: string; taskId: string; decision: AssistantDecisionCard }): Promise<void> {
    const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, input.tenantId);
    if (!initialTask) throw new AssistantDecisionCommandError('task_not_found', 404);
    await withDigitalEmployeeRunLock(input.tenantId, initialTask.run_id, async () => {
      const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, input.tenantId);
      if (!task) throw new AssistantDecisionCommandError('task_not_found', 404);
      if (input.decision.subject.type === 'approval_request') {
        const approval = await tenantRecord<ApprovalRecord>(COLLECTION.approvals, input.decision.subject.id, input.tenantId);
        if (!approval || approval.task_id !== task.id || approval.status !== 'pending') throw new AssistantDecisionCommandError('assistant_decision_not_pending', 409);
        assertAssistantDecisionVersion(input.decision, approvalDecisionVersion(approval));
      } else {
        assertAssistantDecisionVersion(input.decision, workflowTaskDecisionVersion(task));
      }
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, input.tenantId);
      if (!run || !['waiting_external', 'waiting_approval', 'running', 'paused', 'waiting_human'].includes(run.status)) {
        throw new AssistantDecisionCommandError('run_not_handoff_ready', 409);
      }
      const activeHandoffs = await activeWorkflowHandoffsForRun(input.tenantId, run.id);
      const admission = planWorkflowHandoffAdmission(activeHandoffs.map(handoffPolicyIdentity), {
        taskId: task.id,
        userId: input.userId,
      });
      if (admission.kind === 'conflict') {
        throw new AssistantDecisionCommandError(admission.code, 409, {
          activeTaskIds: admission.activeHandoffs.map(handoff => handoff.taskId),
        });
      }
      if (task.status === 'handed_off' && task.owner_id === input.userId) {
        if (admission.kind !== 'reuse') throw new AssistantDecisionCommandError('handoff_context_missing', 409);
        await pauseContentExecutionJobsForRun({ dataStore: store, tenantId: input.tenantId, runId: run.id, origin: 'workflow_handoff' });
        return;
      }
      if (!['waiting_external', 'waiting_approval', 'waiting_human', 'running', 'failed', 'pending'].includes(task.status)) {
        throw new AssistantDecisionCommandError('task_not_handoff_ready', 409);
      }
      const now = new Date().toISOString();
      const existingSession = admission.kind === 'reuse'
        ? activeHandoffs.find(handoff => handoff.id === admission.handoff.id) || null
        : null;
      const session = existingSession || await requiredCreate<HandoffRecord>(COLLECTION.handoffs, {
        tenant_id: input.tenantId,
        run_id: run.id,
        task_id: task.id,
        status: 'active',
        taken_by: input.userId,
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
      await store.update(COLLECTION.runs, run.id, { status: 'waiting_human', current_controller: input.userId, pause_reason: '人工完整接管' });
      await pauseContentExecutionJobsForRun({ dataStore: store, tenantId: input.tenantId, runId: run.id, origin: 'workflow_handoff', now: new Date(now) });
      await store.update(COLLECTION.tasks, task.id, { status: 'handed_off', owner_id: input.userId, blocked_reason: '人工完整接管', updated_at: now });
      await appendEvent({ tenantId: input.tenantId, runId: run.id, taskId: task.id, type: 'handoff.started', level: 'warning', summary: `${task.title} 已由人工完整接管`, payload: { handoffId: session.id } });
      await appendAudit({ tenantId: input.tenantId, userId: input.userId, action: 'handoff.started', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, handoffId: session.id } });
    });
  }

  function registerGetAssistantDecisionCenter() {
    digitalEmployeesRouter.get('/assistant/decision-center', async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const identity = res.locals as AuthLocals;
      const page = normalizeAssistantDecisionPage(req.query.page);
      const goalId = String(req.query.goalId || '').trim();
      const decisionId = String(req.query.decisionId || '').trim();
      const expectedVersion = String(req.query.expectedVersion || '').trim();
      if (goalId) {
        const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, identity.tenantId);
        if (!goal || !isDigitalEmployeeOperatingGoal(goal) || !await weeklyGoalFactRebuildTargetCommitted(identity.tenantId, goal)) {
          res.status(404).json({ error: 'goal_not_found' });
          return;
        }
      }
      if (decisionId && !/^[a-z0-9:_-]{1,200}$/i.test(decisionId)) {
        res.status(400).json({ error: 'assistant_decision_id_invalid' });
        return;
      }
      const feed = await assistantDecisionFeedForRequest(req, identity, page, goalId, decisionId ? 100 : undefined);
      const selected = decisionId ? feed.items.filter(item => item.id === decisionId
        && (!expectedVersion || item.subject.version === expectedVersion)) : feed.items;
      res.json(decisionId ? { ...feed, items: selected, total: selected.length } : feed);
    });
  }

  function registerPostAssistantDecisionCenterDecisionIdActions() {
    digitalEmployeesRouter.post('/assistant/decision-center/:decisionId/actions', async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const identity = res.locals as AuthLocals;
      const page = normalizeAssistantDecisionPage(req.query.page ?? req.body?.page);
      const goalId = String(req.query.goalId || req.body?.goalId || '').trim();
      const decisionId = String(req.params.decisionId || '').trim();
      const actionId = String(req.body?.actionId || '').trim() as AssistantDecisionActionId;
      const expectedVersion = String(req.body?.expectedVersion || '').trim();
      const note = String(req.body?.note || '').trim().slice(0, 1000);
      if (!decisionId || !actionId || !expectedVersion) {
        res.status(400).json({ error: 'assistant_decision_command_invalid' });
        return;
      }
      try {
        if (goalId) {
          const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, identity.tenantId);
          if (!goal || !isDigitalEmployeeOperatingGoal(goal) || !await weeklyGoalFactRebuildTargetCommitted(identity.tenantId, goal)) throw new AssistantDecisionCommandError('goal_not_found', 404);
        }
        const fullFeed = await assistantDecisionFeedForRequest(req, identity, page, goalId, 100);
        const card = fullFeed.items.find(item => item.id === decisionId);
        if (!card) throw new AssistantDecisionCommandError('assistant_decision_not_pending', 409);
        let execution: AssistantDecisionExecutionReceipt | undefined;
        let commandPersisted = false;
        const outcome = await executeAssistantDecisionCommand({
          card, actionId, expectedVersion, note,
          handlers: {
            decideStarter: async (selected, decision, decisionNote) => {
              const role = starter198OrgRole(await requestOrganizationRoleStrict(req.headers.authorization, identity.userId));
              if (!role) throw new AssistantDecisionCommandError('starter_198_role_required', 403);
              const suppliedKey = String(req.body?.idempotencyKey || '').trim();
              const idempotencyKey = suppliedKey || `assistant_${createHash('sha256').update(`${identity.tenantId}|${decisionId}|${actionId}|${expectedVersion}|${decisionNote}`).digest('hex').slice(0, 40)}`;
              await runStarter198Command({
                tenantId: identity.tenantId,
                userId: identity.userId,
                role,
                request: {
                  command: 'resolve_decision', idempotencyKey, targetId: selected.subject.id, expectedVersion,
                  payload: { decision, note: decisionNote },
                },
                dependencies: {
                  repository: starter198Repository, dataStore: store,
                  approvalDecision: starterAssistantApprovalDecision, quoteDecision: starterAssistantQuoteDecision,
                },
              });
            },
            approveAndStart: async selected => {
              const generationAuthorization = contentGenerationAuthorization(req.body?.contentGenerationAuthorization);
              if (!generationAuthorization) throw new AssistantDecisionCommandError('content_generation_authorization_required', 400, {
                message: '开始任务前，请先确认授权数字员工调用已配置的内容生成模型；实际用量和费用只记录，不设创作预算上限。',
              });
              const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, selected.subject.id, identity.tenantId);
              const plan = goal ? await first<PlanRecord>(COLLECTION.plans, { tenant_id: identity.tenantId, goal_id: goal.id }) : null;
              if (!goal || !plan) throw new AssistantDecisionCommandError('assistant_decision_context_missing', 409);
              assertAssistantDecisionVersion(selected, weeklyPlanDecisionVersion(goal, plan));
              const pack = jsonObject<Record<string, unknown>>(plan.plan, {}).businessPackage as WeeklyPackage | undefined;
              const members = await listTenantEmployees(identity, req.headers.authorization);
              const result = await approveGoalForReview(identity.tenantId, identity.userId, goal.id, Number(pack?.revision || 0), members, generationAuthorization);
              if (result.status !== 200) {
                const body = result.body as Record<string, unknown>;
                throw new AssistantDecisionCommandError(String(body.error || 'plan_start_failed'), result.status, body);
              }
              const started = result.body as Awaited<ReturnType<typeof buildOverview>>;
              const run = started.run;
              execution = run?.goal_id === goal.id ? normalizeAssistantDecisionExecutionReceipt({
                goalId: goal.id, runId: run.id, status: run.status,
                taskCount: started.tasks.filter(task => task.run_id === run.id).length,
                startedAt: run.started_at,
              }) : undefined;
              if (!execution) throw new AssistantDecisionCommandError('plan_start_unconfirmed', 409, {
                message: '启动结果尚未确认，请刷新查看真实运行状态；不会重复创建同一周任务。',
              });
            },
            decideApproval: async (selected, decision, decisionNote) => {
              const approval = await tenantRecord<ApprovalRecord>(COLLECTION.approvals, selected.subject.id, identity.tenantId);
              if (!approval) throw new AssistantDecisionCommandError('approval_not_found', 404);
              assertAssistantDecisionVersion(selected, approvalDecisionVersion(approval));
              await decideDigitalEmployeeApprovalUseCase({
                tenantId: identity.tenantId, userId: identity.userId, approvalId: approval.id,
                decision, note: decisionNote, expectedSubjectVersion: String(approval.subject_version ?? '').trim(),
                expectedRequestHash: customerApprovalRequestHash({ ...approval }),
                ...(/^[a-f0-9]{64}$/.test(String(approval.content_hash || '')) ? { expectedContentHash: String(approval.content_hash) } : {}),
              });
            },
            retryTask: async selected => {
              const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, selected.subject.id, identity.tenantId);
              if (!task) throw new AssistantDecisionCommandError('task_not_found', 404);
              assertAssistantDecisionVersion(selected, workflowTaskDecisionVersion(task));
              const result = await applyTaskControl({
                tenantId: identity.tenantId,
                userId: identity.userId,
                taskId: task.id,
                expectedTaskVersion: String(task.task_version ?? task.updated_at ?? '').trim(),
                action: 'retry',
                scope: 'one_off',
                instruction: '从当前节点重试；先复用未使用且已完成精确分析的爆款素材，只补采仍缺少的数量。',
                rerunDownstream: true,
              });
              queueDigitalEmployeeRunAdvance(identity.tenantId, result.runId);
            },
            replanTask: async selected => {
              const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, selected.subject.id, identity.tenantId);
              if (!task) throw new AssistantDecisionCommandError('task_not_found', 404);
              assertAssistantDecisionVersion(selected, workflowTaskDecisionVersion(task));
              const result = await applyTaskControl({
                tenantId: identity.tenantId,
                userId: identity.userId,
                taskId: task.id,
                expectedTaskVersion: String(task.task_version ?? task.updated_at ?? '').trim(),
                action: 'replan',
                scope: 'one_off',
                instruction: '保留已经完成的结果，按当前账号、产量和爆款库存重新规划本周任务。',
                rerunDownstream: true,
              });
              queueDigitalEmployeeRunAdvance(identity.tenantId, result.runId);
            },
            takeOver: async selected => {
              let taskId = selected.subject.id;
              if (selected.subject.type === 'approval_request') {
                const approval = await tenantRecord<ApprovalRecord>(COLLECTION.approvals, selected.subject.id, identity.tenantId);
                if (!approval) throw new AssistantDecisionCommandError('approval_not_found', 404);
                taskId = approval.task_id;
              }
              await takeOverWorkflowTask({ tenantId: identity.tenantId, userId: identity.userId, taskId, decision: selected });
            },
          },
        });
        commandPersisted = outcome === 'completed';
        const feed = await assistantDecisionFeedForRequest(req, identity, page, goalId).catch(error => {
          // A secondary read failure must not turn an already persisted command
          // into a visible failure. Only retire the exact confirmed decision; the
          // remaining snapshot will be refreshed by normal feed polling.
          if (!commandPersisted) throw error;
          return {
            ...fullFeed,
            items: fullFeed.items.filter(item => item.id !== card.id),
            total: Math.max(0, fullFeed.total - 1),
          };
        });
        res.json({ ok: true, outcome, ...feed, ...(execution ? { execution } : {}) });
      } catch (error) {
        if (error instanceof AssistantDecisionCommandError) {
          res.status(error.status).json({ error: error.code, ...error.details });
          return;
        }
        if (error instanceof AssistantDecisionValidationError) {
          res.status(error.status).json({ error: error.code, ...error.details });
          return;
        }
        if (error instanceof DigitalEmployeeApprovalDecisionError) {
          res.status(error.status).json({ error: error.code, ...error.details });
          return;
        }
        if (error instanceof Starter198CommandError) {
          res.status(error.status).json({ error: error.code, message: error.message });
          return;
        }
        throw error;
      }
    });
  }

  async function decideDigitalEmployeeApproval(req: Request, res: Response): Promise<void> {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      await decideDigitalEmployeeApprovalUseCase({
        tenantId,
        userId,
        approvalId: req.params.approvalId,
        decision: String(req.body?.decision || '') as 'approved' | 'rejected',
        note: String(req.body?.note || ''),
        ...(req.body?.expectedContentHash!==undefined?{expectedContentHash:String(req.body.expectedContentHash)}:{}),
        ...(req.body?.expectedRequestHash!==undefined?{expectedRequestHash:String(req.body.expectedRequestHash)}:{}),
        ...(req.body?.expectedSubjectVersion !== undefined
          ? { expectedSubjectVersion: String(req.body.expectedSubjectVersion).trim() }
          : {}),
      });
      res.json(await buildOverview(tenantId));
    } catch (error) {
      if (error instanceof DigitalEmployeeApprovalDecisionError) {
        res.status(error.status).json({ error: error.code, ...error.details });
        return;
      }
      throw error;
    }
  }

  function registerPostApprovalsApprovalIdDecide() {
    digitalEmployeesRouter.post('/approvals/:approvalId/decide', decideDigitalEmployeeApproval);
  }

  return { registerGetAssistantDecisionCenter, registerPostAssistantDecisionCenterDecisionIdActions, registerPostApprovalsApprovalIdDecide };
}
