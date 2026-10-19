import assert from 'node:assert/strict';
import { test } from 'node:test';
import { socialContentOrderOperationsApi as api } from './socialContentOrderOperationsApi';
import { SocialContentRequestError } from './socialContentApi';

test('planning operations use authenticated real routes and stable explicit command identities', async () => {
  const original = globalThis.fetch;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-token' } });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify({ item: {} }), { headers: { 'Content-Type': 'application/json' } }); };
  try {
    await api.read('task/a');
    const command = { programId: 'p', weekStart: '2026-10-12', commandId: 'same-command', reason: '修改范围', expectedRevision: 3 };
    await api.replace({ ...command, selectedContentId: 'old', replacementTaskId: 'new' });
    await api.increase({ ...command, newLimit: 6, confirmed: true });
    await api.cancel('task/a', { expectedVersion: 'v2', expectedGroupHash: 'frozen-group', reason: '不再制作' }, 'cancel-command');
    await api.cancel('task/a', { expectedVersion: 'v2', expectedGroupHash: 'frozen-group', reason: '不再制作' }, 'cancel-command');
    assert.match(calls[0].url, /\/api\/overseas\/starter-198\/social-content\/tasks\/task%2Fa\/order-planning$/);
    assert.equal(calls[0].init?.method, undefined);
    assert.ok(new Headers(calls[0].init?.headers).get('Authorization'));
    assert.equal(new Headers(calls[1].init?.headers).get('Idempotency-Key'), command.commandId);
    assert.equal(JSON.parse(String(calls[2].init?.body)).confirmed, true);
    assert.equal(new Headers(calls[3].init?.headers).get('Idempotency-Key'), 'cancel-command');
    assert.equal(JSON.parse(String(calls[3].init?.body)).expectedGroupHash, 'frozen-group');
    assert.equal(calls[3].init?.body, calls[4].init?.body);
    assert.equal(new Headers(calls[4].init?.headers).get('Idempotency-Key'), 'cancel-command');
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'revision_conflict' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(() => api.increase({ ...command, newLimit: 6, confirmed: true }), (cause: unknown) => cause instanceof SocialContentRequestError && cause.status === 409);
  } finally {
    globalThis.fetch = original;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('group cancellation reads retain independent execution, quota, history and external-settlement evidence', async () => {
  const original = globalThis.fetch;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-token' } });
  const snapshot = { taskId: 'child', taskVersion: 'c2', scope: null, planning: null, cancelable: true, cancellationPending: false, cancelTarget: { taskId: 'root', taskVersion: 'r3', groupHash: 'group-fence', participants: [{ taskId: 'root', title: '原成片', status: 'delivered', role: 'original' }, { taskId: 'child', title: '产品镜头修订', status: 'cancelled', role: 'revision' }] }, cancellation: { executionStopped: true, quotaReleased: false, externalSettlementPending: true, retainedReasons: ['unknown'], participants: [{ taskId: 'root', status: 'delivered', preservedStatus: 'delivered', jobIds: ['history'], retainedReasons: ['already_delivered'] }, { taskId: 'child', status: 'cancelled', preservedStatus: null, jobIds: ['unknown-job'], retainedReasons: ['unknown'] }] } };
  globalThis.fetch = async () => new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } });
  try { assert.deepEqual(await api.read('child'), snapshot); }
  finally { globalThis.fetch = original; if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
