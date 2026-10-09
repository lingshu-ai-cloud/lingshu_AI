import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { createStarter198OrchestratorQueue } from './orchestratorQueue.js';
import { Starter198RuntimePortError } from './runtimePorts.js';
import { STARTER_198_STANDARD_TASK_KEYS } from './workflowScope.js';

type Row = { id: string } & Record<string, unknown>;

const tenantId = 'starter-orchestrator-tenant';
const now = new Date('2026-06-01T01:00:00.000Z');
const limits = {
  workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
  primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
  contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
  assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

const access = (tenant: string): Row => ({
  id: `access-${tenant}`,
  tenant_id: tenant,
  product_profile: 'starter_198',
  profile_version: 'starter_198.v1',
  entitlement_snapshot_id: `snapshot-${tenant}`,
  feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resource_limits: limits,
  status: 'active',
  cycle_started_at: '2026-06-01T00:00:00.000Z',
  cycle_ends_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
});

const config = (tenant: string): Row => ({
  id: `config-${tenant}`,
  tenant_id: tenant,
  status: 'active',
  activated_at: '2026-06-01T00:00:00.000Z',
  config_version: 3,
  policy_version: 'policy-v3',
  facts_version: 'facts-v4',
  config: {
    companyName: '测试制造商', industry: '制造业', primaryBusiness: '生产保温杯',
    targetMarkets: '德国', customerProfile: '礼品经销商', focusProducts: 'TB-750',
    approvalOwner: '负责人', autonomyMode: 'managed', primaryGoal: 'leads',
    enabledWorkflows: ['product_content', 'content_publish'],
    publishingTargets: [], videoLanguages: ['en'], videoDefaults: { platform: 'tiktok' },
    constraints: ['不得编造产品参数'],
    confirmedOperatingPlan: {
      brandName: '测试杯', presenter: 'none',
      plannedAccounts: [{ platform: 'tiktok', accountName: '测试制造商', weeklyOutput: 1 }],
      weeklyMasterCount: 1, weeklyVariantCount: 1,
      estimatedCostCny: { min: 10, max: 15 }, deliveryDays: 7,
    },
  },
  effective_config: {
    knowledgeBinding: {
      schemaVersion: 1,
      source: 'enterprise_profile',
      factsVersion: 'facts-v4',
      boundAt: '2026-06-01T00:00:00.000Z',
      references: {},
      snapshot: {},
      warnings: [],
    },
  },
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
});

const rows = new Map<string, Row[]>([
  [STARTER_COLLECTIONS.access, [access(tenantId)]],
  [STARTER_COLLECTIONS.orchestratorInbox, []],
  [STARTER_COLLECTIONS.usage, []],
  ['digital_employee_configs', [config(tenantId)]],
  ['weekly_goals', []],
  ['weekly_plans', []],
  ['workflow_runs', []],
  ['workflow_tasks', []],
  ['run_events', []],
]);

const active = new Set(['initializing', 'queued', 'planning', 'running', 'waiting_external', 'waiting_approval', 'waiting_human', 'paused', 'cancelling']);
const dataStore = {
  async getById(collection, id) {
    return rows.get(collection)?.find(row => row.id === id) ?? null;
  },
  async create(collection, data) {
    const bucket = rows.get(collection) ?? [];
    const candidate = { ...structuredClone(data), id: String(data.id || `${collection}-${bucket.length + 1}`) } as Row;
    if (bucket.some(row => row.id === candidate.id)) return null;
    if (collection === STARTER_COLLECTIONS.orchestratorInbox && bucket.some(row => (
      row.tenant_id === candidate.tenant_id
      && (row.idempotency_key === candidate.idempotency_key || row.command_id === candidate.command_id || row.queue_item_id === candidate.queue_item_id)
    ))) return null;
    if (collection === 'workflow_runs' && candidate.product_profile === 'starter_198' && active.has(String(candidate.status))
      && bucket.some(row => row.tenant_id === candidate.tenant_id && row.product_profile === 'starter_198' && active.has(String(row.status)))) return null;
    if (collection === 'weekly_plans' && bucket.some(row => row.tenant_id === candidate.tenant_id && row.goal_id === candidate.goal_id)) return null;
    if (collection === 'workflow_tasks' && bucket.some(row => row.tenant_id === candidate.tenant_id && row.run_id === candidate.run_id && row.task_key === candidate.task_key)) return null;
    if (collection === 'run_events' && bucket.some(row => row.tenant_id === candidate.tenant_id && row.run_id === candidate.run_id && row.sequence === candidate.sequence)) return null;
    bucket.push(candidate);
    rows.set(collection, bucket);
    return candidate;
  },
  async update(collection, id, patch) {
    const record = rows.get(collection)?.find(row => row.id === id);
    if (!record) return false;
    Object.assign(record, structuredClone(patch));
    return true;
  },
  async delete() { return false; },
  async list(collection, query: ListQuery = {}) {
    let found = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      found = [...found].sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1));
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: found.slice((page - 1) * perPage, page * perPage), totalItems: found.length,
      totalPages: Math.ceil(found.length / perPage), page, perPage,
    };
  },
} as DataStore;

const repository = createStarter198Repository(dataStore);
const queue = createStarter198OrchestratorQueue({ repository, dataStore, now: () => now });
const first = await queue.enqueue({
  tenantId, userId: 'owner-a', commandId: 'command-a',
  input: '为德国礼品经销商制作 TB-750 的首周内容，并等待真实询盘后报价。',
  idempotencyKey: 'orchestrator-input-a',
});
assert.equal(first.disposition, 'queued');
assert.ok(first.runId);
assert.deepEqual(first.missingFacts, []);
assert.equal(rows.get('workflow_runs')?.length, 1);
assert.equal(rows.get('workflow_runs')?.[0].status, 'queued');
assert.match(String(rows.get('workflow_runs')?.[0].pause_reason), /尚未执行/);
assert.equal(rows.get('weekly_goals')?.length, 1);
assert.equal(rows.get('weekly_plans')?.length, 1);
assert.equal(rows.get('workflow_tasks')?.length, 10);
assert.deepEqual(rows.get('workflow_tasks')?.map(task => task.task_key), [...STARTER_198_STANDARD_TASK_KEYS],
  'the queue and workspace/command scope must share the exact fixed task graph');
assert.ok(rows.get('workflow_tasks')?.every(task => task.status === 'pending'), 'queueing must never pretend tasks ran');
assert.ok(rows.get('workflow_tasks')?.every(task => task.policy_source === 'starter_198.v1'),
  'every fixed-plan task must carry the starter scope marker');
assert.equal(rows.get('workflow_tasks')?.find(task => task.task_key === 'starter_publication_package')?.agent_role, 'traffic');
assert.equal(rows.get('workflow_tasks')?.find(task => task.task_key === 'starter_quote_draft')?.agent_role, 'sales');
const plan = rows.get('weekly_plans')?.[0].plan as Record<string, unknown>;
assert.equal(plan.publicationMode, 'self_service_package');
assert.equal(plan.officialApiPublishingAllowed, false);
assert.equal(plan.quotationMode, 'deterministic_draft_with_human_approval');
assert.deepEqual(plan.operatingPlan, {
  brandName: '测试杯', presenter: 'none',
  plannedAccounts: [{ platform: 'tiktok', accountName: '测试制造商', weeklyOutput: 1 }],
  weeklyMasterCount: 1, weeklyVariantCount: 1,
  estimatedCostCny: { min: 10, max: 15 }, deliveryDays: 7,
});
assert.equal(rows.get('weekly_goals')?.[0].target, 1);
assert.equal(rows.get('weekly_goals')?.[0].unit, '轮');
assert.match(String(rows.get('workflow_tasks')?.find(task => task.task_key === 'starter_content_production')?.description), /标题、Tag/);
assert.match(String(rows.get('workflow_tasks')?.find(task => task.task_key === 'starter_content_production')?.description), /不把上限伪装为已执行/);
assert.equal((rows.get('run_events')?.[0].payload as Record<string, unknown>).executed, false);

rows.get('workflow_runs')![0].status = 'cancelling';
const supplement = await queue.enqueue({
  tenantId, userId: 'owner-a', commandId: 'command-b', input: '纠正：内胆为 316，外壳为 304。',
  idempotencyKey: 'orchestrator-input-b',
});
assert.equal(supplement.disposition, 'attached_to_run');
assert.equal(supplement.runId, first.runId);
assert.equal(rows.get('workflow_runs')?.length, 1, 'a cancelling run must prevent creation of a second active run');
assert.equal(rows.get('workflow_runs')?.[0].status, 'cancelling', 'queue intake must attach without reviving a cancelling run');
const attached = rows.get(STARTER_COLLECTIONS.orchestratorInbox)?.find(row => row.command_id === 'command-b');
assert.equal(attached?.status, 'pending');
assert.equal(attached?.run_id, first.runId);
assert.equal(attached?.input_text, '纠正：内胆为 316，外壳为 304。');

const duplicate = await queue.enqueue({
  tenantId, userId: 'owner-a', commandId: 'command-b', input: '纠正：内胆为 316，外壳为 304。',
  idempotencyKey: 'orchestrator-input-b',
});
assert.deepEqual(duplicate, supplement, 'the durable inbox must replay the same queue result');

rows.get('workflow_runs')![0].status = 'completed';
rows.set('digital_employee_configs', []);
const missing = await queue.enqueue({
  tenantId, userId: 'owner-a', commandId: 'command-c', input: '开始下一轮。',
  idempotencyKey: 'orchestrator-input-c',
});
assert.equal(missing.disposition, 'awaiting_initial_confirmation');
assert.deepEqual(missing.missingFacts, ['digital_employee_configuration']);
assert.equal(rows.get('workflow_runs')?.length, 1, 'missing facts must not create a run');
const waiting = rows.get(STARTER_COLLECTIONS.orchestratorInbox)?.find(row => row.command_id === 'command-c');
assert.equal(waiting?.status, 'waiting_user');
assert.deepEqual(waiting?.missing_facts, ['digital_employee_configuration']);

const invalidPlanTenant = 'starter-orchestrator-invalid-plan';
rows.get(STARTER_COLLECTIONS.access)?.push(access(invalidPlanTenant));
const invalidPlanConfig = config(invalidPlanTenant);
(invalidPlanConfig.config as Record<string, unknown>).confirmedOperatingPlan = {
  brandName: '测试杯', presenter: 'none', plannedAccounts: [],
  weeklyMasterCount: 2, weeklyVariantCount: 8,
  estimatedCostCny: { min: 1, max: 2 }, deliveryDays: 30,
};
rows.get('digital_employee_configs')?.push(invalidPlanConfig);
const invalidPlan = await queue.enqueue({
  tenantId: invalidPlanTenant, userId: 'owner-invalid-plan', commandId: 'command-invalid-plan',
  input: '开始执行已确认计划。', idempotencyKey: 'orchestrator-input-invalid-plan',
});
assert.equal(invalidPlan.disposition, 'awaiting_initial_confirmation');
assert.ok(invalidPlan.missingFacts?.includes('configuration:confirmed_operating_plan_invalid'),
  'a malformed persisted plan must fail closed and require reconfirmation');

const expiredTenant = 'starter-orchestrator-expired';
rows.get(STARTER_COLLECTIONS.access)?.push({
  ...access(expiredTenant),
  cycle_started_at: '2026-05-01T00:00:00.000Z',
  cycle_ends_at: '2026-06-01T00:00:00.000Z',
});
rows.get('digital_employee_configs')?.push(config(expiredTenant));
const inboxCountBeforeExpiredAdmission = rows.get(STARTER_COLLECTIONS.orchestratorInbox)?.length ?? 0;
const runCountBeforeExpiredAdmission = rows.get('workflow_runs')?.length ?? 0;
await assert.rejects(
  () => createStarter198OrchestratorQueue({ repository, dataStore, now: () => now }).enqueue({
    tenantId: expiredTenant,
    userId: 'owner-expired',
    commandId: 'command-expired',
    input: '不应创建新运行',
    idempotencyKey: 'orchestrator-input-expired',
  }),
  (error: unknown) => error instanceof Starter198RuntimePortError
    && error.code === 'starter_198_access_cycle_closed' && error.status === 409,
);
assert.equal(rows.get(STARTER_COLLECTIONS.orchestratorInbox)?.length, inboxCountBeforeExpiredAdmission,
  'cycle admission must happen before a durable inbox row');
assert.equal(rows.get('workflow_runs')?.length, runCountBeforeExpiredAdmission,
  'an expired access cycle must never leave a queued run for the worker to fail later');

console.log('starter_198 orchestrator queue passed: durable intake, scope-safe fixed plan, active-run attachment, idempotency, missing-fact and closed-cycle blocking');
