import { buildDeliveryResources } from '../digitalEmployees/deliveryResources.js';
import type { WorkflowTask } from '../../src/lib/digitalEmployees.js';
import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { getWhatsAppCustomers } from '../whatsapp/historyImport.js';
import { ensureDigitalEmployeeSocialCollectionTask, runScheduledTaskNow } from './scheduler.js';
import { readTenantEnterpriseProfile, updateTenantEnterpriseProfile } from './enterprise.js';
import { buildBusinessSnapshot, type BusinessSnapshot } from '../digitalEmployees/businessSnapshot.js';
import { advanceAutomatedContentProduction, resolveEnterpriseAssetLocation, resumeContentProjectForTaskControl } from '../digitalEmployees/contentProduction.js';
import { buildContentBatchPlan, enterpriseAssetStableId, type ContentBatchPlanDraft } from '../digitalEmployees/contentBatchPlan.js';
import { summarizeContentFeedback } from '../digitalEmployees/contentReview.js';
import {
  configurationSnapshot,
  resolveDigitalEmployeeConfiguration,
  type ResolvedDigitalEmployeeConfiguration,
} from '../digitalEmployees/configuration.js';
import { dispatchFollowupBatch, followupDispatchPreflightBlockedReason, getTenantFollowupDispatchStatus, onFollowupWorkerEvent, preflightFollowupBatchDispatch } from '../digitalEmployees/followupDispatchWorker.js';
import { bindPublishingTargets, listConnectedPublishingAccounts, publishingTargetPlatforms } from '../digitalEmployees/publishingTargets.js';
import { buildPublishingApprovalPackage, createPublishingCalendarEntries, type PublishingApprovalPackage } from '../digitalEmployees/publishingExecution.js';
import { beijingDate, followupScheduleFromCadence, latestDueReviewSlot, socialScheduleFromCadence } from '../digitalEmployees/runtimeSchedule.js';
import { approvalRunBlockedReason, withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import {
  DEFAULT_FOLLOWUP_SEGMENT_CRITERIA,
  applyFollowupBatchDecision,
  createCustomerSegmentSnapshot,
  createFollowupBatch,
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
digitalEmployeesRouter.use(requireAuth);

digitalEmployeesRouter.get('/publishing-accounts', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json({ items: await listConnectedPublishingAccounts(tenantId) });
});

type StoredRecord = { id: string; [key: string]: unknown };
type ConfigRecord = StoredRecord & {
  tenant_id: string;
  config: unknown;
  status: string;
  config_version?: number;
  policy_version?: string;
  facts_version?: string;
  effective_config?: unknown;
  activated_at?: string;
};
type GoalRecord = StoredRecord & {
  tenant_id: string;
  business_line?: string;
  content_platforms?: unknown;
  title: string;
  objective: string;
  metric: string;
  baseline: number;
  target: number;
  unit: string;
  starts_at: string;
  ends_at: string;
  scope: unknown;
  constraints: unknown;
  owner_id: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};
type PlanRecord = StoredRecord & { tenant_id: string; goal_id: string; status: string; plan: unknown; created_at: string };
type RunRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  current_controller: string;
  pause_reason: string;
  started_at: string;
  completed_at: string;
};
type TaskRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  run_id: string;
  task_key: string;
  title: string;
  description: string;
  agent_role: string;
  kind: string;
  status: WorkflowTaskStatus;
  sequence: number;
  priority: string;
  requires_approval: boolean;
  depends_on: unknown;
  output: unknown;
  blocked_reason: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  business_domain?: string;
  capability_key?: string;
  destination?: string;
  destination_view?: string;
  status_source?: string;
  execution_mode?: 'internal' | 'observe' | 'draft_executor' | 'approval';
  external_effect?: 'none' | 'draft' | 'schedule' | 'publish' | 'send';
  automatic_execution_allowed?: boolean;
  policy_source?: string;
  business_refs?: unknown;
  task_version?: number;
  correction_version?: number;
};
type EventRecord = StoredRecord & {
  tenant_id: string;
  run_id: string;
  task_id: string;
  sequence: number;
  type: string;
  level: string;
  summary: string;
  payload: unknown;
  occurred_at: string;
};
type ApprovalRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  run_id: string;
  task_id: string;
  status: string;
  action_summary: string;
  risk_level: string;
  evidence: unknown;
  requested_by_agent: string;
  decided_by: string;
  decision_note: string;
  created_at: string;
  decided_at: string;
  subject_version?: number;
  content_hash?: string;
};
type HandoffRecord = StoredRecord & {
  tenant_id: string;
  run_id: string;
  task_id: string;
  status: string;
  taken_by: string;
  snapshot: unknown;
  started_at: string;
  returned_at: string;
};
type CorrectionRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  run_id: string;
  task_id: string;
  version: number;
  scope: 'one_off' | 'rule_candidate';
  instruction: string;
  rerun_downstream: boolean;
  before_state: unknown;
  after_state: unknown;
  affected_task_ids: unknown;
  business_refs: unknown;
  status: string;
  created_by: string;
  created_at: string;
};
type ContentBatchPlanRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  run_id: string;
  task_id: string;
  status: string;
  orders: unknown;
  routing: unknown;
  config_version: number;
  policy_version: string;
  facts_version: string;
  created_at: string;
  updated_at: string;
};

const COLLECTION = {
  config: 'digital_employee_configs',
  configVersions: 'digital_employee_config_versions',
  goals: 'weekly_goals',
  plans: 'weekly_plans',
  runs: 'workflow_runs',
  tasks: 'workflow_tasks',
  events: 'run_events',
  approvals: 'approval_requests',
  handoffs: 'handoff_sessions',
  reviews: 'weekly_reviews',
  corrections: 'workflow_corrections',
  segments: 'customer_segments',
  segmentMembers: 'customer_segment_members',
  followupBatches: 'followup_batches',
  followupItems: 'followup_batch_items',
  contentBatchPlans: 'content_batch_plans',
} as const;

const streamClients = new Map<string, Set<Response>>();
const eventAppendQueues = new Map<string, Promise<void>>();
const goalApprovalQueues = new Map<string, Promise<void>>();
const customerWorkflowQueues = new Map<string, Promise<void>>();
const scheduledReviewQueues = new Map<string, Promise<void>>();

async function withLocalQueue<T>(queue: Map<string, Promise<void>>, key: string, action: () => Promise<T>): Promise<T> {
  const prior = queue.get(key) || Promise.resolve();
  const operation = prior.catch(() => undefined).then(action);
  const tail = operation.then(() => undefined, () => undefined);
  queue.set(key, tail);
  try {
    return await operation;
  } finally {
    if (queue.get(key) === tail) queue.delete(key);
  }
}

function jsonObject<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function publicConfig(record: ConfigRecord | null): DigitalEmployeeConfig | null {
  return record ? normalizeDigitalEmployeeConfig(jsonObject(record.config, {})) : null;
}

async function resolveCurrentConfiguration(
  tenantId: string,
  record?: ConfigRecord | null,
): Promise<ResolvedDigitalEmployeeConfiguration | null> {
  const configRecord = record === undefined ? await configForTenant(tenantId) : record;
  const config = publicConfig(configRecord);
  if (!config || !configRecord) return null;
  const enterpriseProfile = await readTenantEnterpriseProfile(tenantId);
  return resolveDigitalEmployeeConfiguration({
    config,
    enterpriseProfile,
    configVersion: Number(configRecord.config_version || 1),
  });
}

function publicConfigurationMetadata(resolved: ResolvedDigitalEmployeeConfiguration | null) {
  if (!resolved) return null;
  return {
    configVersion: resolved.configVersion,
    policyVersion: resolved.policyVersion,
    knowledgeBinding: resolved.knowledgeBinding,
    runtimePolicy: resolved.runtimePolicy,
  };
}

function configSnapshotForPlan(plan: PlanRecord | null, fallback: DigitalEmployeeConfig): DigitalEmployeeConfig {
  if (!plan) return fallback;
  const body = jsonObject<Record<string, unknown>>(plan.plan, {});
  return body.configSnapshot ? normalizeDigitalEmployeeConfig(jsonObject(body.configSnapshot, fallback)) : fallback;
}

function publicGoal(record: GoalRecord): WeeklyGoalInput & { id: string; status: string; version: number; createdAt: string; updatedAt: string } {
  return {
    id: record.id,
    businessLine: ['content_growth', 'customer_conversion'].includes(String(record.business_line)) ? record.business_line as WeeklyGoalInput['businessLine'] : 'full_funnel',
    contentPlatforms: jsonObject<WeeklyGoalInput['contentPlatforms']>(record.content_platforms, ['facebook', 'instagram', 'tiktok', 'youtube']),
    title: String(record.title || ''),
    objective: String(record.objective || ''),
    metric: String(record.metric || ''),
    baseline: Number(record.baseline || 0),
    target: Number(record.target || 0),
    unit: String(record.unit || ''),
    startsAt: String(record.starts_at || ''),
    endsAt: String(record.ends_at || ''),
    scope: String(jsonObject(record.scope, record.scope || '')),
    constraints: jsonObject<string[]>(record.constraints, []),
    status: String(record.status || 'draft'),
    version: Number(record.version || 1),
    createdAt: String(record.created_at || ''),
    updatedAt: String(record.updated_at || ''),
  };
}

async function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
  const result = await store.list<T>(collection, { where, sort, page: 1, perPage: 1 });
  return result.items[0] ?? null;
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

function goalInput(record: GoalRecord): WeeklyGoalInput {
  const publicRecord = publicGoal(record);
  const { id: _id, status: _status, version: _version, createdAt: _created, updatedAt: _updated, ...goal } = publicRecord;
  return goal;
}

const visibleAgentRole = (role: string, taskKey = ''): 'business' | 'industry' | 'content' | 'customer' => {
  if (['business', 'industry', 'content', 'customer'].includes(role)) return role as 'business' | 'industry' | 'content' | 'customer';
  if (['knowledge', 'planner', 'review'].includes(role)) return 'business';
  if (role === 'channel') return ['scheduled_source_collection', 'viral_analysis'].includes(taskKey) ? 'industry' : 'content';
  if (role === 'risk') return taskKey.startsWith('followup_') ? 'customer' : 'content';
  return 'business';
};

function stableProductId(product: Record<string, unknown>, index: number): string {
  const sku = String(product.sku || '').trim();
  return sku || `enterprise-product-${index + 1}`;
}

function enterpriseMaterialIds(tenantId: string, products: Array<Record<string, unknown>>, originalIndexes: number[] = []): string[] {
  const ids: string[] = [];
  products.forEach((product, localIndex) => {
    const productIndex = originalIndexes[localIndex] ?? localIndex;
    const groups = ['images', 'videos', 'factoryImages', 'packagingImages', 'sceneImages', 'brandAssets']
      .map(group => Array.isArray(product[group]) ? product[group] as Array<Record<string, unknown>> : [])
      .filter(group => group.length);
    if (String(product.imageUrl || '').trim()) groups.unshift([{ type: 'image', url: product.imageUrl }]);
    groups.flat().forEach((asset, assetIndex) => {
      const url = String(asset.url || '').trim();
      const location = resolveEnterpriseAssetLocation(url, tenantId);
      if (url && (location.url || location.localPath || location.objectKey)) {
        ids.push(enterpriseAssetStableId(productIndex, assetIndex, url));
      }
    });
  });
  return ids;
}

async function contentRoutingEvidence(tenantId: string, config: DigitalEmployeeConfig) {
  const [profile, analyses, materials] = await Promise.all([
    readTenantEnterpriseProfile(tenantId),
    store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 }),
    store.list<StoredRecord>('materials', { where: { tenantId }, perPage: 500 }).catch(() => ({ items: [] as StoredRecord[], page: 1, perPage: 500, totalItems: 0, totalPages: 0 })),
  ]);
  const rawProducts = Array.isArray(profile.products?.items) ? profile.products.items as Array<Record<string, unknown>> : [];
  const focused = config.focusProducts.split(/[\n,，;；、]/).map(item => item.trim().toLowerCase()).filter(Boolean);
  const selectedProducts = focused.length ? rawProducts.filter(product => focused.some(value => [product.name, product.sku].some(field => String(field || '').trim().toLowerCase() === value))) : [];
  const materialRows = materials.items.filter(item => {
    const url = String(item.url || item.path || item.objectKey || '').trim();
    return Boolean(url && item.synthetic !== true && !/mock|placeholder|e2e-quality-test/i.test(url));
  });
  return {
    products: selectedProducts.map((product, index) => {
      const originalIndex = rawProducts.indexOf(product);
      const id = stableProductId(product, originalIndex);
      return {
        id,
        name: String(product.name || product.sku || `产品 ${index + 1}`).trim(),
        materialIds: [...enterpriseMaterialIds(tenantId, [product], [originalIndex]), ...materialRows.filter(item => String(item.productId || '') === id).map(item => item.id)],
      };
    }),
    exactAnalysisIds: analyses.items.filter(exactVideoAnalysis).map(item => item.id),
    materialIds: [
      ...enterpriseMaterialIds(tenantId, selectedProducts, selectedProducts.map(product => rawProducts.indexOf(product))),
      ...materialRows.filter(item => selectedProducts.some(product => String(item.productId || '') === stableProductId(product, rawProducts.indexOf(product)))).map(item => item.id),
    ],
  };
}

async function ensureContentBatchPlan(input: { tenantId: string; goal: GoalRecord; run: RunRecord; task: TaskRecord; plan: PlanRecord | null; config: DigitalEmployeeConfig }) {
  const existing = await first<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { tenant_id: input.tenantId, task_id: input.task.id });
  if (existing) {
    const routing = jsonObject<{ blocker?: string; eligibleRoutes?: ContentBatchPlanDraft['eligibleRoutes']; disabledRoutes?: ContentBatchPlanDraft['disabledRoutes'] }>(existing.routing, {});
    const draft: ContentBatchPlanDraft = {
      status: existing.status === 'planned' ? 'planned' : 'blocked',
      orders: jsonObject(existing.orders, []),
      blocker: String(routing.blocker || ''),
      eligibleRoutes: routing.eligibleRoutes || [],
      disabledRoutes: routing.disabledRoutes || [],
    };
    return { record: existing, created: false, draft };
  }
  const planBody = jsonObject<Record<string, unknown>>(input.plan?.plan, {});
  const knowledgeBinding = jsonObject<Record<string, unknown>>(planBody.knowledgeBinding, {});
  const priorReview = await first<StoredRecord & { tenant_id: string; summary: unknown }>(COLLECTION.reviews, { tenant_id: input.tenantId }, '-created_at');
  const priorRoutingEvidence = jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(priorReview?.summary, {}).routingEvidence, {});
  const draft = buildContentBatchPlan({
    goalId: input.goal.id,
    goal: goalInput(input.goal),
    config: input.config,
    evidence: await contentRoutingEvidence(input.tenantId, input.config),
    versions: {
      configVersion: Number(planBody.configVersion || 1),
      policyVersion: String(planBody.policyVersion || 'unknown'),
      factsVersion: String(knowledgeBinding.factsVersion || 'unknown'),
    },
    priorRoutingEvidence: {
      priorRouteDistribution: jsonObject(priorRoutingEvidence.priorRouteDistribution, {}),
      approvalFeedback: jsonObject(priorRoutingEvidence.approvalFeedback, []),
    },
  });
  const now = new Date().toISOString();
  const record = await requiredCreate<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, {
    tenant_id: input.tenantId, goal_id: input.goal.id, plan_id: input.run.plan_id, run_id: input.run.id, task_id: input.task.id,
    status: draft.status, orders: draft.orders, routing: { blocker: draft.blocker, eligibleRoutes: draft.eligibleRoutes, disabledRoutes: draft.disabledRoutes },
    config_version: Number(planBody.configVersion || 1), policy_version: String(planBody.policyVersion || 'unknown'), facts_version: String(knowledgeBinding.factsVersion || 'unknown'),
    created_at: now, updated_at: now,
  });
  return { record, created: true, draft };
}

function sendEvent(response: Response, event: EventRecord): void {
  response.write(`id: ${event.sequence}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function publicEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicEventPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => {
      const normalized = key.toLowerCase();
      return !['thought', 'thoughts', 'reasoning', 'chain_of_thought'].includes(normalized)
        && !/(thought|reasoning|chain.?of.?thought)/i.test(key);
    })
    .map(([key, item]) => [key, publicEventPayload(item)]));
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

function availableTaskActions(task: TaskRecord): string[] {
  if (task.status === 'handed_off') return ['return_to_agent'];
  if (['succeeded', 'skipped', 'cancelled'].includes(task.status)) return ['replan'];
  const actions = ['retry', 'skip', 'manual_complete', 'handoff', 'replan'];
  if (['platform_publish', 'followup_dispatch'].includes(task.task_key)) {
    return actions.filter(action => action !== 'manual_complete');
  }
  return actions;
}

function runReviewSummary(run: RunRecord, tasks: TaskRecord[], businessSnapshot: BusinessSnapshot) {
  const statusCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
    return counts;
  }, {});
  const terminalCount = Number(statusCounts.succeeded || 0) + Number(statusCounts.skipped || 0);
  const byKey = new Map(tasks.map(task => [task.task_key, task]));
  const blockedTasks = tasks
    .map(task => {
      const waitingOn = jsonObject<string[]>(task.depends_on, []).filter(key => {
        const upstream = byKey.get(key);
        return !upstream || !['succeeded', 'skipped'].includes(upstream.status);
      });
      if (!['waiting_external', 'waiting_approval', 'handed_off', 'failed'].includes(task.status) && !(task.status === 'pending' && waitingOn.length)) return null;
      return {
        taskId: task.id,
        taskKey: task.task_key,
        title: task.title,
        status: task.status,
        reason: task.blocked_reason || (waitingOn.length ? `等待上游：${waitingOn.join('、')}` : '等待外部事实回写'),
        destination: task.destination || 'digitalEmployees',
        destinationView: task.destination_view || '',
        availableActions: availableTaskActions(task),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    runId: run.id,
    runStatus: run.status,
    isLive: !['succeeded', 'failed', 'cancelled'].includes(run.status),
    generatedAt: businessSnapshot.generatedAt,
    totalTasks: tasks.length,
    completedTasks: Number(statusCounts.succeeded || 0),
    skippedTasks: Number(statusCounts.skipped || 0),
    completionRate: tasks.length ? Math.round((terminalCount / tasks.length) * 100) : 0,
    statusCounts,
    blockedTasks,
    blockedReasons: [...new Set(blockedTasks.map(item => item.reason))],
    businessSnapshot,
    dataGaps: businessSnapshot.dataGaps,
    sourceStatus: 'real_business_aggregation',
  };
}

function missingGoalResources(config: DigitalEmployeeConfig, snapshot: BusinessSnapshot) {
  const enabled = new Set(config.enabledWorkflows);
  const required = new Set<BusinessSnapshot['readiness'][number]['key']>(['enterprise']);
  if (enabled.has('content_publish')) {
    required.add('social_accounts');
    if (!enabled.has('viral_clone') && !enabled.has('product_content') && !enabled.has('material_content')) required.add('content_projects');
  }
  // New tenants often start without products, reusable materials, viral evidence,
  // or customers. Those are task-level knowledge gaps: eligible content routes
  // are rebalanced and inbound customer service stays available while the
  // blocked branch points the operator to the exact place that needs evidence.
  // Do not reject the whole weekly goal before those acquisition tasks can run.
  return snapshot.readiness.filter(item => required.has(item.key) && item.status !== 'ready');
}

async function buildOverview(tenantId: string, requestedGoalId = '', requestedRange?: { startsAt: string; endsAt: string }) {
  const [configRecord, goalResult] = await Promise.all([
    configForTenant(tenantId),
    store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId }, sort: '-created_at', page: 1, perPage: 20 }),
  ]);
  const goal = requestedGoalId
    ? goalResult.items.find(item => item.id === requestedGoalId) ?? null
    : goalResult.items.find(item => ['active', 'paused'].includes(item.status)) ?? goalResult.items[0] ?? null;
  const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
  if (!goal) {
    const businessSnapshot = await buildBusinessSnapshot(tenantId, requestedRange);
    return { config: resolvedConfiguration?.config || null, configuration: publicConfigurationMetadata(resolvedConfiguration), goals: [], goal: null, plan: null, run: null, tasks: [], events: [], approvals: [], handoffs: [], review: null, liveReview: null, agents: [], businessSnapshot };
  }
  const [plan, run, businessSnapshot] = await Promise.all([
    first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
    first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at'),
    buildBusinessSnapshot(tenantId, requestedRange || { startsAt: goal.starts_at, endsAt: goal.ends_at }),
  ]);
  const runId = run?.id || '';
  const [tasks, events, approvals, handoffs, review] = runId ? await Promise.all([
    store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: runId }, sort: 'sequence', perPage: 100 }),
    store.list<EventRecord>(COLLECTION.events, { where: { tenant_id: tenantId, run_id: runId }, sort: 'sequence', perPage: 500 }),
    store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: runId }, sort: '-created_at', perPage: 100 }),
    store.list<HandoffRecord>(COLLECTION.handoffs, { where: { tenant_id: tenantId, run_id: runId }, sort: '-started_at', perPage: 100 }),
    first<StoredRecord & { tenant_id: string; run_id: string; summary: unknown; status: string; created_at: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: runId }),
  ]) : [null, null, null, null, null] as const;
  const taskItems = tasks?.items || [];
  const normalizedTasks = taskItems.map(task => ({ ...task, agent_role: visibleAgentRole(task.agent_role, task.task_key) }));
  const agents = (['business', 'industry', 'content', 'customer'] as const).filter(role => normalizedTasks.some(task => task.agent_role === role)).map(role => {
    const agentTasks = normalizedTasks.filter(task => task.agent_role === role);
    const active = agentTasks.find(task => ['running', 'waiting_external', 'waiting_approval', 'handed_off'].includes(task.status));
    return {
      role,
      status: active?.status || (agentTasks.every(task => ['succeeded', 'skipped'].includes(task.status)) ? 'completed' : 'idle'),
      currentTask: active?.title || '',
      completed: agentTasks.filter(task => task.status === 'succeeded').length,
      total: agentTasks.length,
    };
  });
  const deliveryData = await buildDeliveryResources(tenantId, normalizedTasks.map(task => ({ ...task, business_refs: jsonObject(task.business_refs, []), depends_on: jsonObject(task.depends_on, []), output: jsonObject(task.output, {}) })) as WorkflowTask[], goal.title)
    .then(deliveries => ({ deliveries, deliveryNotice: '' }))
    .catch(() => ({ deliveries: undefined, deliveryNotice: '业务产物暂时无法读取，当前展示任务记录。请刷新重试。' }));
  return {
    config: resolvedConfiguration?.config || null,
    configuration: publicConfigurationMetadata(resolvedConfiguration),
    goals: goalResult.items.map(publicGoal),
    goal: publicGoal(goal),
    plan: plan ? { id: plan.id, status: plan.status, ...jsonObject<Record<string, unknown>>(plan.plan, {}) } : null,
    run,
    tasks: normalizedTasks.map(task => ({ ...task, depends_on: jsonObject(task.depends_on, []), output: jsonObject(task.output, {}) })),
    ...deliveryData,
    events: events?.items.map(event => ({ ...event, payload: jsonObject(event.payload, {}) })) || [],
    approvals: approvals?.items.map(approval => ({ ...approval, evidence: jsonObject(approval.evidence, {}) })) || [],
    handoffs: handoffs?.items.map(handoff => ({ ...handoff, snapshot: jsonObject(handoff.snapshot, {}) })) || [],
    review: review ? { ...review, summary: jsonObject(review.summary, {}) } : null,
    liveReview: run ? runReviewSummary(run, taskItems, businessSnapshot) : null,
    agents,
    businessSnapshot,
  };
}

type ApprovalPreflight = {
  ready: boolean;
  reason: string;
  checks: Array<{ key: string; ready: boolean; detail: string }>;
  businessRefs: Array<Record<string, unknown>>;
};

function dependenciesReady(task: TaskRecord, tasks: TaskRecord[]): boolean {
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
    const scope = taskScope(task, tasks);
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    const completed = projects.items.filter(item => recordBelongsToTask(item, run, scope) && studioProjectCompleted(item));
    const social = snapshot.readiness.find(item => item.key === 'social_accounts');
    checks.push(
      { key: 'approved_content_scope', ready: completed.length > 0, detail: completed.length ? `已关联 ${completed.length} 个当前运行的完成作品` : '当前运行尚未关联已完成作品' },
      { key: 'social_accounts', ready: social?.status === 'ready', detail: social?.note || '尚未连接发布账号' },
    );
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
    if (goal) {
      const publishingPackage = await publishingApprovalPackage(tenantId, goal, run, task, tasks);
      const connectedAccounts = await listConnectedPublishingAccounts(tenantId);
      const connectedIds = new Set(connectedAccounts.map(account => account.accountId));
      const packageAccountIds = [...new Set(publishingPackage.items.flatMap(item => item.accountIds))];
      checks.push({
        key: 'publishable_outputs',
        ready: publishingPackage.items.length > 0,
        detail: publishingPackage.items.length ? `待审批发布项 ${publishingPackage.items.length} 条` : '完成作品尚缺可发布成片文件',
      });
      checks.push({
        key: 'selected_publishing_accounts',
        ready: packageAccountIds.length > 0 && packageAccountIds.every(accountId => connectedIds.has(accountId)),
        detail: packageAccountIds.length && packageAccountIds.every(accountId => connectedIds.has(accountId)) ? `已核验 ${packageAccountIds.length} 个本期发布账号` : '本期选择的发布账号已断开或不再属于当前企业',
      });
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
  return {
    ready: failed.length === 0,
    reason: failed.length ? `审批前资源预检未通过：${failed.map(check => check.detail).join('；')}` : '',
    checks,
    businessRefs,
  };
}

async function createApproval(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord, allTasks: TaskRecord[]): Promise<ApprovalRecord> {
  const existing = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, task_id: task.id });
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
  if (!existing) {
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
  const existing = await first<StoredRecord & { tenant_id: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: run.id });
  const [approvals, handoffs, businessSnapshot, batchPlans, projects, posts] = await Promise.all([
    store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
    store.list<HandoffRecord>(COLLECTION.handoffs, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
    buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at }),
    store.list<ContentBatchPlanRecord>(COLLECTION.contentBatchPlans, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 20 }),
    store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 }),
    store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 }),
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
  const contentFeedback = summarizeContentFeedback({
    orders: batchPlans.items.flatMap(item => jsonObject(item.orders, [])),
    projects: projects.items.filter(item => recordBelongsToTask(item, run, reviewScope)),
    approvals: approvals.items.filter(approval => contentApprovalTaskIds.has(String(approval.task_id || ''))),
    posts: posts.items.filter(item => recordBelongsToTask(item, run, reviewScope)),
  });
  const summary = {
    ...taskReview,
    ...runReviewSummary(reviewRun, tasks, businessSnapshot),
    contentPerformance: contentFeedback.items,
    approvalFeedback: contentFeedback.approvalFeedback,
    nextPlanRecommendations: contentFeedback.nextPlanRecommendations,
    routingEvidence: { priorRouteDistribution: contentFeedback.routeCounts, approvalFeedback: contentFeedback.approvalFeedback },
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

type TaskExecutionMetadata = {
  businessDomain: string;
  capabilityKey: string;
  destination: string;
  destinationView: string;
  statusSource: string;
  executionMode: 'internal' | 'observe' | 'draft_executor' | 'approval';
  externalEffect: string;
  automaticExecutionAllowed: boolean;
  policySource: string;
};

function taskExecutionMetadata(task: TaskRecord, plan: PlanRecord | null): TaskExecutionMetadata {
  const planBody = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
  const planTasks = Array.isArray(planBody.tasks) ? planBody.tasks as Array<Record<string, unknown>> : [];
  const planned = planTasks.find(item => String(item.key || '') === task.task_key) || {};
  const inferredMode: TaskExecutionMetadata['executionMode'] = task.kind === 'approval' ? 'approval' : 'internal';
  const candidateMode = String(task.execution_mode || planned.executionMode || inferredMode);
  return {
    businessDomain: String(task.business_domain || planned.businessDomain || ''),
    capabilityKey: String(task.capability_key || planned.capabilityKey || ''),
    destination: String(task.destination || planned.destination || 'digitalEmployees'),
    destinationView: String(task.destination_view || planned.destinationView || ''),
    statusSource: String(task.status_source || planned.statusSource || ''),
    executionMode: ['internal', 'observe', 'draft_executor', 'approval'].includes(candidateMode) ? candidateMode as TaskExecutionMetadata['executionMode'] : inferredMode,
    externalEffect: String(task.external_effect || planned.externalEffect || 'none'),
    automaticExecutionAllowed: typeof task.automatic_execution_allowed === 'boolean'
      ? task.automatic_execution_allowed
      : planned.automaticExecutionAllowed !== false,
    policySource: String(task.policy_source || planned.policySource || 'legacy_default'),
  };
}

function hasSucceededApprovalAncestor(task: TaskRecord, tasks: TaskRecord[]): boolean {
  const byKey = new Map(tasks.map(item => [item.task_key, item]));
  const pending = [...jsonObject<string[]>(task.depends_on, [])];
  const visited = new Set<string>();
  while (pending.length) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const ancestor = byKey.get(key);
    if (!ancestor) continue;
    if (ancestor.kind === 'approval' && ancestor.status === 'succeeded') return true;
    pending.push(...jsonObject<string[]>(ancestor.depends_on, []));
  }
  return false;
}

function destinationLabel(destination: string): string {
  return ({
    enterprise: '企业资料',
    scheduled: '定时任务',
    socialInspiration: '灵感中心',
    scriptLibrary: '脚本库',
    smartAssets: '内容创作',
    conversion: '客户经营',
    digitalEmployees: '数字员工',
  } as Record<string, string>)[destination] || '对应业务工作台';
}

function taskScope(task: TaskRecord, tasks: TaskRecord[]): { taskIds: Set<string>; refIds: Set<string> } {
  const taskIds = new Set([task.id]);
  const keys = new Set([task.task_key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of tasks) {
      if (!keys.has(candidate.task_key)) continue;
      for (const dependency of jsonObject<string[]>(candidate.depends_on, [])) {
        if (!keys.has(dependency)) { keys.add(dependency); changed = true; }
      }
    }
  }
  for (const candidate of tasks.filter(item => keys.has(item.task_key))) taskIds.add(candidate.id);
  const refIds = new Set<string>();
  for (const candidate of tasks.filter(item => taskIds.has(item.id))) {
    for (const ref of jsonObject<Array<Record<string, unknown>>>(candidate.business_refs, [])) {
      for (const value of [ref.id, ref.recordId, ref.entityId, ref.taskId]) {
        const id = String(value || '').trim();
        if (id) refIds.add(id);
      }
    }
  }
  return { taskIds, refIds };
}

function scopedValues(record: StoredRecord, keys: string[]): string[] {
  const containers = [
    record,
    jsonObject<Record<string, unknown>>(record.config, {}),
    jsonObject<Record<string, unknown>>(record.metadata, {}),
    jsonObject<Record<string, unknown>>(record.stats, {}),
    jsonObject<Record<string, unknown>>(record.spec, {}),
    jsonObject<Record<string, unknown>>(record.business_ref, {}),
  ];
  return [...new Set(containers.flatMap(container => keys.map(key => String(container[key] || '').trim()).filter(Boolean)))];
}

function recordBelongsToTask(record: StoredRecord, run: RunRecord, scope: { taskIds: Set<string>; refIds: Set<string> }): boolean {
  const recordIds = [record.id, record.task_id, record.taskId, record.entity_id].map(value => String(value || '').trim()).filter(Boolean);
  if (recordIds.some(id => scope.refIds.has(id))) return true;
  const runIds = scopedValues(record, ['workflowRunId', 'workflow_run_id', 'runId', 'run_id', 'digitalEmployeeRunId']);
  const taskIds = scopedValues(record, ['workflowTaskId', 'workflow_task_id', 'taskId', 'task_id', 'digitalEmployeeTaskId']);
  if (!runIds.includes(run.id)) return false;
  return taskIds.some(id => scope.taskIds.has(id));
}

function scopedProof(metricKey: string, source: string, records: StoredRecord[], refs: Array<Record<string, unknown>>, tenantValue: number | null) {
  return {
    ready: records.length > 0,
    proof: {
      metricKey,
      value: records.length,
      status: records.length ? 'available' : 'pending',
      source,
      scope: 'workflow_run_and_task',
      tenantSnapshotValue: tenantValue,
    },
    businessRefs: refs,
  };
}

function exactVideoAnalysis(record: StoredRecord): boolean {
  const analysis = jsonObject<Record<string, unknown>>(record.aiAnalysis, {});
  return analysis.analysisMode === 'exact' && analysis.analysisQuality === 'video' && Boolean(analysis.gemini);
}

function studioProjectCompleted(record: StoredRecord): boolean {
  const spec = jsonObject<Record<string, unknown>>(record.spec, {});
  const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
  if (automation.managedBy === 'digital_employee') {
    return record.status === 'ready_for_approval' && automation.stage === 'completed' && jsonObject<Record<string, unknown>>(automation.quality, {}).passed === true;
  }
  return ['completed', 'published'].includes(String(record.status || spec.status || ''));
}

function studioProjectRendered(record: StoredRecord): boolean {
  const spec = jsonObject<Record<string, unknown>>(record.spec, {});
  const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
  if (automation.managedBy !== 'digital_employee') return studioProjectCompleted(record);
  const outputPath = String(automation.renderOutputPath || spec.renderOutputPath || '').trim();
  return Boolean(outputPath && automation.stage === 'completed' && jsonObject<Record<string, unknown>>(automation.quality, {}).passed === true);
}

async function publishingApprovalPackage(
  tenantId: string,
  goal: GoalRecord,
  run: RunRecord,
  task: TaskRecord,
  tasks: TaskRecord[],
  scheduleAnchor = run.started_at,
): Promise<PublishingApprovalPackage> {
  const [plan, configRecord, projects] = await Promise.all([
    tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
    configForTenant(tenantId),
    store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 }),
  ]);
  const currentConfig = publicConfig(configRecord);
  if (!currentConfig) throw new Error('publishing_config_missing');
  const config = configSnapshotForPlan(plan, currentConfig);
  const scope = taskScope(task, tasks);
  const completed = projects.items.filter(item => recordBelongsToTask(item, run, scope) && studioProjectCompleted(item));
  return buildPublishingApprovalPackage({
    projects: completed,
    targets: config.publishingTargets,
    goalPlatforms: goalInput(goal).contentPlatforms,
    allowRealPublishing: config.allowRealPublishing,
    now: new Date(scheduleAnchor),
  });
}

async function observeTaskProof(tenantId: string, run: RunRecord, task: TaskRecord, snapshot: BusinessSnapshot, tasks: TaskRecord[]) {
  const scope = taskScope(task, tasks);
  if (task.task_key === 'scheduled_source_collection') {
    const scheduled = await store.list<StoredRecord>('scheduled_tasks', {
      where: { tenant_id: tenantId }, perPage: 500,
    });
    const matching = scheduled.items.filter(item => {
      const config = jsonObject<Record<string, unknown>>(item.config, {});
      return String(config.workflowTaskId || '') === task.id && item.enabled !== false;
    });
    const persistedRefs = jsonObject<Array<Record<string, unknown>>>(task.business_refs, [])
      .filter(ref => ref.type === 'scheduled_task');
    const businessRefs = matching.length
      ? matching.map(item => ({ type: 'scheduled_task', id: String(item.task_id || item.id), recordId: item.id }))
      : persistedRefs;
    return {
      ready: businessRefs.length > 0,
      proof: { metricKey: 'scheduledAutomations', value: businessRefs.length, status: businessRefs.length ? 'available' : snapshot.content.scheduledAutomations.status, source: 'scheduled_tasks.config.workflowTaskId + workflow_tasks.business_refs', scope: 'workflow_task' },
      businessRefs,
    };
  }
  if (task.task_key === 'viral_analysis') {
    const videos = await store.list<StoredRecord>('trend_videos', { where: { tenantId }, perPage: 500 });
    const matching = videos.items.filter(item => recordBelongsToTask(item, run, scope) && exactVideoAnalysis(item));
    return scopedProof('exactAnalyses', 'trend_videos.aiAnalysis + workflow scope', matching, matching.map(item => ({ type: 'trend_video', id: item.id })), snapshot.content.exactAnalyses.value);
  }
  if (task.task_key === 'content_production' || task.task_key === 'content_quality_gate') {
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    const scoped = projects.items.filter(item => recordBelongsToTask(item, run, scope));
    const persistedGaps = jsonObject<Array<Record<string, unknown>>>(task.business_refs, []).filter(ref => ref.type === 'knowledge_gap');
    if (!scoped.length && persistedGaps.length) {
      return {
        ready: false,
        proof: { metricKey: 'contentKnowledgeGaps', value: persistedGaps.length, status: 'blocked', source: 'workflow_tasks.business_refs', scope: 'workflow_task' },
        businessRefs: persistedGaps,
        blockedReason: `内容生产资料待补齐：${persistedGaps.map(ref => String(ref.label || ref.key || '')).filter(Boolean).join('；')}`,
      };
    }
    const matching = task.task_key === 'content_quality_gate' ? scoped.filter(studioProjectCompleted) : scoped.filter(studioProjectRendered);
    const result = scopedProof(
      task.task_key === 'content_quality_gate' ? 'completedWorks' : 'contentProjects',
      task.task_key === 'content_quality_gate' ? 'studio_projects.spec.automation.quality + workflow scope' : 'studio_projects.spec.automation.renderOutputPath + workflow scope',
      matching,
      matching.map(item => ({
        type: 'studio_project', id: item.id, status: String(item.status || ''),
        stage: String(jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(item.spec, {}).automation, {}).stage || ''),
      })),
      task.task_key === 'content_quality_gate' ? snapshot.content.completedWorks.value : snapshot.content.contentProjects.value,
    );
    result.ready = scoped.length > 0 && matching.length === scoped.length;
    result.proof = { ...result.proof, value: matching.length, status: result.ready ? 'available' : 'pending' };
    const blocker = scoped.map(item => String(jsonObject<Record<string, unknown>>(jsonObject<Record<string, unknown>>(item.spec, {}).automation, {}).blocker || '').trim()).find(Boolean) || '';
    return { ...result, blockedReason: blocker };
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
    const matching = posts.items.filter(item => recordBelongsToTask(item, run, scope) && postHasPublishedReceipt(item));
    return scopedProof('publishedPosts', 'posts.platform_post_id + publishResults + workflow scope', matching, matching.map(item => ({ type: 'post', id: item.id, receipt: true })), snapshot.content.publishedPosts.value);
  }
  if (task.task_key === 'customer_attribution') {
    const posts = await store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 });
    const scopedPosts = posts.items.filter(item => recordBelongsToTask(item, run, scope));
    const postIds = new Set(scopedPosts.map(item => item.id));
    const trackCodes = new Set(scopedPosts.map(item => String(item.track_code || item.trackCode || '')).filter(Boolean));
    const customers = getWhatsAppCustomers(tenantId) as Array<Record<string, unknown>>;
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
    let sent = 0;
    const refs: Array<Record<string, unknown>> = [];
    for (const batch of batches.items) {
      const items = await getFollowupBatchItems(tenantId, batch.id);
      const delivered = items.filter(item => ['sent', 'delivered', 'read', 'partial_sent'].includes(item.status) && Boolean(item.provider_message_id));
      sent += delivered.length;
      refs.push(...delivered.map(item => ({ type: 'followup_receipt', batchId: batch.id, itemId: item.id, providerMessageId: item.provider_message_id })));
    }
    const currentBatch = [...batches.items]
      .filter(batch => !['superseded', 'cancelled'].includes(batch.status))
      .sort((left, right) => Number(right.version || 0) - Number(left.version || 0))[0];
    const dispatchPreflight = currentBatch
      ? await preflightFollowupBatchDispatch(tenantId, currentBatch.id, { mode: 'scheduled' })
      : null;
    return {
      ready: snapshot.customer.outreachSent.status === 'available' && sent > 0,
      proof: { metricKey: 'outreachSent', value: sent, status: snapshot.customer.outreachSent.status, source: 'followup_batch_items.provider_receipt' },
      businessRefs: refs,
      dispatchPreflight,
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
  const { tenantId, goal, run, task, config, snapshot } = input;
  const actorId = goal.owner_id || 'digital_employee_agent';
  if (task.task_key === 'scheduled_source_collection') {
    const collectionSchedule = socialScheduleFromCadence(config.socialCadence);
    const ensured = ensureDigitalEmployeeSocialCollectionTask({
      tenantId,
      workflowRunId: run.id,
      workflowTaskId: task.id,
      keywords: config.focusProducts || goalInput(goal).scope || config.primaryBusiness,
      cronExpr: collectionSchedule.cronExpr,
      cronLabel: collectionSchedule.cronLabel,
      platforms: collectionSchedule.platforms,
      limit: collectionSchedule.limit,
      dateWindowDays: collectionSchedule.dateWindowDays,
      dedupeWindowDays: collectionSchedule.dedupeWindowDays,
    });
    const refs = [{ type: 'scheduled_task', id: ensured.task.id, taskType: ensured.task.taskType, cronExpr: ensured.task.cronExpr }];
    await store.update(COLLECTION.tasks, task.id, { business_refs: refs, updated_at: new Date().toISOString() });
    task.business_refs = refs;
    if (ensured.created || ensured.updated) {
      const action = ensured.created ? 'created' : 'updated';
      await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: `business.resource.${action}`, level: 'success', summary: `已${ensured.created ? '创建' : '更新'}社媒内容采集计划：${ensured.task.cronLabel}`, payload: { businessRefs: refs, schedule: collectionSchedule, externalPublishPerformed: false } });
      await appendAudit({ tenantId, userId: actorId, action: `digital_employee.scheduler.${action}`, targetType: 'scheduled_task', targetId: ensured.task.id, metadata: { runId: run.id, taskId: task.id, schedule: collectionSchedule } });
    }
    if (ensured.created || ensured.updated || !ensured.task.lastRun) {
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
      } catch (error) {
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'business.resource.first_run_failed', level: 'warning', summary: '定时采集已创建，首轮执行未成功', payload: { error: error instanceof Error ? error.message : 'scheduled_first_run_failed' } });
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
    const dueSlot = latestDueReviewSlot(followupSchedule.draft);
    const dueDate = beijingDate(dueSlot);
    const startedAt = Date.parse(run.started_at || '');
    if (!Number.isFinite(startedAt) || dueSlot.getTime() < startedAt || dueDate < goal.starts_at || dueDate > goal.ends_at) return false;
    const result = await createCustomerSegmentSnapshot({
      tenantId,
      goalId: goal.id,
      runId: run.id,
      taskId: task.id,
      userId: actorId,
      criteria: DEFAULT_FOLLOWUP_SEGMENT_CRITERIA,
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

async function advanceRun(tenantId: string, runId: string): Promise<void> {
  await withDigitalEmployeeRunLock(tenantId, runId, () => advanceRunUnlocked(tenantId, runId));
}

/** Trusted backend entry point. Ownership is re-checked inside advanceRunUnlocked. */
export async function reconcileDigitalEmployeeRun(tenantId: string, runId: string): Promise<void> {
  await advanceRun(tenantId, runId);
}

async function advanceRunUnlocked(tenantId: string, runId: string): Promise<void> {
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, runId, tenantId);
  if (!run || ['paused', 'cancelled', 'failed', 'succeeded', 'waiting_human'].includes(run.status)) return;
  const [goal, configRecord, plan, taskResult] = await Promise.all([
    tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId),
    configForTenant(tenantId),
    tenantRecord<PlanRecord>(COLLECTION.plans, run.plan_id, tenantId),
    store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 }),
  ]);
  const tenantConfig = publicConfig(configRecord);
  if (!goal || !tenantConfig) throw new Error('run_context_missing');
  const config = configSnapshotForPlan(plan, tenantConfig);

  await store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', pause_reason: '' });
  let businessSnapshot: BusinessSnapshot | null = null;
  for (const task of taskResult.items) {
    if (['succeeded', 'skipped', 'cancelled', 'handed_off', 'failed'].includes(task.status)) continue;
    if (!dependenciesReady(task, taskResult.items)) continue;
    const metadata = taskExecutionMetadata(task, plan);
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
        availableActions: availableTaskActions(task),
      };
      await store.update(COLLECTION.tasks, task.id, { status: 'waiting_external', output, blocked_reason: reason, updated_at: new Date().toISOString() });
      if (task.status !== 'waiting_external' || task.blocked_reason !== reason) {
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'policy.autonomy_blocked', level: 'warning', summary: `${task.title}：${reason}`, payload: { autonomyMode: config.autonomyMode, externalEffect: metadata.externalEffect, policySource: metadata.policySource } });
      }
      task.status = 'waiting_external';
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
          availableActions: availableTaskActions(task),
        };
        await store.update(COLLECTION.tasks, task.id, {
          status: 'waiting_external', output, business_refs: preflight.businessRefs, blocked_reason: preflight.reason, updated_at: new Date().toISOString(),
        });
        if (task.status !== 'waiting_external' || task.blocked_reason !== preflight.reason) {
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.preflight_blocked', level: 'warning', summary: `${task.title}：${preflight.reason}`, payload: { checks: preflight.checks, businessRefs: preflight.businessRefs, destination: metadata.destination } });
        }
        task.status = 'waiting_external';
        task.output = output;
        task.business_refs = preflight.businessRefs;
        task.blocked_reason = preflight.reason;
        continue;
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
      const createdResource = metadata.executionMode === 'draft_executor'
        ? await prepareObserveBusinessResource({ tenantId, goal, run, task, config, snapshot: businessSnapshot })
        : await prepareObserveBusinessResource({ tenantId, goal, run, task, config, snapshot: businessSnapshot });
      if (createdResource) businessSnapshot = await buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
      const observation = await observeTaskProof(tenantId, run, task, businessSnapshot, taskResult.items);
      const canonicalBusinessRefs = observation.businessRefs.length
        ? observation.businessRefs
        : jsonObject<Record<string, unknown>[]>(task.business_refs, []);
      const baseOutput = buildTaskOutput(task.task_key, goalInput(goal), config);
      const followupWorker = task.task_key === 'followup_dispatch'
        ? await getTenantFollowupDispatchStatus(tenantId)
        : null;
      const followupWorkerMode = followupWorker?.authorization.scheduledFollowupSendAllowed ? 'scheduled' : 'manual_only';
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
        const observedBlocker = 'blockedReason' in observation ? String(observation.blockedReason || '').trim() : '';
        const blockedReason = observedBlocker || (task.task_key === 'customer_segmentation'
          ? `等待客户跟进节奏到期：${config.followupCadence}`
          : task.task_key === 'followup_dispatch'
          ? '真实发送预检：尚未取得可核验的发送条件或渠道回执'
          : `等待真实业务结果，请前往「${destinationLabel(metadata.destination)}」完成或检查该节点`);
        await Promise.all([
          store.update(COLLECTION.tasks, task.id, { status: 'waiting_external', output, business_refs: canonicalBusinessRefs, blocked_reason: blockedReason, updated_at: new Date().toISOString() }),
          store.update(COLLECTION.runs, run.id, { status: 'waiting_external', current_controller: 'agent', pause_reason: blockedReason }),
        ]);
        if (task.status !== 'waiting_external') {
          await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.waiting_external', level: 'warning', summary: `${task.title}：等待业务工作台真实回写`, payload: { destination: metadata.destination, statusSource: metadata.statusSource, proof: observation.proof, businessRefs: canonicalBusinessRefs } });
        }
        task.status = 'waiting_external';
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
      const batch = await ensureContentBatchPlan({ tenantId, goal, run, task, plan, config });
      const refs = [{ type: 'content_batch_plan', id: batch.record.id, orderCount: batch.draft.orders.length }, ...batch.draft.orders.map(order => ({ type: 'content_order', id: order.id, batchPlanId: batch.record.id, route: order.route, platform: order.platform, productId: order.productId }))];
      const output = { ...buildTaskOutput(task.task_key, goalInput(goal), config), batchPlanId: batch.record.id, orders: batch.draft.orders, routing: { eligibleRoutes: batch.draft.eligibleRoutes, disabledRoutes: batch.draft.disabledRoutes }, dataStatus: batch.draft.status };
      if (batch.draft.status === 'blocked') {
        await Promise.all([
          store.update(COLLECTION.tasks, task.id, { status: 'waiting_external', output, business_refs: refs, blocked_reason: batch.draft.blocker, updated_at: new Date().toISOString() }),
          store.update(COLLECTION.runs, run.id, { status: 'waiting_external', pause_reason: batch.draft.blocker }),
        ]);
        task.status = 'waiting_external'; task.output = output; task.business_refs = refs; task.blocked_reason = batch.draft.blocker;
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
  }

  const remaining = taskResult.items.filter(task => !['succeeded', 'skipped'].includes(task.status));
  if (remaining.length) {
    const handedOff = remaining.find(task => task.status === 'handed_off');
    const failed = remaining.find(task => task.status === 'failed');
    const waitingApproval = remaining.find(task => task.status === 'waiting_approval');
    const directBlocks = remaining.filter(task => ['waiting_external', 'waiting_approval', 'handed_off', 'failed', 'cancelled'].includes(task.status));
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
    const status = handedOff ? 'waiting_human' : failed ? 'failed' : waitingApproval ? 'waiting_approval' : 'waiting_external';
    await store.update(COLLECTION.runs, run.id, {
      status,
      current_controller: handedOff || waitingApproval ? 'human' : 'agent',
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

function downstreamTasks(tasks: TaskRecord[], current: TaskRecord, includeDownstream: boolean): TaskRecord[] {
  if (!includeDownstream) return [current];
  const selectedKeys = new Set([current.task_key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (selectedKeys.has(task.task_key)) continue;
      const dependencies = jsonObject<string[]>(task.depends_on, []);
      if (dependencies.some(key => selectedKeys.has(key))) {
        selectedKeys.add(task.task_key);
        changed = true;
      }
    }
  }
  return tasks.filter(task => selectedKeys.has(task.task_key)).sort((left, right) => left.sequence - right.sequence);
}

function outputHasExternalReceipt(task: TaskRecord): boolean {
  const output = jsonObject<Record<string, unknown>>(task.output, {});
  if (output.externalPublishPerformed === true || Number(output.messagesSent || 0) > 0) return true;
  const proof = jsonObject<Record<string, unknown>>(output.proof, {});
  if (task.task_key === 'platform_publish' && Number(proof.value || 0) > 0 && proof.status === 'available') return true;
  if (task.task_key === 'followup_dispatch' && Number(proof.value || 0) > 0 && proof.status === 'available') return true;
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (['platformPostId', 'platform_post_id', 'providerMessageId', 'provider_message_id'].some(key => Boolean(String(record[key] || '').trim()))) return true;
    if (Object.keys(jsonObject(record.providerReceipt, {})).length || Object.keys(jsonObject(record.provider_receipt, {})).length) return true;
    return Object.values(record).some(visit);
  };
  return visit(output);
}

function postHasPublishedReceipt(post: StoredRecord): boolean {
  if (String(post.platform_post_id || '').trim()) return true;
  const stats = jsonObject<Record<string, unknown>>(post.stats, {});
  if (['published', 'partial'].includes(String(stats.status || ''))) return true;
  const publishResults = stats.publishResults || post.publishResults;
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (['published', 'success', 'succeeded'].includes(String(record.status || '').toLowerCase())) return true;
    if (['platformPostId', 'platform_post_id'].some(key => Boolean(String(record[key] || '').trim()))) return true;
    return Object.values(record).some(visit);
  };
  return visit(publishResults);
}

async function irreversibleEffects(tenantId: string, run: RunRecord, affected: TaskRecord[]): Promise<Array<Record<string, unknown>>> {
  const effects: Array<Record<string, unknown>> = affected.filter(outputHasExternalReceipt).map(task => ({
    type: task.task_key === 'followup_dispatch' ? 'send_receipt' : 'publish_receipt',
    taskId: task.id,
    taskKey: task.task_key,
    businessRefs: jsonObject(task.business_refs, []),
  }));
  for (const task of affected) {
    if (effects.some(effect => effect.taskId === task.id) || task.status !== 'succeeded') continue;
    if (!['platform_publish', 'followup_dispatch'].includes(task.task_key)) continue;
    const externalEffect = String(task.external_effect || (task.task_key === 'platform_publish' ? 'publish' : 'send'));
    if (!['publish', 'send'].includes(externalEffect)) continue;
    const refs = jsonObject<unknown[]>(task.business_refs, []);
    if (!refs.length) effects.push({ type: 'conservative_external_effect_guard', taskId: task.id, taskKey: task.task_key, externalEffect });
  }
  if (affected.some(task => task.task_key === 'platform_publish')) {
    const [posts, allTasks] = await Promise.all([
      store.list<StoredRecord>('posts', { where: { tenant_id: tenantId }, perPage: 500 }),
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 }),
    ]);
    const publishTasks = affected.filter(task => task.task_key === 'platform_publish');
    const published = posts.items.filter(post => publishTasks.some(task => recordBelongsToTask(post, run, taskScope(task, allTasks.items))) && postHasPublishedReceipt(post));
    if (published.length) effects.push({ type: 'publish_receipt', source: 'posts.platform_post_id + stats.publishResults', postIds: published.slice(0, 20).map(post => post.id), count: published.length });
  }
  if (affected.some(task => task.task_key === 'followup_dispatch') && await followupRunHasExternalReceipt(tenantId, run.id)) {
    effects.push({ type: 'send_receipt', runId: run.id, source: 'followup_batch_items' });
  }
  return effects;
}

async function supersedeAffectedBusinessState(tenantId: string, run: RunRecord, affected: TaskRecord[], now: string): Promise<void> {
  const affectedIds = new Set(affected.map(task => task.id));
  const affectedKeys = new Set(affected.map(task => task.task_key));
  if (affectedKeys.has('content_production')) {
    const projects = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, perPage: 500 });
    for (const project of projects.items) {
      const spec = resumeContentProjectForTaskControl({ project, runId: run.id, affectedTaskIds: affectedIds, now });
      if (spec) await store.update('studio_projects', project.id, { spec, updated_at: now });
    }
  }
  if (affectedKeys.has('customer_segmentation')) {
    const segments = await store.list<StoredRecord>(COLLECTION.segments, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
    for (const segment of segments.items.filter(item => !['superseded', 'cancelled'].includes(String(item.status || '')))) {
      await store.update(COLLECTION.segments, segment.id, { status: 'superseded', updated_at: now });
    }
  }
  if (affectedKeys.has('followup_batch_draft')) {
    const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
    for (const batch of batches.items.filter(item => !['superseded', 'cancelled'].includes(item.status))) {
      await store.update(COLLECTION.followupBatches, batch.id, { status: 'superseded', updated_at: now });
      const items = await getFollowupBatchItems(tenantId, batch.id);
      for (const item of items.filter(entry => !['sent', 'delivered'].includes(entry.status))) {
        await store.update(COLLECTION.followupItems, item.id, { status: 'superseded', updated_at: now });
      }
    }
  } else if (affectedKeys.has('followup_batch_approval')) {
    const batches = await store.list<FollowupBatchRecord>(COLLECTION.followupBatches, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
    for (const batch of batches.items.filter(item => ['approved', 'rejected', 'pending_approval'].includes(item.status))) {
      await store.update(COLLECTION.followupBatches, batch.id, { status: 'draft', approval_id: '', approved_version: 0, approved_by: '', approved_at: '', updated_at: now });
      const items = await getFollowupBatchItems(tenantId, batch.id);
      for (const item of items.filter(entry => ['approved', 'rejected'].includes(entry.status))) {
        await store.update(COLLECTION.followupItems, item.id, { status: 'draft', approved_at: '', updated_at: now });
      }
    }
  }
  const approvals = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 500 });
  for (const approval of approvals.items.filter(item => affectedIds.has(item.task_id) && item.status !== 'superseded')) {
    await store.update(COLLECTION.approvals, approval.id, {
      status: 'superseded',
      decision_note: '任务纠偏后原审批版本失效',
      decided_at: now,
    });
  }
}

digitalEmployeesRouter.get('/overview', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const goalId = String(req.query.goalId || '').trim();
  if (goalId) {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, goalId, tenantId);
    if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
  }
  const startsAt = String(req.query.startsAt || '').trim();
  const endsAt = String(req.query.endsAt || '').trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const requestedRange = startsAt && endsAt && datePattern.test(startsAt) && datePattern.test(endsAt) && startsAt <= endsAt
    ? { startsAt, endsAt }
    : undefined;
  res.json(await buildOverview(tenantId, goalId, requestedRange));
});

digitalEmployeesRouter.post('/onboarding/complete', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const submittedConfig = normalizeDigitalEmployeeConfig(req.body || {});
  const boundPublishing = await bindPublishingTargets(tenantId, submittedConfig.publishingTargets);
  submittedConfig.publishingTargets = boundPublishing.targets;
  if (boundPublishing.invalidAccountIds.length) {
    res.status(409).json({
      error: 'publishing_accounts_invalid',
      message: '部分发布账号不属于当前企业或已断开连接，请重新选择。',
      invalidAccountIds: boundPublishing.invalidAccountIds,
    });
    return;
  }
  const existing = await configForTenant(tenantId);
  const now = new Date().toISOString();
  const enterprise = await readTenantEnterpriseProfile(tenantId);
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
  const enterprisePatch = {
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
  await appendAudit({ tenantId, userId, action: 'digital_employee.onboarding.completed', targetType: 'digital_employee_config', targetId: existing?.id || tenantId, metadata: { autonomyMode: resolved.config.autonomyMode, configVersion: resolved.configVersion, policyVersion: resolved.policyVersion, factsVersion: resolved.knowledgeBinding.factsVersion } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/goals', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const configRecord = await configForTenant(tenantId);
  const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
  const config = resolvedConfiguration?.config || null;
  if (!config || !resolvedConfiguration) { res.status(409).json({ error: 'onboarding_required' }); return; }
  const goal = normalizeWeeklyGoal(req.body || {}, config);
  const missing = validateWeeklyGoal(goal);
  if (missing.length) { res.status(400).json({ error: 'goal_invalid', missing }); return; }
  if (config.enabledWorkflows.includes('content_publish') && goal.businessLine !== 'customer_conversion') {
    const allowedPlatforms = new Set(publishingTargetPlatforms(config.publishingTargets));
    const invalidPlatforms = goal.contentPlatforms.filter(platform => !allowedPlatforms.has(platform));
    if (invalidPlatforms.length) {
      res.status(409).json({
        error: 'goal_publishing_targets_mismatch',
        message: '目标发布平台必须来自首次配置中已确认的发布账号。',
        invalidPlatforms,
        allowedPlatforms: [...allowedPlatforms],
      });
      return;
    }
  }
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
    scope: goal.scope,
    constraints: goal.constraints,
    owner_id: userId,
    status: 'draft',
    version: 1,
    created_at: now,
    updated_at: now,
  });
  const planDraft = buildWeeklyPlan(goal, config);
  const plan = await requiredCreate<PlanRecord>(COLLECTION.plans, {
    tenant_id: tenantId,
    goal_id: created.id,
    status: 'draft',
    plan: { ...planDraft, ...configurationSnapshot(resolvedConfiguration) },
    created_at: now,
  });
  await appendAudit({ tenantId, userId, action: 'weekly_goal.created', targetType: 'weekly_goal', targetId: created.id, metadata: { metric: goal.metric, target: goal.target, draftPlanId: plan.id } });
  res.status(201).json(await buildOverview(tenantId, created.id));
});

digitalEmployeesRouter.post('/goals/:goalId/approve', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  await withLocalQueue(goalApprovalQueues, `${tenantId}:activate`, async () => {
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
  if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
  const existingRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at');
  if (existingRun) { res.json(await buildOverview(tenantId, goal.id)); return; }
  const [configRecord, tenantGoals, tenantRuns, existingPlan] = await Promise.all([
    configForTenant(tenantId),
    store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId }, sort: '-created_at', perPage: 500 }),
    store.list<RunRecord>(COLLECTION.runs, { where: { tenant_id: tenantId }, sort: '-started_at', perPage: 500 }),
    first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
  ]);
  const overlappingGoal = tenantGoals.items.find(item => item.id !== goal.id && ['active', 'paused'].includes(item.status));
  const overlappingRun = tenantRuns.items.find(item => item.goal_id !== goal.id && !['succeeded', 'failed', 'cancelled'].includes(item.status));
  if (overlappingGoal || overlappingRun) {
    res.status(409).json({
      error: 'active_goal_exists',
      message: '当前租户已有活跃周目标，请先完成、暂停后取消，或明确结束现有运行。',
      activeGoalId: overlappingGoal?.id || overlappingRun?.goal_id || '',
      activeRunId: overlappingRun?.id || '',
    });
    return;
  }
  const resolvedConfiguration = await resolveCurrentConfiguration(tenantId, configRecord);
  const currentConfig = resolvedConfiguration?.config || null;
  if (!currentConfig || !resolvedConfiguration) { res.status(409).json({ error: 'onboarding_required' }); return; }
  // A draft goal owns the configuration snapshot captured when it was created.
  // Later Agent-setting edits apply only to a newly created goal.
  const config = configSnapshotForPlan(existingPlan, currentConfig);
  if (config.enabledWorkflows.includes('content_publish') && goalInput(goal).businessLine !== 'customer_conversion') {
    const boundPublishing = await bindPublishingTargets(tenantId, config.publishingTargets);
    const configuredIds = new Set(config.publishingTargets.map(target => target.accountId));
    if (boundPublishing.invalidAccountIds.length || boundPublishing.targets.length !== configuredIds.size) {
      res.status(409).json({
        error: 'publishing_accounts_invalid',
        message: '计划绑定的发布账号已断开或不再属于当前企业，请先更新 Agent 设置并重新制定目标。',
        invalidAccountIds: boundPublishing.invalidAccountIds,
      });
      return;
    }
    const allowedPlatforms = new Set(publishingTargetPlatforms(boundPublishing.targets));
    const goalPlatforms = goalInput(goal).contentPlatforms;
    const invalidPlatforms = goalPlatforms.filter(platform => !allowedPlatforms.has(platform));
    if (invalidPlatforms.length) {
      res.status(409).json({
        error: 'goal_publishing_targets_mismatch',
        message: '目标包含未绑定账号的平台，请重新制定本期目标。',
        invalidPlatforms,
        allowedPlatforms: [...allowedPlatforms],
      });
      return;
    }
  }
  const approvalSnapshot = await buildBusinessSnapshot(tenantId, { startsAt: goal.starts_at, endsAt: goal.ends_at });
  const missingResources = missingGoalResources(config, approvalSnapshot);
  if (missingResources.length) {
    res.status(409).json({
      error: 'missing_required_resources',
      message: '当前周计划依赖的真实业务资源尚未就绪，请补齐后再批准启动。',
      missing: missingResources.map(item => ({ key: item.key, label: item.label, page: item.page, note: item.note })),
    });
    return;
  }
  const planDraft = buildWeeklyPlan(goalInput(goal), config);
  const now = new Date().toISOString();
  await store.update(COLLECTION.goals, goal.id, { status: 'active', updated_at: now });
  const frozenPlanMetadata = existingPlan
    ? jsonObject<Record<string, unknown>>(existingPlan.plan, {})
    : configurationSnapshot(resolvedConfiguration);
  const approvedPlanBody = { ...frozenPlanMetadata, ...planDraft };
  let plan: PlanRecord;
  if (existingPlan) {
    const updated = await store.update(COLLECTION.plans, existingPlan.id, { status: 'approved', plan: approvedPlanBody });
    if (!updated) { res.status(503).json({ error: 'weekly_plan_storage_unavailable' }); return; }
    plan = { ...existingPlan, status: 'approved', plan: approvedPlanBody };
  } else {
    plan = await requiredCreate<PlanRecord>(COLLECTION.plans, {
      tenant_id: tenantId, goal_id: goal.id, status: 'approved', plan: approvedPlanBody, created_at: now,
    });
  }
  const run = await requiredCreate<RunRecord>(COLLECTION.runs, {
    tenant_id: tenantId,
    goal_id: goal.id,
    plan_id: plan.id,
    status: 'planning',
    current_controller: 'agent',
    pause_reason: '',
    started_at: now,
    completed_at: '',
  });
  for (const task of planDraft.tasks) {
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
      owner_id: '',
      business_domain: task.businessDomain,
      capability_key: task.capabilityKey,
      destination: task.destination,
      destination_view: task.destinationView || '',
      status_source: task.statusSource,
      execution_mode: task.executionMode,
      external_effect: task.externalEffect,
      automatic_execution_allowed: task.automaticExecutionAllowed,
      policy_source: task.policySource,
      business_refs: [],
      task_version: 1,
      correction_version: 0,
      created_at: now,
      updated_at: now,
    });
  }
  await appendEvent({ tenantId, runId: run.id, type: 'plan.generated', level: 'success', summary: `计划 Agent 已生成 ${planDraft.tasks.length} 个任务`, payload: { strategy: planDraft.strategy } });
  await appendEvent({ tenantId, runId: run.id, type: 'workflow.started', summary: '数字员工已开始执行本周计划' });
  await appendAudit({ tenantId, userId, action: 'weekly_goal.approved', targetType: 'weekly_goal', targetId: goal.id, metadata: { planId: plan.id, runId: run.id } });
  await advanceRun(tenantId, run.id);
  res.json(await buildOverview(tenantId, goal.id));
  });
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
    const result = await createFollowupBatch({
      tenantId,
      goalId: goal.id,
      runId: run.id,
      taskId: task.id,
      segmentId: segment.id,
      userId,
      name: String(req.body?.name || '').trim().slice(0, 200),
      idempotent: false,
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

digitalEmployeesRouter.get('/followup-batches/:batchId', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const batch = await getFollowupBatch(tenantId, req.params.batchId);
  if (!batch) { res.status(404).json({ error: 'followup_batch_not_found' }); return; }
  const items = await getFollowupBatchItems(tenantId, batch.id);
  res.json({
    batch: { ...batch, delivery_policy: jsonObject(batch.delivery_policy, {}), safety_summary: jsonObject(batch.safety_summary, {}), counts: jsonObject(batch.counts, {}) },
    items: items.map(item => ({ ...item, provider_receipt: jsonObject(item.provider_receipt, {}) })),
    bulkWorkerStatus: await getTenantFollowupDispatchStatus(tenantId),
    messagesSent: items.filter(item => ['sent', 'delivered', 'read', 'partial_sent'].includes(item.status) && Boolean(item.provider_message_id)).length,
  });
});

digitalEmployeesRouter.get('/followup-worker/status', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(await getTenantFollowupDispatchStatus(tenantId));
});

digitalEmployeesRouter.get('/followup-batches/:batchId/dispatch-preflight', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    res.json(await preflightFollowupBatchDispatch(tenantId, req.params.batchId, { mode: 'manual' }));
  } catch (error) {
    const code = error instanceof Error ? error.message : 'followup_dispatch_preflight_failed';
    res.status(code === 'followup_batch_not_found' ? 404 : 502).json({ error: code });
  }
});

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
  const result = await store.list<EventRecord>(COLLECTION.events, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 500 });
  res.json({ events: result.items.filter(event => Number(event.sequence) > after) });
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
  const persisted = await store.list<EventRecord>(COLLECTION.events, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 500 });
  for (const event of persisted.items.filter(item => Number(item.sequence) > after)) sendEvent(res, event);
  const clients = streamClients.get(run.id) || new Set<Response>();
  clients.add(res);
  streamClients.set(run.id, clients);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (!clients.size) streamClients.delete(run.id);
  });
});

digitalEmployeesRouter.post('/approvals/:approvalId/decide', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const initialApproval = await tenantRecord<ApprovalRecord>(COLLECTION.approvals, req.params.approvalId, tenantId);
  if (!initialApproval) { res.status(404).json({ error: 'approval_not_found' }); return; }
  await withDigitalEmployeeRunLock(tenantId, initialApproval.run_id, async () => {
  const decision = String(req.body?.decision || '');
  if (!['approved', 'rejected'].includes(decision)) {
    res.status(400).json({ error: 'invalid_approval_decision', allowed: ['approved', 'rejected'] });
    return;
  }
  const approval = await tenantRecord<ApprovalRecord>(COLLECTION.approvals, req.params.approvalId, tenantId);
  if (!approval) { res.status(404).json({ error: 'approval_not_found' }); return; }
  if (approval.status !== 'pending') { res.json(await buildOverview(tenantId)); return; }
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const now = new Date().toISOString();
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, approval.task_id, tenantId);
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, approval.run_id, tenantId);
  const goal = run ? await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId) : null;
  if (!task || !run || !goal) { res.status(409).json({ error: 'approval_context_missing' }); return; }
  const runBlocker = approvalRunBlockedReason(run, tenantId, task.status);
  if (runBlocker) { res.status(409).json({ error: runBlocker, message: '当前运行或任务不允许审批；请先恢复运行或重新发起审批。' }); return; }
  if (task.task_key === 'content_release_approval' && Number(approval.subject_version || 0) !== Number(task.task_version || 1)) {
    res.status(409).json({ error: 'approval_subject_changed', currentVersion: Number(task.task_version || 1) });
    return;
  }
  let currentPublishingPackage: PublishingApprovalPackage | null = null;
  if (task.task_key === 'content_release_approval') {
    const allTasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 });
    currentPublishingPackage = await publishingApprovalPackage(tenantId, goal, run, task, allTasks.items, approval.created_at);
    if (!currentPublishingPackage.items.length || currentPublishingPackage.contentHash !== String(approval.content_hash || '')) {
      await store.update(COLLECTION.approvals, approval.id, { status: 'superseded', decision_note: '作品、文案、账号或排期已发生变化，请重新发起审批。', decided_at: now });
      res.status(409).json({ error: 'approval_subject_changed', currentContentHash: currentPublishingPackage.contentHash });
      return;
    }
  }
  let followupBatch: FollowupBatchRecord | null = null;
  if (task.task_key === 'followup_batch_approval') {
    followupBatch = await first<FollowupBatchRecord>(COLLECTION.followupBatches, { tenant_id: tenantId, run_id: run.id }, '-version');
    if (!followupBatch) { res.status(409).json({ error: 'followup_batch_missing' }); return; }
    if (Number(approval.subject_version || 0) !== Number(followupBatch.version || 0) || String(approval.content_hash || '') !== String(followupBatch.content_hash || '')) {
      res.status(409).json({ error: 'approval_subject_changed', currentVersion: followupBatch.version });
      return;
    }
  }
  let publishingEntries: Array<{ id: string; status: string }> = [];
  if (decision === 'approved' && currentPublishingPackage) {
    const connectedAccounts = await listConnectedPublishingAccounts(tenantId);
    const connectedById = new Map(connectedAccounts.map(account => [account.accountId, account]));
    const unavailableAccountIds = [...new Set(currentPublishingPackage.items.flatMap(item => item.accountIds).filter(accountId => {
      const account = connectedById.get(accountId);
      const expectedPlatform = currentPublishingPackage?.items.find(candidate => candidate.accountIds.includes(accountId))?.platform;
      return !account || account.platform !== expectedPlatform;
    }))];
    if (unavailableAccountIds.length) {
      res.status(409).json({
        error: 'publishing_accounts_invalid',
        invalidAccountIds: unavailableAccountIds,
        message: '审批包中的发布账号已断开或不再属于当前租户，请重新选择账号并发起审批。',
      });
      return;
    }
    publishingEntries = await createPublishingCalendarEntries({
      tenantId,
      runId: run.id,
      approvalTaskId: task.id,
      approvalId: approval.id,
      approvedContentHash: String(approval.content_hash || ''),
      package: currentPublishingPackage,
    });
  }
  await store.update(COLLECTION.approvals, approval.id, { status: decision, decided_by: userId, decision_note: note, decided_at: now });
  if (followupBatch) {
    await applyFollowupBatchDecision({ tenantId, batchId: followupBatch.id, decision: decision as 'approved' | 'rejected', userId, approvalId: approval.id });
  }
  await appendAudit({ tenantId, userId, action: 'approval.decided', targetType: 'approval_request', targetId: approval.id, metadata: { decision, runId: run.id, taskId: task.id } });
  if (decision === 'rejected') {
    await Promise.all([
      store.update(COLLECTION.tasks, task.id, { status: 'failed', blocked_reason: note || '审批驳回', updated_at: now }),
      store.update(COLLECTION.runs, run.id, { status: 'failed', current_controller: 'human', pause_reason: note || '审批驳回', completed_at: now }),
      store.update(COLLECTION.goals, goal.id, { status: 'paused', updated_at: now }),
    ]);
    await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.decided', level: 'error', summary: '审批已驳回，运行已停止', payload: { decision, note } });
  } else {
    await Promise.all([
      store.update(COLLECTION.tasks, task.id, { status: 'succeeded', output: { decision, note, approvedAt: now, publishingEntries }, blocked_reason: '', updated_at: now }),
      store.update(COLLECTION.runs, run.id, { status: 'running', current_controller: 'agent', pause_reason: '' }),
    ]);
    await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.decided', level: 'success', summary: '审批已通过，任务交还数字员工继续执行', payload: { decision, note } });
    await advanceRun(tenantId, run.id);
  }
  res.json(await buildOverview(tenantId));
  });
});

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
}): Promise<{ runId: string; goalId: string }> {
  const initialTask = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, input.tenantId);
  if (!initialTask) throw new TaskControlError(404, 'task_not_found');
  return withDigitalEmployeeRunLock(input.tenantId, initialTask.run_id, async () => {
    const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, input.taskId, input.tenantId);
    if (!task) throw new TaskControlError(404, 'task_not_found');
    const [run, goal, plan, configRecord, allTasks] = await Promise.all([
      tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, input.tenantId),
      tenantRecord<GoalRecord>(COLLECTION.goals, task.goal_id, input.tenantId),
      tenantRecord<PlanRecord>(COLLECTION.plans, task.plan_id, input.tenantId),
      configForTenant(input.tenantId),
      store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: input.tenantId, run_id: task.run_id }, sort: 'sequence', perPage: 100 }),
    ]);
    const tenantConfig = publicConfig(configRecord);
    if (!run || !goal || !plan || !tenantConfig) throw new TaskControlError(409, 'correction_context_missing');
    const config = configSnapshotForPlan(plan, tenantConfig);
    const validatedInputRefs: Array<Record<string, unknown>> = [];
    for (const ref of input.businessRefs || []) {
      const validated = await canonicalEvidenceRef(input.tenantId, ref);
      if (!validated) throw new TaskControlError(400, 'evidence_reference_invalid', { message: '证据必须引用当前租户内已存在的业务记录。' });
      validatedInputRefs.push(validated);
    }
    if (run.status === 'cancelled') throw new TaskControlError(409, 'run_cancelled', { message: '已取消的运行不能再纠偏。' });
    if (['paused', 'waiting_human'].includes(run.status)) throw new TaskControlError(409, 'run_controlled_by_human', { message: '请先恢复运行或将人工接管任务交还数字员工。' });
    if (allTasks.items.some(item => item.id === task.id && item.status === 'handed_off')) {
      throw new TaskControlError(409, 'task_handed_off', { message: '请先将人工接管任务交还数字员工。' });
    }
    if (input.action === 'manual_complete' && task.execution_mode === 'approval') {
      throw new TaskControlError(409, 'approval_decision_required', { message: '审批节点必须通过正式审批接口决策，不能用人工完成绕过。' });
    }

    const downstream = downstreamTasks(allTasks.items, task, input.rerunDownstream);
    const replanConfig = input.action === 'replan' && input.enabledWorkflows ? { ...config, enabledWorkflows: input.enabledWorkflows } : config;
    const replanDraft = input.action === 'replan' ? buildWeeklyPlan(goalInput(goal), replanConfig) : null;
    const replannedKeys = new Set(replanDraft?.tasks.map(item => item.key) || []);
    const affected = input.action === 'replan'
      ? [...new Map([...downstream, ...allTasks.items.filter(item => !replannedKeys.has(item.task_key))].map(item => [item.id, item])).values()]
      : downstream;
    if (affected.some(item => item.status === 'handed_off')) {
      throw new TaskControlError(409, 'task_handed_off', { message: '受影响任务中存在人工接管节点，请先交还数字员工。' });
    }
    const irreversibleGuardTasks = input.action === 'manual_complete' ? affected.filter(item => item.id !== task.id) : affected;
    const irreversible = await irreversibleEffects(input.tenantId, run, irreversibleGuardTasks);
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
          ? { ...jsonObject<Record<string, unknown>>(item.output, {}), correctionInput: { id: correction.id, version, scope: input.scope, instruction: input.instruction, action: input.action }, rerunRequestedAt: now }
          : { rerunRequestedByCorrection: correction.id, correctionVersion: version, rerunRequestedAt: now },
        blocked_reason: '',
        owner_id: '',
        business_refs: [],
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
          output: { replannedByCorrection: correction.id, replannedAt: now }, blocked_reason: '', owner_id: '',
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
    await advanceRun(tenantId, result.runId);
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
digitalEmployeesRouter.post('/tasks/:taskId/retry', async (req, res) => handleTaskControl(req, res, 'retry'));
digitalEmployeesRouter.post('/tasks/:taskId/skip', async (req, res) => handleTaskControl(req, res, 'skip'));
digitalEmployeesRouter.post('/tasks/:taskId/complete', async (req, res) => handleTaskControl(req, res, 'manual_complete'));

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
    const customer = getWhatsAppCustomers(tenantId).find(item => String(item.id || '') === id);
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
  const shouldResetTask = ['waiting_external', 'waiting_approval', 'pending'].includes(task.status);
  const shouldReconcile = !['succeeded', 'failed', 'cancelled', 'paused', 'waiting_human'].includes(run.status);
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
  if (!run || !['waiting_external', 'waiting_approval', 'running'].includes(run.status)) { res.status(409).json({ error: 'run_not_handoff_ready' }); return; }
  const now = new Date().toISOString();
  const session = await requiredCreate<HandoffRecord>(COLLECTION.handoffs, {
    tenant_id: tenantId,
    run_id: run.id,
    task_id: task.id,
    status: 'active',
    taken_by: userId,
    snapshot: {
      taskStatus: task.status,
      taskOutput: jsonObject(task.output, {}),
      blockedReason: task.blocked_reason,
      externalActionsPerformed: false,
      constraints: ['接管期间 Agent 停止外部写入与费用消耗'],
    },
    started_at: now,
    returned_at: '',
  });
  await Promise.all([
    store.update(COLLECTION.tasks, task.id, { status: 'handed_off', owner_id: userId, blocked_reason: '人工完整接管', updated_at: now }),
    store.update(COLLECTION.runs, run.id, { status: 'waiting_human', current_controller: userId, pause_reason: '人工完整接管' }),
  ]);
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
  const handoff = await first<HandoffRecord>(COLLECTION.handoffs, { tenant_id: tenantId, task_id: task.id, status: 'active' }, '-started_at');
  if (!run || !handoff) { res.status(409).json({ error: 'handoff_context_missing' }); return; }
  if (run.status !== 'waiting_human') { res.status(409).json({ error: 'run_not_handed_off' }); return; }
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const now = new Date().toISOString();
  await Promise.all([
    store.update(COLLECTION.handoffs, handoff.id, { status: 'returned', returned_at: now, snapshot: { ...jsonObject<Record<string, unknown>>(handoff.snapshot, {}), returnNote: note } }),
    store.update(COLLECTION.tasks, task.id, { status: task.requires_approval ? 'waiting_approval' : 'pending', owner_id: '', blocked_reason: task.requires_approval ? '等待负责人审批' : '', updated_at: now }),
    store.update(COLLECTION.runs, run.id, { status: task.requires_approval ? 'waiting_approval' : 'running', current_controller: 'agent', pause_reason: '' }),
  ]);
  await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'handoff.returned', level: 'success', summary: `${task.title} 已交还数字员工`, payload: { note, externalActionsPerformed: false } });
  await appendAudit({ tenantId, userId, action: 'handoff.returned', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, handoffId: handoff.id } });
  if (!task.requires_approval) await advanceRun(tenantId, run.id);
  res.json(await buildOverview(tenantId));
  });
});

digitalEmployeesRouter.post('/runs/:runId/pause', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  await withDigitalEmployeeRunLock(tenantId, req.params.runId, async () => {
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  if (['running', 'waiting_external', 'waiting_approval'].includes(run.status)) {
    await store.update(COLLECTION.runs, run.id, { status: 'paused', pause_reason: String(req.body?.reason || '人工暂停').slice(0, 500), current_controller: 'human' });
    await appendEvent({ tenantId, runId: run.id, type: 'workflow.paused', level: 'warning', summary: '运行已由人工暂停' });
    await appendAudit({ tenantId, userId, action: 'workflow.paused', targetType: 'workflow_run', targetId: run.id });
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
    await store.update(COLLECTION.runs, run.id, { status: pendingApproval ? 'waiting_approval' : 'running', pause_reason: '', current_controller: pendingApproval ? 'human' : 'agent' });
    await appendEvent({ tenantId, runId: run.id, type: 'workflow.resumed', level: 'success', summary: pendingApproval ? '运行已恢复，继续等待审批' : '运行已恢复' });
    await appendAudit({ tenantId, userId, action: 'workflow.resumed', targetType: 'workflow_run', targetId: run.id });
    if (!pendingApproval) await advanceRun(tenantId, run.id);
  }
  res.json(await buildOverview(tenantId));
  });
});

digitalEmployeesRouter.post('/runs/:runId/cancel', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  await withDigitalEmployeeRunLock(tenantId, req.params.runId, async () => {
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const now = new Date().toISOString();
  const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, perPage: 100 });
  await Promise.all(tasks.items.filter(task => !['succeeded', 'failed'].includes(task.status)).map(task => store.update(COLLECTION.tasks, task.id, { status: 'cancelled', updated_at: now })));
  await Promise.all([
    store.update(COLLECTION.runs, run.id, { status: 'cancelled', current_controller: 'human', pause_reason: '人工取消', completed_at: now }),
    store.update(COLLECTION.goals, run.goal_id, { status: 'cancelled', updated_at: now }),
  ]);
  const pendingApprovals = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: run.id, status: 'pending' }, perPage: 100 });
  await Promise.all(pendingApprovals.items.map(approval => store.update(COLLECTION.approvals, approval.id, {
    status: 'superseded', decision_note: '运行已取消，审批失效', decided_at: now,
  })));
  await appendEvent({ tenantId, runId: run.id, type: 'workflow.cancelled', level: 'warning', summary: '运行已取消，未完成任务停止执行' });
  await appendAudit({ tenantId, userId, action: 'workflow.cancelled', targetType: 'workflow_run', targetId: run.id });
  res.json(await buildOverview(tenantId));
  });
});
