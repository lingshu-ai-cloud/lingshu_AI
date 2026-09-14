import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  STARTER_198_CAPABILITIES,
  STARTER_198_PROFILE_VERSION,
  STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
  type StarterWorkspaceCommandInput,
} from '../../shared/contracts/starter198.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  DURABLE_OPERATION_LEASE_COLLECTION,
} from '../runtime/durableLease.js';
import { evidenceHash } from '../quotation/canonical.js';
import {
  executeStarterRunControlCommand,
  persistStarterApprovalMutationEvidence,
  recoverProcessingAttributedCommand,
} from './commandAttribution.js';
import { Starter198CommandError } from './commandValidation.js';
import { runStarter198Command } from './commands.js';
import { STARTER_198_DEFAULT_LIMITS } from './provisioning.js';
import {
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  type Starter198Repository,
  type StarterCollection,
  type StarterRecord,
} from './repository.js';

const tenantId = 'starter-attribution-tenant';
const actorId = 'starter-attribution-owner';
const now = new Date('2026-09-13T08:00:00.000Z');
const clone = <T>(value: T): T => structuredClone(value);
const journalHash = (request: StarterWorkspaceCommandInput): string => createHash('sha256').update(JSON.stringify({
  command: request.command,
  targetId: request.targetId ?? null,
  expectedVersion: request.expectedVersion ?? null,
  payload: request.payload ?? {},
})).digest('hex');

class MemoryRepository implements Starter198Repository {
  readonly rows = new Map<StarterCollection, StarterRecord[]>();
  private serial = 0;
  onCommandCreate?: (data: Record<string, unknown>) => void;
  failCommandCreateAfterHook = false;
  failCommandFinalizeOnce = false;
  failRunEvidenceCreateOnce = false;

  constructor(readonly dataStore?: DataStore) {}

  seed(collection: StarterCollection, data: Record<string, unknown>): StarterRecord {
    const row = { id: String(data.id || `${collection}-${++this.serial}`), ...clone(data), tenant_id: tenantId };
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return row;
  }

  row(collection: StarterCollection, id: string): StarterRecord {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    assert.ok(row, `missing ${collection}:${id}`);
    return row;
  }

  async list(collection: StarterCollection, scopedTenant: string, query: {
    page?: number; perPage?: number; sort?: string;
    where?: Record<string, string | number | boolean>;
  } = {}) {
    let items = (this.rows.get(collection) ?? []).filter(item => item.tenant_id === scopedTenant
      && Object.entries(query.where ?? {}).every(([key, value]) => String(item[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      items = [...items].sort((left, right) => String(left[key] ?? '').localeCompare(String(right[key] ?? ''))
        * (descending ? -1 : 1));
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 500;
    const start = (page - 1) * perPage;
    return {
      items: clone(items.slice(start, start + perPage)), totalItems: items.length,
      totalPages: Math.ceil(items.length / perPage), page, perPage,
    };
  }

  async get(collection: StarterCollection, scopedTenant: string, id: string) {
    return clone((this.rows.get(collection) ?? []).find(item => item.tenant_id === scopedTenant && item.id === id) ?? null);
  }

  async create(collection: StarterCollection, scopedTenant: string, data: Record<string, unknown>) {
    if (collection === STARTER_COLLECTIONS.commands && this.onCommandCreate) {
      this.onCommandCreate(data);
      if (this.failCommandCreateAfterHook) {
        throw new Starter198RepositoryError('starter_198_storage_unavailable');
      }
    }
    if (collection === STARTER_COLLECTIONS.events && this.failRunEvidenceCreateOnce) {
      this.failRunEvidenceCreateOnce = false;
      throw new Starter198RepositoryError('starter_198_storage_unavailable');
    }
    return clone(this.seed(collection, { ...data, tenant_id: scopedTenant }));
  }

  async update(collection: StarterCollection, scopedTenant: string, id: string, data: Record<string, unknown>) {
    const row = (this.rows.get(collection) ?? []).find(item => item.tenant_id === scopedTenant && item.id === id);
    if (!row) throw new Starter198RepositoryError('starter_198_target_not_found');
    if (collection === STARTER_COLLECTIONS.commands && data.status === 'succeeded' && this.failCommandFinalizeOnce) {
      this.failCommandFinalizeOnce = false;
      throw new Starter198RepositoryError('starter_198_storage_unavailable');
    }
    Object.assign(row, clone(data));
  }

  async access(scopedTenant: string) {
    return {
      recordId: 'access-attribution', tenantId: scopedTenant, productProfile: 'starter_198' as const,
      profileVersion: STARTER_198_PROFILE_VERSION, entitlementSnapshotId: 'entitlement-attribution',
      entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
      resourceLimits: STARTER_198_DEFAULT_LIMITS, status: 'active' as const,
      cycleStartedAt: '2026-09-12T00:00:00.000Z', cycleEndsAt: '2026-09-19T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    };
  }
}

type LeaseRow = { id: string } & Record<string, unknown>;

class LeaseStore implements DataStore {
  private readonly rows = new Map<string, LeaseRow[]>();
  private serial = 0;
  failReads = false;

  private bucket(collection: string): LeaseRow[] {
    const bucket = this.rows.get(collection) ?? [];
    this.rows.set(collection, bucket);
    return bucket;
  }

  activeRunLeaseCount(runId: string): number {
    return this.bucket(DURABLE_OPERATION_LEASE_COLLECTION).filter(row => (
      row.tenant_id === tenantId
      && row.lease_scope === 'starter-run-mutation'
      && row.subject_id === runId
    )).length;
  }

  async getById<T>(collection: string, id: string): Promise<T | null> {
    if (this.failReads) throw new Error('lease_storage_unavailable');
    return clone(this.bucket(collection).find(row => row.id === id) ?? null) as T | null;
  }

  async list<T>(collection: string, query: ListQuery = {}) {
    if (this.failReads) throw new Error('lease_storage_unavailable');
    const selected = this.bucket(collection).filter(row => Object.entries(query.where ?? {})
      .every(([field, value]) => String(row[field] ?? '') === String(value)));
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    return {
      items: clone(selected.slice((page - 1) * perPage, page * perPage)) as T[],
      totalItems: selected.length,
      totalPages: Math.ceil(selected.length / perPage),
      page,
      perPage,
    };
  }

  async create<T>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const target = this.bucket(collection);
    if (collection === DURABLE_OPERATION_LEASE_COLLECTION
      && target.some(row => row.tenant_id === data.tenant_id
        && row.lease_scope === data.lease_scope
        && row.subject_id === data.subject_id)) return null;
    const row = { id: `lease-row-${++this.serial}`, ...clone(data) };
    target.push(row);
    return clone(row) as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = this.bucket(collection).find(candidate => candidate.id === id);
    if (!row) return false;
    Object.assign(row, clone(data));
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const target = this.bucket(collection);
    const index = target.findIndex(row => row.id === id);
    if (index < 0) return false;
    target.splice(index, 1);
    return true;
  }
}

function starterRun(repository: MemoryRepository, id: string, status = 'running') {
  return repository.seed(STARTER_COLLECTIONS.runs, {
    id, product_profile: 'starter_198', status,
    started_at: '2026-09-13T07:00:00.000Z', completed_at: '',
  });
}

function processing(repository: MemoryRepository, request: StarterWorkspaceCommandInput, commandId: string) {
  return repository.seed(STARTER_COLLECTIONS.commands, {
    id: `journal-${commandId}`, command_id: commandId, idempotency_key: request.idempotencyKey,
    request_hash: journalHash(request), command: request.command, target_id: request.targetId ?? '',
    expected_version: request.expectedVersion ?? '', payload: request.payload ?? {}, status: 'processing',
    result: {}, created_by: actorId, created_at: now.toISOString(), updated_at: now.toISOString(),
  });
}

test('run control uses the repository backing datastore and maps a foreign lease to stable 409', async () => {
  const dataStore = new LeaseStore();
  const repository = new MemoryRepository(dataStore);
  const run = starterRun(repository, 'run-lease-busy');
  assert.ok(await acquireDurableOperationLease({
    dataStore,
    tenantId,
    scope: 'starter-run-mutation',
    subjectId: run.id,
    ownerId: 'foreign-runtime',
    leaseDurationMs: 60_000,
  }));
  await assert.rejects(
    () => executeStarterRunControlCommand({
      repository, tenantId, userId: actorId, command: 'pause_run', targetId: run.id,
      expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: {}, now,
      commandId: 'starter_cmd_lease_busy', idempotencyKey: 'lease-busy-001', requestHash: 'hash',
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_run_mutation_busy' && error.status === 409,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.runs, run.id).status, 'running');
});

test('run control maps lease storage failure to stable 503 before mutating the run', async () => {
  const dataStore = new LeaseStore();
  dataStore.failReads = true;
  const repository = new MemoryRepository(dataStore);
  const run = starterRun(repository, 'run-lease-unavailable');
  await assert.rejects(
    () => executeStarterRunControlCommand({
      repository, tenantId, userId: actorId, command: 'pause_run', targetId: run.id,
      expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: {}, now,
      commandId: 'starter_cmd_lease_unavailable', idempotencyKey: 'lease-unavailable-001', requestHash: 'hash',
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_run_mutation_unavailable' && error.status === 503,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.runs, run.id).status, 'running');
});

test('evidence failure after a leased run mutation preserves the processing journal for recovery', async () => {
  const dataStore = new LeaseStore();
  const repository = new MemoryRepository(dataStore);
  const run = starterRun(repository, 'run-leased-uncertain');
  repository.failRunEvidenceCreateOnce = true;
  const request: StarterWorkspaceCommandInput = {
    command: 'pause_run', idempotencyKey: 'leased-uncertain-001', targetId: run.id,
    expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: { reason: '等待核对' },
  };
  await assert.rejects(
    () => runStarter198Command({
      tenantId, userId: actorId, role: 'owner', request,
      dependencies: { repository, now: () => now },
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_command_state_unknown' && error.status === 503,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.runs, run.id).status, 'paused');
  assert.equal(repository.rows.get(STARTER_COLLECTIONS.commands)?.[0]?.status, 'processing');
  assert.equal(dataStore.activeRunLeaseCount(run.id), 0, 'bounded lease must be released after uncertain mutation');
});

test('content approval final re-read, decision and attribution evidence share the run lease', async () => {
  const dataStore = new LeaseStore();
  const repository = new MemoryRepository(dataStore);
  const run = starterRun(repository, 'run-content-leased', 'waiting_approval');
  repository.seed(STARTER_COLLECTIONS.tasks, {
    id: 'task-content-leased', run_id: run.id,
    task_key: STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
    policy_source: STARTER_198_PROFILE_VERSION, status: 'waiting_approval',
  });
  repository.seed(STARTER_COLLECTIONS.approvals, {
    id: 'approval-content-leased', run_id: run.id, task_id: 'task-content-leased',
    status: 'pending', decided_by: '', subject_version: 3,
    evidence: [{ type: 'starter_content_subject', contentHash: 'a'.repeat(64) }],
  });
  let leaseObservedByDecision = false;
  const result = await runStarter198Command({
    tenantId,
    userId: actorId,
    role: 'owner',
    request: {
      command: 'resolve_decision', idempotencyKey: 'content-leased-001',
      targetId: 'approval-content-leased', expectedVersion: '3',
      payload: { decision: 'approved', note: '同意发布' },
    },
    dependencies: {
      repository,
      now: () => now,
      approvalDecision: {
        async decide(input) {
          leaseObservedByDecision = dataStore.activeRunLeaseCount(run.id) === 1;
          await repository.update(STARTER_COLLECTIONS.approvals, tenantId, input.approvalId, {
            status: input.decision, decided_by: input.userId, decision_note: input.note,
          });
          return { state: 'decided', decision: input.decision };
        },
      },
    },
  });
  assert.equal(result.status, 200);
  assert.equal(leaseObservedByDecision, true);
  const approval = repository.row(STARTER_COLLECTIONS.approvals, 'approval-content-leased');
  assert.equal(approval.status, 'approved');
  assert.ok((approval.evidence as Record<string, unknown>[]).some(item => item.command === 'resolve_decision'));
  assert.equal(dataStore.activeRunLeaseCount(run.id), 0);
});

test('a busy lease cannot rewrite a recoverable processing command', async () => {
  const dataStore = new LeaseStore();
  const repository = new MemoryRepository(dataStore);
  const run = starterRun(repository, 'run-recovery-lease-busy');
  const request: StarterWorkspaceCommandInput = {
    command: 'pause_run', idempotencyKey: 'recovery-lease-busy-001', targetId: run.id,
    expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: {},
  };
  const record = processing(repository, request, 'starter_cmd_recovery_lease_busy');
  await executeStarterRunControlCommand({
    repository, tenantId, userId: actorId, command: 'pause_run', targetId: run.id,
    expectedVersion: request.expectedVersion, payload: {}, now,
    commandId: String(record.command_id), idempotencyKey: request.idempotencyKey,
    requestHash: String(record.request_hash),
  });
  assert.ok(await acquireDurableOperationLease({
    dataStore,
    tenantId,
    scope: 'starter-run-mutation',
    subjectId: run.id,
    ownerId: 'foreign-recovery-runtime',
    leaseDurationMs: 60_000,
  }));
  await assert.rejects(
    () => recoverProcessingAttributedCommand({ repository, tenantId, request, record, now }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_run_mutation_busy' && error.status === 409,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.commands, record.id).status, 'processing');
});

test('an untyped approval failure after a possible commit never fabricates a failed command', async () => {
  const dataStore = new LeaseStore();
  const repository = new MemoryRepository(dataStore);
  const run = starterRun(repository, 'run-content-decision-uncertain', 'waiting_approval');
  repository.seed(STARTER_COLLECTIONS.tasks, {
    id: 'task-content-decision-uncertain', run_id: run.id,
    task_key: STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
    policy_source: STARTER_198_PROFILE_VERSION, status: 'waiting_approval',
  });
  repository.seed(STARTER_COLLECTIONS.approvals, {
    id: 'approval-content-decision-uncertain', run_id: run.id,
    task_id: 'task-content-decision-uncertain', status: 'pending', decided_by: '',
    subject_version: 4, evidence: [{ type: 'starter_content_subject', contentHash: 'b'.repeat(64) }],
  });
  await assert.rejects(
    () => runStarter198Command({
      tenantId,
      userId: actorId,
      role: 'owner',
      request: {
        command: 'resolve_decision', idempotencyKey: 'content-decision-uncertain-001',
        targetId: 'approval-content-decision-uncertain', expectedVersion: '4',
        payload: { decision: 'approved', note: '' },
      },
      dependencies: {
        repository,
        now: () => now,
        approvalDecision: {
          async decide(input) {
            await repository.update(STARTER_COLLECTIONS.approvals, tenantId, input.approvalId, {
              status: input.decision, decided_by: input.userId,
            });
            throw new Error('response_lost_after_possible_commit');
          },
        },
      },
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_command_state_unknown' && error.status === 503,
  );
  assert.equal(repository.rows.get(STARTER_COLLECTIONS.commands)?.[0]?.status, 'processing');
  assert.equal(repository.row(STARTER_COLLECTIONS.approvals, 'approval-content-decision-uncertain').status, 'approved');
  assert.equal(dataStore.activeRunLeaseCount(run.id), 0);
});

test('a matching run state without this command evidence is never recovered as success', async () => {
  const repository = new MemoryRepository();
  starterRun(repository, 'run-state-only', 'paused');
  const request: StarterWorkspaceCommandInput = {
    command: 'pause_run', idempotencyKey: 'pause-state-only-001', targetId: 'run-state-only',
    expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: {},
  };
  const record = processing(repository, request, 'starter_cmd_state_only');
  assert.equal(await recoverProcessingAttributedCommand({ repository, tenantId, request, record, now }), null);
  assert.equal(repository.row(STARTER_COLLECTIONS.commands, record.id).status, 'processing');
});

test('run control recovery requires the exact immutable command event even after later state changes', async () => {
  const repository = new MemoryRepository();
  const run = starterRun(repository, 'run-pause-evidence');
  const request: StarterWorkspaceCommandInput = {
    command: 'pause_run', idempotencyKey: 'pause-evidence-001', targetId: run.id,
    expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: { reason: '人工核对' },
  };
  const record = processing(repository, request, 'starter_cmd_pause_evidence');
  await executeStarterRunControlCommand({
    repository, tenantId, userId: actorId, command: 'pause_run', targetId: run.id,
    expectedVersion: request.expectedVersion, payload: request.payload ?? {}, now,
    commandId: String(record.command_id), idempotencyKey: request.idempotencyKey,
    requestHash: String(record.request_hash),
  });
  repository.row(STARTER_COLLECTIONS.runs, run.id).status = 'running';
  const recovered = await recoverProcessingAttributedCommand({ repository, tenantId, request, record, now });
  assert.equal(recovered?.status, 200);
  assert.equal(repository.row(STARTER_COLLECTIONS.commands, record.id).status, 'succeeded');
  const event = repository.rows.get(STARTER_COLLECTIONS.events)?.[0];
  assert.equal((event?.payload as Record<string, unknown>).commandId, record.command_id);
});

test('content decision recovery rejects state-only decisions and accepts its bound approval evidence', async () => {
  const repository = new MemoryRepository();
  const run = starterRun(repository, 'run-content-decision', 'waiting_approval');
  repository.seed(STARTER_COLLECTIONS.tasks, {
    id: 'task-content-approval', run_id: run.id, task_key: 'starter_content_release_approval',
    policy_source: STARTER_198_PROFILE_VERSION, status: 'succeeded',
  });
  repository.seed(STARTER_COLLECTIONS.approvals, {
    id: 'approval-content', run_id: run.id, task_id: 'task-content-approval',
    status: 'approved', decided_by: actorId, subject_version: 3,
    evidence: [{ type: 'starter_content_subject', contentHash: 'a'.repeat(64) }],
  });
  const request: StarterWorkspaceCommandInput = {
    command: 'resolve_decision', idempotencyKey: 'content-decision-001', targetId: 'approval-content',
    expectedVersion: '3', payload: { decision: 'approved', note: '' },
  };
  const record = processing(repository, request, 'starter_cmd_content_decision');
  assert.equal(await recoverProcessingAttributedCommand({ repository, tenantId, request, record, now }), null);
  await persistStarterApprovalMutationEvidence({
    repository, tenantId, approvalId: 'approval-content', decision: 'approved',
    commandId: String(record.command_id), idempotencyKey: request.idempotencyKey,
    requestHash: String(record.request_hash), expectedVersion: '3', actorUserId: actorId,
  });
  assert.equal((await recoverProcessingAttributedCommand({ repository, tenantId, request, record, now }))?.status, 200);
});

test('quote decision recovery is owned by the exact quote approval idempotency evidence', async () => {
  const repository = new MemoryRepository();
  const inputHash = 'a'.repeat(64);
  const ruleHash = 'b'.repeat(64);
  const calculationHash = 'c'.repeat(64);
  const request: StarterWorkspaceCommandInput = {
    command: 'resolve_decision', idempotencyKey: 'quote-decision-evidence-001', targetId: 'quote:quote-evidence',
    expectedVersion: inputHash, payload: { decision: 'approved', note: '同意报价' },
  };
  const record = processing(repository, request, 'starter_cmd_quote_decision');
  repository.seed(STARTER_COLLECTIONS.quoteDrafts, {
    id: 'quote-evidence', status: 'approved', approval_evidence_id: 'quote-approval-evidence',
    input_hash: inputHash, rule_hash: ruleHash, calculation_hash: calculationHash,
  });
  assert.equal(await recoverProcessingAttributedCommand({ repository, tenantId, request, record, now }), null);
  const envelope = {
    schemaVersion: 'EvidenceEnvelopeV1', action: 'quote_draft_decision', decision: 'approved',
    subject: { type: 'quote_draft', id: 'quote-evidence', inquiryId: 'inquiry', inquiryVersion: '1' },
    binding: { inputHash, ruleHash, calculationHash },
    actor: { userId: actorId, role: 'super_admin' }, note: '同意报价', recordedAt: now.toISOString(),
  };
  repository.seed(STARTER_COLLECTIONS.quoteApprovalEvidence, {
    id: 'quote-approval-evidence', draft_id: 'quote-evidence', input_hash: inputHash,
    rule_hash: ruleHash, calculation_hash: calculationHash, decision: 'approved', status: 'approved',
    envelope, envelope_hash: evidenceHash(envelope),
    idempotency_key: `${request.idempotencyKey}:quote-decision`,
    request_hash: evidenceHash({
      draftId: 'quote-evidence', inputHash, ruleHash, calculationHash, decision: 'approved', note: '同意报价',
    }),
  });
  assert.equal((await recoverProcessingAttributedCommand({ repository, tenantId, request, record, now }))?.status, 200);
});

test('cancellation rechecks starter graph scope after command creation and before any mutation', async () => {
  const repository = new MemoryRepository();
  const run = starterRun(repository, 'run-cancel-toctou');
  repository.onCommandCreate = _data => {
    repository.seed(STARTER_COLLECTIONS.tasks, {
      id: 'advanced-task-raced-in', run_id: run.id, task_key: 'advanced_manual_delivery',
      policy_source: 'advanced.v1', status: 'pending',
    });
    repository.onCommandCreate = undefined;
  };
  await assert.rejects(
    () => runStarter198Command({
      tenantId, userId: actorId, role: 'owner',
      request: {
        command: 'cancel_run', idempotencyKey: 'cancel-toctou-001', targetId: run.id,
        expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: { reason: '取消' },
      },
      dependencies: { repository, now: () => now },
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_workflow_scope_invalid' && error.status === 409,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.runs, run.id).status, 'running');
  assert.equal(repository.row(STARTER_COLLECTIONS.tasks, 'advanced-task-raced-in').status, 'pending');
});

test('cancel crash after business commit recovers only from its exact event on the injected repository', async () => {
  const repository = new MemoryRepository();
  const run = starterRun(repository, 'run-cancel-recovery');
  repository.seed(STARTER_COLLECTIONS.tasks, {
    id: 'starter-task-cancel', run_id: run.id, task_key: 'starter_context_snapshot',
    policy_source: STARTER_198_PROFILE_VERSION, status: 'pending',
  });
  const request: StarterWorkspaceCommandInput = {
    command: 'cancel_run', idempotencyKey: 'cancel-recovery-001', targetId: run.id,
    expectedVersion: 'running:2026-09-13T07:00:00.000Z:', payload: { reason: '停止本轮' },
  };
  repository.failCommandFinalizeOnce = true;
  await assert.rejects(
    () => runStarter198Command({
      tenantId, userId: actorId, role: 'owner', request,
      dependencies: { repository, now: () => now },
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_command_journal_finalize_failed' && error.status === 503,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.runs, run.id).status, 'cancelled');
  assert.equal(repository.row(STARTER_COLLECTIONS.tasks, 'starter-task-cancel').status, 'cancelled');
  const journal = repository.rows.get(STARTER_COLLECTIONS.commands)?.[0];
  assert.equal(journal?.status, 'processing');
  const replay = await runStarter198Command({
    tenantId, userId: actorId, role: 'owner', request,
    dependencies: { repository, now: () => now },
  });
  assert.equal(replay.status, 200);
  assert.equal(journal?.status, 'succeeded');
});

test('cross-process create race returns pending replay semantics for the processing winner', async () => {
  const repository = new MemoryRepository();
  const request: StarterWorkspaceCommandInput = {
    command: 'submit_orchestrator_input', idempotencyKey: 'create-race-processing-001',
    payload: { input: '执行本周内容计划' },
  };
  repository.onCommandCreate = data => {
    repository.seed(STARTER_COLLECTIONS.commands, {
      ...data, id: 'journal-race-winner', command_id: 'starter_cmd_race_winner', status: 'processing', result: {},
    });
    repository.onCommandCreate = undefined;
  };
  repository.failCommandCreateAfterHook = true;
  let queueCalls = 0;
  const result = await runStarter198Command({
    tenantId, userId: actorId, role: 'owner', request,
    dependencies: {
      repository, now: () => now,
      orchestratorQueue: { async enqueue() { queueCalls += 1; return { queueItemId: 'must-not-enqueue' }; } },
    },
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.commandId, 'starter_cmd_race_winner');
  assert.match(result.body.message ?? '', /处理中/);
  assert.equal(queueCalls, 0);
});
