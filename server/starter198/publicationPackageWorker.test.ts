import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  STARTER_198_CAPABILITIES,
  type AgentTaskEnvelopeV1,
} from '../../shared/contracts/starter198.js';
import { cancelDigitalEmployeeRun } from '../digitalEmployees/runCancellation.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { enqueueApprovedContentPublicationPackageTask } from './agentTasks.js';
import {
  consumeStarterPublicationPackageTask,
  readCanonicalStarterContentArtifact,
  runStarterPublicationPackageWorkerCycle,
  StarterPublicationPackageWorkerError,
} from './publicationPackageWorker.js';
import {
  createStarter198Repository,
  STARTER_COLLECTIONS,
  type Starter198Repository,
} from './repository.js';

type Row = { id: string } & Record<string, unknown>;
const tenantId = 'starter-worker-tenant';
const runId = 'starter-worker-run';
const now = new Date('2026-09-12T04:00:00.000Z');
const rows = new Map<string, Row[]>();
let serial = 0;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const dataStore: DataStore = {
  async getById(collection, id) {
    return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as never;
  },
  async list(collection: string, query: ListQuery = {}) {
    let selected = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const fields = query.sort.split(',').map(field => ({
        descending: field.startsWith('-'),
        key: field.startsWith('-') ? field.slice(1) : field,
      }));
      selected = [...selected].sort((left, right) => {
        for (const field of fields) {
          const comparison = String(left[field.key] ?? '').localeCompare(String(right[field.key] ?? ''));
          if (comparison) return comparison * (field.descending ? -1 : 1);
        }
        return 0;
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
        : collection === STARTER_COLLECTIONS.agentTasks
          ? bucket.some(row => row.tenant_id === data.tenant_id && (
            row.idempotency_key === data.idempotency_key || row.task_id === data.task_id
          ))
          : collection === STARTER_COLLECTIONS.handoffs
            ? bucket.some(row => row.tenant_id === data.tenant_id && row.handoff_id === data.handoff_id)
            : collection === STARTER_COLLECTIONS.publicationPackages
              ? bucket.some(row => row.tenant_id === data.tenant_id && (
                row.idempotency_key === data.idempotency_key || row.package_id === data.package_id
              ))
              : false;
    if (duplicate) return null;
    const record = { id: String(data.id || `row${String(++serial).padStart(12, '0')}`), ...structuredClone(data) } as Row;
    bucket.push(record);
    rows.set(collection, bucket);
    return structuredClone(record) as never;
  },
  async update(collection, id, patch) {
    const record = rows.get(collection)?.find(row => row.id === id);
    if (!record) return false;
    Object.assign(record, structuredClone(patch));
    return true;
  },
  async delete(collection, id) {
    const bucket = rows.get(collection) ?? [];
    const next = bucket.filter(row => row.id !== id);
    if (next.length === bucket.length) return false;
    rows.set(collection, next);
    return true;
  },
};

rows.set(STARTER_COLLECTIONS.access, [{
  id: 'access-worker', tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1',
  entitlement_snapshot_id: 'snapshot-worker',
  feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resource_limits: {
    workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
    productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
    primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
    contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
    assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
    highCostVideoCount: 0, budgetCnyPerCycle: 100,
    agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
  },
  status: 'active', cycle_started_at: '2026-09-01T00:00:00.000Z', cycle_ends_at: '2026-10-01T00:00:00.000Z',
  updated_at: now.toISOString(),
}]);
rows.set(STARTER_COLLECTIONS.usage, []);
rows.set(STARTER_COLLECTIONS.agentTasks, []);
rows.set(STARTER_COLLECTIONS.handoffs, []);
rows.set(STARTER_COLLECTIONS.publicationPackages, []);
rows.set('starter_worker_leases', []);
rows.set('durable_operation_leases', []);
rows.set(STARTER_COLLECTIONS.runs, [{
  id: runId, tenant_id: tenantId, status: 'waiting_approval', current_controller: 'human',
}]);
rows.set(STARTER_COLLECTIONS.tasks, [
  { id: 'approval-task', tenant_id: tenantId, run_id: runId, task_key: 'starter_content_release_approval', status: 'waiting_approval' },
  { id: 'package-task', tenant_id: tenantId, run_id: runId, task_key: 'starter_publication_package', status: 'pending', sequence: 8 },
  { id: 'evidence-task', tenant_id: tenantId, run_id: runId, task_key: 'starter_publication_evidence', status: 'pending', sequence: 9 },
]);
rows.set(STARTER_COLLECTIONS.approvals, [{
  id: 'approval-worker', tenant_id: tenantId, run_id: runId, task_id: 'approval-task', status: 'pending', subject_version: 1,
}]);

const root = await mkdtemp(path.join(tmpdir(), 'starter-publisher-'));
try {
  const tenantRoot = path.join(root, tenantId);
  await mkdir(tenantRoot);
  const assetPath = path.join(tenantRoot, 'approved.mp4');
  await writeFile(assetPath, Buffer.from('deterministic-test-video'));
  const script = 'Approved product script';
  const sourceContentHash = createHash('sha256').update(JSON.stringify(script)).digest('hex');
  rows.set('studio_projects', [{
    id: 'project-worker', tenant_id: tenantId, title: 'Approved content', status: 'ready_for_approval',
    spec: {
      workflowRunId: runId,
      script,
      caption: 'Approved caption',
      platform: 'tiktok',
      hashtags: ['factory'],
      automation: {
        managedBy: 'digital_employee', stage: 'completed', quality: { passed: true },
        contentVersion: 1, contentHash: sourceContentHash, renderOutputPath: assetPath,
      },
    },
  }]);

  const canonical = await readCanonicalStarterContentArtifact({
    tenantId, runId, contentId: 'project-worker', dataStore, publishingRoot: root,
  });
  const approval = rows.get(STARTER_COLLECTIONS.approvals)![0];
  approval.content_hash = canonical.subject.contentHash;
  approval.evidence = [canonical.subject];

  const repository = createStarter198Repository(dataStore);
  const queued = await enqueueApprovedContentPublicationPackageTask({
    tenantId,
    runId,
    approvalId: approval.id,
    approvalTaskId: 'approval-task',
    subjectVersion: '1',
    contentHash: canonical.subject.contentHash,
  }, repository);
  approval.status = 'approved';
  const approvalTask = rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.id === 'approval-task')!;
  approvalTask.status = 'succeeded';
  approvalTask.output = { publicationPackageTaskId: queued.taskId, externalPublishPerformed: false };

  rows.get('starter_worker_leases')!.push({
    id: 'active-lease', tenant_id: tenantId, task_id: queued.taskId, lease_token: 'other-worker',
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
  });
  assert.equal((await consumeStarterPublicationPackageTask({
    tenantId, taskId: queued.taskId,
    dependencies: { dataStore, repository, publishingRoot: root, now: () => now },
  })).state, 'ignored', 'an active cross-process lease prevents duplicate consumption');
  rows.set('starter_worker_leases', []);

  rows.get('durable_operation_leases')!.push({
    id: 'active-run-mutation-lease', tenant_id: tenantId,
    lease_scope: 'starter-run-mutation', subject_id: runId,
    lease_token: 'other-run-writer', owner_id: 'other-run-writer',
    acquired_at: now.toISOString(), expires_at: '2099-01-01T00:00:00.000Z',
  });
  const outcome = await consumeStarterPublicationPackageTask({
    tenantId,
    taskId: queued.taskId,
    dependencies: { dataStore, repository, publishingRoot: root, now: () => now },
  });
  assert.equal(outcome.state, 'ignored', 'a busy run mutation lease defers workflow projection');
  assert.equal(rows.get(STARTER_COLLECTIONS.publicationPackages)?.length, 1);
  const storedManifest = rows.get(STARTER_COLLECTIONS.publicationPackages)?.[0]?.manifest as Record<string, unknown>;
  assert.deepEqual(storedManifest.workflowBinding, {
    schemaVersion: 'starter-198.publication-workflow-binding.v1', runId,
    approvalId: approval.id, approvalTaskId: approvalTask.id, agentTaskId: queued.taskId,
  }, 'only the canonical worker binds the package to its run, approval and agent task');
  assert.equal(rows.get(STARTER_COLLECTIONS.handoffs)?.length, 1);
  assert.equal(rows.get(STARTER_COLLECTIONS.usage)?.length, 2, 'reservation is settled exactly once');
  const terminalUsage = rows.get(STARTER_COLLECTIONS.usage)?.find(row => row.event_type === 'terminal');
  assert.deepEqual((terminalUsage?.usage as Record<string, unknown>)?.input_tokens, 0);
  assert.deepEqual((terminalUsage?.usage as Record<string, unknown>)?.settled_cost_cny, 0);
  assert.equal(rows.get(STARTER_COLLECTIONS.agentTasks)?.[0].status, 'succeeded');
  assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.[0].status, 'waiting_approval');
  assert.equal(rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === 'package-task')?.status, 'pending');
  assert.equal(rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === 'evidence-task')?.status, 'pending');
  assert.equal(rows.get(STARTER_COLLECTIONS.tasks)?.some(row => row.status === 'failed'), false,
    'lease contention cannot be projected as a workflow failure');
  rows.set('durable_operation_leases', []);

  const repaired = await consumeStarterPublicationPackageTask({
    tenantId, taskId: queued.taskId,
    dependencies: { dataStore, repository, publishingRoot: root, now: () => now },
  });
  assert.equal(repaired.state, 'already_succeeded', 'idempotent replay repairs the deferred projection');
  assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.[0].status, 'waiting_human');
  assert.equal(rows.get(STARTER_COLLECTIONS.runs)?.[0].current_controller, 'human');
  assert.equal(rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === 'package-task')?.status, 'succeeded');
  assert.equal(rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === 'evidence-task')?.status, 'waiting_external');
  assert.equal(rows.get('starter_worker_leases')?.length, 0, 'lease is released after completion');
  assert.equal(rows.get('durable_operation_leases')?.length, 0, 'run mutation lease is released after projection');
  assert.equal(rows.has('posts'), false, 'package generation creates no platform post or calendar record');

  const replay = await consumeStarterPublicationPackageTask({
    tenantId, taskId: queued.taskId,
    dependencies: { dataStore, repository, publishingRoot: root, now: () => now },
  });
  assert.equal(replay.state, 'already_succeeded');
  assert.equal(rows.get(STARTER_COLLECTIONS.publicationPackages)?.length, 1);
  assert.equal(rows.get(STARTER_COLLECTIONS.handoffs)?.length, 1);
  assert.equal(rows.get(STARTER_COLLECTIONS.usage)?.length, 2);

  const run = rows.get(STARTER_COLLECTIONS.runs)![0];
  const packageTask = rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.id === 'package-task')!;
  const evidenceTask = rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.id === 'evidence-task')!;

  // Model a different process switching the run to cancelling just after this
  // worker's first lifecycle read. The next pre-write read must see the newer
  // state and preserve both workflow tasks instead of reviving the projection.
  run.status = 'waiting_approval';
  packageTask.status = 'pending';
  packageTask.output = { marker: 'package-before-cancelling' };
  evidenceTask.status = 'pending';
  evidenceTask.output = { marker: 'evidence-before-cancelling' };
  let injectedCancellingState = false;
  const crossProcessRepository: Starter198Repository = {
    ...repository,
    async get(collection, scopedTenantId, id) {
      const record = await repository.get(collection, scopedTenantId, id);
      if (!injectedCancellingState && collection === STARTER_COLLECTIONS.runs && id === runId) {
        injectedCancellingState = true;
        run.status = 'cancelling';
      }
      return record;
    },
  };
  assert.equal((await consumeStarterPublicationPackageTask({
    tenantId,
    taskId: queued.taskId,
    dependencies: { dataStore, repository: crossProcessRepository, publishingRoot: root, now: () => now },
  })).state, 'already_succeeded');
  assert.equal(run.status, 'cancelling', 'a newer cancelling state must never be projected back to waiting_human');
  assert.deepEqual(packageTask.output, { marker: 'package-before-cancelling' }, 'package task remains untouched after cancellation starts');
  assert.deepEqual(evidenceTask.output, { marker: 'evidence-before-cancelling' }, 'evidence task remains untouched after cancellation starts');

  const packageCountBeforeMissingRoot = rows.get(STARTER_COLLECTIONS.publicationPackages)?.length ?? 0;
  await assert.rejects(() => readCanonicalStarterContentArtifact({
    tenantId,
    runId,
    contentId: 'project-worker',
    dataStore,
    publishingRoot: path.join(root, 'missing-publishing-root'),
  }), (error: unknown) => error instanceof StarterPublicationPackageWorkerError
    && error.code === 'starter_publication_asset_unavailable');
  assert.equal(rows.get(STARTER_COLLECTIONS.publicationPackages)?.length, packageCountBeforeMissingRoot,
    'a missing durable asset root fails closed without manufacturing a package');

  // Hold the worker after its first run-state read and race a real cancellation.
  // Both paths share withDigitalEmployeeRunLock, so cancellation must wait for
  // projection and then win last; without the shared lock the worker revives the
  // cancelled run when the barrier opens.
  run.status = 'waiting_approval';
  run.current_controller = 'human';
  packageTask.status = 'pending';
  evidenceTask.status = 'pending';
  const projectionEntered = deferred();
  const releaseProjection = deferred();
  let projectionHeld = false;
  const barrierRepository: Starter198Repository = {
    ...repository,
    async list(collection, scopedTenantId, query) {
      if (!projectionHeld
        && collection === STARTER_COLLECTIONS.tasks
        && query?.where?.run_id === runId) {
        projectionHeld = true;
        projectionEntered.resolve();
        await releaseProjection.promise;
      }
      return repository.list(collection, scopedTenantId, query);
    },
  };
  const projection = consumeStarterPublicationPackageTask({
    tenantId,
    taskId: queued.taskId,
    dependencies: { dataStore, repository: barrierRepository, publishingRoot: root, now: () => now },
  });
  await projectionEntered.promise;
  let cancellationFinished = false;
  const cancellation = cancelDigitalEmployeeRun({
    tenantId,
    userId: 'starter-worker-user',
    runId,
    reason: 'barrier concurrency test',
    dataStore,
    now,
  }).then(result => {
    cancellationFinished = true;
    return result;
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(cancellationFinished, false, 'cancellation waits while publication projection owns the shared run lock');
  releaseProjection.resolve();
  const [projectionOutcome, cancellationOutcome] = await Promise.all([projection, cancellation]);
  assert.equal(projectionOutcome.state, 'already_succeeded');
  assert.equal(cancellationOutcome.alreadyCancelled, false);
  assert.equal(run.status, 'cancelled', 'concurrent cancellation is the terminal winner and cannot be revived');
  assert.equal(run.current_controller, 'human');
  assert.notEqual(run.status, 'waiting_human');

  await assert.rejects(() => readCanonicalStarterContentArtifact({
    tenantId,
    runId,
    contentId: 'project-worker',
    dataStore,
    publishingRoot: path.join(root, 'missing-publishing-root'),
  }), (error: unknown) => error instanceof StarterPublicationPackageWorkerError
    && error.code === 'starter_publication_content_not_canonical');
  assert.equal(
    rows.get(STARTER_COLLECTIONS.publicationPackages)?.length,
    packageCountBeforeMissingRoot,
    'a cancelled source project cannot manufacture a package',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

function scanEnvelope(input: {
  tenantId: string;
  taskId: string;
  approvalId: string;
}): AgentTaskEnvelopeV1 {
  return {
    schemaVersion: 'starter-198.agent-task.v1',
    tenantId: input.tenantId,
    runId: `run-${input.taskId}`,
    taskId: input.taskId,
    correlationId: `correlation-${input.taskId}`,
    sourceAgent: 'orchestrator',
    targetAgent: 'traffic',
    goal: 'bounded publication package scan test',
    factSetVersion: 'a'.repeat(64),
    policyVersion: 'starter_198.v1',
    entitlementSnapshotId: 'scan-entitlement',
    inputObjectRefs: [{ type: 'approval_request', id: input.approvalId, version: '1' }],
    expectedOutputSchema: 'starter-publication-package.v1',
    riskLevel: 'L1',
    budgetReservationId: `reservation-${input.taskId}`,
    deadline: '2026-10-01T00:00:00.000Z',
    idempotencyKey: `idempotency-${input.taskId}`,
  };
}

// Keep a full page of malformed traffic work ahead of two permanently busy
// candidates and one observable later candidate. The old page-one collector
// walked past all malformed rows in one cycle, then selected the same first
// candidate on every later cycle. A resumable raw-row budget must instead
// advance through each obstruction and eventually reach the tail.
rows.clear();
serial = 0;
const malformedScanRows: Row[] = Array.from({ length: 100 }, (_, index) => ({
  id: `scan-invalid-${String(index).padStart(3, '0')}`,
  tenant_id: 'scan-invalid-tenant',
  task_id: `scan-invalid-task-${index}`,
  target_agent: 'traffic',
  status: 'ready',
  envelope: { schemaVersion: 'invalid-envelope' },
  created_at: new Date(now.getTime() + index).toISOString(),
}));
const notReadyEnvelope = scanEnvelope({
  tenantId: 'scan-not-ready-tenant', taskId: 'scan-not-ready', approvalId: 'missing-approval',
});
const leaseBusyEnvelope = scanEnvelope({
  tenantId: 'scan-lease-busy-tenant', taskId: 'scan-lease-busy', approvalId: 'missing-approval',
});
const laterEnvelope = scanEnvelope({
  tenantId: 'scan-later-tenant', taskId: 'scan-later', approvalId: 'scan-later-approval',
});
const envelopeHash = (envelope: AgentTaskEnvelopeV1): string => createHash('sha256')
  .update(JSON.stringify(envelope)).digest('hex');
rows.set(STARTER_COLLECTIONS.agentTasks, [
  ...malformedScanRows,
  ...[notReadyEnvelope, leaseBusyEnvelope, laterEnvelope].map((envelope, index) => ({
    id: `scan-candidate-${index}`,
    tenant_id: envelope.tenantId,
    run_id: envelope.runId,
    task_id: envelope.taskId,
    target_agent: 'traffic',
    status: ['ready', 'pending', 'succeeded'][index],
    budget_reservation_id: envelope.budgetReservationId,
    envelope,
    envelope_hash: envelopeHash(envelope),
    ...(index === 2 ? {
      result: {
        schemaVersion: 'starter-198.agent-result.v1',
        status: 'succeeded',
        outputs: [{ type: 'starter_publication_package', id: 'missing-package', version: 'missing-hash' }],
      },
    } : {}),
    created_at: new Date(now.getTime() + 100 + index).toISOString(),
  })),
]);
rows.set(STARTER_COLLECTIONS.approvals, []);
rows.set(STARTER_COLLECTIONS.publicationPackages, []);
rows.set(STARTER_COLLECTIONS.access, []);
rows.set('starter_worker_leases', [{
  id: 'scan-active-lease',
  tenant_id: leaseBusyEnvelope.tenantId,
  task_id: leaseBusyEnvelope.taskId,
  lease_token: 'other-publication-worker',
  expires_at: new Date(now.getTime() + 60_000).toISOString(),
}]);

const boundedScan = await runStarterPublicationPackageWorkerCycle({
  dependencies: { dataStore, now: () => now }, maxTasks: 100,
});
assert.equal(boundedScan.scanned, 100, 'malformed envelopes consume the hard per-cycle scan budget');
assert.equal(boundedScan.pageReads, 1, 'one cached page is read once even when every row is malformed');
assert.equal(boundedScan.ignored, 100);
assert.equal(boundedScan.scanComplete, false);
assert.ok(boundedScan.nextCursor, 'an incomplete bounded scan exposes a resumable cursor');

const notReadyScan = await runStarterPublicationPackageWorkerCycle({
  dependencies: { dataStore, now: () => now }, maxTasks: 1, cursor: boundedScan.nextCursor,
});
assert.equal(notReadyScan.notReady, 1);
assert.equal(notReadyScan.pageReads, 1);
assert.ok(notReadyScan.nextCursor, 'a not-ready head task cannot pin the cursor');

const leaseBusyScan = await runStarterPublicationPackageWorkerCycle({
  dependencies: { dataStore, now: () => now }, maxTasks: 1, cursor: notReadyScan.nextCursor,
});
assert.equal(leaseBusyScan.ignored, 1);
assert.equal(leaseBusyScan.pageReads, 1);
assert.ok(leaseBusyScan.nextCursor, 'a task leased by another process cannot pin the cursor');

const laterScan = await runStarterPublicationPackageWorkerCycle({
  dependencies: { dataStore, now: () => now }, maxTasks: 1, cursor: leaseBusyScan.nextCursor,
});
assert.equal(laterScan.scanned, 1);
assert.equal(laterScan.errors[0]?.taskId, laterEnvelope.taskId,
  'the fair cursor reaches succeeded repair work behind ready/not-ready and pending/lease-busy rows');
assert.equal(laterScan.pageReads, 1);
assert.equal(laterScan.scanComplete, true);
assert.equal(laterScan.nextCursor, null);
assert.equal(rows.get('starter_worker_leases')?.some(row => row.task_id === laterEnvelope.taskId), false,
  'the later task still releases its lease when consumption fails');

let sparsePageReads = 0;
const sparsePageStore: DataStore = {
  ...dataStore,
  async list<T>(collection: string, query: ListQuery = {}) {
    if (collection === STARTER_COLLECTIONS.agentTasks && query.where?.target_agent === 'traffic') {
      sparsePageReads += 1;
      return {
        items: [],
        totalItems: 1_000_000,
        totalPages: 10_000,
        page: query.page ?? 1,
        perPage: query.perPage ?? 20,
      } as never;
    }
    return dataStore.list<T>(collection, query);
  },
};
const sparsePageScan = await runStarterPublicationPackageWorkerCycle({
  dependencies: { dataStore: sparsePageStore }, maxTasks: 1,
});
assert.equal(sparsePageScan.scanned, 0);
assert.equal(sparsePageScan.pageReads, 2);
assert.equal(sparsePageReads, 2, 'incoherent empty pages cannot cause an unbounded request loop');
assert.ok(sparsePageScan.nextCursor, 'the cursor resumes after the bounded empty-page probe');

await assert.rejects(
  () => runStarterPublicationPackageWorkerCycle({ dependencies: { dataStore }, cursor: 'not-a-valid-cursor' }),
  (error: unknown) => error instanceof StarterPublicationPackageWorkerError
    && error.code === 'starter_publication_worker_cursor_invalid',
  'malformed cursors fail closed instead of silently restarting page one',
);
await assert.rejects(
  () => runStarterPublicationPackageWorkerCycle({
    dependencies: { dataStore }, cursor: `${boundedScan.nextCursor}!`,
  }),
  (error: unknown) => error instanceof StarterPublicationPackageWorkerError
    && error.code === 'starter_publication_worker_cursor_invalid',
  'non-canonical base64url cursors are rejected instead of partially decoded',
);
await assert.rejects(
  () => runStarterPublicationPackageWorkerCycle({ dependencies: { dataStore }, cursor: 'a'.repeat(513) }),
  (error: unknown) => error instanceof StarterPublicationPackageWorkerError
    && error.code === 'starter_publication_worker_cursor_invalid',
  'oversized opaque cursors are rejected before any storage scan',
);

const previousProductionEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
  PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,
};
const previousFetch = globalThis.fetch;
try {
  process.env.NODE_ENV = 'production';
  process.env.PB_URL = 'https://pocketbase.invalid';
  process.env.PB_ADMIN_EMAIL = 'worker@example.test';
  process.env.PB_ADMIN_PASSWORD = 'not-a-real-secret';
  globalThis.fetch = async () => new Response('dependency unavailable', { status: 503 });
  await assert.rejects(
    () => runStarterPublicationPackageWorkerCycle(),
    /starter_agent_tasks read failed \(503\)/,
    'production worker scans must not treat a missing PocketBase dependency as an empty local queue',
  );
} finally {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousProductionEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('starter publication worker passed: lease, canonical hash, metering, fair scan, replay and cancellation-safe projection');
