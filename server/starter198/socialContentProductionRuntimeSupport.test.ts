import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_TASK_KEY } from './socialContentAutoProduction.js';
import { failExecution } from './socialContentProductionRuntimeSupport.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';

function repositoryFixture() {
  const rows = new Map<string, StarterRecord>([
    [`${STARTER_COLLECTIONS.socialContentTasks}:social`, {
      id: 'social',
      tenant_id: 'tenant',
      task_id: 'task',
      status: 'producing',
      version: '1',
    }],
    [`${STARTER_COLLECTIONS.tasks}:execution`, {
      id: 'execution',
      tenant_id: 'tenant',
      run_id: 'run',
      task_key: AUTO_TASK_KEY,
      status: 'running',
      output: {},
    }],
    [`${STARTER_COLLECTIONS.runs}:run`, {
      id: 'run',
      tenant_id: 'tenant',
      status: 'running',
    }],
  ]);
  const repository = {
    async list(collection: string, tenantId: string, query: { where?: Record<string, unknown> } = {}) {
      const items = [...rows.entries()]
        .filter(([key]) => key.startsWith(`${collection}:`))
        .map(([, row]) => row)
        .filter(row => row.tenant_id === tenantId)
        .filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value))
        .map(row => structuredClone(row));
      return { items, totalItems: items.length };
    },
    async get(collection: string, tenantId: string, id: string) {
      const row = rows.get(`${collection}:${id}`);
      return row?.tenant_id === tenantId ? structuredClone(row) : null;
    },
    async create() { throw new Error('unexpected_create'); },
    async update(collection: string, tenantId: string, id: string, patch: Record<string, unknown>) {
      const key = `${collection}:${id}`;
      const row = rows.get(key);
      if (!row || row.tenant_id !== tenantId) throw new Error('record_not_found');
      rows.set(key, { ...row, ...structuredClone(patch) });
    },
    async access() { throw new Error('unexpected_access'); },
  } as unknown as Starter198Repository;
  return { repository, rows };
}

test('production input exhaustion surfaces durable attention instead of a false resumable pause', async () => {
  const { repository, rows } = repositoryFixture();

  await failExecution({
    repository,
    tenantId: 'tenant',
    taskId: 'task',
    runId: 'run',
    userId: 'user',
    error: new Error('production_input_required:请补充一张产品正面图'),
  });

  const socialTask = rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!;
  const executionTask = rows.get(`${STARTER_COLLECTIONS.tasks}:execution`)!;
  const production = (executionTask.output as Record<string, unknown>).production as Record<string, unknown>;

  assert.equal(socialTask.status, 'attention');
  assert.equal(production.stage, 'waiting_for_user_input');
  assert.equal(production.message, '请补充一张产品正面图');
  assert.equal(executionTask.status, 'waiting_external');
});

test('durable worker block prefix preserves the action-required state and specific cause', async () => {
  const { repository, rows } = repositoryFixture();

  await failExecution({
    repository,
    tenantId: 'tenant',
    taskId: 'task',
    runId: 'run',
    userId: 'user',
    error: new Error('input_required:需要补充素材或人工修改:production_input_required:请补充产品标签稿'),
  });

  const socialTask = rows.get(`${STARTER_COLLECTIONS.socialContentTasks}:social`)!;
  const executionTask = rows.get(`${STARTER_COLLECTIONS.tasks}:execution`)!;
  const production = (executionTask.output as Record<string, unknown>).production as Record<string, unknown>;

  assert.equal(socialTask.status, 'attention');
  assert.equal(production.stage, 'waiting_for_user_input');
  assert.equal(production.message, '需要补充素材或人工修改：请补充产品标签稿');
  assert.equal(production.failureClass, 'input_required');
});
