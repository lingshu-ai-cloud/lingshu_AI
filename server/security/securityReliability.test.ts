import assert from 'node:assert/strict';
import type { AtomicCompareResult, Record_, Where } from '../storage/datastore.js';
import { MemoryAtomicStore } from '../testing/memoryAtomicStore.js';
import {
  registerAuthSession,
  revokeAllAuthSessions,
  revokeAuthSession,
  validateAuthSession,
} from './authSessions.js';
import {
  consumeOAuthTransaction,
  createOAuthTransaction,
  revalidateOAuthActor,
} from './oauthTransactions.js';
import {
  beginOutboundOperation,
  completeOutboundOperation,
  outboundPayloadHash,
  resolveOutboundIdempotencyKey,
} from './outboundOperations.js';
import {
  hashLegacyMetaWebhookVerifyToken,
  hashMetaWebhookVerifyToken,
  isMetaWebhookVerifyTokenHash,
  verifyMetaWebhookVerifyToken,
} from './webhookCredentials.js';

function jwt(exp: number, suffix: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp, suffix })).toString('base64url');
  return `${header}.${payload}.unsigned`;
}

const oauthStore = new MemoryAtomicStore();
await oauthStore.create('users', { id: 'user-a', tenantId: 'tenant-a', role: 'admin' });
await oauthStore.create('users', { id: 'user-b', tenantId: 'tenant-b', role: 'viewer' });
const oauthExpiresAt = Date.parse('2030-09-02T00:05:00.000Z');
const oauthIdentity = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  platform: 'youtube',
  returnTo: '/channels',
  expiresAt: oauthExpiresAt,
};
await createOAuthTransaction({ state: 'signed-state-a', ...oauthIdentity }, oauthStore);
const persistedTransaction = oauthStore.all<Record<string, unknown> & { id: string }>('oauth_transactions')[0];
assert.equal(JSON.stringify(persistedTransaction).includes('signed-state-a'), false, 'raw OAuth state must never be persisted');
assert.match(String(persistedTransaction.state_hash), /^[a-f0-9]{64}$/);
await assert.rejects(
  () => createOAuthTransaction({ state: 'signed-state-a', ...oauthIdentity }, oauthStore),
  /oauth_transaction_state_collision/,
);
const oauthConsumes = await Promise.all([
  consumeOAuthTransaction({ state: 'signed-state-a', expected: oauthIdentity }, oauthStore, oauthExpiresAt - 1_000),
  consumeOAuthTransaction({ state: 'signed-state-a', expected: oauthIdentity }, oauthStore, oauthExpiresAt - 1_000),
]);
assert.equal(oauthConsumes.filter(result => result.ok).length, 1, 'an OAuth state must be consumable exactly once');
assert.equal(oauthConsumes.filter(result => !result.ok).length, 1);

const mismatchIdentity = { ...oauthIdentity, tenantId: 'tenant-b' };
await createOAuthTransaction({ state: 'signed-state-b', ...oauthIdentity }, oauthStore);
assert.deepEqual(
  await consumeOAuthTransaction({ state: 'signed-state-b', expected: mismatchIdentity }, oauthStore, oauthExpiresAt - 1_000),
  { ok: false, reason: 'identity_mismatch' },
  'signed state must remain bound to its original tenant and actor',
);
assert.equal((await consumeOAuthTransaction({ state: 'signed-state-b', expected: oauthIdentity }, oauthStore, oauthExpiresAt - 1_000)).ok, true,
  'an identity mismatch must not burn the valid callback');

const expiredIdentity = { ...oauthIdentity, expiresAt: Date.parse('2026-09-02T00:00:00.000Z') };
await createOAuthTransaction({ state: 'signed-state-expired', ...expiredIdentity }, oauthStore);
assert.deepEqual(
  await consumeOAuthTransaction({ state: 'signed-state-expired', expected: expiredIdentity }, oauthStore, expiredIdentity.expiresAt + 1),
  { ok: false, reason: 'expired' },
);
assert.equal(await revalidateOAuthActor({ userId: 'user-a', tenantId: 'tenant-a' }, oauthStore), true);
assert.equal(await revalidateOAuthActor({ userId: 'user-a', tenantId: 'tenant-b' }, oauthStore), false);
assert.equal(await revalidateOAuthActor({ userId: 'user-b', tenantId: 'tenant-b' }, oauthStore), false, 'callback RBAC must reject viewers');

const previousNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
try {
  const sessionStore = new MemoryAtomicStore();
  await sessionStore.create('users', { id: 'session-user', tenantId: 'tenant-a', role: 'admin', session_epoch: 0 });
  await sessionStore.create('users', { id: 'other-user', tenantId: 'tenant-b', role: 'admin', session_epoch: 0 });
  const token = jwt(Math.floor(Date.now() / 1_000) + 3_600, 'first');
  const identity = { userId: 'session-user', tenantId: 'tenant-a' };
  await registerAuthSession({ token, ...identity, dataStore: sessionStore });
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${token}`, identity, dataStore: sessionStore }), true);
  const persistedSession = sessionStore.all<Record<string, unknown> & { id: string }>('auth_sessions')[0];
  assert.equal(JSON.stringify(persistedSession).includes(token), false, 'raw bearer tokens must never be persisted');
  assert.match(String(persistedSession.token_hash), /^[a-f0-9]{64}$/);
  await sessionStore.update('auth_sessions', persistedSession.id, { expires_at: 'invalid-date' });
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${token}`, identity, dataStore: sessionStore }), false,
    'malformed session expiry metadata must fail closed');
  await sessionStore.update('auth_sessions', persistedSession.id, { expires_at: persistedSession.expires_at });
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${token}`, identity: { userId: 'session-user', tenantId: 'tenant-b' }, dataStore: sessionStore }), false);
  assert.equal(await revokeAuthSession({ authHeader: `Bearer ${token}`, identity, dataStore: sessionStore }), true);
  assert.equal(await revokeAuthSession({ authHeader: `Bearer ${token}`, identity, dataStore: sessionStore }), true, 'logout must be idempotent');
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${token}`, identity, dataStore: sessionStore }), false);

  const tokenAfterLogin = jwt(Math.floor(Date.now() / 1_000) + 3_600, 'second');
  await registerAuthSession({ token: tokenAfterLogin, ...identity, dataStore: sessionStore });
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${tokenAfterLogin}`, identity, dataStore: sessionStore }), true);
  const epochs = await Promise.all([
    revokeAllAuthSessions({ identity, dataStore: sessionStore }),
    revokeAllAuthSessions({ identity, dataStore: sessionStore }),
  ]);
  assert.deepEqual([...epochs].sort((left, right) => left - right), [1, 2], 'concurrent logout-all calls must CAS-increment the epoch');
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${tokenAfterLogin}`, identity, dataStore: sessionStore }), false,
    'an epoch increment must revoke every earlier token immediately');
  const freshToken = jwt(Math.floor(Date.now() / 1_000) + 3_600, 'third');
  await registerAuthSession({ token: freshToken, ...identity, dataStore: sessionStore });
  assert.equal(await validateAuthSession({ authHeader: `Bearer ${freshToken}`, identity, dataStore: sessionStore }), true);
  await assert.rejects(
    () => registerAuthSession({ token: freshToken, userId: 'other-user', tenantId: 'tenant-b', dataStore: sessionStore }),
    /auth_session_token_conflict/,
  );
} finally {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
}

const outboundStore = new MemoryAtomicStore();
const payloadA = { message: 'hello', nested: { z: 1, a: 2 } };
const payloadAReordered = { nested: { a: 2, z: 1 }, message: 'hello' };
const payloadHash = outboundPayloadHash(payloadA);
assert.equal(payloadHash, outboundPayloadHash(payloadAReordered), 'semantic JSON key order must not alter an idempotency digest');
const circularPayload: Record<string, unknown> = {};
circularPayload.self = circularPayload;
assert.throws(() => outboundPayloadHash(circularPayload), /outbound_payload_circular/);

const idempotencyKey = resolveOutboundIdempotencyKey({
  operationType: 'social_reply',
  tenantId: 'tenant-a',
  targetId: 'comment-1',
  payloadHash,
});
const outboundInput = {
  collection: 'social_reply_operations',
  tenantId: 'tenant-a',
  idempotencyKey,
  operationType: 'social_reply',
  targetId: 'comment-1',
  payloadHash,
  dataStore: outboundStore,
  nowMs: Date.parse('2026-09-02T01:00:00.000Z'),
};
const claims = await Promise.all([beginOutboundOperation(outboundInput), beginOutboundOperation(outboundInput)]);
assert.equal(claims.filter(result => result.ok && result.state === 'claimed').length, 1, 'only one caller may claim an outbound side effect');
assert.equal(claims.filter(result => !result.ok && result.reason === 'in_progress').length, 1);
const claimed = claims.find(result => result.ok && result.state === 'claimed');
assert.ok(claimed?.ok);
const completions = await Promise.all([
  completeOutboundOperation({ collection: outboundInput.collection, operation: claimed.operation, providerMessageIds: ['reply-1'], result: { ok: true }, dataStore: outboundStore }),
  completeOutboundOperation({ collection: outboundInput.collection, operation: claimed.operation, providerMessageIds: ['reply-1'], result: { ok: true }, dataStore: outboundStore }),
]);
assert.ok(completions.every(Boolean), 'a concurrent duplicate completion must converge on the durable result');
const replay = await beginOutboundOperation(outboundInput);
assert.equal(replay.ok && replay.state, 'completed');
assert.deepEqual(replay.operation.provider_message_ids, ['reply-1']);
const payloadConflict = await beginOutboundOperation({ ...outboundInput, payloadHash: outboundPayloadHash({ message: 'changed' }) });
assert.equal(payloadConflict.ok, false);
if (!payloadConflict.ok) assert.equal(payloadConflict.reason, 'payload_conflict');

const stale = await beginOutboundOperation({
  ...outboundInput,
  idempotencyKey: `${idempotencyKey}:stale`,
  nowMs: Date.parse('2026-09-02T01:00:00.000Z'),
});
assert.equal(stale.ok && stale.state, 'claimed');
const staleRetry = await beginOutboundOperation({
  ...outboundInput,
  idempotencyKey: `${idempotencyKey}:stale`,
  nowMs: Date.parse('2026-09-02T01:10:00.000Z'),
  staleAfterMs: 60_000,
});
assert.equal(staleRetry.ok, false);
if (!staleRetry.ok) assert.equal(staleRetry.reason, 'needs_reconciliation', 'an unknown stale side effect must never be replayed');

class CompleteBeforeStaleCasStore extends MemoryAtomicStore {
  completedBeforeCas = false;

  override async compareAndSet<T = Record_>(
    collection: string,
    id: string,
    expected: Where,
    data: Record<string, unknown>,
  ): Promise<AtomicCompareResult<T>> {
    if (!this.completedBeforeCas && data.status === 'needs_reconciliation') {
      this.completedBeforeCas = true;
      const revision = Number(expected.revision || 0);
      await super.compareAndSet(collection, id, expected, {
        status: 'completed', revision: revision + 1, provider_message_ids: ['provider-race-winner'],
      });
    }
    return super.compareAndSet<T>(collection, id, expected, data);
  }
}
const staleRaceStore = new CompleteBeforeStaleCasStore();
const staleRaceInput = {
  ...outboundInput,
  idempotencyKey: `${idempotencyKey}:race`,
  dataStore: staleRaceStore,
  nowMs: Date.parse('2026-09-02T01:00:00.000Z'),
};
assert.equal((await beginOutboundOperation(staleRaceInput)).ok, true);
const staleRaceResult = await beginOutboundOperation({
  ...staleRaceInput,
  nowMs: Date.parse('2026-09-02T01:10:00.000Z'),
  staleAfterMs: 60_000,
});
assert.equal(staleRaceResult.ok && staleRaceResult.state, 'completed',
  'a completion that wins the stale CAS race must be replayed as completed, not mislabeled unknown');

const webhookToken = 'meta-verification-token-production-01';
const webhookHash = hashMetaWebhookVerifyToken(webhookToken);
assert.equal(isMetaWebhookVerifyTokenHash(webhookHash), true);
assert.equal(webhookHash.includes(webhookToken), false);
assert.equal(verifyMetaWebhookVerifyToken(webhookHash, webhookToken), true);
assert.equal(verifyMetaWebhookVerifyToken(webhookHash, `${webhookToken}-wrong`), false);
assert.equal(verifyMetaWebhookVerifyToken(webhookToken, webhookToken), false, 'legacy plaintext must fail closed at verification time');
assert.equal(verifyMetaWebhookVerifyToken(hashLegacyMetaWebhookVerifyToken(webhookToken), webhookToken), true);
assert.equal(verifyMetaWebhookVerifyToken(hashLegacyMetaWebhookVerifyToken('legacy-short'), 'legacy-short'), true,
  'lazy hashing must not break an existing short verification token');
assert.throws(() => hashMetaWebhookVerifyToken('short'), /webhook_verify_token_invalid/);

console.log('OAuth transaction, auth session, outbound idempotency, and webhook credential reliability tests passed');
