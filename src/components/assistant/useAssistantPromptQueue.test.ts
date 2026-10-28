import assert from 'node:assert/strict';
import test from 'node:test';
import { clearQueuePauseWhenEmpty, readPromptQueue, shouldQueuePrompt, writePromptQueue } from './useAssistantPromptQueue';

test('queue storage isolates account, conversation and reset version, and removes sent entries', () => {
  const original = globalThis.sessionStorage;
  const entries = new Map<string, string>();
  Object.assign(globalThis, { sessionStorage: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  }});
  try {
    const first = { id: '1', text: '第一个问题' }, second = { id: '2', text: '第二个问题' };
    const scope = 'tenant-a\u0000user-a:conversation-one:0';
    assert.equal(writePromptQueue(scope, [first, second]), true);
    assert.deepEqual(readPromptQueue(scope), [first, second]);
    assert.deepEqual(readPromptQueue('tenant-a\u0000user-b:conversation-one:0'), []);
    assert.deepEqual(readPromptQueue('tenant-a\u0000user-a:conversation-two:0'), []);
    assert.deepEqual(readPromptQueue('tenant-a\u0000user-a:conversation-one:1'), []);
    writePromptQueue(scope, [second]);
    assert.deepEqual(readPromptQueue(scope), [second]);
    writePromptQueue(scope, []);
    assert.deepEqual(readPromptQueue(scope), []);
    assert.equal(entries.size, 0);
    Object.assign(globalThis, { sessionStorage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } } });
    assert.deepEqual(readPromptQueue(scope), []);
    assert.equal(writePromptQueue(scope, [first]), false);
  } finally { Object.assign(globalThis, { sessionStorage: original }); }
});


test('new messages join waiting or dispatching work and empty queues clear their pause', () => {
  assert.equal(shouldQueuePrompt(true, false, 0), true, 'active reply');
  assert.equal(shouldQueuePrompt(false, false, 2), true, 'paused or waiting entries');
  assert.equal(shouldQueuePrompt(false, true, 0), true, 'dispatch before loading state commits');
  assert.equal(shouldQueuePrompt(false, false, 0), false, 'idle empty queue');
  const paused = new Set(['one', 'other']);
  clearQueuePauseWhenEmpty(paused, 'one', 1);
  assert.equal(paused.has('one'), true);
  clearQueuePauseWhenEmpty(paused, 'one', 0);
  assert.equal(paused.has('one'), false);
  assert.equal(paused.has('other'), true, 'other conversations remain isolated');
});
