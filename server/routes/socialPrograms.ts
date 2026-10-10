import { createSocialWeeklyProducerEvidenceRouter } from './socialWeeklyProducerEvidence.js';
import {createSocialWeeklyInventoryReuseRouter} from './socialWeeklyInventoryReuse.js';
import {createWeeklyInventoryReuseService} from '../socialPrograms/weeklyInventoryReuse.js';
import {createSocialWeeklyProfileUpgradeRouter} from './socialWeeklyProfileUpgrade.js';
import {createWeeklyProfileUpgradeService} from '../socialPrograms/weeklyProfileUpgrade.js';
import { createSocialCrossWeekMaterialContinuationsRouter } from './socialCrossWeekMaterialContinuations.js';
import { createSocialWeeklyCustomerKnowledgeQuoteRouter } from './socialWeeklyCustomerKnowledgeQuote.js';
import { createSocialWeeklyPublicationRecoveryRouter } from './socialWeeklyPublicationRecovery.js';
import { createWeeklyPublicationRecoveryService } from '../socialPrograms/weeklyPublicationRecovery.js';
import { createSocialWeeklyNativeSendRecoveryRouter } from './socialWeeklyNativeSendRecovery.js';
import { createWeeklyNativeSendRecoveryService } from '../socialPrograms/weeklyNativeSendRecovery.js';
import { createSocialWeeklyNativeDispatchRouter } from './socialWeeklyNativeDispatch.js';
import { createWeeklyNativeFollowupDispatchService } from '../digitalEmployees/weeklyNativeFollowupDispatch.js';
import { Router, type RequestHandler } from 'express';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { createSocialProgramService, SocialProgramError } from '../socialPrograms/service.js';
import { readWeeklyCancellation } from '../socialPrograms/weeklyCancellation.js';
import {readWeeklyCancellationSettlements} from '../socialPrograms/weeklyCancellationSettlement.js';
import {recheckWeeklyRequiredMaterials} from '../socialPrograms/weeklyRequiredMaterialRecovery.js';
import {readWeeklyContentNavigation} from '../socialPrograms/weeklyContentNavigation.js';
import {readWeeklyReferenceReviewNavigation} from '../socialPrograms/weeklyReferenceReviewNavigation.js';
import { createWeeklyOperatingPackageService } from '../socialPrograms/weeklyOperatingPackages.js';
import { createSocialOperatingOrchestrationService, weeklyAuthorityFromResolution } from '../socialOperating/orchestration.js';
import { SocialOperatingDecisionError } from '../socialOperating/service.js';
import type { OperatingPlanningRequest } from '../../shared/contracts/socialOperatingDecision.js';
import { createWeeklyExecutionTaskService } from '../socialPrograms/executionTasks.js';
import { revokePublicationAssignments } from '../publishing/weeklyLineage.js';
import { assessWeeklyRecovery } from '../socialPrograms/weeklyRecoveryAssessment.js';
import { planWeeklyBackwardSchedule } from '../socialPrograms/weeklyBackwardSchedule.js';
import { bindWeeklyCustomerRun, readWeeklyCustomerStep, readWeeklyCustomerCalendar, listWeeklyCustomerRunCandidates, type WeeklyCustomerStep } from '../runtime/socialWeeklyCustomerBridge.js';
import { savePublicationReceptionBinding } from '../socialPrograms/publicationReceptionService.js';
import { createSocialWeeklyMaterialRequestsRouter } from './socialWeeklyMaterialRequests.js';
import { createSocialWeeklySalesHandoffsRouter } from './socialWeeklySalesHandoffs.js';
import { createSocialWeeklyCustomerSendRecoveryRouter } from './socialWeeklyCustomerSendRecovery.js';
import { createSocialWeeklyCustomerChannelScopeRouter } from './socialWeeklyCustomerChannelScope.js';
import { createWeeklyCustomerSendRecoveryService } from '../socialPrograms/weeklyCustomerSendRecovery.js';
import { createSocialWeeklySalesConversationEvidenceRouter } from './socialWeeklySalesConversationEvidence.js';
import { createSocialWeeklyScheduleRevisionsRouter } from './socialWeeklyScheduleRevisions.js';
import { createWeeklyInitialScheduleRouter } from './weeklyInitialSchedule.js';
import { createSocialWeeklyMaterialEvidenceConfigurationRouter } from './socialWeeklyMaterialEvidenceConfiguration.js';
import { createSocialCustomerFeedbackTopicsRouter } from './socialCustomerFeedbackTopics.js';
import { projectWeeklyContinuationCalendar } from '../socialPrograms/weeklyContinuationCalendar.js';
import { createSocialWeeklyContentTemplatesRouter } from './socialWeeklyContentTemplates.js';
import { createSocialWeeklyReviewEvidenceRouter } from './socialWeeklyReviewEvidence.js';
import { createSocialWeeklyRunningResourceEvidenceRouter } from './socialWeeklyRunningResourceEvidence.js';
import { createSocialWeeklySupplementRequestsRouter } from './socialWeeklySupplementRequests.js';
import {createWeeklyProductionRepairCaseService} from '../socialPrograms/weeklyProductionRepairCases.js';
import {createWeeklyTechnicalRepairCompletionService} from '../socialPrograms/weeklyTechnicalRepairCompletion.js';
import {createWeeklyCreativeRepairConfigurationService} from '../socialPrograms/weeklyCreativeRepairConfiguration.js';
import {createWeeklyCreativeRepairExecutionService} from '../socialPrograms/weeklyCreativeRepairExecution.js';
import {createWeeklyCreativeRepairCompletionService} from '../socialPrograms/weeklyCreativeRepairCompletion.js';
import {createWeeklyCreativeRepairProductionPort} from '../runtime/weeklyCreativeRepairProductionPort.js';
import {createSocialWeeklyCreativeRepairExecutionRouter} from './socialWeeklyCreativeRepairExecution.js';
import {assertSocialSceneReworkQueueRegistered,wakeSocialSceneReworkJob} from '../starter198/socialContentProductionQueue.js';

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

type RouteBody = Record<string, unknown>;
function routeBody(value: unknown): RouteBody | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RouteBody : null;
}
export function parseWeeklyCreativeRepairConfigurationBody(value: unknown) {
  const body=routeBody(value);
  if(!body||Object.keys(body).some(key=>!['packageVersion','expectedCaseHash','revisionScope','estimatedDurationMinutes','maximumCostCny','deadlineAt'].includes(key))||typeof body.expectedCaseHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseHash)||typeof body.revisionScope!=='string'||body.revisionScope!==body.revisionScope.trim()||!body.revisionScope||body.revisionScope.length>4000||!Number.isSafeInteger(body.estimatedDurationMinutes)||Number(body.estimatedDurationMinutes)<1||Number(body.estimatedDurationMinutes)>1440||typeof body.maximumCostCny!=='number'||!Number.isFinite(body.maximumCostCny)||body.maximumCostCny<0||typeof body.deadlineAt!=='string'||!Number.isFinite(Date.parse(body.deadlineAt)))throw new SocialProgramError('weekly_creative_repair_input_invalid',400,'创意修订配置无效。');
  return{expectedCaseHash:body.expectedCaseHash,revisionScope:body.revisionScope,estimatedDurationMinutes:Number(body.estimatedDurationMinutes),maximumCostCny:body.maximumCostCny,deadlineAt:body.deadlineAt};
}
export function assertWeeklyTechnicalRepairReconcileBody(value: unknown): void {
  const body=routeBody(value);
  if(!body||Object.keys(body).some(key=>key!=='packageVersion'))throw new SocialProgramError('weekly_repair_reconcile_input_invalid',400,'返工结果核验参数无效。');
}
export function parseWeeklyTechnicalQualityRecoveryBody(value: unknown) {
  const body=routeBody(value);
  if(!body||Object.keys(body).some(key=>!['packageVersion','requestId','expectedContextHash'].includes(key))||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,160}$/.test(body.requestId)||typeof body.expectedContextHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedContextHash))throw new SocialProgramError('weekly_repair_quality_recovery_input_invalid',400,'质量复核恢复参数无效。');
  return{requestId:body.requestId,expectedContextHash:body.expectedContextHash};
}

export function createSocialProgramsRouter(dataStore: DataStore = store, authenticate = true): Router {
  const router = Router();
  if (authenticate) router.use(requireAuth, enforceSupportSessionReadOnly);
  const service = createSocialProgramService(dataStore);
  router.use('/:programId/operating-packages/:packageId/producer-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyProducerEvidenceRouter(dataStore));
  const weeklyPackages = createWeeklyOperatingPackageService(dataStore);
  const operating = createSocialOperatingOrchestrationService(dataStore);
  const executionTasks = createWeeklyExecutionTaskService(dataStore);
  const repairCases=createWeeklyProductionRepairCaseService(dataStore);
  const technicalRepairCompletion=createWeeklyTechnicalRepairCompletionService(dataStore);
  const creativeRepairConfiguration=createWeeklyCreativeRepairConfigurationService(dataStore);
  const creativeRepairExecution=createWeeklyCreativeRepairExecutionService(dataStore,createWeeklyCreativeRepairProductionPort(dataStore));
  const creativeRepairCompletion=createWeeklyCreativeRepairCompletionService(dataStore);
  router.use('/:programId/operating-packages/:packageId/supplement-requests', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklySupplementRequestsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/running-resource-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyRunningResourceEvidenceRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/review-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyReviewEvidenceRouter(dataStore));
  router.use('/:programId/content-templates', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyContentTemplatesRouter(dataStore));
  router.use('/:programId/customer-feedback-topics', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialCustomerFeedbackTopicsRouter(dataStore));
  router.use('/:programId/material-requests', asyncRoute(async (req, res, next) => {
    const { tenantId } = res.locals as AuthLocals;
    await service.getProgram(tenantId, String(req.params.programId || ''));
    next();
  }), createSocialWeeklyMaterialRequestsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/initial-schedule', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createWeeklyInitialScheduleRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/schedule-revisions', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyScheduleRevisionsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/material-evidence-configuration', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyMaterialEvidenceConfigurationRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/customer-channel-scope', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyCustomerChannelScopeRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/inventory-reuse',asyncRoute(async(req,res,next)=>{await service.getProgram((res.locals as AuthLocals).tenantId,req.params.programId);next();}),createSocialWeeklyInventoryReuseRouter(createWeeklyInventoryReuseService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/profile-upgrades', asyncRoute(async (req,res,next)=>{
    await service.getProgram((res.locals as AuthLocals).tenantId,req.params.programId);next();
  }),createSocialWeeklyProfileUpgradeRouter(createWeeklyProfileUpgradeService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/cross-week-material-continuations', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialCrossWeekMaterialContinuationsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/customer-knowledge-quote-requests', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyCustomerKnowledgeQuoteRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/publication-recoveries', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyPublicationRecoveryRouter(createWeeklyPublicationRecoveryService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/native-send-recoveries', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyNativeSendRecoveryRouter(createWeeklyNativeSendRecoveryService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/native-dispatch', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyNativeDispatchRouter(dataStore, createWeeklyNativeFollowupDispatchService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/send-recoveries', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklyCustomerSendRecoveryRouter(createWeeklyCustomerSendRecoveryService(dataStore)));
  router.use('/:programId/operating-packages/:packageId/sales-handoffs', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklySalesHandoffsRouter(dataStore));
  router.use('/:programId/operating-packages/:packageId/sales-conversation-evidence', asyncRoute(async (req, res, next) => {
    await service.getProgram((res.locals as AuthLocals).tenantId, req.params.programId);
    next();
  }), createSocialWeeklySalesConversationEvidenceRouter(dataStore));

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
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/merge', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.mergeAgentSchedule(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/confirm', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.confirmAgentSchedule(
      tenantId, userId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.post('/:programId/operating-packages/:packageId/agent-planning/dispatch', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json({ item: await weeklyPackages.dispatchAgentSchedule(
      tenantId, String(req.params.programId || ''), String(req.params.packageId || ''), { expectedPackageVersion: req.body?.expectedPackageVersion, expectedPlanningVersion: req.body?.expectedPlanningVersion, selectedSlotIds: req.body?.selectedSlotIds },
    ) });
  }));

  router.get('/:programId/operating-packages/:packageId/cancellation', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const version = Number(req.query.version ?? pkg.version);
    if (!Number.isSafeInteger(version) || version < 1) throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    const summary = await readWeeklyCancellation(dataStore, tenantId, programId, packageId, version);
    res.json({ item: summary ? {...summary, currentSettlements: await readWeeklyCancellationSettlements({dataStore, tenantId, programId, packageId, packageVersion: version})} : null });
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks/:taskId/reference-review-navigation', asyncRoute(async (req, res) => {
    const {tenantId} = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1 || typeof req.query.recordId !== 'string') throw new SocialProgramError('reference_navigation_scope_invalid', 400, '请选择当前周任务的具体参考视频。');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({item: await readWeeklyReferenceReviewNavigation(dataStore, {tenantId, programId: String(req.params.programId), packageId: String(req.params.packageId), packageVersion, executionTaskId: String(req.params.taskId)}, req.query.recordId)});
  }));

  router.get('/:programId/operating-packages/:packageId/execution-tasks/:taskId/production-navigation', asyncRoute(async (req, res) => {
    const {tenantId} = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '周包版本无效。');
    res.json({item: await readWeeklyContentNavigation(dataStore, {tenantId, programId: String(req.params.programId), packageId: String(req.params.packageId), packageVersion, executionTaskId: String(req.params.taskId)})});
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
    res.json({ items: await projectWeeklyContinuationCalendar(dataStore, await executionTasks.list(tenantId, programId, packageId, requestedVersion)) });
  }));

  router.get('/:programId/operating-packages/:packageId/repair-cases',asyncRoute(async(req,res)=>{
    const {tenantId}=res.locals as AuthLocals,programId=String(req.params.programId||''),packageId=String(req.params.packageId||'');
    await service.getProgram(tenantId,programId);const pkg=await weeklyPackages.get(tenantId,programId,packageId),requestedVersion=Number(req.query.version??pkg.version);
    if(!Number.isSafeInteger(requestedVersion)||requestedVersion<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');
    res.setHeader('Cache-Control','private, no-store');res.json({items:await repairCases.list(tenantId,programId,packageId,requestedVersion)});
  }));
  const repairCaseScope=async(req:Parameters<RequestHandler>[0],res:Parameters<RequestHandler>[1])=>{const{tenantId,userId}=res.locals as AuthLocals,programId=String(req.params.programId||''),packageId=String(req.params.packageId||''),caseId=String(req.params.caseId||''),version=Number(req.query.version??req.body?.packageVersion);if(!Number.isSafeInteger(version)||version<1)throw new SocialProgramError('package_version_invalid',400,'周包版本无效。');await service.getProgram(tenantId,programId);const item=await repairCases.read(tenantId,caseId);if(item.programId!==programId||item.packageId!==packageId||item.packageVersion!==version)throw new SocialProgramError('weekly_repair_case_scope_invalid',404,'返工任务不属于当前周包。');return{tenantId,userId,programId,packageId,caseId,version,item};};
  router.use('/:programId/operating-packages/:packageId/repair-cases/:caseId/creative-execution',createSocialWeeklyCreativeRepairExecutionRouter({execution:creativeRepairExecution,completion:creativeRepairCompletion,resolveScope:async(req,res,packageVersion)=>{const scoped=await repairCaseScope(req,res);if(scoped.version!==packageVersion)throw new SocialProgramError('package_version_conflict',409,'周包版本已变化，请刷新后重试。');return{...scoped,packageVersion:scoped.version};}}));
  router.get('/:programId/operating-packages/:packageId/repair-cases/:caseId/capacity-preview',asyncRoute(async(req,res)=>{const scope=await repairCaseScope(req,res);if(Object.keys(req.query).some(key=>key!=='version'))throw new SocialProgramError('weekly_repair_case_query_invalid',400,'容量预览参数无效。');res.setHeader('Cache-Control','private, no-store');res.json({item:await repairCases.previewTechnicalCapacity(scope.tenantId,scope.userId,scope.caseId)});}));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/confirm-capacity',asyncRoute(async(req,res)=>{const scope=await repairCaseScope(req,res),body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['packageVersion','expectedCaseRecordHash','expectedPreviewHash','expectedQuoteHash','authorizedMaximumCostCny'].includes(key))||typeof body.expectedCaseRecordHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseRecordHash)||typeof body.expectedPreviewHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedPreviewHash)||body.expectedQuoteHash!==undefined&&(typeof body.expectedQuoteHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedQuoteHash))||typeof body.authorizedMaximumCostCny!=='number'||!Number.isFinite(body.authorizedMaximumCostCny)||body.authorizedMaximumCostCny<0)throw new SocialProgramError('weekly_repair_case_capacity_input_invalid',400,'容量确认参数无效。');res.json({item:await repairCases.confirmTechnicalCapacity(scope.tenantId,scope.userId,scope.caseId,{expectedCaseRecordHash:body.expectedCaseRecordHash,expectedPreviewHash:body.expectedPreviewHash,...(body.expectedQuoteHash?{expectedQuoteHash:body.expectedQuoteHash}:{}),authorizedMaximumCostCny:body.authorizedMaximumCostCny})});}));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/start',asyncRoute(async(req,res)=>{const scope=await repairCaseScope(req,res),body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['packageVersion','expectedCaseRecordHash'].includes(key))||typeof body.expectedCaseRecordHash!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedCaseRecordHash))throw new SocialProgramError('weekly_repair_case_start_input_invalid',400,'返工作业启动参数无效。');await assertSocialSceneReworkQueueRegistered();const item=await repairCases.startTechnical(scope.tenantId,scope.userId,scope.caseId,{expectedCaseRecordHash:body.expectedCaseRecordHash});if(item.execution)await wakeSocialSceneReworkJob(item.execution.jobId).catch(()=>undefined);res.status(202).json({item});}));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/configure',asyncRoute(async(req,res)=>{
    const scope=await repairCaseScope(req,res),input=parseWeeklyCreativeRepairConfigurationBody(req.body);
    res.json({item:await creativeRepairConfiguration.configure(scope.tenantId,scope.userId,scope.caseId,input)});
  }));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/reconcile',asyncRoute(async(req,res)=>{
    const scope=await repairCaseScope(req,res);assertWeeklyTechnicalRepairReconcileBody(req.body);
    res.setHeader('Cache-Control','private, no-store');res.json({item:await technicalRepairCompletion.reconcile(scope.tenantId,scope.userId,scope.caseId)});
  }));
  router.post('/:programId/operating-packages/:packageId/repair-cases/:caseId/recover-quality',asyncRoute(async(req,res)=>{
    const scope=await repairCaseScope(req,res),input=parseWeeklyTechnicalQualityRecoveryBody(req.body);
    res.json({item:await technicalRepairCompletion.recoverQuality(scope.tenantId,scope.userId,scope.caseId,input)});
  }));

  router.post('/:programId/operating-packages/:packageId/publications/:publicationId/reception-binding', asyncRoute(async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || ''), packageId = String(req.params.packageId || ''), publicationId = String(req.params.publicationId || '');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    const packageVersion = Number(req.body?.packageVersion);
    if (![pkg.version, pkg.version + 1].includes(packageVersion)) throw new SocialProgramError('package_version_conflict', 409, '绑定只能用于当前版本或下一次明确修订。');
    const publication = pkg.socialContentPackage.publicationTasks.find(item => item.publicationTaskId === publicationId);
    if (!publication) throw new SocialProgramError('weekly_publication_identity_invalid', 404, '当前周包不包含该发布任务。');
    try {
      const item = await savePublicationReceptionBinding(dataStore, {
        tenantId, programId, packageId, packageVersion, publicationId,
        cta: packageVersion === pkg.version ? publication.cta ?? '' : req.body?.cta,
        enterpriseFactHash: req.body?.enterpriseFactHash,
        targets: req.body?.targets,
      }, userId);
      res.json({ item, planningRevisionRequired: true });
    } catch (error) { throw new SocialProgramError('publication_reception_binding_invalid', 400, error instanceof Error ? error.message : '承接绑定无效。'); }
  }));

  router.get('/:programId/operating-packages/:packageId/customer-run-candidates', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定周包版本。');
    res.json(await listWeeklyCustomerRunCandidates(dataStore, { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion }));
  }));

  router.get('/:programId/operating-packages/:packageId/customer-run-binding', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const packageVersion = Number(req.query.version);
    if (!Number.isSafeInteger(packageVersion) || packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定周包版本。');
    res.json({ item: await readWeeklyCustomerCalendar(dataStore, { tenantId, programId: String(req.params.programId || ''), packageId: String(req.params.packageId || ''), packageVersion }) });
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

  router.post('/:programId/operating-packages/:packageId/backward-schedule', asyncRoute(async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const programId = String(req.params.programId || '');
    const packageId = String(req.params.packageId || '');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['packageVersion', 'constraints', 'resources', 'remainingBudgetCny', 'operationalDeadlines'].includes(key))) throw new SocialProgramError('weekly_backward_input_invalid', 400, '倒排只能提交明确容量条件，执行任务由服务端读取。');
    if (!Number.isSafeInteger(body.packageVersion) || body.packageVersion < 1) throw new SocialProgramError('package_version_invalid', 400, '请明确指定倒排周包版本。');
    const pkg = await weeklyPackages.get(tenantId, programId, packageId);
    if (pkg.version !== body.packageVersion) throw new SocialProgramError('package_version_conflict', 409, '周包版本已变化，请刷新后重新倒排。');
    const tasks = await executionTasks.list(tenantId, programId, packageId, body.packageVersion);
    if (!tasks.length) throw new SocialProgramError('weekly_backward_tasks_missing', 409, '该版本没有可倒排的真实执行任务。');
    try {
      const item = planWeeklyBackwardSchedule({ tasks, now: new Date().toISOString(), constraints: body.constraints, resources: body.resources, remainingBudgetCny: body.remainingBudgetCny, operationalDeadlines: body.operationalDeadlines, frozenOperationalWeek: { weekStart: pkg.weekStart, weekEnd: pkg.weekEnd } });
      res.json({ item, inputAuthority: 'stored_tasks_with_user_supplied_capacity_assumptions' });
    } catch (cause) { throw new SocialProgramError('weekly_backward_input_invalid', 400, cause instanceof Error ? cause.message : '倒排容量输入无效。'); }
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

  router.post('/:programId/operating-packages/:packageId/execution-tasks/:taskId/recheck-required-materials', asyncRoute(async (req, res) => {
    const {tenantId,userId}=res.locals as AuthLocals;
    if(!tenantId||!userId)throw new SocialProgramError('auth_required',401,'请登录后重新核验素材。');
    const version=req.body?.expectedPackageVersion;
    if(!Number.isSafeInteger(version)||version<1||Object.keys(req.body??{}).some(key=>key!=='expectedPackageVersion'))throw new SocialProgramError('weekly_material_recovery_input_invalid',400,'请指定准确周包版本。');
    res.json({items:await recheckWeeklyRequiredMaterials(dataStore,{tenantId,programId:String(req.params.programId||''),packageId:String(req.params.packageId||''),packageVersion:version,taskId:String(req.params.taskId||'')})});
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
