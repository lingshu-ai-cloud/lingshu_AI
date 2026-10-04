import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import { createDigitalEmployeeApprovalDecisionApplication } from '../digitalEmployees/approvalDecision.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { enqueueApprovedContentPublicationPackageTask } from './agentTasks.js';
import {
  bridgeStarterContentReleaseApproval,
  buildStarterContentQualityBinding,
  StarterContentApprovalBridgeError,
} from './contentApprovalBridge.js';
import { readCanonicalStarterContentArtifact } from './publicationPackageArtifact.js';
import { consumeStarterPublicationPackageTask } from './publicationPackageWorker.js';
import { createStarter198Repository, STARTER_COLLECTIONS, type StarterRecord } from './repository.js';

type Row = StarterRecord;

interface MemoryStore extends DataStore {
  rows: Map<string, Row[]>;
  writes: Array<{ operation: 'create' | 'update'; collection: string; id: string }>;
}

function memoryStore(seed: Record<string, Row[]>, approvalCreateRace = false): MemoryStore {
  const rows = new Map(Object.entries(seed).map(([collection, values]) => [collection, structuredClone(values)]));
  const writes: MemoryStore['writes'] = [];
  let serial = 0;
  return {
    rows,
    writes,
    async getById<T>(collection: string, id: string): Promise<T | null> {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async list<T>(collection: string, query: ListQuery = {}) {
      let selected = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => String(row[key] ?? '') === String(value)));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const key = query.sort.replace(/^-/, '');
        selected = [...selected].sort((left, right) => {
          const compared = String(left[key] ?? '').localeCompare(String(right[key] ?? ''));
          return descending ? -compared : compared;
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 20;
      return {
        items: structuredClone(selected.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: selected.length,
        totalPages: Math.ceil(selected.length / perPage),
        page,
        perPage,
      };
    },
    async create<T>(collection: string, data: Record<string, unknown>): Promise<T | null> {
      const bucket = rows.get(collection) ?? [];
      const duplicate = collection === STARTER_COLLECTIONS.approvals
        && bucket.some(row => row.tenant_id === data.tenant_id && row.task_id === data.task_id);
      if (duplicate) return null;
      const created = { ...structuredClone(data), id: `row${String(++serial).padStart(12, '0')}` } as Row;
      bucket.push(created);
      rows.set(collection, bucket);
      writes.push({ operation: 'create', collection, id: created.id });
      if (approvalCreateRace && collection === STARTER_COLLECTIONS.approvals) return null;
      return structuredClone(created) as T;
    },
    async update(collection: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
      const record = rows.get(collection)?.find(row => row.id === id);
      if (!record) return false;
      Object.assign(record, structuredClone(patch));
      writes.push({ operation: 'update', collection, id });
      return true;
    },
    async delete(): Promise<boolean> { return false; },
  };
}

const tenantId = 'starter-approval-tenant';
const otherTenantId = 'starter-approval-other';
const runId = 'starter-approval-run';
const goalId = 'starter-approval-goal';
const qualityTaskId = 'starter-quality-task';
const approvalTaskId = 'starter-approval-task';
const now = new Date('2026-09-13T08:00:00.000Z');
const script = 'A grounded script about the TB-750 product.';
const resourceLimits = {
  workspaceCount: 1, brandCount: 1, memberCount: 2, agentTeamCount: 1,
  productCount: 1, marketCount: 1, buyerPersonaCount: 1, languageCount: 1,
  primaryPlatformCount: 1, concurrentRunCount: 1, contentArtifactCountPerCycle: 2,
  contentRevisionCountPerCycle: 1, publicationPackageCountPerContent: 1,
  assistedSessionCount: 0, inquiryAiCountPerCycle: 10, quoteDraftCountPerCycle: 10,
  highCostVideoCount: 0, budgetCnyPerCycle: 100,
  agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 },
};

async function fixture(input: {
  projectTenantId?: string;
  projectRunId?: string;
  approvalCreateRace?: boolean;
} = {}): Promise<{ dataStore: MemoryStore; publishingRoot: string; assetPath: string }> {
  const publishingRoot = await mkdtemp(path.join(tmpdir(), 'starter-approval-bridge-'));
  const tenantDirectory = path.join(publishingRoot, tenantId);
  await mkdir(tenantDirectory, { recursive: true });
  const assetPath = path.join(tenantDirectory, 'approved-video.mp4');
  await writeFile(assetPath, Buffer.from('real-video-bytes-for-hash'));
  const sourceContentHash = createHash('sha256').update(JSON.stringify(script)).digest('hex');
  const tasks: Row[] = [{
    id: qualityTaskId,
    tenant_id: tenantId,
    run_id: runId,
    task_key: 'starter_content_quality_gate',
    status: 'succeeded',
    task_version: 3,
    output: {},
  }, {
    id: approvalTaskId,
    tenant_id: tenantId,
    run_id: runId,
    task_key: 'starter_content_release_approval',
    status: 'pending',
    task_version: 4,
    output: {},
  }, {
    id: 'starter-package-task', tenant_id: tenantId, run_id: runId,
    task_key: 'starter_publication_package', status: 'pending', task_version: 1, sequence: 8, output: {},
  }, {
    id: 'starter-evidence-task', tenant_id: tenantId, run_id: runId,
    task_key: 'starter_publication_evidence', status: 'pending', task_version: 1, sequence: 9, output: {},
  }];
  const dataStore = memoryStore({
    [STARTER_COLLECTIONS.access]: [{
      id: 'starteraccess1', tenant_id: tenantId, product_profile: 'starter_198',
      profile_version: 'starter_198.v1', entitlement_snapshot_id: 'starter-snapshot-1',
      feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
      resource_limits: resourceLimits, status: 'active',
      cycle_started_at: '2026-09-01T00:00:00.000Z', cycle_ends_at: '2026-10-01T00:00:00.000Z',
      updated_at: now.toISOString(),
    }],
    [STARTER_COLLECTIONS.usage]: [],
    [STARTER_COLLECTIONS.agentTasks]: [],
    [STARTER_COLLECTIONS.handoffs]: [],
    [STARTER_COLLECTIONS.publicationPackages]: [],
    [STARTER_COLLECTIONS.runs]: [{
      id: runId, tenant_id: tenantId, goal_id: goalId, product_profile: 'starter_198', status: 'running',
    }],
    [STARTER_COLLECTIONS.tasks]: tasks,
    [STARTER_COLLECTIONS.goals]: [{ id: goalId, tenant_id: tenantId, status: 'active' }],
    [STARTER_COLLECTIONS.approvals]: [],
    starter_worker_leases: [],
    studio_projects: [{
      id: 'studio-project-1',
      tenant_id: input.projectTenantId ?? tenantId,
      title: 'TB-750 launch video',
      status: 'ready_for_approval',
      spec: {
        workflowRunId: input.projectRunId ?? runId,
        script,
        caption: 'A verified TB-750 product introduction.',
        hashtags: ['TB750'],
        platform: 'tiktok',
        automation: {
          managedBy: 'digital_employee',
          stage: 'completed',
          quality: { passed: true },
          contentVersion: 7,
          contentHash: sourceContentHash,
          renderOutputPath: assetPath,
        },
      },
    }],
  }, input.approvalCreateRace);
  if ((input.projectTenantId ?? tenantId) === tenantId && (input.projectRunId ?? runId) === runId) {
    const artifact = await readCanonicalStarterContentArtifact({
      tenantId,
      runId,
      contentId: 'studio-project-1',
      dataStore,
      publishingRoot,
    });
    tasks[0]!.output = buildStarterContentQualityBinding({
      tenantId,
      runId,
      qualityTaskId,
      qualityTaskVersion: '3',
      artifact,
    });
    dataStore.rows.set(STARTER_COLLECTIONS.tasks, structuredClone(tasks));
  } else {
    tasks[0]!.output = {
      schemaVersion: 'starter-198.content-quality-output.v1',
      executionStatus: 'completed',
      qualityPassed: true,
      tenantId,
      runId,
      qualityTaskId,
      qualityTaskVersion: '3',
      canonicalContent: {
        type: 'studio_project', id: 'studio-project-1', version: '7',
        sourceContentHash, contentHash: 'a'.repeat(64), platform: 'tiktok',
        fileName: 'approved-video.mp4', fileHash: 'b'.repeat(64),
      },
      bindingHash: 'invalid-for-out-of-scope-fixture',
    };
    dataStore.rows.set(STARTER_COLLECTIONS.tasks, structuredClone(tasks));
  }
  return { dataStore, publishingRoot, assetPath };
}

async function bridge(dataStore: MemoryStore, publishingRoot: string, input: {
  assertExecutionFence?: () => Promise<void>;
} = {}) {
  return bridgeStarterContentReleaseApproval({
    tenantId,
    runId,
    approvalTaskId,
    dependencies: {
      dataStore,
      repository: createStarter198Repository(dataStore),
      publishingRoot,
      now: () => now,
      executionFence: 'lease-fence-1',
      assertExecutionFence: input.assertExecutionFence ?? (async () => {}),
    },
  });
}

const cleanup: string[] = [];
try {
  const valid = await fixture();
  cleanup.push(valid.publishingRoot);
  const created = await bridge(valid.dataStore, valid.publishingRoot);
  assert.equal(created.created, true);
  assert.equal(created.contentId, 'studio-project-1');
  assert.match(created.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(valid.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 1);
  const approval = valid.dataStore.rows.get(STARTER_COLLECTIONS.approvals)![0]!;
  assert.equal(approval.status, 'pending');
  assert.equal(approval.subject_version, 4);
  assert.equal(approval.content_hash, created.contentHash);
  assert.equal(valid.dataStore.rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === approvalTaskId)?.status,
    'waiting_approval');
  assert.equal(valid.dataStore.rows.get(STARTER_COLLECTIONS.runs)?.[0]?.status, 'waiting_approval');
  assert.ok(valid.dataStore.writes.every(write => [
    STARTER_COLLECTIONS.approvals, STARTER_COLLECTIONS.tasks, STARTER_COLLECTIONS.runs,
  ].includes(write.collection as never)), 'bridge cannot write packages, posts, calendars, accounts, or providers');

  // Simulate a crash after the unique approval write but before its task/run
  // projection. The same frozen request must reuse the pending row.
  valid.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0]!.status = 'running';
  const approvalTask = valid.dataStore.rows.get(STARTER_COLLECTIONS.tasks)!.find(row => row.id === approvalTaskId)!;
  approvalTask.status = 'pending';
  approvalTask.output = {};
  const replay = await bridge(valid.dataStore, valid.publishingRoot);
  assert.equal(replay.created, false);
  assert.equal(replay.approvalId, approval.id);
  assert.equal(valid.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 1);

  const raced = await fixture({ approvalCreateRace: true });
  cleanup.push(raced.publishingRoot);
  const racedResult = await bridge(raced.dataStore, raced.publishingRoot);
  assert.equal(racedResult.created, false, 'a unique-index race is reread and converges on the winner');
  assert.equal(raced.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 1);

  const conflicting = await fixture();
  cleanup.push(conflicting.publishingRoot);
  conflicting.dataStore.rows.get(STARTER_COLLECTIONS.approvals)!.push({
    id: 'conflicting-approval', tenant_id: tenantId, goal_id: goalId, run_id: runId,
    task_id: approvalTaskId, status: 'pending', subject_version: 4,
    content_hash: 'f'.repeat(64), requested_by_agent: 'content', evidence: [],
  });
  await assert.rejects(
    () => bridge(conflicting.dataStore, conflicting.publishingRoot),
    (error: unknown) => error instanceof StarterContentApprovalBridgeError
      && error.code === 'starter_content_approval_conflict',
  );
  assert.equal(conflicting.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.[0]?.status, 'superseded',
    'a mismatched pending row is revoked instead of remaining actionable');

  const expired = await fixture();
  cleanup.push(expired.publishingRoot);
  expired.dataStore.rows.get(STARTER_COLLECTIONS.access)![0]!.cycle_ends_at = '2026-09-13T07:59:59.000Z';
  await assert.rejects(
    () => bridge(expired.dataStore, expired.publishingRoot),
    (error: unknown) => error instanceof StarterContentApprovalBridgeError
      && error.code === 'starter_content_approval_capability_unavailable',
  );
  assert.equal(expired.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 0,
    'an expired cycle cannot create a new human-decision surface');

  const integrated = await fixture();
  cleanup.push(integrated.publishingRoot);
  const bridged = await bridge(integrated.dataStore, integrated.publishingRoot);
  const integratedRepository = createStarter198Repository(integrated.dataStore);
  let forbiddenLegacyEffectCalled = false;
  const decide = createDigitalEmployeeApprovalDecisionApplication({
    store: integrated.dataStore,
    buildPublishingPackage: async () => {
      forbiddenLegacyEffectCalled = true;
      throw new Error('legacy publishing package must not be built');
    },
    listConnectedPublishingAccounts: async () => {
      forbiddenLegacyEffectCalled = true;
      return [];
    },
    createPublishingCalendarEntries: async () => {
      forbiddenLegacyEffectCalled = true;
      return [];
    },
    applyFollowupBatchDecision: async () => undefined,
    appendAudit: async () => undefined,
    appendEvent: async () => undefined,
    continueRun: async () => undefined,
    enqueueStarterPublicationPackageTask: input => enqueueApprovedContentPublicationPackageTask(
      { ...input, now },
      integratedRepository,
    ),
    now: () => now,
  });
  const decision = await decide({
    tenantId,
    userId: 'starter-owner',
    approvalId: bridged.approvalId,
    expectedSubjectVersion: bridged.subjectVersion,
    decision: 'approved',
    policy: 'starter_198',
  });
  assert.equal(forbiddenLegacyEffectCalled, false,
    'starter approval must not inspect connected accounts, create calendars, or enter legacy publishing');
  assert.ok(decision.publicationPackageTaskId);
  assert.equal(integrated.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.[0]?.status, 'approved');
  assert.equal(integrated.dataStore.rows.get(STARTER_COLLECTIONS.tasks)
    ?.find(row => row.id === approvalTaskId)?.status, 'succeeded');
  const packageOutcome = await consumeStarterPublicationPackageTask({
    tenantId,
    taskId: decision.publicationPackageTaskId!,
    dependencies: {
      dataStore: integrated.dataStore,
      repository: integratedRepository,
      publishingRoot: integrated.publishingRoot,
      now: () => now,
    },
  });
  assert.equal(packageOutcome.state, 'succeeded');
  const packageNode = integrated.dataStore.rows.get(STARTER_COLLECTIONS.tasks)
    ?.find(row => row.task_key === 'starter_publication_package');
  const evidenceNode = integrated.dataStore.rows.get(STARTER_COLLECTIONS.tasks)
    ?.find(row => row.task_key === 'starter_publication_evidence');
  assert.equal(packageNode?.status, 'succeeded');
  assert.equal(evidenceNode?.status, 'waiting_external');
  assert.equal(integrated.dataStore.rows.get(STARTER_COLLECTIONS.runs)?.[0]?.status, 'waiting_human');
  assert.equal(integrated.dataStore.rows.get(STARTER_COLLECTIONS.publicationPackages)?.length, 1);
  assert.equal(integrated.dataStore.rows.get('posts')?.length ?? 0, 0,
    'the complete starter path creates no post, schedule, account, or provider side effect');

  const tampered = await fixture();
  cleanup.push(tampered.publishingRoot);
  const tamperedProject = tampered.dataStore.rows.get('studio_projects')![0]!;
  const tamperedSpec = tamperedProject.spec as Record<string, any>;
  tamperedSpec.caption = 'changed after quality binding';
  await assert.rejects(
    () => bridge(tampered.dataStore, tampered.publishingRoot),
    (error: unknown) => error instanceof StarterContentApprovalBridgeError
      && error.code === 'starter_content_quality_canonical_changed',
  );
  assert.equal(tampered.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 0);

  const missingFile = await fixture();
  cleanup.push(missingFile.publishingRoot);
  await rm(missingFile.assetPath);
  await assert.rejects(
    () => bridge(missingFile.dataStore, missingFile.publishingRoot),
    (error: unknown) => error instanceof StarterContentApprovalBridgeError
      && error.code === 'starter_publication_asset_unavailable' && error.retryable,
  );
  assert.equal(missingFile.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 0);

  const otherTenant = await fixture({ projectTenantId: otherTenantId });
  cleanup.push(otherTenant.publishingRoot);
  await assert.rejects(() => bridge(otherTenant.dataStore, otherTenant.publishingRoot));
  assert.equal(otherTenant.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.length, 0);

  const cancelled = await fixture();
  cleanup.push(cancelled.publishingRoot);
  let fenceChecks = 0;
  await assert.rejects(
    () => bridge(cancelled.dataStore, cancelled.publishingRoot, {
      assertExecutionFence: async () => {
        fenceChecks += 1;
        if (fenceChecks === 2) cancelled.dataStore.rows.get(STARTER_COLLECTIONS.runs)![0]!.status = 'cancelled';
      },
    }),
    (error: unknown) => error instanceof StarterContentApprovalBridgeError
      && error.code === 'starter_content_approval_run_changed',
  );
  assert.equal(cancelled.dataStore.rows.get(STARTER_COLLECTIONS.approvals)?.[0]?.status, 'superseded',
    'a cancellation observed after approval creation revokes the pending approval');
  assert.equal(cancelled.dataStore.rows.get(STARTER_COLLECTIONS.tasks)?.find(row => row.id === approvalTaskId)?.status,
    'pending', 'cancellation fencing prevents the bridge from reviving the task');
} finally {
  await Promise.all(cleanup.map(directory => rm(directory, { recursive: true, force: true })));
}

console.log('starter content approval bridge passed: canonical artifact binding, idempotency, tenant isolation and cancellation fencing');
