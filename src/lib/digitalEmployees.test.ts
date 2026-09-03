import assert from 'node:assert/strict';
import { buildPublishingReconciliationPayload, digitalEmployeeApi, parseSseBuffer, parseSsePacket } from './digitalEmployees.js';

const event = { id: 'e1', run_id: 'r1', task_id: 't1', sequence: 2, type: 'task.completed', level: 'success', summary: 'done', payload: {}, occurred_at: '2025-01-01T00:00:00Z' };
const first = parseSseBuffer(`id: 2\r\ndata: ${JSON.stringify(event).slice(0, 40)}`);
assert.equal(first.packets.length, 0);
const second = parseSseBuffer(`${first.remainder}${JSON.stringify(event).slice(40)}\r\n\r\n: heartbeat\n\n`);
assert.equal(second.packets.length, 2);
assert.deepEqual(parseSsePacket(second.packets[0]), event);
assert.equal(parseSsePacket(': heartbeat'), null);
assert.equal(parseSsePacket('data: not-json'), null);

const calls: Array<{ url: string; init?: RequestInit }> = [];
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  return new Response(JSON.stringify({ config: null, goals: [], goal: null, contract: null, plan: null, run: null, tasks: [], events: [], approvals: [], handoffs: [], review: null, agents: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
await digitalEmployeeApi.decideApproval('approval-1', 'approved', 'ok', { expectedActionVersion: 3, expectedPayloadHash: 'sha256:abc' });
assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), { decision: 'approved', note: 'ok', expectedActionVersion: 3, expectedPayloadHash: 'sha256:abc' });
await digitalEmployeeApi.returnTask('task-1', { note: '人工完成', result: { summary: 'done' }, references: ['studio-1'], externalActionsPerformed: true, outcome: 'completed' });
assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), { note: '人工完成', result: { summary: 'done' }, references: ['studio-1'], externalActionsPerformed: true, outcome: 'completed' });

const reconciliation = buildPublishingReconciliationPayload({
  action: 'confirm_published',
  expectedRevision: 7,
  note: ' 已逐账号核对 ',
  targetAccountIds: ['tiktok-main', 'youtube-main'],
  allowedDecisions: ['confirm_published', 'confirm_not_published_retry', 'void'],
  receipts: [
    { accountId: 'tiktok-main', outcome: 'published', platformPostId: 'tt-42', verifiedAt: '2026-09-02T08:00:00.000Z', evidence: '平台后台记录 tt-evidence' },
    { accountId: 'youtube-main', outcome: 'published', platformPostId: 'yt-42', verifiedAt: '2026-09-02T08:01:00.000Z', evidence: '平台后台记录 yt-evidence' },
  ],
});
if (!reconciliation.ok) throw new Error(reconciliation.error);
assert.equal(reconciliation.ok, true);
assert.equal(reconciliation.value.note, '已逐账号核对');
assert.equal(reconciliation.value.receipts.length, 2);
await digitalEmployeeApi.decidePublishingReconciliation('post/with space', reconciliation.value);
assert.equal(calls.at(-1)?.url, '/api/overseas/digital-employees/publishing-reconciliations/post%2Fwith%20space/decide');
assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), reconciliation.value);

const blindRetry = buildPublishingReconciliationPayload({ ...reconciliation.value, action: 'confirm_not_published_retry', targetAccountIds: ['tiktok-main', 'youtube-main'], allowedDecisions: ['confirm_not_published_retry'] });
assert.equal(blindRetry.ok, false);
if (!blindRetry.ok) assert.match(blindRetry.error, /禁止盲目重试/);
const incomplete = buildPublishingReconciliationPayload({ ...reconciliation.value, targetAccountIds: ['tiktok-main', 'youtube-main', 'instagram-main'], allowedDecisions: ['confirm_published'] });
assert.equal(incomplete.ok, false);
globalThis.fetch = originalFetch;

console.log('digital employee SSE parser tests passed');
