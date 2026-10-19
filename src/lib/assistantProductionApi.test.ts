import assert from 'node:assert/strict';
import test from 'node:test';
import { socialContentApi } from './socialContentApi';

test('production actions retain exact object version and idempotency; failure never becomes success', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'token' } });
  const calls: { path: string; body: unknown; key: string | null }[] = [];
  try {
    globalThis.fetch = async (path, init) => {
      calls.push({ path: String(path), body: init?.body ? JSON.parse(String(init.body)) : null,
        key: new Headers(init?.headers).get('idempotency-key') });
      return new Response(JSON.stringify({ task: { taskId: 'task-a' }, receipt: { taskId: 'task-a', status: 'producing', started: true } }), { status: 200 });
    };
    const result = await socialContentApi.startAssistantAction('task-a', 'version-a', 'unique-command');
    assert.equal(result.receipt.taskId, 'task-a');
    assert.deepEqual(calls[0], { path: '/api/overseas/starter-198/social-content/assistant-actions/task-a/start',
      body: { expectedVersion: 'version-a' }, key: 'unique-command' });
    await socialContentApi.reviseAssistantAction('task-a', 'artifact-a', 'artifact-version', '改开头', 'revision-command');
    assert.deepEqual(calls[1].body, { artifactId: 'artifact-a', expectedVersion: 'artifact-version', note: '改开头' });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'version_conflict', message: '对象已更新' }), { status: 409 });
    await assert.rejects(socialContentApi.startAssistantAction('task-a', 'old-version', 'conflict-command'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
