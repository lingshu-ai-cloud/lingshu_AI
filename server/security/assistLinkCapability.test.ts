import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assistSecretHash,
  claimAssistLink,
  consumeAssistOAuthClaim,
  findAssistLinkByRawToken,
  generateAssistLinkToken,
  publicAssistLinkStatus,
  releaseAssistOAuthClaim,
  validateAssistOAuthClaim,
  type AssistLinkRecord,
} from '../lib/assistLinkCapability.js';
import { parseOAuthState, signOAuthState } from '../lib/tenantPlatformApps.js';
import type {
  AtomicCompareResult,
  DataStore,
  ListQuery,
  ListResult,
  Record_,
  Where,
} from '../storage/datastore.js';

class MemoryStore implements DataStore {
  readonly collections = new Map<string, Record_[]>();

  seed<T extends Record_>(collection: string, records: T[]) {
    this.collections.set(collection, records.map(record => ({ ...record })));
  }

  async getById<T = Record_>(collection: string, id: string): Promise<T | null> {
    return (this.collections.get(collection)?.find(record => record.id === id) as T | undefined) ?? null;
  }

  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const records = this.collections.get(collection) || [];
    const record = { id: String(data.id || `id_${records.length + 1}`), ...data } as Record_;
    records.push(record);
    this.collections.set(collection, records);
    return record as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const record = this.collections.get(collection)?.find(item => item.id === id);
    if (!record) return false;
    Object.assign(record, data);
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const records = this.collections.get(collection) || [];
    const next = records.filter(record => record.id !== id);
    this.collections.set(collection, next);
    return next.length !== records.length;
  }

  async list<T = Record_>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const filtered = (this.collections.get(collection) || []).filter(record => Object.entries(query.where || {})
      .every(([key, value]) => String(record[key] ?? '') === String(value)));
    const perPage = query.perPage || 20;
    return {
      items: filtered.slice(0, perPage) as T[],
      totalItems: filtered.length,
      totalPages: Math.ceil(filtered.length / perPage),
      page: 1,
      perPage,
    };
  }

  async compareAndSet<T = Record_>(
    collection: string,
    id: string,
    expected: Where,
    data: Record<string, unknown>,
  ): Promise<AtomicCompareResult<T>> {
    const record = this.collections.get(collection)?.find(item => item.id === id);
    if (!record) return { ok: false, reason: 'not_found' };
    const matches = Object.entries(expected).every(([key, value]) => String(record[key] ?? '') === String(value));
    if (!matches) return { ok: false, reason: 'conflict', current: record as T };
    Object.assign(record, data);
    return { ok: true, record: record as T };
  }

  async createIfAbsent<T = Record_>(
    collection: string,
    uniqueWhere: Where,
    data: Record<string, unknown>,
  ): Promise<{ created: boolean; record: T }> {
    const existing = (this.collections.get(collection) || []).find(record => Object.entries(uniqueWhere)
      .every(([key, value]) => String(record[key] ?? '') === String(value)));
    if (existing) return { created: false, record: existing as T };
    const created = await this.create<T>(collection, { ...data, ...uniqueWhere });
    if (!created) throw new Error('create_failed');
    return { created: true, record: created };
  }
}

const now = Date.parse('2030-01-01T00:00:00.000Z');
const generated = generateAssistLinkToken();
assert.equal(generated.tokenHash, assistSecretHash(generated.rawToken));
assert.equal(generated.tokenHash.length, 64);
assert.equal(generated.tokenPrefix.length, 6);
assert.equal(generated.tokenLast4.length, 4);

const baseRecord: AssistLinkRecord = {
  id: 'assistlink00001',
  token_hash: generated.tokenHash,
  token_prefix: generated.tokenPrefix,
  token_last4: generated.tokenLast4,
  tenant_id: 'tenant-a',
  platform: 'google',
  status: 'pending',
  expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
  revision: 0,
};
const memory = new MemoryStore();
memory.seed('assist_links', [baseRecord]);

const found = await findAssistLinkByRawToken(generated.rawToken, memory);
assert.equal(found?.id, baseRecord.id);
assert.equal(found?.token, undefined, 'hardened records never contain the raw capability');
const publicStatus = publicAssistLinkStatus(baseRecord, now);
assert.equal('token' in publicStatus, false, 'public lookup must not echo the capability');
assert.equal('tenantId' in publicStatus, false, 'public lookup must not disclose tenant identity');
assert.equal(await findAssistLinkByRawToken(`${generated.rawToken}x`, memory), null);

// Two concurrent starts operate on the same stale snapshot. CAS must admit
// exactly one and reject the other before either OAuth URL can be returned.
const [firstClaim, secondClaim] = await Promise.all([
  claimAssistLink({ ...baseRecord }, memory, now),
  claimAssistLink({ ...baseRecord }, memory, now),
]);
const claimResults = [firstClaim, secondClaim];
assert.equal(claimResults.filter(result => result.ok).length, 1);
assert.equal(claimResults.filter(result => !result.ok && result.reason === 'conflict').length, 1);
const winner = claimResults.find(result => result.ok);
assert.ok(winner?.ok);

const valid = await validateAssistOAuthClaim({
  tenantId: 'tenant-a',
  oauthPlatform: 'youtube',
  claim: winner.claim,
}, memory, now + 1);
assert.equal(valid.ok, true);
assert.equal((await validateAssistOAuthClaim({ tenantId: 'tenant-b', oauthPlatform: 'youtube', claim: winner.claim }, memory, now + 1)).ok, false);
assert.equal((await validateAssistOAuthClaim({ tenantId: 'tenant-a', oauthPlatform: 'facebook', claim: winner.claim }, memory, now + 1)).ok, false);
assert.equal((await validateAssistOAuthClaim({
  tenantId: 'tenant-a', oauthPlatform: 'youtube', claim: { ...winner.claim, claimNonce: generateAssistLinkToken().rawToken },
}, memory, now + 1)).ok, false);
assert.equal((await validateAssistOAuthClaim({
  tenantId: 'tenant-a', oauthPlatform: 'youtube', claim: { ...winner.claim, revision: winner.claim.revision + 1 },
}, memory, now + 1)).ok, false);
assert.equal((await validateAssistOAuthClaim({
  tenantId: 'tenant-a', oauthPlatform: 'youtube', claim: winner.claim,
}, memory, now + 11 * 60 * 1000)).ok, false, 'expired callback claims fail closed');

process.env.OAUTH_STATE_SECRET = 'assist-link-capability-test-state-secret-32-bytes';
const signed = signOAuthState({
  tenantId: 'tenant-a',
  userId: 'user-a',
  platform: 'youtube',
  returnTo: '/assist/status?done=1',
  expiresAt: now + 5 * 60 * 1000,
  assist: winner.claim,
});
const decodedState = Buffer.from(signed.split('.')[0]!, 'base64url').toString('utf8');
assert.ok(!decodedState.includes(generated.rawToken), 'OAuth state must not disclose the raw magic-link token');
const parsed = parseOAuthState(signed);
assert.deepEqual(parsed?.assist, winner.claim);
assert.equal(parseOAuthState(`${signed.slice(0, -1)}${signed.endsWith('a') ? 'b' : 'a'}`), null, 'forged state is rejected');
assert.equal(parseOAuthState(signOAuthState({
  tenantId: 'tenant-a', userId: 'user-a', platform: 'youtube', returnTo: '/', expiresAt: Date.now() - 1,
})), null, 'expired state is rejected');

const consumed = await consumeAssistOAuthClaim({
  tenantId: 'tenant-a',
  oauthPlatform: 'youtube',
  claim: winner.claim,
  connectedAccountId: 'youtube-account-1',
}, memory, now + 2);
assert.equal(consumed.ok, true);
assert.equal(consumed.ok && consumed.record.status, 'consumed');
assert.equal(consumed.ok && consumed.record.connected_account_id, 'youtube-account-1');
assert.equal((await validateAssistOAuthClaim({
  tenantId: 'tenant-a', oauthPlatform: 'youtube', claim: winner.claim,
}, memory, now + 3)).ok, false, 'a consumed callback cannot be replayed');

const releaseToken = generateAssistLinkToken();
const releaseRecord: AssistLinkRecord = {
  ...baseRecord,
  id: 'assistlink00002',
  token_hash: releaseToken.tokenHash,
  token_prefix: releaseToken.tokenPrefix,
  token_last4: releaseToken.tokenLast4,
};
memory.seed('assist_links', [releaseRecord]);
const releaseClaim = await claimAssistLink({ ...releaseRecord }, memory, now);
assert.ok(releaseClaim.ok);
const released = await releaseAssistOAuthClaim({
  tenantId: 'tenant-a', oauthPlatform: 'youtube', claim: releaseClaim.claim,
}, memory, now + 1);
assert.equal(released.ok, true);
assert.equal(released.ok && released.record.status, 'pending');
assert.equal(released.ok && released.record.revision, 2);
assert.equal((await validateAssistOAuthClaim({
  tenantId: 'tenant-a', oauthPlatform: 'youtube', claim: releaseClaim.claim,
}, memory, now + 2)).ok, false, 'released state cannot be replayed');

const legacy = new MemoryStore();
legacy.seed<AssistLinkRecord>('assist_links', [{
  id: 'assistlink00003',
  token: generated.rawToken,
  token_hash: '',
  tenant_id: 'tenant-a',
  platform: 'google',
  status: 'pending',
  expires_at: new Date(now + 60_000).toISOString(),
  revision: 0,
}]);
assert.equal(await findAssistLinkByRawToken(generated.rawToken, legacy), null, 'legacy plaintext capability is fail-closed');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const routeSource = fs.readFileSync(path.join(root, 'server/routes/assistLinks.ts'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'src/components/AssistLinkPage.tsx'), 'utf8');
const migrationSource = fs.readFileSync(path.join(root, 'pb_migrations/1788307206_harden_assist_links.js'), 'utf8');
assert.match(routeSource, /assist_link_completion_is_callback_only/);
assert.doesNotMatch(uiSource, /assist-links\/\$\{encodeURIComponent\(token\)\}\/complete/);
assert.match(migrationSource, /record\.set\("status", "revoked"\)/);
assert.match(migrationSource, /record\.set\("token", ""\)/);
assert.ok(
  migrationSource.indexOf('fields.getByName("token").required = false') < migrationSource.indexOf('app.findAllRecords("assist_links")'),
  'legacy plaintext constraints must be relaxed before records are revoked',
);

console.log('assist-link capabilities are hashed, atomically claimed, callback-bound, auditable, and single-use');
