import assert from 'node:assert/strict';
import test from 'node:test';
import type { StarterWorkspaceCommandInput } from '../../shared/contracts/starter198.js';
import { Starter198CommandError } from './commandValidation.js';
import {
  executeStarter198InitialSetupCommand,
  resumeStarter198WaitingInput,
} from './initialSetupCommand.js';
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

const TENANT_ID = 'starter-setup-command-tenant';
const USER_ID = 'starter-setup-owner';
const NOW = new Date('2026-09-13T08:00:00.000Z');

const clone = <T>(value: T): T => structuredClone(value);

class InboxRepository implements Starter198Repository {
  readonly rows: StarterRecord[];

  constructor(...rows: StarterRecord[]) {
    this.rows = rows.map(row => clone(row));
  }

  async list(
    collection: StarterCollection,
    tenantId: string,
    query: { page?: number; perPage?: number; sort?: string; where?: Record<string, string | number | boolean> } = {},
  ) {
    let found = collection === STARTER_COLLECTIONS.orchestratorInbox
      ? this.rows.filter(row => row.tenant_id === tenantId)
      : [];
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
    if (collection !== STARTER_COLLECTIONS.orchestratorInbox) return null;
    return clone(this.rows.find(row => row.tenant_id === tenantId && row.id === id) ?? null);
  }

  async create(): Promise<never> {
    throw new Error('create_not_used_by_initial_setup_command_test');
  }

  async update(
    collection: StarterCollection,
    tenantId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    assert.equal(collection, STARTER_COLLECTIONS.orchestratorInbox);
    const row = this.rows.find(item => item.tenant_id === tenantId && item.id === id);
    if (!row) throw new Error('fixture_record_not_found');
    Object.assign(row, clone(data));
  }

  async access(): Promise<never> {
    throw new Error('access_not_used_by_initial_setup_command_test');
  }
}

function waitingInbox(id = 'waiting-inbox-001'): StarterRecord {
  return {
    id,
    tenant_id: TENANT_ID,
    queue_item_id: 'queue-waiting-001',
    input_version: 'input-version-001',
    input_text: '启动德国市场首周数字员工计划。',
    disposition: 'awaiting_initial_confirmation',
    status: 'waiting_user',
    missing_facts: ['digital_employee_configuration'],
    created_at: '2026-09-13T07:00:00.000Z',
  };
}

const setupRequest: StarterWorkspaceCommandInput = {
  command: 'confirm_initial_setup',
  idempotencyKey: 'initial-setup-command-001',
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

test('initial setup configures first, then resumes waiting input, and replay does not enqueue twice', async () => {
  const repository = new InboxRepository(waitingInbox());
  const events: string[] = [];
  let configureCalls = 0;
  const initialSetup: Starter198InitialSetupPort = {
    async configure(input) {
      configureCalls += 1;
      events.push('configure');
      assert.equal(input.idempotencyKey, setupRequest.idempotencyKey);
      return { configVersion: 1, factsVersion: 'facts-v1', repeated: configureCalls > 1 };
    },
  };
  const queueCalls: Parameters<Starter198OrchestratorQueuePort['enqueue']>[0][] = [];
  const queue: Starter198OrchestratorQueuePort = {
    async enqueue(input) {
      events.push('enqueue');
      queueCalls.push(clone(input));
      return { queueItemId: 'queue-waiting-001', runId: 'run-after-setup-001', disposition: 'queued' };
    },
  };
  const input = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    role: 'owner' as const,
    commandId: 'starter_cmd_setup_001',
    request: setupRequest,
    repository,
    initialSetup,
    orchestratorQueue: queue,
    now: NOW,
  };

  const first = await executeStarter198InitialSetupCommand(input);
  const replay = await executeStarter198InitialSetupCommand(input);

  assert.deepEqual(events, ['configure', 'enqueue', 'configure']);
  assert.equal(queueCalls.length, 1);
  assert.equal(first.result.resumed && (first.result.resumed as Record<string, unknown>).runId, 'run-after-setup-001');
  assert.equal(replay.result.resumed, null);
  assert.equal((replay.result as Record<string, unknown>).repeated, true);
  assert.match(first.message, /自动进入灵小枢任务队列/);
  const inbox = repository.rows[0];
  assert.equal(inbox.status, 'succeeded');
  assert.equal(inbox.disposition, 'resumed_after_setup');
  assert.equal(inbox.run_id, 'run-after-setup-001');
});

test('waiting-input continuation retries with the same deterministic identity until a run is durable', async () => {
  const repository = new InboxRepository(waitingInbox('waiting-inbox-retry'));
  const calls: Parameters<Starter198OrchestratorQueuePort['enqueue']>[0][] = [];
  const queue: Starter198OrchestratorQueuePort = {
    async enqueue(input) {
      calls.push(clone(input));
      return calls.length === 1
        ? { queueItemId: 'queue-waiting-001', disposition: 'awaiting_initial_confirmation' }
        : { queueItemId: 'queue-waiting-001', runId: 'run-durable-on-retry', disposition: 'queued' };
    },
  };
  const input = {
    tenantId: TENANT_ID,
    userId: USER_ID,
    commandId: 'starter_cmd_setup_retry',
    repository,
    orchestratorQueue: queue,
    now: NOW,
  };

  const first = await resumeStarter198WaitingInput(input);
  const second = await resumeStarter198WaitingInput(input);
  const completedReplay = await resumeStarter198WaitingInput(input);

  assert.equal(first?.runId, undefined);
  assert.equal(second?.runId, 'run-durable-on-retry');
  assert.equal(completedReplay, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0], 'retry must use the same command and idempotency identity');
  assert.match(calls[0].commandId, /^starter_resume_[a-f0-9]{32}$/);
  assert.match(calls[0].idempotencyKey, /^setup-resume:[a-f0-9]{48}$/);
  assert.equal(repository.rows[0].status, 'succeeded');
  assert.equal(repository.rows[0].run_id, 'run-durable-on-retry');
});

test('non-owner setup is rejected before configuration or queue side effects', async () => {
  const repository = new InboxRepository(waitingInbox('waiting-inbox-forbidden'));
  let configureCalls = 0;
  let queueCalls = 0;
  await assert.rejects(
    () => executeStarter198InitialSetupCommand({
      tenantId: TENANT_ID,
      userId: USER_ID,
      role: 'operator',
      commandId: 'starter_cmd_setup_forbidden',
      request: setupRequest,
      repository,
      initialSetup: {
        async configure() {
          configureCalls += 1;
          return { configVersion: 1, factsVersion: 'facts-v1', repeated: false };
        },
      },
      orchestratorQueue: {
        async enqueue() {
          queueCalls += 1;
          return { queueItemId: 'must-not-execute' };
        },
      },
      now: NOW,
    }),
    (error: unknown) => error instanceof Starter198CommandError
      && error.code === 'starter_198_command_forbidden'
      && error.status === 403,
  );
  assert.equal(configureCalls, 0);
  assert.equal(queueCalls, 0);
  assert.equal(repository.rows[0].status, 'waiting_user');
});
