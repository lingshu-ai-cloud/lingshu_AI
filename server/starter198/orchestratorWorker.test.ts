import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { cancelDigitalEmployeeRun } from '../digitalEmployees/runCancellation.js';
import {
  consumeStarter198OrchestratorRun,
  runStarter198OrchestratorWorkerCycle,
  initStarter198OrchestratorWorker,
  stopStarter198OrchestratorWorker,
  STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY,
  STARTER_198_ORCHESTRATOR_TASK_KEYS,
} from './orchestratorWorker.js';
import { starterWorkerRuntimeIssue } from './workerRuntime.js';
import { buildStarterContentQualityBinding } from './contentApprovalBridge.js';
import { readCanonicalStarterContentArtifact } from './publicationPackageArtifact.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import {
  acquireStarterOrchestratorLease,
  assertStarterOrchestratorLease,
  releaseStarterOrchestratorLease,
  STARTER_ORCHESTRATOR_LEASE_COLLECTION,
  type StarterOrchestratorLeaseDependencies,
} from './orchestratorLease.js';

type Row = { id: string } & Record<string, unknown>;

const tenantId = 'starter-worker-tenant';
const runId = 'starter-worker-run';
const now = new Date('2026-09-12T04:00:00.000Z');
const inputText = '为德国礼品经销商制作 TB-750 的首周内容。';
const inputVersion = createHash('sha256')
  .update(JSON.stringify({ schemaVersion: 1, input: inputText }))
  .digest('hex');

const limits = {
  workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
  primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
  contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
  assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

const taskDefinition: Record<string, {
  role: string;
  mode: string;
  effect: string;
  capability: string;
  dependsOn: string[];
}> = {
  starter_context_snapshot: { role: 'orchestrator', mode: 'internal', effect: 'none', capability: 'workflow.standard.run', dependsOn: [] },
  starter_content_research: { role: 'content', mode: 'observe', effect: 'none', capability: 'production_site.read', dependsOn: ['starter_context_snapshot'] },
  starter_content_production: { role: 'content', mode: 'draft_executor', effect: 'draft', capability: 'workflow.standard.run', dependsOn: ['starter_content_research'] },
  starter_content_quality_gate: { role: 'content', mode: 'observe', effect: 'none', capability: 'workflow.standard.run', dependsOn: ['starter_content_production'] },
  starter_content_release_approval: { role: 'content', mode: 'approval', effect: 'none', capability: 'orchestrator.decision.resolve', dependsOn: ['starter_content_quality_gate'] },
  starter_publication_package: { role: 'traffic', mode: 'internal', effect: 'draft', capability: 'publishing.package.generate', dependsOn: ['starter_content_release_approval'] },
  starter_publication_evidence: { role: 'traffic', mode: 'observe', effect: 'none', capability: 'publishing.evidence.submit', dependsOn: ['starter_publication_package'] },
  starter_inquiry_intake: { role: 'sales', mode: 'observe', effect: 'none', capability: 'quotation.calculate', dependsOn: ['starter_context_snapshot'] },
  starter_quote_draft: { role: 'sales', mode: 'internal', effect: 'draft', capability: 'quotation.calculate', dependsOn: ['starter_inquiry_intake'] },
  starter_result_summary: { role: 'orchestrator', mode: 'internal', effect: 'none', capability: 'workflow.standard.run', dependsOn: ['starter_publication_evidence', 'starter_quote_draft'] },
};

interface MemoryStore extends DataStore {
  rows: Map<string, Row[]>;
  writes: Array<{ operation: 'create' | 'update' | 'delete'; collection: string; id: string }>;
}

function memoryStore(seed: Record<string, Row[]>, options: {
  stealLeaseOnCreate?: boolean;
  afterLeaseCreate?: () => Promise<void>;
} = {}): MemoryStore {
  const rows = new Map(Object.entries(seed).map(([key, value]) => [key, structuredClone(value)]));
  const writes: MemoryStore['writes'] = [];
  let serial = 0;
  const result: MemoryStore = {
    rows,
    writes,
    async getById(collection, id) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as never;
    },
    async list(collection: string, query: ListQuery = {}) {
      let selected = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => String(row[key] ?? '') === String(value)));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = descending ? query.sort.slice(1) : query.sort;
        selected = [...selected].sort((left, right) => {
          const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
          return descending ? -compared : compared;
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 20;
      return {
        items: structuredClone(selected.slice((page - 1) * perPage, page * perPage)) as never[],
        totalItems: selected.length,
        totalPages: Math.ceil(selected.length / perPage),
        page,
        perPage,
      };
    },
    async create(collection, data) {
      const bucket = rows.get(collection) ?? [];
      const duplicate = collection === 'starter_worker_leases'
        ? bucket.some(row => row.tenant_id === data.tenant_id && row.task_id === data.task_id)
        : collection === STARTER_COLLECTIONS.usage
          ? bucket.some(row => row.tenant_id === data.tenant_id && (
            row.idempotency_key === data.idempotency_key
            || row.reservation_id === data.reservation_id && row.event_type === data.event_type
          ))
          : bucket.some(row => row.id === data.id);
      if (duplicate) return null;
      const record = {
        ...structuredClone(data),
        id: String(data.id || `row${String(++serial).padStart(12, '0')}`),
      } as Row;
      bucket.push(record);
      rows.set(collection, bucket);
      writes.push({ operation: 'create', collection, id: record.id });
      const returned = structuredClone(record);
      if (collection === 'starter_worker_leases' && options.stealLeaseOnCreate) {
        record.lease_token = 'replacement-worker-token';
      }
      if (collection === 'starter_worker_leases' && options.afterLeaseCreate) {
        await options.afterLeaseCreate();
      }
      return returned as never;
    },
    async update(collection, id, patch) {
      const record = rows.get(collection)?.find(row => row.id === id);
      if (!record) return false;
      Object.assign(record, structuredClone(patch));
      writes.push({ operation: 'update', collection, id });
      return true;
    },
    async delete(collection, id) {
      const bucket = rows.get(collection) ?? [];
      const next = bucket.filter(row => row.id !== id);
      if (next.length === bucket.length) return false;
      rows.set(collection, next);
      writes.push({ operation: 'delete', collection, id });
      return true;
    },
  };
  return result;
}

function fixture(input: {
  profile?: string;
  includeTrend?: boolean;
  unknownTask?: boolean;
  stealLeaseOnCreate?: boolean;
  afterLeaseCreate?: () => Promise<void>;
} = {}): MemoryStore {
  const profile = input.profile ?? 'starter_198';
  const initializationId = 'initialization-worker-v1';
  const goalId = 'goal-worker';
  const planId = 'plan-worker';
  const context = {
    schemaVersion: 'starter-198.run-initialization.v1',
    initializationId,
    input: inputText,
    inputVersion,
    entitlementSnapshotId: 'snapshot-worker',
    userId: 'owner-worker',
    goalId,
    planId,
    runId,
    startsAt: '2026-09-12',
    endsAt: '2026-09-18',
    policyVersion: 'policy-v3',
    factsVersion: 'facts-v4',
    configVersion: 3,
    primaryPlatform: 'tiktok',
    primaryLanguage: 'en',
    config: {
      companyName: '测试制造商', focusProducts: 'TB-750', targetMarkets: '德国',
      publishingTargets: [], allowRealPublishing: false,
      allowRealCustomerMessages: false, allowGeneratedVisuals: false,
    },
    knowledgeBinding: { factsVersion: 'facts-v4', references: {}, snapshot: {}, warnings: [] },
  };
  const tasks = STARTER_198_ORCHESTRATOR_TASK_KEYS.map((key, index) => ({
    id: `task-worker-${index + 1}`,
    tenant_id: tenantId,
    run_id: runId,
    task_key: key,
    title: key,
    agent_role: taskDefinition[key].role,
    capability_key: taskDefinition[key].capability,
    execution_mode: taskDefinition[key].mode,
    external_effect: taskDefinition[key].effect,
    automatic_execution_allowed: key !== 'starter_content_release_approval',
    policy_source: 'starter_198.v1',
    depends_on: taskDefinition[key].dependsOn,
    status: 'pending',
    sequence: index + 1,
    task_version: 1,
    correction_version: 0,
    output: { schemaVersion: 'starter-198.task-checkpoint.v1', executionStatus: 'not_started' },
    blocked_reason: '',
  })) as Row[];
  if (input.unknownTask) tasks.push({
    id: 'task-worker-unknown', tenant_id: tenantId, run_id: runId,
    task_key: 'starter_unregistered_effect', title: 'unknown', agent_role: 'traffic',
    capability_key: 'workflow.standard.run', execution_mode: 'internal', external_effect: 'draft', depends_on: [], status: 'pending',
    sequence: 0, task_version: 1, correction_version: 0, output: {}, blocked_reason: '',
  });
  return memoryStore({
    [STARTER_COLLECTIONS.access]: [{
      id: 'access-worker', tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1',
      entitlement_snapshot_id: 'snapshot-worker',
      feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
      resource_limits: limits,
      status: 'active', cycle_started_at: '2026-09-01T00:00:00.000Z', cycle_ends_at: '2026-10-01T00:00:00.000Z',
      updated_at: now.toISOString(),
    }],
    [STARTER_COLLECTIONS.usage]: [],
    [STARTER_COLLECTIONS.runs]: [{
      id: runId, tenant_id: tenantId, goal_id: goalId, plan_id: planId,
      status: 'queued', product_profile: profile, starter_initialization_id: initializationId,
      starter_input_version: inputVersion, starter_plan_version: 1, starter_context: context,
      current_controller: 'agent', pause_reason: '等待专用执行器', started_at: now.toISOString(),
    }],
    [STARTER_COLLECTIONS.tasks]: tasks,
    weekly_goals: [{
      id: goalId, tenant_id: tenantId, status: 'active', created_at: now.toISOString(), updated_at: now.toISOString(),
    }],
    weekly_plans: [{
      id: planId, tenant_id: tenantId, goal_id: goalId,
      plan: {
        schemaVersion: 'starter-198.standard-plan.v1', planVersion: 1, initializationId,
        inputVersion, factsVersion: 'facts-v4', policyVersion: 'policy-v3', entitlementSnapshotId: 'snapshot-worker',
        configVersion: 3, primaryPlatform: 'tiktok', primaryLanguage: 'en',
        publicationMode: 'self_service_package', paidAdsAllowed: false, officialApiPublishingAllowed: false,
        quotationMode: 'deterministic_draft_with_human_approval',
      },
    }],
    trend_videos: input.includeTrend === false ? [] : [{
      id: 'trend-worker', tenantId, title: '德国礼品经销商短视频趋势', platform: 'tiktok',
      status: 'analyzed', crawledAt: '2026-09-12T03:00:00.000Z', sourceUrl: 'https://example.com/trend-worker',
      aiAnalysis: { analysisMode: 'exact', analysisQuality: 'video', summary: '展示真实定制流程' },
    }],
    studio_projects: [],
    whatsapp_customers: [],
    starter_worker_leases: [],
    durable_operation_leases: [],
  }, {
    stealLeaseOnCreate: input.stealLeaseOnCreate,
    afterLeaseCreate: input.afterLeaseCreate,
  });
}

function task(store: MemoryStore, key: string): Row {
  return store.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.task_key === key)!;
}

const registeredKeys = Object.keys(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY).sort();
assert.deepEqual(registeredKeys, [...STARTER_198_ORCHESTRATOR_TASK_KEYS].sort(), 'all fixed-plan keys have explicit handlers');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_context_snapshot.mode, 'implemented_zero_cost');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_content_research.mode, 'implemented_zero_cost');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_content_production.mode, 'implemented_zero_cost');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_content_quality_gate.mode, 'implemented_zero_cost');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_content_release_approval.mode, 'approval_bridge');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_publication_package.mode, 'external_projection');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_publication_evidence.mode, 'external_projection');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_inquiry_intake.mode, 'implemented_zero_cost');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_quote_draft.mode, 'implemented_zero_cost');
assert.equal(STARTER_198_ORCHESTRATOR_HANDLER_REGISTRY.starter_result_summary.mode, 'implemented_zero_cost');

const approvalPublishingRoot = await mkdtemp(path.join(tmpdir(), 'starter-orchestrator-approval-'));
try {
  const approvalStore = fixture();
  const tenantDirectory = path.join(approvalPublishingRoot, tenantId);
  await mkdir(tenantDirectory, { recursive: true });
  const assetPath = path.join(tenantDirectory, 'orchestrator-approved.mp4');
  await writeFile(assetPath, Buffer.from('orchestrator-approval-real-file'));
  const script = 'Verified TB-750 content for a self-service publication package.';
  const sourceContentHash = createHash('sha256').update(JSON.stringify(script)).digest('hex');
  approvalStore.rows.set('studio_projects', [{
    id: 'orchestrator-studio-project', tenant_id: tenantId, title: 'Verified TB-750 content',
    status: 'ready_for_approval',
    spec: {
      workflowRunId: runId, script, caption: 'Verified TB-750 product facts.', platform: 'tiktok',
      automation: {
        managedBy: 'digital_employee', stage: 'completed', quality: { passed: true },
        contentVersion: 2, contentHash: sourceContentHash, renderOutputPath: assetPath,
      },
    },
  }]);
  for (const key of [
    'starter_context_snapshot', 'starter_content_research',
    'starter_content_production', 'starter_content_quality_gate',
  ]) task(approvalStore, key).status = 'succeeded';
  const canonical = await readCanonicalStarterContentArtifact({
    tenantId, runId, contentId: 'orchestrator-studio-project',
    dataStore: approvalStore, publishingRoot: approvalPublishingRoot,
  });
  const qualityTask = task(approvalStore, 'starter_content_quality_gate');
  qualityTask.output = buildStarterContentQualityBinding({
    tenantId, runId, qualityTaskId: qualityTask.id,
    qualityTaskVersion: String(qualityTask.task_version), artifact: canonical,
  });
  approvalStore.rows.set('durable_operation_leases', [{
    id: 'approval-run-mutation-owner', tenant_id: tenantId,
    lease_scope: 'starter-run-mutation', subject_id: runId,
    lease_token: 'another-process', owner_id: 'another-process',
    acquired_at: now.toISOString(), expires_at: '2099-01-01T00:00:00.000Z',
  }]);
  const busyApprovalOutcome = await consumeStarter198OrchestratorRun({
    tenantId, runId,
    dependencies: {
      dataStore: approvalStore, repository: createStarter198Repository(approvalStore),
      now: () => now, workerId: 'approval-worker-busy', publishingRoot: approvalPublishingRoot,
    },
  });
  assert.equal(busyApprovalOutcome.state, 'lease_busy');
  assert.equal(busyApprovalOutcome.failed, 0, 'run lease contention is retryable, not a workflow failure');
  assert.equal(task(approvalStore, 'starter_content_release_approval').status, 'pending');
  assert.equal(approvalStore.rows.get(STARTER_COLLECTIONS.runs)?.[0]?.status, 'queued');
  assert.equal(approvalStore.rows.get(STARTER_COLLECTIONS.approvals)?.length ?? 0, 0);
  approvalStore.rows.set('durable_operation_leases', []);
  const approvalOutcome = await consumeStarter198OrchestratorRun({
    tenantId,
    runId,
    dependencies: {
      dataStore: approvalStore, repository: createStarter198Repository(approvalStore),
      now: () => now, workerId: 'approval-worker', publishingRoot: approvalPublishingRoot,
    },
  });
  assert.deepEqual(
    { processed: approvalOutcome.processed, waiting: approvalOutcome.waiting, failed: approvalOutcome.failed },
    { processed: 1, waiting: 1, failed: 0 },
    'the worker stops its pass immediately after handing control to the human approval',
  );
  assert.equal(task(approvalStore, 'starter_content_release_approval').status, 'waiting_approval');
  assert.equal(approvalStore.rows.get(STARTER_COLLECTIONS.runs)?.[0]?.status, 'waiting_approval');
  assert.equal(approvalStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 1);
  assert.equal(task(approvalStore, 'starter_inquiry_intake').status, 'pending',
    'an independent branch cannot use the stale pre-approval run snapshot');
  assert.equal(task(approvalStore, 'starter_publication_package').status, 'pending');

  task(approvalStore, 'starter_content_release_approval').status = 'succeeded';
  approvalStore.rows.get(STARTER_COLLECTIONS.runs)![0]!.status = 'running';
  await consumeStarter198OrchestratorRun({
    tenantId,
    runId,
    dependencies: {
      dataStore: approvalStore, repository: createStarter198Repository(approvalStore),
      now: () => now, workerId: 'projection-skip-worker', publishingRoot: approvalPublishingRoot,
    },
  });
  assert.equal(task(approvalStore, 'starter_publication_package').status, 'pending');
  assert.equal(task(approvalStore, 'starter_publication_evidence').status, 'pending');
  assert.equal(task(approvalStore, 'starter_inquiry_intake').status, 'waiting_external',
    'projection-owned publication nodes are skipped while independent safe work remains eligible');
} finally {
  await rm(approvalPublishingRoot, { recursive: true, force: true });
}

const successful = fixture();
const successfulRepository = createStarter198Repository(successful);
const outcome = await consumeStarter198OrchestratorRun({
  tenantId,
  runId,
  dependencies: { dataStore: successful, repository: successfulRepository, now: () => now, workerId: 'worker-a' },
});
assert.deepEqual(
  { state: outcome.state, processed: outcome.processed, succeeded: outcome.succeeded, waiting: outcome.waiting, failed: outcome.failed },
  { state: 'advanced', processed: 4, succeeded: 2, waiting: 2, failed: 0 },
);
assert.equal(task(successful, 'starter_context_snapshot').status, 'succeeded');
assert.equal(task(successful, 'starter_content_research').status, 'succeeded');
assert.equal(task(successful, 'starter_content_production').status, 'waiting_external');
assert.equal(task(successful, 'starter_inquiry_intake').status, 'waiting_external');
assert.equal(task(successful, 'starter_content_quality_gate').status, 'pending');
assert.equal(task(successful, 'starter_quote_draft').status, 'pending');
assert.equal(successful.rows.get(STARTER_COLLECTIONS.runs)?.[0].status, 'waiting_external');
assert.equal(successful.rows.get(STARTER_COLLECTIONS.runs)?.[0].current_controller, 'system',
  'a zero-cost observer waiting on real input must not claim that an agent is actively running');
assert.match(String(successful.rows.get(STARTER_COLLECTIONS.runs)?.[0].pause_reason), /真实询盘/);
assert.equal((task(successful, 'starter_content_research').output as Record<string, unknown>).providerCalls, 0);
assert.equal((task(successful, 'starter_content_production').output as Record<string, unknown>).reasonCode,
  'tenant_content_pipeline_not_connected');
assert.equal((task(successful, 'starter_content_production').output as Record<string, unknown>).providerCalls, 0);

const usage = successful.rows.get(STARTER_COLLECTIONS.usage) ?? [];
assert.equal(usage.length, 8, 'four zero-cost observations each have one reserve and one terminal event');
assert.deepEqual(usage.filter(row => row.event_type === 'reserve').map(row => row.capability).sort(), [
  'production_site.read', 'quotation.calculate', 'workflow.standard.run', 'workflow.standard.run',
]);
for (const terminal of usage.filter(row => row.event_type === 'terminal')) {
  const details = terminal.usage as Record<string, unknown>;
  assert.equal(details.input_tokens, 0);
  assert.equal(details.output_tokens, 0);
  assert.equal(details.cache_tokens, 0);
  assert.equal(details.settled_cost_cny, 0);
}
assert.equal(successful.rows.get('starter_worker_leases')?.length, 0, 'completed bounded work releases its DB lease');
assert.equal(successful.rows.get('durable_operation_leases')?.length, 0, 'completed mutations release the shared run lease');
assert.ok(successful.writes.every(write => [
  STARTER_COLLECTIONS.runs, STARTER_COLLECTIONS.tasks, STARTER_COLLECTIONS.usage,
  'starter_worker_leases', 'durable_operation_leases',
].includes(write.collection)), 'the worker cannot write publishing, calendar, customer, message, or provider collections');

const replayWrites = successful.writes.length;
const replay = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: successful, repository: successfulRepository, now: () => now, workerId: 'worker-a' },
});
assert.equal(replay.state, 'ignored', 'waiting runs resume only after an explicit event returns them to running');
assert.equal(successful.rows.get(STARTER_COLLECTIONS.usage)?.length, 8, 'replay creates no duplicate usage lifecycle');
assert.equal(successful.writes.length, replayWrites, 'replay makes no writes');

const noEvidence = fixture({ includeTrend: false });
const noEvidenceOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: noEvidence, repository: createStarter198Repository(noEvidence), now: () => now },
});
assert.deepEqual(
  { processed: noEvidenceOutcome.processed, succeeded: noEvidenceOutcome.succeeded, waiting: noEvidenceOutcome.waiting },
  { processed: 3, succeeded: 1, waiting: 2 },
);
assert.equal(task(noEvidence, 'starter_content_research').status, 'waiting_external');
assert.equal(task(noEvidence, 'starter_content_production').status, 'pending');
assert.match(String(task(noEvidence, 'starter_content_research').blocked_reason), /未生成或臆造/);
assert.equal((task(noEvidence, 'starter_content_research').output as Record<string, unknown>).providerCalls, 0);

const unknown = fixture({ unknownTask: true });
const unknownOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: unknown, repository: createStarter198Repository(unknown), now: () => now },
});
assert.equal(unknownOutcome.state, 'blocked');
assert.equal(task(unknown, 'starter_unregistered_effect').status, 'failed');
assert.equal(unknown.rows.get(STARTER_COLLECTIONS.runs)?.[0].status, 'waiting_human');
assert.equal(unknown.rows.get(STARTER_COLLECTIONS.usage)?.length, 0, 'unknown tasks never reserve or execute work');

const tamperedGraph = fixture();
task(tamperedGraph, 'starter_content_research').depends_on = [];
const tamperedOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: tamperedGraph, repository: createStarter198Repository(tamperedGraph), now: () => now },
});
assert.equal(tamperedOutcome.state, 'blocked');
assert.equal(task(tamperedGraph, 'starter_content_research').status, 'failed', 'rewired DAG edges fail closed');

const tamperedCapability = fixture();
task(tamperedCapability, 'starter_content_research').capability_key = 'workflow.standard.run';
const tamperedCapabilityOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: tamperedCapability, repository: createStarter198Repository(tamperedCapability), now: () => now },
});
assert.equal(tamperedCapabilityOutcome.state, 'blocked');
assert.equal(task(tamperedCapability, 'starter_content_research').status, 'failed', 'capability rewrites fail closed');

const retriedVersion = fixture();
task(retriedVersion, 'starter_context_snapshot').task_version = 2;
const retriedVersionOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: retriedVersion, repository: createStarter198Repository(retriedVersion), now: () => now },
});
assert.equal(retriedVersionOutcome.state, 'advanced', 'positive retry versions preserve the fixed graph contract');
assert.equal(task(retriedVersion, 'starter_context_snapshot').status, 'succeeded');

const incompleteGraph = fixture();
incompleteGraph.rows.set(STARTER_COLLECTIONS.tasks, incompleteGraph.rows.get(STARTER_COLLECTIONS.tasks)!
  .filter(row => row.task_key !== 'starter_result_summary'));
const incompleteOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: incompleteGraph, repository: createStarter198Repository(incompleteGraph), now: () => now },
});
assert.equal(incompleteOutcome.state, 'blocked');
assert.equal(task(incompleteGraph, 'starter_context_snapshot').status, 'failed', 'missing fixed-plan tasks fail closed');

const nonStarter = fixture({ profile: 'enterprise' });
const nonStarterWrites = nonStarter.writes.length;
const ignored = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: nonStarter, repository: createStarter198Repository(nonStarter), now: () => now },
});
assert.equal(ignored.state, 'ignored');
assert.equal(nonStarter.writes.length, nonStarterWrites, 'direct consumption cannot mutate a non-starter run');

const leased = fixture();
leased.rows.get('starter_worker_leases')!.push({
  id: 'lease-other', tenant_id: tenantId, task_id: task(leased, 'starter_context_snapshot').id,
  lease_token: 'other-worker-token', worker_id: 'other-worker', acquired_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 60_000).toISOString(),
});
const leasedOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: leased, repository: createStarter198Repository(leased), now: () => now },
});
assert.equal(leasedOutcome.state, 'lease_busy');
assert.equal(task(leased, 'starter_context_snapshot').status, 'pending');
assert.equal(leased.rows.get(STARTER_COLLECTIONS.usage)?.length, 0);

const branchLease = fixture();
task(branchLease, 'starter_context_snapshot').status = 'succeeded';
task(branchLease, 'starter_content_research').status = 'succeeded';
branchLease.rows.get('starter_worker_leases')!.push({
  id: 'lease-content', tenant_id: tenantId, task_id: task(branchLease, 'starter_content_production').id,
  lease_token: 'content-worker-token', worker_id: 'content-worker', acquired_at: now.toISOString(),
  expires_at: new Date(now.getTime() + 60_000).toISOString(),
});
const branchLeaseOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: branchLease, repository: createStarter198Repository(branchLease), now: () => now },
});
assert.equal(branchLeaseOutcome.state, 'advanced');
assert.equal(task(branchLease, 'starter_content_production').status, 'pending');
assert.equal(task(branchLease, 'starter_inquiry_intake').status, 'waiting_external', 'busy content branch cannot block independent sales branch');

const staleLease = fixture();
staleLease.rows.get('starter_worker_leases')!.push({
  id: 'lease-stale', tenant_id: tenantId, task_id: task(staleLease, 'starter_context_snapshot').id,
  lease_token: 'stale-worker-token', worker_id: 'stale-worker', acquired_at: '2026-09-12T03:00:00.000Z',
  expires_at: '2026-09-12T03:01:00.000Z',
});
const staleOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: staleLease, repository: createStarter198Repository(staleLease), now: () => now },
});
assert.equal(staleOutcome.state, 'advanced', 'an expired immutable lease is safely reaped and work resumes');
assert.equal(task(staleLease, 'starter_context_snapshot').status, 'succeeded');
assert.equal(staleLease.rows.get(STARTER_ORCHESTRATOR_LEASE_COLLECTION)?.length, 0,
  'bounded recovered work releases its replacement lease');

const activeLeaseStore = fixture();
let leaseClock = new Date('2026-09-12T04:00:00.000Z');
const leaseDependencies = (
  dataStore: DataStore,
  workerId: string,
): StarterOrchestratorLeaseDependencies => ({
  dataStore,
  now: () => leaseClock,
  workerId,
  leaseDurationMs: 30_000,
  minimumCommitWindowMs: 1_000,
  leaseReclaimGraceMs: 5_000,
});
const activeTaskId = task(activeLeaseStore, 'starter_context_snapshot').id;
const originalLease = await acquireStarterOrchestratorLease({
  dependencies: leaseDependencies(activeLeaseStore, 'original-owner'),
  tenantId,
  taskId: activeTaskId,
});
assert.ok(originalLease, 'the initial worker owns the lease');
leaseClock = new Date('2026-09-12T04:00:29.000Z');
assert.equal(await acquireStarterOrchestratorLease({
  dependencies: leaseDependencies(activeLeaseStore, 'premature-reaper'),
  tenantId,
  taskId: activeTaskId,
}), null, 'a still-valid lease is never deleted or taken over');
assert.equal(activeLeaseStore.rows.get(STARTER_ORCHESTRATOR_LEASE_COLLECTION)?.[0].lease_token,
  originalLease.lease_token);

leaseClock = new Date('2026-09-12T04:00:35.000Z');
const replacementLease = await acquireStarterOrchestratorLease({
  dependencies: leaseDependencies(activeLeaseStore, 'replacement-owner'),
  tenantId,
  taskId: activeTaskId,
});
assert.ok(replacementLease, 'an expired lease is reclaimed after its safety grace');
assert.notEqual(replacementLease.id, originalLease.id, 'reclaim creates a new immutable lease generation');
assert.notEqual(replacementLease.lease_token, originalLease.lease_token, 'reclaim rotates the fencing token');
await assert.rejects(
  assertStarterOrchestratorLease(leaseDependencies(activeLeaseStore, 'original-owner'), originalLease),
  (error: unknown) => error instanceof Error && error.message === 'starter_orchestrator_fence_lost',
  'the old owner is fenced before every later worker write',
);
await releaseStarterOrchestratorLease(activeLeaseStore, originalLease);
assert.equal(activeLeaseStore.rows.get(STARTER_ORCHESTRATOR_LEASE_COLLECTION)?.[0].lease_token,
  replacementLease.lease_token, 'an old owner cannot release the replacement generation');

const concurrentLeaseStore = fixture();
leaseClock = new Date('2026-09-12T05:00:00.000Z');
const concurrentTaskId = task(concurrentLeaseStore, 'starter_context_snapshot').id;
const abandonedLease = await acquireStarterOrchestratorLease({
  dependencies: leaseDependencies(concurrentLeaseStore, 'crashed-owner'),
  tenantId,
  taskId: concurrentTaskId,
});
assert.ok(abandonedLease);
leaseClock = new Date('2026-09-12T05:00:35.000Z');
const concurrentClaims = await Promise.all(['reaper-a', 'reaper-b'].map(workerId =>
  acquireStarterOrchestratorLease({
    dependencies: leaseDependencies(concurrentLeaseStore, workerId),
    tenantId,
    taskId: concurrentTaskId,
  })));
assert.equal(concurrentClaims.filter(Boolean).length, 1,
  'the unique task index leaves exactly one effective owner after concurrent reclaim');
const effectiveLease = concurrentClaims.find(Boolean);
assert.ok(effectiveLease);
assert.equal(concurrentLeaseStore.rows.get(STARTER_ORCHESTRATOR_LEASE_COLLECTION)?.length, 1);
assert.equal(concurrentLeaseStore.rows.get(STARTER_ORCHESTRATOR_LEASE_COLLECTION)?.[0].lease_token,
  effectiveLease.lease_token);

let releaseWorkerAfterCancellation!: () => void;
const workerMayContinue = new Promise<void>(resolve => { releaseWorkerAfterCancellation = resolve; });
let signalWorkerReadPending!: () => void;
const workerReadPending = new Promise<void>(resolve => { signalWorkerReadPending = resolve; });
const cancellationRace = fixture({
  afterLeaseCreate: async () => {
    signalWorkerReadPending();
    await workerMayContinue;
  },
});
const cancellationRaceRepository = createStarter198Repository(cancellationRace);
const racingWorker = consumeStarter198OrchestratorRun({
  tenantId,
  runId,
  dependencies: {
    dataStore: cancellationRace,
    repository: cancellationRaceRepository,
    now: () => now,
    workerId: 'worker-cancellation-race',
  },
});
await workerReadPending;
const workerRejected = assert.rejects(
  racingWorker,
  (error: unknown) => error instanceof Error && error.message === 'starter_orchestrator_run_changed',
);
await cancelDigitalEmployeeRun({
  tenantId,
  userId: 'owner-worker',
  runId,
  dataStore: cancellationRace,
  now,
});
const writesAtCancellation = cancellationRace.writes.length;
releaseWorkerAfterCancellation();
await workerRejected;
assert.equal(cancellationRace.rows.get(STARTER_COLLECTIONS.runs)?.[0].status, 'cancelled');
assert.equal(task(cancellationRace, 'starter_context_snapshot').status, 'cancelled',
  'a worker holding a stale pending snapshot cannot revive a task after cancellation');
assert.equal(cancellationRace.writes.slice(writesAtCancellation)
  .some(write => write.operation === 'update'
    && write.collection === STARTER_COLLECTIONS.tasks
    && write.id === task(cancellationRace, 'starter_context_snapshot').id), false,
  'the lifecycle re-read rejects before any post-cancellation task write');

const fenced = fixture({ stealLeaseOnCreate: true });
const fencedOutcome = await consumeStarter198OrchestratorRun({
  tenantId, runId,
  dependencies: { dataStore: fenced, repository: createStarter198Repository(fenced), now: () => now },
});
assert.equal(fencedOutcome.state, 'fenced_out');
assert.equal(task(fenced, 'starter_context_snapshot').status, 'pending');
assert.equal(fenced.rows.get(STARTER_COLLECTIONS.usage)?.length, 0, 'lost fencing token blocks metering and work');
assert.equal(fenced.rows.get('starter_worker_leases')?.[0].lease_token, 'replacement-worker-token', 'old owner cannot release replacement lease');

const cycleStore = fixture();
cycleStore.rows.get(STARTER_COLLECTIONS.runs)!.push({
  id: 'enterprise-run', tenant_id: 'enterprise-tenant', product_profile: 'enterprise', status: 'queued', started_at: now.toISOString(),
});
cycleStore.rows.get(STARTER_COLLECTIONS.tasks)!.push({
  id: 'enterprise-task', tenant_id: 'enterprise-tenant', run_id: 'enterprise-run', task_key: 'platform_publish', status: 'pending',
});
const cycle = await runStarter198OrchestratorWorkerCycle({
  dependencies: { dataStore: cycleStore, repository: createStarter198Repository(cycleStore), now: () => now },
});
assert.equal(cycle.scanned, 1);
assert.equal(cycle.advanced, 1);
assert.equal(cycleStore.rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === 'enterprise-task')?.status, 'pending');

const source = await readFile(fileURLToPath(new URL('./orchestratorWorker.ts', import.meta.url)), 'utf8');
assert.doesNotMatch(source, /from ['"]\.\.\/routes\//, 'the minimal worker imports no route capable of external effects');
assert.doesNotMatch(source, /from ['"]\.\.\/publishing\//, 'the minimal worker imports no publisher');
assert.doesNotMatch(source, /from ['"]\.\.\/integrations\//, 'the minimal worker imports no external integration');
assert.doesNotMatch(source, /reconcileDigitalEmployeeRun|runScheduledTaskNow|followupDispatch|sendMessage/i);
assert.match(source, /starterWorkerRuntimeIssue\('STARTER_198_ORCHESTRATOR_WORKER_ENABLED'\)/,
  'scheduled worker shares the strict explicit-opt-in and production dependency gate');
assert.match(source, /30_000, 10_000, 15 \* 60_000/, 'worker interval is clamped from 10 seconds to 15 minutes');
assert.equal(starterWorkerRuntimeIssue('STARTER_198_ORCHESTRATOR_WORKER_ENABLED', {}), 'not_explicitly_enabled');
assert.equal(starterWorkerRuntimeIssue('STARTER_198_ORCHESTRATOR_WORKER_ENABLED', {
  STARTER_198_ORCHESTRATOR_WORKER_ENABLED: 'true', NODE_ENV: 'production',
}), 'production_dependency_missing:PB_URL');
assert.equal(starterWorkerRuntimeIssue('STARTER_198_ORCHESTRATOR_WORKER_ENABLED', {
  STARTER_198_ORCHESTRATOR_WORKER_ENABLED: 'true', NODE_ENV: 'production',
  PB_URL: 'http://pocketbase:8090', PB_ADMIN_EMAIL: 'worker@example.test', PB_ADMIN_PASSWORD: 'secret',
}), null);

const previousProductionEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
};
const originalFetch = globalThis.fetch;
try {
  process.env.NODE_ENV = 'production';
  process.env.PB_URL = 'https://pocketbase.invalid';
  process.env.PB_ADMIN_EMAIL = 'orchestrator-worker@example.test';
  process.env.PB_ADMIN_PASSWORD = 'not-a-real-secret';
  globalThis.fetch = async () => new Response('dependency unavailable', { status: 503 });
  await assert.rejects(
    () => runStarter198OrchestratorWorkerCycle(),
    /workflow_runs read failed \(503\)/,
    'production orchestration scans must surface durable-store failure instead of appearing empty',
  );
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(previousProductionEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
const previousWorkerEnabled = process.env.STARTER_198_ORCHESTRATOR_WORKER_ENABLED;
process.env.STARTER_198_ORCHESTRATOR_WORKER_ENABLED = 'false';
initStarter198OrchestratorWorker();
stopStarter198OrchestratorWorker();
if (previousWorkerEnabled === undefined) delete process.env.STARTER_198_ORCHESTRATOR_WORKER_ENABLED;
else process.env.STARTER_198_ORCHESTRATOR_WORKER_ENABLED = previousWorkerEnabled;

console.log('starter_198 orchestrator worker passed: explicit registry, truthful waits, zero-cost metering, starter-only scan, DB lease guard and fencing fail-closed');
