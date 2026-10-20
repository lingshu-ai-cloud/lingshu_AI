import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import type { CandidateEvidenceWorkItem } from './candidateEvidenceWorker.js';
import { executeApprovedDiscoveryRun, type DiscoveryScopeRecord } from './service.js';
import type { VersionedCandidateEvidence } from './qualityOrchestration.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { collectionBusinessDate } from './dailyCollectionQuota.js';

test('weekly account Actor has no implied monetary authorization, even with a token or item quota',async()=>{
 const dataStore=new MemoryStore(),url='https://www.tiktok.com/@yuchengcosmeticsfactory';
 const payload={approval:{status:'approved',scopeVersion:3},weeklyAccountRevision:{accountUrl:url,targetCount:5},discoveryBrief:{weeklyAccountCollectionTarget:{accountUrl:url,targetCount:5},modePolicies:{account:{budgetLimitCny:null as number|null}}}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:3,payload}]);
 const input={tenantId:'tenant',triggerType:'manual' as const,expectedScopeId:'scope',expectedScopeVersion:3,requestedModes:['account' as const],originalRun:{key:'isolated-account-five',scopeHash:socialRequestHash(payload)}};
 let posts=0;const ports={dataStore,async crawl(){posts++;throw Error('unexpected provider POST');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('unexpected worker');}};
 await assert.rejects(executeApprovedDiscoveryRun(input,ports),/weekly_preproduction_collection_budget_authorization_required/);
 assert.equal(posts,0);assert.equal(dataStore.rows.get('social_discovery_runs'),undefined);assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
 payload.discoveryBrief.modePolicies.account.budgetLimitCny=5;
 await assert.rejects(executeApprovedDiscoveryRun({...input,originalRun:{...input.originalRun,scopeHash:socialRequestHash(payload)}},ports),/weekly_preproduction_collection_budget_authorization_required/);
 assert.equal(posts,0);assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
});

test('original five-video account request refuses a partial daily window before run or reservation',async()=>{
 const dataStore=new MemoryStore(),url='https://www.tiktok.com/@yuchengcosmeticsfactory',key='isolated-account-five-capacity';
 const payload={approval:{status:'approved',scopeVersion:3},weeklyAccountRevision:{accountUrl:url,targetCount:5},discoveryBrief:{weeklyAccountCollectionTarget:{accountUrl:url,targetCount:5},modePolicies:{account:{budgetLimitCny:5}}}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:3,payload}]);
 const job={jobId:'job',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:7,kind:'discovery',originalRunKey:key,authority:{scopeId:'scope',scopeVersion:3,scopeHash:socialRequestHash(payload)},recordHash:''};
 job.recordHash=socialRequestHash({...job,recordHash:''});
 dataStore.rows.set('social_weekly_preproduction_jobs',[{id:'job',tenant_id:'tenant',original_run_key:key,program_id:'program',package_id:'package',package_version:7,kind:'discovery',record_hash:job.recordHash,payload:job}]);
 dataStore.rows.set('social_discovery_daily_reservations',[{id:'prior',tenant_id:'tenant',day:collectionBusinessDate(new Date()),run_id:'other-run',request_key:'momentum:tiktok:other',count:6}]);
 let posts=0;
 const input={tenantId:'tenant',triggerType:'manual' as const,expectedScopeId:'scope',expectedScopeVersion:3,requestedModes:['account' as const],originalRun:{key,scopeHash:socialRequestHash(payload)}};
 const ports={dataStore,async crawl(){posts++;throw Error('unexpected provider POST');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('unexpected worker');}};
 await assert.rejects(executeApprovedDiscoveryRun(input,ports),/weekly_discovery_account_five_capacity_required/);
 assert.equal(posts,0);
 assert.equal(dataStore.rows.get('social_discovery_runs'),undefined);
 assert.equal(dataStore.rows.get('social_discovery_daily_reservations')?.length,1);
});

test('account-only unknown submitted run is read back before the new fee gate and never repaid',async()=>{
 const dataStore=new MemoryStore(),url='https://www.tiktok.com/@yuchengcosmeticsfactory',key='isolated-unknown-account';
 const payload={approval:{status:'approved',scopeVersion:3},weeklyAccountRevision:{accountUrl:url,targetCount:5},discoveryBrief:{weeklyAccountCollectionTarget:{accountUrl:url,targetCount:5},modePolicies:{account:{budgetLimitCny:null}}}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:3,payload}]);
 const scopeHash=socialRequestHash(payload),runId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key})}`;
 const inputHash=socialRequestHash({tenantId:'tenant',key,scopeId:'scope',scopeVersion:3,scopeHash,modes:['account'],triggerType:'manual',productionGapContext:undefined});
 await dataStore.create('social_discovery_runs',{tenant_id:'tenant',runId,status:'running',startedAt:new Date().toISOString(),discoveryScopeId:'scope',discoveryScopeVersion:3,scopeSnapshot:{weeklyProducer:{key,inputHash}},modeStats:{}});
 let posts=0;
 const result=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual',expectedScopeId:'scope',expectedScopeVersion:3,requestedModes:['account'],originalRun:{key,scopeHash,recoveryOnly:true}},{dataStore,async crawl(){posts++;throw Error('must not repay');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('must not rerun');}});
 assert.equal(result.run?.runId,runId);assert.equal(result.run?.status,'running');assert.equal(posts,0);assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
});

class MemoryStore implements DataStore {
  rows = new Map<string, Array<Record<string, unknown> & { id: string }>>();
  async getById<T>(collection: string, id: string): Promise<T | null> { return (this.rows.get(collection) ?? []).find(row => row.id === id) as T ?? null; }
  async create<T>(collection: string, data: Record<string, unknown>): Promise<T> { const row = { id: `${collection}-${(this.rows.get(collection) ?? []).length + 1}`, ...data }; this.rows.set(collection, [...(this.rows.get(collection) ?? []), row]); return row as T; }
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> { const rows = this.rows.get(collection) ?? []; const index = rows.findIndex(row => row.id === id); if (index < 0) return false; rows[index] = { ...rows[index], ...data }; return true; }
  async delete(collection:string,id:string): Promise<boolean> { const rows=this.rows.get(collection)??[];const next=rows.filter(r=>r.id!==id);this.rows.set(collection,next);return rows.length!==next.length; }
  async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const items = (this.rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    return { items: items as T[], totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 500 };
  }
}

test('unknown original discovery submission performs read-only recovery and never creates a replacement run',async()=>{
 const dataStore=new MemoryStore(),payload={approval:{status:'approved',scopeVersion:1},discoveryBrief:{}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:1,payload}]);
 let calls=0;
 const result=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual',expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum'],originalRun:{key:'immutable-original',scopeHash:socialRequestHash(payload),recoveryOnly:true}},{dataStore,async crawl(){calls++;throw Error('must not submit');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('must not generate');}});
 assert.equal(result.reason,'weekly_discovery_original_write_unknown');assert.equal(calls,0);
 assert.equal(dataStore.rows.get('social_discovery_runs'),undefined);
});
test('running source-retry child is recovered by exact identity without a new provider request or quota reservation',async()=>{
 const dataStore=new MemoryStore(),payload={approval:{status:'approved',scopeVersion:1},discoveryBrief:{}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:1,payload}]);
 const parent=await dataStore.create<Record<string,unknown>>('social_discovery_runs',{tenant_id:'tenant',runId:'parent',status:'failed',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{fetched:0,accepted:0}},failureDetails:[{mode:'momentum',platform:'tiktok',queryRef:'query',error:'Apify HTTP 402 not-enough-usage-to-run-paid-actor'}]});
 const retry={parentRunId:'parent',parentRunHash:socialRequestHash(parent),sourceSelection:[{mode:'momentum' as const,platform:'tiktok',queryRef:'query'}],grant:{grantId:'recorded-grant',programId:'program',packageId:'package',packageVersion:1,taskId:'task',parentRunId:'parent',parentRunHash:socialRequestHash(parent)}};
 const scopeHash=socialRequestHash(payload),key='root:retry:immutable-child',runId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key})}`,inputHash=socialRequestHash({tenantId:'tenant',key,scopeId:'scope',scopeVersion:1,scopeHash,modes:['momentum'],triggerType:'manual',productionGapContext:undefined,retry});
 await dataStore.create('social_discovery_runs',{tenant_id:'tenant',runId,status:'running',discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{key,inputHash}},modeStats:{}});
 let calls=0;const result=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual',expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum'],originalRun:{key,scopeHash,recoveryOnly:true},retry},{dataStore,async crawl(){calls++;throw Error('must not resubmit');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('must not generate');}});
 assert.equal(result.run?.status,'running');assert.equal(result.run?.runId,runId);assert.equal(calls,0);assert.equal(dataStore.rows.get('social_discovery_runs')?.length,2);assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
 const child=dataStore.rows.get('social_discovery_runs')!.find(row=>row.runId===runId)!;
 child.startedAt=new Date(Date.now()-6*60_000).toISOString();
 const reconciled=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual',expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum'],originalRun:{key,scopeHash,recoveryOnly:true},retry},{dataStore,async crawl(){calls++;throw Error('must not resubmit');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('must not generate');}});
 assert.equal(reconciled.run?.status,'failed');assert.equal(reconciled.run?.stopReason,'source_failed');assert.equal(reconciled.run?.error,'weekly_discovery_original_execution_interrupted');assert.equal(calls,0);
});
test('a next-day restart recovers an existing normal-window child without submitting it again',async()=>{
 const dataStore=new MemoryStore(),payload={approval:{status:'approved',scopeVersion:1},discoveryBrief:{}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:1,payload}]);
 const parent=await dataStore.create<Record<string,unknown>>('social_discovery_runs',{tenant_id:'tenant',runId:'daily-parent',status:'stopped',stopReason:'daily_collection_limit_reached',startedAt:'2026-10-18T03:00:00.000Z',finishedAt:'2026-10-18T03:01:00.000Z',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{requested:10,fetched:0,accepted:0}},failureDetails:[],queryBasis:{momentum:['query']},scopeSnapshot:{modePolicies:{momentum:{platforms:['tiktok']}}}});
 const retry={parentRunId:'daily-parent',parentRunHash:socialRequestHash(parent),sourceSelection:[{mode:'momentum' as const,platform:'tiktok',queryRef:'query'}],authorization:{kind:'normal_daily_window' as const,businessDate:'2026-10-19'}};
 const scopeHash=socialRequestHash(payload),key='root:retry:daily-child',runId=`weekly_discovery_${socialRequestHash({tenantId:'tenant',key})}`,inputHash=socialRequestHash({tenantId:'tenant',key,scopeId:'scope',scopeVersion:1,scopeHash,modes:['momentum'],triggerType:'manual',productionGapContext:undefined,retry});
 await dataStore.create('social_discovery_runs',{tenant_id:'tenant',runId,status:'running',startedAt:new Date().toISOString(),discoveryScopeId:'scope',discoveryScopeVersion:1,scopeSnapshot:{weeklyProducer:{key,inputHash}},modeStats:{}});
 let calls=0;
 const result=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual',expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum'],originalRun:{key,scopeHash,recoveryOnly:true},retry,now:new Date('2026-10-20T01:00:00.000+08:00')},{dataStore,async crawl(){calls++;throw Error('must not resubmit');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('must not generate');}});
 assert.equal(result.run?.runId,runId);assert.equal(result.run?.status,'running');assert.equal(calls,0);
 assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
});
test('a legacy normal-window child without a run cannot submit after midnight',async()=>{
 const dataStore=new MemoryStore(),payload={approval:{status:'approved',scopeVersion:1},discoveryBrief:{}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant',status:'active',version:1,payload}]);
 const parent=await dataStore.create<Record<string,unknown>>('social_discovery_runs',{tenant_id:'tenant',runId:'daily-parent',status:'stopped',stopReason:'daily_collection_limit_reached',startedAt:'2026-10-18T03:00:00.000Z',finishedAt:'2026-10-18T03:01:00.000Z',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{requested:10,fetched:0,accepted:0}},failureDetails:[],queryBasis:{momentum:['query']},scopeSnapshot:{modePolicies:{momentum:{platforms:['tiktok']}}}});
 const retry={parentRunId:'daily-parent',parentRunHash:socialRequestHash(parent),sourceSelection:[{mode:'momentum' as const,platform:'tiktok',queryRef:'query'}],authorization:{kind:'normal_daily_window' as const,businessDate:'2026-10-19'}};
 let calls=0;
 await assert.rejects(executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual',expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum'],originalRun:{key:'root:retry:legacy-child',scopeHash:socialRequestHash(payload)},retry,now:new Date('2026-10-19T00:01:00.000+08:00')},{dataStore,async crawl(){calls++;throw Error('must not submit');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){return[];}},async runCandidateEvidence(){throw Error('must not generate');}}),/weekly_discovery_cross_day_authorization_required/);
 assert.equal(calls,0);
 assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
 assert.equal(dataStore.rows.get('social_discovery_runs')?.length,1);
});

function accepted(item: CandidateEvidenceWorkItem): VersionedCandidateEvidence {
  return {
    evidenceId: `evidence-${item.candidateId}`, version: 1, tenantId: item.tenantId, candidateId: item.candidateId,
    inputFingerprint: item.candidateId, evidence: {
      inspirationId: item.candidateId, discoveryPath: item.discoveryPath, sceneIds: [],
      relevance: { level: 'high', reasons: [] }, momentum: { level: 'high_performance', reasons: [], confidence: 0.8 },
      transferability: { level: 'high', mechanisms: [], limitations: [] }, evidenceRefs: item.evidenceRefs ?? [],
    },
    g1: { runId: item.g1.runId, queryRef: item.g1.queryRef, discoveryMode: item.g1.discoveryMode, sourceType: 'keyword', sourceUrl: 'https://example.invalid', observedAt: '2026-09-26T00:00:00Z', publishedAt: 'unknown', followerCount: 'unknown', commentText: 'unknown', missingFields: [] },
    completeness: 'partial', createdAt: '2026-09-26T00:00:00Z', supersedesEvidenceId: null,
  };
}

test('approved benchmark-account collection calls CandidateEvidence worker and fills quota with qualified evidence, not imported rows', async () => {
  const dataStore = new MemoryStore();
  const accounts = ['https://www.linkedin.com/company/factory-one', 'https://www.facebook.com/factory-two'];
  dataStore.rows.set('competitor_accounts', accounts.map((accountUrl, index) => ({ id: `account-${index}`, tenantId: 'tenant-1', accountUrl })));
  const scope: DiscoveryScopeRecord = {
    id: 'scope-1', tenant_id: 'tenant-1', keyword_set_id: 'keywords-1', version: 1, status: 'active', created_by: 'user', created_at: '', updated_at: '',
    payload: {
      crawlStrategyId: 'crawl-1', version: '1', businessGoal: 'goal', keywordSet: {} as never,
      discoveryBrief: {
        discoveryBriefId: 'brief-1', keywordSetId: 'keywords-1', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: accounts, discoveryModes: ['account'], platforms: ['linkedin', 'facebook'], lookbackDays: 7,
        resultLimit: 4, budgetLimitCny: 10, productionGap: null, createdBy: 'director_agent',
        modePolicies: { account: { enabled: true, sourceRefs: accounts, platforms: ['linkedin', 'facebook'], resultLimit: 4, refreshIntervalMinutes: 60, budgetLimitCny: 10 } },
      },
      keywords: [], benchmarkAccounts: [], platformQuotas: [], refreshIntervalMinutes: 60, stopConditions: [], availableCapabilities: [], priorities: [], successCriteria: [], metricTargets: [], createdBy: 'business_agent',
      approval: { status: 'approved', scopeVersion: 1, approvedBy: 'user', approvedAt: '2026-09-26T00:00:00Z' }, market: 'US', language: 'en',
    } as any,
  };
  dataStore.rows.set('social_discovery_scopes', [scope]);
  let crawlCalls = 0;
  let workerCalls = 0;
  const result = await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl(input) { crawlCalls += 1; return { platform: input.platform ?? 'linkedin', keyword: '', imported: 1, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 1, source: 'r3', message: '', candidateIds: [`candidate-${crawlCalls}`], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems(input) { return [{ tenantId: input.tenantId, candidateId: input.result.candidateIds![0]!, discoveryPath: ['account', 'performance'], evidenceRefs: ['source'], g1: { runId: input.runId, queryRef: input.queryRef, discoveryMode: input.mode, sourceUrl: 'source' } }]; } },
    async runCandidateEvidence(items) { workerCalls += 1; return { accepted: items.map(accepted), suggestions: [], failed: [] }; },
  });
  assert.equal(crawlCalls, 2, `imported rows alone must not fill qualified-evidence quota: ${JSON.stringify(result.run?.failureDetails)}`);
  assert.equal(workerCalls, 2);
  assert.equal(result.run?.modeStats.account?.accepted, 2);
  assert.deepEqual(result.run?.evidenceOutcomes?.account?.acceptedCandidateIds, ['candidate-1', 'candidate-2']);
});

test('account discovery reads the current account library and forwards the saved name and date range', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('competitor_accounts', [{ id: 'account-1', tenantId: 'tenant-1', accountUrl: 'https://www.youtube.com/@demo', accountName: 'Demo Factory' }]);
  dataStore.rows.set('social_discovery_scopes', [{
    id: 'scope-1', tenant_id: 'tenant-1', keyword_set_id: 'keywords-1', version: 1, status: 'active',
    payload: {
      market: 'US', language: 'en', approval: { status: 'approved', scopeVersion: 1 },
      discoveryBrief: {
        discoveryBriefId: 'brief-1', keywordSetId: 'keywords-1', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: ['https://www.youtube.com/@old'], discoveryModes: ['account'],
        platforms: ['youtube'], lookbackDays: 7, resultLimit: 3, budgetLimitCny: null, productionGap: null, createdBy: 'director_agent',
        modePolicies: { account: { enabled: true, sourceRefs: ['https://www.youtube.com/@old'], platforms: ['youtube'], resultLimit: 3, refreshIntervalMinutes: 60, budgetLimitCny: null } },
      },
    },
  }]);
  const calls: Array<{ accountUrl?: string; accountName?: string; dateFrom?: string; dateTo?: string; limit?: number }> = [];
  await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl(input) {
      calls.push(input);
      return { platform: 'youtube', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: input.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] };
    },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.accountUrl, 'https://www.youtube.com/@demo');
  assert.equal(calls[0]?.accountName, 'Demo Factory');
  assert.equal(calls[0]?.limit, 1);
  assert.match(calls[0]?.dateFrom ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.match(calls[0]?.dateTo ?? '', /^\d{4}-\d{2}-\d{2}$/);
});

test('configured accounts each reserve one of the daily ten before keyword collection', async () => {
  const dataStore = new MemoryStore();
  const accounts = ['https://www.facebook.com/factory-one', 'https://www.instagram.com/factory-two'];
  dataStore.rows.set('competitor_accounts', accounts.map((accountUrl, index) => ({ id: `account-${index}`, tenantId: 'tenant-1', accountUrl })));
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope', tenant_id: 'tenant-1', keyword_set_id: 'keywords', version: 1, status: 'active', payload: {
    approval: { status: 'approved', scopeVersion: 1 }, keywords: [],
    discoveryBrief: { discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum', 'account'], platforms: ['tiktok', 'facebook', 'instagram'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'director_agent', modePolicies: {
      momentum: { enabled: true, sourceRefs: ['cleansing foam'], platforms: ['tiktok'], resultLimit: 10, refreshIntervalMinutes: 60, budgetLimitCny: null },
      account: { enabled: true, sourceRefs: [], platforms: ['facebook', 'instagram'], resultLimit: 1, refreshIntervalMinutes: 60, budgetLimitCny: null },
    } },
  } }]);
  const calls: Array<{ mode: string; accountUrl?: string; limit?: number }> = [];
  await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl(input) { calls.push({ mode: input.mode ?? 'keyword', accountUrl: input.accountUrl, limit: input.limit }); return { platform: input.platform ?? 'tiktok', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: input.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.deepEqual(calls.slice(0, 2), accounts.map(accountUrl => ({ mode: 'account', accountUrl, limit: 1 })));
  const reservations = dataStore.rows.get('social_discovery_daily_reservations') ?? [];
  assert.equal(reservations.filter(row => String(row.request_key).startsWith('account:')).length, 2);
  assert.ok(reservations.reduce((sum, row) => sum + Number(row.count), 0) <= 10);
  await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual', requestedModes: ['momentum'] }, {
    dataStore,
    async crawl(input) { calls.push({ mode: input.mode ?? 'keyword', accountUrl: input.accountUrl, limit: input.limit }); return { platform: input.platform ?? 'tiktok', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: input.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.equal(calls.filter(call => call.mode === 'account').length, 2, 'same-day rerun must not re-collect already reserved accounts');
});

test('scheduled collection does not let a weekly accepted-item quota suppress the daily account minimum', async () => {
  const dataStore = new MemoryStore();
  const accountUrl = 'https://www.youtube.com/@factory';
  dataStore.rows.set('competitor_accounts', [{ id: 'account', tenantId: 'tenant-1', accountUrl }]);
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope', tenant_id: 'tenant-1', keyword_set_id: 'keywords', version: 1, status: 'active', payload: {
    approval: { status: 'approved', scopeVersion: 1 }, keywords: [],
    discoveryBrief: { discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['account'], platforms: ['youtube'], lookbackDays: 7, resultLimit: 1, budgetLimitCny: null, productionGap: null, createdBy: 'director_agent', modePolicies: { account: { enabled: true, sourceRefs: [], platforms: ['youtube'], resultLimit: 1, refreshIntervalMinutes: 43200, budgetLimitCny: null } } },
  } }]);
  dataStore.rows.set('social_discovery_runs', [{ id: 'old', tenant_id: 'tenant-1', keywordSetId: 'keywords', runId: 'old', startedAt: new Date(Date.now() - 86_400_000).toISOString(), finishedAt: new Date(Date.now() - 86_400_000).toISOString(), modeStats: { account: { requested: 1, accepted: 1 } }, evidenceOutcomes: { account: { acceptedCandidateIds: ['old-video'] } } }]);
  const calls: string[] = [];
  await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'scheduled' }, {
    dataStore,
    async crawl(input) { calls.push(input.accountUrl ?? 'keyword'); return { platform: 'youtube', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: input.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.deepEqual(calls, [accountUrl]);
});

test('approved weekly account target reserves five from one exact source without bypassing ten per day or replaying', async () => {
  const dataStore = new MemoryStore();
  const accountUrl = 'https://www.tiktok.com/@fixture_factory';
  dataStore.rows.set('competitor_accounts', [{ id: 'account', tenantId: 'tenant-1', accountUrl }]);
  const payload = { approval: { status: 'approved', scopeVersion: 2, approvedBy: 'owner' }, keywords: [], discoveryBrief: {
    discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 2, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [accountUrl], discoveryModes: ['account'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user',
    weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
    modePolicies: { account: { enabled: true, sourceRefs: [accountUrl], platforms: ['tiktok'], resultLimit: 5, refreshIntervalMinutes: 1440, budgetLimitCny: null } },
  } };
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-2', tenant_id: 'tenant-1', version: 2, status: 'active', payload }]);
  let calls = 0;
  const dependencies = {
    dataStore,
    async crawl(input: { limit?: number; accountUrl?: string }) { calls++; assert.equal(input.accountUrl, accountUrl); assert.equal(input.limit, 5); return { platform: 'tiktok', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 5, total: 0, source: 'test', message: '', candidateIds: [], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  } as any;
  const input = { tenantId: 'tenant-1', triggerType: 'manual' as const, requestedModes: ['account' as const], expectedScopeId: 'scope-2', expectedScopeVersion: 2, originalRun: { key: 'approved-five-source', scopeHash: socialRequestHash(payload) } };
  const first = await executeApprovedDiscoveryRun(input, dependencies);
  assert.equal(first.run?.modeStats.account?.requested, 5);
  assert.equal((dataStore.rows.get('social_discovery_daily_reservations') ?? []).reduce((n, row) => n + Number(row.count), 0), 5);
  const replay = await executeApprovedDiscoveryRun(input, dependencies);
  assert.equal(replay.run?.runId, first.run?.runId);
  assert.equal(calls, 1);
  const second = await executeApprovedDiscoveryRun({ ...input, originalRun: { ...input.originalRun, key: 'another-weekly-run' } }, dependencies);
  assert.equal(second.reason, 'no_discovery_mode_due');
  assert.equal(calls, 1);
});

test('approved account-only revision cannot spend on inherited keyword or a second account while monetary authority is absent', async () => {
  const dataStore = new MemoryStore();
  const accountUrl = 'https://www.tiktok.com/@fixture_factory';
  const otherUrl = 'https://www.tiktok.com/@other_factory';
  dataStore.rows.set('competitor_accounts', [accountUrl, otherUrl].map((url, index) => ({ id: `account-${index}`, tenantId: 'tenant-1', accountUrl: url })));
  const payload = { approval: { status: 'approved', scopeVersion: 3, approvedBy: 'owner' },
    weeklyAccountRevision: { accountUrl, targetCount: 5 }, keywords: [{ category: 'discovery_seed', values: ['inherited keyword'] }],
    discoveryBrief: { discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 3, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [accountUrl, otherUrl], discoveryModes: ['account', 'momentum'], platforms: ['tiktok', 'facebook', 'instagram', 'youtube'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user', weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
      modePolicies: { account: { enabled: true, sourceRefs: [accountUrl, otherUrl], platforms: ['tiktok'], resultLimit: 10, refreshIntervalMinutes: 1440, budgetLimitCny: null }, momentum: { enabled: true, sourceRefs: ['inherited keyword'], platforms: ['tiktok', 'facebook', 'instagram', 'youtube'], resultLimit: 10, refreshIntervalMinutes: 1440, budgetLimitCny: null } } } };
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-3', tenant_id: 'tenant-1', version: 3, status: 'active', payload }]);
  const calls: Array<{ accountUrl?: string; keyword?: string; platform?: string; limit?: number }> = [];
  const input = { tenantId: 'tenant-1', triggerType: 'manual' as const, requestedModes: ['account' as const, 'momentum' as const], expectedScopeId: 'scope-3', expectedScopeVersion: 3, originalRun: { key: 'approved-account-only', scopeHash: socialRequestHash(payload) } };
  const dependencies = { dataStore, async crawl(request: { accountUrl?: string; keyword?: string; platform?: string; limit?: number }) { calls.push(request); return { platform: 'tiktok', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: request.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] }; }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } }, async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; } } as any;
  await assert.rejects(executeApprovedDiscoveryRun(input, dependencies),/weekly_preproduction_collection_budget_authorization_required/);
  assert.equal(calls.length,0);
  assert.equal(dataStore.rows.get('social_discovery_runs'),undefined);
  assert.equal(dataStore.rows.get('social_discovery_daily_reservations'),undefined);
});

test('account-only revision rejects scheduled and unbound manual entry while production gaps also stay on the approved account', async () => {
  const dataStore = new MemoryStore(), accountUrl = 'https://www.tiktok.com/@fixture_factory';
  dataStore.rows.set('competitor_accounts', [{ id: 'account', tenantId: 'tenant-1', accountUrl }]);
  const payload = { approval: { status: 'approved', scopeVersion: 3, approvedBy: 'owner' }, weeklyAccountRevision: { accountUrl, targetCount: 5 }, keywords: [], discoveryBrief: {
    discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 3, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [accountUrl], discoveryModes: ['account', 'momentum'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user', weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
    modePolicies: { account: { enabled: true, sourceRefs: [accountUrl], platforms: ['tiktok'], resultLimit: 5, refreshIntervalMinutes: 1440, budgetLimitCny: null }, momentum: { enabled: true, sourceRefs: ['gap query'], platforms: ['tiktok'], resultLimit: 1, refreshIntervalMinutes: 1440, budgetLimitCny: null } },
  } };
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-3', tenant_id: 'tenant-1', version: 3, status: 'active', payload }]);
  let calls = 0;
  const dependencies = { dataStore, async crawl(request: { accountUrl?: string; keyword?: string; limit?: number }) { calls++; assert.equal(request.accountUrl, accountUrl); assert.equal(request.keyword, undefined); return { platform: 'tiktok', keyword: '', imported: 0, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: request.limit ?? 0, total: 0, source: 'test', message: '', candidateIds: [], items: [] }; }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } }, async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; } } as any;
  for (const triggerType of ['scheduled', 'manual'] as const) await assert.rejects(executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType, requestedModes: ['momentum'] }, dependencies), /weekly_discovery_account_only_authority_required/);
  assert.equal(calls, 0);
  assert.equal(dataStore.rows.get('social_discovery_daily_reservations'), undefined);
  const independent = await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'production_gap', requestedModes: ['momentum'], productionGapContext: { gapTaskId: 'gap', upstreamTaskRef: 'upstream', description: 'gap query', remainingBudgetCny: 1 } }, dependencies);
  assert.equal(independent.run?.modeStats.account?.requested, 1);
  assert.equal(calls, 1);
});

test('weekly account target fails before a paid reservation when the frozen account or approval is absent', async () => {
  const dataStore = new MemoryStore();
  const accountUrl = 'https://www.tiktok.com/@fixture_factory';
  dataStore.rows.set('competitor_accounts', [{ id: 'account', tenantId: 'tenant-1', accountUrl }]);
  const payload = { approval: { status: 'approved', scopeVersion: 2 }, keywords: [], discoveryBrief: {
    discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 2, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [accountUrl], discoveryModes: ['account'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user',
    weeklyAccountCollectionTarget: { accountUrl: 'https://www.tiktok.com/@other_factory', targetCount: 5 },
    modePolicies: { account: { enabled: true, sourceRefs: [accountUrl], platforms: ['tiktok'], resultLimit: 5, refreshIntervalMinutes: 1440, budgetLimitCny: null } },
  } };
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-2', tenant_id: 'tenant-1', version: 2, status: 'active', payload }]);
  let calls = 0;
  const input = { tenantId: 'tenant-1', triggerType: 'manual' as const, requestedModes: ['account' as const], expectedScopeId: 'scope-2', expectedScopeVersion: 2, originalRun: { key: 'invalid-five-source', scopeHash: socialRequestHash(payload) } };
  await assert.rejects(executeApprovedDiscoveryRun(input, { dataStore, async crawl() { calls++; throw Error('must not call'); }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } }, async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; } }), /weekly_discovery_account_target_scope_invalid/);
  assert.equal(calls, 0);
  assert.equal(dataStore.rows.get('social_discovery_daily_reservations'), undefined);
});

test('five-from-account revision cannot launder a changed account library or overbook other accounts', async () => {
  const accountUrl = 'https://www.tiktok.com/@fixture_factory';
  const make = (count: number, saved: string[]) => {
    const dataStore = new MemoryStore();
    dataStore.rows.set('competitor_accounts', saved.map((url, index) => ({ id: `account-${index}`, tenantId: 'tenant-1', accountUrl: url })));
    const frozen = [accountUrl, ...Array.from({ length: count - 1 }, (_, index) => `https://www.tiktok.com/@factory_${index}`)];
    const payload = { approval: { status: 'approved', scopeVersion: 2, approvedBy: 'owner' }, keywords: [], discoveryBrief: {
      discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 2, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: frozen, discoveryModes: ['account'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user',
      weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
      modePolicies: { account: { enabled: true, sourceRefs: frozen, platforms: ['tiktok'], resultLimit: 10, refreshIntervalMinutes: 1440, budgetLimitCny: null } },
    } };
    dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-2', tenant_id: 'tenant-1', version: 2, status: 'active', payload }]);
    return { dataStore, input: { tenantId: 'tenant-1', triggerType: 'manual' as const, requestedModes: ['account' as const], expectedScopeId: 'scope-2', expectedScopeVersion: 2, originalRun: { key: 'five-source-conflict', scopeHash: socialRequestHash(payload) } } };
  };
  const deps = (dataStore: MemoryStore) => ({ dataStore, async crawl() { throw Error('provider_must_not_run'); }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } }, async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; } });
  const changed = make(1, ['https://www.tiktok.com/@different_factory']);
  await assert.rejects(executeApprovedDiscoveryRun(changed.input, deps(changed.dataStore)), /weekly_discovery_account_sources_changed/);
  assert.equal(changed.dataStore.rows.get('social_discovery_daily_reservations'), undefined);
  const overbooked = make(7, [accountUrl, ...Array.from({ length: 6 }, (_, index) => `https://www.tiktok.com/@factory_${index}`)]);
  await assert.rejects(executeApprovedDiscoveryRun(overbooked.input, deps(overbooked.dataStore)), /weekly_discovery_account_target_scope_invalid/);
  assert.equal(overbooked.dataStore.rows.get('social_discovery_daily_reservations'), undefined);
});

test('five-from-account request respects existing same-source and full-day reservations', async () => {
  const accountUrl = 'https://www.tiktok.com/@fixture_factory';
  const make = () => {
    const dataStore = new MemoryStore();
    dataStore.rows.set('competitor_accounts', [{ id: 'account', tenantId: 'tenant-1', accountUrl }]);
    const payload = { approval: { status: 'approved', scopeVersion: 2, approvedBy: 'owner' }, keywords: [], discoveryBrief: {
      discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 2, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [accountUrl], discoveryModes: ['account'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user',
      weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
      modePolicies: { account: { enabled: true, sourceRefs: [accountUrl], platforms: ['tiktok'], resultLimit: 5, refreshIntervalMinutes: 1440, budgetLimitCny: null } },
    } };
    dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-2', tenant_id: 'tenant-1', version: 2, status: 'active', payload }]);
    return { dataStore, input: { tenantId: 'tenant-1', triggerType: 'manual' as const, requestedModes: ['account' as const], expectedScopeId: 'scope-2', expectedScopeVersion: 2, originalRun: { key: 'five-source-reserved', scopeHash: socialRequestHash(payload) } } };
  };
  const deps = (dataStore: MemoryStore) => ({ dataStore, async crawl() { throw Error('provider_must_not_run'); }, candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } }, async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; } });
  const priorSource = make();
  priorSource.dataStore.rows.set('social_discovery_daily_reservations', [{ id: 'old-source', tenant_id: 'tenant-1', day: collectionBusinessDate(new Date()), run_id: 'old', request_key: `account:tiktok:${accountUrl}`, count: 1 }]);
  const skipped = await executeApprovedDiscoveryRun(priorSource.input, deps(priorSource.dataStore));
  assert.equal(skipped.reason, 'no_discovery_mode_due');
  const fullDay = make();
  fullDay.dataStore.rows.set('social_discovery_daily_reservations', [{ id: 'old-full-day', tenant_id: 'tenant-1', day: collectionBusinessDate(new Date()), run_id: 'old', request_key: 'momentum:tiktok:old-query', count: 10 }]);
  const stopped = await executeApprovedDiscoveryRun(fullDay.input, deps(fullDay.dataStore));
  assert.equal(stopped.run?.stopReason, 'daily_collection_limit_reached');
  assert.equal(fullDay.dataStore.rows.get('social_discovery_daily_reservations')?.length, 1);
});

test('five-from-account rejects provider surplus before candidate analysis', async () => {
  const dataStore = new MemoryStore(), accountUrl = 'https://www.tiktok.com/@fixture_factory';
  dataStore.rows.set('competitor_accounts', [{ id: 'account', tenantId: 'tenant-1', accountUrl }]);
  const payload = { approval: { status: 'approved', scopeVersion: 2, approvedBy: 'owner' }, keywords: [], discoveryBrief: {
    discoveryBriefId: 'brief', keywordSetId: 'keywords', keywordSetVersion: 2, productRef: 'product', market: 'US', audience: 'buyer', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [accountUrl], discoveryModes: ['account'], platforms: ['tiktok'], lookbackDays: 7, resultLimit: 10, budgetLimitCny: null, productionGap: null, createdBy: 'user',
    weeklyAccountCollectionTarget: { accountUrl, targetCount: 5 },
    modePolicies: { account: { enabled: true, sourceRefs: [accountUrl], platforms: ['tiktok'], resultLimit: 5, refreshIntervalMinutes: 1440, budgetLimitCny: null } },
  } };
  dataStore.rows.set('social_discovery_scopes', [{ id: 'scope-2', tenant_id: 'tenant-1', version: 2, status: 'active', payload }]);
  let analyzed = 0;
  const result = await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual', requestedModes: ['account'], expectedScopeId: 'scope-2', expectedScopeVersion: 2, originalRun: { key: 'five-source-surplus', scopeHash: socialRequestHash(payload) } }, {
    dataStore,
    async crawl() { return { platform: 'tiktok', keyword: '', imported: 6, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 5, total: 6, source: 'test', message: '', candidateIds: Array.from({ length: 6 }, (_, index) => `candidate-${index}`), items: Array.from({ length: 6 }, () => ({})) }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { analyzed++; return []; } },
    async runCandidateEvidence() { analyzed++; return { accepted: [], suggestions: [], failed: [] }; },
  } as any);
  assert.equal(result.run?.status, 'failed');
  assert.match(result.run?.error ?? '', /daily_collection_provider_limit_exceeded/);
  assert.equal(analyzed, 0);
});

test('discovery inventory is sourced only from approved LinkedIn and Facebook benchmark accounts', async () => {
 const dataStore=new MemoryStore();
 const accounts=['https://www.linkedin.com/company/factory-one','https://www.facebook.com/factory-two'];
 dataStore.rows.set('competitor_accounts',accounts.map((accountUrl,index)=>({id:`account-${index}`,tenantId:'tenant-1',accountUrl})));
 const payload={approval:{status:'approved',scopeVersion:1},keywords:[{category:'discovery_seed',values:['must not run']}],discoveryBrief:{discoveryBriefId:'brief',keywordSetId:'keywords',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:accounts,discoveryModes:['account','momentum'],platforms:['linkedin','facebook'],lookbackDays:7,resultLimit:10,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{account:{enabled:true,sourceRefs:accounts,platforms:['linkedin','facebook'],resultLimit:10,refreshIntervalMinutes:1440,budgetLimitCny:null},momentum:{enabled:true,sourceRefs:['must not run'],platforms:['linkedin'],resultLimit:10,refreshIntervalMinutes:1440,budgetLimitCny:null}}}};
 dataStore.rows.set('social_discovery_scopes',[{id:'scope',tenant_id:'tenant-1',keyword_set_id:'keywords',version:1,status:'active',payload}]);
 const calls:Array<{platform:string;accountUrl?:string;keyword?:string;limit:number}>=[];
 const result=await executeApprovedDiscoveryRun({tenantId:'tenant-1',triggerType:'manual',requestedModes:['account','momentum']},{
  dataStore,
  async crawl(input){const platform=input.platform??'facebook';calls.push({platform,accountUrl:input.accountUrl,keyword:input.keyword,limit:input.limit??0});return{platform,keyword:'',imported:1,refreshed:0,skipped:0,skippedExisting:0,skippedNearDuplicate:0,nearDuplicateUnchecked:1,returnedExisting:0,requested:input.limit??0,total:1,source:'test',message:'',candidateIds:[`${platform}:${input.accountUrl}`],items:[]};},
  candidateEvidenceAdapter:{async toEvidenceWorkItems(input){return[{tenantId:input.tenantId,candidateId:input.result.candidateIds![0]!,discoveryPath:['account'],evidenceRefs:['source'],g1:{runId:input.runId,queryRef:input.queryRef,discoveryMode:'account',sourceUrl:'https://example.invalid/post'}}];}},
  async runCandidateEvidence(items){return{accepted:items.map(accepted),suggestions:[],failed:[]};},
 });
 assert.deepEqual(calls.map(call=>call.platform),['linkedin','facebook']);
 assert.deepEqual(calls.map(call=>call.accountUrl),accounts);
 assert.ok(calls.every(call=>call.keyword===undefined));
 assert.equal(result.run?.modeStats.account?.requested,2);
 assert.equal(result.run?.modeStats.momentum,undefined);
 assert.equal(new Set(result.run?.evidenceOutcomes?.account?.acceptedCandidateIds).size,2);
});

test('failed sources preserve every platform and query root cause instead of only the final error', async () => {
  const dataStore = new MemoryStore();
  const accounts = ['https://www.linkedin.com/company/factory-one', 'https://www.facebook.com/factory-two'];
  dataStore.rows.set('competitor_accounts', accounts.map((accountUrl, index) => ({ id: `account-${index}`, tenantId: 'tenant-1', accountUrl })));
  dataStore.rows.set('social_discovery_scopes', [{
    id: 'scope-errors', tenant_id: 'tenant-1', keyword_set_id: 'keywords-errors', version: 1, status: 'active',
    payload: {
      market: 'US', language: 'en', approval: { status: 'approved', scopeVersion: 1 }, keywords: [],
      discoveryBrief: {
        discoveryBriefId: 'brief-errors', keywordSetId: 'keywords-errors', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: accounts, discoveryModes: ['account'], platforms: ['linkedin', 'facebook'],
        lookbackDays: 7, resultLimit: 4, budgetLimitCny: null, productionGap: null, createdBy: 'director_agent',
        modePolicies: { account: { enabled: true, sourceRefs: accounts, platforms: ['linkedin', 'facebook'], resultLimit: 4, refreshIntervalMinutes: 60, budgetLimitCny: null } },
      },
    },
  }]);
  const result = await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl(input) { throw new Error(`${input.platform} rejected ${input.accountUrl}`); },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.equal(result.run?.status, 'failed');
  assert.ok((result.run?.failureDetails?.length || 0) >= 2);
  assert.match(result.run?.error || '', /linkedin\/https:\/\/www\.linkedin\.com\/company\/factory-one: linkedin rejected/);
  assert.match(result.run?.error || '', /facebook\/https:\/\/www\.facebook\.com\/factory-two: facebook rejected/);
  const persisted = dataStore.rows.get('social_discovery_runs')?.[0] as any;
  assert.deepEqual(persisted.failureDetails, result.run?.failureDetails);
});
test('one provider budget failure does not discard another source actual accepted evidence',async()=>{
 const dataStore=new MemoryStore();
 const accounts=['https://www.facebook.com/factory-one','https://www.linkedin.com/company/factory-two'];
 dataStore.rows.set('competitor_accounts',accounts.map((accountUrl,index)=>({id:`account-${index}`,tenantId:'tenant',accountUrl})));
 dataStore.rows.set('social_discovery_scopes',[{id:'scope-partial',tenant_id:'tenant',version:1,status:'active',payload:{market:'US',language:'en',approval:{status:'approved',scopeVersion:1},keywords:[],discoveryBrief:{discoveryBriefId:'brief-partial',keywordSetId:'partial',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:accounts,discoveryModes:['account'],platforms:['facebook','linkedin'],lookbackDays:7,resultLimit:10,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{account:{enabled:true,sourceRefs:accounts,platforms:['facebook','linkedin'],resultLimit:10,refreshIntervalMinutes:60,budgetLimitCny:null}}}}}]);
 const result=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual'},{dataStore,async crawl(input){if(input.platform==='facebook')throw Error('Apify HTTP 402 not-enough-usage-to-run-paid-actor');return {platform:'linkedin',keyword:'',imported:1,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:input.limit??1,total:1,source:'r3',message:'',candidateIds:['actual-source'],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(input){return [{tenantId:input.tenantId,candidateId:'actual-source',discoveryPath:['account'],evidenceRefs:['https://www.linkedin.com/feed/update/actual'],g1:{runId:input.runId,queryRef:input.queryRef,discoveryMode:'account',sourceUrl:'https://www.linkedin.com/feed/update/actual'}}];}},async runCandidateEvidence(items){return{accepted:items.map(accepted),suggestions:[],failed:[]};}});
 assert.equal(result.run?.status,'partial',JSON.stringify(result.run));assert.equal(result.run?.platformStats?.linkedin?.accepted,1);
 assert.equal(result.run?.failureDetails?.find(f=>f.platform==='facebook')?.errorCode,'provider_budget_exhausted');
 assert.deepEqual(result.run?.evidenceOutcomes?.account?.acceptedCandidateIds,['actual-source']);
});
