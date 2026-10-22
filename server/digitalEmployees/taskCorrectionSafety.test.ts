import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import type { RunRecord, TaskRecord } from '../routes/digitalEmployeeRecords.js';
import { downstreamTasks, irreversibleEffects, outputHasExternalReceipt,
  postHasPublishedReceipt } from './taskCorrectionSafety.js';

const run = { id: 'run-a', tenant_id: 'tenant-a' } as RunRecord;
function task(id: string, key: string, extra: Record<string, unknown> = {}): TaskRecord {
  return { id, tenant_id: 'tenant-a', run_id: run.id, task_key: key, status: 'pending',
    sequence: 1, depends_on: [], output: {}, business_refs: [], ...extra } as TaskRecord;
}

test('task correction reaches transitive downstream tasks but never unrelated tasks', () => {
  const source = task('source', 'plan', { sequence: 2 });
  const publish = task('publish', 'platform_publish', { sequence: 4, depends_on: ['render'] });
  const render = task('render', 'render', { sequence: 3, depends_on: ['plan'] });
  const unrelated = task('unrelated', 'other', { sequence: 1 });
  const all = [publish, unrelated, render, source];
  assert.deepEqual(downstreamTasks(all, source, true).map(item => item.id), ['source', 'render', 'publish']);
  assert.deepEqual(downstreamTasks(all, source, false).map(item => item.id), ['source']);
  assert.deepEqual(all.map(item => item.id), ['publish', 'unrelated', 'render', 'source']);
});

test('nested provider receipts and published post evidence remain irreversible', () => {
  assert.equal(outputHasExternalReceipt(task('a', 'followup_dispatch', {
    output: { attempts: [{ providerReceipt: { id: 'message-a' } }] },
  })), true);
  assert.equal(outputHasExternalReceipt(task('b', 'platform_publish', {
    output: { proof: { value: 1, status: 'available' } },
  })), true);
  assert.equal(outputHasExternalReceipt(task('c', 'draft', { output: { status: 'draft' } })), false);
  assert.equal(postHasPublishedReceipt({ id: 'post-a', stats: { publishResults: [{ platformPostId: 'external-a' }] } }), true);
  assert.equal(postHasPublishedReceipt({ id: 'post-b', stats: { status: 'draft' } }), false);
});

test('irreversible effect scan checks scoped post and send receipts beyond task output', async () => {
  const publish = task('publish', 'platform_publish', { status: 'succeeded',
    business_refs: [{ id: 'post-a' }] });
  const send = task('send', 'followup_dispatch', { status: 'succeeded', business_refs: [{ id: 'batch-a' }] });
  const queries: string[] = [];
  const store: Pick<DataStore, 'list'> = {
    async list<T>(collection: string) {
      queries.push(collection);
      const items = collection === 'posts' ? [
        { id: 'post-a', tenant_id: 'tenant-a', platform_post_id: 'external-a' },
        { id: 'post-other', tenant_id: 'tenant-b', platform_post_id: 'external-b' },
      ] : [publish, send];
      return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: 500 };
    },
  };
  const effects = await irreversibleEffects({ store, tenantId: 'tenant-a', run,
    affected: [publish, send], followupRunHasExternalReceipt: async () => true });
  assert.deepEqual(effects.map(effect => effect.type), ['publish_receipt', 'send_receipt']);
  assert.deepEqual(effects[0]?.postIds, ['post-a']);
  assert.deepEqual(queries, ['posts', 'workflow_tasks']);
});

test('succeeded external task with missing references remains conservatively guarded', async () => {
  const publish = task('publish', 'platform_publish', { status: 'succeeded' });
  const store: Pick<DataStore, 'list'> = {
    async list<T>() { return { items: [] as T[], totalItems: 0, totalPages: 0, page: 1, perPage: 500 }; },
  };
  const effects = await irreversibleEffects({ store, tenantId: 'tenant-a', run,
    affected: [publish], followupRunHasExternalReceipt: async () => false });
  assert.deepEqual(effects.map(effect => effect.type), ['conservative_external_effect_guard']);
});
