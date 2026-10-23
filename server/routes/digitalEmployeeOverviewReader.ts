import type { DataStore } from '../storage/datastore.js';
import type { BusinessSnapshot } from '../digitalEmployees/businessSnapshot.js';
import { buildContentQueueProjection } from '../digitalEmployees/contentQueue.js';
import { buildContentExecutionRuntime, unavailableContentExecutionRuntime } from '../digitalEmployees/contentExecutionRuntime.js';
import { traceableIndustryTrends } from '../digitalEmployees/contentReview.js';
import { buildDeliveryResources } from '../digitalEmployees/deliveryResources.js';
import { directorAnalysisReferenceIds, liveDirectorAnalysisTasks, projectDirectorAnalysisStatus } from '../digitalEmployees/liveDirectorAnalyses.js';
import { goalInput, publicAgentStatuses, publicConfigurationMetadata, publicGoal, publicOverviewPlan } from '../digitalEmployees/overviewProjection.js';
import { visibleDigitalEmployeeAgentRole as visibleAgentRole } from '../digitalEmployees/agentRoles.js';
import { repairCollapsedWeeklyVideoProduction } from '../digitalEmployees/weeklyPackage.js';
import type { ResolvedDigitalEmployeeConfiguration } from '../digitalEmployees/configuration.js';
import type { PublishingOAuthPlatform, PublishingReadinessSnapshot } from '../digitalEmployees/publishingOAuthReadiness.js';
import type { WorkflowTask } from '../../src/lib/digitalEmployees.js';
import type { WeeklyPackage } from '../../src/lib/weeklyPackage.js';
import { runReviewSummary } from './digitalEmployeeReviewSummary.js';
import { DIGITAL_EMPLOYEE_COLLECTION as COLLECTION, jsonObject, type ApprovalRecord, type ConfigRecord, type EventRecord, type GoalRecord, type HandoffRecord, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from './digitalEmployeeRecords.js';

/** Composes tenant-scoped reads; the authenticated route owns identity and writes. */
export function createDigitalEmployeeOverviewReader(input: {
  store: DataStore;
  configForTenant: (tenantId: string) => Promise<ConfigRecord | null>;
  committedGoals: (tenantId: string, goals: GoalRecord[]) => Promise<GoalRecord[]>;
  resolveConfiguration: (tenantId: string, record?: ConfigRecord | null) => Promise<ResolvedDigitalEmployeeConfiguration | null>;
  first: <T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort?: string) => Promise<T | null>;
  buildBusinessSnapshot: (tenantId: string, range?: { startsAt?: string; endsAt?: string }) => Promise<BusinessSnapshot>;
  publishingReadinessForOverview: (tenantId: string, required: boolean, targetPlatforms: string[]) => Promise<PublishingReadinessSnapshot>;
}) {
  const store = input.store;
  const configForTenant = input.configForTenant;
  const committedDigitalEmployeeOperatingGoals = input.committedGoals;
  const resolveCurrentConfiguration = input.resolveConfiguration;
  const first = input.first;
  const buildBusinessSnapshot = input.buildBusinessSnapshot;
  const publishingReadinessForOverview = input.publishingReadinessForOverview;

async function buildOverview(tenantId: string, requestedGoalId = '', requestedRange?: { startsAt: string; endsAt: string }) {
  const [configRecord, goalResult] = await Promise.all([
    configForTenant(tenantId),
    store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId }, sort: '-created_at', page: 1, perPage: 500 }),
  ]);
  const operatingGoals = await committedDigitalEmployeeOperatingGoals(tenantId, goalResult.items);
  const goal = requestedGoalId
    ? operatingGoals.find(item => item.id === requestedGoalId) ?? null
    : operatingGoals.find(item => ['active', 'paused'].includes(item.status)) ?? operatingGoals[0] ?? null;
  const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
  if (!goal) {
    const [businessSnapshot, contentQueue, executionRuntime, industryTrends, directorAnalyses] = await Promise.all([
      buildBusinessSnapshot(tenantId, requestedRange),
      buildContentQueueProjection({
        tenantId, runId: '', planBody: {}, tasks: [],
        publishingTargets: resolvedConfiguration?.config.publishingTargets || [],
        defaultProductName: resolvedConfiguration?.config.focusProducts.split(/[、，,；;]/).map(item => item.trim()).find(Boolean) || '',
        defaultLanguages: resolvedConfiguration?.config.videoLanguages || [resolvedConfiguration?.config.videoDefaults?.language || 'en'],
      }).catch(() => ({ generatedAt: new Date().toISOString(), sourceStatus: 'unavailable' as const, sourceNote: '内容队列暂时无法读取，请刷新重试', items: [] })),
      buildContentExecutionRuntime({ dataStore: store, tenantId })
        .catch(() => unavailableContentExecutionRuntime()),
      store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 100 })
        .then(result => traceableIndustryTrends(result.items))
        .catch(() => traceableIndustryTrends([])),
      liveDirectorAnalysisTasks(store, tenantId, { includeUnscoped: !requestedGoalId }).catch(() => []),
    ]);
    return { config: resolvedConfiguration?.config || null, configuration: publicConfigurationMetadata(resolvedConfiguration), goals: [], goal: null, plan: null, run: null, tasks: [], contentQueue, executionRuntime, industryTrends, events: [], approvals: [], handoffs: [], review: null, liveReview: null, agents: projectDirectorAnalysisStatus(publicAgentStatuses([]), directorAnalyses), businessSnapshot, publishingReadiness: null };
  }
  const [plan, run, businessSnapshot] = await Promise.all([
    first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
    first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at'),
    buildBusinessSnapshot(tenantId, requestedRange || { startsAt: goal.starts_at, endsAt: goal.ends_at }),
  ]);
  const runId = run?.id || '';
  const [tasks, events, approvals, handoffs, review] = runId ? await Promise.all([
    store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: runId }, sort: 'sequence', perPage: 100 }),
    store.list<EventRecord>(COLLECTION.events, { where: { tenant_id: tenantId, run_id: runId }, sort: '-sequence', perPage: 500 }),
    store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: runId }, sort: '-created_at', perPage: 100 }),
    store.list<HandoffRecord>(COLLECTION.handoffs, { where: { tenant_id: tenantId, run_id: runId }, sort: '-started_at', perPage: 100 }),
    first<StoredRecord & { tenant_id: string; run_id: string; summary: unknown; status: string; created_at: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: runId }),
  ]) : [null, null, null, null, null] as const;
  const taskItems = tasks?.items || [];
  const normalizedTasks = taskItems.map(task => ({ ...task, agent_role: visibleAgentRole(task.agent_role, task.task_key) }));
  const publicTasks = normalizedTasks.map(task => ({ ...task, business_refs: jsonObject(task.business_refs, []), depends_on: jsonObject(task.depends_on, []), output: jsonObject(task.output, {}) })) as WorkflowTask[];
  const planBody = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
  const overviewPlanBody = planBody.businessPackage
    ? { ...planBody, businessPackage: repairCollapsedWeeklyVideoProduction(planBody.businessPackage as WeeklyPackage) }
    : planBody;
  const planTasks = Array.isArray(overviewPlanBody.tasks) ? overviewPlanBody.tasks.map(item => jsonObject<Record<string, unknown>>(item, {})) : [];
  // The compiled workflow, not the generic package template list, decides
  // whether this week actually contains a publishing branch.
  const publishingRequired = planTasks.some(item => String(item.key || '') === 'content_release_approval');
  const publishingTargetPlatforms = publishingRequired ? goalInput(goal).contentPlatforms : [];
  const publishingReadinessFallback: PublishingReadinessSnapshot = {
    required: publishingRequired,
    ready: false,
    status: 'unavailable',
    targetPlatforms: publishingTargetPlatforms.filter((platform): platform is PublishingOAuthPlatform => ['facebook', 'instagram', 'tiktok', 'youtube'].includes(platform)),
    connectedPlatforms: [],
    missingOAuthPlatforms: [],
    missingAccountPlatforms: [],
    summary: '发布准备状态暂时无法核验，请刷新后再确认；不会因此重复启动生产',
    actionPage: 'accountManagement',
  };
  const [deliveryData, contentQueue, executionRuntime, industryTrends, directorAnalyses, publishingReadiness] = await Promise.all([
    buildDeliveryResources(tenantId, publicTasks, goal.title)
      .then(deliveries => ({ deliveries, deliveryNotice: '' }))
      .catch(() => ({ deliveries: undefined, deliveryNotice: '业务产物暂时无法读取，当前展示任务记录。请刷新重试。' })),
    buildContentQueueProjection({
      tenantId,
      runId,
      planBody: overviewPlanBody,
      tasks: publicTasks,
      planId: plan?.id || '',
      goal: { id: goal.id, objective: goal.objective, startsAt: goal.starts_at, endsAt: goal.ends_at, version: Number(goal.version || 1) },
      publishingTargets: resolvedConfiguration?.config.publishingTargets || [],
      defaultProductName: resolvedConfiguration?.config.focusProducts.split(/[、，,；;]/).map(item => item.trim()).find(Boolean) || '',
      defaultLanguages: resolvedConfiguration?.config.videoLanguages || [resolvedConfiguration?.config.videoDefaults?.language || 'en'],
    })
      .catch(() => ({ generatedAt: new Date().toISOString(), sourceStatus: 'unavailable' as const, sourceNote: '内容队列暂时无法读取，请刷新重试', items: [] })),
    buildContentExecutionRuntime({ dataStore: store, tenantId })
      .catch(() => unavailableContentExecutionRuntime()),
    store.list<StoredRecord>('trend_videos', { where: { tenantId }, sort: '-updatedAt', perPage: 100 })
      .then(result => traceableIndustryTrends(result.items))
      .catch(() => traceableIndustryTrends([])),
    liveDirectorAnalysisTasks(store, tenantId, {
      goalId: goal.id, runId, includeUnscoped: !requestedGoalId,
      referenceVideoIds: directorAnalysisReferenceIds(overviewPlanBody, publicTasks),
    }).catch(() => []),
    publishingReadinessForOverview(tenantId, publishingRequired, publishingTargetPlatforms)
      .catch(() => publishingReadinessFallback),
  ]);
  return {
    config: resolvedConfiguration?.config || null,
    configuration: publicConfigurationMetadata(resolvedConfiguration),
    goals: operatingGoals.map(publicGoal),
    goal: publicGoal(goal),
    plan: publicOverviewPlan({ plan, body: overviewPlanBody, goal, resolvedConfiguration }),
    run,
    tasks: normalizedTasks.map(task => ({ ...task, depends_on: jsonObject(task.depends_on, []), output: jsonObject(task.output, {}) })),
    ...deliveryData,
    contentQueue,
    executionRuntime,
    industryTrends,
    events: events?.items.slice().reverse().map(event => ({ ...event, payload: jsonObject(event.payload, {}) })) || [],
    approvals: approvals?.items.map(approval => {
      const approvalTask = taskItems.find(task => task.id === approval.task_id);
      return {
        ...approval,
        requested_by_agent: visibleAgentRole(String(approval.requested_by_agent || ''), approvalTask?.task_key || ''),
        evidence: jsonObject(approval.evidence, {}),
      };
    }) || [],
    handoffs: handoffs?.items.map(handoff => ({ ...handoff, snapshot: jsonObject(handoff.snapshot, {}) })) || [],
    review: review ? { ...review, summary: jsonObject(review.summary, {}) } : null,
    liveReview: run ? runReviewSummary(run, taskItems, businessSnapshot) : null,
    agents: projectDirectorAnalysisStatus(publicAgentStatuses(normalizedTasks), directorAnalyses),
    businessSnapshot,
    publishingReadiness,
  };
}

  return { buildOverview };
}
