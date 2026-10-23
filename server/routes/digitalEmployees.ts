import { advanceInitialPreparation, initialPreparationSources, initialPreparationSourcesFromPersisted, initialPreparationJobKey, persistInitialPreparationState, replaceInitialPreparationPlan, type InitialPreparation } from '../digitalEmployees/initialPreparation.js';
import { createCrawlWorkerJob } from './crawlWorker.js';
import {createCustomerTaskNavigationRouter} from './customerTaskNavigation.js';
import { createDigitalEmployeeFollowupReadRouter } from './digitalEmployeeFollowupReadRoutes.js';
import { requiresContentHumanAcceptance } from '../digitalEmployees/contentProductionAcceptancePolicy.js';
import { nextManagedCycleWindow, prepareManagedCyclePackage } from '../digitalEmployees/managedOperatingCycle.js';
import {
  commitWeeklyGoalFactRebuildReplacement,
  hasWeeklyGoalFactRebuildMarker,
  hasWeeklyGoalFactRebuildPlanFence,
  sameCompletedWeeklyGoalFactRebuild,
  sameWeeklyGoalFactRebuild,
  weeklyGoalFactRebuildLink,
  weeklyGoalFactRebuildRecordId,
  weeklyGoalFactRebuildReplacement,
  weeklyGoalFactRebuildSnapshotMatches,
  weeklyGoalFactRebuildSourcePlanDigest,
  WeeklyGoalFactRebuildCommitError,
  type WeeklyGoalFactRebuildLink,
} from '../digitalEmployees/goalFactRebuild.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { createHash, randomUUID } from 'node:crypto';
import { managedPublishingGrantErrors } from '../../shared/contracts/managedPublishingGrant.js';
import { applyManagedPublishingGrant, managedPublishingGrantCovers } from '../digitalEmployees/managedPublishingGrant.js';
import { productionQualitySummary } from '../digitalEmployees/productionQualitySummary.js';
import { productionFailureState } from '../digitalEmployees/productionPreflight.js';
import { reopenNoDataCustomerBranch } from '../digitalEmployees/customerReentry.js';
import { normalizeContinuationPolicy } from '../../shared/contracts/continuationPolicy.js';
import { followupDraftDue } from '../digitalEmployees/continuationPolicy.js';
import { findOperatingGoalConflict } from '../digitalEmployees/operatingGoalConflicts.js';
import { reviewTodoService } from '../digitalEmployees/reviewTodos.js';
import { applyReviewTodoPlan, sameTodoRequirements } from '../digitalEmployees/reviewTodoPlan.js';
import type { ReviewTodoBoard } from '../../src/lib/reviewTodos.js';
import { nextTaskFailure, taskRetryDue, type TaskFailure } from '../digitalEmployees/taskRetry.js';
import { analysisWait, basicTaskWait, collectionWait, followupComplete, followupWait, postFullyPublished, publishingPlatformsCovered, publishingWait, waitState, workflowStatusForWait } from '../digitalEmployees/executionDiagnostics.js';
import { listTenantEmployees } from './auth.js';
import { recommendPackage, normalizePackage, repairCollapsedWeeklyVideoProduction, validatePackage, validatePackageForStart, compilePackage, packageConfig, packageTaskForKey, grantCovers, criticalBusinessConfigChanges } from '../digitalEmployees/weeklyPackage.js';
import { TASK_TEMPLATES, type WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { fillMatrixVideos } from '../../src/lib/weeklyMatrix.js';
import { presenterProductionGate, type ProductionDefaults } from '../../src/lib/shotProduction.js';
import { applyDirectorDecision, DIRECTOR_DECISION_LABELS, DIRECTOR_REASON_LABELS, type DirectorDecision, type DirectorDecisionReason } from '../../src/lib/directorDecision.js';
import {
  directorDecisionInvalidatesWeeklyAuthorization,
  taskCorrectionInvalidatesWeeklyAuthorization,
} from '../digitalEmployees/weeklyAuthorizationInvalidation.js';
import { weeklyAuthorizationRecoveryDecision } from '../digitalEmployees/weeklyAuthorizationRecovery.js';
import { missingPublishingOAuthConfiguration, publishingAccountConnectionMessage, publishingOAuthConfigurationMessage, type PublishingOAuthPlatform, type PublishingReadinessSnapshot } from '../digitalEmployees/publishingOAuthReadiness.js';
import { readTenantPublishingReadiness } from '../digitalEmployees/publishingRuntimeReadiness.js';
import { migrateLegacyPublishingPlanAccountBindings, packageGrantWasInvalidatedAfterApproval } from '../digitalEmployees/publishingPlanAccountMigration.js';
import { getTenantAwareGoogleOAuthClient, getTenantAwareInstagramOAuthClient, getTenantAwareLinkedInOAuthClient, getTenantAwareMetaOAuthClient, getTenantAwareTikTokOAuthClient } from '../lib/oauthConfig.js';
import { reviseContent } from '../digitalEmployees/contentRevision.js';
import { automationBgmCatalog } from './studioBgmCatalog.js';
import { normalizeVideoPlan, spokenLanguageMatches, videoPlanErrors, type VideoCreationPlan, type VideoPreproductionPreview } from '../../shared/contracts/videoCreationPlan.js';
import { invalidatePublishingApprovalForProject, invalidatePublishingAuthorizationForRun } from '../digitalEmployees/publishingExecution.js';
import { contentAcceptanceHash, contentAccepted } from '../digitalEmployees/contentAcceptance.js';
import { buildDeliveryResources } from '../digitalEmployees/deliveryResources.js';
import {
  controlContentExecutionJob,
  pauseContentExecutionJobsForRun,
  resumeContentExecutionJobsForRun,
  type ContentExecutionControlAction,
} from '../contentExecution/durableQueue.js';
import { buildTaskDeepLink, type WorkflowTask } from '../../src/lib/digitalEmployees.js';
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { agentBrowserSessions, browserExecutionEnabled, type BrowserScope, type BrowserProductionTarget } from '../digitalEmployees/browserSessions.js';
import { listRunEventsAfter } from '../digitalEmployees/runEventReplay.js';
import { enforceSupportSessionReadOnly, requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { isInternalBudgetExemptTenant } from '../lib/tenantBudgetExemption.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { readAuthorizedWhatsAppCustomers as defaultGetWhatsAppCustomers } from '../whatsapp/authorizedCustomerRead.js';
import { currentExecutionAdapters } from '../digitalEmployees/executionAdapters.js';
const getWhatsAppCustomers = async (tenantId: string) => currentExecutionAdapters()?.customers?.(tenantId) ?? defaultGetWhatsAppCustomers(tenantId);
import { ensureDigitalEmployeeSocialCollectionTask, runScheduledTaskNow, scheduledExecutionState } from './scheduler.js';
import { readTenantEnterpriseProfile, updateTenantEnterpriseProfile, type EnterpriseProfile } from './enterprise.js';
import { buildBusinessSnapshot as defaultBuildBusinessSnapshot, type BusinessSnapshot } from '../digitalEmployees/businessSnapshot.js';
const buildBusinessSnapshot: typeof defaultBuildBusinessSnapshot = (tenantId, range) => currentExecutionAdapters()?.snapshot?.(tenantId, range) ?? defaultBuildBusinessSnapshot(tenantId, range);
import { freezeStoryboardNarration, CONTENT_SCRIPT_QUALITY_RULE_VERSION, advanceAutomatedContentProduction, collectProductionAssets, generateDirectorScriptContracts, refreshExpandedContentOrderContract, storyboardVoiceLanguageMatches } from '../digitalEmployees/contentProduction.js';
import { managedReplicationFailureState, managedReplicationPlanHasExecutionGraph } from '../digitalEmployees/replicationContentProduction.js';
import { assessStoryboardMaterialReadiness } from '../digitalEmployees/materialProductionReadiness.js';
import { contentProjectLineageFields } from '../digitalEmployees/contentProjectLineage.js';
import { readServerProductionOnboardingReadiness, referenceCoveredByProductionEvidence } from '../digitalEmployees/productionOnboardingPreflight.js';
import { buildContentBatchPlan, contentPlanCoverage, enterpriseAssetStableId, type ContentBatchPlanDraft, type ContentOrder } from '../digitalEmployees/contentBatchPlan.js';
import { bindDefaultProductsToPackage, enrichPackageWithContentSignals, publicationCopyForPlan, verifiedStoryboardProviderCostRange } from '../digitalEmployees/contentPlanRecommendation.js';
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS, buildBenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import { benchmarkAnalysisForRecord } from '../lib/benchmarkAnalysis.js';
import { summarizeContentFeedback } from '../digitalEmployees/contentReview.js';
import { summarizeWeeklyMatrix } from '../digitalEmployees/weeklyMatrixReview.js';
import {
  configurationSnapshot,
  enterpriseProfileFromKnowledgeBinding,
  resolveKnowledgeBinding,
  resolveDigitalEmployeeConfiguration,
  type ResolvedDigitalEmployeeConfiguration,
} from '../digitalEmployees/configuration.js';
import { dispatchFollowupBatch, recoverStaleFollowupSending, followupDispatchPreflightBlockedReason, getTenantFollowupDispatchStatus, onFollowupWorkerEvent, preflightFollowupBatchDispatch } from '../digitalEmployees/followupDispatchWorker.js';
import { bindPublishingTargets, listConnectedPublishingAccounts, localPublishingAccountMocksEnabled, publishingTargetPlatforms } from '../digitalEmployees/publishingTargets.js';
import { digitalEmployeeOperatingGoals, isDigitalEmployeeOperatingGoal } from '../digitalEmployees/overviewGoalScope.js';
import { evaluatePlannedReferenceReuse, evaluateViralAnalysisCoverage, hasParseableExactVideoAnalysis, reusableExplicitReferenceIds, viralCoverageBypassAllowed } from '../digitalEmployees/viralAnalysisCoverage.js';
import { mustInvalidateContentDownstream } from '../digitalEmployees/dependencyInvalidation.js';
import { canonicalScheduledCollectionRecords, evaluateScheduledDiscoveryRuns, mustReobserveSucceededCollection, scheduledCollectionFailureCanRetry, shouldRunScheduledCollection, type DiscoveryRunRecord } from '../digitalEmployees/scheduledCollectionProof.js';
import {
  VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES as VISIBLE_AGENT_ROLES,
  visibleDigitalEmployeeAgentRole as visibleAgentRole,
} from '../digitalEmployees/agentRoles.js';
import { buildPublishingApprovalPackage, createPublishingCalendarEntries, type PublishingApprovalPackage } from '../digitalEmployees/publishingExecution.js';
import { beijingDate, followupScheduleFromCadence, latestDueReviewSlot, socialScheduleFromCadence } from '../digitalEmployees/runtimeSchedule.js';
import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import { planWorkflowHandoffAdmission, planWorkflowHandoffReturn, type ActiveWorkflowHandoff } from '../digitalEmployees/workflowHandoffPolicy.js';
import { cancelDigitalEmployeeRun as cancelDigitalEmployeeRunApplication } from '../digitalEmployees/runCancellation.js';
import { AssistantDecisionValidationError, executeAssistantDecisionCommand, approvalDecisionVersion, weeklyPlanDecisionVersion, workflowTaskDecisionVersion } from '../digitalEmployees/assistantDecisionCenter.js';
import { normalizeAssistantDecisionPage, normalizeAssistantDecisionExecutionReceipt, type AssistantDecisionExecutionReceipt, type AssistantDecisionActionId, type AssistantDecisionCard } from '../../shared/contracts/assistantDecisionCenter.js';
import { createAssistantDecisionFeedForRequest } from '../digitalEmployees/assistantDecisionFeedService.js';
import { customerApprovalRequestHash } from '../digitalEmployees/customerTaskApprovalNavigation.js';
import {
  createDigitalEmployeeApprovalDecisionApplication,
  decideDigitalEmployeeApproval as decideDigitalEmployeeApprovalUseCase,
  DigitalEmployeeApprovalDecisionError,
  registerDigitalEmployeeApprovalDecisionApplication,
} from '../digitalEmployees/approvalDecision.js';
import { enqueueApprovedContentPublicationPackageTask } from '../starter198/agentTasks.js';
import { starter198Repository } from '../starter198/repository.js';
import { starter198OrgRole } from '../starter198/profile.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import { runStarter198Command, Starter198CommandError } from '../starter198/commands.js';
import { createStarter198ApprovalDecisionPort } from '../starter198/approvalDecision.js';
import { createStarter198QuoteDecisionPort } from '../starter198/quoteDecision.js';
import { registerProductionBudgetReforecastRoute } from './digitalEmployeeProductionBudgetRoute.js';
import { createDigitalEmployeeContentPlanning } from './digitalEmployeeContentPlanning.js';
import { createDigitalEmployeeOverviewReader } from './digitalEmployeeOverviewReader.js';
import { contentRoutingEvidence } from './digitalEmployeeContentEvidence.js';
import { configSnapshotForPlan, goalInput, publicConfig, publicConfigurationMetadata, publicEventPayload } from '../digitalEmployees/overviewProjection.js';
import { availableTaskActions, runReviewSummary } from './digitalEmployeeReviewSummary.js';
import { downstreamTasks, irreversibleEffects, postHasPublishedReceipt } from '../digitalEmployees/taskCorrectionSafety.js';
import { supersedeAffectedBusinessState as supersedeTaskCorrectionBusinessState } from '../digitalEmployees/taskCorrectionSupersession.js';
import { contentProjectTaskScope, destinationLabel, exactVideoAnalysis, hasSucceededApprovalAncestor, recordBelongsToTask, scopedProof, scopedValues, studioProjectCompleted, studioProjectRendered, taskExecutionMetadata, taskScope } from '../digitalEmployees/taskEvidenceProjection.js';
export { runReviewSummary } from './digitalEmployeeReviewSummary.js';
import {
  DEFAULT_FOLLOWUP_SEGMENT_CRITERIA,
  eligibleFollowupCustomerIds,
  applyFollowupBatchDecision,
  createCustomerSegmentSnapshot,
  createFollowupBatch,
  configureFollowupItemTemplate,
  followupRunHasExternalReceipt,
  getCustomerSegment,
  getCustomerSegmentMembers,
  getFollowupBatch,
  getFollowupBatchItems,
  type FollowupBatchRecord,
} from '../digitalEmployees/customerWorkflow.js';
import {
  buildTaskOutput,
  buildWeeklyPlan,
  buildWeeklyReview,
  normalizeDigitalEmployeeConfig,
  normalizeWeeklyGoal,
  validateDigitalEmployeeConfig,
  validateWeeklyGoal,
  type DigitalEmployeeConfig,
  type WeeklyGoalInput,
  type WorkflowTaskStatus,
} from '../digitalEmployees/domain.js';
export const digitalEmployeesRouter = Router();
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, withLocalQueue, type ApprovalRecord, type ConfigRecord, type ContentBatchPlanRecord, type CorrectionRecord, type EventRecord, type GoalRecord, type HandoffRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './digitalEmployeeRecords.js';
digitalEmployeesRouter.use(requireAuth);
digitalEmployeesRouter.use(enforceSupportSessionReadOnly);
digitalEmployeesRouter.get('/publishing-accounts', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const enterprise = await readTenantEnterpriseProfile(tenantId);
  res.json({ items: await listConnectedPublishingAccounts(tenantId, enterprise.company.name) });
});
const streamClients = new Map<string, Set<Response>>();
const eventAppendQueues = new Map<string, Promise<void>>();
const goalApprovalQueues = new Map<string, Promise<void>>();
const customerWorkflowQueues = new Map<string, Promise<void>>();
const scheduledReviewQueues = new Map<string, Promise<void>>();
async function resolveCurrentConfiguration(
  tenantId: string,
  record?: ConfigRecord | null,
): Promise<ResolvedDigitalEmployeeConfiguration | null> {
  const configRecord = record === undefined ? await configForTenant(tenantId) : record;
  const config = publicConfig(configRecord);
  if (!config || !configRecord) return null;
  const enterpriseProfile = await readTenantEnterpriseProfile(tenantId);
  if (localPublishingAccountMocksEnabled()) {
    const accounts = await listConnectedPublishingAccounts(tenantId, enterpriseProfile.company.name);
    const connectedById = new Map(accounts.map(account => [account.accountId, account]));
    // Local preview exposes mock accounts through /publishing-accounts, but it
    // must never replace the user's saved platform selection or weekly quota.
    config.publishingTargets = config.publishingTargets.flatMap(target => {
      const connected = connectedById.get(target.accountId);
      return connected && connected.platform === target.platform
        ? [{ ...target, accountLabel: connected.accountLabel }]
        : [];
    });
  }
  return resolveDigitalEmployeeConfiguration({
    config,
    enterpriseProfile,
    configVersion: Number(configRecord.config_version || 1),
  });
}
async function publishingReadinessForOverview(
  tenantId: string,
  required: boolean,
  targetPlatforms: string[],
): Promise<PublishingReadinessSnapshot> {
  return (await readTenantPublishingReadiness(tenantId, required, targetPlatforms)).snapshot;
}
function executionConfigForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig {
  const config = configSnapshotForPlan(plan, fallback);
  const body = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
  return body.businessPackage ? packageConfig(body.businessPackage as WeeklyPackage, config) : config;
}
function frozenEnterpriseProfileForPlan(plan: PlanRecord | null, allowLegacy = true): EnterpriseProfile | null {
  if (!plan) return null;
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  const profile = enterpriseProfileFromKnowledgeBinding(body.knowledgeBinding, { allowLegacy });
  return profile as EnterpriseProfile | null;
}
/**
 * Migration bridge for runs created before enterprise snapshots were stored.
 * A plan that already has a fact label may only use facts recoverable from its
 * old binding. A plan with no label is bound once, before execution continues.
 */
async function ensureFrozenEnterpriseProfileForRun(
  tenantId: string,
  plan: PlanRecord | null,
  fallbackConfig: DigitalEmployeeConfig,
  boundAt: string,
): Promise<EnterpriseProfile> {
  if (!plan) throw new Error('run_fact_snapshot_missing');
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  const binding = jsonObject<Record<string, unknown>>(body.knowledgeBinding, {});
  const existing = frozenEnterpriseProfileForPlan(plan, true);
  if (existing) return existing;
  if (String(binding.factsVersion || '').trim()) throw new Error('run_fact_snapshot_mismatch');
  const current = await readTenantEnterpriseProfile(tenantId);
  const knowledgeBinding = resolveKnowledgeBinding(current, fallbackConfig, boundAt);
  const nextBody = { ...body, knowledgeBinding };
  if (!await store.update(COLLECTION.plans, plan.id, { plan: nextBody })) throw new Error('run_fact_snapshot_storage_unavailable');
  plan.plan = nextBody;
  const frozen = enterpriseProfileFromKnowledgeBinding(knowledgeBinding);
  if (!frozen) throw new Error('run_fact_snapshot_missing');
  return frozen as EnterpriseProfile;
}
async function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
  const result = await store.list<T>(collection, { where, sort, page: 1, perPage: 1 });
  return result.items[0] ?? null;
}
function handoffPolicyIdentity(handoff: HandoffRecord): ActiveWorkflowHandoff {
  return {
    id: handoff.id,
    taskId: handoff.task_id,
    takenBy: handoff.taken_by,
    startedAt: handoff.started_at,
  };
}
async function activeWorkflowHandoffsForRun(tenantId: string, runId: string): Promise<HandoffRecord[]> {
  const items: HandoffRecord[] = [];
  let page = 1;
  while (true) {
    const result = await store.list<HandoffRecord>(COLLECTION.handoffs, {
      where: { tenant_id: tenantId, run_id: runId, status: 'active' },
      sort: 'started_at',
      page,
      perPage: 500,
    });
    items.push(...result.items);
    if (page >= result.totalPages) return items;
    page += 1;
  }
}
async function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
  const record = await store.getById<T>(collection, id);
  return record?.tenant_id === tenantId ? record : null;
}
async function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
  const record = await store.create<T>(collection, payload);
  if (!record) throw new Error(`${collection}_storage_unavailable`);
  return record;
}
async function appendAudit(input: {
  tenantId: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await store.create('audit_logs', {
    tenantId: input.tenantId,
    actorUserId: input.userId,
    actorEmail: '',
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  });
}
async function ensureWeeklyGoalFactRebuildAudit(input: {
  tenantId: string;
  userId: string;
  sourceGoalId: string;
  sourceGoalVersion: number;
  sourcePlanId: string;
  sourcePlanDigest: string;
  targetGoalId: string;
  targetPlanId: string;
  fromFactsVersion: string;
  toFactsVersion: string;
  configVersion: number;
  policyVersion: string;
  requestId: string;
}): Promise<void> {
  const id = weeklyGoalFactRebuildRecordId('audit', input.tenantId, input.sourceGoalId, input.sourceGoalVersion, input.toFactsVersion, input.configVersion, input.policyVersion, input.sourcePlanDigest);
  const metadata = {
    requestId: input.requestId,
    sourceGoalId: input.sourceGoalId,
    sourceGoalVersion: input.sourceGoalVersion,
    sourcePlanId: input.sourcePlanId,
    sourcePlanDigest: input.sourcePlanDigest,
    targetGoalId: input.targetGoalId,
    targetPlanId: input.targetPlanId,
    fromFactsVersion: input.fromFactsVersion,
    toFactsVersion: input.toFactsVersion,
    configVersion: input.configVersion,
    policyVersion: input.policyVersion,
    automatic: true,
    started: false,
  };
  const auditMatches = (record: StoredRecord | null) => {
    const saved = jsonObject<Record<string, unknown>>(record?.metadata, {});
    return Boolean(record
      && String(record.tenantId || '') === input.tenantId
      && String(record.action || '') === 'weekly_goal.rebuilt_from_latest_facts'
      && String(record.targetType || '') === 'weekly_goal'
      && String(record.targetId || '') === input.targetGoalId
      && String(saved.requestId || '') === input.requestId
      && String(saved.sourceGoalId || '') === input.sourceGoalId
      && Number(saved.sourceGoalVersion) === input.sourceGoalVersion
      && String(saved.sourcePlanId || '') === input.sourcePlanId
      && String(saved.sourcePlanDigest || '') === input.sourcePlanDigest
      && String(saved.targetGoalId || '') === input.targetGoalId
      && String(saved.targetPlanId || '') === input.targetPlanId
      && String(saved.fromFactsVersion || '') === input.fromFactsVersion
      && String(saved.toFactsVersion || '') === input.toFactsVersion
      && Number(saved.configVersion) === input.configVersion
      && String(saved.policyVersion || '') === input.policyVersion
      && saved.automatic === true
      && saved.started === false);
  };
  const existing = await store.getById<StoredRecord>('audit_logs', id);
  if (existing) {
    if (!auditMatches(existing)) {
      throw new Error('weekly_goal_fact_rebuild_audit_conflict');
    }
    return;
  }
  let created: StoredRecord | null = null;
  try {
    created = await store.create<StoredRecord>('audit_logs', {
      id,
      tenantId: input.tenantId,
      actorUserId: input.userId,
      actorEmail: '',
      action: 'weekly_goal.rebuilt_from_latest_facts',
      targetType: 'weekly_goal',
      targetId: input.targetGoalId,
      metadata,
      createdAt: new Date().toISOString(),
    });
  } catch { /* A deterministic-ID winner is recovered and validated below. */ }
  if (created) return;
  const recovered = await store.getById<StoredRecord>('audit_logs', id);
  if (!auditMatches(recovered)) {
    throw new Error('weekly_goal_fact_rebuild_audit_unavailable');
  }
}
function weeklyGoalFactRebuildRecovery(goal: GoalRecord, plan: PlanRecord, expectedFactsVersion: string, factVersion: string) {
  return {
    recoveryAction: 'rebuild_weekly_goal',
    sourceGoalId: goal.id,
    expectedGoalVersion: Number(goal.version || 1),
    sourcePlanId: plan.id,
    expectedFactsVersion,
    expectedSourcePlanDigest: weeklyGoalFactRebuildSourcePlanDigest(plan),
    factVersion,
  };
}
async function weeklyGoalFactRebuildTargetCommitted(tenantId: string, target: GoalRecord): Promise<boolean> {
  if (!hasWeeklyGoalFactRebuildMarker(target.scope)) return true;
  const targetLink = weeklyGoalFactRebuildLink(target.scope);
  if (!targetLink) return false;
  const source = await tenantRecord<GoalRecord>(COLLECTION.goals, targetLink.sourceGoalId, tenantId);
  const replacement = weeklyGoalFactRebuildReplacement(source?.scope);
  if (!source
    || source.status !== 'cancelled'
    || !replacement
    || replacement.targetGoalId !== target.id
    || !sameCompletedWeeklyGoalFactRebuild(targetLink, replacement)) return false;
  try {
    return await commitWeeklyGoalFactRebuildReplacement({
      dataStore: store,
      tenantId,
      sourceGoalId: source.id,
      sourceGoalVersion: targetLink.sourceGoalVersion,
      sourceDescription: goalInput(source).scope,
      replacement,
    }) === 'replayed';
  } catch {
    return false;
  }
}
async function committedDigitalEmployeeOperatingGoals(tenantId: string, goals: GoalRecord[]): Promise<GoalRecord[]> {
  const operatingGoals = digitalEmployeeOperatingGoals(goals);
  const commitStates = await Promise.all(operatingGoals.map(goal => weeklyGoalFactRebuildTargetCommitted(tenantId, goal)));
  return operatingGoals.filter((_goal, index) => commitStates[index]);
}
async function recommendPackageWithTenantEvidence(
  tenantId: string,
  goal: ReturnType<typeof goalInput>,
  config: DigitalEmployeeConfig,
  ownerId = '',
  ownerName = '',
  frozenProfile?: EnterpriseProfile,
): Promise<WeeklyPackage> {
  const pack = recommendPackage(goal, config, ownerId, ownerName);
  const [videos, benchmarks, enterpriseProfile, routingEvidence] = await Promise.all([
    store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 500 }).catch(() => ({ items: [] })),
    store.list<StoredRecord>('competitor_accounts', { where: { tenantId }, sort: '-createdAt', perPage: 200 }).catch(() => ({ items: [] })),
    frozenProfile ? Promise.resolve(structuredClone(frozenProfile)) : readTenantEnterpriseProfile(tenantId),
    contentRoutingEvidence(tenantId, config, frozenProfile),
  ]);
  const enabledRoutes = enterpriseProfile.socialStrategy?.enabledRoutes || [];
  const enterprisePrimaryCta = enabledRoutes
    .map(route => enterpriseProfile.socialStrategy?.routeStrategies?.[route]?.primaryCta?.trim() || '')
    .find(Boolean) || Object.values(enterpriseProfile.socialStrategy?.routeStrategies || {})
      .map(strategy => strategy?.primaryCta?.trim() || '')
      .find(Boolean) || '';
  const matrixPlan = pack.matrixPlan?.map(row => ({ ...row, cta: enterprisePrimaryCta || row.cta }));
  const matrixBound = matrixPlan?.length
    ? fillMatrixVideos({ ...pack, matrixPlan }, config.videoDefaults || {}, goal.endsAt)
    : pack;
  const productBound = bindDefaultProductsToPackage(matrixBound, routingEvidence.products);
  const productionEvidence = await readServerProductionOnboardingReadiness({
    store,
    tenantId,
    profile: enterpriseProfile,
    preferences: config.productionOnboarding,
    plans: [],
    budgetConfirmed: true,
  });
  const producibleReferences = videos.items.filter(item => {
    if (!hasParseableExactVideoAnalysis(item)) return false;
    return referenceCoveredByProductionEvidence({
      analysis: benchmarkAnalysisForRecord(item, jsonObject<Record<string, unknown>>(item.aiAnalysis, {})),
      preferences: config.productionOnboarding,
      evidence: productionEvidence.evidence,
    });
  });
  // A reference is unique inside one weekly package, not permanently spent.
  // Keeping the full analyzed library lets a later week reuse a proven content
  // logic after real performance review, while package enrichment still
  // prevents the same source from occupying two slots in the current week.
  return enrichPackageWithContentSignals({ pack: productBound, goal, config, videos: producibleReferences, benchmarks: benchmarks.items });
}
function clearAutomaticViralReferences(pack: WeeklyPackage): WeeklyPackage {
  return {
    ...pack,
    tasks: pack.tasks.map(task => task.templateId !== 'production' ? task : {
      ...task,
      videoPlans: task.videoPlans?.map(video => video.planningEvidence?.generatedFrom ? {
        ...video,
        referenceId: '',
        benchmarkAnalysis: undefined,
        preproduction: undefined,
      } : video),
    }),
  };
}
async function bindWeeklyViralLibraryToPackage(input: {
  tenantId: string;
  run: RunRecord;
  goal: GoalRecord;
  plan: PlanRecord | null;
  config: DigitalEmployeeConfig;
  pack: WeeklyPackage;
}): Promise<{ pack: WeeklyPackage; inventory: ReturnType<typeof evaluatePlannedReferenceReuse>; changed: boolean }> {
  const production = input.pack.tasks.find(task => task.templateId === 'production');
  const plans = production?.videoPlans || [];
  const library = await store.list<StoredRecord>('trend_videos', { where: { tenantId: input.tenantId }, sort: '-updatedAt', perPage: 500 });
  const profile = (input.plan ? frozenEnterpriseProfileForPlan(input.plan, false) : null)
    || await readTenantEnterpriseProfile(input.tenantId);
  const productionEvidence = await readServerProductionOnboardingReadiness({
    store,
    tenantId: input.tenantId,
    profile,
    preferences: input.config.productionOnboarding,
    plans: [],
    budgetConfirmed: true,
  });
  const coveredReferenceIds = new Set(library.items.filter(item => hasParseableExactVideoAnalysis(item)
    && referenceCoveredByProductionEvidence({
      analysis: benchmarkAnalysisForRecord(item, jsonObject<Record<string, unknown>>(item.aiAnalysis, {})),
      preferences: input.config.productionOnboarding,
      evidence: productionEvidence.evidence,
    })).map(item => item.id));
  // Cross-week use is allowed. The evaluator receives only the current weekly
  // selection and therefore enforces one-content-one-slot for this week.
  const usedReferenceIds: string[] = [];
  const currentInventory = evaluatePlannedReferenceReuse(plans, library.items, usedReferenceIds);
  const selectedReferencesCovered = plans.every(plan => plan.route !== 'clone'
    || Boolean(plan.referenceId && coveredReferenceIds.has(plan.referenceId)));
  if (currentInventory.ready && selectedReferencesCovered) return { pack: input.pack, inventory: currentInventory, changed: false };
  const explicitReferenceIds = new Set(reusableExplicitReferenceIds(plans));
  const candidates = library.items.filter(item => coveredReferenceIds.has(item.id)
    && (explicitReferenceIds.has(item.id) || hasParseableExactVideoAnalysis(item)));
  const benchmarks = await store.list<StoredRecord>('competitor_accounts', { where: { tenantId: input.tenantId }, sort: '-createdAt', perPage: 200 }).catch(() => ({ items: [] }));
  const cleared = clearAutomaticViralReferences(input.pack);
  const rebound = enrichPackageWithContentSignals({
    pack: cleared,
    goal: goalInput(input.goal),
    config: input.config,
    videos: candidates,
    benchmarks: benchmarks.items,
  });
  const originalByContentId = new Map(plans.map(video => [video.contentId, video]));
  const preserved: WeeklyPackage = {
    ...rebound,
    tasks: rebound.tasks.map(task => task.templateId !== 'production' ? task : {
      ...task,
      videoPlans: task.videoPlans?.map(video => {
        const original = originalByContentId.get(video.contentId);
        return original?.referenceId && original.referenceId === video.referenceId && original.preproduction
          ? { ...video, preproduction: original.preproduction }
          : video;
      }),
    }),
  };
  const reboundPlans = preserved.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
  const inventory = evaluatePlannedReferenceReuse(reboundPlans, library.items, usedReferenceIds);
  const changed = JSON.stringify(preserved) !== JSON.stringify(input.pack);
  if (changed && input.plan) {
    const body = jsonObject<Record<string, unknown>>(input.plan.plan, {});
    const nextBody = { ...body, businessPackage: preserved, viralInventoryBoundAt: new Date().toISOString() };
    await store.update(COLLECTION.plans, input.plan.id, { plan: nextBody });
    input.plan.plan = nextBody;
    await appendAudit({
      tenantId: input.tenantId,
      userId: input.goal.owner_id || 'digital_employee_agent',
      action: 'weekly_viral_inventory.bound',
      targetType: 'weekly_plan',
      targetId: input.plan.id,
      metadata: {
        runId: input.run.id,
        reusableReferenceIds: inventory.selectedReferenceIds,
        missingCount: inventory.missingCount,
      },
    });
  }
  return { pack: preserved, inventory, changed };
}
const { collectionLimitForInventoryGap, sourceCollectionFailureReason, generateWeeklyTaskPreviews, prepareContentBatchPlan, ensureContentBatchPlan } = createDigitalEmployeeContentPlanning({
  first, requiredCreate, ensureFrozenEnterpriseProfileForRun, goalInput, contentRoutingEvidence,
});
function sendEvent(response: Response, event: EventRecord): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}
async function appendEvent(input: {
  tenantId: string;
  runId: string;
  taskId?: string;
  type: string;
  level?: 'info' | 'warning' | 'error' | 'success';
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<EventRecord> {
  const queueKey = `${input.tenantId}:${input.runId}`;
  const prior = eventAppendQueues.get(queueKey) || Promise.resolve();
  const operation = prior.catch(() => undefined).then(async () => {
    const latest = await store.list<EventRecord>(COLLECTION.events, {
      where: { tenant_id: input.tenantId, run_id: input.runId }, sort: '-sequence', page: 1, perPage: 1,
    });
    const sequence = Number(latest.items[0]?.sequence || 0) + 1;
    const event = await requiredCreate<EventRecord>(COLLECTION.events, {
      tenant_id: input.tenantId,
      run_id: input.runId,
      task_id: input.taskId || '',
      sequence,
      type: input.type,
      level: input.level || 'info',
      summary: input.summary,
      payload: publicEventPayload(input.payload || {}),
      occurred_at: new Date().toISOString(),
    });
    // Persist before broadcasting so reconnecting clients can always replay this sequence.
    for (const client of streamClients.get(input.runId) || []) sendEvent(client, event);
    return event;
  });
  const tail = operation.then(() => undefined, () => undefined);
  eventAppendQueues.set(queueKey, tail);
  try {
    return await operation;
  } finally {
    if (eventAppendQueues.get(queueKey) === tail) eventAppendQueues.delete(queueKey);
  }
}
async function appendAuthorizationRequiredEvent(input: {
  tenantId: string;
  runId: string;
  taskId?: string;
  reason: 'content_changed' | 'package_adjusted' | 'critical_business_change';
  changedFields?: string[];
}): Promise<void> {
  await appendEvent({
    ...input,
    type: 'authorization_required',
    level: 'warning',
    summary: '本周预算、产品、市场或发布授权范围已变更，受影响的自动发布已暂停，请查看差异并重新授权。',
    payload: {
      eventType: input.reason === 'critical_business_change' ? 'critical_business_change' : 'weekly_package_adjusted',
      reason: input.reason,
      changedFields: input.changedFields || [],
      action: 'review_weekly_package',
    },
  });
}
async function listAllRecords<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const result = await store.list<T>(collection, { where, ...(sort ? { sort } : {}), page, perPage: 500 });
    items.push(...result.items);
    if (page >= result.totalPages) return items;
    page += 1;
  }
}
async function restoreExecutionOnlyInvalidatedAuthorization(
  tenantId: string,
  goal: GoalRecord,
  run: RunRecord,
  plan: PlanRecord | null,
): Promise<boolean> {
  if (!plan) return false;
  const planBody = jsonObject<Record<string, unknown>>(plan.plan, {});
  if (String(planBody.packageApprovedBy || '').trim()
    || !String(planBody.packageApprovedAt || '').trim()
    || !String(planBody.packageGrantInvalidatedAt || '').trim()) return false;
  const [audits, events] = await Promise.all([
    listAllRecords<StoredRecord>('audit_logs', { tenantId }, 'createdAt'),
    listAllRecords<EventRecord>(COLLECTION.events, { tenant_id: tenantId, run_id: run.id, type: 'authorization_required' }, 'occurred_at'),
  ]);
  const decision = weeklyAuthorizationRecoveryDecision({
    goalId: goal.id,
    planId: plan.id,
    runId: run.id,
    approvedAt: planBody.packageApprovedAt,
    approvedBy: planBody.packageApprovedBy,
    invalidatedAt: planBody.packageGrantInvalidatedAt,
    audits: audits.map(audit => ({
      action: audit.action,
      actorUserId: audit.actorUserId,
      targetType: audit.targetType,
      targetId: audit.targetId,
      metadata: audit.metadata,
      createdAt: audit.createdAt,
    })),
    events: events.map(event => ({ type: event.type, payload: event.payload, occurred_at: event.occurred_at })),
  });
  if (!decision.restore) return false;
  const restoredAt = new Date().toISOString();
  const restoredPlan = {
    ...planBody,
    packageApprovedBy: decision.actorUserId,
    packageAuthorizationRecoveredAt: restoredAt,
    packageAuthorizationRecoveredFrom: decision.invalidatedAt,
    packageGrantInvalidatedAt: '',
  };
  const restored = await store.compareAndSwap?.(COLLECTION.plans, plan.id, {
    tenant_id: tenantId,
    goal_id: goal.id,
    plan: plan.plan,
  }, { plan: restoredPlan });
  if (!restored) return false;
  plan.plan = restoredPlan;
  await appendAudit({
    tenantId,
    userId: decision.actorUserId,
    action: 'weekly_package.authorization_recovered',
    targetType: 'weekly_plan',
    targetId: plan.id,
    metadata: { runId: run.id, approvedAt: decision.approvedAt, invalidatedAt: decision.invalidatedAt, reason: 'execution_only_retry_invalidation' },
  });
  await appendEvent({
    tenantId,
    runId: run.id,
    type: 'authorization_restored',
    level: 'success',
    summary: '已核对原审核凭证：此前仅因内部任务重试误撤销，现已恢复原预算与发布范围授权。',
    payload: { reason: 'execution_only_retry_invalidation', approvedAt: decision.approvedAt, invalidatedAt: decision.invalidatedAt },
  });
  return true;
}
agentBrowserSessions.setTelemetry(async (scope, action) => {
  await appendEvent({ ...scope, type: `agent.ui.${action.kind}`, summary: action.label,
    payload: { uiAction: { ...action, page: 'agent-task-workspace' }, source: 'browser_worker' } });
});
export async function browserTaskWorkspace(scope: BrowserScope): Promise<BrowserProductionTarget> {
  const [run, tasks] = await Promise.all([
    tenantRecord<RunRecord>(COLLECTION.runs, scope.runId, scope.tenantId),
    store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: scope.tenantId, run_id: scope.runId }, sort: 'sequence', perPage: 100 }),
  ]);
  const task = tasks.items.find(item => item.id === scope.taskId);
  if (!run || !task) throw new Error('task_run_not_found');
  const normalized = tasks.items.map(item => ({ ...item, business_refs: jsonObject(item.business_refs, []), depends_on: jsonObject(item.depends_on, []), output: jsonObject(item.output, {}) })) as WorkflowTask[];
  // Workspace lookup needs this task's delivery family, not the entire run.
  const families = [
    ['content_mode_routing', 'content_production', 'content_quality_gate'],
    ['followup_batch_draft', 'followup_batch_approval', 'followup_dispatch'],
  ];
  const family = families.find(keys => keys.includes(task.task_key));
  const workspaceTasks = normalized.filter(item => family ? family.includes(item.task_key) : item.id === task.id);
  const resources = await buildDeliveryResources(scope.tenantId, workspaceTasks, '');
  const linked = resources.filter(resource => resource.taskIds.includes(task.id));
  const selected = linked.find(resource => resource.column === 'active' && resource.link) || linked.find(resource => resource.link);
  const customerTask = task.agent_role === 'customer' || task.business_domain === 'customer';
  const mappedLink = buildTaskDeepLink(normalized.find(item => item.id === task.id)!, undefined, run.id);
  const page = customerTask ? 'conversion' : selected?.link?.page || mappedLink.page;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, scope.tenantId);
  const projectId = page === 'smartAssets' && selected?.id.startsWith('studio_project:') ? selected.id.slice('studio_project:'.length) : undefined;
  const project = projectId ? await store.getById<StoredRecord>('studio_projects', projectId) : null;
  const spec = jsonObject<Record<string, unknown>>(project?.spec, {});
  const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
  const taskRefs = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []);
  const customerRef = taskRefs.find(ref => ref.type === 'customer');
  const scheduledRef = taskRefs.find(ref => ref.type === 'scheduled_task');
  let customerId = customerTask ? String(selected?.link?.businessRef.entityId || customerRef?.id || '') || undefined : undefined;
  if (customerTask && !customerId) {
    const segment = await first<StoredRecord & { tenant_id: string }>(COLLECTION.segments, { tenant_id: scope.tenantId, run_id: scope.runId }, '-version');
    if (segment) customerId = (await getCustomerSegmentMembers(scope.tenantId, segment.id)).find(member => member.membership === 'included')?.customer_id;
  }
  return { userId: goal?.owner_id || 'digital_employee_agent', projectId, customerId,
    ...(automation.stage === 'blocked' && automation.retryPolicy === 'input_required' ? { inputBlocker: String(automation.blocker || '请补充制作资料') } : {}),
    stage: String(automation.stage || ''), revision: String(project?.updated_at || task.updated_at),
    link: { page, view: mappedLink.view || selected?.link?.view,
      ...(page === 'smartAssets' && projectId ? { studioPanel: 'projects' as const } : {}),
      runId: scope.runId, taskId: scope.taskId,
      businessRef: { ...selected?.link?.businessRef, taskKey: task.task_key, ...(projectId ? { entityId: projectId } : customerId ? { entityId: customerId } : scheduledRef ? { entityId: String(scheduledRef.id) } : {}) } } };
}
async function executeInTaskBrowser<T>(input: { tenantId: string; run: RunRecord; task: TaskRecord }, label: string, action: () => Promise<T>): Promise<T> {
  if (!browserExecutionEnabled()) return action();
  // Request-driven runs inherit their authenticated authority. Background runs
  // default to PB, which fails closed instead of turning an unbound worker into
  // a local-fallback browser identity.
  const scope = { tenantId: input.tenantId, runId: input.run.id, taskId: input.task.id, dataAuthority: currentDataAuthority() ?? 'pocketbase' as const };
  const read = () => browserTaskWorkspace(scope);
  if (input.task.task_key === 'content_production') {
    const target = await read();
    const stageLabels: Record<string, string> = { script: '生成脚本', material_match: '匹配分镜素材', voice_subtitles: '生成配音与字幕', heygen: '生成数字人口播', render: '生成成片', quality: '检查成片质量' };
    label = target.projectId ? stageLabels[target.stage || ''] || label : '创建制作项目';
  }
  return agentBrowserSessions.perform(scope, read, label, action);
}
onFollowupWorkerEvent(async event => {
  await appendEvent({
    tenantId: event.tenantId,
    runId: event.runId,
    taskId: event.taskId,
    type: event.type,
    level: event.level,
    summary: event.summary,
    payload: { batchId: event.batchId, itemId: event.itemId, customerId: event.customerId, ...event.payload },
  });
  await appendAudit({
    tenantId: event.tenantId,
    userId: 'followup_worker',
    action: `followup.${event.type}`,
    targetType: event.itemId ? 'followup_batch_item' : 'followup_batch',
    targetId: event.itemId || event.batchId,
    metadata: { runId: event.runId, taskId: event.taskId, batchId: event.batchId, ...event.payload },
  });
});
async function configForTenant(tenantId: string): Promise<ConfigRecord | null> {
  return first<ConfigRecord>(COLLECTION.config, { tenant_id: tenantId }, '-updated_at');
}
const { buildOverview } = createDigitalEmployeeOverviewReader({
  store,
  configForTenant,
  committedGoals: committedDigitalEmployeeOperatingGoals,
  resolveConfiguration: resolveCurrentConfiguration,
  first,
  buildBusinessSnapshot,
  publishingReadinessForOverview,
});
type ApprovalPreflight = {
  ready: boolean;
  reason: string;
  checks: Array<{ key: string; ready: boolean; detail: string }>;
  businessRefs: Array<Record<string, unknown>>;
};
function dependenciesReady(task: TaskRecord, tasks: TaskRecord[]): boolean {
  tasks = tasks.filter(item => !jsonObject<Record<string, unknown>>(item.output, {}).assistantIndependent || item.id === task.id);
  const byKey = new Map(tasks.map(item => [item.task_key, item]));
  return jsonObject<string[]>(task.depends_on, []).every(key => {
    const upstream = byKey.get(key);
    return Boolean(upstream && ['succeeded', 'skipped'].includes(upstream.status));
  });
}
async function approvalPreflight(
  tenantId: string,
  run: RunRecord,
  task: TaskRecord,
  tasks: TaskRecord[],
  snapshot: BusinessSnapshot,
): Promise<ApprovalPreflight> {
  const checks: ApprovalPreflight['checks'] = [{
    key: 'dependencies',
    ready: dependenciesReady(task, tasks),
    detail: dependenciesReady(task, tasks) ? '上游任务已完成' : '上游任务尚未完成',
  }];
  const businessRefs: Array<Record<string, unknown>> = [];
  if (task.task_key === 'content_release_approval') {
    const scope = contentProjectTaskScope(task, tasks);
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    const completed = projects.items.filter(item => recordBelongsToTask(item, run, scope) && studioProjectCompleted(item));
    const social = snapshot.readiness.find(item => item.key === 'social_accounts');
    checks.push(
      { key: 'approved_content_scope', ready: completed.length > 0, detail: completed.length ? `已关联 ${completed.length} 个当前运行的完成作品` : '当前运行尚未关联已完成作品' },
      { key: 'social_accounts', ready: social?.status === 'ready', detail: social?.note || '尚未连接发布账号' },
    );
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
    if (goal) {
      const connectedAccounts = await listConnectedPublishingAccounts(tenantId);
      const connectedIds = new Set(connectedAccounts.map(account => account.accountId));
      const targetPlatforms = goalInput(goal).contentPlatforms;
      const connectedPlatforms = connectedAccounts.map(account => account.platform);
      const [metaClient, instagramClient, tiktokClient, googleClient, linkedinClient] = await Promise.all([
        getTenantAwareMetaOAuthClient(tenantId),
        getTenantAwareInstagramOAuthClient(tenantId),
        getTenantAwareTikTokOAuthClient(tenantId),
        getTenantAwareGoogleOAuthClient(tenantId),
        getTenantAwareLinkedInOAuthClient(tenantId),
      ]);
      const oauthConfigurationGaps = missingPublishingOAuthConfiguration({
        targetPlatforms,
        connectedPlatforms,
        clients: { meta: Boolean(metaClient), instagram: Boolean(instagramClient), tiktok: Boolean(tiktokClient), google: Boolean(googleClient), linkedin: Boolean(linkedinClient) },
      });
      const connectedPlatformSet = new Set(connectedPlatforms);
      const missingAccountPlatforms = targetPlatforms
        .filter((platform): platform is PublishingOAuthPlatform => ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin'].includes(platform))
        .filter(platform => !connectedPlatformSet.has(platform));
      checks.push({
        key: 'publishing_oauth_configuration',
        ready: oauthConfigurationGaps.length === 0,
        detail: publishingOAuthConfigurationMessage(oauthConfigurationGaps),
      });
      checks.push({
        key: 'publishing_account_connections',
        ready: missingAccountPlatforms.length === 0,
        detail: publishingAccountConnectionMessage(missingAccountPlatforms),
      });
      try {
        const publishingPackage = await publishingApprovalPackage(tenantId, goal, run, task, tasks);
        const packageAccountIds = [...new Set(publishingPackage.items.flatMap(item => item.accountIds))];
        const packageAccountsValid = packageAccountIds.length > 0 && packageAccountIds.every(accountId => connectedIds.has(accountId));
        const platformCoverage = publishingPlatformsCovered(targetPlatforms, publishingPackage.items)
          && missingAccountPlatforms.length === 0
          && packageAccountsValid;
        checks.push({ key: 'publishing_platform_coverage', ready: platformCoverage,
          detail: platformCoverage ? '本周目标平台均有已连接的发布账号' : '部分目标平台缺少有效发布账号，请重新连接并更新周计划' });
        checks.push({
          key: 'publishable_outputs',
          ready: publishingPackage.items.length > 0,
          detail: publishingPackage.items.length ? `待审批发布项 ${publishingPackage.items.length} 条` : '完成作品尚缺可发布成片文件',
        });
        checks.push({
          key: 'selected_publishing_accounts',
          ready: packageAccountsValid,
          detail: packageAccountsValid ? `已核验 ${packageAccountIds.length} 个本期发布账号` : '本期选择的发布账号已断开或不再属于当前企业',
        });
      } catch (error) {
        const detail = error instanceof Error && error.message.includes('IANA')
          ? '发布账号尚未配置有效时区，请在账号设置中补充后再审批发布'
          : error instanceof Error && error.message === 'bounded_authorization_actor_missing'
          ? '本周发布授权已因计划或成片变更失效，请重新确认周计划后再审批发布'
          : error instanceof Error && error.message.includes('无法安排')
          ? error.message
          : '发布审批包尚未满足生成条件，请检查账号、排期和成片设置';
        checks.push({ key: 'publishing_package', ready: false, detail });
      }
    }
    businessRefs.push(...completed.map(item => ({ type: 'studio_project', id: item.id, status: String(item.status || '') })));
  }
  if (task.task_key === 'followup_batch_approval') {
    const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
    const items = batch ? await getFollowupBatchItems(tenantId, batch.id) : [];
    const safeDrafts = items.filter(item => item.status === 'draft' && !item.exclusion_reason && Boolean(item.content_hash));
    checks.push(
      { key: 'batch_version', ready: Boolean(batch && ['draft', 'pending_approval'].includes(batch.status) && batch.content_hash), detail: batch ? `批次 v${batch.version}，内容指纹 ${batch.content_hash ? '已生成' : '缺失'}` : '尚未生成当前运行的跟进批次' },
      { key: 'safe_recipients', ready: safeDrafts.length > 0, detail: `可审批草稿 ${safeDrafts.length} 条，安全阻断 ${items.length - safeDrafts.length} 条` },
    );
    if (batch) businessRefs.push({ type: 'followup_batch', id: batch.id, version: batch.version, contentHash: batch.content_hash, safeDraftCount: safeDrafts.length });
  }
  const failed = checks.filter(check => !check.ready);
  const reasonChecks = task.task_key === 'content_release_approval'
    && failed.some(check => check.key === 'publishing_account_connections')
    ? failed.filter(check => !['social_accounts', 'publishing_platform_coverage', 'selected_publishing_accounts'].includes(check.key))
    : failed;
  return {
    ready: failed.length === 0,
    reason: failed.length ? `审批前资源预检未通过：${reasonChecks.map(check => check.detail).join('；')}` : '',
    checks,
    businessRefs,
  };
}
async function createApproval(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, allTasks: TaskRecord[]): Promise<ApprovalRecord> {
  const existing = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, task_id: task.id, status: 'pending' }, '-created_at');
  const approvalCreatedAt = existing?.status === 'pending' && existing.created_at ? existing.created_at : new Date().toISOString();
  const scope = taskScope(task, allTasks);
  const evidence: Array<Record<string, unknown>> = allTasks
    .filter(item => item.id !== task.id && scope.taskIds.has(item.id) && ['succeeded', 'skipped'].includes(item.status))
    .map(item => ({ taskId: item.id, title: item.title, status: item.status, output: jsonObject(item.output, {}), businessRefs: jsonObject(item.business_refs, []) }));
  let actionSummary = '批准内容执行包进入发布日历；本次审批仅批准当前版本，不会伪造平台发布结果。';
  let subjectVersion = Number(task.task_version || 1);
  let contentHash = '';
  let approvalBatch: FollowupBatchRecord | null = null;
  if (task.task_key === 'content_release_approval') {
    const publishingPackage = await publishingApprovalPackage(tenantId, goal, run, task, allTasks, approvalCreatedAt);
    evidence.push({ type: 'publishing_approval_package', ...publishingPackage });
    contentHash = publishingPackage.contentHash;
    actionSummary = publishingPackage.allowRealPublishing
      ? `整批审批 ${publishingPackage.items.length} 个发布项；每项均已冻结平台、账号、文案、成片和时间。批准后自动写入发布日历并由发布 Worker 到期真实发布。`
      : `整批审批 ${publishingPackage.items.length} 个发布项；每项均已冻结平台、账号、文案、成片和时间。当前未授权真实发布，批准后只写入人工待发布日历。`;
  }
  if (task.task_key === 'followup_batch_approval') {
    const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
    if (batch) {
      approvalBatch = batch;
      evidence.push({
        batchId: batch.id,
        segmentId: batch.segment_id,
        version: batch.version,
        contentHash: batch.content_hash,
        counts: jsonObject(batch.counts, {}),
        safetySummary: jsonObject(batch.safety_summary, {}),
        deliveryPolicy: jsonObject(batch.delivery_policy, {}),
      });
      actionSummary = '批准当前版本的逐客跟进草稿；批准后 Worker 仅在逐客计划时间到达且发送前安全复核通过时执行，Meta 回执将逐条回写。';
      subjectVersion = Number(batch.version || 1);
      contentHash = String(batch.content_hash || '');
    }
  }
  const payload = {
    tenant_id: tenantId,
    goal_id: goal.id,
    run_id: run.id,
    task_id: task.id,
    status: 'pending',
    action_summary: actionSummary,
    risk_level: 'high',
    evidence,
    requested_by_agent: task.agent_role,
    decided_by: '',
    decision_note: '',
    created_at: approvalCreatedAt,
    decided_at: '',
    subject_version: subjectVersion,
    content_hash: contentHash,
  };
  let approval: ApprovalRecord;
  if (!existing || Number(existing.subject_version) !== subjectVersion || String(existing.content_hash || '') !== contentHash) {
    if (existing) await store.update(COLLECTION.approvals, existing.id, { status: 'superseded', decided_at: new Date().toISOString() });
    approval = await requiredCreate<ApprovalRecord>(COLLECTION.approvals, payload);
  } else {
    const updated = await store.update(COLLECTION.approvals, existing.id, payload);
    if (!updated) throw new Error('approval_request_storage_unavailable');
    approval = { ...existing, ...payload };
  }
  if (approvalBatch) {
    await store.update(COLLECTION.followupBatches, approvalBatch.id, {
      status: 'pending_approval', approval_id: approval.id, updated_at: new Date().toISOString(),
    });
  }
  return approval;
}
async function completeReview(tenantId: string, goal: GoalRecord, run: RunRecord, tasks: TaskRecord[]): Promise<void> {
  const weeklyPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
  const reviewPackage = jsonObject<{ businessPackage?: WeeklyPackage }>(weeklyPlan?.plan, {}).businessPackage;
  const matrixPlan = reviewPackage?.matrixPlan;
  const existing = await first<StoredRecord & { tenant_id: string; run_id: string; summary: unknown }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: run.id });
  const [approvals, handoffs, businessSnapshot, batchPlans, projects, posts, trendVideos, reviewHistory] = await Promise.all([
    store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
    store.list<HandoffRecord>(COLLECTION.handoffs, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
    buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at }),
    store.list<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 20 }),
    store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 }),
    store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 }),
    store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 100 }).catch(() => ({ items: [] })),
    store.list<StoredRecord & { run_id?: string; summary?: unknown }>(COLLECTION.reviews, { where: { tenant_id: tenantId }, sort: '-created_at', perPage: 20 }),
  ]);
  const taskReview = buildWeeklyReview({
    goal: goalInput(goal),
    totalTasks: tasks.length,
    completedTasks: tasks.filter(task => task.status === 'succeeded').length,
    approvalCount: approvals.items.filter(item => item.status === 'approved').length,
    handoffCount: handoffs.items.length,
    failedTasks: tasks.filter(task => task.status === 'failed').length,
  });
  const reviewRun = tasks.every(task => ['succeeded', 'skipped'].includes(task.status)) ? { ...run, status: 'succeeded' } : run;
  const reviewScope = {
    taskIds: new Set(tasks.map(task => task.id)),
    refIds: new Set(tasks.flatMap(task => jsonObject<Array<Record<string, unknown>>>(task.business_refs, [])
      .flatMap(ref => [ref.id, ref.recordId, ref.entityId, ref.taskId])
      .map(value => String(value || '').trim())
      .filter(Boolean))),
  };
  const contentApprovalTaskIds = new Set(tasks.filter(task => task.task_key === 'content_release_approval').map(task => task.id));
  const previousReview = reviewHistory.items.find(item => String(item.run_id || '') !== run.id);
  const previousRound = jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(previousReview?.summary, {}).nextRoundRecommendations, {});
  const previousTagAdaptation = jsonObject<Record<string, unknown>>(previousRound.tagAdaptation, {});
  const contentFeedback = summarizeContentFeedback({
    orders: batchPlans.items.flatMap(item => jsonObject(item.orders, [])),
    projects: projects.items.filter(item => recordBelongsToTask(item, run, reviewScope)),
    approvals: approvals.items.filter(approval => contentApprovalTaskIds.has(String(approval.task_id || ''))),
    posts: posts.items.filter(item => recordBelongsToTask(item, run, reviewScope)),
    trendVideos: trendVideos.items,
    previousHotTags: jsonObject<string[]>(previousTagAdaptation.hotTags, []),
  });
  const matrixPerformance = matrixPlan ? summarizeWeeklyMatrix(matrixPlan, projects.items.filter(item => recordBelongsToTask(item, run, reviewScope)), posts.items.filter(item => recordBelongsToTask(item, run, reviewScope)), reviewPackage?.tasks.some(task => task.templateId === 'publishing')) : undefined;
  const summary = {
    ...taskReview,
    ...(matrixPerformance ? { matrixPerformance } : {}),
    ...runReviewSummary(reviewRun, tasks, businessSnapshot),
    contentPerformance: contentFeedback.items,
    approvalFeedback: contentFeedback.approvalFeedback,
    nextPlanRecommendations: [...contentFeedback.nextPlanRecommendations, ...(matrixPerformance || []).map(row => `${row.platform} · ${row.accountId}：${row.recommendation}`)],
    nextRoundRecommendations: contentFeedback.nextRoundRecommendations,
    routingEvidence: {
      priorRouteDistribution: contentFeedback.routeCounts,
      approvalFeedback: contentFeedback.approvalFeedback,
      contentInheritance: contentFeedback.nextRoundRecommendations.contentInheritance,
      tagAdaptation: contentFeedback.nextRoundRecommendations.tagAdaptation,
      industryTrends: contentFeedback.nextRoundRecommendations.industryTrends,
    },
  };
  const payload = { status: 'generated', summary };
  if (existing) {
    const updated = await store.update(COLLECTION.reviews, existing.id, payload);
    if (!updated) throw new Error('weekly_reviews_storage_unavailable');
  } else {
    await requiredCreate(COLLECTION.reviews, {
      tenant_id: tenantId, goal_id: goal.id, run_id: run.id, ...payload, created_at: new Date().toISOString(),
    });
  }
}
async function publishingApprovalPackage(
  tenantId: string,
  goal: GoalRecord,
  run: RunRecord,
  task: TaskRecord,
  tasks: TaskRecord[],
  scheduleAnchor?: string,
): Promise<PublishingApprovalPackage> {
  const [plan, configRecord, projects] = await Promise.all([
    tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
    configForTenant(tenantId),
    store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 }),
  ]);
  const currentConfig = publicConfig(configRecord);
  if (!currentConfig) throw new Error('publishing_config_missing');
  const config = executionConfigForPlan(plan, currentConfig);
  const planBody = jsonObject<Record<string, unknown>>(plan?.plan, {});
  const weeklyPackage = planBody.businessPackage as WeeklyPackage | undefined;
  const scope = contentProjectTaskScope(task, tasks);
  const completed = projects.items.filter(item => recordBelongsToTask(item, run, scope) && studioProjectCompleted(item));
  const assistantPublicationTargets = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []).filter(ref => ref.type === 'assistant_publication_intent');
  if (assistantPublicationTargets.length > 1) throw new Error('assistant_publication_target_ambiguous');
  const assistantPublicationTarget = assistantPublicationTargets[0];
  if (assistantPublicationTarget) {
    const selected = completed.filter(project => project.id === assistantPublicationTarget.id);
    if (selected.length !== 1 || contentAcceptanceHash(jsonObject<Record<string, any>>(selected[0]!.spec, {})) !== assistantPublicationTarget.contentHash) throw new Error('assistant_publication_target_changed');
  }
  return buildPublishingApprovalPackage({
    tenantId,
    matrixPlan: jsonObject<{ businessPackage?: WeeklyPackage }>(plan?.plan, {}).businessPackage?.matrixPlan,
    projects: completed,
    ...(assistantPublicationTarget ? { selectedProjectId: String(assistantPublicationTarget.id) } : {}),
    targets: config.publishingTargets,
    goalPlatforms: goalInput(goal).contentPlatforms,
    allowRealPublishing: config.allowRealPublishing,
    now: new Date(scheduleAnchor || (normalizeContinuationPolicy(config.continuationPolicy).publishingTimezone === 'legacy' ? run.started_at : new Date().toISOString())),
    ...(normalizeContinuationPolicy(config.continuationPolicy).publishingTimezone !== 'legacy' ? { scheduling: { startsAt: goal.starts_at, endsAt: goal.ends_at, timezone: normalizeContinuationPolicy(config.continuationPolicy).publishingTimezone as 'account' | 'Asia/Shanghai' } } : {}),
    ...(weeklyPackage?.authorization.mode === 'bounded' ? { boundedAuthorization: {
      packageRevision: weeklyPackage.revision,
      authorizedBy: String(planBody.packageApprovedBy || ''),
      authorizedAt: String(planBody.packageApprovedAt || ''),
      startsAt: goal.starts_at,
      endsAt: goal.ends_at,
      accountBindings: config.publishingTargets
        .filter(target => weeklyPackage.authorization.accountIds.includes(target.accountId))
        .map(target => ({ accountId: target.accountId, platform: target.platform })),
      maxPublishItems: weeklyPackage.authorization.maxPublishItems,
      businessBoundary: {
        products: config.focusProducts,
        markets: config.targetMarkets,
        audience: config.customerProfile,
        languages: [...config.videoLanguages],
        platforms: [...goalInput(goal).contentPlatforms],
        productionBudget: Number(weeklyPackage.directorPlan?.productionBudget || 0),
        paidMediaBudget: Number(weeklyPackage.directorPlan?.paidMediaBudget || 0),
      },
    } } : {}),
  });
}
async function observeTaskProof(tenantId: string, run: RunRecord, task: TaskRecord, snapshot: BusinessSnapshot, tasks: TaskRecord[]) {
  const scope = taskScope(task, tasks);
  if (task.task_key === 'scheduled_source_collection') {
    const scheduled = await store.list<StoredRecord>('scheduled_tasks', {
      where: { tenant_id: tenantId }, perPage: 500,
    });
    const matching = canonicalScheduledCollectionRecords(scheduled.items.filter(item => {
      const config = jsonObject<Record<string, unknown>>(item.config, {});
      if (item.task_type !== 'social_discovery_collection') return false;
      let workflowRefs: Array<{ workflowTaskId?: string }> = [];
      try { workflowRefs = JSON.parse(String(config.workflowRefs || '[]')); } catch { /* older task */ }
      return Array.isArray(workflowRefs) && workflowRefs.some(ref => ref.workflowTaskId === task.id);
    }));
    const persistedRefs = [...new Map(jsonObject<Array<Record<string, unknown>>>(task.business_refs, [])
      .filter(ref => ref.type === 'scheduled_task')
      .map(ref => [String(ref.id || ref.recordId || ''), ref])).values()];
    const businessRefs = matching.length
      ? matching.map(item => ({ type: 'scheduled_task', id: String(item.task_id || item.id), recordId: item.id }))
      : persistedRefs.filter(ref => matching.length || !String(ref.id || '').startsWith('task_de_'));
    const scopeIds = matching.map(item => String(jsonObject<Record<string, unknown>>(item.config, {}).discoveryScopeId || '')).filter(Boolean);
    const discoveryRuns = await store.list<StoredRecord & DiscoveryRunRecord>('social_discovery_runs', {
      where: { tenant_id: tenantId }, perPage: 500,
    });
    const health = evaluateScheduledDiscoveryRuns(matching.length ? discoveryRuns.items : [], scopeIds);
    const ready = businessRefs.length > 0 && health.ready;
    return {
      ready,
      collectionState: health.state,
      proof: {
        metricKey: 'scheduledAutomations', value: businessRefs.length,
        usableContent: health.usable,
        discoveryRunId: health.latest?.id || '',
        status: ready ? 'available' : health.latest ? 'blocked' : 'pending',
        source: 'scheduled_tasks.config.workflowRefs + social_discovery_runs', scope: 'workflow_task',
      },
      businessRefs,
      blockedReason: businessRefs.length ? health.blockedReason : '待编导确认并创建平台采集任务。',
      waitState: ready ? undefined : waitState(health.state === 'failed' ? 'service' : 'processing', businessRefs.length ? health.blockedReason : '待编导确认并创建平台采集任务。'),
    };
  }
  if (task.task_key === 'viral_analysis') {
    const videos = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
    const boundPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
    const packageBody = jsonObject<Record<string, any>>(boundPlan?.plan, {});
    const videoPlans: VideoCreationPlan[] = packageBody.businessPackage?.tasks?.find((item: any) => item.templateId === 'production')?.videoPlans || [];
    const explicitReferences = new Set(reusableExplicitReferenceIds(videoPlans));
    const candidates = videos.items.filter(item => {
      const runIds = scopedValues(item, ['workflowRunId', 'workflow_run_id', 'runId', 'run_id', 'digitalEmployeeRunId']);
      const taskIds = scopedValues(item, ['workflowTaskId', 'workflow_task_id', 'taskId', 'task_id', 'digitalEmployeeTaskId']);
      const currentRunEvidence = runIds.includes(run.id) && taskIds.some(id => scope.taskIds.has(id));
      return currentRunEvidence || scope.refIds.has(item.id) || explicitReferences.has(item.id);
    });
    const coverage = evaluateViralAnalysisCoverage(videoPlans, candidates, { explicitReferenceIds: explicitReferences });
    return {
      ready: coverage.ready,
      proof: {
        metricKey: 'exactAnalyses', value: coverage.completedCount,
        requiredValue: coverage.requiredCount,
        status: coverage.ready ? 'available' : 'pending',
        source: 'trend_videos.aiAnalysis + weekly clone master coverage + workflow scope',
        scope: 'workflow_run_and_task', tenantSnapshotValue: snapshot.content.exactAnalyses.value,
        invalidReferenceIds: coverage.invalidReferenceIds,
      },
      businessRefs: coverage.validRecords.map(item => ({ type: 'trend_video', id: item.id })),
      blockedReason: coverage.blockedReason,
      waitState: coverage.ready ? undefined : waitState('processing', coverage.blockedReason),
    };
  }
  if (task.task_key === 'content_production' || task.task_key === 'content_quality_gate') {
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    const projectScope = contentProjectTaskScope(task, tasks);
    const scoped = projects.items.filter(item => recordBelongsToTask(item, run, projectScope));
    const persistedGaps = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []).filter(ref => ref.type === 'knowledge_gap');
    if (!scoped.length && persistedGaps.length) {
      return {
        ready: false,
        proof: { metricKey: 'contentKnowledgeGaps', value: persistedGaps.length, status: 'blocked', source: 'workflow_tasks.business_refs', scope: 'workflow_task' },
        businessRefs: persistedGaps,
        blockedReason: `内容生产资料待补齐：${persistedGaps.map(ref => String(ref.label || ref.key || '')).filter(Boolean).join('；')}`,
      };
    }
    const requiresAcceptance = task.task_key === 'content_quality_gate' && (await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId))?.metric === 'approved_content_packages';
    const matching = task.task_key === 'content_quality_gate' ? scoped.filter(item => studioProjectCompleted(item) && (!requiresContentHumanAcceptance({ requiresAcceptance, spec: jsonObject(item.spec, {}) }) || contentAccepted(jsonObject(item.spec, {})))) : scoped.filter(studioProjectRendered);
    const result = scopedProof(
      task.task_key === 'content_quality_gate' ? 'completedWorks' : 'contentProjects',
      task.task_key === 'content_quality_gate' ? 'studio_projects.spec.automation.quality + workflow scope' : 'studio_projects.spec.automation.renderOutputPath + workflow scope',
      matching,
      scoped.map(item => ({
        type: 'studio_project', id: item.id, status: String(item.status || ''),
        stage: String(jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(item.spec, {}).automation, {}).stage || ''),
      })),
      task.task_key === 'content_quality_gate' ? snapshot.content.completedWorks.value : snapshot.content.contentProjects.value,
    );
    const plan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
    const pack = plan ? jsonObject<{ businessPackage?: WeeklyPackage }>(plan.plan, {}).businessPackage : undefined;
    const expectedCount = pack?.tasks.find(t => t.templateId === 'production')?.videoPlans?.length || 1;
    result.ready = scoped.length >= expectedCount && matching.length === scoped.length;
    result.proof = { ...result.proof, value: matching.length, status: result.ready ? 'available' : 'pending' };
    const projectAutomationStates = scoped.map(item =>
      jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(item.spec, {}).automation, {}));
    const retryPolicy = (automation: Record<string, unknown>) => {
      if (automation.retryPolicy === 'input_required') return 'input_required';
      if (automation.route === 'clone' && String(automation.blocker || '').trim()) {
        return managedReplicationFailureState(String(automation.blocker)).retryPolicy;
      }
      return 'service_retry';
    };
    const activeProjects = projectAutomationStates.filter(automation => {
      return !['blocked', 'completed', 'superseded'].includes(String(automation.stage || ''))
        || (automation.stage === 'blocked' && retryPolicy(automation) !== 'input_required');
    });
    // One content item's missing input must not pause siblings that can still
    // advance. Escalate to waiting_human only after no runnable item remains.
    const blocker = activeProjects.length ? '' : projectAutomationStates
      .filter(automation => automation.stage === 'blocked' && retryPolicy(automation) === 'input_required')
      .map(automation => String(automation.blocker || '').trim())
      .find(Boolean) || '';
    const serviceReason = projectAutomationStates
      .filter(automation => automation.stage === 'blocked' && retryPolicy(automation) !== 'input_required')
      .map(automation => String(automation.blocker || '').trim())
      .find(Boolean) || '';
    return {
      ...result,
      ...(serviceReason && !blocker ? { waitState: waitState('processing', `系统正在自动恢复未完成的服务步骤：${serviceReason}`) } : {}),
      blockedReason: blocker || (requiresAcceptance && !result.ready && !activeProjects.length ? '内容成片尚未完成所需质量检查' : ''),
    };
  }
  if (task.task_key === 'publishing_calendar') {
    const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
    const matching = posts.items.filter(item => recordBelongsToTask(item, run, scope) && (() => {
      const status = String(jsonObject<Record<string, unknown>>(item.stats, {}).status || '');
      return ['awaiting_manual_publish', 'scheduled', 'publishing', 'published', 'partial'].includes(status) || postHasPublishedReceipt(item);
    })());
    return scopedProof('scheduledOrPublishedPosts', 'posts.stats.status + workflow scope', matching, matching.map(item => ({ type: 'post', id: item.id })), Number(snapshot.content.scheduledPosts.value || 0) + Number(snapshot.content.publishedPosts.value || 0));
  }
  if (task.task_key === 'platform_publish') {
    const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
    const scoped = posts.items.filter(item => recordBelongsToTask(item, run, scope));
    const matching = scoped.filter(postFullyPublished);
    const result = scopedProof('publishedPosts', 'posts.platform_post_id + publishResults + workflow scope', matching, matching.map(item => ({ type: 'post', id: item.id, receipt: true })), snapshot.content.publishedPosts.value);
    return { ...result, ready: scoped.length > 0 && matching.length === scoped.length,
      waitState: publishingWait(scoped, process.env.PUBLISH_SCHEDULER_ENABLED === 'true') };
  }
  if (task.task_key === 'customer_attribution') {
    const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
    const scopedPosts = posts.items.filter(item => recordBelongsToTask(item, run, scope));
    const postIds = new Set(scopedPosts.map(item => item.id));
    const trackCodes = new Set(scopedPosts.map(item => String(item.track_code || item.trackCode || '')).filter(Boolean));
    const customers = await getWhatsAppCustomers(tenantId) as Array<Record<string, unknown>>;
    const matching = customers.filter(customer => postIds.has(String(customer.sourcePostId || '')) || trackCodes.has(String(customer.sourceTrackCode || '')));
    return scopedProof('attributedCustomers', 'whatsapp_customers.sourcePostId + run-scoped posts', matching.map(customer => ({ id: String(customer.id || '') })), matching.map(customer => ({ type: 'customer', id: String(customer.id || ''), sourcePostId: String(customer.sourcePostId || '') })), snapshot.customer.attributed.value);
  }
  if (task.task_key === 'customer_segmentation') {
    const segments = await store.list<StoredRecord>(COLLECTION.segments, {
      where: { tenant_id: tenantId, run_id: run.id, task_id: task.id }, sort: '-version', perPage: 100,
    });
    const matching = segments.items.filter(item => ['generated', 'active', 'ready'].includes(String(item.status || '')));
    return {
      ready: snapshot.customer.segmentSnapshots.status === 'available' && matching.length > 0,
      proof: { metricKey: 'segmentSnapshots', value: matching.length, status: snapshot.customer.segmentSnapshots.status, source: 'customer_segments' },
      businessRefs: matching.map(item => ({ type: 'customer_segment', id: item.id, version: Number(item.version || 1), memberCount: Number(item.member_count || 0) })),
    };
  }
  if (task.task_key === 'followup_batch_draft') {
    const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches, {
      where: { tenant_id: tenantId, run_id: run.id, task_id: task.id }, sort: '-version', perPage: 100,
    });
    let draftCount = 0;
    const refs: Array<Record<string, unknown>> = [];
    for (const batch of batches.items.filter(item => !['superseded', 'cancelled'].includes(item.status))) {
      const items = await getFollowupBatchItems(tenantId, batch.id);
      draftCount += items.filter(item => ['draft', 'approved', 'blocked', 'retry_wait'].includes(item.status)).length;
      refs.push({ type: 'followup_batch', id: batch.id, version: batch.version, contentHash: batch.content_hash, itemCount: items.length });
    }
    return {
      ready: snapshot.customer.followupDrafts.status === 'available' && draftCount > 0,
      proof: { metricKey: 'followupDrafts', value: draftCount, status: snapshot.customer.followupDrafts.status, source: 'followup_batch_items.status' },
      businessRefs: refs,
    };
  }
  if (task.task_key === 'followup_dispatch') {
    const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches, {
      where: { tenant_id: tenantId, run_id: run.id }, perPage: 500,
    });
    const currentBatch = [...batches.items]
      .filter(batch => !['superseded', 'cancelled'].includes(batch.status))
      .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
    if (currentBatch) await recoverStaleFollowupSending(currentBatch);
    const currentItems = currentBatch ? await getFollowupBatchItems(tenantId, currentBatch.id) : [];
    let sent = 0;
    const refs: Array<Record<string, unknown>> = [];
    for (const batch of currentBatch ? [currentBatch] : []) {
      const items = currentItems;
      const delivered = items.filter(item => ['sent', 'delivered', 'read', 'partial_sent'].includes(item.status) && Boolean(item.provider_message_id));
      sent += delivered.length;
      refs.push(...delivered.map(item => ({ type: 'followup_receipt', batchId: batch.id, itemId: item.id, providerMessageId: item.provider_message_id })));
    }
    const dispatchPreflight = currentBatch
      ? await preflightFollowupBatchDispatch(tenantId, currentBatch.id, { mode: 'scheduled' })
      : null;
    return {
      ready: followupComplete(currentItems),
      proof: { metricKey: 'outreachSent', value: sent, status: snapshot.customer.outreachSent.status, source: 'followup_batch_items.provider_receipt' },
      businessRefs: refs,
      dispatchPreflight,
      followupWaitState: followupWait(currentItems),
      blockedReason: dispatchPreflight
        ? followupDispatchPreflightBlockedReason(dispatchPreflight)
        : '真实发送预检：尚未生成跟进批次',
    };
  }
  return { ready: false, proof: { metricKey: task.task_key, value: 0, status: 'pending', source: 'unmapped_observe_task' }, businessRefs: [] as Array<Record<string, unknown>> };
}
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
async function applyPackageGrant(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, tasks: TaskRecord[], plan: PlanRecord | null): Promise<boolean> {
  const body = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
  const pack = body.businessPackage as WeeklyPackage | undefined;
  const actor = String(body.packageApprovedBy || '');
  if (!pack || !actor || packageGrantWasInvalidatedAfterApproval(body) || pack.authorization.mode !== 'bounded' || beijingDate(new Date()) < goal.starts_at) return false;
  const recurringGrantId = String(body.managedPublishingGrantId || '');
  if (recurringGrantId) {
    const latest = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
    if (task.task_key !== 'content_release_approval' || !latest || !managedPublishingGrantCovers(pack, latest.config, recurringGrantId, goal.ends_at)) return false;
  }
  // Edited/re-approved subjects always return to a human; grants are not renewed implicitly.
  const previous = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, task_id: task.id }, perPage: 100 });
  if (previous.items.some(a => a.status !== 'pending')) return false;
  const now = new Date().toISOString();
  let publishing: PublishingApprovalPackage | undefined;
  let batch: FollowupBatchRecord | null = null;
  if (task.task_key === 'content_release_approval') {
    publishing = await publishingApprovalPackage(tenantId, goal, run, task, tasks, now);
    const publishAccountIds = publishing.items.flatMap(i => i.accountIds);
    if (!publishing.allowRealPublishing || !grantCovers(pack, 'publish', publishAccountIds, publishAccountIds.length, beijingDate(new Date(now)), goal.ends_at)) return false;
    if (publishing.items.some(i => beijingDate(new Date(i.scheduledAt)) > goal.ends_at)) return false;
    const connected = await listConnectedPublishingAccounts(tenantId);
    if (publishing.items.some(i => i.accountIds.some(id => !connected.some(a => a.accountId === id && a.platform === i.platform)))) return false;
  } else if (task.task_key === 'followup_batch_approval') {
    batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
    if (!batch) return false;
    const items = await getFollowupBatchItems(tenantId, batch.id);
    if (!grantCovers(pack, 'send', items.map(i => i.customer_id), items.length, beijingDate(new Date(now)), goal.ends_at)) return false;
    if (items.some(i => i.risk_level !== 'low' || Boolean(i.exclusion_reason) || /价格|报价|付款|交期|MOQ|price|payment|delivery date/i.test(String(i.draft_body || '')))) return false;
  } else return false;
  const approval = await createApproval(tenantId, goal, run, task, tasks);
  let entries: Array<{ id: string; status: string }> = [];
  if (publishing) {
    // Use createApproval's exact schedule anchor/hash for immutable receipts.
    publishing = await publishingApprovalPackage(tenantId, goal, run, task, tasks, approval.created_at);
    if (publishing.contentHash !== approval.content_hash || publishing.items.some(i => beijingDate(new Date(i.scheduledAt)) > goal.ends_at)) return false;
    entries = await createPublishingCalendarEntries({ tenantId, runId: run.id, approvalTaskId: task.id, approvalId: approval.id, approvedContentHash: publishing.contentHash, package: publishing, managedPublishingGrantId: recurringGrantId || undefined });
  }
  if (batch) await applyFollowupBatchDecision({ tenantId, batchId: batch.id, decision: 'approved', userId: actor, approvalId: approval.id });
  const note = `依据本周经营包第 ${pack.revision} 版的范围授权`;
  await store.update(COLLECTION.approvals, approval.id, { status: 'approved', decided_by: actor, decision_note: note, decided_at: now });
  await store.update(COLLECTION.tasks, task.id, { status: 'succeeded', blocked_reason: '', output: { decision: 'approved', note, publishingEntries: entries }, updated_at: now });
  await appendAudit({ tenantId, userId: actor, action: 'weekly_package.grant_applied', targetType: 'approval_request', targetId: approval.id, metadata: { runId: run.id, revision: pack.revision, contentHash: approval.content_hash } });
  await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.decided', level: 'success', summary: note });
  return true;
}
async function advanceRun(tenantId: string, runId: string): Promise<void> {
  await withDigitalEmployeeRunLock(tenantId, runId, () => advanceRunUnlocked(tenantId, runId));
}
const queuedRunAdvances = new Set<string>();
/**
 * A control command is complete once its reset/replan state is durably stored.
 * Advancing the workflow can include real provider collection and must not hold
 * the user's HTTP request open. The normal runtime cycle remains the durable
 * fallback if this immediate continuation cannot finish.
 */
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
/** Trusted backend entry point. Ownership is re-checked inside advanceRunUnlocked. */
export async function reconcileDigitalEmployeeRun(tenantId: string, runId: string): Promise<void> {
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
  if (videoTask?.videoPlans) goal.scope = { description: goalInput(goal).scope, videoPlans: videoTask.videoPlans };
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
      if (videoTask?.videoPlans) goal.scope = { description: goalInput(goal).scope, videoPlans: videoTask.videoPlans };
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
        if (videoTask?.videoPlans) goal.scope = { description: goalInput(goal).scope, videoPlans: videoTask.videoPlans };
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
async function supersedeAffectedBusinessState(tenantId: string, run: RunRecord, affected: TaskRecord[], now: string): Promise<void> {
  await supersedeTaskCorrectionBusinessState({ store, tenantId, run, affected, now,
    controlJob: controlContentExecutionJob, getFollowupBatchItems });
}
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
digitalEmployeesRouter.get('/overview', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const goalId = String(req.query.goalId || '').trim();
  if (goalId) {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
    if (!goal || !isDigitalEmployeeOperatingGoal(goal) || !await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
      res.status(404).json({ error: 'goal_not_found' }); return;
    }
  }
  const startsAt = String(req.query.startsAt || '').trim();
  const endsAt = String(req.query.endsAt || '').trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const requestedRange = startsAt && endsAt && datePattern.test(startsAt) && datePattern.test(endsAt) && startsAt <= endsAt
    ? { startsAt, endsAt }
    : undefined;
  res.json(await buildOverview(tenantId, goalId, requestedRange));
});
async function resumeInitialPreparationPlan(tenantId:string,goalId:string,allowBlocked=false){
 const lease=await acquireDurableOperationLease({dataStore:store,tenantId,scope:'initial_operating_preparation',subjectId:goalId,ownerId:`initial-${randomUUID()}`,leaseDurationMs:30*60_000});
 if(!lease)return;
 try{
 const plan=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:goalId});const goal=await tenantRecord<GoalRecord>(COLLECTION.goals,goalId,tenantId);if(!plan||!goal)return;
 if(!await weeklyGoalFactRebuildTargetCommitted(tenantId,goal))return;
 const body=jsonObject<Record<string,unknown>>(plan.plan,{});if(hasWeeklyGoalFactRebuildPlanFence(body))return;const state=body.initialPreparation as InitialPreparation|undefined;if(!state||state.status==='running'||state.status==='blocked'&&!allowBlocked)return;
 const existingRun=await first<RunRecord>(COLLECTION.runs,{tenant_id:tenantId,goal_id:goalId});if(existingRun&&existingRun.plan_id===plan.id){await persistInitialPreparationState({dataStore:store,collection:COLLECTION.plans,planId:plan.id,tenantId,state:{...state,status:'running',runId:existingRun.id,reason:''}});return;}
 if(plan.status!=='draft')return;
 const resolved=await resolveCurrentConfiguration(tenantId,await configForTenant(tenantId));if(!resolved)throw Error('初始化配置不存在');const config=executionConfigForPlan(plan,resolved.config);if(config.allowRealPublishing||config.allowRealCustomerMessages)throw Error('初始化制作准备不接受真实发布或客户发送授权');
 await advanceInitialPreparation(state,{
 save:async value=>{await assertDurableOperationLease({dataStore:store,lease,minimumRemainingMs:1000});await persistInitialPreparationState({dataStore:store,collection:COLLECTION.plans,planId:plan.id,tenantId,state:value});},
 enqueue:async source=>{const job=await createCrawlWorkerJob({tenantId,requestedBy:state.confirmedBy,platform:source.platform,mode:source.mode,keyword:source.mode==='keyword'?source.value:'',accountUrl:source.mode==='account'?source.value:'',accountName:config.companyName,limit:30,idempotencyKey:initialPreparationJobKey(tenantId,state,source)});if(!job)throw Error('真实采集任务创建失败');return job.id;},
 observe:async id=>{const job=await store.getById<StoredRecord>('crawl_jobs',id);if(!job||job.tenantId!==tenantId)throw Error('原采集任务不存在');const result=jsonObject<{candidateIds?:string[]}>(job.resultJson,{});return {status:String(job.status),candidateIds:result.candidateIds||[],error:String(job.error||'')};},
 analyzed:async ids=>{const rows=await Promise.all(ids.map(id=>store.getById<StoredRecord>('trend_videos',id)));if(rows.some(row=>!row||row.tenantId!==tenantId))throw Error('原采集候选已失效');const exact=rows.filter(row=>row&&exactVideoAnalysis(row));if(exact.length>=Math.max(1,Number(goal.target)||1))return true;if(rows.every(row=>['analyzed','failed'].includes(String(row!.status))))throw Error('真实全片分析合格参考不足，请调整范围或修复分析后继续');return false;},
 prepare:async ids=>{const latest=await tenantRecord<PlanRecord>(COLLECTION.plans,plan.id,tenantId);if(!latest)throw Error('原计划不存在');const currentBody=jsonObject<Record<string,unknown>>(latest.plan,{});const pack=currentBody.businessPackage as WeeklyPackage;if(pack.revision!==state.revision)throw Error('计划版本已修改，请重新确认');const videos=await Promise.all(ids.map(id=>store.getById<StoredRecord>('trend_videos',id)));const enriched=enrichPackageWithContentSignals({pack,goal:goalInput(goal),config,videos:videos.filter((v):v is StoredRecord=>!!v),benchmarks:[]});const detailed=await generateWeeklyTaskPreviews({tenantId,goal,plan:latest,pack:enriched,config,planBody:currentBody});const compiled=compilePackage(detailed,goalInput(goal),config);await replaceInitialPreparationPlan({dataStore:store,collection:COLLECTION.plans,expected:latest,tenantId,nextPlan:{...currentBody,...compiled},conflictMessage:'计划版本已修改，请重新确认'});return {ready:detailed.detailGeneration?.status==='ready',reason:detailed.detailGeneration?.blockers.join('；'),revision:detailed.revision};},
 activate:async revision=>{const result=await approveGoalForReview(tenantId,state.confirmedBy,goalId,revision,[]);if(result.status!==200)throw Error((result.body as {message?:string;error?:string}).message||(result.body as {error?:string}).error||'制作启动失败');const run=await first<RunRecord>(COLLECTION.runs,{tenant_id:tenantId,goal_id:goalId});if(!run)throw Error('实际制作运行未创建');return run.id;},
 });
 }finally{await releaseDurableOperationLease({dataStore:store,lease});}
}
export async function resumeConfirmedInitialPlans(){
 for(let page=1;;page++){const rows=await store.list<PlanRecord>(COLLECTION.plans,{page,perPage:200});
 for(const row of rows.items){const state=jsonObject<{initialPreparation?:InitialPreparation}>(row.plan,{}).initialPreparation;if(state&&['collecting','analyzing','preparing'].includes(state.status))await resumeInitialPreparationPlan(row.tenant_id,row.goal_id).catch(error=>console.warn('[initial-preparation]',String(error)));}
 if(page>=rows.totalPages||rows.items.length<200)break;}
}
let initialPreparationTimer:ReturnType<typeof setInterval>|undefined;
export function initInitialPreparationWorker():boolean{if(initialPreparationTimer)return false;initialPreparationTimer=setInterval(()=>{void resumeConfirmedInitialPlans().catch(error=>console.warn('[initial-preparation]',String(error)));},30_000);initialPreparationTimer.unref?.();return true;}
export function stopInitialPreparationWorker(){if(!initialPreparationTimer)return;clearInterval(initialPreparationTimer);initialPreparationTimer=undefined;}
digitalEmployeesRouter.post('/onboarding/history-collection',async(req,res)=>{
 const {tenantId,userId}=res.locals as AuthLocals;
 try{const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw Error('请求身份缺失');const source=initialPreparationSources({platforms:[req.body.platform],products:['企业产品'],stage:'b2b_growth',historyAccounts:[req.body.accountUrl],historyCollectionRequestId:requestId}).find(s=>s.origin==='owned')!;const state={requestId,goalId:'history'} as InitialPreparation;const job=await createCrawlWorkerJob({tenantId,requestedBy:userId,platform:source.platform,mode:'account',accountUrl:source.value,limit:30,idempotencyKey:initialPreparationJobKey(tenantId,state,source)});if(!job)throw Error('采集任务创建失败');res.status(202).json({jobId:job.id,status:job.status});}catch(error){res.status(400).json({error:'history_collection_failed',message:error instanceof Error?error.message:'历史采集失败'});}
});
digitalEmployeesRouter.get('/goals/:goalId/initial-preparation',async(req,res)=>{const {tenantId}=res.locals as AuthLocals;const plan=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:String(req.params.goalId)});res.json({preparation:plan?jsonObject<{initialPreparation?:InitialPreparation}>(plan.plan,{}).initialPreparation||null:null});});
digitalEmployeesRouter.post('/goals/:goalId/initial-preparation',async(req,res)=>{
 const {tenantId,userId}=res.locals as AuthLocals;const goalId=String(req.params.goalId);
 const confirmationLease=await acquireDurableOperationLease({dataStore:store,tenantId,scope:'initial_operating_confirmation',subjectId:goalId,ownerId:`confirm-${randomUUID()}`,leaseDurationMs:30*60_000});if(!confirmationLease){res.status(409).json({error:'initial_confirmation_in_progress',message:'原确认正在处理，请查询原计划进度'});return;}
 try{await withLocalQueue(goalApprovalQueues,`${tenantId}:initial-confirm:${goalId}`,async()=>{
 const goal=await tenantRecord<GoalRecord>(COLLECTION.goals,goalId,tenantId);const plan=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:goalId});if(!goal||!plan)throw Error('原计划不存在');
 if(!await weeklyGoalFactRebuildTargetCommitted(tenantId,goal))throw Error('最新事实周目标尚未完成安全替换');
 const body=jsonObject<Record<string,unknown>>(plan.plan,{});if(plan.status!=='draft'||hasWeeklyGoalFactRebuildPlanFence(body))throw Error('原计划正在发生状态变更');const existing=body.initialPreparation as InitialPreparation|undefined;const pack=repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage);
 if(req.body?.resume&&existing){await resumeInitialPreparationPlan(tenantId,goalId,true);return;}
 const sourceScope=()=>initialPreparationSourcesFromPersisted({goalPlatforms:jsonObject(goal.content_platforms,[]),businessPackage:pack,config:body.configSnapshot,profile:frozenEnterpriseProfileForPlan(plan,false)},{historyAccounts:req.body?.historyAccounts,historyCollectionRequestId:req.body?.historyCollectionRequestId});
 if(existing){if(existing.requestId!==String(req.body?.requestId))throw Error('已确认原计划，请查询或恢复原请求');if(JSON.stringify(existing.sources.map(({jobId,...source})=>source))!==JSON.stringify(sourceScope()))throw Error('确认范围变化，请修订计划');return;}
 if(goal.status!=='draft')throw Error('原计划已执行，不接受新的初始化确认');
 const requestId=String(req.body?.requestId||'');if(!/^[a-zA-Z0-9-]{8,100}$/.test(requestId))throw Error('请求身份缺失');
 if(!pack||pack.revision!==Number(req.body?.revision))throw Error('计划版本已变化');
 const state:InitialPreparation={requestId,goalId,revision:pack.revision,confirmedBy:userId,confirmedAt:new Date().toISOString(),status:'collecting',sources:sourceScope(),candidateIds:[],reason:''};
 await replaceInitialPreparationPlan({dataStore:store,collection:COLLECTION.plans,expected:plan,tenantId,nextPlan:{...body,initialPreparation:state},conflictMessage:'计划版本已变化，请重新确认'});
 await resumeInitialPreparationPlan(tenantId,goalId);
 });const latest=await first<PlanRecord>(COLLECTION.plans,{tenant_id:tenantId,goal_id:goalId});res.status(202).json({preparation:jsonObject<{initialPreparation?:InitialPreparation}>(latest?.plan,{}).initialPreparation});
 }catch(error){res.status(409).json({error:'initial_preparation_failed',message:error instanceof Error?error.message:'初始化准备失败'});}finally{await releaseDurableOperationLease({dataStore:store,lease:confirmationLease});}
});
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
          const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, selected.subject.id, identity.tenantId);
          const plan = goal ? await first<PlanRecord>(COLLECTION.plans, { tenant_id: identity.tenantId, goal_id: goal.id }) : null;
          if (!goal || !plan) throw new AssistantDecisionCommandError('assistant_decision_context_missing', 409);
          assertAssistantDecisionVersion(selected, weeklyPlanDecisionVersion(goal, plan));
          const pack = jsonObject<Record<string, unknown>>(plan.plan, {}).businessPackage as WeeklyPackage | undefined;
          const members = await listTenantEmployees(identity, req.headers.authorization);
          const result = await approveGoalForReview(identity.tenantId, identity.userId, goal.id, Number(pack?.revision || 0), members);
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
digitalEmployeesRouter.post('/onboarding/complete', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const onboardingInput = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const minimalOnboarding = onboardingInput.minimalOnboarding === true;
  // First login deliberately asks for no operating assumptions. These values
  // satisfy the internal legacy runtime contract only; they are never written
  // into Enterprise Center and cannot authorize publishing or customer sends.
  const submittedConfig = normalizeDigitalEmployeeConfig(minimalOnboarding ? {
    ...onboardingInput,
    industry: '待在实际任务中确认',
    primaryBusiness: '待在实际任务中确认',
    targetMarkets: String(onboardingInput.targetMarkets || '').trim() || '待在实际任务中确认',
    customerProfile: '待在实际任务中确认',
    focusProducts: String(onboardingInput.focusProducts || '').trim(),
    primaryGoal: 'awareness',
    approvalOwner: String(onboardingInput.approvalOwner || '').trim() || '企业管理员',
    enabledWorkflows: ['viral_clone'],
    publishingTargets: Array.isArray(onboardingInput.publishingTargets) ? onboardingInput.publishingTargets : [],
    allowRealPublishing: false,
    allowRealCustomerMessages: false,
    allowGeneratedVisuals: onboardingInput.allowGeneratedVisuals === true,
    autonomyMode: 'managed',
  } : onboardingInput);
  const boundPublishing = await bindPublishingTargets(tenantId, submittedConfig.publishingTargets);
  submittedConfig.publishingTargets = boundPublishing.targets;
  // Initial production setup may be partial. Invalid legacy account bindings
  // are NOT authorization: omit them, retain evidence in audit, and recheck at
  // the actual release gate. Full settings saves remain strict.
  if (boundPublishing.invalidAccountIds.length && !minimalOnboarding) {
    res.status(409).json({
      error: 'publishing_accounts_invalid',
      message: '部分发布账号不属于当前企业或已断开连接，请重新选择。',
      invalidAccountIds: boundPublishing.invalidAccountIds,
    });
    return;
  }
  const existing = await configForTenant(tenantId);
  const now = new Date().toISOString();
  const grantErrors = managedPublishingGrantErrors(submittedConfig.managedPublishingGrant, submittedConfig, beijingDate(new Date(now)));
  if (grantErrors.length) { res.status(400).json({ error: 'managed_publishing_grant_invalid', message: grantErrors.join('；') }); return; }
  if (submittedConfig.managedPublishingGrant?.enabled) {
    submittedConfig.managedPublishingGrant = { ...submittedConfig.managedPublishingGrant, grantId: randomUUID(), authorizedBy: userId, authorizedAt: now };
  } else delete submittedConfig.managedPublishingGrant;
  const enterprise = await readTenantEnterpriseProfile(tenantId);
  const minimalCompanyName = String(onboardingInput.companyName || enterprise.company.name || '').trim();
  const minimalBrandName = String(onboardingInput.brandName || enterprise.brand?.name || '').trim();
  const minimalContentStage = ['b2b_launch', 'b2b_growth', 'd2c_brand'].includes(String(enterprise.socialStrategy?.contentStage || ''))
    ? enterprise.socialStrategy?.contentStage
    : undefined;
  if (minimalOnboarding) {
    const missing = [
      ...(!minimalCompanyName ? ['企业名称'] : []),
      ...(!minimalBrandName ? ['品牌名称'] : []),
      ...(!(enterprise.products.items?.length) ? ['产品表'] : []),
      ...(!minimalContentStage ? ['社媒经营阶段'] : []),
    ];
    if (missing.length) { res.status(400).json({ error: 'onboarding_incomplete', missing }); return; }
  }
  const customerAgentEnabled = submittedConfig.enabledWorkflows.some(workflow => (
    workflow === 'customer_segmentation' || workflow === 'batch_followup'
  ));
  const companyPatch = {
    ...enterprise.company,
    name: enterprise.company.name || submittedConfig.companyName,
    industry: enterprise.company.industry || submittedConfig.industry,
    mainMarkets: enterprise.company.mainMarkets || submittedConfig.targetMarkets,
    description: enterprise.company.description || submittedConfig.primaryBusiness,
  };
  const enterprisePatch = minimalOnboarding ? {
    company: { ...enterprise.company, name: minimalCompanyName },
    brand: { ...enterprise.brand, name: minimalBrandName },
    strategy: { ...enterprise.strategy, focusProducts: submittedConfig.focusProducts || enterprise.strategy?.focusProducts, focusMarkets: submittedConfig.targetMarkets || enterprise.strategy?.focusMarkets },
    customerService: {
      ...enterprise.customerService,
      enabled: false,
      disabledAt: now,
      partialAutoReplyEnabled: false,
      partialAutoReplyDecision: 'pending' as const,
      partialAutoReplyDecisionAt: '',
    },
  } : {
    company: {
      ...companyPatch,
      name: enterprise.company.name || submittedConfig.companyName,
      industry: enterprise.company.industry || submittedConfig.industry,
      mainMarkets: enterprise.company.mainMarkets || submittedConfig.targetMarkets,
    },
    strategy: {
      ...enterprise.strategy,
      focusMarkets: enterprise.strategy?.focusMarkets || submittedConfig.targetMarkets,
      focusProducts: enterprise.strategy?.focusProducts || submittedConfig.focusProducts,
    },
    customers: {
      ...enterprise.customers,
      targetProfiles: enterprise.customers?.targetProfiles || submittedConfig.customerProfile,
    },
    customerService: {
      ...enterprise.customerService,
      enabled: customerAgentEnabled,
      enabledAt: customerAgentEnabled ? (enterprise.customerService?.enabledAt || now) : '',
      disabledAt: customerAgentEnabled ? '' : now,
      partialAutoReplyEnabled: customerAgentEnabled && enterprise.customerService?.partialAutoReplyEnabled === true,
      partialAutoReplyDecision: customerAgentEnabled
        ? (enterprise.customerService?.partialAutoReplyDecision || 'pending')
        : 'pending' as const,
      partialAutoReplyDecisionAt: customerAgentEnabled ? (enterprise.customerService?.partialAutoReplyDecisionAt || '') : '',
    },
  };
  const nextVersion = Math.max(1, Number(existing?.config_version || 0) + 1);
  const candidate = resolveDigitalEmployeeConfiguration({
    config: submittedConfig,
    enterpriseProfile: {
      ...enterprise,
      ...enterprisePatch,
    },
    configVersion: nextVersion,
    boundAt: now,
  });
  const missing = validateDigitalEmployeeConfig(candidate.config);
  if (missing.length) { res.status(400).json({ error: 'onboarding_incomplete', missing }); return; }
  const enterpriseProfile = await updateTenantEnterpriseProfile(tenantId, enterprisePatch, userId);
  const resolved = resolveDigitalEmployeeConfiguration({
    config: submittedConfig,
    enterpriseProfile,
    configVersion: nextVersion,
    boundAt: now,
  });
  const payload = {
    tenant_id: tenantId,
    config: resolved.config,
    status: 'active',
    config_version: resolved.configVersion,
    policy_version: resolved.policyVersion,
    facts_version: resolved.knowledgeBinding.factsVersion,
    effective_config: publicConfigurationMetadata(resolved),
    activated_at: now,
    updated_by: userId,
    updated_at: now,
  };
  const saved = existing
    ? await store.update(COLLECTION.config, existing.id, payload)
    : Boolean(await store.create(COLLECTION.config, { ...payload, created_at: now }));
  if (!saved) { res.status(503).json({ error: 'onboarding_storage_unavailable' }); return; }
  await requiredCreate(COLLECTION.configVersions, {
    tenant_id: tenantId,
    config_version: resolved.configVersion,
    policy_version: resolved.policyVersion,
    facts_version: resolved.knowledgeBinding.factsVersion,
    config: resolved.config,
    knowledge_binding: resolved.knowledgeBinding,
    runtime_policy: resolved.runtimePolicy,
    status: 'active',
    created_by: userId,
    created_at: now,
  });
  const activeRuns = await store.list<RunRecord>(COLLECTION.runs, { where: { tenant_id: tenantId }, perPage: 100 });
  for (const run of activeRuns.items.filter(item => !['succeeded', 'failed', 'cancelled'].includes(item.status))) {
    const activePlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
    if (!activePlan) continue;
    const changedFields = criticalBusinessConfigChanges(configSnapshotForPlan(activePlan, resolved.config), resolved.config);
    if (!changedFields.length) continue;
    await appendEvent({
      tenantId,
      runId: run.id,
      type: 'critical_business_change',
      level: 'warning',
      summary: '产品、市场、平台账号或真实发布许可已变更；运行中周包（含原预算边界）仍使用原授权快照，请查看影响并决定是否重新规划。',
      payload: { eventType: 'critical_business_change', changedFields, action: 'review_weekly_package' },
    });
  }
  await appendAudit({ tenantId, userId, action: 'digital_employee.onboarding.completed', targetType: 'digital_employee_config', targetId: existing?.id || tenantId, metadata: { autonomyMode: resolved.config.autonomyMode, minimalOnboarding, configVersion: resolved.configVersion, policyVersion: resolved.policyVersion, factsVersion: resolved.knowledgeBinding.factsVersion, deferredPublishingAccountIds: boundPublishing.invalidAccountIds } });
  res.json(await buildOverview(tenantId));
});
digitalEmployeesRouter.get('/content-projects/:projectId/production', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
  if (!project) { res.status(404).json({ error: 'project_not_found' }); return; }
  const spec = jsonObject<Record<string, any>>(project.spec, {});
  const outputPath = String(spec.automation?.renderOutputPath || spec.renderOutputPath || '').trim();
  const assetRoot = path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantId.replace(/[^\w.-]+/g, '-'));
  const resolvedOutput = outputPath ? path.resolve(outputPath) : '';
  const outputAccessible = Boolean(resolvedOutput && fs.existsSync(assetRoot) && fs.existsSync(resolvedOutput)
    && fs.statSync(resolvedOutput).isFile() && path.dirname(resolvedOutput) === assetRoot
    && path.dirname(fs.realpathSync(resolvedOutput)) === fs.realpathSync(assetRoot));
  const videoUrl = outputAccessible
    ? signAssetUrl(`/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(resolvedOutput))}`, tenantId)
    : '';
  const hash = contentAcceptanceHash(spec);
  res.json({ projectId: project.id, hash, videoUrl, approved: contentAccepted(spec), qualityPassed: spec.automation?.quality?.passed === true, spec: { lang: spec.lang, duration: spec.duration, voice: spec.contentOrder?.videoPlan?.voice || spec.voice, voiceStyle: spec.voiceStyle, voiceoverUrl: spec.voiceoverUrl, bgm: spec.bgm, bgmVol: spec.bgmVol, bgmSelection: spec.bgmSelection, voiceSelection: spec.voiceSelection, scenePlan: spec.contentOrder?.videoPlan?.scenePlan, sceneSourcePlan: spec.sceneSourcePlan, materialIds: spec.automation?.routePlan?.assetIds || [], sceneOverrides: spec.sceneOverrides, cues: spec.alignedCuesByLang?.[spec.lang] || [], subtitleStyle: spec.subtitleStyle, subtitleAlignmentSource: spec.subtitleAlignmentSource, coverTitle: spec.coverTitle, coverFrameTime: spec.coverFrameTime, exportSpec: spec.exportSpec, ratio: spec.ratio, stage: spec.automation?.stage }, managed: spec.automation?.managedBy === 'digital_employee' });
});
digitalEmployeesRouter.post('/content-projects/:projectId/revise', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const original = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
  const initial = jsonObject<Record<string, any>>(original?.spec, {});
  if (!original || !initial.workflowRunId) { res.status(404).json({ error: 'project_not_found' }); return; }
  await withDigitalEmployeeRunLock(tenantId, initial.workflowRunId, async () => {
    try {
      const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
      const spec = jsonObject<Record<string, any>>(project?.spec, {});
      const run = await tenantRecord<RunRecord>(COLLECTION.runs, initial.workflowRunId, tenantId);
      if (!project || !run || run.status === 'cancelled' || spec.publishedAt || spec.publishingReceipt) { res.status(409).json({ error: '已发布或已取消的任务请复制为新计划' }); return; }
      const posted = await store.list<any>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
      if (posted.items.some(post => { const stats=jsonObject<Record<string, any>>(post.stats, {}); return stats.sourceProjectId===project.id && ['published','partial'].includes(stats.status); })) { res.status(409).json({ error: '该项目已有真实发布结果，请复制为新计划' }); return; }
      if (req.body.hash !== contentAcceptanceHash(spec)) { res.status(409).json({ error: '后台已更新项目，请刷新后修改' }); return; }
      if (req.body.node === 'music' && req.body.values?.bgm && !automationBgmCatalog(tenantId).some(track => track.id === req.body.values.bgm)) throw Error('配乐不属于当前企业可用曲库');
      const next = reviseContent(spec, req.body.node, req.body.values || {});
      const now = new Date().toISOString();
      if (!await store.update('studio_projects', project.id, {
        status: 'draft', spec: next,
        ...contentProjectLineageFields({ tenantId, spec: next, current: project }),
        updated_at: now,
      })) throw Error('项目保存失败');
      await invalidatePublishingApprovalForProject(tenantId, project.id);
      const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
      for (const task of tasks.items.filter(t => ['content_production', 'content_quality_gate', 'weekly_review'].includes(t.task_key))) await store.update(COLLECTION.tasks, task.id, { status: 'pending', blocked_reason: '', output: {}, updated_at: now });
      await store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', completed_at: '', pause_reason: '' });
      if (run.goal_id) await store.update(COLLECTION.goals, run.goal_id, { status: 'active', updated_at: now });
      await appendAudit({ tenantId, userId, action: 'content.node_revised', targetType: 'studio_project', targetId: project.id, metadata: { node: req.body.node, version: next.automation.contentVersion } });
      res.json({ ok: true, stage: next.automation.stage });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
});
digitalEmployeesRouter.post('/content-projects/:projectId/narration', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const original = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
  const originalSpec = jsonObject<Record<string, any>>(original?.spec, {});
  if (!original || !originalSpec.workflowRunId) { res.status(404).json({ error: 'project_not_found' }); return; }
  await withDigitalEmployeeRunLock(tenantId, originalSpec.workflowRunId, async () => {
    const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
    const spec = jsonObject<Record<string, any>>(project?.spec, {});
    const run = await tenantRecord<RunRecord>(COLLECTION.runs, originalSpec.workflowRunId, tenantId);
    if (!project || !run || ['cancelled', 'succeeded'].includes(run.status) || project.status === 'published') { res.status(409).json({ error: '当前运行不能修改，请复制为新的制作计划' }); return; }
    if (req.body?.hash !== contentAcceptanceHash(spec)) { res.status(409).json({ error: '口播版本已变化，请刷新' }); return; }
    const lines = req.body?.lines;
    if (!Array.isArray(lines) || lines.length < 3 || lines.length > 8 || lines.some(line => typeof line !== 'string' || !line.trim() || /[\r\n]/.test(line)) || lines.join(' ').length > 5000 || !spokenLanguageMatches(lines.join(' '), String(spec.lang))) { res.status(400).json({ error: '请保留每段完整口播，使用制作计划的语言，总长不超过 5000 字符' }); return; }
    try {
      const script = freezeStoryboardNarration(String(spec.script || ''), lines.map(line => line.trim()));
      const now = new Date().toISOString();
      const nextSpec = { ...spec, script, narrationHistory: [...(Array.isArray(spec.narrationHistory) ? spec.narrationHistory : []), { script: spec.script, version: Number(spec.automation?.contentVersion || 1), changedAt: now }].slice(-20), contentAcceptance: null, productionDirection: null, subtitleAlignmentSource: '', voiceoverUrl: '', voiceoverDur: 0, alignedCuesByLang: {}, renderOutputPath: '', automation: { ...spec.automation, contentVersion: Number(spec.automation?.contentVersion || 1) + 1, stage: 'voice_subtitles', status: 'queued', blocker: '', narrationFeedback: '', narrationReviewPassed: false, heygenJobId: '', voiceLocalPath: '', quality: {}, renderOutputPath: '', renderedAt: '', completedAt: '' } };
      await store.update('studio_projects', project.id, {
        status: 'draft', updated_at: now, spec: nextSpec,
        ...contentProjectLineageFields({ tenantId, spec: nextSpec, current: project }),
      });
      await invalidatePublishingApprovalForProject(tenantId, project.id);
      const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
      for (const task of tasks.items.filter(task => ['content_production', 'content_quality_gate', 'weekly_review'].includes(task.task_key))) await store.update(COLLECTION.tasks, task.id, { status: 'pending', blocked_reason: '', output: {}, updated_at: now });
      await store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', completed_at: '', pause_reason: '' });
      if (run.goal_id) await store.update(COLLECTION.goals, run.goal_id, { status: 'active', updated_at: now });
      await appendAudit({ tenantId, userId, action: 'content.narration_revised', targetType: 'studio_project', targetId: project.id, metadata: { priorHash: contentAcceptanceHash(spec), version: Number(spec.automation?.contentVersion || 1) + 1 } });
      res.json({ ok: true });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '口播修改失败' }); }
  });
});
digitalEmployeesRouter.post('/content-projects/:projectId/approve', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const initial = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
  if (!initial) { res.status(404).json({ error: 'project_not_found' }); return; }
  const initialSpec = jsonObject<Record<string, any>>(initial.spec, {});
  await withDigitalEmployeeRunLock(tenantId, initialSpec.workflowRunId || initial.id, async () => {
    const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', req.params.projectId, tenantId);
    if (!project) { res.status(404).json({ error: 'project_not_found' }); return; }
    const spec = jsonObject<Record<string, any>>(project.spec, {});
    if (spec.automation?.stage !== 'completed' || spec.automation?.quality?.passed !== true || spec.automation?.quality?.ruleVersion !== CONTENT_SCRIPT_QUALITY_RULE_VERSION) { res.status(409).json({ error: '成片质检尚未通过' }); return; }
    const hash = contentAcceptanceHash(spec);
    if (req.body?.hash !== hash) { res.status(409).json({ error: '成片版本已变化，请刷新并重新预览' }); return; }
    const nextSpec = { ...spec, contentAcceptance: { hash, approvedBy: userId, approvedAt: new Date().toISOString() } };
    const saved = await store.update('studio_projects', project.id, {
      spec: nextSpec,
      ...contentProjectLineageFields({ tenantId, spec: nextSpec, current: project }),
    });
    if (!saved) { res.status(503).json({ error: '审批保存失败' }); return; }
    await appendAudit({ tenantId, userId, action: 'content.accepted', targetType: 'studio_project', targetId: project.id, metadata: { hash } });
    res.json({ ok: true });
  });
});
digitalEmployeesRouter.get('/planning-options', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const config = await configForTenant(tenantId);
  const resolved = await resolveCurrentConfiguration(tenantId, config);
  if (!resolved) { res.status(409).json({ error: 'onboarding_required' }); return; }
  const evidence = await contentRoutingEvidence(tenantId, resolved.config);
  const profile = await readTenantEnterpriseProfile(tenantId);
  const assets = (profile.products?.items || []).flatMap((product: any, index) => {
    const groups = ['images', 'videos', 'factoryImages', 'packagingImages', 'sceneImages', 'brandAssets'].map(key => Array.isArray(product[key]) ? product[key] : []);
    if (String(product.imageUrl || '').trim()) groups.unshift([{ url: product.imageUrl, name: '产品封面' }]);
    return groups.flat().map((asset: any, assetIndex: number) => ({ id: enterpriseAssetStableId(index, assetIndex, String(asset.url || '')), name: asset.name || '产品素材' }));
  });
  const videos = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
  res.json({ ...evidence, assets, references: videos.items.filter(exactVideoAnalysis).map(item => {
    const analysis = jsonObject<Record<string, any>>(item.aiAnalysis, {});
    const thumbnailUrl = [item.thumbnailUrl, item.coverUrl, item.thumbnail, analysis.thumbnailUrl, analysis.coverUrl]
      .map(value => String(value || '').trim()).find(Boolean) || '';
    const sourceUrl = [item.sourceUrl, item.videoUrl, item.url, analysis.sourceUrl, analysis.videoUrl]
      .map(value => String(value || '').trim()).find(Boolean) || '';
    return {
      id: item.id,
      name: String(item.title || item.id),
      platform: String(item.platform || ''),
      thumbnailUrl,
      sourceUrl,
      views: String(item.views || analysis.views || ''),
      account: String(analysis.sourceAccountName || analysis.author || item.author || ''),
    };
  }) });
});
digitalEmployeesRouter.get('/package-options', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const [members, projects] = await Promise.all([listTenantEmployees(res.locals as AuthLocals, req.headers.authorization), store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 })]);
  res.json({ members: members.map(m => ({ id: m.id, name: m.name || m.email })), projects: projects.items.filter(studioProjectRendered).map(p => ({ id: p.id, title: String(p.title || p.id) })), customers: (await getWhatsAppCustomers(tenantId)).map(c => ({ id: c.id, name: String(c.name || c.id) })) });
});
digitalEmployeesRouter.post('/goals/:goalId/package/recommend', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
  if (!goal || goal.status !== 'draft') { res.status(409).json({ error: 'draft_required' }); return; }
  if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
    res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能修改。' }); return;
  }
  const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
  const configRecord = await configForTenant(tenantId);
  const current = publicConfig(configRecord);
  if (!current) { res.status(409).json({ error: 'onboarding_required' }); return; }
  const resolved = await resolveCurrentConfiguration(tenantId, configRecord);
  const snapshot = configSnapshotForPlan(plan, current);
  // Local development intentionally provides one enterprise-named account per
  // supported platform. Recommending a draft must rebind legacy `planned:*`
  // targets to those usable accounts instead of preserving dead placeholders.
  const config = localPublishingAccountMocksEnabled() && resolved
    ? { ...snapshot, companyName: resolved.config.companyName, publishingTargets: resolved.config.publishingTargets }
    : snapshot;
  const currentPackage = plan ? jsonObject<{ businessPackage?: WeeklyPackage }>(plan.plan, {}).businessPackage : undefined;
  const planBody = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
  const savedFactsVersion = String(jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {}).factsVersion || '').trim();
  if (savedFactsVersion && resolved && savedFactsVersion !== resolved.knowledgeBinding.factsVersion) {
    res.status(409).json({ error: 'enterprise_facts_changed', message: '企业事实已更新，请基于最新事实新建周目标。', ...weeklyGoalFactRebuildRecovery(goal, plan!, savedFactsVersion, resolved.knowledgeBinding.factsVersion) });
    return;
  }
  const enterpriseProfile = frozenEnterpriseProfileForPlan(plan, false)
    || (resolved ? enterpriseProfileFromKnowledgeBinding(resolved.knowledgeBinding) as EnterpriseProfile | null : null);
  if (!enterpriseProfile) { res.status(409).json({ error: 'enterprise_fact_snapshot_missing' }); return; }
  const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
  const member = members.find(m => m.id === userId);
  const proposal = await recommendPackageWithTenantEvidence(tenantId, goalInput(goal), { ...config, operatingMaturity: currentPackage?.maturity || config.operatingMaturity, operatingAssessment: currentPackage?.operatingAssessment || config.operatingAssessment, defaultParticipation: currentPackage?.participation || config.defaultParticipation }, userId, member?.name, enterpriseProfile);
  proposal.revision = currentPackage?.revision || 0;
  res.json(proposal);
});
digitalEmployeesRouter.post('/goals/:goalId/package/details', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  await withLocalQueue(goalApprovalQueues, `${tenantId}:package-details:${req.params.goalId}`, async () => {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
    if (!goal || goal.status !== 'draft') {
      res.status(409).json({ error: 'draft_required', message: '只有待确认的周视频计划可以生成制作准备。' });
      return;
    }
    if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
      res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能修改。' });
      return;
    }
    const run = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id });
    if (run) {
      res.status(409).json({ error: 'package_locked', message: '计划已经开始执行，不能重新生成任务预览。' });
      return;
    }
    const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
    if (!plan) { res.status(404).json({ error: 'plan_not_found' }); return; }
    const observedPlanPayload = plan.plan;
    const planBody = jsonObject<Record<string, unknown>>(plan.plan, {});
    if (plan.status !== 'draft' || hasWeeklyGoalFactRebuildPlanFence(planBody)) {
      res.status(409).json({ error: 'package_locked', message: '计划正在发生状态变更，请刷新后重试。' }); return;
    }
    const pack = planBody.businessPackage ? repairCollapsedWeeklyVideoProduction(planBody.businessPackage as WeeklyPackage) : undefined;
    if (!pack) { res.status(409).json({ error: 'weekly_package_missing', message: '请先制定本周目标和视频计划。' }); return; }
    const configRecord = await configForTenant(tenantId);
    const currentConfig = publicConfig(configRecord);
    if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
    const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
    const savedFactsVersion = String(jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {}).factsVersion || '').trim();
    if (savedFactsVersion && resolvedConfiguration && savedFactsVersion !== resolvedConfiguration.knowledgeBinding.factsVersion) {
      res.status(409).json({ error: 'enterprise_facts_changed', message: '企业事实已更新，请基于最新事实新建周目标。', ...weeklyGoalFactRebuildRecovery(goal, plan, savedFactsVersion, resolvedConfiguration.knowledgeBinding.factsVersion) });
      return;
    }
    if (resolvedConfiguration && !frozenEnterpriseProfileForPlan(plan, false)) {
      planBody.knowledgeBinding = resolvedConfiguration.knowledgeBinding;
      plan.plan = planBody;
    }
    const config = localPublishingAccountMocksEnabled() && resolvedConfiguration
      ? resolvedConfiguration.config
      : configSnapshotForPlan(plan, currentConfig);
    if (config.smartOperationsEnabled === false) {
      res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭；开启后才能生成新的 Agent 任务详情。' });
      return;
    }
    const currentPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
    const currentMasterPlans = currentPlans.filter(item => item.productionRole !== 'platform_adaptation');
    const productionProfile = frozenEnterpriseProfileForPlan(plan, false)
      || (resolvedConfiguration ? enterpriseProfileFromKnowledgeBinding(resolvedConfiguration.knowledgeBinding) as EnterpriseProfile | null : null);
    if (!productionProfile) {
      res.status(409).json({ error: 'enterprise_fact_snapshot_missing', message: '企业事实快照缺失，请重新确认企业与产品资料后再生成制作详情。' });
      return;
    }
    let preparationReadiness: Awaited<ReturnType<typeof readServerProductionOnboardingReadiness>>;
    try {
      preparationReadiness = await readServerProductionOnboardingReadiness({
        store,
        tenantId,
        profile: productionProfile,
        preferences: config.productionOnboarding,
        plans: currentMasterPlans,
        // Budget is finalized after the storyboard quote. This first gate checks
        // only zero-cost enterprise, presenter and local-material prerequisites.
        budgetConfirmed: true,
      });
    } catch (error) {
      res.status(503).json({
        error: 'production_onboarding_preflight_unavailable',
        message: `${error instanceof Error ? error.message : '生产资料预检暂时不可用'}；本次未调用制作服务，请稍后重试。`,
      });
      return;
    }
    if (!preparationReadiness.ready) {
      res.status(409).json({
        error: 'production_onboarding_preflight_blocked',
        message: `制作详情尚未生成：${preparationReadiness.blockers.map(item => item.message).join('；')}`,
        blockers: preparationReadiness.blockers,
        requiredArchetypes: preparationReadiness.requiredArchetypes,
      });
      return;
    }
    if (pack.detailGeneration?.status === 'ready' && currentMasterPlans.length > 0
      && currentMasterPlans.every(item => item.preproduction?.readiness.canStart)) {
      res.json(await buildOverview(tenantId, goal.id));
      return;
    }
    const lease = await acquireDurableOperationLease({
      dataStore: store, tenantId, scope: 'weekly_package_details', subjectId: goal.id,
      ownerId: `weekly-details-${randomUUID()}`, leaseDurationMs: 30 * 60_000,
    });
    if (!lease) {
      res.status(202).json(await buildOverview(tenantId, goal.id));
      return;
    }
    try {
      const startedAt = new Date().toISOString();
      const generatingPack: WeeklyPackage = {
        ...pack,
        detailGeneration: {
          status: 'generating', startedAt, generatedAt: '',
          estimatedMinutes: Math.max(2, Math.ceil(currentMasterPlans.length / 2) * 2), usageCostCny: null,
          readyCount: 0, blockedCount: 0, blockers: [],
        },
      };
      const generatingPlan = { ...planBody, businessPackage: generatingPack };
      if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
        tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: observedPlanPayload,
      }, { plan: generatingPlan })) {
        res.status(503).json({ error: 'weekly_plan_storage_unavailable' });
        return;
      }
      try {
        const detailed = await generateWeeklyTaskPreviews({ tenantId, goal, plan, pack: generatingPack, config, planBody: generatingPlan });
        await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
        const compiled = compilePackage(detailed, goalInput(goal), config);
        if (!await store.compareAndSwap!(COLLECTION.plans, plan.id, {
          tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: generatingPlan,
        }, { plan: { ...generatingPlan, ...compiled } })) {
          throw new Error('周任务详情保存失败，请重试');
        }
        await appendAudit({
          tenantId, userId, action: 'weekly_package.details_generated', targetType: 'weekly_plan', targetId: plan.id,
          metadata: {
            revision: detailed.revision,
            readyCount: detailed.detailGeneration?.readyCount || 0,
            blockedCount: detailed.detailGeneration?.blockedCount || 0,
            usageCostCny: detailed.detailGeneration?.usageCostCny ?? null,
          },
        });
        res.json(await buildOverview(tenantId, goal.id));
      } catch (error) {
        const reason = error instanceof Error ? error.message : '任务详情生成失败';
        const blockedPack: WeeklyPackage = {
          ...generatingPack,
          detailGeneration: {
            ...generatingPack.detailGeneration!, status: 'blocked', generatedAt: new Date().toISOString(),
            readyCount: 0, blockedCount: currentMasterPlans.length, blockers: [reason.slice(0, 500)],
          },
        };
        await store.compareAndSwap!(COLLECTION.plans, plan.id, {
          tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: generatingPlan,
        }, { plan: { ...generatingPlan, businessPackage: blockedPack } }).catch(() => false);
        res.status(503).json({ error: 'weekly_package_detail_generation_failed', message: `${reason}。已保留周视频计划，可修复后重试。` });
      }
    } finally {
      await releaseDurableOperationLease({ dataStore: store, lease }).catch(() => undefined);
    }
  });
});
digitalEmployeesRouter.put('/goals/:goalId/package', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
    if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
    if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
      res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能修改。' }); return;
    }
    const run = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id });
    if (goal.status !== 'draft' || run) { res.status(409).json({ error: 'package_locked', message: '计划已启动，请在执行任务中处理调整。' }); return; }
    const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id });
    if (!plan) { res.status(404).json({ error: 'plan_not_found' }); return; }
    const body = jsonObject<Record<string, unknown>>(plan.plan, {});
    if (plan.status !== 'draft' || hasWeeklyGoalFactRebuildPlanFence(body)) {
      res.status(409).json({ error: 'package_locked', message: '计划正在发生状态变更，请刷新后重试。' }); return;
    }
    let pack: WeeklyPackage;
    try { pack = normalizePackage(req.body); } catch (e) { res.status(400).json({ error: String(e) }); return; }
    if (new Set(pack.tasks.map(t => t.templateId)).size !== pack.tasks.length || pack.tasks.some(t => !TASK_TEMPLATES.some(template => template.id === t.templateId))) { res.status(400).json({ error: 'invalid_templates' }); return; }
    const old = body.businessPackage as WeeklyPackage | undefined;
    if (pack.revision !== (old?.revision || 0)) { res.status(409).json({ error: 'package_changed', message: '计划已更新，请刷新后重新调整。' }); return; }
    // Drafts may contain missing dependencies so deleting a producer can be
    // followed by selecting an existing input. Execution validates completeness.
    const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
    if (pack.tasks.some(t => t.ownerId && !members.some(m => m.id === t.ownerId))) { res.status(400).json({ error: 'invalid_owner', message: '负责人必须是当前企业成员。' }); return; }
    for (const task of pack.tasks) task.ownerName = members.find(m => m.id === task.ownerId)?.name || '';
    const configRecord = await configForTenant(tenantId);
    const currentConfig = publicConfig(configRecord);
    if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
    const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
    const savedFactsVersion = String(jsonObject<Record<string, unknown>>(body.knowledgeBinding, {}).factsVersion || '').trim();
    if (savedFactsVersion && resolvedConfiguration && savedFactsVersion !== resolvedConfiguration.knowledgeBinding.factsVersion) {
      res.status(409).json({ error: 'enterprise_facts_changed', message: '企业事实已更新，请基于最新事实新建周目标。', ...weeklyGoalFactRebuildRecovery(goal, plan, savedFactsVersion, resolvedConfiguration.knowledgeBinding.factsVersion) });
      return;
    }
    const config = localPublishingAccountMocksEnabled() && resolvedConfiguration
      ? resolvedConfiguration.config
      : configSnapshotForPlan(plan, currentConfig);
    if (pack.authorization.accountIds.some(id => !config.publishingTargets.some(t => t.accountId === id))) { res.status(400).json({ error: 'invalid_account_scope', message: '请选择本计划绑定的发布账号。' }); return; }
    if (pack.matrixPlan?.some(row => !goalInput(goal).contentPlatforms.includes(row.platform) || (row.connected !== false && !config.publishingTargets.some(target => target.accountId === row.accountId && target.platform === row.platform)))) { res.status(400).json({ error: 'invalid_matrix_account', message: '矩阵账号必须属于本计划及本周平台范围。' }); return; }
    const customerIds = new Set((await getWhatsAppCustomers(tenantId)).map(c => c.id));
    if (pack.authorization.customerIds.some(id => !customerIds.has(id))) { res.status(400).json({ error: 'invalid_customer_scope' }); return; }
    for (const id of [...new Set([...pack.tasks.flatMap(t => t.sourceProjectIds), ...(pack.matrixPlan || []).flatMap(row => row.sourceProjectIds)])]) {
      const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', id, tenantId);
      if (!project || !studioProjectRendered(project)) { res.status(400).json({ error: 'invalid_source_project', message: '已有作品不可用，请重新选择。' }); return; }
    }
    // A matrix, product, budget or content edit invalidates previous
    // pre-production evidence. Publication copy is regenerated from the same
    // frozen weekly plan so title/caption/tags stay aligned with the product.
    delete pack.detailGeneration;
    for (const task of pack.tasks) {
      if (task.templateId !== 'production') continue;
      task.videoPlans = (task.videoPlans || []).map(source => {
        const videoPlan = normalizeVideoPlan(source);
        delete videoPlan.preproduction;
        videoPlan.publication = publicationCopyForPlan({
          plan: videoPlan,
          productName: videoPlan.productName,
          theme: videoPlan.planningEvidence?.referenceTitle || videoPlan.theme,
        });
        return videoPlan;
      });
    }
    pack.revision = (old?.revision || 0) + 1;
    const compiled = compilePackage(pack, goalInput(goal), config);
    const needsFactSnapshot = !savedFactsVersion || !frozenEnterpriseProfileForPlan(plan, false);
    const localConfigurationSnapshot = resolvedConfiguration
      ? localPublishingAccountMocksEnabled()
        ? configurationSnapshot(resolvedConfiguration)
        : needsFactSnapshot
          ? { knowledgeBinding: resolvedConfiguration.knowledgeBinding }
          : {}
      : {};
    if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
      tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: plan.plan,
    }, { plan: { ...body, ...localConfigurationSnapshot, ...compiled } })) {
      res.status(409).json({ error: 'package_changed', message: '计划已更新或正在重建，请刷新后重新调整。' }); return;
    }
    await appendAudit({ tenantId, userId, action: 'weekly_package.updated', targetType: 'weekly_plan', targetId: plan.id, metadata: { revision: pack.revision, tasks: pack.tasks } });
    res.json(await buildOverview(tenantId, goal.id));
  });
});
digitalEmployeesRouter.patch('/goals/:goalId/production-budget-mode', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const mode = req.body?.mode === 'economy' ? 'economy' as const
    : req.body?.mode === 'protected' ? 'protected' as const : null;
  const expectedRevision = Number(req.body?.packageRevision);
  if (!mode || !Number.isInteger(expectedRevision)) {
    res.status(400).json({ error: 'production_budget_mode_invalid', message: '请选择有效的开工预算方案。' }); return;
  }
  await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
    const plan = goal ? await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }) : null;
    const run = goal ? await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }) : null;
    if (!goal || !plan) { res.status(404).json({ error: 'weekly_plan_not_found', message: '没有找到对应的周计划。' }); return; }
    if (goal.status !== 'draft' || plan.status !== 'draft' || run) {
      res.status(409).json({ error: 'production_budget_locked', message: '计划已开工，预算授权不能在生产中途静默变更。' }); return;
    }
    const body = jsonObject<Record<string, unknown>>(plan.plan, {});
    const pack = body.businessPackage ? repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage) : undefined;
    if (!pack?.directorPlan || pack.revision !== expectedRevision) {
      res.status(409).json({ error: 'package_changed', message: '计划已更新，请重新核对预算后再选择。' }); return;
    }
    const masters = pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.filter(item => item.productionRole !== 'platform_adaptation') || [];
    const productionBudgetMin = Math.round(masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.minCny || 0), 0) * 100) / 100;
    const productionBudgetMax = Math.round(masters.reduce((sum, item) => sum + Number(item.estimatedCostRange?.maxCny || 0), 0) * 100) / 100;
    const verified = masters.length > 0 && masters.every(item => item.estimatedCostRange?.basis === 'verified_storyboard_provider_envelope');
    if (!verified || productionBudgetMin <= 0 || productionBudgetMax < productionBudgetMin) {
      res.status(409).json({ error: 'production_budget_forecast_required', message: '可靠预算尚未生成，请先完成周计划详情准备后再选择开工方案。' }); return;
    }
    const nextPack: WeeklyPackage = {
      ...pack,
      revision: pack.revision + 1,
      directorPlan: {
        ...pack.directorPlan,
        productionBudgetMode: mode,
        productionBudget: mode === 'economy' ? productionBudgetMin : productionBudgetMax,
        productionBudgetMin,
        productionBudgetMax,
        productionReserved: 0,
      },
    };
    const configRecord = await configForTenant(tenantId);
    const currentConfig = publicConfig(configRecord);
    if (!currentConfig) { res.status(409).json({ error: 'onboarding_required' }); return; }
    const config = executionConfigForPlan(plan, currentConfig);
    const compiled = compilePackage(nextPack, goalInput(goal), config);
    if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
      tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: plan.plan,
    }, { plan: { ...body, ...compiled } })) {
      res.status(409).json({ error: 'package_changed', message: '计划刚刚发生变化，请刷新后重新选择。' }); return;
    }
    await appendAudit({ tenantId, userId, action: 'weekly_package.production_budget_mode_selected', targetType: 'weekly_plan', targetId: plan.id,
      metadata: { revision: nextPack.revision, mode, productionBudgetMin, productionBudgetMax, approvedCeilingCny: nextPack.directorPlan!.productionBudget } });
    res.json(await buildOverview(tenantId, goal.id));
  });
});
digitalEmployeesRouter.patch('/goals/:goalId/publication-schedule/:contentId', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const goalId = String(req.params.goalId || '').trim();
  const contentId = String(req.params.contentId || '').trim();
  const scheduledAt = String(req.body?.scheduledAt || '').trim();
  if (!contentId || contentId.length > 160 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) || !Number.isFinite(Date.parse(scheduledAt))) {
    res.status(400).json({ error: 'publication_schedule_invalid', message: '请选择有效的发布日期和时间。' }); return;
  }
  await withLocalQueue(goalApprovalQueues, `${tenantId}:publication-schedule:${goalId}`, async () => {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
    const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goalId });
    if (!goal || !plan) { res.status(404).json({ error: 'weekly_plan_not_found', message: '没有找到对应的周计划。' }); return; }
    const publishDate = beijingDate(new Date(scheduledAt));
    if (publishDate < goal.starts_at || publishDate > goal.ends_at) {
      res.status(400).json({ error: 'publication_schedule_outside_cycle', message: `发布时间必须在本周周期 ${goal.starts_at} 至 ${goal.ends_at} 内。` }); return;
    }
    const run = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goalId });
    if (run) {
      const workflow = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, page: 1, perPage: 200 });
      const locked = workflow.items.find(task => ['content_release_approval', 'publishing_calendar', 'platform_publish'].includes(task.task_key)
        && !['pending', 'skipped', 'cancelled'].includes(task.status));
      if (locked) {
        res.status(409).json({ error: 'publication_schedule_locked', message: '这条内容已经进入发布审批或平台执行，请到发布与渠道中调整，避免重复发布。' }); return;
      }
    }
    const body = jsonObject<Record<string, unknown>>(plan.plan, {});
    const pack = body.businessPackage ? repairCollapsedWeeklyVideoProduction(body.businessPackage as WeeklyPackage) : undefined;
    const production = pack?.tasks.find(task => task.templateId === 'production');
    const matches = production?.videoPlans?.filter(video => video.contentId === contentId) || [];
    if (!pack || !production || matches.length !== 1) {
      res.status(404).json({ error: 'publication_content_not_found', message: '没有找到这条内容的发布安排，请刷新后重试。' }); return;
    }
    const nextPlans = production.videoPlans!.map(video => video.contentId === contentId
      ? normalizeVideoPlan({ ...video, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt })
      : video);
    const nextPack: WeeklyPackage = {
      ...pack,
      tasks: pack.tasks.map(task => task === production ? { ...task, videoPlans: nextPlans } : task),
    };
    const nextBody = { ...body, businessPackage: nextPack };
    if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
      tenant_id: tenantId, goal_id: goalId, plan: plan.plan,
    }, { plan: nextBody })) {
      res.status(409).json({ error: 'publication_schedule_changed', message: '周计划刚刚发生变化，请刷新后再调整。' }); return;
    }
    const scope = jsonObject<Record<string, unknown>>(goal.scope, { description: typeof goal.scope === 'string' ? goal.scope : '' });
    const goalPlans = Array.isArray(scope.videoPlans) ? scope.videoPlans as VideoCreationPlan[] : [];
    if (goalPlans.some(video => video.contentId === contentId)) {
      await store.update(COLLECTION.goals, goal.id, {
        scope: { ...scope, videoPlans: goalPlans.map(video => video.contentId === contentId ? normalizeVideoPlan({ ...video, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt }) : video) },
        updated_at: new Date().toISOString(),
      });
    }
    if (run) {
      const batch = await first<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { tenant_id: tenantId, run_id: run.id });
      if (batch) {
        const orders = jsonObject<ContentOrder[]>(batch.orders, []);
        const nextOrders = orders.map(order => ({
          ...order,
          ...(order.videoPlan?.contentId === contentId ? { videoPlan: normalizeVideoPlan({ ...order.videoPlan, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt }) } : {}),
          ...(order.deliveryVariants?.some(variant => variant.contentId === contentId) ? { deliveryVariants: order.deliveryVariants.map(variant => variant.contentId === contentId ? { ...variant, plannedPublishDate: publishDate, plannedPublishAt: scheduledAt } : variant) } : {}),
        }));
        await store.update(COLLECTION.contentBatchPlans, batch.id, { orders: nextOrders, updated_at: new Date().toISOString() });
      }
    }
    await appendAudit({ tenantId, userId, action: 'weekly_publication.rescheduled', targetType: 'weekly_content', targetId: contentId, metadata: { goalId, planId: plan.id, scheduledAt, publishDate, timeZone: 'Asia/Shanghai' } });
    res.json(await buildOverview(tenantId, goalId));
  });
});
digitalEmployeesRouter.post('/goals/:goalId/rebuild-from-latest-facts', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const requestId = String(req.body?.requestId || '').trim();
  const expectedGoalVersion = Number(req.body?.expectedGoalVersion);
  const suppliedSourcePlanId = String(req.body?.sourcePlanId || '').trim();
  const suppliedExpectedFactsVersion = String(req.body?.expectedFactsVersion || '').trim();
  const suppliedSourcePlanDigest = String(req.body?.expectedSourcePlanDigest || '').trim();
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestId)
    || !Number.isSafeInteger(expectedGoalVersion)
    || expectedGoalVersion < 1
    || !/^[A-Za-z0-9_-]{1,200}$/.test(suppliedSourcePlanId)
    || !suppliedExpectedFactsVersion
    || suppliedExpectedFactsVersion.length > 160
    || !/^[a-f0-9]{64}$/.test(suppliedSourcePlanDigest)) {
    res.status(400).json({ error: 'goal_fact_rebuild_request_invalid', message: '周目标重建请求身份或版本无效。' });
    return;
  }
  await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
    let source = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
    if (!source) { res.status(404).json({ error: 'goal_not_found' }); return; }
    if (!isDigitalEmployeeOperatingGoal(source)) { res.status(409).json({ error: 'operating_goal_required' }); return; }
    if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, source)) {
      res.status(409).json({ error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能再次重建。' }); return;
    }
    if (Number(source.version) !== expectedGoalVersion) {
      res.status(409).json({ error: 'goal_changed', message: '周目标版本已变化，请刷新后重试。', goalVersion: Number(source.version || 0) });
      return;
    }
    let sourcePlan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: source.id });
    if (!sourcePlan) { res.status(404).json({ error: 'plan_not_found' }); return; }
    if (sourcePlan.id !== suppliedSourcePlanId || weeklyGoalFactRebuildSourcePlanDigest(sourcePlan) !== suppliedSourcePlanDigest) {
      res.status(409).json({ error: 'goal_source_plan_changed', message: '原周计划已变化，请刷新后重试。' });
      return;
    }
    if (source.status === 'draft' && sourcePlan.status !== 'draft') {
      res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
      return;
    }
    let sourcePlanBody = jsonObject<Record<string, unknown>>(sourcePlan.plan, {});
    let fromFactsVersion = String(jsonObject<Record<string, unknown>>(sourcePlanBody.knowledgeBinding, {}).factsVersion || '').trim();
    if (!fromFactsVersion) {
      res.status(409).json({ error: 'enterprise_fact_snapshot_missing', message: '原周目标缺少可核验的企业事实版本，不能自动重建。' });
      return;
    }
    if (suppliedExpectedFactsVersion !== fromFactsVersion) {
      res.status(409).json({ error: 'goal_fact_binding_changed', message: '周目标引用的企业事实版本已变化，请刷新后重试。', factVersion: fromFactsVersion });
      return;
    }
    const sourceRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: source.id });
    if (sourceRun) {
      res.status(409).json({ error: 'package_locked', message: '周目标已经产生运行记录，不能自动重建。' });
      return;
    }
    if (source.status === 'cancelled') {
      const replacement = weeklyGoalFactRebuildReplacement(source.scope);
      if (!replacement
        || replacement.sourceGoalId !== source.id
        || replacement.sourceGoalVersion !== expectedGoalVersion
        || replacement.sourcePlanId !== sourcePlan.id
        || replacement.sourcePlanDigest !== suppliedSourcePlanDigest
        || replacement.fromFactsVersion !== fromFactsVersion) {
        res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
        return;
      }
      const target = await tenantRecord<GoalRecord>(COLLECTION.goals, replacement.targetGoalId, tenantId);
      const targetPlan = target
        ? await tenantRecord<PlanRecord>(COLLECTION.plans, replacement.targetPlanId, tenantId)
        : null;
      const targetPlanBody = jsonObject<Record<string, unknown>>(targetPlan?.plan, {});
      const targetFactsVersion = String(jsonObject<Record<string, unknown>>(targetPlanBody.knowledgeBinding, {}).factsVersion || '').trim();
      const targetLink = weeklyGoalFactRebuildLink(target?.scope);
      const targetPlanLink = weeklyGoalFactRebuildLink(targetPlanBody);
      if (!target
        || !targetPlan
        || targetPlan.goal_id !== target.id
        || !['draft', 'approved'].includes(targetPlan.status)
        || !sameCompletedWeeklyGoalFactRebuild(targetLink, replacement)
        || !sameCompletedWeeklyGoalFactRebuild(targetPlanLink, replacement)
        || targetFactsVersion !== replacement.toFactsVersion
        || Number(targetPlanBody.configVersion) !== replacement.configVersion
        || String(targetPlanBody.policyVersion || '') !== replacement.policyVersion) {
        res.status(409).json({ error: 'weekly_goal_fact_rebuild_recovery_conflict', message: '已重建周目标的恢复记录不完整，请人工检查。' });
        return;
      }
      try {
        await commitWeeklyGoalFactRebuildReplacement({
          dataStore: store,
          tenantId,
          sourceGoalId: source.id,
          sourceGoalVersion: expectedGoalVersion,
          sourceDescription: goalInput(source).scope,
          replacement,
        });
      } catch (error) {
        if (error instanceof WeeklyGoalFactRebuildCommitError) {
          res.status(409).json({ error: error.code, message: error.message });
          return;
        }
        throw error;
      }
      await ensureWeeklyGoalFactRebuildAudit({ tenantId, userId: replacement.rebuiltBy || userId, sourceGoalId: source.id, sourceGoalVersion: expectedGoalVersion, sourcePlanId: sourcePlan.id, sourcePlanDigest: replacement.sourcePlanDigest, targetGoalId: target.id, targetPlanId: targetPlan.id, fromFactsVersion, toFactsVersion: replacement.toFactsVersion, configVersion: replacement.configVersion, policyVersion: replacement.policyVersion, requestId: replacement.requestId });
      res.json(await buildOverview(tenantId, target.id));
      return;
    }
    if (source.status !== 'draft') {
      res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
      return;
    }
    let resolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
    if (!resolved) { res.status(409).json({ error: 'onboarding_required' }); return; }
    if (resolved.config.smartOperationsEnabled === false) {
      res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭，不能自动重建周目标。' });
      return;
    }
    let toFactsVersion = resolved.knowledgeBinding.factsVersion;
    const rebuildIdentity = {
      sourceGoalId: source.id,
      sourceGoalVersion: expectedGoalVersion,
      sourcePlanId: sourcePlan.id,
      sourcePlanDigest: suppliedSourcePlanDigest,
      fromFactsVersion,
      toFactsVersion,
      configVersion: resolved.configVersion,
      policyVersion: resolved.policyVersion,
    };
    const targetGoalId = weeklyGoalFactRebuildRecordId('goal', tenantId, source.id, expectedGoalVersion, toFactsVersion, resolved.configVersion, resolved.policyVersion, suppliedSourcePlanDigest);
    const targetPlanId = weeklyGoalFactRebuildRecordId('plan', tenantId, source.id, expectedGoalVersion, toFactsVersion, resolved.configVersion, resolved.policyVersion, suppliedSourcePlanDigest);
    const readTarget = async () => {
      const target = await tenantRecord<GoalRecord>(COLLECTION.goals, targetGoalId, tenantId);
      if (target && !sameWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(target.scope), rebuildIdentity)) {
        throw new WeeklyGoalFactRebuildCommitError('weekly_goal_fact_rebuild_target_conflict', '已存在的替代周目标与本次重建不一致。');
      }
      if (target && (target.status !== 'draft' || Number(target.version) !== 1
        || await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: target.id }))) {
        throw new WeeklyGoalFactRebuildCommitError('weekly_goal_fact_rebuild_target_not_pristine', '替代周目标已被修改或启动，不能替换原草稿。');
      }
      const targetPlan = target ? await tenantRecord<PlanRecord>(COLLECTION.plans, targetPlanId, tenantId) : null;
      if (targetPlan) {
        const targetBody = jsonObject<Record<string, unknown>>(targetPlan.plan, {});
        const targetFactsVersion = String(jsonObject<Record<string, unknown>>(targetBody.knowledgeBinding, {}).factsVersion || '').trim();
        const targetLink = weeklyGoalFactRebuildLink(target?.scope);
        const targetPlanLink = weeklyGoalFactRebuildLink(targetBody);
        if (targetPlan.id !== targetPlanId
          || targetPlan.status !== 'draft'
          || targetFactsVersion !== toFactsVersion
          || Number(targetBody.configVersion) !== rebuildIdentity.configVersion
          || String(targetBody.policyVersion || '') !== rebuildIdentity.policyVersion
          || !targetLink
          || !sameCompletedWeeklyGoalFactRebuild(targetPlanLink, targetLink)
          || !sameWeeklyGoalFactRebuild(targetPlanLink, rebuildIdentity)) {
          throw new WeeklyGoalFactRebuildCommitError('weekly_goal_fact_rebuild_plan_conflict', '已存在的替代周计划与本次重建不一致。');
        }
      }
      return { target, targetPlan };
    };
    let recovered: Awaited<ReturnType<typeof readTarget>>;
    try { recovered = await readTarget(); }
    catch (error) {
      if (error instanceof WeeklyGoalFactRebuildCommitError) {
        res.status(409).json({ error: error.code, message: error.message });
      } else {
        res.status(503).json({ error: 'goal_fact_rebuild_recovery_unavailable', message: '暂时无法核验周目标重建记录，请稍后重试。' });
      }
      return;
    }
    if (fromFactsVersion === toFactsVersion) {
      res.status(409).json({ error: 'goal_facts_current', message: '当前周目标已经引用最新企业事实，无需重建。', factVersion: toFactsVersion });
      return;
    }
    if (!store.compareAndSwap) {
      res.status(503).json({ error: 'goal_fact_rebuild_atomic_store_required', message: '当前存储不支持安全重建周目标。' });
      return;
    }
    const durableLeaseSupported = await store.supportsAtomicOperationLease?.() === true;
    const lease = durableLeaseSupported ? await acquireDurableOperationLease({
      dataStore: store,
      tenantId,
      scope: 'weekly_goal_fact_rebuild',
      subjectId: source.id,
      ownerId: `goal-facts-${randomUUID()}`,
      leaseDurationMs: 30 * 60_000,
    }) : null;
    if (durableLeaseSupported && !lease) {
      res.status(409).json({ error: 'goal_fact_rebuild_in_progress', message: '最新事实周目标正在重建，请稍后查询最新计划。', retryable: true });
      return;
    }
    let postFenceFactsVersion = '';
    try {
      source = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
      sourcePlan = source ? await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: source.id }) : null;
      if (!source
        || !sourcePlan
        || sourcePlan.id !== rebuildIdentity.sourcePlanId
        || weeklyGoalFactRebuildSourcePlanDigest(sourcePlan) !== rebuildIdentity.sourcePlanDigest
        || sourcePlan.status !== 'draft'
        || Number(source.version) !== expectedGoalVersion) {
        res.status(409).json({ error: 'goal_changed', message: '周目标版本已变化，请刷新后重试。' });
        return;
      }
      sourcePlanBody = jsonObject<Record<string, unknown>>(sourcePlan.plan, {});
      fromFactsVersion = String(jsonObject<Record<string, unknown>>(sourcePlanBody.knowledgeBinding, {}).factsVersion || '').trim();
      if (!fromFactsVersion || suppliedExpectedFactsVersion !== fromFactsVersion) {
        res.status(409).json({ error: 'goal_fact_binding_changed', message: '周目标引用的企业事实版本已变化，请刷新后重试。', factVersion: fromFactsVersion });
        return;
      }
      resolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
      if (!resolved) { res.status(409).json({ error: 'onboarding_required' }); return; }
      if (resolved.config.smartOperationsEnabled === false) {
        res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭，不能自动重建周目标。' });
        return;
      }
      toFactsVersion = resolved.knowledgeBinding.factsVersion;
      if (toFactsVersion !== rebuildIdentity.toFactsVersion) {
        res.status(409).json({ error: 'enterprise_facts_changed', message: '企业事实再次更新，正在等待基于最新版本重建。', ...weeklyGoalFactRebuildRecovery(source, sourcePlan, fromFactsVersion, toFactsVersion) });
        return;
      }
      if (source.status !== 'draft') {
        res.status(409).json({ error: 'draft_required', message: '只有尚未启动的过期周目标可以自动重建。' });
        return;
      }
      if (await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: source.id })) {
        res.status(409).json({ error: 'package_locked', message: '周目标已经产生运行记录，不能自动重建。' });
        return;
      }
      recovered = await readTarget();
      let target = recovered.target;
      let targetPlan = recovered.targetPlan;
      let rebuildLink = target ? weeklyGoalFactRebuildLink(target.scope)! : null;
      if (!targetPlan) {
        const enterpriseProfile = enterpriseProfileFromKnowledgeBinding(resolved.knowledgeBinding) as EnterpriseProfile | null;
        if (!enterpriseProfile) {
          res.status(409).json({ error: 'enterprise_fact_snapshot_missing', message: '最新企业事实快照不可用，不能自动重建周目标。' });
          return;
        }
        const { videoPlans: _staleVideoPlans, ...sourceIntent } = goalInput(source);
        const refreshedGoal = normalizeWeeklyGoal(sourceIntent, resolved.config);
        const planDraft = buildWeeklyPlan(refreshedGoal, resolved.config);
        const recommendedPackage = await recommendPackageWithTenantEvidence(tenantId, refreshedGoal, resolved.config, source.owner_id || userId, '', enterpriseProfile);
        const latestResolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
        if (!latestResolved
          || latestResolved.knowledgeBinding.factsVersion !== toFactsVersion
          || latestResolved.configVersion !== resolved.configVersion
          || latestResolved.policyVersion !== resolved.policyVersion) {
          res.status(409).json({ error: 'goal_rebuild_configuration_changed', message: '经营配置在重建期间发生变化，请按最新配置重试。', recoveryAction: 'rebuild_weekly_goal' });
          return;
        }
        if (lease) await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
        if (!target) {
          const rebuiltAt = new Date().toISOString();
          rebuildLink = { ...rebuildIdentity, requestId, rebuiltBy: userId, rebuiltAt };
          let createdTarget: GoalRecord | null = null;
          try {
            createdTarget = await store.create<GoalRecord>(COLLECTION.goals, {
              id: targetGoalId,
              tenant_id: tenantId,
              business_line: refreshedGoal.businessLine,
              content_platforms: refreshedGoal.contentPlatforms,
              title: refreshedGoal.title,
              objective: refreshedGoal.objective,
              metric: refreshedGoal.metric,
              baseline: refreshedGoal.baseline,
              target: refreshedGoal.target,
              unit: refreshedGoal.unit,
              starts_at: refreshedGoal.startsAt,
              ends_at: refreshedGoal.endsAt,
              scope: { description: refreshedGoal.scope, factRebuild: rebuildLink },
              constraints: refreshedGoal.constraints,
              owner_id: source.owner_id || userId,
              status: 'draft',
              version: 1,
              created_at: rebuiltAt,
              updated_at: rebuiltAt,
            });
          } catch { /* A deterministic-ID winner is recovered and validated below. */ }
          target = createdTarget || await tenantRecord<GoalRecord>(COLLECTION.goals, targetGoalId, tenantId);
          if (!target || !sameWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(target.scope), rebuildIdentity)) {
            res.status(503).json({ error: 'goal_fact_rebuild_target_unavailable' });
            return;
          }
          rebuildLink = weeklyGoalFactRebuildLink(target.scope)!;
        }
        if (lease) await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
        let createdPlan: PlanRecord | null = null;
        try {
          createdPlan = await store.create<PlanRecord>(COLLECTION.plans, {
            id: targetPlanId,
            tenant_id: tenantId,
            goal_id: target.id,
            status: 'draft',
            plan: { ...planDraft, ...configurationSnapshot(resolved), businessPackage: recommendedPackage, factRebuild: rebuildLink },
            created_at: rebuildLink!.rebuiltAt,
          });
        } catch { /* A deterministic-ID winner is recovered and validated below. */ }
        targetPlan = createdPlan || await tenantRecord<PlanRecord>(COLLECTION.plans, targetPlanId, tenantId);
        const rebuiltPlanBody = jsonObject<Record<string, unknown>>(targetPlan?.plan, {});
        if (!targetPlan
          || targetPlan.id !== targetPlanId
          || String(jsonObject<Record<string, unknown>>(rebuiltPlanBody.knowledgeBinding, {}).factsVersion || '') !== toFactsVersion
          || !sameWeeklyGoalFactRebuild(weeklyGoalFactRebuildLink(rebuiltPlanBody), rebuildIdentity)) {
          res.status(503).json({ error: 'goal_fact_rebuild_plan_unavailable' });
          return;
        }
      }
      const finalResolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
      if (finalResolved && finalResolved.knowledgeBinding.factsVersion !== rebuildIdentity.toFactsVersion) {
        res.status(409).json({
          error: 'enterprise_facts_changed',
          message: '企业事实在提交前再次更新，将按最新事实重新设定周目标。',
          ...weeklyGoalFactRebuildRecovery(source, sourcePlan, fromFactsVersion, finalResolved.knowledgeBinding.factsVersion),
        });
        return;
      }
      if (!finalResolved
        || finalResolved.config.smartOperationsEnabled === false
        || !weeklyGoalFactRebuildSnapshotMatches({
          factsVersion: finalResolved.knowledgeBinding.factsVersion,
          configVersion: finalResolved.configVersion,
          policyVersion: finalResolved.policyVersion,
        }, rebuildIdentity)) {
        res.status(409).json({ error: 'goal_rebuild_configuration_changed', message: '经营配置或策略在提交前发生变化，未取消原周目标。', recoveryAction: 'rebuild_weekly_goal' });
        return;
      }
      if (lease) await assertDurableOperationLease({ dataStore: store, lease, minimumRemainingMs: 1_000 });
      const link = weeklyGoalFactRebuildLink(target!.scope)!;
      await commitWeeklyGoalFactRebuildReplacement({
        dataStore: store,
        tenantId,
        sourceGoalId: source.id,
        sourceGoalVersion: expectedGoalVersion,
        sourceDescription: goalInput(source).scope,
        replacement: { ...link, targetGoalId, targetPlanId },
        validateAfterSourcePlanFence: async () => {
          const commitResolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
          if (!commitResolved) {
            throw new WeeklyGoalFactRebuildCommitError(
              'goal_rebuild_configuration_changed',
              '经营配置或策略在提交前不可用，未取消原周目标。',
            );
          }
          if (commitResolved.knowledgeBinding.factsVersion !== rebuildIdentity.toFactsVersion) {
            postFenceFactsVersion = commitResolved.knowledgeBinding.factsVersion;
            throw new WeeklyGoalFactRebuildCommitError(
              'enterprise_facts_changed',
              '企业事实在提交前再次更新，将按最新事实重新设定周目标。',
            );
          }
          if (commitResolved.config.smartOperationsEnabled === false
            || commitResolved.configVersion !== rebuildIdentity.configVersion
            || commitResolved.policyVersion !== rebuildIdentity.policyVersion) {
            throw new WeeklyGoalFactRebuildCommitError(
              'goal_rebuild_configuration_changed',
              '经营配置或策略在提交前发生变化，未取消原周目标。',
            );
          }
        },
      });
      await ensureWeeklyGoalFactRebuildAudit({ tenantId, userId: link.rebuiltBy || userId, sourceGoalId: source.id, sourceGoalVersion: expectedGoalVersion, sourcePlanId: sourcePlan.id, sourcePlanDigest: link.sourcePlanDigest, targetGoalId, targetPlanId, fromFactsVersion, toFactsVersion, configVersion: link.configVersion, policyVersion: link.policyVersion, requestId: link.requestId });
      res.json(await buildOverview(tenantId, targetGoalId));
    } catch (error) {
      if (error instanceof WeeklyGoalFactRebuildCommitError) {
        if (error.code === 'enterprise_facts_changed' && postFenceFactsVersion) {
          res.status(409).json({
            error: error.code,
            message: error.message,
            ...weeklyGoalFactRebuildRecovery(source!, sourcePlan!, fromFactsVersion, postFenceFactsVersion),
          });
          return;
        }
        res.status(409).json({ error: error.code, message: error.message });
        return;
      }
      if (!res.headersSent) res.status(503).json({ error: 'goal_fact_rebuild_failed', message: '周目标自动重建失败，请稍后重试。' });
    } finally {
      if (lease) await releaseDurableOperationLease({ dataStore: store, lease }).catch(() => undefined);
    }
  });
});
digitalEmployeesRouter.post('/goals', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const configRecord = await configForTenant(tenantId);
  const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
  const config = resolvedConfiguration?.config || null;
  if (!config || !resolvedConfiguration) { res.status(409).json({ error: 'onboarding_required' }); return; }
  const enterpriseProfile = enterpriseProfileFromKnowledgeBinding(resolvedConfiguration.knowledgeBinding) as EnterpriseProfile | null;
  if (!enterpriseProfile) { res.status(409).json({ error: 'enterprise_fact_snapshot_missing' }); return; }
  if (config.smartOperationsEnabled === false) {
    res.status(409).json({ error: 'smart_operations_disabled', message: '智能经营已关闭；历史任务仍可查看，开启后才能制定新的周目标。' });
    return;
  }
  const goal = normalizeWeeklyGoal(req.body || {}, config);
  const missing = validateWeeklyGoal(goal);
  if (missing.length) { res.status(400).json({ error: 'goal_invalid', missing }); return; }
  const now = new Date().toISOString();
  const created = await requiredCreate<GoalRecord>(COLLECTION.goals, {
    tenant_id: tenantId,
    business_line: goal.businessLine,
    content_platforms: goal.contentPlatforms,
    title: goal.title,
    objective: goal.objective,
    metric: goal.metric,
    baseline: goal.baseline,
    target: goal.target,
    unit: goal.unit,
    starts_at: goal.startsAt,
    ends_at: goal.endsAt,
    scope: goal.videoPlans ? { description: goal.scope, videoPlans: goal.videoPlans } : goal.scope,
    constraints: goal.constraints,
    owner_id: userId,
    status: 'draft',
    version: 1,
    created_at: now,
    updated_at: now,
  });
  const planDraft = buildWeeklyPlan(goal, config);
  const recommendedPackage = await recommendPackageWithTenantEvidence(tenantId, goal, config, userId, '', enterpriseProfile);
  const plan = await requiredCreate<PlanRecord>(COLLECTION.plans, {
    tenant_id: tenantId,
    goal_id: created.id,
    status: 'draft',
    plan: { ...planDraft, ...configurationSnapshot(resolvedConfiguration), businessPackage: recommendedPackage },
    created_at: now,
  });
  await appendAudit({ tenantId, userId, action: 'weekly_goal.created', targetType: 'weekly_goal', targetId: created.id, metadata: { metric: goal.metric, target: goal.target, draftPlanId: plan.id } });
  res.status(201).json(await buildOverview(tenantId, created.id));
});
async function ensureReviewRunTasks(tenantId: string, goal: GoalRecord, plan: PlanRecord, run: RunRecord, tasks: ReturnType<typeof buildWeeklyPlan>['tasks'], pack: WeeklyPackage | undefined) {
  const now = new Date().toISOString();
  const stored = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
  for (const task of tasks) {
    if (stored.items.some(t => t.task_key === task.key)) continue;
    await requiredCreate<TaskRecord>(COLLECTION.tasks, {
      tenant_id: tenantId,
      goal_id: goal.id,
      plan_id: plan.id,
      run_id: run.id,
      task_key: task.key,
      title: task.title,
      description: task.description,
      agent_role: task.agentRole,
      kind: task.kind,
      status: 'pending',
      sequence: task.sequence,
      priority: task.priority,
      requires_approval: task.requiresApproval,
      depends_on: task.dependsOn,
      output: {},
      blocked_reason: '',
      owner_id: packageTaskForKey(pack, task.key)?.ownerId || '',
      business_domain: task.businessDomain,
      capability_key: task.capabilityKey,
      destination: task.destination,
      destination_view: task.destinationView || '',
      status_source: task.statusSource,
      execution_mode: task.executionMode,
      external_effect: task.externalEffect,
      automatic_execution_allowed: task.automaticExecutionAllowed,
      policy_source: task.policySource,
      business_refs: (packageTaskForKey(pack, task.key)?.sourceProjectIds || []).map(id => ({ type: 'studio_project', id })),
      task_version: 1,
      correction_version: 0,
      created_at: now,
      updated_at: now,
    });
  }
}
export async function approveGoalForReview(tenantId: string, userId: string, goalId: string, packageRevision: number | undefined, members: Array<{id: string}>) {
  return withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
  if (!store.compareAndSwap) return { status: 503, body: { error: 'goal_atomic_store_required', message: '当前存储不支持安全启动周目标。' } };
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
  if (!goal) { return { status: 404, body: { error: 'goal_not_found' } }; }
  if (!isDigitalEmployeeOperatingGoal(goal)) {
    return { status: 409, body: { error: 'operating_goal_required', message: '该任务属于独立视频制作，请在对应内容任务中继续操作。' } };
  }
  if (!await weeklyGoalFactRebuildTargetCommitted(tenantId, goal)) {
    return { status: 409, body: { error: 'goal_fact_rebuild_not_committed', message: '最新事实周目标尚未完成安全替换，暂不能启动。' } };
  }
  const existingRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at');
  if (existingRun) {
    if (existingRun.status === 'initializing') {
      const savedPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, existingRun.plan_id, tenantId);
      if (!savedPlan) throw Error('初始化计划不可用');
      const saved = jsonObject<ReturnType<typeof compilePackage>>(savedPlan.plan, {} as ReturnType<typeof compilePackage>);
      if (!saved.tasks?.length) throw Error('初始化任务清单不可用');
      await ensureReviewRunTasks(tenantId, goal, savedPlan, existingRun, saved.tasks, saved.businessPackage);
      if (!await store.update(COLLECTION.runs, existingRun.id, { status: 'planning' })) throw Error('任务初始化状态保存失败');
      await advanceRun(tenantId, existingRun.id);
    }
    return { status: 200, body: await buildOverview(tenantId, goal.id) };
  }
  // Conflict checks must see every tenant record, including old operating runs
  // pushed beyond the first page by independent social-content bridge records.
  async function conflictRecords<T extends { id: string; tenant_id: string }>(collection: string): Promise<T[]> {
    const records: T[] = [];
    const seen = new Set<string>();
    let totalItems: number | undefined;
    for (let page = 1; ; page++) {
      const batch = await store.list<T>(collection, { where: { tenant_id: tenantId }, sort: 'id', page, perPage: 500 });
      if (!Number.isSafeInteger(batch.totalPages) || batch.totalPages < 0
        || !Number.isSafeInteger(batch.totalItems) || batch.totalItems < 0
        || batch.page !== page || (totalItems !== undefined && totalItems !== batch.totalItems)) {
        throw Error('周目标互斥检查分页发生变化，请刷新后重试。');
      }
      totalItems = batch.totalItems;
      for (const record of batch.items) {
        if (record.tenant_id !== tenantId || seen.has(record.id)) throw Error('周目标互斥检查记录不完整，请刷新后重试。');
        seen.add(record.id);
        records.push(record);
      }
      if (page >= batch.totalPages) {
        if (records.length !== totalItems) throw Error('周目标互斥检查记录不完整，请刷新后重试。');
        return records;
      }
      if (!batch.items.length) throw Error('周目标互斥检查记录不完整，请刷新后重试。');
    }
  }
  const [configRecord, tenantGoals, tenantRuns, existingPlan] = await Promise.all([
    configForTenant(tenantId),
    conflictRecords<GoalRecord>(COLLECTION.goals),
    conflictRecords<RunRecord>(COLLECTION.runs),
    first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
  ]);
  const allowDisjoint = normalizeContinuationPolicy(publicConfig(configRecord)?.continuationPolicy).overlappingCycles === 'allow_disjoint';
  const conflict = await findOperatingGoalConflict({
    goal, goals: tenantGoals, runs: tenantRuns, allowDisjoint,
    loadGoal: id => tenantRecord<GoalRecord>(COLLECTION.goals, id, tenantId),
  });
  if (conflict) {
    return { status: 409, body: {
      error: 'active_goal_exists',
      message: '当前租户已有活跃周目标，请先完成、暂停后取消，或明确结束现有运行。',
      activeGoalId: conflict.goal?.id || conflict.run?.goal_id || '',
      activeRunId: conflict.run?.id || '',
      activeGoalTitle: conflict.goal?.title || '',
      activeGoalStatus: conflict.goal?.status || '',
      activeRunStatus: conflict.run?.status || '',
      activeStartsAt: conflict.goal?.starts_at || '',
      activeEndsAt: conflict.goal?.ends_at || '',
    } };
  }
  const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
  const currentConfig = resolvedConfiguration?.config || null;
  if (!currentConfig || !resolvedConfiguration) { return { status: 409, body: { error: 'onboarding_required' } }; }
  const productionDefaultsRecord = (await store.list<{ id: string; tenant_id: string; payload?: ProductionDefaults }>('studio_production_defaults', {
    where: { tenant_id: tenantId }, perPage: 1,
  })).items[0];
  const presenterGate = presenterProductionGate(productionDefaultsRecord?.payload);
  if (!presenterGate.ready) {
    return { status: 409, body: {
      error: 'presenter_required',
      reason: presenterGate.reason,
      message: presenterGate.message,
    } };
  }
  const savedBody = existingPlan ? jsonObject<Record<string, unknown>>(existingPlan.plan, {}) : {};
  if (existingPlan && (existingPlan.status !== 'draft' || hasWeeklyGoalFactRebuildPlanFence(savedBody))) {
    return { status: 409, body: { error: 'package_locked', message: '计划已启动或正在重建，请刷新后重试。' } };
  }
  const savedFactsVersion = String(jsonObject<Record<string, unknown>>(savedBody.knowledgeBinding, {}).factsVersion || '').trim();
  const canonicalFactsVersion = resolvedConfiguration.knowledgeBinding.factsVersion;
  if (savedFactsVersion && savedFactsVersion !== canonicalFactsVersion) {
    return { status: 409, body: {
      error: 'enterprise_facts_changed',
      message: '企业事实已更新；当前草稿仍引用旧事实，请基于最新事实新建周目标后再启动。',
      ...weeklyGoalFactRebuildRecovery(goal, existingPlan!, savedFactsVersion, canonicalFactsVersion),
    } };
  }
  const needsFrozenFactSnapshot = !existingPlan || !frozenEnterpriseProfileForPlan(existingPlan, false);
  // A draft goal owns the configuration snapshot captured when it was created.
  // Later Agent-setting edits apply only to a newly created goal.
  const config = executionConfigForPlan(existingPlan, currentConfig);
  // Account and delivery readiness are checked by the affected task at runtime.
  // Do not clear the content production platforms when no publishing account exists.
  let pack = savedBody.businessPackage ? repairCollapsedWeeklyVideoProduction(savedBody.businessPackage as WeeklyPackage) : undefined;
  let managedPublishingGrantId = String(savedBody.managedPublishingGrantId || '');
  if (pack && !managedPublishingGrantId) {
    const authorized = applyManagedPublishingGrant(pack, currentConfig, goal.ends_at);
    if (authorized.grantId) { pack = authorized.pack; managedPublishingGrantId = authorized.grantId; }
  }
  if (pack) {
    if (packageRevision !== pack.revision) { return { status: 409, body: { error: 'package_changed', message: '请查看并确认最新版本的经营包。' } }; }
    if (pack.tasks.some(t => t.ownerId && !members.some(m => m.id === t.ownerId))) { return { status: 409, body: { error: 'owner_unavailable', message: '计划中的负责人已不可用，请重新分配任务。' } }; }
    const masterPlans = pack.tasks.find(task => task.templateId === 'production')?.videoPlans?.filter(item => item.productionRole !== 'platform_adaptation') || [];
    if (masterPlans.length && (pack.detailGeneration?.status !== 'ready'
      || masterPlans.some(item => !item.preproduction?.readiness.canStart))) {
      const blockers = [...new Set([
        ...(pack.detailGeneration?.blockers || []),
        ...masterPlans.flatMap(item => item.preproduction?.readiness.blockers || ['制作详情尚未生成']),
      ].filter(Boolean))];
      return { status: 409, body: {
        error: 'package_details_blocked',
        message: `制作条件尚未全部满足：${blockers.join('；') || '请先生成并确认每条内容的制作详情'}`,
        blockers,
      } };
    }
    const cloneWithoutVerifiedBudget = masterPlans.find(item => item.route === 'clone'
      && item.estimatedCostRange?.basis !== 'verified_storyboard_provider_envelope');
    if (cloneWithoutVerifiedBudget) {
      return { status: 409, body: { error: 'production_budget_forecast_required', message: '本周逐镜制作尚未完成可靠预算预计，请先生成并核对周计划详情，未启动生产。' } };
    }
    const protectedBudget = pack.directorPlan?.productionBudgetMode !== 'economy';
    const selectedCaps = masterPlans.map(item => Number(protectedBudget
      ? item.estimatedCostRange?.maxCny || item.estimatedCost
      : item.estimatedCostRange?.minCny || item.estimatedCost));
    const approvedTotal = Math.round(selectedCaps.reduce((sum, value) => sum + value, 0) * 100) / 100;
    if (pack.directorPlan && (approvedTotal <= 0 || Math.abs(pack.directorPlan.productionBudget - approvedTotal) > 0.009)) {
      return { status: 409, body: { error: 'production_budget_approval_stale', message: '开工预算与当前分镜预计不一致，请重新核对并选择预算方案，未启动生产。' } };
    }
    const installationCeiling = process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY === undefined
      ? null : Number(process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY);
    if (!isInternalBudgetExemptTenant(tenantId) && installationCeiling !== null && (!Number.isFinite(installationCeiling) || installationCeiling <= 0
      || selectedCaps.some(value => value > installationCeiling + 0.000001))) {
      return { status: 409, body: { error: 'production_budget_installation_ceiling', message: `系统单条制作上限不足以执行已选方案（当前上限 ¥${Number.isFinite(installationCeiling) ? installationCeiling.toFixed(2) : '0.00'}），请在开工前调整系统额度或选择精简预算。` } };
    }
    if (masterPlans.length) {
      const productionProfile = frozenEnterpriseProfileForPlan(existingPlan, false)
        || enterpriseProfileFromKnowledgeBinding(resolvedConfiguration.knowledgeBinding) as EnterpriseProfile | null;
      if (!productionProfile) {
        return { status: 409, body: { error: 'enterprise_fact_snapshot_missing', message: '企业事实快照缺失，请重新确认企业与产品资料后再开工。' } };
      }
      try {
        const readiness = await readServerProductionOnboardingReadiness({
          store,
          tenantId,
          profile: productionProfile,
          preferences: config.productionOnboarding,
          plans: masterPlans,
          budgetConfirmed: Boolean(pack.directorPlan && approvedTotal > 0),
        });
        if (!readiness.ready) return { status: 409, body: {
          error: 'production_onboarding_preflight_blocked',
          message: `周任务未启动：${readiness.blockers.map(item => item.message).join('；')}`,
          blockers: readiness.blockers,
          requiredArchetypes: readiness.requiredArchetypes,
        } };
      } catch (error) {
        return { status: 503, body: {
          error: 'production_onboarding_preflight_unavailable',
          message: `${error instanceof Error ? error.message : '生产资料预检暂时不可用'}；本次未创建运行，请稍后重试。`,
        } };
      }
    }
    const issues = validatePackageForStart(pack, goalInput(goal), configSnapshotForPlan(existingPlan, currentConfig));
    if (issues.length) { return { status: 400, body: { error: 'package_invalid', message: issues.join('；') } }; }
  }
  const planDraft = pack ? compilePackage(pack, goalInput(goal), config) : buildWeeklyPlan(goalInput(goal), config);
  const now = new Date().toISOString();
  const productionTask = pack?.tasks.find(t => t.templateId === 'production');
  if (productionTask?.videoPlans) goal.scope = { ...jsonObject<Record<string, unknown>>(goal.scope, {}), description: goalInput(goal).scope, videoPlans: productionTask.videoPlans };
  const frozenPlanMetadata = existingPlan
    ? { ...savedBody, ...(needsFrozenFactSnapshot ? { knowledgeBinding: resolvedConfiguration.knowledgeBinding } : {}) }
    : configurationSnapshot(resolvedConfiguration);
  const approvedPlanBody = { ...frozenPlanMetadata, ...planDraft, ...(managedPublishingGrantId ? { managedPublishingGrantId } : {}), ...(pack ? { packageApprovedBy: userId, packageApprovedAt: now } : {}) };
  let plan: PlanRecord;
  if (existingPlan) {
    const updated = await store.compareAndSwap?.(COLLECTION.plans, existingPlan.id, {
      tenant_id: tenantId, goal_id: goal.id, status: 'draft', plan: existingPlan.plan,
    }, { status: 'approved', plan: approvedPlanBody });
    if (!updated) { return { status: 409, body: { error: 'package_changed', message: '计划已更新或正在重建，请刷新后重试。' } }; }
    plan = { ...existingPlan, status: 'approved', plan: approvedPlanBody };
  } else {
    plan = await requiredCreate<PlanRecord>(COLLECTION.plans, {
      tenant_id: tenantId, goal_id: goal.id, status: 'approved', plan: approvedPlanBody, created_at: now,
    });
  }
  const activated = await store.compareAndSwap?.(COLLECTION.goals, goal.id, {
    tenant_id: tenantId, status: 'draft', version: Number(goal.version || 1),
  }, { status: 'active', updated_at: now, ...(pack ? { scope: goal.scope, content_platforms: goal.content_platforms } : {}) });
  if (!activated) {
    if (existingPlan) await store.compareAndSwap?.(COLLECTION.plans, existingPlan.id, {
      tenant_id: tenantId, goal_id: goal.id, status: 'approved', plan: approvedPlanBody,
    }, { status: 'draft', plan: existingPlan.plan });
    return { status: 409, body: { error: 'goal_changed', message: '周目标状态已变化，未启动新运行。' } };
  }
  const run = await requiredCreate<RunRecord>(COLLECTION.runs, {
    tenant_id: tenantId,
    goal_id: goal.id,
    plan_id: plan.id,
    status: 'initializing',
    current_controller: 'business',
    pause_reason: '',
    started_at: now,
    completed_at: '',
  });
  await ensureReviewRunTasks(tenantId, goal, plan, run, planDraft.tasks, pack);
  if (!await store.update(COLLECTION.runs, run.id, { status: 'planning' })) throw Error('任务初始化状态保存失败');
  await appendEvent({ tenantId, runId: run.id, type: 'plan.generated', level: 'success', summary: `计划 Agent 已生成 ${planDraft.tasks.length} 个任务`, payload: { strategy: planDraft.strategy } });
  const contentCount = pack?.tasks.find(task => task.templateId === 'production')?.videoPlans?.length || 0;
  await appendEvent({
    tenantId,
    runId: run.id,
    type: 'business.orchestration.started',
    level: 'success',
    summary: `经营 Agent 已接管本周执行，并向编导、内容与客服 Agent 下发任务${contentCount ? `；内容队列共 ${contentCount} 条` : ''}`,
    payload: { controller: 'business', delegatedRoles: ['director', 'content', 'customer'], contentCount, packageRevision: pack?.revision || 0 },
  });
  await appendEvent({ tenantId, runId: run.id, type: 'workflow.started', summary: '数字员工已开始执行本周计划' });
  await appendAudit({ tenantId, userId, action: 'weekly_goal.approved', targetType: 'weekly_goal', targetId: goal.id, metadata: { planId: plan.id, runId: run.id } });
  await advanceRun(tenantId, run.id);
  return { status: 200, body: await buildOverview(tenantId, goal.id) };
  });
}
digitalEmployeesRouter.post('/goals/:goalId/approve', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const members = await listTenantEmployees(res.locals as AuthLocals, req.headers.authorization);
  const result = await approveGoalForReview(tenantId, userId, req.params.goalId, req.body?.packageRevision, members);
  res.status(result.status).json(result.body);
});
digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/link-project', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', String(req.body?.projectId || ''), tenantId);
  if (!run || !task || task.run_id !== run.id || !project) { res.status(404).json({ error: 'resource_not_found' }); return; }
  await withDigitalEmployeeRunLock(tenantId, run.id, async () => {
    const current = await tenantRecord<TaskRecord>(COLLECTION.tasks, task.id, tenantId);
    if (!current || !['content_production', 'content_quality_gate', 'content_release_approval'].includes(current.task_key) || ['succeeded', 'cancelled', 'failed'].includes(run.status) || current.status === 'succeeded') { res.status(409).json({ error: 'task_locked' }); return; }
    if (!studioProjectRendered(project)) { res.status(400).json({ error: 'project_not_ready', message: '请先完成作品制作。' }); return; }
    const refs = jsonObject<Array<Record<string, unknown>>>(current.business_refs, []);
    if (!refs.some(r => r.type === 'studio_project' && r.id === project.id)) refs.push({ type: 'studio_project', id: project.id });
    await store.update(COLLECTION.tasks, current.id, { business_refs: refs, updated_at: new Date().toISOString() });
    const linkedPlan = await tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId);
    if (linkedPlan) {
      await store.update(COLLECTION.plans, linkedPlan.id, { plan: { ...jsonObject<Record<string, unknown>>(linkedPlan.plan, {}), packageApprovedBy: '', packageGrantInvalidatedAt: new Date().toISOString() } });
      await invalidatePublishingAuthorizationForRun(tenantId, run.id);
      await appendAuthorizationRequiredEvent({ tenantId, runId: run.id, taskId: current.id, reason: 'content_changed', changedFields: ['sourceProjectIds'] });
    }
    await appendAudit({ tenantId, userId, action: 'weekly_task.project_linked', targetType: 'workflow_task', targetId: current.id, metadata: { projectId: project.id } });
  });
  if (res.headersSent) return;
  await advanceRun(tenantId, run.id);
  res.json(await buildOverview(tenantId, run.goal_id));
});
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
async function generateRunReview(tenantId: string, userId: string, runId: string): Promise<{ run: RunRecord; goal: GoalRecord }> {
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, runId, tenantId);
  if (!run) throw new Error('run_not_found');
  const [goal, tasks] = await Promise.all([
    tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId),
    store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
  ]);
  if (!goal) throw new Error('run_context_missing');
  await completeReview(tenantId, goal, run, tasks.items);
  await appendEvent({ tenantId, runId: run.id, type: 'review.generated', level: 'success', summary: '本周复盘已按真实业务数据刷新', payload: { completedTasks: tasks.items.filter(task => task.status === 'succeeded').length, totalTasks: tasks.items.length } });
  await appendAudit({ tenantId, userId, action: 'weekly_review.generated', targetType: 'workflow_run', targetId: run.id, metadata: { goalId: goal.id } });
  return { run, goal };
}
/** Idempotent scheduled review entry point used by the background orchestrator. */
export async function generateScheduledRunReview(input: {
  tenantId: string;
  runId: string;
  scheduleSlot: string;
}): Promise<boolean> {
  return withLocalQueue(scheduledReviewQueues, `${input.tenantId}:${input.runId}`, async () => {
    const existingMarker = await store.list<EventRecord>(COLLECTION.events, {
      where: { tenant_id: input.tenantId, run_id: input.runId, type: 'review.scheduled' }, sort: '-sequence', page: 1, perPage: 100,
    });
    const alreadyGenerated = existingMarker.items.some(event => {
      if (event.type !== 'review.scheduled') return false;
      return String(jsonObject<Record<string, unknown>>(event.payload, {}).scheduleSlot || '') === input.scheduleSlot;
    });
    if (alreadyGenerated) return false;
    const { goal } = await generateRunReview(input.tenantId, 'digital_employee_runtime', input.runId);
    await appendEvent({
      tenantId: input.tenantId,
      runId: input.runId,
      type: 'review.scheduled',
      level: 'success',
      summary: '已按经营配置自动生成阶段复盘',
      payload: { scheduleSlot: input.scheduleSlot },
    });
    await appendAudit({
      tenantId: input.tenantId,
      userId: 'digital_employee_runtime',
      action: 'weekly_review.scheduled',
      targetType: 'workflow_run',
      targetId: input.runId,
      metadata: { goalId: goal.id, scheduleSlot: input.scheduleSlot },
    });
    return true;
  });
}
digitalEmployeesRouter.post('/runs/:runId/reviews/generate', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try {
    const { goal } = await generateRunReview(tenantId, userId, req.params.runId);
    res.json(await buildOverview(tenantId, goal.id));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'review_generation_failed';
    res.status(code === 'run_not_found' ? 404 : 409).json({ error: code });
  }
});
digitalEmployeesRouter.post('/reviews/generate', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const runId = String(req.body?.runId || '').trim();
  if (!runId) { res.status(400).json({ error: 'run_id_required' }); return; }
  try {
    const { goal } = await generateRunReview(tenantId, userId, runId);
    res.json(await buildOverview(tenantId, goal.id));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'review_generation_failed';
    res.status(code === 'run_not_found' ? 404 : 409).json({ error: code });
  }
});
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
digitalEmployeesRouter.get('/customer-segments/:segmentId', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const segment = await getCustomerSegment(tenantId, req.params.segmentId);
  if (!segment) { res.status(404).json({ error: 'customer_segment_not_found' }); return; }
  const members = await getCustomerSegmentMembers(tenantId, segment.id);
  res.json({ segment: { ...segment, criteria: jsonObject(segment.criteria, {}), exclusion_summary: jsonObject(segment.exclusion_summary, {}) }, members: members.map(member => ({ ...member, inclusion_reasons: jsonObject(member.inclusion_reasons, []), exclusion_reasons: jsonObject(member.exclusion_reasons, []), customer_snapshot: jsonObject(member.customer_snapshot, {}) })) });
});
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
digitalEmployeesRouter.use('/runs/:runId/customer-task-navigation',createCustomerTaskNavigationRouter(store));
digitalEmployeesRouter.get('/runs/:runId/customer-workspace', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const segment = await first<StoredRecord & { tenant_id: string }>('customer_segments', { tenant_id: tenantId, run_id: run.id }, '-version');
  const batch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
  const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 });
  res.json({ scope: {tenantId,runId:run.id}, tasks: tasks.items.map(task => ({ id: task.id, run_id: run.id, title: task.title, task_key: task.task_key, status: task.status, blocker_reason: task.blocker_reason })), readOnly: ['succeeded', 'cancelled'].includes(run.status), segment, members: segment ? await getCustomerSegmentMembers(tenantId, segment.id) : [], batch, items: batch ? await getFollowupBatchItems(tenantId, batch.id) : [] });
});
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
export async function configureWorkflowFollowupTemplate(
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
digitalEmployeesRouter.use(createDigitalEmployeeFollowupReadRouter());
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
digitalEmployeesRouter.get('/runs/:runId/events', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const after = Math.max(0, Number(req.query.after || 0));
  res.json({ events: await listRunEventsAfter<EventRecord>(tenantId, run.id, after) });
});
digitalEmployeesRouter.get('/runs/:runId/tasks/:taskId/workspace', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const target = await browserTaskWorkspace({
      tenantId,
      runId: req.params.runId,
      taskId: req.params.taskId,
      dataAuthority: currentDataAuthority() ?? 'pocketbase',
    });
    const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
    const events = await listRunEventsAfter<EventRecord>(tenantId, req.params.runId, 0);
    const output = jsonObject<Record<string, any>>(task?.output, {});
    if (task?.task_key === 'content_mode_routing' && Array.isArray(output.orders)) {
      const [goal, configRecord] = await Promise.all([tenantRecord<GoalRecord>(COLLECTION.goals, task.goal_id, tenantId), configForTenant(tenantId)]);
      if (goal && configRecord) output.coverage = contentPlanCoverage(normalizeDigitalEmployeeConfig(jsonObject(configRecord.config, {})), goalInput(goal), output.orders.length);
    }
    if (target.projectId && task && ['content_production', 'content_quality_gate'].includes(task.task_key)) {
      const project = await tenantRecord<StoredRecord & { tenant_id: string }>('studio_projects', target.projectId, tenantId);
      if (project) output.production = productionQualitySummary(jsonObject<Record<string, any>>(project.spec, {}));
    }
    res.json({ link: target.link, stage: target.stage, task: task ? { id: task.id, task_key: task.task_key, title: task.title, status: task.status, blocker_reason: task.blocked_reason || task.blocker_reason, output } : null, events: events.filter(event => event.task_id === req.params.taskId).slice(-80) });
  } catch (error) {
    res.status(error instanceof Error && error.message === 'task_run_not_found' ? 404 : 500).json({ error: '无法加载任务工作页面' });
  }
});
digitalEmployeesRouter.get('/runs/:runId/tasks/:taskId/browser-stream', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scope = { tenantId, runId: req.params.runId, taskId: req.params.taskId, dataAuthority: currentDataAuthority() ?? 'pocketbase' as const };
  const [run, task] = await Promise.all([
    tenantRecord<RunRecord>(COLLECTION.runs, scope.runId, tenantId),
    tenantRecord<TaskRecord>(COLLECTION.tasks, scope.taskId, tenantId),
  ]);
  if (!run || !task || task.run_id !== run.id) { res.status(404).json({ error: 'task_run_not_found' }); return; }
  if (!browserExecutionEnabled()) { res.status(503).json({ error: '此环境尚未启用浏览器执行与直播' }); return; }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  let closed = false;
  let unwatch: (() => void) | undefined;
  const heartbeat = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 10_000);
  res.on('close', () => { closed = true; clearInterval(heartbeat); unwatch?.(); });
  try {
    unwatch = await agentBrowserSessions.watch(scope, () => browserTaskWorkspace(scope), packet => {
      // Slow viewers skip intermediate frames instead of accumulating video in RAM.
      if (!closed && (packet.type !== 'frame' || res.writableLength < 512_000)) res.write(`data: ${JSON.stringify(packet)}\n\n`);
    });
    if (closed) unwatch();
  } catch (error) {
    if (!closed) { res.write(`data: ${JSON.stringify({ type: 'status', state: 'error', message: error instanceof Error ? error.message : '浏览器直播启动失败' })}\n\n`); res.end(); }
  }
});
digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/browser-refresh', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scope = { tenantId, runId: req.params.runId, taskId: req.params.taskId, dataAuthority: currentDataAuthority() ?? 'pocketbase' as const };
  const [run, task] = await Promise.all([
    tenantRecord<RunRecord>(COLLECTION.runs, scope.runId, tenantId),
    tenantRecord<TaskRecord>(COLLECTION.tasks, scope.taskId, tenantId),
  ]);
  if (!run || !task || task.run_id !== run.id) { res.status(404).json({ error: 'task_run_not_found' }); return; }
  if (!browserExecutionEnabled()) { res.status(503).json({ error: '此环境尚未启用浏览器执行与直播' }); return; }
  try {
    const frame = await agentBrowserSessions.forceRefresh(scope, () => browserTaskWorkspace(scope));
    res.json({ refreshedAt: frame.capturedAt, sequence: frame.sequence });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : '任务工作页面刷新失败' });
  }
});
digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/ui-events', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const expectedWorkerToken = process.env.AGENT_WORKER_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'lingshu-local-agent-worker-token');
  const suppliedWorkerToken = String(req.headers['x-agent-worker-token'] || '');
  if (!expectedWorkerToken) {
    res.status(503).json({ error: 'agent_worker_token_not_configured' });
    return;
  }
  if (suppliedWorkerToken !== expectedWorkerToken) {
    res.status(403).json({ error: 'agent_worker_auth_failed' });
    return;
  }
  const [run, task] = await Promise.all([
    tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId),
    tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId),
  ]);
  if (!run || !task || task.run_id !== run.id) {
    res.status(404).json({ error: 'task_run_not_found' });
    return;
  }
  const kind = String(req.body?.kind || '');
  const allowedKinds = new Set(['action_started', 'navigation', 'click', 'input', 'screenshot']);
  if (!allowedKinds.has(kind)) {
    res.status(400).json({ error: 'invalid_ui_event_kind', allowed: [...allowedKinds] });
    return;
  }
  const label = String(req.body?.label || '').trim().slice(0, 300);
  if (!label) {
    res.status(400).json({ error: 'ui_event_label_required' });
    return;
  }
  const page = String(req.body?.page || task.destination || '').trim().slice(0, 100);
  const rawScreenshotUrl = String(req.body?.screenshotUrl || '').trim().slice(0, 2000);
  const screenshotUrl = /^(https?:\/\/|\/api\/)/.test(rawScreenshotUrl) ? rawScreenshotUrl : '';
  if (kind === 'screenshot' && !screenshotUrl) {
    res.status(400).json({ error: 'trusted_screenshot_url_required' });
    return;
  }
  const finiteCoordinate = (value: unknown, maximum: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(maximum, number)) : undefined;
  };
  const viewportWidth = finiteCoordinate(req.body?.viewportWidth, 100_000);
  const viewportHeight = finiteCoordinate(req.body?.viewportHeight, 100_000);
  const x = finiteCoordinate(req.body?.x, viewportWidth || 100);
  const y = finiteCoordinate(req.body?.y, viewportHeight || 100);
  if (kind === 'click' && (x === undefined || y === undefined || !viewportWidth || !viewportHeight)) {
    res.status(400).json({ error: 'ui_click_coordinates_required' });
    return;
  }
  const event = await appendEvent({
    tenantId,
    runId: run.id,
    taskId: task.id,
    type: `agent.ui.${kind}`,
    summary: label,
    payload: { uiAction: { kind, label, page, screenshotUrl, x, y, viewportWidth, viewportHeight } },
  });
  res.status(201).json(event);
});
digitalEmployeesRouter.get('/runs/:runId/stream', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const after = Math.max(0, Number(req.query.after || 0));
  const clients = streamClients.get(run.id) || new Set<Response>();
  clients.add(res);
  streamClients.set(run.id, clients);
  // Subscribe before reading persisted events; overlap is deduplicated by id
  // in the client, while events arriving during the read cannot fall in a gap.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) streamClients.delete(run.id);
  });
  try {
    const persisted = await listRunEventsAfter<EventRecord>(tenantId, run.id, after);
    for (const event of persisted.filter(item => Number(item.sequence) > after)) if (!res.destroyed) sendEvent(res, event);
  } catch { res.end(); }
});
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
/** Thin HTTP adapter over the shared approval application service. */
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
digitalEmployeesRouter.post('/approvals/:approvalId/decide', decideDigitalEmployeeApproval);
type TaskControlAction = 'retry' | 'skip' | 'manual_complete' | 'replan';
class TaskControlError extends Error {
  constructor(public status: number, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
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
async function handleTaskControl(req: Request, res: Response, forcedAction?: TaskControlAction): Promise<void> {
  const { tenantId, userId } = res.locals as AuthLocals;
  const action = forcedAction || String(req.body?.action || 'retry') as TaskControlAction;
  if (!['retry', 'skip', 'manual_complete', 'replan'].includes(action)) {
    res.status(400).json({ error: 'invalid_correction_action', allowed: ['retry', 'skip', 'manual_complete', 'replan'] });
    return;
  }
  const scope = forcedAction ? 'one_off' : String(req.body?.scope || '') as 'one_off' | 'rule_candidate';
  if (!['one_off', 'rule_candidate'].includes(scope)) {
    res.status(400).json({ error: 'invalid_correction_scope', allowed: ['one_off', 'rule_candidate'] });
    return;
  }
  const providedNote = String(req.body?.instruction || req.body?.note || '').trim().slice(0, 5000);
  if (!providedNote && (!forcedAction || ['skip', 'manual_complete'].includes(forcedAction))) {
    res.status(400).json({ error: forcedAction ? 'task_control_note_required' : 'correction_instruction_required' });
    return;
  }
  const allowedWorkflows = new Set<DigitalEmployeeConfig['enabledWorkflows'][number]>(['scheduled_social', 'viral_clone', 'product_content', 'material_content', 'content_publish', 'customer_segmentation', 'batch_followup']);
  const rawWorkflows = req.body?.enabledWorkflows;
  if (rawWorkflows !== undefined && (!Array.isArray(rawWorkflows) || rawWorkflows.some(item => !allowedWorkflows.has(String(item) as DigitalEmployeeConfig['enabledWorkflows'][number])))) {
    res.status(400).json({ error: 'invalid_enabled_workflows' });
    return;
  }
  const instruction = providedNote || (action === 'retry' ? '重试当前任务并重置下游' : '根据当前配置重新规划');
  try {
    const result = await applyTaskControl({
      tenantId, userId, taskId: req.params.taskId, action, scope, instruction,
      rerunDownstream: req.body?.rerunDownstream !== false,
      output: jsonObject<Record<string, unknown>>(req.body?.output, {}),
      businessRefs: Array.isArray(req.body?.businessRefs) ? req.body.businessRefs : undefined,
      enabledWorkflows: Array.isArray(rawWorkflows) ? rawWorkflows as DigitalEmployeeConfig['enabledWorkflows'] : undefined,
    });
    queueDigitalEmployeeRunAdvance(tenantId, result.runId);
    res.json(await buildOverview(tenantId, result.goalId));
  } catch (error) {
    if (error instanceof TaskControlError) {
      res.status(error.status).json({ error: error.message, ...error.details });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'task_control_failed' });
  }
}
digitalEmployeesRouter.post('/tasks/:taskId/corrections', async (req, res) => handleTaskControl(req, res));
digitalEmployeesRouter.post('/tasks/:taskId/director-decision', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const decision = String(req.body?.decision || '') as DirectorDecision;
  const reason = String(req.body?.reason || '') as DirectorDecisionReason;
  const contentId = String(req.body?.contentId || '').trim().slice(0, 120);
  if (!['continue', 'adjust', 'abandon'].includes(decision)) { res.status(400).json({ error: 'invalid_director_decision' }); return; }
  if (!contentId) { res.status(400).json({ error: 'director_content_required' }); return; }
  if (decision !== 'continue' && !(reason in DIRECTOR_REASON_LABELS)) { res.status(400).json({ error: 'director_reason_required' }); return; }
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!task) { res.status(404).json({ error: 'task_not_found' }); return; }
  const plan = await tenantRecord<PlanRecord>(COLLECTION.plans, task.plan_id, tenantId);
  if (!plan) { res.status(409).json({ error: 'correction_context_missing' }); return; }
  const original = jsonObject<Record<string, unknown>>(plan.plan, {});
  const pack = original.businessPackage as WeeklyPackage | undefined;
  if (!pack) { res.status(409).json({ error: 'weekly_package_missing' }); return; }
  let taskControlApplied = false;
  try {
    const now = new Date().toISOString();
    const applied = applyDirectorDecision({ pack, contentId, decision, ...(decision !== 'continue' ? { reason } : {}), applyToSimilar: req.body?.applyToSimilar === true, now });
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
      res.json(await buildOverview(tenantId, task.goal_id));
      return;
    }
    const instruction = `${DIRECTOR_DECISION_LABELS[decision]}当前内容方向；原因：${DIRECTOR_REASON_LABELS[reason]}。${req.body?.applyToSimilar === true ? '同时调整本周同类内容。' : '仅作用于当前内容。'}`;
    const runTasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: task.run_id }, sort: 'sequence', perPage: 100 });
    const routingTask = runTasks.items.find(item => item.task_key === 'content_mode_routing');
    if (!routingTask) throw new Error('director_routing_task_missing');
    const result = await applyTaskControl({ tenantId, userId, taskId: routingTask.id, action: 'retry', scope: 'one_off', instruction, rerunDownstream: true });
    taskControlApplied = true;
    await invalidatePublishingAuthorizationForRun(tenantId, task.run_id);
    await appendAuthorizationRequiredEvent({ tenantId, runId: task.run_id, taskId: task.id, reason: 'package_adjusted', changedFields: ['directorDecision'] });
    await appendAudit({ tenantId, userId, action: `director_direction.${decision}`, targetType: 'weekly_content', targetId: contentId, metadata: { runId: task.run_id, taskId: task.id, routingTaskId: routingTask.id, reason, applyToSimilar: req.body?.applyToSimilar === true, affectedContentIds: applied.affectedContentIds, replacementContentId: applied.replacementContentId } });
    await advanceRun(tenantId, result.runId);
    res.json(await buildOverview(tenantId, result.goalId));
  } catch (error) {
    if (!taskControlApplied) await store.update(COLLECTION.plans, plan.id, { plan: original }).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'director_decision_failed';
    res.status(message === 'director_content_not_found' ? 404 : 409).json({ error: message });
  }
});
registerProductionBudgetReforecastRoute(digitalEmployeesRouter, {
  tenantRecord, publicConfig, configForTenant, executionConfigForPlan,
  ensureFrozenEnterpriseProfileForRun, goalInput, appendEvent, appendAudit, buildOverview,});
digitalEmployeesRouter.post('/tasks/:taskId/retry', async (req, res) => handleTaskControl(req, res, 'retry'));
digitalEmployeesRouter.post('/tasks/:taskId/skip', async (req, res) => handleTaskControl(req, res, 'skip'));
digitalEmployeesRouter.post('/tasks/:taskId/complete', async (req, res) => handleTaskControl(req, res, 'manual_complete'));
digitalEmployeesRouter.post('/execution-jobs/:jobId/:action', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const action = String(req.params.action || '') as ContentExecutionControlAction;
  if (!['pause', 'cancel', 'resume', 'retry'].includes(action)) {
    res.status(400).json({ error: 'content_execution_control_invalid' });
    return;
  }
  try {
    await controlContentExecutionJob({
      dataStore: store, tenantId, jobId: String(req.params.jobId || ''), action,
    });
    res.json(await buildOverview(tenantId));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'content_execution_job_control_failed';
    const status = code === 'content_execution_job_not_found' ? 404
      : code.includes('not_') || code.endsWith('_invalid') ? 409 : 500;
    res.status(status).json({ error: code });
  }
});
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
digitalEmployeesRouter.post('/tasks/:taskId/evidence', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!initialTask) { res.status(404).json({ error: 'task_not_found' }); return; }
  await withDigitalEmployeeRunLock(tenantId, initialTask.run_id, async () => {
  const rawRefs = Array.isArray(req.body?.businessRefs) ? req.body.businessRefs.slice(0, 50) as Array<Record<string, unknown>> : [];
  if (!rawRefs.length) { res.status(400).json({ error: 'business_refs_required' }); return; }
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!task) { res.status(404).json({ error: 'task_not_found' }); return; }
  const canonical: Array<Record<string, unknown>> = [];
  for (let index = 0; index < rawRefs.length; index += 1) {
    const validated = await canonicalEvidenceRef(tenantId, rawRefs[index]);
    if (!validated) {
      res.status(400).json({ error: 'evidence_reference_invalid', message: '证据必须引用当前租户内已存在的业务记录。', index, type: rawRefs[index]?.type || '', id: rawRefs[index]?.id || '' });
      return;
    }
    canonical.push(validated);
  }
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId);
  if (!run) { res.status(409).json({ error: 'evidence_context_missing' }); return; }
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
  res.json(await buildOverview(tenantId, run.goal_id));
  });
});
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
digitalEmployeesRouter.post('/runs/:runId/cancel', cancelDigitalEmployeeRunRoute);
/** Background continuation uses a database lease and durable source linkage. */
export async function continueManagedOperatingCycle(tenantId: string, sourceRunId: string, now = new Date()): Promise<string | null> {
  const elapsedStart = Date.now();
  const leaseNow = () => new Date(now.getTime() + Date.now() - elapsedStart);
  const lease = await acquireDurableOperationLease({ dataStore: store, tenantId, scope: 'managed-operating-cycle', subjectId: 'next-cycle', ownerId: `runtime-${process.pid}`, now, leaseDurationMs: 30 * 60_000 });
  if (!lease) return null;
  try {
    const sourceRun = await tenantRecord<RunRecord>(COLLECTION.runs, sourceRunId, tenantId);
    if (!sourceRun || sourceRun.status !== 'succeeded' || ['starter_198', 'starter_social_content'].includes(String(sourceRun.product_profile || ''))) return null;
    const source = await tenantRecord<GoalRecord>(COLLECTION.goals, sourceRun.goal_id, tenantId);
    const sourcePlan = await tenantRecord<PlanRecord>(COLLECTION.plans, sourceRun.plan_id, tenantId);
    const review = await first<StoredRecord>(COLLECTION.reviews, { tenant_id: tenantId, run_id: sourceRunId });
    if (!source || source.status !== 'completed' || !sourcePlan || sourcePlan.status !== 'approved' || !review || review.status !== 'generated') return null;
    const body = jsonObject<Record<string, unknown>>(sourcePlan.plan, {});
    const sourcePack = body.businessPackage as WeeklyPackage | undefined;
    const resolved = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
    const window = nextManagedCycleWindow(source, now);
    if (!sourcePack || !resolved || !window) return null;
    const summary = jsonObject<Record<string, unknown>>(review.summary, {});
    const recommendations = Array.isArray(summary.nextPlanRecommendations) ? summary.nextPlanRecommendations.filter((value): value is string => typeof value === 'string') : [];
    const prepared = prepareManagedCyclePackage(sourcePack, resolved.config, window.endsAt, recommendations, now);
    if (!prepared) return null;
    let target: GoalRecord | null = null;
    // Recover a goal saved before the source checkpoint, including after restart.
    for (let page = 1; ; page++) {
      const goals = await store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId }, page, perPage: 100, sort: '-created_at' });
      for (const candidate of goals.items) {
        const context = jsonObject<{ managedContinuation?: { sourceRunId?: string } }>(candidate.scope, {});
        if (context.managedContinuation?.sourceRunId === sourceRunId) { target = candidate; break; }
      }
      if (target || page >= goals.totalPages || !goals.items.length) break;
    }
    if (target && (target.starts_at !== window.startsAt || target.ends_at !== window.endsAt)) return target.id;
    if (target) {
      const existingRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: target.id });
      if (existingRun && existingRun.status !== 'initializing') return target.id;
    }
    const input = { ...goalInput(source), title: '社媒托管经营周期', startsAt: window.startsAt, endsAt: window.endsAt, businessLine: 'content_growth' as const };
    const issues = validatePackage(prepared.pack, input, resolved.config);
    if (issues.length) throw Error(issues.join('；'));
    await assertDurableOperationLease({ dataStore: store, lease, now: leaseNow() });
    if (!target) {
      const busy = await store.list<RunRecord>(COLLECTION.runs, { where: { tenant_id: tenantId }, perPage: 500 });
      if (busy.items.some(run => !['succeeded', 'failed', 'cancelled'].includes(run.status))) return null;
      target = await requiredCreate<GoalRecord>(COLLECTION.goals, { tenant_id: tenantId, business_line: 'content_growth', content_platforms: source.content_platforms, objective: source.objective, metric: source.metric, baseline: source.baseline, target: source.target, unit: source.unit, constraints: source.constraints, scope: { description: input.scope, videoPlans: prepared.pack.tasks.find(task => task.templateId === 'production')?.videoPlans, managedContinuation: { sourceRunId, sourceGoalId: source.id, reviewId: review.id, grantId: prepared.grantId, cycleKey: `${sourceRunId}:${window.startsAt}` } }, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt, owner_id: resolved.config.managedPublishingGrant!.authorizedBy, status: 'draft', version: 1, created_at: now.toISOString(), updated_at: now.toISOString() });
    }
    let targetPlan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id });
    if (!targetPlan) targetPlan = await requiredCreate<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: { ...configurationSnapshot(resolved), ...compilePackage(prepared.pack, input, resolved.config), managedPublishingGrantId: prepared.grantId, managedSourceRunId: sourceRunId }, created_at: now.toISOString() });
    await assertDurableOperationLease({ dataStore: store, lease, now: leaseNow() });
    if (String(jsonObject<Record<string, unknown>>(targetPlan.plan, {}).managedPublishingGrantId || '') !== prepared.grantId) return null;
    // Re-check revocation after writes and before activating paid work.
    const latest = await resolveCurrentConfiguration(tenantId, await configForTenant(tenantId));
    if (!latest || !managedPublishingGrantCovers(prepared.pack, latest.config, prepared.grantId, target.ends_at, now.toISOString())) return null;
    const result = await approveGoalForReview(tenantId, latest.config.managedPublishingGrant!.authorizedBy!, target.id, prepared.pack.revision, []);
    if (result.status !== 200) { const error = result.body as { message?: string; error?: string }; throw Error(error.message || error.error || 'managed_cycle_activation_failed'); }
    return target.id;
  } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
}
/** Persist assignments before starting. Replays use source IDs stored in the plan. */
export async function allocateReviewTodos(tenantId: string, userId: string, board: ReviewTodoBoard): Promise<string> {
  const targetId = await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
    const source = await tenantRecord<GoalRecord>(COLLECTION.goals, board.sourceGoalId, tenantId);
    if (!source) throw Error('复盘目标已不可用');
    const goals = await store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId, starts_at: board.week }, perPage: 100 });
    if (!board.targetGoalId && goals.items.filter(g => g.status === 'draft').length > 1) throw Error('有多个下周目标，请先明确选择');
    let target = board.targetGoalId ? await tenantRecord<GoalRecord>(COLLECTION.goals, board.targetGoalId, tenantId) : goals.items.find(g => g.status === 'draft');
    // Recover after a successful start followed by a failed board-state write.
    for (const candidate of goals.items) {
      if (board.targetGoalId && candidate.id !== board.targetGoalId) continue;
      const saved = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: candidate.id });
      const pack = saved ? jsonObject<{businessPackage?: WeeklyPackage}>(saved.plan, {}).businessPackage : undefined;
      if (pack && board.items.every(i => pack.reviewTodos?.some(p => sameTodoRequirements(p, i)))) { target = candidate; break; }
    }
    if (board.targetGoalId && !target) throw Error('下周目标不存在或不可访问');
    if (!target && goals.items.filter(g => g.status === 'draft').length > 1) throw Error('有多个下周目标，请先明确选择');
    if (target && target.starts_at !== board.week) throw Error('目标周期与待办周期不一致');
    if (target && !await weeklyGoalFactRebuildTargetCommitted(tenantId, target)) throw Error('最新事实周目标尚未完成安全替换');
    const configRecord = await configForTenant(tenantId);
    const resolved = await resolveCurrentConfiguration(tenantId, configRecord);
    if (!resolved) throw Error('请先完成 Agent 设置');
    const sourcePlan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: source.id });
    const sourcePack = sourcePlan ? jsonObject<{businessPackage?: WeeklyPackage}>(sourcePlan.plan, {}).businessPackage : undefined;
    if (!target) {
      const end = new Date(`${board.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
      const input = { ...goalInput(source), title: '下周经营目标', startsAt: board.week, endsAt: end.toISOString().slice(0, 10) };
      const seed = sourcePack ? structuredClone(sourcePack) : recommendPackage(input, resolved.config);
      delete seed.reviewTodos;
      seed.tasks.forEach(t => { t.dueAt = input.endsAt; t.ownerId = ''; t.ownerName = ''; t.videoPlans?.forEach(v => { delete v.reviewRequirements; }); });
      seed.authorization.mode = 'each'; seed.revision = 1;
      // Validate capacity before creating any records.
      applyReviewTodoPlan(seed, board.items);
      target = await requiredCreate<GoalRecord>(COLLECTION.goals, { tenant_id: tenantId, business_line: source.business_line, content_platforms: source.content_platforms, objective: source.objective, metric: source.metric, baseline: source.baseline, target: source.target, unit: source.unit, constraints: source.constraints, scope: { description: input.scope, videoPlans: seed.tasks.find(t => t.templateId === 'production')?.videoPlans, reviewTodoBoardId: board.id }, title: input.title, starts_at: input.startsAt, ends_at: input.endsAt, owner_id: userId || source.owner_id, status: 'draft', version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      await requiredCreate<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: { ...configurationSnapshot(resolved), ...compilePackage(seed, input, resolved.config) }, created_at: new Date().toISOString() });
    }
    // Preserve the draft link even if activation subsequently needs user input.
    board.targetGoalId = target.id;
    let plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id });
    if (!plan && jsonObject<Record<string, unknown>>(target.scope, {}).reviewTodoBoardId === board.id) {
      const input = goalInput(target);
      const seed = sourcePack ? structuredClone(sourcePack) : recommendPackage(input, resolved.config);
      delete seed.reviewTodos;
      seed.tasks.forEach(t => { t.dueAt = input.endsAt; t.ownerId = ''; t.ownerName = ''; t.videoPlans?.forEach(v => { delete v.reviewRequirements; }); });
      seed.authorization.mode = 'each'; seed.revision = 1;
      plan = await requiredCreate<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: { ...configurationSnapshot(resolved), ...compilePackage(seed, input, resolved.config) }, created_at: new Date().toISOString() });
    }
    if (!plan) throw Error('下周目标缺少计划，请在目标页补充');
    const body = jsonObject<Record<string, unknown>>(plan.plan, {});
    if (hasWeeklyGoalFactRebuildPlanFence(body)) throw Error('下周计划正在发生状态变更');
    const pack = body.businessPackage as WeeklyPackage | undefined;
    if (!pack) throw Error('请先完善下周目标的具体任务安排');
    const alreadyApplied = board.items.every(i => pack.reviewTodos?.some(p => sameTodoRequirements(p, i)));
    if (target.status !== 'draft') { if (alreadyApplied) return target.id; throw Error('下周目标已启动，请在任务执行页调整，不能自动追加'); }
    if (plan.status !== 'draft') throw Error('下周计划正在发生状态变更');
    const updated = applyReviewTodoPlan(pack, board.items);
    // Never inherit last cycle's grant. Resolve explicit, current expiring consent.
    const recurring = applyManagedPublishingGrant(updated, resolved.config, target.ends_at);
    updated.authorization = recurring.pack.authorization;
    if (updated.tasks.some(t => t.ownerId)) throw Error('下周目标包含团队分工，请在目标页核对负责人后启动');
    const config = executionConfigForPlan(plan, resolved.config);
    const issues = validatePackage(updated, goalInput(target), configSnapshotForPlan(plan, resolved.config));
    if (issues.length) throw Error(issues.join('；'));
    if (!store.compareAndSwap || !await store.compareAndSwap(COLLECTION.plans, plan.id, {
      tenant_id: tenantId, goal_id: target.id, status: 'draft', plan: plan.plan,
    }, { plan: { ...body, ...compilePackage(updated, goalInput(target), config), managedPublishingGrantId: recurring.grantId || '' } })) throw Error('下周计划已更新或正在重建，请刷新后重试');
    return target.id;
  });
  const plan = await first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: targetId });
  const pack = plan ? jsonObject<{businessPackage?: WeeklyPackage}>(plan.plan, {}).businessPackage : undefined;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, targetId, tenantId);
  const result = await approveGoalForReview(tenantId, userId || goal?.owner_id || '', targetId, pack?.revision, []);
  if (result.status !== 200) { const error = result.body as {message?: string;error?: string}; throw Error(error.message || error.error || '目标启动失败'); }
  return targetId;
}
digitalEmployeesRouter.get('/review-todos', async (req, res) => {
  try { res.json(await reviewTodoService.get((res.locals as AuthLocals).tenantId, typeof req.query.week === 'string' ? req.query.week : undefined)); }
  catch (error) { res.status(503).json({ error: (error as Error).message }); }
});
digitalEmployeesRouter.put('/review-todos', async (req, res) => {
  try { res.json(await reviewTodoService.save((res.locals as AuthLocals).tenantId, req.body, (res.locals as AuthLocals).userId)); }
  catch (error) { res.status(409).json({ error: (error as Error).message }); }
});
digitalEmployeesRouter.post('/review-todos/dispatch', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.json(await reviewTodoService.dispatch(tenantId, userId, String(req.body.week || ''), allocateReviewTodos, Number(req.body.revision))); }
  catch (error) { res.status(409).json({ error: (error as Error).message }); }
});
