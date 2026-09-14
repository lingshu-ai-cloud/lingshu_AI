import assert from 'node:assert/strict';
import {
  buildStarterAgentHandoff,
  completeMeteredStarterAgentTask,
  enqueueApprovedContentPublicationPackageTask,
  meterStarterAgentTaskForExecution,
  readConsumablePublicationPackageTask,
} from './agentTasks.js';
import type { Starter198Repository, StarterCollection, StarterRecord } from './repository.js';
import type { Starter198AccessSnapshot } from './profile.js';

const tenantId = 'tenant-package-task';
const access: Starter198AccessSnapshot = {
  recordId: 'access-1',
  tenantId,
  productProfile: 'starter_198',
  profileVersion: 'starter_198.v1',
  entitlementSnapshotId: 'entitlement-1',
  entitlements: [{ capability: 'publishing.package.generate', enabled: true }],
  resourceLimits: {
    workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
    productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
    primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
    contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
    assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
    highCostVideoCount: 0, budgetCnyPerCycle: 100,
    agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
  },
  status: 'active',
  cycleStartedAt: '2026-09-12T00:00:00.000Z',
  cycleEndsAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
};

const rows = new Map<StarterCollection, StarterRecord[]>([
  ['starter_agent_tasks', []],
  ['starter_agent_handoffs', []],
  ['starter_usage_ledger', []],
  ['approval_requests', [{
    id: 'approval-1', tenant_id: tenantId, status: 'pending', subject_version: 9,
    content_hash: 'frozen-content-hash',
  }]],
]);
const createdCollections: string[] = [];
const repository: Starter198Repository = {
  async access() { return access; },
  async list(collection, requestedTenant, query = {}) {
    assert.equal(requestedTenant, tenantId);
    let items = (rows.get(collection) ?? []).filter(record => Object.entries(query.where ?? {})
      .every(([key, value]) => record[key] === value));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 500;
    items = items.slice((page - 1) * perPage, page * perPage);
    return { items: structuredClone(items), totalItems: items.length, totalPages: items.length ? 1 : 0, page, perPage };
  },
  async get(collection, requestedTenant, id) {
    assert.equal(requestedTenant, tenantId);
    return structuredClone((rows.get(collection) ?? []).find(record => record.id === id) ?? null);
  },
  async create(collection, requestedTenant, data) {
    assert.equal(requestedTenant, tenantId);
    createdCollections.push(collection);
    const row = { id: `${collection}-${(rows.get(collection)?.length ?? 0) + 1}`, tenant_id: tenantId, ...structuredClone(data) };
    rows.set(collection, [...(rows.get(collection) ?? []), row]);
    return structuredClone(row);
  },
  async update(collection, requestedTenant, id, data) {
    assert.equal(requestedTenant, tenantId);
    const row = (rows.get(collection) ?? []).find(record => record.id === id);
    if (!row) throw new Error('missing');
    Object.assign(row, structuredClone(data));
  },
};

const input = {
  tenantId,
  runId: 'run-1',
  approvalId: 'approval-1',
  approvalTaskId: 'approval-task-1',
  subjectVersion: '9',
  contentHash: 'frozen-content-hash',
};
const first = await enqueueApprovedContentPublicationPackageTask(input, repository);
const replay = await enqueueApprovedContentPublicationPackageTask(input, repository);
assert.equal(first.created, true);
assert.equal(replay.created, false);
assert.equal(replay.taskId, first.taskId);
assert.equal(rows.get('starter_agent_tasks')?.length, 1, 'idempotent approval replay creates one durable task');
assert.deepEqual(createdCollections, ['starter_agent_tasks', 'starter_usage_ledger'],
  'enqueue creates one task and one truthful zero-cost reservation');

const record = rows.get('starter_agent_tasks')![0];
const envelope = record.envelope as Record<string, any>;
assert.equal(envelope.targetAgent, 'traffic');
assert.equal(envelope.expectedOutputSchema, 'starter-publication-package.v1');
assert.match(envelope.goal, /不得调用平台账号、创建发布日历或标记已发布/);
assert.equal(await readConsumablePublicationPackageTask(tenantId, first.taskId, repository), null,
  'consumer cannot execute before the approval commit');

rows.get('approval_requests')![0].status = 'approved';
assert.equal((await readConsumablePublicationPackageTask(tenantId, first.taskId, repository))?.taskId, first.taskId,
  'an approved deterministic package task is already protected by its enqueue-time zero-cost reservation');
const metered = await meterStarterAgentTaskForExecution({
  tenantId,
  taskId: first.taskId,
  capability: 'publishing.package.generate',
  cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
  resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
  repository,
  now: new Date('2026-09-12T01:00:00.000Z'),
});
assert.equal(metered.changed, false, 'enqueue-time metering makes the approved task worker-ready');
assert.equal((await meterStarterAgentTaskForExecution({
  tenantId,
  taskId: first.taskId,
  capability: 'publishing.package.generate',
  cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
  repository,
  now: new Date('2026-09-12T01:00:00.000Z'),
})).changed, false, 'metering replay returns the existing reservation');
await assert.rejects(
  () => meterStarterAgentTaskForExecution({
    tenantId,
    taskId: first.taskId,
    capability: 'publishing.package.generate',
    cost: { status: 'known', estimatedCostCny: 0.4, reservedCostCny: 0.5 },
    repository,
    now: new Date('2026-09-12T01:00:00.000Z'),
  }),
  (error: unknown) => error instanceof Error && error.message === 'starter_198_usage_idempotency_conflict',
  'a metering replay cannot silently change the reserved price',
);
const consumable = await readConsumablePublicationPackageTask(tenantId, first.taskId, repository);
assert.equal(consumable?.taskId, first.taskId);
assert.equal(consumable?.factSetVersion, 'frozen-content-hash');
assert.equal(consumable?.idempotencyKey, envelope.idempotencyKey);

rows.get('approval_requests')![0].content_hash = 'changed-after-approval';
assert.equal(await readConsumablePublicationPackageTask(tenantId, first.taskId, repository), null,
  'consumer fails closed if the approved content hash no longer matches');
rows.get('approval_requests')![0].content_hash = 'frozen-content-hash';

const result = {
  schemaVersion: 'starter-198.agent-result.v1' as const,
  status: 'succeeded' as const,
  outputs: [{ type: 'starter_publication_package', id: 'package-1', version: '1' }],
  evidence: [],
  missingFacts: [],
  risks: [],
  requiresDecision: false,
  suggestedNextAction: null,
  checkpoint: { packageId: 'package-1' },
};
const handoff = buildStarterAgentHandoff({
  envelope: metered.envelope,
  sourceAgent: 'traffic',
  result,
  handoffId: 'handoff-package-1',
  now: new Date('2026-09-12T01:01:00.000Z'),
});
const completion = {
  handoff,
  idempotencyKey: 'complete-package-1',
  tokens: { status: 'known' as const, inputTokens: 20, outputTokens: 10, cacheTokens: 2 },
  cost: { status: 'known' as const, settledCostCny: 0 },
  outputCount: 1,
  resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
  repository,
  now: new Date('2026-09-12T01:01:00.000Z'),
};
await completeMeteredStarterAgentTask(completion);
await completeMeteredStarterAgentTask(completion);
assert.equal(rows.get('starter_agent_handoffs')?.length, 1, 'worker completion replay creates one handoff');
assert.equal(rows.get('starter_usage_ledger')?.length, 2, 'worker completion replay creates one reserve and one terminal event');
assert.equal(rows.get('starter_agent_tasks')?.[0].status, 'succeeded');
assert.equal(await readConsumablePublicationPackageTask(tenantId, first.taskId, repository), null,
  'a completed task is no longer consumer-visible');

assert.equal(createdCollections.includes('starter_publication_packages'), false);
assert.equal(createdCollections.includes('posts'), false);
console.log('Starter publication-package task is approval-gated, content-bound, idempotent and contains no calendar/provider/published effect');
