import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import {
  platformAccountIdentityHash,
  PLATFORM_CAPABILITY_EVIDENCE_COLLECTION,
  ensurePlatformCapability,
  platformCapabilityDecision,
  platformCapabilityEvidenceIsCurrent,
  refreshPlatformCapabilityEvidence,
  type PlatformCapabilityEvidence,
  type PlatformCapabilityProbeProviders,
} from './platformCapabilities.js';

class MemoryStore implements DataStore {
  rows = new Map<string, Array<Record<string, unknown> & { id: string }>>();
  async getById<T>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }
  async create<T>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const row = { id: `${collection}-${(this.rows.get(collection)?.length || 0) + 1}`, ...data };
    this.rows.set(collection, [...(this.rows.get(collection) || []), row]);
    return row as T;
  }
  async update(collection:string,id:string,data:Record<string,unknown>): Promise<boolean> {const row=this.rows.get(collection)?.find(r=>r.id===id);if(!row)return false;Object.assign(row,data);return true; }
  async delete(): Promise<boolean> { return true; }
  async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    let items = [...(this.rows.get(collection) || [])];
    for (const [key, value] of Object.entries(query.where || {})) items = items.filter(row => row[key] === value);
    items.sort((a, b) => String(b.verified_at || '').localeCompare(String(a.verified_at || '')));
    return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage || items.length };
  }
}

const now = new Date('2026-09-26T08:00:00.000Z');
const baseEvidence = (patch: Partial<PlatformCapabilityEvidence> = {}): PlatformCapabilityEvidence => ({
  id: 'e1', tenant_id: 'tenant-a', account_id: 'account-a', platform: 'youtube',
  capability: 'publishing.official', status: 'verified', evidence_source: 'provider_probe',
  evidence_ref: 'provider:youtube:account:channel-a', verified_at: '2026-09-26T07:55:00.000Z',
  expires_at: '2026-09-26T08:10:00.000Z', created_at: '2026-09-26T07:55:00.000Z',
  updated_at: '2026-09-26T07:55:00.000Z', ...patch,
});

test('official publishing rejects operator review and evidence without bounded expiry', () => {
  assert.equal(platformCapabilityEvidenceIsCurrent(baseEvidence({ evidence_source: 'operator_review' }), now), false);
  assert.equal(platformCapabilityEvidenceIsCurrent(baseEvidence({ expires_at: undefined }), now), false);
  assert.equal(platformCapabilityEvidenceIsCurrent(baseEvidence({ expires_at: '2099-01-01T00:00:00.000Z' }), now), false);
  assert.equal(platformCapabilityEvidenceIsCurrent(baseEvidence({ verified_at: '2026-09-25T00:00:00.000Z' }), now), false);
  assert.equal(platformCapabilityEvidenceIsCurrent(baseEvidence(), now), true);
});

test('capability decision fails closed for a legacy permanent provider_probe row', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, [baseEvidence({ expires_at: undefined }) as unknown as Record<string, unknown> & { id: string }]);
  const result = await platformCapabilityDecision({ tenantId: 'tenant-a', accountId: 'account-a', platform: 'youtube', capability: 'publishing.official', now, dataStore });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'provider_capability_expired_or_unavailable');
});

const providers = (calls: string[]): PlatformCapabilityProbeProviders => ({
  async youtube() { calls.push('youtube'); return { id: 'channel-a', publishGranted: true }; },
  async facebook() { calls.push('facebook'); return { id: 'page-a', publishGranted: true }; },
  async instagram() { calls.push('instagram'); return { id: 'ig-a', publishGranted: true }; },
  async tiktok() { calls.push('tiktok'); return { openId: 'open-a', publishGranted: true }; },
  async tiktokReceipt(_token, receipt) { calls.push('receipt'); return { publishId: receipt }; },
});

test('refresh performs a provider read and persists short-lived official evidence', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('youtube_accounts', [{
    id: 'account-a', tenantId: 'tenant-a', status: 'connected', channelId: 'channel-a', clientId: 'client',
    clientSecret: sealAccountCredential('secret'), refreshToken: sealAccountCredential('refresh'), accessToken: '',
  }]);
  const calls: string[] = [];
  const evidence = await refreshPlatformCapabilityEvidence({
    tenantId: 'tenant-a', accountId: 'account-a', platform: 'youtube', capability: 'publishing.official',
    now, dataStore, providers: providers(calls),
  });
  assert.deepEqual(calls, ['youtube']);
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.evidence_source, 'provider_probe');
  assert.equal(evidence.expires_at, '2026-09-26T08:15:00.000Z');
  assert.equal((await platformCapabilityDecision({ tenantId: 'tenant-a', accountId: 'account-a', platform: 'youtube', capability: 'publishing.official', now, dataStore })).status, 'available');
});

test('scope text alone never enables publishing and receipt lookup requires a real receipt probe', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_accounts', [{
    id: 'tt-a', tenantId: 'tenant-a', platform: 'tiktok', status: 'connected', providerAccountId: 'open-a',
    accessToken: sealAccountCredential('access'), refreshToken: '', scope: 'video.publish user.info.basic',
  }]);
  const calls: string[] = [];
  const missingReceipt = await refreshPlatformCapabilityEvidence({ tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok', capability: 'publishing.receipt_lookup', now, dataStore, providers: providers(calls) });
  assert.equal(missingReceipt.status, 'unavailable');
  assert.deepEqual(calls, []);
  const verified = await refreshPlatformCapabilityEvidence({ tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok', capability: 'publishing.receipt_lookup', receiptId: 'pub-123', now, dataStore, providers: providers(calls) });
  assert.equal(verified.status, 'verified');
  assert.deepEqual(calls, ['receipt']);
});

test('provider mismatch is persisted unavailable and never opens official publishing', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_accounts', [{
    id: 'ig-account', tenantId: 'tenant-a', platform: 'instagram', status: 'connected', providerAccountId: 'ig-a',
    accessToken: sealAccountCredential('access'), refreshToken: '', scope: 'instagram_content_publish',
  }]);
  const mismatching = providers([]);
  mismatching.instagram = async () => ({ id: 'somebody-else', publishGranted: true });
  const evidence = await refreshPlatformCapabilityEvidence({ tenantId: 'tenant-a', accountId: 'ig-account', platform: 'instagram', capability: 'publishing.official', now, dataStore, providers: mismatching });
  assert.equal(evidence.status, 'unavailable');
  assert.equal((await platformCapabilityDecision({ tenantId: 'tenant-a', accountId: 'ig-account', platform: 'instagram', capability: 'publishing.official', now, dataStore })).status, 'unavailable');
});

test('identity probe plus stored scope cannot substitute for provider-granted publish permission', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_accounts', [{
    id: 'fb-account', tenantId: 'tenant-a', platform: 'facebook', status: 'connected', providerAccountId: 'page-a',
    accessToken: sealAccountCredential('access'), refreshToken: '', scope: 'pages_manage_posts',
  }]);
  const denied = providers([]);
  denied.facebook = async () => ({ id: 'page-a', publishGranted: false });
  const evidence = await refreshPlatformCapabilityEvidence({ tenantId: 'tenant-a', accountId: 'fb-account', platform: 'facebook', capability: 'publishing.official', now, dataStore, providers: denied });
  assert.equal(evidence.status, 'unavailable');
  assert.equal(evidence.reason_code, 'provider_publish_permission_not_granted');
});

test('production ensure refreshes missing evidence and throttles a recent failed probe', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('youtube_accounts', [{
    id: 'account-a', tenantId: 'tenant-a', status: 'connected', channelId: 'channel-a', clientId: 'client',
    clientSecret: sealAccountCredential('secret'), refreshToken: sealAccountCredential('refresh'), accessToken: '',
  }]);
  const calls: string[] = [];
  assert.equal((await ensurePlatformCapability({ tenantId: 'tenant-a', accountId: 'account-a', platform: 'youtube', capability: 'publishing.official', now, dataStore, providers: providers(calls) })).status, 'available');
  assert.deepEqual(calls, ['youtube']);

  const failedStore = new MemoryStore();
  failedStore.rows.set(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, [baseEvidence({
    status: 'unavailable', reason_code: 'provider_down', evidence_ref: 'provider:youtube:probe-failed',
  }) as unknown as Record<string, unknown> & { id: string }]);
  const noCalls: string[] = [];
  assert.equal((await ensurePlatformCapability({ tenantId: 'tenant-a', accountId: 'account-a', platform: 'youtube', capability: 'publishing.official', now, dataStore: failedStore, providers: providers(noCalls) })).status, 'unavailable');
  assert.deepEqual(noCalls, []);
});

test('TikTok first publish needs only creator capability; each receipt is probed after acceptance', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_accounts', [{
    id: 'tt-a', tenantId: 'tenant-a', platform: 'tiktok', status: 'connected', providerAccountId: 'open-a',
    accessToken: sealAccountCredential('access'), refreshToken: '', scope: 'video.publish',
  }]);
  const calls: string[] = [];
  const probe = providers(calls);
  assert.equal((await ensurePlatformCapability({ tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok', capability: 'publishing.official', now, dataStore, providers: probe })).status, 'available');
  assert.deepEqual(calls, ['tiktok']);
  assert.equal((await ensurePlatformCapability({ tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok', capability: 'publishing.receipt_lookup', receiptId: 'pub-first', now, dataStore, providers: probe })).status, 'available');
  assert.equal((await ensurePlatformCapability({ tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok', capability: 'publishing.receipt_lookup', receiptId: 'pub-second', now, dataStore, providers: probe })).status, 'available');
  assert.deepEqual(calls, ['tiktok', 'receipt', 'receipt']);
});

test('failed TikTok receipt probe is throttled per receipt without blocking another receipt', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_accounts', [{
    id: 'tt-a', tenantId: 'tenant-a', platform: 'tiktok', status: 'connected', providerAccountId: 'open-a',
    accessToken: sealAccountCredential('access'), refreshToken: '', scope: 'video.publish',
  }]);
  const calls: string[] = [];
  const failed = providers(calls);
  failed.tiktokReceipt = async (_token, receipt) => {
    calls.push(receipt);
    throw new Error('provider_unavailable');
  };
  const input = { tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok' as const,
    capability: 'publishing.receipt_lookup' as const, now, dataStore, providers: failed };
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-a' })).status, 'unavailable');
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-a' })).status, 'unavailable');
  assert.deepEqual(calls, ['receipt-a']);
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-b' })).status, 'unavailable');
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-b' })).status, 'unavailable');
  assert.deepEqual(calls, ['receipt-a', 'receipt-b']);
});

test('a newer receipt failure does not hide a previous receipt success', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_accounts', [{
    id: 'tt-a', tenantId: 'tenant-a', platform: 'tiktok', status: 'connected', providerAccountId: 'open-a',
    accessToken: sealAccountCredential('access'), refreshToken: '', scope: 'video.publish',
  }]);
  const calls: string[] = [];
  const provider = providers(calls);
  provider.tiktokReceipt = async (_token, receipt) => {
    calls.push(receipt);
    if (receipt === 'receipt-b') throw new Error('provider_unavailable');
    return { publishId: receipt };
  };
  const input = { tenantId: 'tenant-a', accountId: 'tt-a', platform: 'tiktok' as const,
    capability: 'publishing.receipt_lookup' as const, now, dataStore, providers: provider };
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-a' })).status, 'available');
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-b' })).status, 'unavailable');
  assert.equal((await ensurePlatformCapability({ ...input, receiptId: 'receipt-a' })).status, 'available');
  assert.deepEqual(calls, ['receipt-a', 'receipt-b']);
});


test('provider observation is frozen to actual native identity and encrypted credential bytes', async () => {
 const store=new MemoryStore();const account={id:'account-a',tenantId:'tenant-a',status:'connected',channelId:'channel-a',clientId:'client',clientSecret:sealAccountCredential('secret'),refreshToken:sealAccountCredential('refresh')};store.rows.set('youtube_accounts',[account]);
 const evidence=await refreshPlatformCapabilityEvidence({tenantId:'tenant-a',accountId:'account-a',platform:'youtube',capability:'publishing.official',now,dataStore:store,providers:providers([])});
 assert.equal(evidence.account_identity_hash,platformAccountIdentityHash(account,'youtube'));
 assert.notEqual(evidence.account_identity_hash,platformAccountIdentityHash({...account,refreshToken:sealAccountCredential('new-secret')},'youtube'));
 assert.notEqual(evidence.account_identity_hash,platformAccountIdentityHash({...account,channelId:'foreign-channel'},'youtube'));
});
test('account changes during actual provider probe do not produce a verified proof', async () => {
 const store=new MemoryStore();const account={id:'account-a',tenantId:'tenant-a',status:'connected',channelId:'channel-a',clientId:'client',clientSecret:sealAccountCredential('secret'),refreshToken:sealAccountCredential('refresh')};store.rows.set('youtube_accounts',[account]);let calls=0;
 const port={...providers([]),async youtube(){calls++;store.rows.set('youtube_accounts',[{...account,refreshToken:sealAccountCredential('changed')}]);return {id:'channel-a',publishGranted:true};}};
 const evidence=await refreshPlatformCapabilityEvidence({tenantId:'tenant-a',accountId:'account-a',platform:'youtube',capability:'publishing.official',now,dataStore:store,providers:port});
 assert.equal(calls,1);assert.equal(evidence.status,'unavailable');assert.equal(evidence.reason_code,'provider_account_changed_during_probe');assert.equal(evidence.account_identity_hash,undefined);
});

test('repeated actual probes update the unique scope instead of inserting duplicate rows', async()=>{
 const store=new MemoryStore();store.rows.set('youtube_accounts',[{id:'account-a',tenantId:'tenant-a',status:'connected',channelId:'channel-a',clientId:'client',clientSecret:sealAccountCredential('secret'),refreshToken:sealAccountCredential('refresh')}]);
 const first=await refreshPlatformCapabilityEvidence({tenantId:'tenant-a',accountId:'account-a',platform:'youtube',capability:'publishing.official',now,dataStore:store,providers:providers([])});
 const second=await refreshPlatformCapabilityEvidence({tenantId:'tenant-a',accountId:'account-a',platform:'youtube',capability:'publishing.official',now:new Date(now.getTime()+1000),dataStore:store,providers:providers([])});
 assert.equal(first.id,second.id);assert.equal(store.rows.get(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION)?.length,1);assert.equal(second.verified_at,'2026-09-26T08:00:01.000Z');
});

test('unique-index create conflict reconciles only the exact persisted provider scope',async()=>{
 class ConflictStore extends MemoryStore {conflict=true;override async create<T>(collection:string,data:Record<string,unknown>):Promise<T|null>{if(collection===PLATFORM_CAPABILITY_EVIDENCE_COLLECTION&&this.conflict){this.conflict=false;await super.create(collection,data);throw Error('unique index conflict');}return super.create<T>(collection,data);}}
 const store=new ConflictStore();store.rows.set('youtube_accounts',[{id:'account-a',tenantId:'tenant-a',status:'connected',channelId:'channel-a',clientId:'client',clientSecret:sealAccountCredential('secret'),refreshToken:sealAccountCredential('refresh')}]);
 const result=await refreshPlatformCapabilityEvidence({tenantId:'tenant-a',accountId:'account-a',platform:'youtube',capability:'publishing.official',now,dataStore:store,providers:providers([])});
 assert.equal(result.status,'verified');assert.equal(store.rows.get(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION)?.length,1);assert.match(result.account_identity_hash??'',/^[a-f0-9]{64}$/);
});
