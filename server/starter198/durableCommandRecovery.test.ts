import assert from 'node:assert/strict';
import test from 'node:test';
import type { Starter198InitialSetupInput, StarterWorkspaceCommandInput } from '../../shared/contracts/starter198.js';
import {
  buildPublicationEvidenceSubmission,
  buildStarterPublicationPackage,
  type StarterPublicationPackage,
} from '../publishing/starterPublicationPackage.js';
import { Starter198CommandError } from './commandValidation.js';
import { recoverProcessingDurableCommand } from './durableCommandRecovery.js';
import { starter198InitialSetupFingerprint } from './initialSetup.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterCollection,
  type StarterRecord,
} from './repository.js';
import type {
  Starter198InitialSetupPort,
  Starter198OrchestratorQueuePort,
} from './runtimePorts.js';

const TENANT_ID = 'starter-recovery-tenant';
const USER_ID = 'starter-owner';
const NOW = new Date('2026-09-13T08:00:00.000Z');

const clone = <T>(value: T): T => structuredClone(value);

class MemoryRepository implements Starter198Repository {
  private serial = 0;
  readonly rows = new Map<StarterCollection, StarterRecord[]>();

  seed(collection: StarterCollection, data: Record<string, unknown>): StarterRecord {
    const row: StarterRecord = {
      id: String(data.id || `${collection}-${++this.serial}`),
      ...clone(data),
      tenant_id: TENANT_ID,
    };
    this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]);
    return row;
  }

  row(collection: StarterCollection, id: string): StarterRecord {
    const row = this.rows.get(collection)?.find(item => item.id === id);
    assert.ok(row, `missing fixture row ${collection}:${id}`);
    return row;
  }

  async list(
    collection: StarterCollection,
    tenantId: string,
    query: { page?: number; perPage?: number; sort?: string; where?: Record<string, string | number | boolean> } = {},
  ) {
    let found = (this.rows.get(collection) ?? []).filter(row => row.tenant_id === tenantId);
    found = found.filter(row => Object.entries(query.where ?? {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    if (query.sort) {
      const descending = query.sort.startsWith('-');
      const key = descending ? query.sort.slice(1) : query.sort;
      found = [...found].sort((left, right) => (
        String(left[key] ?? '').localeCompare(String(right[key] ?? '')) * (descending ? -1 : 1)
      ));
    }
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 500;
    const start = (page - 1) * perPage;
    return {
      items: clone(found.slice(start, start + perPage)),
      totalItems: found.length,
      totalPages: Math.ceil(found.length / perPage),
      page,
      perPage,
    };
  }

  async get(collection: StarterCollection, tenantId: string, id: string): Promise<StarterRecord | null> {
    return clone((this.rows.get(collection) ?? [])
      .find(row => row.tenant_id === tenantId && row.id === id) ?? null);
  }

  async create(collection: StarterCollection, tenantId: string, data: Record<string, unknown>): Promise<StarterRecord> {
    return clone(this.seed(collection, { ...data, tenant_id: tenantId }));
  }

  async update(
    collection: StarterCollection,
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const row = (this.rows.get(collection) ?? []).find(item => item.tenant_id === tenantId && item.id === id);
    if (!row) throw new Error('fixture_record_not_found');
    Object.assign(row, clone(data));
  }

  async access(): Promise<never> {
    throw new Error('access_not_used_by_durable_recovery');
  }
}

function processingCommand(repository: MemoryRepository, commandId: string): StarterRecord {
  return repository.seed(STARTER_COLLECTIONS.commands, {
    id: `journal-${commandId}`,
    command_id: commandId,
    status: 'processing',
    http_status: 0,
    result: {},
  });
}

function publicationPackage(idempotencyKey: string): StarterPublicationPackage {
  return buildStarterPublicationPackage({
    tenantId: TENANT_ID,
    contentId: 'content-approved-001',
    contentVersion: 'content-v3',
    contentHash: 'a'.repeat(64),
    platform: 'tiktok',
    copy: { title: 'Factory story', body: 'Approved factory story', hashtags: ['factory'] },
    assets: [{
      kind: 'video',
      fileName: 'factory-story.mp4',
      downloadUrl: '/api/overseas/assets/factory-story.mp4',
      contentHash: 'b'.repeat(64),
    }],
    idempotencyKey,
    now: new Date('2026-09-13T06:00:00.000Z'),
  });
}

test('durable orchestrator inbox restores 202 without replaying the queue', async () => {
  const repository = new MemoryRepository();
  const commandId = 'starter_cmd_orchestrator_recovery';
  const request: StarterWorkspaceCommandInput = {
    command: 'submit_orchestrator_input',
    idempotencyKey: 'orchestrator-recovery-001',
    payload: { input: '为德国市场执行首周内容计划。' },
  };
  const record = processingCommand(repository, commandId);
  repository.seed(STARTER_COLLECTIONS.orchestratorInbox, {
    id: 'inbox-durable-001',
    command_id: commandId,
    idempotency_key: request.idempotencyKey,
    queue_item_id: 'queue-durable-001',
    run_id: 'run-durable-001',
    disposition: 'queued',
    status: 'pending',
    missing_facts: [],
  });
  let queueCalls = 0;
  const queue: Starter198OrchestratorQueuePort = {
    async enqueue() {
      queueCalls += 1;
      throw new Error('queue_must_not_be_replayed');
    },
  };

  const recovered = await recoverProcessingDurableCommand({
    repository,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: 'owner',
    request,
    record,
    orchestratorQueue: queue,
    now: NOW,
  });

  assert.equal(recovered?.status, 202);
  assert.equal(recovered?.body.commandId, commandId);
  assert.equal(queueCalls, 0, 'a durable inbox row is the fact; recovery must not enqueue again');
  const journal = repository.row(STARTER_COLLECTIONS.commands, record.id);
  assert.equal(journal.status, 'accepted');
  assert.equal(journal.http_status, 202);
  assert.deepEqual(journal.operation_result, {
    queueItemId: 'queue-durable-001',
    disposition: 'queued',
    runId: 'run-durable-001',
    missingFacts: [],
  });
});

test('orchestrator recovery rejects a durable inbox owned by another command id', async () => {
  const repository = new MemoryRepository();
  const request: StarterWorkspaceCommandInput = {
    command: 'submit_orchestrator_input',
    idempotencyKey: 'orchestrator-recovery-wrong-command',
    payload: { input: '不得重放的目标。' },
  };
  const record = processingCommand(repository, 'starter_cmd_expected');
  repository.seed(STARTER_COLLECTIONS.orchestratorInbox, {
    id: 'inbox-wrong-command',
    command_id: 'starter_cmd_other',
    idempotency_key: request.idempotencyKey,
    queue_item_id: 'queue-wrong-command',
    disposition: 'queued',
    status: 'pending',
  });

  await assert.rejects(
    () => recoverProcessingDurableCommand({
      repository,
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'owner',
      request,
      record,
      now: NOW,
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_orchestrator_inbox_integrity_violation'
      && error.status === 503,
  );
  assert.equal(repository.row(STARTER_COLLECTIONS.commands, record.id).status, 'processing');
});

test('persisted initial setup resumes waiting input once and remains replay safe', async () => {
  const repository = new MemoryRepository();
  const commandId = 'starter_cmd_setup_recovery';
  const request: StarterWorkspaceCommandInput = {
    command: 'confirm_initial_setup',
    idempotencyKey: 'initial-setup-recovery-001',
    payload: {
      companyName: '青山制造',
      industry: '礼品制造',
      primaryBusiness: '保温杯 OEM/ODM',
      focusProducts: 'TB-750',
      targetMarkets: '德国',
      customerProfile: '礼品经销商',
      primaryPlatform: 'tiktok',
      primaryLanguage: 'en',
      constraints: ['不得编造材质参数'],
    },
  };
  const record = processingCommand(repository, commandId);
  repository.seed(STARTER_COLLECTIONS.configurations, {
    id: 'config-recovery-001',
    config_version: 4,
    facts_version: 'facts-v4',
    effective_config: {
      initialSetup: {
        idempotencyKey: request.idempotencyKey,
        requestHash: starter198InitialSetupFingerprint(request.payload as unknown as Starter198InitialSetupInput),
      },
    },
  });
  repository.seed(STARTER_COLLECTIONS.orchestratorInbox, {
    id: 'inbox-waiting-setup',
    command_id: 'starter_cmd_original_goal',
    idempotency_key: 'orchestrator-before-setup',
    queue_item_id: 'queue-before-setup',
    input_version: 'input-v1',
    input_text: '开始德国市场首周内容计划。',
    disposition: 'awaiting_initial_confirmation',
    status: 'waiting_user',
    missing_facts: ['digital_employee_configuration'],
    created_at: '2026-09-13T07:00:00.000Z',
  });
  let configureCalls = 0;
  const initialSetup: Starter198InitialSetupPort = {
    async configure() {
      configureCalls += 1;
      throw new Error('persisted setup must not be configured again');
    },
  };
  const queueInputs: Parameters<Starter198OrchestratorQueuePort['enqueue']>[0][] = [];
  const queue: Starter198OrchestratorQueuePort = {
    async enqueue(input) {
      queueInputs.push(clone(input));
      return { queueItemId: 'queue-before-setup', runId: 'run-resumed-001', disposition: 'queued' };
    },
  };
  const recoveryInput = {
    repository,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: 'owner' as const,
    request,
    record,
    initialSetup,
    orchestratorQueue: queue,
    now: NOW,
  };

  const first = await recoverProcessingDurableCommand(recoveryInput);
  const second = await recoverProcessingDurableCommand(recoveryInput);

  assert.equal(first?.status, 200);
  assert.equal(second?.status, 200);
  assert.equal(configureCalls, 0);
  assert.equal(queueInputs.length, 1, 'the succeeded inbox projection prevents a second resume enqueue');
  assert.match(queueInputs[0].commandId, /^starter_resume_[a-f0-9]{32}$/);
  assert.match(queueInputs[0].idempotencyKey, /^setup-resume:[a-f0-9]{48}$/);
  const waiting = repository.row(STARTER_COLLECTIONS.orchestratorInbox, 'inbox-waiting-setup');
  assert.equal(waiting.disposition, 'resumed_after_setup');
  assert.equal(waiting.status, 'succeeded');
  assert.equal(waiting.run_id, 'run-resumed-001');
  assert.deepEqual(waiting.missing_facts, []);
  const operation = repository.row(STARTER_COLLECTIONS.commands, record.id).operation_result as Record<string, unknown>;
  assert.equal(operation.configVersion, 4);
  assert.equal(operation.factsVersion, 'facts-v4');
  assert.equal(operation.repeated, true);
});

test('publication package recovery returns only the tenant-scoped persisted package', async () => {
  const repository = new MemoryRepository();
  const request: StarterWorkspaceCommandInput = {
    command: 'generate_publication_package',
    idempotencyKey: 'publication-recovery-001',
    payload: {},
  };
  const record = processingCommand(repository, 'starter_cmd_package_recovery');
  const manifest = publicationPackage(`${request.idempotencyKey}:package`);
  repository.seed(STARTER_COLLECTIONS.publicationPackages, {
    id: 'publication-record-001',
    package_id: manifest.packageId,
    idempotency_key: `${request.idempotencyKey}:package`,
    status: 'awaiting_user_publish',
  });
  let reads = 0;

  const recovered = await recoverProcessingDurableCommand({
    repository,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: 'owner',
    request,
    record,
    readPublicationPackage: async (tenantId, packageId) => {
      reads += 1;
      assert.equal(tenantId, TENANT_ID);
      assert.equal(packageId, manifest.packageId);
      return manifest;
    },
    now: NOW,
  });

  assert.equal(recovered?.status, 200);
  assert.equal(reads, 1);
  const operation = repository.row(STARTER_COLLECTIONS.commands, record.id).operation_result as Record<string, unknown>;
  assert.deepEqual(operation, { package: manifest, created: false });
});

test('publication evidence recovery verifies the persisted evidence hash and fails closed on tampering', async () => {
  const repository = new MemoryRepository();
  const manifest = publicationPackage('publication-evidence-package');
  const publicUrl = 'https://www.tiktok.com/@factory/video/123456789';
  const evidence = buildPublicationEvidenceSubmission({
    package: manifest,
    contentHash: manifest.contentHash,
    publicUrl,
    submittedBy: USER_ID,
    now: new Date('2026-09-13T07:30:00.000Z'),
  });
  const stored = repository.seed(STARTER_COLLECTIONS.publicationPackages, {
    id: 'publication-evidence-record',
    package_id: manifest.packageId,
    idempotency_key: 'publication-evidence-package',
    status: 'evidence_submitted',
    evidence,
  });
  const request: StarterWorkspaceCommandInput = {
    command: 'submit_publication_evidence',
    idempotencyKey: 'publication-evidence-recovery-001',
    targetId: manifest.packageId,
    payload: { publicUrl },
  };
  const record = processingCommand(repository, 'starter_cmd_evidence_recovery');
  const readPublicationPackage = async () => ({ ...manifest, status: 'evidence_submitted' as const });

  const recovered = await recoverProcessingDurableCommand({
    repository,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: 'owner',
    request,
    record,
    readPublicationPackage,
    now: NOW,
  });
  assert.equal(recovered?.status, 200);
  const operation = repository.row(STARTER_COLLECTIONS.commands, record.id).operation_result as Record<string, unknown>;
  assert.equal(operation.repeated, true);
  assert.deepEqual(operation.evidence, evidence);

  stored.evidence = { ...evidence, evidenceHash: '0'.repeat(64) };
  stored.status = 'evidence_submitted';
  const tamperedRecord = processingCommand(repository, 'starter_cmd_evidence_tampered');
  const tampered = await recoverProcessingDurableCommand({
    repository,
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: 'owner',
    request: { ...request, idempotencyKey: 'publication-evidence-recovery-tampered' },
    record: tamperedRecord,
    readPublicationPackage,
    now: NOW,
  });

  assert.equal(tampered, null, 'an untrusted evidence hash must not be reported as recovered success');
  assert.equal(repository.row(STARTER_COLLECTIONS.commands, tamperedRecord.id).status, 'processing');
});
