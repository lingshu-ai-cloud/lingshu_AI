import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import {
  contentProjectLineageFields,
} from '../digitalEmployees/contentProjectLineage.js';
import {
  acquireDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
} from '../runtime/durableLease.js';
import {
  STARTER_198_PROFILE_VERSION,
  STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
} from '../../shared/contracts/starter198.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import {
  notifyStarterContentArtifactReady,
  notifyStarterReviewableContentProjects,
} from './contentArtifactWakeup.js';
import { Starter198RunMutationLeaseError } from './runMutationLease.js';

type Row = { id: string } & Record<string, unknown>;

class MemoryStore implements DataStore {
  readonly rows = new Map<string, Row[]>();
  readonly businessWrites: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = [];
  failNextUpdateId = '';
  private serial = 0;

  constructor(seed: Record<string, Row[]>) {
    for (const [collection, rows] of Object.entries(seed)) {
      this.rows.set(collection, structuredClone(rows));
    }
  }

  row(collection: string, id: string): Row {
    const row = this.rows.get(collection)?.find(candidate => candidate.id === id);
    assert.ok(row, `missing ${collection}:${id}`);
    return row;
  }

  private bucket(collection: string): Row[] {
    const bucket = this.rows.get(collection) ?? [];
    this.rows.set(collection, bucket);
    return bucket;
  }

  async getById<T>(collection: string, id: string): Promise<T | null> {
    return structuredClone(this.bucket(collection).find(row => row.id === id) ?? null) as T | null;
  }

  async list<T>(collection: string, query: ListQuery = {}) {
    let selected = this.bucket(collection).filter(row => Object.entries(query.where ?? {})
      .every(([field, value]) => String(row[field] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const field = descending ? query.sort.slice(1) : query.sort;
      selected = [...selected].sort((left, right) => (
        String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1)
      ));
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
  }

  async create<T>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const bucket = this.bucket(collection);
    if (collection === DURABLE_OPERATION_LEASE_COLLECTION
      && bucket.some(row => row.tenant_id === data.tenant_id
        && row.lease_scope === data.lease_scope
        && row.subject_id === data.subject_id)) return null;
    const row = { id: `memory-${++this.serial}`, ...structuredClone(data) };
    bucket.push(row);
    return structuredClone(row) as T;
  }

  async update(collection: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (this.failNextUpdateId === id) {
      this.failNextUpdateId = '';
      return false;
    }
    const row = this.bucket(collection).find(candidate => candidate.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(patch));
    if (collection !== DURABLE_OPERATION_LEASE_COLLECTION) {
      this.businessWrites.push({ collection, id, patch: structuredClone(patch) });
    }
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const bucket = this.bucket(collection);
    const index = bucket.findIndex(row => row.id === id);
    if (index < 0) return false;
    bucket.splice(index, 1);
    return true;
  }
}

const tenantId = 'starter-content-wakeup-tenant';
const runId = 'starter-content-wakeup-run';
const productionTaskId = 'starter-content-wakeup-production';
const qualityTaskId = 'starter-content-wakeup-quality';

function recoverableWait(taskId: string, taskKey: string): Record<string, unknown> {
  return {
    schemaVersion: 'starter-198.content-adapter-wait.v1',
    executionStatus: 'waiting_external',
    adapter: 'indexed_studio_artifact_read_v2',
    reasonCode: 'tenant_content_pipeline_not_connected',
    runId,
    taskId,
    taskKey,
  };
}

function reviewableProject(): Row {
  const spec = {
    workflowRunId: runId,
    workflowTaskId: productionTaskId,
    workflowTaskKey: 'content_production',
    source: 'tenant_production',
    automation: {
      managedBy: 'digital_employee',
      stage: 'completed',
      status: 'ready_for_approval',
      renderOutputPath: '/trusted/tenant/output.mp4',
      synthetic: false,
      quality: { passed: true, ruleVersion: 9, outputBytes: 1024 },
    },
  };
  return {
    id: 'reviewable-studio-project',
    tenant_id: tenantId,
    status: 'ready_for_approval',
    spec,
    ...contentProjectLineageFields({ tenantId, spec }),
  };
}

function fixture(runStatus = 'waiting_external', pendingApproval = false): MemoryStore {
  const tasks: Row[] = [{
    id: productionTaskId,
    tenant_id: tenantId,
    run_id: runId,
    task_key: 'starter_content_production',
    policy_source: STARTER_198_PROFILE_VERSION,
    status: 'waiting_external',
    output: recoverableWait(productionTaskId, 'starter_content_production'),
  }, {
    id: qualityTaskId,
    tenant_id: tenantId,
    run_id: runId,
    task_key: 'starter_content_quality_gate',
    policy_source: STARTER_198_PROFILE_VERSION,
    status: 'waiting_external',
    output: recoverableWait(qualityTaskId, 'starter_content_quality_gate'),
  }];
  const approvals: Row[] = [];
  if (pendingApproval) {
    tasks.push({
      id: 'starter-content-wakeup-approval-task',
      tenant_id: tenantId,
      run_id: runId,
      task_key: STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
      policy_source: STARTER_198_PROFILE_VERSION,
      status: 'waiting_approval',
    });
    approvals.push({
      id: 'starter-content-wakeup-approval',
      tenant_id: tenantId,
      run_id: runId,
      task_id: 'starter-content-wakeup-approval-task',
      status: 'pending',
    });
  }
  return new MemoryStore({
    studio_projects: [reviewableProject()],
    [STARTER_COLLECTIONS.runs]: [{
      id: runId,
      tenant_id: tenantId,
      product_profile: 'starter_198',
      status: runStatus,
      pause_reason: runStatus === 'paused' ? '人工暂停' : '等待真实内容',
    }],
    [STARTER_COLLECTIONS.tasks]: tasks,
    [STARTER_COLLECTIONS.approvals]: approvals,
  });
}

test('a trusted reviewable project wakes both indexed content nodes and resumes an eligible run', async () => {
  const dataStore = fixture();
  const result = await notifyStarterContentArtifactReady({
    dataStore,
    tenantId,
    projectId: 'reviewable-studio-project',
    now: () => new Date('2026-09-13T12:00:00.000Z'),
  });
  assert.deepEqual(result, {
    state: 'ready',
    reason: 'starter_content_tasks_woken',
    resetTaskIds: [productionTaskId, qualityTaskId],
    runResumed: true,
  });
  assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, productionTaskId).status, 'pending');
  assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, qualityTaskId).status, 'pending');
  assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'running');
});

test('a paused run keeps human control while its waiting content nodes become retryable', async () => {
  const dataStore = fixture('paused');
  const result = await notifyStarterContentArtifactReady({
    dataStore, tenantId, projectId: 'reviewable-studio-project',
  });
  assert.equal(result.runResumed, false);
  assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, productionTaskId).status, 'pending');
  assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, qualityTaskId).status, 'pending');
  assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'paused');
});

test('a pending human approval prevents automatic run resume', async () => {
  const dataStore = fixture('waiting_external', true);
  const result = await notifyStarterContentArtifactReady({
    dataStore, tenantId, projectId: 'reviewable-studio-project',
  });
  assert.equal(result.runResumed, false);
  assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'waiting_external');
});

test('cancelling and tampered projects cannot reopen task or run state', async () => {
  const cancelling = fixture('cancelling');
  const cancelled = await notifyStarterContentArtifactReady({
    dataStore: cancelling, tenantId, projectId: 'reviewable-studio-project',
  });
  assert.equal(cancelled.state, 'ignored');
  assert.equal(cancelling.businessWrites.length, 0);

  const tampered = fixture();
  tampered.row('studio_projects', 'reviewable-studio-project').workflow_task_id = 'other-task';
  const ignored = await notifyStarterContentArtifactReady({
    dataStore: tampered, tenantId, projectId: 'reviewable-studio-project',
  });
  assert.equal(ignored.state, 'ignored');
  assert.equal(tampered.businessWrites.length, 0);
});

test('ambiguous, over-limit and hash-integrity waits are not auto-rearmed by a project event', async () => {
  for (const reasonCode of [
    'tenant_content_canonical_subject_ambiguous',
    'tenant_content_artifact_limit_exceeded',
    'tenant_content_artifact_not_verifiable',
  ]) {
    const dataStore = fixture();
    for (const taskId of [productionTaskId, qualityTaskId]) {
      const task = dataStore.row(STARTER_COLLECTIONS.tasks, taskId);
      task.output = { ...task.output as Record<string, unknown>, reasonCode };
    }
    const result = await notifyStarterContentArtifactReady({
      dataStore, tenantId, projectId: 'reviewable-studio-project',
    });
    assert.deepEqual(result, {
      state: 'ignored',
      reason: 'no_recoverable_content_wait',
      resetTaskIds: [],
      runResumed: false,
    });
    assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, productionTaskId).status, 'waiting_external');
    assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, qualityTaskId).status, 'waiting_external');
    assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'waiting_external');
    assert.equal(dataStore.businessWrites.length, 0);
  }
});

test('one recoverable node cannot resume a run while its peer has an integrity wait', async () => {
  const dataStore = fixture();
  const quality = dataStore.row(STARTER_COLLECTIONS.tasks, qualityTaskId);
  quality.output = {
    ...quality.output as Record<string, unknown>,
    reasonCode: 'tenant_content_artifact_not_verifiable',
  };
  const result = await notifyStarterContentArtifactReady({
    dataStore, tenantId, projectId: 'reviewable-studio-project',
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.runResumed, false);
  assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, productionTaskId).status, 'pending');
  assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, qualityTaskId).status, 'waiting_external');
  assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'waiting_external');
});

test('a foreign durable run lease blocks wakeup before any business state write', async () => {
  const dataStore = fixture();
  assert.ok(await acquireDurableOperationLease({
    dataStore,
    tenantId,
    scope: 'starter-run-mutation',
    subjectId: runId,
    ownerId: 'foreign-content-runtime',
    leaseDurationMs: 60_000,
  }));
  await assert.rejects(
    () => notifyStarterContentArtifactReady({
      dataStore, tenantId, projectId: 'reviewable-studio-project',
      repository: createStarter198Repository(dataStore),
    }),
    (error: unknown) => error instanceof Starter198RunMutationLeaseError
      && error.code === 'starter_run_mutation_busy',
  );
  assert.equal(dataStore.businessWrites.length, 0);
});

test('the post-persistence batch bridge defers lease contention without failing content production', async () => {
  const dataStore = fixture();
  assert.ok(await acquireDurableOperationLease({
    dataStore,
    tenantId,
    scope: 'starter-run-mutation',
    subjectId: runId,
    ownerId: 'foreign-content-runtime',
    leaseDurationMs: 60_000,
  }));
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const result = await notifyStarterReviewableContentProjects({
      dataStore,
      tenantId,
      projects: [dataStore.row('studio_projects', 'reviewable-studio-project')],
    });
    assert.deepEqual(result, {
      readyProjectIds: [],
      ignoredProjectIds: [],
      deferred: [{
        projectId: 'reviewable-studio-project',
        code: 'starter_run_mutation_busy',
        retryable: true,
      }],
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(dataStore.row('studio_projects', 'reviewable-studio-project').status, 'ready_for_approval');
  assert.equal(dataStore.businessWrites.length, 0);
});

test('a partial wake storage failure is deferred and an idempotent retry repairs the run', async () => {
  const dataStore = fixture();
  dataStore.failNextUpdateId = runId;
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const first = await notifyStarterReviewableContentProjects({
      dataStore,
      tenantId,
      projects: [dataStore.row('studio_projects', 'reviewable-studio-project')],
    });
    assert.deepEqual(first.deferred, [{
      projectId: 'reviewable-studio-project',
      code: 'starter_198_storage_unavailable',
      retryable: true,
    }]);
    assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, productionTaskId).status, 'pending');
    assert.equal(dataStore.row(STARTER_COLLECTIONS.tasks, qualityTaskId).status, 'pending');
    assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'waiting_external');

    const retried = await notifyStarterReviewableContentProjects({
      dataStore,
      tenantId,
      projects: [dataStore.row('studio_projects', 'reviewable-studio-project')],
    });
    assert.deepEqual(retried.deferred, []);
    assert.deepEqual(retried.readyProjectIds, ['reviewable-studio-project']);
    assert.equal(dataStore.row(STARTER_COLLECTIONS.runs, runId).status, 'running');
  } finally {
    console.warn = originalWarn;
  }
});
