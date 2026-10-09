import { Router, type RequestHandler } from 'express';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { createSocialProgramService, SocialProgramError } from '../socialPrograms/service.js';
import { readWeeklyCancellation } from '../socialPrograms/weeklyCancellation.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { createSocialOperatingOrchestrationService, weeklyAuthorityFromResolution } from '../socialOperating/orchestration.js';
import { SocialOperatingDecisionError } from '../socialOperating/service.js';
import type { OperatingPlanningRequest } from '../../shared/contracts/socialOperatingDecision.js';
import { createWeeklyExecutionTaskService } from '../socialPrograms/executionTasks.js';
import { revokePublicationAssignments } from '../publishing/weeklyLineage.js';
import { assessWeeklyRecovery } from '../socialPrograms/weeklyRecoveryAssessment.js';
import { bindWeeklyCustomerRun, readWeeklyCustomerStep, type WeeklyCustomerStep } from '../runtime/socialWeeklyCustomerBridge.js';

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createSocialProgramsRouter(dataStore: DataStore = store, authenticate = true): Router {
  const router = Router();
  if (authenticate) router.use(requireAuth, enforceSupportSessionReadOnly);
  const service = createSocialProgramService(dataStore);
  const weeklyPackages = createWeeklyOperatingPackageService(dataStore);
  const operating = createSocialOperatingOrchestrationService(dataStore);
  const executionTasks = createWeeklyExecutionTaskService(dataStore);

  router.get('/', asyncRoute(async (_req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await service.listPrograms(tenantId) });
  }));

  router.post('/', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.createProgram(tenantId, userId, req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await service.getProgram(tenantId, String(req.params.programId || '')) });
  }));

  router.patch('/:programId', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.updateProgram(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.json({ item });
  }));

  router.get('/:programId/accounts', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await service.listAccounts(tenantId, String(req.params.programId || '')) });
  }));

  router.post('/:programId/accounts', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.createAccount(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.put('/:programId/accounts/:accountId/playbook', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.savePlaybook(
      tenantId, userId, String(req.params.programId || ''), String(req.params.accountId || ''), req.body || {},
    );
    res.status(201).json({ item });
  }));

  router.post('/:programId/plans/monthly', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.saveMonthlyPlan(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.post('/:programId/plans/weekly', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await service.saveWeeklyPlan(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId/operating-constraints', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await operating.getConstraints(tenantId, String(req.params.programId || '')) });
  }));

  router.put('/:programId/operating-constraints', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await operating.saveConstraints(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.post('/:programId/operating-plan/resolve', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
    // Deliberately allow-list intent only. Caller supplied readiness, capacity,
    // policy and rights fields never cross the server authority boundary.
    const request: OperatingPlanningRequest = {
      weekStart: String(body.weekStart || ''),
      ...(Number.isSafeInteger(body.desiredOriginalContents) ? { desiredOriginalContents: Number(body.desiredOriginalContents) } : {}),
      ...(Number.isSafeInteger(body.desiredAdaptations) ? { desiredAdaptations: Number(body.desiredAdaptations) } : {}),
      ...(body.requestedReferenceMode === 'ordinary_inspiration' || body.requestedReferenceMode === 'high_fidelity' || body.requestedReferenceMode === 'auto'
        ? { requestedReferenceMode: body.requestedReferenceMode } : {}),
      ...(body.referenceSelectionRef && typeof body.referenceSelectionRef === 'object' && !Array.isArray(body.referenceSelectionRef)
        ? { referenceSelectionRef: body.referenceSelectionRef as OperatingPlanningRequest['referenceSelectionRef'] } : {}),
      ...(Number.isSafeInteger(body.expectedSnapshotVersion) ? { expectedSnapshotVersion: Number(body.expectedSnapshotVersion) } : {}),
    };
    const resolution = await operating.resolve(tenantId, userId, String(req.params.programId || ''), request);
    res.status(201).json({ item: resolution, weeklyAuthority: weeklyAuthorityFromResolution(resolution) });
  }));

  router.get('/:programId/operating-snapshots/:snapshotId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const version = typeof req.query.version === 'string' ? Number(req.query.version) : undefined;
    const item = await operating.getSnapshot(tenantId, String(req.params.programId || ''), String(req.params.snapshotId || ''), version);
    res.json({ item });
  }));

  router.get('/:programId/operating-packages', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const items = await weeklyPackages.list(
      tenantId,
      String(req.params.programId || ''),
      typeof req.query.weekStart === 'string' ? req.query.weekStart : undefined,
    );
    res.json({ items });
  }));

  router.post('/:programId/operating-packages', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.create(tenantId, userId, String(req.params.programId || ''), req.body || {});
    res.status(201).json({ item });
  }));

  router.get('/:programId/operating-packages/:packageId', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const item = await weeklyPackages.get(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''),
    );
    res.json({ item });
  }));

  router.put('/:programId/operating-packages/:packageId', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const previousVersion = Number(req.body?.expectedVersion);
    const item = await weeklyPackages.revise(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    await revokePublicationAssignments({
      tenantId, operatingPackageId: String(req.params.packageId || ''),
      ...(Number.isSafeInteger(previousVersion) ? { operatingPackageVersion: previousVersion } : {}),
      revokedBy: userId, revokedAt: item.updatedAt, dataStore,
    });
    res.status(201).json({ item });
  }));

  router.post('/:programId/operating-packages/:packageId/activate', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.activate(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    res.json({ item });
  }));

  router.post('/:programId/operating-packages/:packageId/retire', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.retire(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    await revokePublicationAssignments({
      tenantId, operatingPackageId: item.packageId, operatingPackageVersion: item.version,
      revokedBy: userId, revokedAt: item.updatedAt, dataStore,
    });
    res.json({ item });
  }));

  router.get('/:programId/operating-packages/:packageId/agent-planning', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const version = typeof req.query.version === 'string' ? Number(req.query.version) : undefined;
    res.json({ item: await weeklyPackages.getAgentPlanning(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), version,
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/director-analysis', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.runDirectorPlanning(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/merge', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.mergeAgentSchedule(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/confirm', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.confirmAgentSchedule(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/dispatch', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.dispatchAgentSchedule(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion },
    ) });
  }));

  router.get('/:programId/operating-packages/:packageId/cancellation', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const version = Number(req.query.version ?? pkg.version);
    if (!Number.isSafeInteger(version) || version < 1) throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    res.json({ item: await readWeeklyCancellation(dataStore, tenantId, programId, packageId, version) });
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const requestedVersion = Number(req.query.version ?? pkg.version);
    if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) {
      throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    }
    res.json({ items: await executionTasks.list(tenantId, programId, packageId, requestedVersion) });
  }));

  router.post('/:programId/operating-packages/:packageId/customer-run-binding', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const authority = { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion: Number(req.body?.packageVersion) };
    if (!Number.isSafeInteger(authority.packageVersion) || authority.packageVersion < 1 || typeof req.body?.runId !== 'string' || !req.body.runId.trim()) {
      throw new SocialProgramError('weekly_customer_binding_input_invalid', 400, '请选择具体客服运行及周包版本。');
    }
    res.json({ item: await bindWeeklyCustomerRun(dataStore, authority, req.body.runId.trim(), userId) });
  }));

  router.get('/:programId/operating-packages/:packageId/customer-run-binding/:runId/steps/:step', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const authority = { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion: Number(req.query.version) };
    if (!Number.isSafeInteger(authority.packageVersion) || authority.packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定周包版本。');
    const step = String(req.params.step || '');
    if (!['customer_segmentation', 'customer_followup_draft', 'customer_followup_approval', 'customer_followup_dispatch'].includes(step)) {
      throw new SocialProgramError('weekly_customer_step_unsupported', 400, '客服阶段无效。');
    }
    res.json({ item: await readWeeklyCustomerStep(dataStore, authority, String(req.params.runId || ''), step as WeeklyCustomerStep) });
  }));

  router.post('/:programId/operating-packages/:packageId/recovery-assessment', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const requestedVersion = Number(req.body?.packageVersion);
    if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定需要评估的周包版本。');
    const tasks = await executionTasks.list(tenantId, programId, packageId, requestedVersion);
    if (!tasks.length || pkg.programId !== programId) throw new SocialProgramError('weekly_recovery_tasks_missing', 409, '该版本没有可评估的执行任务。');
    // Capacity inputs are explicit scenario assumptions, never persisted completion evidence.
    // Task identity, dependencies, blockers and deadlines always come from the authenticated store.
    try {
      const item = assessWeeklyRecovery({
        tasks, now: new Date().toISOString(),
        changedTaskIds: req.body?.changedTaskIds,
        constraints: req.body?.constraints,
        resources: req.body?.resources,
        remainingBudgetCny: req.body?.remainingBudgetCny,
      });
      res.json({ item, inputAuthority: 'stored_tasks_with_user_supplied_capacity_assumptions' });
    } catch (error) {
      throw new SocialProgramError('weekly_recovery_input_invalid', 400, error instanceof Error ? error.message : '补救评估输入无效。');
    }
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/block', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.block(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), String(req.body?.reason || '')) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/unblock', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.unblock(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), req.body?.reason) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/cancel', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.cancel(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), String(req.body?.reason || '')) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/recover', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.recoverDeadLetter(tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || '')) });
  }));

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/approve', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    res.json({ items: await executionTasks.approve(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), String(req.params.taskId || ''), userId,
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/workflow-events', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const item = await weeklyPackages.applyWorkflowEvent(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), req.body || {},
    );
    res.json({ item });
  }));

  router.use(((error, _req, res, next) => {
    if (!(error instanceof SocialProgramError) && !(error instanceof SocialOperatingDecisionError)) {
      next(error);
      return;
    }
    res.status(error.status).json({ error: error.code, message: error.message });
  }) as import('express').ErrorRequestHandler);

  return router;
}

export const socialProgramsRouter = createSocialProgramsRouter();
