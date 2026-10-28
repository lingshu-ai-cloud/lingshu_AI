import assert from 'node:assert/strict';
import test from 'node:test';
import { materialCanonicalId, weeklyMaterialRequestsApi } from './weeklyMaterialRequestsApi';

test('declining shooting uses the scoped existing material request and does not submit production', async () => {
  const original = globalThis.fetch; const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'token' } });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/overseas/social-programs/program%2Fa/material-requests/request%2Fb/decline-shooting');
    assert.equal(init?.method, 'POST');assert.deepEqual(JSON.parse(String(init?.body)), {expectedSubmissionVersion:0,expectedConsumers:[{taskId:'task',packageId:'week',packageVersion:2}]});
    return Response.json({ item: { status: 'cancelled' } });
  };
  try { assert.equal((await weeklyMaterialRequestsApi.declineShooting('program/a', {requestId:'request/b',submissions:[],consumers:[{taskId:'task',packageId:'week',packageVersion:2,requirement:'photo'}]} as any)).status, 'cancelled'); }
  finally { globalThis.fetch = original; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});
test('canonical selections only use actual cloud record IDs, never arbitrary local asset IDs', () => {
  assert.equal(materialCanonicalId({ id: 'pb-1234567890abcde' }), '1234567890abcde');
  for (const id of ['local-file', '1234567890abcde', 'pb-short', 'pb-../private']) assert.equal(materialCanonicalId({ id }), null);
});
test('submission sends only selected canonical records and expected version; authenticated server controls actor', async () => {
  const previousFetch = globalThis.fetch; const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'token' } });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/overseas/social-programs/program%2Fa/material-requests/request%2Fb/submissions');
    const body = JSON.parse(String(init?.body)); assert.deepEqual(body, { materialRecordIds: ['1234567890abcde'], expectedSubmissionVersion: 2 });
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
    return Response.json({ item: { status: 'pending_verification' } });
  };
  try { assert.equal((await weeklyMaterialRequestsApi.submit('program/a', 'request/b', ['1234567890abcde'], 2)).status, 'pending_verification'); }
  finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});
test('review preserves explicit per-consumer decision and three independent evidence conclusions', async () => {
  const previousFetch = globalThis.fetch; const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'token' } });
  const decisions = [{ taskId: 'task', accepted: false, factCheck: 'product differs', rightsCheck: 'own footage', visualCheck: 'wrong angle' }];
  globalThis.fetch = async (_url, init) => { assert.deepEqual(JSON.parse(String(init?.body)), { submissionVersion: 3, consumerDecisions: decisions }); return Response.json({ item: { status: 'rejected' } }); };
  try { assert.equal((await weeklyMaterialRequestsApi.review('program', 'request', 3, decisions)).status, 'rejected'); }
  finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});
test('deadline revision sends upload and verification separately with an explicit reason', async () => {
  const previousFetch = globalThis.fetch; const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'token' } });
  const revision = { dueAt: '2026-10-08T04:00:00Z', verificationDueAt: '2026-10-08T06:00:00Z', reason: '拍摄延迟，已重新安排核验', timeZone: 'Asia/Shanghai' };
  globalThis.fetch = async (url, init) => { assert.equal(String(url), '/api/overseas/social-programs/program/material-requests/request/revisions'); assert.deepEqual(JSON.parse(String(init?.body)), revision); return Response.json({ item: { ...revision, status: 'missing' } }); };
  try { assert.equal((await weeklyMaterialRequestsApi.revise('program', 'request', revision)).verificationDueAt, revision.verificationDueAt); }
  finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});
