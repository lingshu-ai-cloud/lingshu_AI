import { createTaskBusinessObservation } from '../digitalEmployees/taskBusinessObservation.js';
import { createTaskBusinessPreparation } from '../digitalEmployees/taskBusinessPreparation.js';
import { createWeeklyReviewApplication } from '../digitalEmployees/weeklyReviewApplication.js';
import { registerWeeklyReviewGenerationRoutes, registerReviewTodoRoutes } from './digitalEmployeeWeeklyReviewRoutes.js';
import { createTaskInterventionApplication } from '../digitalEmployees/taskInterventionApplication.js';
import { registerTaskInterventionRoutes } from './digitalEmployeeTaskInterventionRoutes.js';
import { createDigitalEmployeeFollowupReadRouter } from './digitalEmployeeFollowupReadRoutes.js';
import type { ReviewTodoBoard } from '../../src/lib/reviewTodos.js';

import { controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import { Router } from 'express';
import { browserExecutionEnabled, type BrowserScope, type BrowserProductionTarget } from '../digitalEmployees/browserSessions.js';
import { enforceSupportSessionReadOnly, requireAuth } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readAuthorizedWhatsAppCustomers as defaultGetWhatsAppCustomers } from '../whatsapp/authorizedCustomerRead.js';
import { currentExecutionAdapters } from '../digitalEmployees/executionAdapters.js';
import { ensureDigitalEmployeeSocialCollectionTask, runScheduledTaskNow, scheduledExecutionState } from './scheduler.js';

import { buildBusinessSnapshot as defaultBuildBusinessSnapshot } from '../digitalEmployees/businessSnapshot.js';
import { advanceAutomatedContentProduction } from '../digitalEmployees/contentProduction.js';

import { recoverStaleFollowupSending, getTenantFollowupDispatchStatus, preflightFollowupBatchDispatch } from '../digitalEmployees/followupDispatchWorker.js';
import { listConnectedPublishingAccounts } from '../digitalEmployees/publishingTargets.js';

import { createPublishingCalendarEntries } from '../digitalEmployees/publishingExecution.js';

import { createDigitalEmployeeApprovalDecisionApplication, registerDigitalEmployeeApprovalDecisionApplication } from '../digitalEmployees/approvalDecision.js';
import { enqueueApprovedContentPublicationPackageTask } from '../starter198/agentTasks.js';
import { registerProductionBudgetReforecastRoute } from './digitalEmployeeProductionBudgetRoute.js';
import { createDigitalEmployeeContentPlanning } from './digitalEmployeeContentPlanning.js';
import { createDigitalEmployeeOverviewReader } from './digitalEmployeeOverviewReader.js';
import { contentRoutingEvidence } from './digitalEmployeeContentEvidence.js';
import { goalInput, publicConfig } from '../digitalEmployees/overviewProjection.js';
import { supersedeAffectedBusinessState as supersedeTaskCorrectionBusinessState } from '../digitalEmployees/taskCorrectionSupersession.js';
import { applyFollowupBatchDecision, createCustomerSegmentSnapshot, createFollowupBatch, configureFollowupItemTemplate, getFollowupBatchItems } from '../digitalEmployees/customerWorkflow.js';

import { type GoalRecord, type RunRecord, type TaskRecord } from '../digitalEmployees/records.js';
import { createWorkflowRepository } from '../digitalEmployees/workflowRepository.js';
import { createDigitalEmployeeRuntimeConfiguration } from '../digitalEmployees/runtimeConfiguration.js';
import { createGoalFactRebuildReadModel } from '../digitalEmployees/goalFactRebuildReadModel.js';
import { createDigitalEmployeeFactRebuildRoutes } from './digitalEmployeeFactRebuildRoutes.js';
import { createWeeklyPackagePreparation } from '../digitalEmployees/weeklyPackagePreparation.js';
import { createDigitalEmployeePackageRoutes } from './digitalEmployeePackageRoutes.js';
import { createTaskApprovalPreparation } from '../digitalEmployees/taskApprovalPreparation.js';
import { createDigitalEmployeeRunCoordinator } from '../digitalEmployees/runCoordinator.js';
import { createWorkflowEvents } from '../digitalEmployees/workflowEvents.js';
import { createDigitalEmployeeBrowserRoutes } from './digitalEmployeeBrowserRoutes.js';
import { createDigitalEmployeeAssistantDecisionRoutes } from './digitalEmployeeAssistantDecisionRoutes.js';
import { createInitialPreparationRuntime } from '../digitalEmployees/initialPreparationRuntime.js';
import { createDigitalEmployeeOnboardingRoutes } from './digitalEmployeeOnboardingRoutes.js';
import { createDigitalEmployeeContentProjectRoutes } from './digitalEmployeeContentProjectRoutes.js';
import { createGoalActivationApplication } from '../digitalEmployees/goalActivationApplication.js';
import { createDigitalEmployeeGoalRoutes } from './digitalEmployeeGoalRoutes.js';
import { createDigitalEmployeeCustomerWorkflowRoutes } from './digitalEmployeeCustomerWorkflowRoutes.js';
import { createDigitalEmployeeRunControlRoutes } from './digitalEmployeeRunControlRoutes.js';
import { createDigitalEmployeeOverviewRoutes } from './digitalEmployeeOverviewRoutes.js';

export { runReviewSummary } from './digitalEmployeeReviewSummary.js';

const getWhatsAppCustomers = async (tenantId: string) => currentExecutionAdapters()?.customers?.(tenantId) ?? defaultGetWhatsAppCustomers(tenantId);

const buildBusinessSnapshot: typeof defaultBuildBusinessSnapshot = (tenantId, range) => currentExecutionAdapters()?.snapshot?.(tenantId, range) ?? defaultBuildBusinessSnapshot(tenantId, range);

export const digitalEmployeesRouter = Router();

digitalEmployeesRouter.use(requireAuth);

digitalEmployeesRouter.use(enforceSupportSessionReadOnly);

const goalApprovalQueues = new Map<string, Promise<void>>();

const repositoryApplication = createWorkflowRepository({

});
const { first, handoffPolicyIdentity, activeWorkflowHandoffsForRun, tenantRecord, requiredCreate, appendAudit, listAllRecords } = repositoryApplication;

const configurationApplication = createDigitalEmployeeRuntimeConfiguration({
  get first() { return first; },
});
const { resolveCurrentConfiguration, publishingReadinessForOverview, executionConfigForPlan, frozenEnterpriseProfileForPlan, ensureFrozenEnterpriseProfileForRun, configForTenant } = configurationApplication;

const eventsApplication = createWorkflowEvents({
  get appendAudit() { return appendAudit; },
  get requiredCreate() { return requiredCreate; },
});
const { sendEvent, appendEvent, appendAuthorizationRequiredEvent } = eventsApplication;
const { streamClients } = eventsApplication;

const factReadModelApplication = createGoalFactRebuildReadModel({
  get tenantRecord() { return tenantRecord; },
});
const { ensureWeeklyGoalFactRebuildAudit, weeklyGoalFactRebuildRecovery, weeklyGoalFactRebuildTargetCommitted, committedDigitalEmployeeOperatingGoals } = factReadModelApplication;

const packagePreparationApplication = createWeeklyPackagePreparation({
  get frozenEnterpriseProfileForPlan() { return frozenEnterpriseProfileForPlan; },
  get appendAudit() { return appendAudit; },
});
const { recommendPackageWithTenantEvidence, bindWeeklyViralLibraryToPackage } = packagePreparationApplication;

const authorizationApplication = createTaskApprovalPreparation({
  get listAllRecords() { return listAllRecords; },
  get appendAudit() { return appendAudit; },
  get appendEvent() { return appendEvent; },
  get tenantRecord() { return tenantRecord; },
  get first() { return first; },
  get requiredCreate() { return requiredCreate; },
  get configForTenant() { return configForTenant; },
  get executionConfigForPlan() { return executionConfigForPlan; },
  get resolveCurrentConfiguration() { return resolveCurrentConfiguration; },
});
const { restoreExecutionOnlyInvalidatedAuthorization, dependenciesReady, approvalPreflight, createApproval, publishingApprovalPackage, applyPackageGrant } = authorizationApplication;

const runtimeApplication = createDigitalEmployeeRunCoordinator({
  get appendEvent() { return appendEvent; },
  get appendAudit() { return appendAudit; },
  get tenantRecord() { return tenantRecord; },
  get configForTenant() { return configForTenant; },
  get restoreExecutionOnlyInvalidatedAuthorization() { return restoreExecutionOnlyInvalidatedAuthorization; },
  get executionConfigForPlan() { return executionConfigForPlan; },
  get getWhatsAppCustomers() { return getWhatsAppCustomers; },
  get dependenciesReady() { return dependenciesReady; },
  get supersedeAffectedBusinessState() { return supersedeAffectedBusinessState; },
  get bindWeeklyViralLibraryToPackage() { return bindWeeklyViralLibraryToPackage; },
  get buildBusinessSnapshot() { return buildBusinessSnapshot; },
  get observeTaskProof() { return observeTaskProof; },
  get approvalPreflight() { return approvalPreflight; },
  get first() { return first; },
  get applyPackageGrant() { return applyPackageGrant; },
  get createApproval() { return createApproval; },
  get prepareObserveBusinessResource() { return prepareObserveBusinessResource; },
  get prepareContentBatchPlan() { return prepareContentBatchPlan; },
  get ensureContentBatchPlan() { return ensureContentBatchPlan; },
  get executeInTaskBrowser() { return executeInTaskBrowser; },
  get sourceCollectionFailureReason() { return sourceCollectionFailureReason; },
  get completeReview() { return completeReview; },
});
const { advanceRun, queueDigitalEmployeeRunAdvance } = runtimeApplication;

const browserApplication = createDigitalEmployeeBrowserRoutes({
  get appendEvent() { return appendEvent; },
  get tenantRecord() { return tenantRecord; },
  get first() { return first; },
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get configForTenant() { return configForTenant; },
  get streamClients() { return streamClients; },
  get sendEvent() { return sendEvent; },
});
const { executeInTaskBrowser } = browserApplication;

const assistantApplication = createDigitalEmployeeAssistantDecisionRoutes({
  get committedDigitalEmployeeOperatingGoals() { return committedDigitalEmployeeOperatingGoals; },
  get first() { return first; },
  get tenantRecord() { return tenantRecord; },
  get activeWorkflowHandoffsForRun() { return activeWorkflowHandoffsForRun; },
  get handoffPolicyIdentity() { return handoffPolicyIdentity; },
  get requiredCreate() { return requiredCreate; },
  get appendEvent() { return appendEvent; },
  get appendAudit() { return appendAudit; },
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get approveGoalForReview() { return approveGoalForReview; },
  get buildOverview() { return buildOverview; },
  get applyTaskControl() { return applyTaskControl; },
  get queueDigitalEmployeeRunAdvance() { return queueDigitalEmployeeRunAdvance; },
});

const initialRuntimeApplication = createInitialPreparationRuntime({
  get first() { return first; },
  get tenantRecord() { return tenantRecord; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get resolveCurrentConfiguration() { return resolveCurrentConfiguration; },
  get configForTenant() { return configForTenant; },
  get executionConfigForPlan() { return executionConfigForPlan; },
  get generateWeeklyTaskPreviews() { return generateWeeklyTaskPreviews; },
  get approveGoalForReview() { return approveGoalForReview; },
});
const { resumeInitialPreparationPlan } = initialRuntimeApplication;

const factRebuildApplication = createDigitalEmployeeFactRebuildRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get goalApprovalQueues() { return goalApprovalQueues; },
  get tenantRecord() { return tenantRecord; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get first() { return first; },
  get ensureWeeklyGoalFactRebuildAudit() { return ensureWeeklyGoalFactRebuildAudit; },
  get buildOverview() { return buildOverview; },
  get resolveCurrentConfiguration() { return resolveCurrentConfiguration; },
  get configForTenant() { return configForTenant; },
  get weeklyGoalFactRebuildRecovery() { return weeklyGoalFactRebuildRecovery; },
  get recommendPackageWithTenantEvidence() { return recommendPackageWithTenantEvidence; },
});

const packagePlanningApplication = createDigitalEmployeePackageRoutes({
  get executionConfigForPlan() { return executionConfigForPlan; },
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get configForTenant() { return configForTenant; },
  get resolveCurrentConfiguration() { return resolveCurrentConfiguration; },
  get getWhatsAppCustomers() { return getWhatsAppCustomers; },
  get tenantRecord() { return tenantRecord; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get first() { return first; },
  get weeklyGoalFactRebuildRecovery() { return weeklyGoalFactRebuildRecovery; },
  get frozenEnterpriseProfileForPlan() { return frozenEnterpriseProfileForPlan; },
  get recommendPackageWithTenantEvidence() { return recommendPackageWithTenantEvidence; },
  get goalApprovalQueues() { return goalApprovalQueues; },
  get buildOverview() { return buildOverview; },
  get generateWeeklyTaskPreviews() { return generateWeeklyTaskPreviews; },
  get appendAudit() { return appendAudit; },
});

const initialPreparationApplication = createDigitalEmployeeOnboardingRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get first() { return first; },
  get goalApprovalQueues() { return goalApprovalQueues; },
  get tenantRecord() { return tenantRecord; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get resumeInitialPreparationPlan() { return resumeInitialPreparationPlan; },
  get frozenEnterpriseProfileForPlan() { return frozenEnterpriseProfileForPlan; },
  get configForTenant() { return configForTenant; },
  get requiredCreate() { return requiredCreate; },
  get appendEvent() { return appendEvent; },
  get appendAudit() { return appendAudit; },
  get buildOverview() { return buildOverview; },
});

const contentProjectsApplication = createDigitalEmployeeContentProjectRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get tenantRecord() { return tenantRecord; },
  get appendAudit() { return appendAudit; },
  get appendAuthorizationRequiredEvent() { return appendAuthorizationRequiredEvent; },
  get advanceRun() { return advanceRun; },
  get buildOverview() { return buildOverview; },
});

const goalActivationApplication = createGoalActivationApplication({
  get requiredCreate() { return requiredCreate; },
  get goalApprovalQueues() { return goalApprovalQueues; },
  get tenantRecord() { return tenantRecord; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get first() { return first; },
  get advanceRun() { return advanceRun; },
  get buildOverview() { return buildOverview; },
  get configForTenant() { return configForTenant; },
  get resolveCurrentConfiguration() { return resolveCurrentConfiguration; },
  get weeklyGoalFactRebuildRecovery() { return weeklyGoalFactRebuildRecovery; },
  get frozenEnterpriseProfileForPlan() { return frozenEnterpriseProfileForPlan; },
  get executionConfigForPlan() { return executionConfigForPlan; },
  get appendEvent() { return appendEvent; },
  get appendAudit() { return appendAudit; },
});

const goalRoutesApplication = createDigitalEmployeeGoalRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get configForTenant() { return configForTenant; },
  get resolveCurrentConfiguration() { return resolveCurrentConfiguration; },
  get requiredCreate() { return requiredCreate; },
  get recommendPackageWithTenantEvidence() { return recommendPackageWithTenantEvidence; },
  get appendAudit() { return appendAudit; },
  get buildOverview() { return buildOverview; },
  get approveGoalForReview() { return approveGoalForReview; },
});

const customerWorkflowApplication = createDigitalEmployeeCustomerWorkflowRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get tenantRecord() { return tenantRecord; },
  get appendEvent() { return appendEvent; },
  get appendAudit() { return appendAudit; },
  get advanceRun() { return advanceRun; },
  get buildOverview() { return buildOverview; },
  get configForTenant() { return configForTenant; },
  get ensureFrozenEnterpriseProfileForRun() { return ensureFrozenEnterpriseProfileForRun; },
  get executionConfigForPlan() { return executionConfigForPlan; },
  get first() { return first; },
});

const runControlApplication = createDigitalEmployeeRunControlRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get tenantRecord() { return tenantRecord; },
  get buildBusinessSnapshot() { return buildBusinessSnapshot; },
  get advanceRun() { return advanceRun; },
  get appendEvent() { return appendEvent; },
  get appendAudit() { return appendAudit; },
  get buildOverview() { return buildOverview; },
  get activeWorkflowHandoffsForRun() { return activeWorkflowHandoffsForRun; },
  get handoffPolicyIdentity() { return handoffPolicyIdentity; },
  get requiredCreate() { return requiredCreate; },
  get first() { return first; },
});

const overviewApplication = createDigitalEmployeeOverviewRoutes({
  get digitalEmployeesRouter() { return digitalEmployeesRouter; },
  get tenantRecord() { return tenantRecord; },
  get weeklyGoalFactRebuildTargetCommitted() { return weeklyGoalFactRebuildTargetCommitted; },
  get buildOverview() { return buildOverview; },
});

overviewApplication.registerGetPublishingAccounts();

export async function reconcileDigitalEmployeeRun(tenantId: string, runId: string): Promise<void> {
  return runtimeApplication.reconcileDigitalEmployeeRun(tenantId, runId);
}

export async function browserTaskWorkspace(scope: BrowserScope): Promise<BrowserProductionTarget> {
  return browserApplication.browserTaskWorkspace(scope);
}

export async function approveGoalForReview(tenantId: string, userId: string, goalId: string, packageRevision: number | undefined, members: Array<{id: string}>, authorization?: import('../../shared/contracts/contentGenerationAuthorization.js').ContentGenerationAuthorization, overBudgetQuoteKey = '') {
  return goalActivationApplication.approveGoalForReview(tenantId, userId, goalId, packageRevision, members, authorization, overBudgetQuoteKey);
}

export async function configureWorkflowFollowupTemplate(
  input: Parameters<typeof configureFollowupItemTemplate>[0],
  resolver?: Parameters<typeof configureFollowupItemTemplate>[1],
) {
  return customerWorkflowApplication.configureWorkflowFollowupTemplate(input, resolver);
}

export async function resumeConfirmedInitialPlans() {
  return initialRuntimeApplication.resumeConfirmedInitialPlans();
}

export function initInitialPreparationWorker():boolean {
  return initialRuntimeApplication.initInitialPreparationWorker();
}

export function stopInitialPreparationWorker() {
  return initialRuntimeApplication.stopInitialPreparationWorker();
}

const { collectionLimitForInventoryGap, sourceCollectionFailureReason, generateWeeklyTaskPreviews, prepareContentBatchPlan, ensureContentBatchPlan } = createDigitalEmployeeContentPlanning({
  first, requiredCreate, ensureFrozenEnterpriseProfileForRun, goalInput, contentRoutingEvidence,
});

browserApplication.registerBrowserTelemetry();

eventsApplication.registerFollowupWorkerEvents();

const { buildOverview } = createDigitalEmployeeOverviewReader({
  store,
  configForTenant,
  committedGoals: committedDigitalEmployeeOperatingGoals,
  resolveConfiguration: resolveCurrentConfiguration,
  first,
  buildBusinessSnapshot,
  publishingReadinessForOverview,
});

const weeklyReviewApplication = createWeeklyReviewApplication({
  store, activationQueues: goalApprovalQueues, tenantRecord, first, requiredCreate,
  configForTenant, resolveCurrentConfiguration, executionConfigForPlan,
  weeklyGoalFactRebuildTargetCommitted, approveGoalForReview,
  buildBusinessSnapshot, appendEvent, appendAudit,
});

const { completeReview } = weeklyReviewApplication;

const { observeTaskProof } = createTaskBusinessObservation({
  store, tenantRecord, getWhatsAppCustomers, getFollowupBatchItems,
  recoverStaleFollowupSending, preflightFollowupBatchDispatch,
});

const { prepareObserveBusinessResource } = createTaskBusinessPreparation({
  store, tenantRecord, first, collectionLimitForInventoryGap,
  currentExecutionAdapters, browserExecutionEnabled, ensureDigitalEmployeeSocialCollectionTask,
  scheduledExecutionState, runScheduledTaskNow, advanceAutomatedContentProduction,
  createCustomerSegmentSnapshot, createFollowupBatch, getTenantFollowupDispatchStatus,
  appendEvent, appendAudit, ensureFrozenEnterpriseProfileForRun, executeInTaskBrowser,
});

async function supersedeAffectedBusinessState(tenantId: string, run: RunRecord, affected: TaskRecord[], now: string): Promise<void> {
  await supersedeTaskCorrectionBusinessState({ store, tenantId, run, affected, now,
    controlJob: controlContentExecutionJob, getFollowupBatchItems });
}

overviewApplication.registerGetOverview();

initialPreparationApplication.registerPostOnboardingHistoryCollection();

initialPreparationApplication.registerGetGoalsGoalIdInitialPreparation();

initialPreparationApplication.registerPostGoalsGoalIdInitialPreparation();

assistantApplication.registerGetAssistantDecisionCenter();

assistantApplication.registerPostAssistantDecisionCenterDecisionIdActions();

initialPreparationApplication.registerPostOnboardingComplete();

contentProjectsApplication.registerGetContentProjectsProjectIdProduction();

contentProjectsApplication.registerPostContentProjectsProjectIdRevise();

contentProjectsApplication.registerPostContentProjectsProjectIdNarration();

contentProjectsApplication.registerPostContentProjectsProjectIdApprove();

packagePlanningApplication.registerGetPlanningOptions();

packagePlanningApplication.registerGetPackageOptions();

packagePlanningApplication.registerGetGoalsGoalIdProductionReadiness();

packagePlanningApplication.registerPostGoalsGoalIdPackageRecommend();

packagePlanningApplication.registerPostGoalsGoalIdPackageDetails();

packagePlanningApplication.registerPutGoalsGoalIdPackage();

packagePlanningApplication.registerPatchGoalsGoalIdProductionBudgetMode();

packagePlanningApplication.registerPatchGoalsGoalIdPublicationScheduleContentId();

factRebuildApplication.registerPostGoalsGoalIdRebuildFromLatestFacts();

goalRoutesApplication.registerPostGoals();

goalRoutesApplication.registerPostGoalsGoalIdApprove();

contentProjectsApplication.registerPostRunsRunIdTasksTaskIdLinkProject();

runControlApplication.registerPostRunsRunIdReconcile();

/** Compatibility entry point for the existing runtime orchestrator. */
export async function generateScheduledRunReview(input: { tenantId: string; runId: string; scheduleSlot: string }): Promise<boolean> {
  return weeklyReviewApplication.generateScheduledRunReview(input);
}

registerWeeklyReviewGenerationRoutes(digitalEmployeesRouter, { application: weeklyReviewApplication, buildOverview });

customerWorkflowApplication.registerPostRunsRunIdCustomerSegments();

customerWorkflowApplication.registerGetCustomerSegmentsSegmentId();

customerWorkflowApplication.registerPostCustomerSegmentsSegmentIdFollowupBatches();

customerWorkflowApplication.registerUseRunsRunIdCustomerTaskNavigation();

customerWorkflowApplication.registerGetRunsRunIdCustomerWorkspace();

customerWorkflowApplication.registerPostFollowupBatchesBatchIdRevise();

digitalEmployeesRouter.use(createDigitalEmployeeFollowupReadRouter());

customerWorkflowApplication.registerPostFollowupBatchesBatchIdDispatch();

browserApplication.registerGetRunsRunIdEvents();

browserApplication.registerGetRunsRunIdTasksTaskIdWorkspace();

browserApplication.registerGetRunsRunIdTasksTaskIdBrowserStream();

browserApplication.registerPostRunsRunIdTasksTaskIdBrowserRefresh();

browserApplication.registerPostRunsRunIdTasksTaskIdUiEvents();

browserApplication.registerGetRunsRunIdStream();

const digitalEmployeeApprovalDecisionApplication = createDigitalEmployeeApprovalDecisionApplication({
  store,
  buildPublishingPackage: ({ tenantId, goal, run, task, tasks, scheduleAnchor }) => publishingApprovalPackage(
    tenantId,
    goal as GoalRecord,
    run as RunRecord,
    task as TaskRecord,
    tasks as TaskRecord[],
    scheduleAnchor,
  ),
  listConnectedPublishingAccounts,
  createPublishingCalendarEntries,
  applyFollowupBatchDecision,
  appendAudit,
  appendEvent,
  continueRun: advanceRun,
  enqueueStarterPublicationPackageTask: enqueueApprovedContentPublicationPackageTask,
});

registerDigitalEmployeeApprovalDecisionApplication(digitalEmployeeApprovalDecisionApplication);

assistantApplication.registerPostApprovalsApprovalIdDecide();

const taskInterventionApplication = createTaskInterventionApplication({
  store, tenantRecord, first, requiredCreate, configForTenant, executionConfigForPlan,
  buildBusinessSnapshot, getWhatsAppCustomers, observeTaskProof, advanceRun,
  appendEvent, appendAudit, appendAuthorizationRequiredEvent, supersedeAffectedBusinessState,
});

const { applyTaskControl } = taskInterventionApplication;

/** Shared retry authority for alternate authenticated surfaces such as the mobile workbench. */
export async function retryDigitalEmployeeTask(input: {
  tenantId: string;
  userId: string;
  taskId: string;
  expectedTaskVersion: string;
  instruction?: string;
  rerunDownstream?: boolean;
}): Promise<{ runId: string; goalId: string }> {
  const result = await applyTaskControl({
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    expectedTaskVersion: input.expectedTaskVersion,
    action: 'retry',
    scope: 'one_off',
    instruction: String(input.instruction || '').trim().slice(0, 5000) || '重试当前任务并重置下游',
    rerunDownstream: input.rerunDownstream !== false,
  });
  queueDigitalEmployeeRunAdvance(input.tenantId, result.runId);
  return result;
}

registerTaskInterventionRoutes(digitalEmployeesRouter, {
  application: taskInterventionApplication, queueDigitalEmployeeRunAdvance, buildOverview,
  registerProductionBudgetRoute: () => {
    registerProductionBudgetReforecastRoute(digitalEmployeesRouter, {
      tenantRecord, publicConfig, configForTenant, executionConfigForPlan,
      ensureFrozenEnterpriseProfileForRun, goalInput, appendEvent, appendAudit, buildOverview,});
  },
});

runControlApplication.registerPostTasksTaskIdHandoff();

runControlApplication.registerPostTasksTaskIdReturnToAgent();

runControlApplication.registerPostRunsRunIdPause();

runControlApplication.registerPostRunsRunIdResume();

runControlApplication.registerPostRunsRunIdCancel();

/** Background continuation uses a database lease and durable source linkage. */
export async function continueManagedOperatingCycle(tenantId: string, sourceRunId: string, now = new Date()): Promise<string | null> {
  return weeklyReviewApplication.continueManagedOperatingCycle(tenantId, sourceRunId, now);
}

export async function allocateReviewTodos(tenantId: string, userId: string, board: ReviewTodoBoard): Promise<string> {
  return weeklyReviewApplication.allocateReviewTodos(tenantId, userId, board);
}

registerReviewTodoRoutes(digitalEmployeesRouter, weeklyReviewApplication);
