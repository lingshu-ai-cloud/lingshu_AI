import assert from 'node:assert/strict';
import test from 'node:test';
import { submitContentIntakeBatch } from './assistantContentIntakeBatch';

test('multi-product retry retains unknown request key and never duplicates completed weekly tasks', async () => {
  const keys = new Map<string, string>(); const completed = new Map<string, string>();
  const calls: string[] = []; const receipts: string[] = []; let fail = true;
  const input = { ids: ['a', 'b'], keys, completed, isCurrent: () => true,
    create: async (id: string, key: string) => { calls.push(`${id}:${key}`); if (id === 'b' && fail) throw new Error('断线'); return { id: `task-${id}` }; },
    taskId: (result: { id: string }) => result.id, onResult: (result: { id: string }) => receipts.push(result.id) };
  await assert.rejects(submitContentIntakeBatch(input), /断线/);
  assert.equal(completed.get('a'), 'task-a'); assert.equal(completed.has('b'), false);
  fail = false; await submitContentIntakeBatch(input);
  assert.equal(calls.length, 3); assert.equal(calls[1], calls[2]);
  assert.deepEqual(receipts, ['task-a', 'task-b']);
  await submitContentIntakeBatch(input); assert.equal(calls.length, 3);
});

test('scope invalidation stops remaining dispatch and discards stale receipt', async () => {
  let current = true; let count = 0; const completed = new Map<string, string>();
  await submitContentIntakeBatch({ ids: ['a', 'b'], keys: new Map(), completed, isCurrent: () => current,
    create: async () => { count++; current = false; return 'task'; }, taskId: value => value,
    onResult: () => assert.fail('不得回填旧租户回执') });
  assert.equal(count, 1); assert.equal(completed.size, 0);
});
