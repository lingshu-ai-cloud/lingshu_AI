import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeSocialChannelId } from '../../shared/contracts/socialChannels.js';
import { createDouyinChannelAdapter, DOUYIN_OFFICIAL_PUBLISH_SCOPE } from './douyinAdapter.js';
import {
  consumeDouyinOAuthState,
  DouyinAccountRefreshLock,
  DouyinAuthError,
  DOUYIN_ACCESS_TOKEN_LIFETIME_SECONDS,
  DOUYIN_REFRESH_TOKEN_LIFETIME_SECONDS,
  issueDouyinOAuthState,
  validateDouyinTokenMetadata,
} from './douyinAuth.js';
import { acceptDouyinWebhook, verifyDouyinWebhookSignature } from './douyinWebhook.js';
import { normalizeAccountContentPage } from './monitoring.js';
import { createDefaultChannelRegistry } from './registry.js';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';

assert.equal(normalizeSocialChannelId('tiktok'), 'tiktok_global');
assert.equal(normalizeSocialChannelId('tiktok_global'), 'tiktok_global');
assert.equal(normalizeSocialChannelId('douyin_cn'), 'douyin_cn');
assert.equal(normalizeSocialChannelId('douyin'), null, 'ambiguous names must not silently become domestic Douyin');

const defaultRegistry = createDefaultChannelRegistry();
const defaultDouyin = defaultRegistry.get('douyin_cn').capabilityMatrix({
  douyin: {
    applicationType: 'web',
    approvedScopes: [DOUYIN_OFFICIAL_PUBLISH_SCOPE],
    tokenType: 'user_access_token',
    tokenHealth: 'valid',
    accountQualification: 'eligible',
    applicationReview: 'approved',
    realAccountE2E: 'passed',
    webhookConfigured: true,
  },
});
assert.equal(defaultDouyin.decisions.publication_package.availability, 'available');
assert.equal(defaultDouyin.decisions.official_publish.availability, 'unconfigured', 'configuration fields alone cannot claim an official connection');
assert.equal(defaultDouyin.decisions.content_list.availability, 'unconfigured', 'video.list must never be assumed');
assert.equal(defaultRegistry.get('tiktok').channelId, 'tiktok_global');
assert.notEqual(defaultRegistry.get('tiktok').channelId, defaultRegistry.get('douyin_cn').channelId);

let officialPublishCalls = 0;
const configuredDouyin = createDouyinChannelAdapter({
  officialPublishApplicationTypes: ['web'],
  officialApi: {
    async createVideo() {
      officialPublishCalls += 1;
      return { status: 'provider_accepted', providerRequestId: 'request-1', receiptHash: 'f'.repeat(64) };
    },
  },
});
const readyContext = {
  douyin: {
    applicationType: 'web' as const,
    approvedScopes: [DOUYIN_OFFICIAL_PUBLISH_SCOPE],
    tokenType: 'user_access_token' as const,
    tokenHealth: 'valid' as const,
    accountQualification: 'eligible' as const,
    applicationReview: 'approved' as const,
    realAccountE2E: 'passed' as const,
    webhookConfigured: true,
  },
};
assert.equal(configuredDouyin.capabilityMatrix(readyContext).decisions.official_publish.availability, 'available');
assert.equal(configuredDouyin.capabilityMatrix({
  douyin: { ...readyContext.douyin, tokenType: 'client_token' },
}).decisions.official_publish.reasonCode, 'douyin_user_token_required');
assert.equal(configuredDouyin.capabilityMatrix({
  douyin: { ...readyContext.douyin, approvedScopes: [] },
}).decisions.official_publish.reasonCode, 'douyin_scope_missing');
assert.equal(configuredDouyin.capabilityMatrix({
  douyin: { ...readyContext.douyin, applicationType: 'mobile' },
}).decisions.official_publish.reasonCode, 'douyin_application_type_not_allowed');
const acceptedReceipt = await configuredDouyin.publishOfficially!({
  tenantId: 'tenant-a', accountId: 'douyin-account-a', accessToken: 'not-returned',
  packageId: 'spkg_123', packageHash: 'a'.repeat(64), contentHash: 'b'.repeat(64),
  idempotencyKey: 'publish-123', capabilityContext: readyContext,
});
assert.equal(acceptedReceipt.status, 'provider_accepted');
assert.equal(officialPublishCalls, 1);
assert.equal(JSON.stringify(acceptedReceipt).includes('not-returned'), false);

const now = new Date('2026-09-19T00:00:00.000Z');
const oauth = issueDouyinOAuthState({
  tenantId: 'tenant-a', userId: 'user-a', redirectUri: 'https://app.example.test/oauth/douyin/callback', now,
});
assert.equal(JSON.stringify(oauth.record).includes(oauth.state), false, 'raw OAuth state must not be persisted');
assert.throws(
  () => consumeDouyinOAuthState({ record: oauth.record, state: 'wrong', code: 'code-a', now }),
  (error: unknown) => error instanceof DouyinAuthError && error.code === 'douyin_oauth_state_invalid',
);
const consumed = consumeDouyinOAuthState({ record: oauth.record, state: oauth.state, code: 'code-a', now });
assert.ok(consumed.consumedAt);
assert.throws(
  () => consumeDouyinOAuthState({ record: consumed, state: oauth.state, code: 'code-b', now }),
  (error: unknown) => error instanceof DouyinAuthError && error.code === 'douyin_oauth_state_already_used',
);
const metadata = validateDouyinTokenMetadata({
  accountId: 'douyin-account-a',
  tokenType: 'user_access_token',
  accessTokenExpiresAt: new Date(now.getTime() + DOUYIN_ACCESS_TOKEN_LIFETIME_SECONDS * 1_000).toISOString(),
  refreshTokenExpiresAt: new Date(now.getTime() + DOUYIN_REFRESH_TOKEN_LIFETIME_SECONDS * 1_000).toISOString(),
  grantedScopes: [DOUYIN_OFFICIAL_PUBLISH_SCOPE, DOUYIN_OFFICIAL_PUBLISH_SCOPE],
}, now);
assert.deepEqual(metadata.grantedScopes, [DOUYIN_OFFICIAL_PUBLISH_SCOPE]);
assert.equal('accessToken' in metadata, false);

type LeaseRow = { id: string } & Record<string, unknown>;
const leaseRows: LeaseRow[] = [];
const leaseStore: DataStore = {
  async getById<T = Record_>(_collection: string, id: string): Promise<T | null> {
    return (leaseRows.find(row => row.id === id) as T | undefined) ?? null;
  },
  async create<T = Record_>(_collection: string, data: Record<string, unknown>): Promise<T | null> {
    if (leaseRows.some(row => row.tenant_id === data.tenant_id
      && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
    const row = { id: `lease-${leaseRows.length + 1}`, ...data };
    leaseRows.push(row);
    return row as T;
  },
  async update(_collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const row = leaseRows.find(item => item.id === id);
    if (!row) return false;
    Object.assign(row, data); return true;
  },
  async delete(_collection: string, id: string): Promise<boolean> {
    const index = leaseRows.findIndex(row => row.id === id);
    if (index < 0) return false;
    leaseRows.splice(index, 1); return true;
  },
  async list<T = Record_>(_collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const items = leaseRows.filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    return { items: items as T[], totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 20 };
  },
};
const refreshLock = new DouyinAccountRefreshLock(leaseStore, 'douyin-refresh-test-owner');
let refreshCalls = 0;
let releaseRefresh!: () => void;
const refreshGate = new Promise<void>(resolve => { releaseRefresh = resolve; });
const firstRefresh = refreshLock.run('tenant-a', 'douyin-account-a', async () => {
  refreshCalls += 1;
  await refreshGate;
  return { version: 2 };
});
const secondRefresh = refreshLock.run('tenant-a', 'douyin-account-a', async () => {
  refreshCalls += 1;
  return { version: 3 };
});
releaseRefresh();
assert.deepEqual(await Promise.all([firstRefresh, secondRefresh]), [{ version: 2 }, { version: 2 }]);
assert.equal(refreshCalls, 1, 'concurrent refreshes for one account must share one lock/result');

let releaseDurableRefresh!: () => void;
let signalDurableStarted!: () => void;
const durableGate = new Promise<void>(resolve => { releaseDurableRefresh = resolve; });
const durableStarted = new Promise<void>(resolve => { signalDurableStarted = resolve; });
const firstOwner = new DouyinAccountRefreshLock(leaseStore, 'douyin-refresh-owner-a');
const secondOwner = new DouyinAccountRefreshLock(leaseStore, 'douyin-refresh-owner-b');
const heldRefresh = firstOwner.run('tenant-a', 'douyin-account-a', async () => {
  signalDurableStarted();
  await durableGate;
  return 'refreshed';
});
await durableStarted;
await assert.rejects(
  secondOwner.run('tenant-a', 'douyin-account-a', async () => 'must-not-run'),
  (error: unknown) => error instanceof DouyinAuthError && error.code === 'douyin_token_refresh_in_progress',
  'a second process owner must lose the durable single-account lease',
);
releaseDurableRefresh();
assert.equal(await heldRefresh, 'refreshed');

const rawBody = Buffer.from('{"event":"video.create"}');
const secret = 'client-secret-for-test';
const signature = createHash('sha1').update(secret).update(rawBody).digest('hex');
assert.equal(verifyDouyinWebhookSignature(secret, rawBody, signature), true);
assert.equal(verifyDouyinWebhookSignature(secret, Buffer.from('{}'), signature), false);
const claimed = new Set<string>();
const queued: string[] = [];
const webhookInput = {
  clientSecret: secret,
  signatureHeader: signature,
  messageIdHeader: 'message-100',
  rawBody,
  claimStore: { claim: async (messageId: string) => !claimed.has(messageId) && Boolean(claimed.add(messageId)) },
  enqueue: (envelope: { messageId: string }) => queued.push(envelope.messageId),
  now,
};
const firstWebhook = await acceptDouyinWebhook(webhookInput);
const duplicateWebhook = await acceptDouyinWebhook(webhookInput);
assert.deepEqual(firstWebhook, { accepted: true, duplicate: false, ackDeadlineMs: 5000 });
assert.equal(duplicateWebhook.duplicate, true);
assert.deepEqual(queued, ['message-100']);

const normalized = normalizeAccountContentPage({
  tenantId: 'tenant-a',
  channelId: 'douyin_cn',
  accountId: 'douyin-account-a',
  source: 'official_api',
  coverage: 'account',
  capturedAt: '2026-09-19T00:00:00.000Z',
  now: new Date('2026-09-19T00:30:00.000Z'),
  opaqueCursor: 'provider-opaque-cursor',
  items: [{
    externalContentId: 'video-100',
    publicUrl: 'https://www.douyin.com/video/100?share=secret',
    status: 'published',
    metrics: { views: 0, likes: 12 },
    rawFields: { provider_view_count: 0, provider_like_count: 12 },
  }],
});
assert.equal(normalized.source, 'official_api');
assert.equal(normalized.metricSnapshots[0].metrics.views, 0, 'a provider-reported zero remains a real zero');
assert.equal(normalized.metricSnapshots[0].metrics.comments, null, 'a missing metric must remain null');
assert.ok(normalized.metricSnapshots[0].unavailableMetrics.includes('comments'));
assert.equal(normalized.metricSnapshots[0].freshness, 'fresh');
assert.equal(normalized.items[0].publicUrl, 'https://www.douyin.com/video/100');
assert.equal(normalized.cursor.cursorDigest.length, 64);

console.log('socialChannels tests passed');
