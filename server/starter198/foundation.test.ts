import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_PROFILE_VERSION,
  type AgentTaskEnvelopeV1,
  type Starter198ResourceLimits,
} from '../../shared/contracts/starter198.js';
import { buildStarter198CapabilityManifest, parseStarter198AccessRecord, starter198OrgRole } from './profile.js';
import { aggregateStarterAgentUsage } from './usage.js';
import { createStarter198Repository, STARTER_COLLECTIONS, starterVersionString } from './repository.js';
import { buildStarterAgentHandoff, persistStarterAgentTask, Starter198AgentTaskError } from './agentTasks.js';
import { provisionStarter198, STARTER_198_DEFAULT_LIMITS, Starter198ProvisioningError } from './provisioning.js';
import { runStarter198Command, Starter198CommandError } from './commands.js';
import { createStarter198QuoteDecisionPort } from './quoteDecision.js';
import { createStarter198QuoteEvidencePort } from './quoteEvidence.js';
import { QuotationError } from '../quotation/errors.js';
import {
  assertOrchestratorAdmissionQuota,
  assertPublicationPackageQuota,
  assertQuoteDraftQuota,
  assertStarter198AccessCycleOpen,
  Starter198QuotaError,
} from './quota.js';
import { isStarter198BoundaryExemptPath } from './legacyBoundary.js';

const tenantId = 'starter-tenant-a';
const limits: Starter198ResourceLimits = {
  workspaceCount: 1,
  brandCount: 1,
  memberCount: 3,
  agentTeamCount: 1,
  productCount: 1,
  marketCount: 2,
  buyerPersonaCount: 3,
  languageCount: 2,
  primaryPlatformCount: 2,
  concurrentRunCount: 1,
  contentArtifactCountPerCycle: 20,
  contentRevisionCountPerCycle: 3,
  publicationPackageCountPerContent: 2,
  assistedSessionCount: 5,
  inquiryAiCountPerCycle: 100,
  quoteDraftCountPerCycle: 20,
  highCostVideoCount: 0,
  budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

const accessRecord = {
  id: 'access-record-1',
  tenant_id: tenantId,
  product_profile: 'starter_198',
  profile_version: STARTER_198_PROFILE_VERSION,
  entitlement_snapshot_id: 'snapshot-v1',
  feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resource_limits: limits,
  status: 'active',
  cycle_started_at: '2026-09-12T00:00:00.000Z',
  cycle_ends_at: '2026-09-19T00:00:00.000Z',
  updated_at: '2026-09-12T00:00:00.000Z',
};

const access = parseStarter198AccessRecord(accessRecord, tenantId);
assert.ok(access);
assert.equal(parseStarter198AccessRecord({ ...accessRecord, subscriptionStatus: 'active', product_profile: 'wrong' }, tenantId), null);
assert.equal(parseStarter198AccessRecord({ ...accessRecord, resource_limits: { ...limits, budgetCnyPerCycle: 1 } }, tenantId), null);
assert.equal(parseStarter198AccessRecord({ ...accessRecord, cycle_ends_at: accessRecord.cycle_started_at }, tenantId), null,
  'invalid usage-cycle bounds must fail closed');
const manifest = buildStarter198CapabilityManifest(access, new Date('2026-09-12T00:00:00.000Z'));
assert.equal(manifest.capabilities['workspace.read'].allowed, true);
assert.deepEqual(manifest.capabilities['production_site.write'], { allowed: false, reason: 'profile_denied' });
assert.deepEqual(manifest.capabilities['agent.child.command'], { allowed: false, reason: 'profile_denied' });
const closedCycleManifest = buildStarter198CapabilityManifest(access, new Date('2026-09-19T00:00:00.000Z'));
assert.equal(closedCycleManifest.capabilities['workspace.read'].allowed, true, 'closed cycles remain inspectable');
assert.deepEqual(closedCycleManifest.capabilities['orchestrator.command.submit'], {
  allowed: false, reason: 'entitlement_expired',
}, 'closed access cycles expose no new command capability');
assert.throws(
  () => assertStarter198AccessCycleOpen({ access, now: new Date('2026-09-19T00:00:00.000Z') }),
  (error: unknown) => error instanceof Starter198QuotaError
    && error.code === 'starter_198_access_cycle_closed' && error.status === 409,
);
assert.equal(starter198OrgRole(undefined), null);
assert.equal(starter198OrgRole('invalid'), null);
assert.equal(starter198OrgRole('super_admin'), 'owner');
assert.equal(starterVersionString(7), '7', 'numeric PocketBase versions must remain command-addressable');
assert.equal(starterVersionString(Number.NaN), '', 'invalid numeric versions must fail closed');
assert.equal(isStarter198BoundaryExemptPath('/api/overseas/auth/me'), true);
assert.equal(isStarter198BoundaryExemptPath('/api/overseas/auth/employees/member-a/role'), true);
assert.equal(isStarter198BoundaryExemptPath('/api/overseas/assistant-threads/business/actions'), true,
  'the authenticated Lingxiaoshu entry must reach its deterministic starter command adapter');
assert.equal(isStarter198BoundaryExemptPath('/api/overseas/auth/future-dangerous-endpoint'), false,
  'new auth endpoints must not become starter_198 exceptions implicitly');

let quoteAdapterInput: unknown[] = [];
const quoteDecisionAdapter = createStarter198QuoteDecisionPort({
  async decideDraft(...args: unknown[]) { quoteAdapterInput = args; return {} as never; },
});
await quoteDecisionAdapter.decide({
  tenantId, userId: 'quote-owner', role: 'owner', draftId: 'quote-a',
  expectedInputHash: 'hash-a', decision: 'approved', note: '确认', idempotencyKey: 'quote-decision-a',
});
assert.deepEqual(quoteAdapterInput[0], { tenantId, userId: 'quote-owner', role: 'super_admin' });
assert.equal(quoteAdapterInput[5], 'hash-a', 'quote adapter must enforce the displayed immutable input hash');
const failingQuoteAdapter = createStarter198QuoteDecisionPort({
  async decideDraft() { throw new QuotationError('quote_draft_changed', 'changed', 409); },
});
await assert.rejects(
  () => failingQuoteAdapter.decide({
    tenantId, userId: 'quote-admin', role: 'admin', draftId: 'quote-a',
    expectedInputHash: 'hash-a', decision: 'rejected', note: '变更', idempotencyKey: 'quote-decision-b',
  }),
  (error: unknown) => error instanceof Error
    && (error as Error & { code?: string; status?: number }).code === 'quote_draft_changed'
    && (error as Error & { status?: number }).status === 409,
);
let quoteEvidenceAdapterInput: unknown[] = [];
const quoteEvidenceAdapter = createStarter198QuoteEvidencePort({
  async recordExternalSendEvidence(...args: unknown[]) {
    quoteEvidenceAdapterInput = args;
    return { id: 'evidence-a', status: 'submitted_unverified' as const } as never;
  },
}, async () => ({
  artifactId: `quote_artifact_${'a'.repeat(24)}`,
  draftId: 'quote-a',
  inputHash: 'hash-a',
  ruleHash: 'b'.repeat(64),
  calculationHash: 'c'.repeat(64),
  approvalEvidenceId: 'approval-a',
  sha256: 'a'.repeat(64),
  mediaType: 'application/json; charset=utf-8',
  fileName: 'quotation-quote-a.json',
  bytes: Buffer.from('{}\n'),
  createdAt: '2026-09-12T00:00:00.000Z',
}));
assert.deepEqual(await quoteEvidenceAdapter.record({
  tenantId, userId: 'quote-operator', role: 'operator', draftId: 'quote-a',
  expectedInputHash: 'hash-a', channel: 'email',
  providerReference: 'mail-1', idempotencyKey: 'quote-evidence-a',
}), { evidenceId: 'evidence-a', status: 'submitted_unverified' });
assert.deepEqual(quoteEvidenceAdapterInput[0], {
  tenantId, userId: 'quote-operator', role: 'social_operator',
});
assert.equal(quoteEvidenceAdapterInput[4], 'hash-a', 'quote evidence must bind the displayed draft input hash');
assert.deepEqual(quoteEvidenceAdapterInput[3], {
  channel: 'email', artifactHash: 'a'.repeat(64), providerReference: 'mail-1',
}, 'quote evidence must derive the immutable artifact hash on the server');

const usage = aggregateStarterAgentUsage({
  tenantId,
  runStatus: 'running',
  resourceLimits: limits,
  ledgerRecords: [{
    id: 'usage-content',
    tenant_id: tenantId,
    schema_version: 'starter-198.usage.v1',
    run_id: 'run-a',
    task_id: 'task-content',
    agent_role: 'content',
    capability: 'workflow.standard.run',
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      cacheTokens: 10,
      estimatedCostCny: 1.5,
      reservedCostDeltaCny: 0.5,
      settledCostCny: 1,
      costStatus: 'known',
      outputCount: 2,
      waitReason: null,
      anomalyCode: null,
    },
    occurred_at: '2026-09-12T00:10:00.000Z',
  }, {
    id: 'usage-traffic',
    tenant_id: tenantId,
    schema_version: 'starter-198.usage.v1',
    run_id: 'run-a',
    task_id: 'task-traffic',
    agent_role: 'traffic',
    capability: 'publishing.package.generate',
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheTokens: null,
      estimatedCostCny: null,
      reservedCostDeltaCny: null,
      settledCostCny: null,
      costStatus: 'unknown',
      outputCount: 0,
      waitReason: '等待平台',
      anomalyCode: 'provider_usage_missing',
    },
    occurred_at: '2026-09-12T00:11:00.000Z',
  }],
  tasks: [
    { id: 'task-content', tenant_id: tenantId, task_key: 'content_script', agent_role: 'content', status: 'succeeded' },
    { id: 'task-traffic', tenant_id: tenantId, task_key: 'publish', agent_role: 'channel', business_domain: 'publishing', status: 'waiting_external', blocked_reason: '等待平台' },
  ],
});
assert.deepEqual(usage.map(item => item.role), ['orchestrator', 'content', 'traffic', 'sales']);
const content = usage.find(item => item.role === 'content')!;
assert.deepEqual(content.tokens, { input: 100, output: 40, cache: 10, total: 150 });
assert.deepEqual(content.costCny.estimated, 1.5);
assert.deepEqual(content.budgetCny, { total: 25, used: 1, reserved: 0.5, remaining: 23.5, projectedOverrun: false });
const traffic = usage.find(item => item.role === 'traffic')!;
assert.equal(traffic.costCny.estimated, null, 'unknown provider cost must never become zero');
assert.equal(traffic.budgetCny.remaining, null, 'unknown cost must not invent remaining budget');
assert.ok(traffic.anomalies.includes('usage_cost_unknown'));
assert.ok(traffic.waits.reasons.includes('等待标准工作流前置条件'));
assert.equal(JSON.stringify(traffic).includes('等待平台'), false, 'raw internal wait reasons must not reach the customer workspace');
const idle = usage.find(item => item.role === 'sales')!;
assert.equal(idle.tokens.total, null, 'absence of ledger entries must remain unavailable, not zero');
const blockedUsage = aggregateStarterAgentUsage({
  tenantId,
  runStatus: 'blocked',
  resourceLimits: limits,
  ledgerRecords: [],
  tasks: [{
    id: 'unimplemented-handler', tenant_id: tenantId, agent_role: 'sales', status: 'waiting_external',
    output: {
      schemaVersion: 'starter-198.registered-handler-wait.v1',
      implementationAvailable: false,
    },
  }],
});
assert.equal(blockedUsage.find(item => item.role === 'sales')?.status, 'blocked',
  'a registered placeholder must be shown as unavailable, never as active execution');

const rows = new Map<string, Array<{ id: string } & Record<string, unknown>>>([
  [STARTER_COLLECTIONS.access, [structuredClone(accessRecord)]],
  [STARTER_COLLECTIONS.agentTasks, []],
  [STARTER_COLLECTIONS.commands, []],
  [STARTER_COLLECTIONS.tasks, []],
  [STARTER_COLLECTIONS.approvals, []],
  [STARTER_COLLECTIONS.runs, [{
    id: 'run-command-a', tenant_id: tenantId, product_profile: 'starter_198',
    status: 'running', started_at: '2026-09-12T01:00:00.000Z', completed_at: '',
  }]],
  [STARTER_COLLECTIONS.usage, [{
    id: 'usage-command-a', tenant_id: tenantId, schema_version: 'starter-198.usage.v1',
    run_id: 'run-command-a', task_id: 'task-command-a', agent_role: 'orchestrator',
    capability: 'orchestrator.command.submit',
    usage: {
      inputTokens: 1, outputTokens: 1, cacheTokens: 0, estimatedCostCny: 0.01,
      reservedCostDeltaCny: 0, settledCostCny: 0.01, costStatus: 'known',
      outputCount: 0, waitReason: null, anomalyCode: null,
    },
    occurred_at: '2026-09-12T01:01:00.000Z',
  }]],
  [STARTER_COLLECTIONS.publicationPackages, []],
  [STARTER_COLLECTIONS.quoteDrafts, []],
  [STARTER_COLLECTIONS.quoteArtifacts, []],
  [STARTER_COLLECTIONS.quoteSendEvidence, []],
]);
let failCommandFinalizeOnce = false;
const memoryStore = {
  async getById(collection, id) { return rows.get(collection)?.find(row => row.id === id) ?? null; },
  async create(collection, data) {
    const bucket = rows.get(collection) ?? [];
    if (bucket.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)) return null;
    const record = { id: `${collection}-${bucket.length + 1}`, ...structuredClone(data) };
    bucket.push(record);
    rows.set(collection, bucket);
    return record;
  },
  async update(collection, id, data) {
    const record = rows.get(collection)?.find(row => row.id === id);
    if (!record) return false;
    if (collection === STARTER_COLLECTIONS.commands && ['succeeded', 'accepted'].includes(String(data.status)) && failCommandFinalizeOnce) {
      failCommandFinalizeOnce = false;
      return false;
    }
    Object.assign(record, structuredClone(data));
    return true;
  },
  async delete(collection, id) {
    const bucket = rows.get(collection) ?? [];
    const next = bucket.filter(row => row.id !== id);
    if (next.length === bucket.length) return false;
    rows.set(collection, next);
    return true;
  },
  async list(collection, query: ListQuery = {}) {
    const all = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return { items: all.slice((page - 1) * perPage, page * perPage), totalItems: all.length, totalPages: Math.ceil(all.length / perPage), page, perPage };
  },
} as DataStore;
const repository = createStarter198Repository(memoryStore);
rows.get(STARTER_COLLECTIONS.access)?.push({
  ...structuredClone(accessRecord), id: 'access-record-foreign', tenant_id: 'starter-tenant-foreign',
});
const cannotOverrideTenantScope = await repository.list(STARTER_COLLECTIONS.access, tenantId, {
  where: { tenant_id: 'starter-tenant-foreign' },
});
assert.deepEqual(cannotOverrideTenantScope.items.map(item => item.id), ['access-record-1'],
  'a caller-supplied where clause must never replace the repository tenant boundary');
const envelope: AgentTaskEnvelopeV1 = {
  schemaVersion: 'starter-198.agent-task.v1',
  tenantId,
  runId: 'run-a',
  taskId: 'starter-task-a',
  correlationId: 'correlation-a',
  sourceAgent: 'orchestrator',
  targetAgent: 'content',
  goal: '生成已核实事实的内容草稿',
  factSetVersion: 'facts-v1',
  policyVersion: 'policy-v1',
  entitlementSnapshotId: 'snapshot-v1',
  inputObjectRefs: [{ type: 'product', id: 'product-a', version: '1' }],
  expectedOutputSchema: 'content-draft.v1',
  riskLevel: 'L1',
  deadline: '2026-09-13T00:00:00.000Z',
  idempotencyKey: 'task-idempotency-a',
};
assert.equal((await persistStarterAgentTask(envelope, repository)).created, true);
assert.equal((await persistStarterAgentTask(envelope, repository)).created, false);
await assert.rejects(
  () => persistStarterAgentTask({ ...envelope, sourceAgent: 'content', targetAgent: 'traffic' }, repository),
  (error: unknown) => error instanceof Starter198AgentTaskError && error.code === 'starter_agent_direct_child_command_forbidden',
);
const handoff = buildStarterAgentHandoff({
  envelope,
  sourceAgent: 'content',
  result: {
    schemaVersion: 'starter-198.agent-result.v1',
    status: 'succeeded',
    outputs: [{ type: 'content', id: 'content-a', version: '1' }],
    evidence: [{ type: 'fact-set', id: 'facts-v1' }],
    missingFacts: [],
    risks: [],
    requiresDecision: false,
    suggestedNextAction: null,
    checkpoint: {},
  },
  now: new Date('2026-09-12T01:00:00.000Z'),
});
assert.equal(handoff.sourceAgent, 'content');
assert.equal(handoff.targetAgent, 'orchestrator');

failCommandFinalizeOnce = true;
const pauseRequest = {
  command: 'pause_run' as const,
  idempotencyKey: 'pause-crash-gap-1',
  targetId: 'run-command-a',
  expectedVersion: 'running:2026-09-12T01:00:00.000Z:',
  payload: {},
};
await assert.rejects(
  () => runStarter198Command({ tenantId, userId: 'actor-a', role: 'owner', request: pauseRequest, dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z') } }),
  (error: unknown) => error instanceof Starter198CommandError && error.code === 'starter_198_command_journal_finalize_failed',
);
assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.[0].status, 'paused');
assert.equal('updated_at' in (rows.get(STARTER_COLLECTIONS.runs)?.[0] ?? {}), false,
  'workflow_runs schema has no updated_at field and run controls must not invent one');
assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.[0].status, 'processing');
const reconciledPause = await runStarter198Command({ tenantId, userId: 'actor-a', role: 'owner', request: pauseRequest, dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z') } });
assert.equal(reconciledPause.status, 200);
assert.equal(reconciledPause.body.accepted, true);
assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.[0].status, 'succeeded');

const commandCountBeforeLegacyTarget = rows.get(STARTER_COLLECTIONS.commands)?.length ?? 0;
rows.get(STARTER_COLLECTIONS.runs)?.push({
  id: 'run-advanced-same-tenant', tenant_id: tenantId, product_profile: 'advanced_delivery',
  status: 'running', started_at: '2026-09-12T01:05:00.000Z', completed_at: '',
});
await assert.rejects(
  () => runStarter198Command({
    tenantId, userId: 'actor-a', role: 'owner',
    request: {
      command: 'pause_run', idempotencyKey: 'pause-advanced-target',
      targetId: 'run-advanced-same-tenant', expectedVersion: 'running:2026-09-12T01:05:00.000Z:', payload: {},
    },
    dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z') },
  }),
  (error: unknown) => error instanceof Starter198CommandError
    && error.code === 'starter_198_run_not_found' && error.status === 404,
  'the starter command surface must hide and reject same-tenant advanced runs',
);
assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.find(run => run.id === 'run-advanced-same-tenant')?.status, 'running');
assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.length, commandCountBeforeLegacyTarget,
  'an out-of-scope target must be rejected before a command journal row is created');
rows.get(STARTER_COLLECTIONS.runs)!.find(run => run.id === 'run-advanced-same-tenant')!.status = 'completed';

rows.get(STARTER_COLLECTIONS.tasks)?.push({
  id: 'legacy-task-on-starter-run', tenant_id: tenantId, run_id: 'run-command-a',
  task_key: 'advanced_manual_delivery', policy_source: 'advanced.v1', status: 'pending',
});
const commandCountBeforeMixedCancellation = rows.get(STARTER_COLLECTIONS.commands)?.length ?? 0;
await assert.rejects(
  () => runStarter198Command({
    tenantId, userId: 'actor-a', role: 'owner',
    request: {
      command: 'cancel_run', idempotencyKey: 'cancel-mixed-graph', targetId: 'run-command-a',
      expectedVersion: 'paused:2026-09-12T01:00:00.000Z:', payload: { reason: '取消' },
    },
    dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z') },
  }),
  (error: unknown) => error instanceof Starter198CommandError
    && error.code === 'starter_198_workflow_scope_invalid' && error.status === 409,
  'starter cancellation must not cascade into a mixed legacy/advanced task graph',
);
assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.find(run => run.id === 'run-command-a')?.status, 'paused');
assert.equal(rows.get(STARTER_COLLECTIONS.tasks)?.find(task => task.id === 'legacy-task-on-starter-run')?.status, 'pending');
assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.length, commandCountBeforeMixedCancellation);
rows.set(STARTER_COLLECTIONS.tasks, []);

const commandCountBeforeClosedCycle = rows.get(STARTER_COLLECTIONS.commands)?.length ?? 0;
let closedCycleQueueCalls = 0;
await assert.rejects(
  () => runStarter198Command({
    tenantId, userId: 'actor-a', role: 'owner',
    request: { command: 'submit_orchestrator_input', idempotencyKey: 'closed-cycle-command', payload: { input: '开始新一轮' } },
    dependencies: {
      repository, now: () => new Date('2026-09-19T00:00:00.000Z'),
      orchestratorQueue: { async enqueue() { closedCycleQueueCalls += 1; return { queueItemId: 'must-not-run' }; } },
    },
  }),
  (error: unknown) => error instanceof Starter198CommandError
    && error.code === 'starter_198_command_forbidden' && error.status === 403,
  'a closed cycle must remove command capability before any durable operation',
);
assert.equal(closedCycleQueueCalls, 0);
assert.equal(rows.get(STARTER_COLLECTIONS.commands)?.length, commandCountBeforeClosedCycle);

let enqueueCalls = 0;
failCommandFinalizeOnce = true;
const queueRequest = { command: 'submit_orchestrator_input' as const, idempotencyKey: 'queue-crash-gap-1', payload: { input: '请编排本周任务' } };
await assert.rejects(
  () => runStarter198Command({
    tenantId, userId: 'actor-a', role: 'owner', request: queueRequest,
    dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z'), orchestratorQueue: { async enqueue() { enqueueCalls += 1; return { queueItemId: 'queue-a' }; } } },
  }),
  (error: unknown) => error instanceof Starter198CommandError && error.code === 'starter_198_command_journal_finalize_failed',
);
await assert.rejects(
  () => runStarter198Command({
    tenantId, userId: 'actor-a', role: 'owner', request: queueRequest,
    dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z'), orchestratorQueue: { async enqueue() { enqueueCalls += 1; return { queueItemId: 'queue-b' }; } } },
  }),
  (error: unknown) => error instanceof Starter198CommandError && error.code === 'starter_198_command_state_unknown',
);
assert.equal(enqueueCalls, 1, 'an external queue operation must never be blindly replayed across a journal crash gap');

const unavailableRequest = { command: 'submit_orchestrator_input' as const, idempotencyKey: 'queue-unavailable-1', payload: { input: '执行任务' } };
await assert.rejects(
  () => runStarter198Command({ tenantId, userId: 'actor-a', role: 'owner', request: unavailableRequest, dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z') } }),
  (error: unknown) => error instanceof Starter198CommandError && error.code === 'starter_198_orchestrator_worker_unavailable' && error.status === 503,
);
let replayEnqueueCalls = 0;
await assert.rejects(
  () => runStarter198Command({
    tenantId, userId: 'actor-a', role: 'owner', request: unavailableRequest,
    dependencies: { repository, now: () => new Date('2026-09-12T01:30:00.000Z'), orchestratorQueue: { async enqueue() { replayEnqueueCalls += 1; return { queueItemId: 'must-not-run' }; } } },
  }),
  (error: unknown) => error instanceof Starter198CommandError && error.code === 'starter_198_orchestrator_worker_unavailable' && error.status === 503,
);
assert.equal(replayEnqueueCalls, 0, 'failed journal replay must preserve the original HTTP failure and not execute later');

rows.get(STARTER_COLLECTIONS.runs)![0].status = 'cancelling';
await assert.rejects(
  () => assertOrchestratorAdmissionQuota({ repository, tenantId, limits }),
  (error: unknown) => error instanceof Starter198QuotaError
    && error.code === 'starter_198_concurrent_run_quota_exceeded',
  'a new run must be rejected while the prior run is cancelling',
);
const usageRow = rows.get(STARTER_COLLECTIONS.usage)?.[0];
if (!usageRow) throw new Error('usage fixture missing');
const validUsage = structuredClone(usageRow.usage);
usageRow.usage = { ...(usageRow.usage as Record<string, unknown>), costStatus: 'unknown', settledCostCny: null };
await assert.rejects(
  () => assertOrchestratorAdmissionQuota({
    repository, tenantId, limits: { ...limits, concurrentRunCount: 2 },
  }),
  (error: unknown) => error instanceof Starter198QuotaError && error.code === 'starter_198_budget_ledger_unavailable',
);
usageRow.usage = validUsage;
await assertPublicationPackageQuota({ repository, tenantId, contentId: 'content-quota-a', limits });
rows.get(STARTER_COLLECTIONS.publicationPackages)?.push({
  id: 'package-quota-a', tenant_id: tenantId, content_id: 'content-quota-a',
});
await assert.rejects(
  () => assertPublicationPackageQuota({
    repository, tenantId, contentId: 'content-quota-a',
    limits: { ...limits, publicationPackageCountPerContent: 1 },
  }),
  (error: unknown) => error instanceof Starter198QuotaError && error.code === 'starter_198_publication_package_quota_exceeded',
);
rows.get(STARTER_COLLECTIONS.quoteDrafts)?.push({
  id: 'quote-quota-a', tenant_id: tenantId, idempotency_key: 'quote-quota-old',
  created_at: '2026-09-12T03:00:00.000Z',
});
await assert.rejects(
  () => assertQuoteDraftQuota({
    repository, tenantId, cycleStartedAt: '2026-09-12T00:00:00.000Z',
    cycleEndsAt: '2026-09-19T00:00:00.000Z', now: new Date('2026-09-13T00:00:00.000Z'),
    limits: { ...limits, quoteDraftCountPerCycle: 1 }, idempotencyKey: 'quote-quota-new',
  }),
  (error: unknown) => error instanceof Starter198QuotaError && error.code === 'starter_198_quote_draft_quota_exceeded',
);
await assert.rejects(
  () => assertQuoteDraftQuota({
    repository, tenantId, cycleStartedAt: '2026-09-01T00:00:00.000Z',
    cycleEndsAt: '2026-09-08T00:00:00.000Z', now: new Date('2026-09-12T00:00:00.000Z'),
    limits, idempotencyKey: 'quote-closed-cycle',
  }),
  (error: unknown) => error instanceof Starter198QuotaError && error.code === 'starter_198_quote_cycle_closed',
);

const provisioned = await provisionStarter198({
  tenantId: 'starter-provision-b',
  actor: { userId: 'internal-admin-a', role: 'internal_admin' },
  idempotencyKey: 'provision-request-1',
  repository,
  compatibilityStore: memoryStore,
  now: new Date('2026-09-12T02:00:00.000Z'),
});
assert.equal(provisioned.created, true);
assert.equal(provisioned.access.profileVersion, 'starter_198.v1');
assert.equal(provisioned.access.cycleStartedAt, '2026-09-12T02:00:00.000Z');
assert.equal(provisioned.access.cycleEndsAt, '2026-09-19T02:00:00.000Z');
assert.deepEqual({
  member: STARTER_198_DEFAULT_LIMITS.memberCount,
  product: STARTER_198_DEFAULT_LIMITS.productCount,
  market: STARTER_198_DEFAULT_LIMITS.marketCount,
  persona: STARTER_198_DEFAULT_LIMITS.buyerPersonaCount,
  language: STARTER_198_DEFAULT_LIMITS.languageCount,
  platform: STARTER_198_DEFAULT_LIMITS.primaryPlatformCount,
  content: STARTER_198_DEFAULT_LIMITS.contentArtifactCountPerCycle,
  revision: STARTER_198_DEFAULT_LIMITS.contentRevisionCountPerCycle,
  package: STARTER_198_DEFAULT_LIMITS.publicationPackageCountPerContent,
  assisted: STARTER_198_DEFAULT_LIMITS.assistedSessionCount,
  inquiry: STARTER_198_DEFAULT_LIMITS.inquiryAiCountPerCycle,
  quote: STARTER_198_DEFAULT_LIMITS.quoteDraftCountPerCycle,
}, { member: 2, product: 1, market: 1, persona: 1, language: 1, platform: 1, content: 2, revision: 1, package: 1, assisted: 0, inquiry: 10, quote: 10 });
assert.equal((await provisionStarter198({
  tenantId: 'starter-provision-b',
  actor: { userId: 'internal-admin-a', role: 'internal_admin' },
  idempotencyKey: 'provision-request-1',
  repository,
  compatibilityStore: memoryStore,
})).created, false, 'same tenant/idempotency must replay');
await assert.rejects(
  () => provisionStarter198({
    tenantId: 'starter-provision-b',
    actor: { userId: 'internal-admin-a', role: 'internal_admin' },
    idempotencyKey: 'provision-request-2',
    repository,
    compatibilityStore: memoryStore,
  }),
  (error: unknown) => error instanceof Starter198ProvisioningError && error.code === 'starter_198_already_provisioned',
);

const foundationMigration = fs.readFileSync(new URL('../../pb_migrations/1789344000_create_starter198_foundation.js', import.meta.url), 'utf8');
for (const field of ['provisioning_idempotency_key', 'provisioning_request_hash', 'created_by', 'cycle_started_at', 'cycle_ends_at']) {
  assert.match(foundationMigration, new RegExp(`text\\(\\"${field}\\"`), `starter access migration must persist ${field}`);
}
assert.match(foundationMigration, /CREATE UNIQUE INDEX idx_starter_publication_content_limit[\s\S]*tenant_id, content_id/,
  'launch limit of one package per content must be race-safe across processes');
const cancellingGuardMigration = fs.readFileSync(
  new URL('../../pb_migrations/1789689600_update_starter198_cancelling_active_run_guard.js', import.meta.url),
  'utf8',
);
assert.match(cancellingGuardMigration,
  /const guard = "[^"]*product_profile = 'starter_198' AND status = 'cancelling'/,
  'the database single-active-run guard must treat cancelling as active');
assert.match(cancellingGuardMigration,
  /const previousGuard = "[^"]*status = 'waiting_human'[^\n]*status = 'paused'/,
  'migration rollback must restore the immediately preceding waiting_human-aware guard');
assert.doesNotMatch(fs.readFileSync(new URL('./provisioning.ts', import.meta.url), 'utf8'), /subscription|purchase/i,
  'starter provisioning must not read subscription or purchase state');
assert.equal((await provisionStarter198({
  tenantId: 'starter-provision-c',
  actor: { userId: 'internal-admin-a', role: 'internal_admin' },
  idempotencyKey: 'provision-request-1',
  repository,
  compatibilityStore: memoryStore,
})).created, true, 'an idempotency key is tenant-scoped and must not cross provision another tenant');
await assert.rejects(
  () => provisionStarter198({
    tenantId: 'starter-provision-d',
    actor: { userId: 'not-internal', role: 'admin' } as unknown as { userId: string; role: 'internal_admin' },
    idempotencyKey: 'provision-request-3',
    repository,
    compatibilityStore: memoryStore,
  }),
  (error: unknown) => error instanceof Starter198ProvisioningError && error.code === 'starter_198_internal_admin_required',
);

console.log('starter_198 foundation contracts passed');
