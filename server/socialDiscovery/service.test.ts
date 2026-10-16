import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import type { CandidateEvidenceWorkItem } from './candidateEvidenceWorker.js';
import { executeApprovedDiscoveryRun, type DiscoveryScopeRecord } from './service.js';
import type { VersionedCandidateEvidence } from './qualityOrchestration.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';

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

test('approved collection calls CandidateEvidence worker and fills quota with qualified evidence, not imported rows', async () => {
  const dataStore = new MemoryStore();
  const scope: DiscoveryScopeRecord = {
    id: 'scope-1', tenant_id: 'tenant-1', keyword_set_id: 'keywords-1', version: 1, status: 'active', created_by: 'user', created_at: '', updated_at: '',
    payload: {
      crawlStrategyId: 'crawl-1', version: '1', businessGoal: 'goal', keywordSet: {} as never,
      discoveryBrief: {
        discoveryBriefId: 'brief-1', keywordSetId: 'keywords-1', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum'], platforms: ['tiktok'], lookbackDays: 7,
        resultLimit: 4, budgetLimitCny: 10, productionGap: null, createdBy: 'director_agent',
        modePolicies: { momentum: { enabled: true, sourceRefs: ['query-1', 'query-2'], platforms: ['tiktok'], resultLimit: 4, refreshIntervalMinutes: 60, budgetLimitCny: 10 } },
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
    async crawl() { crawlCalls += 1; return { platform: 'tiktok', keyword: 'q', imported: 10, refreshed: 0, skipped: 0, skippedExisting: 0, returnedExisting: 0, requested: 1, total: 10, source: 'r3', message: '', candidateIds: [`candidate-${crawlCalls}`], items: [] }; },
    candidateEvidenceAdapter: { async toEvidenceWorkItems(input) { return [{ tenantId: input.tenantId, candidateId: input.result.candidateIds![0]!, discoveryPath: ['keyword', 'performance'], evidenceRefs: ['source'], g1: { runId: input.runId, queryRef: input.queryRef, discoveryMode: input.mode, sourceUrl: 'source' } }]; } },
    async runCandidateEvidence(items) { workerCalls += 1; return { accepted: items.map(accepted), suggestions: [], failed: [] }; },
  });
  assert.equal(crawlCalls, 2, `ten imported rows from the first source must not fill a two-evidence quota: ${JSON.stringify(result.run?.failureDetails)}`);
  assert.equal(workerCalls, 2);
  assert.equal(result.run?.modeStats.momentum?.accepted, 2);
  assert.deepEqual(result.run?.evidenceOutcomes?.momentum?.acceptedCandidateIds, ['candidate-1', 'candidate-2']);
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

test('failed sources preserve every platform and query root cause instead of only the final error', async () => {
  const dataStore = new MemoryStore();
  dataStore.rows.set('social_discovery_scopes', [{
    id: 'scope-errors', tenant_id: 'tenant-1', keyword_set_id: 'keywords-errors', version: 1, status: 'active',
    payload: {
      market: 'US', language: 'en', approval: { status: 'approved', scopeVersion: 1 }, keywords: [],
      discoveryBrief: {
        discoveryBriefId: 'brief-errors', keywordSetId: 'keywords-errors', keywordSetVersion: 1, productRef: 'product', market: 'US', audience: 'buyer',
        discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [], discoveryModes: ['momentum'], platforms: ['tiktok', 'instagram'],
        lookbackDays: 7, resultLimit: 4, budgetLimitCny: null, productionGap: null, createdBy: 'director_agent',
        modePolicies: { momentum: { enabled: true, sourceRefs: ['face cleanser supplier', 'clay mask'], platforms: ['tiktok', 'instagram'], resultLimit: 4, refreshIntervalMinutes: 60, budgetLimitCny: null } },
      },
    },
  }]);
  const result = await executeApprovedDiscoveryRun({ tenantId: 'tenant-1', triggerType: 'manual' }, {
    dataStore,
    async crawl(input) { throw new Error(`${input.platform} rejected ${input.keyword}`); },
    candidateEvidenceAdapter: { async toEvidenceWorkItems() { return []; } },
    async runCandidateEvidence() { return { accepted: [], suggestions: [], failed: [] }; },
  });
  assert.equal(result.run?.status, 'failed');
  assert.ok((result.run?.failureDetails?.length || 0) >= 2);
  assert.match(result.run?.error || '', /tiktok\/face cleanser supplier: tiktok rejected face cleanser supplier/);
  assert.match(result.run?.error || '', /tiktok\/clay mask: tiktok rejected clay mask/);
  const persisted = dataStore.rows.get('social_discovery_runs')?.[0] as any;
  assert.deepEqual(persisted.failureDetails, result.run?.failureDetails);
});
test('one provider budget failure does not discard another source actual accepted evidence',async()=>{
 const dataStore=new MemoryStore();
 dataStore.rows.set('social_discovery_scopes',[{id:'scope-partial',tenant_id:'tenant',version:1,status:'active',payload:{market:'US',language:'en',approval:{status:'approved',scopeVersion:1},keywords:[],discoveryBrief:{discoveryBriefId:'brief-partial',keywordSetId:'partial',keywordSetVersion:1,productRef:'product',market:'US',audience:'buyer',discoverySeedIds:[],trackedSceneIds:[],competitorAccounts:[],discoveryModes:['momentum'],platforms:['tiktok','youtube'],lookbackDays:7,resultLimit:10,budgetLimitCny:null,productionGap:null,createdBy:'director_agent',modePolicies:{momentum:{enabled:true,sourceRefs:['query'],platforms:['tiktok','youtube'],resultLimit:10,refreshIntervalMinutes:60,budgetLimitCny:null}}}}}]);
 const result=await executeApprovedDiscoveryRun({tenantId:'tenant',triggerType:'manual'},{dataStore,async crawl(input){if(input.platform==='tiktok')throw Error('Apify HTTP 402 not-enough-usage-to-run-paid-actor');return {platform:'youtube',keyword:'query',imported:1,refreshed:0,skipped:0,skippedExisting:0,returnedExisting:0,requested:input.limit??1,total:1,source:'r3',message:'',candidateIds:['actual-source'],items:[]};},candidateEvidenceAdapter:{async toEvidenceWorkItems(input){return [{tenantId:input.tenantId,candidateId:'actual-source',discoveryPath:['keyword'],evidenceRefs:['https://www.youtube.com/shorts/actual'],g1:{runId:input.runId,queryRef:'query',discoveryMode:'momentum',sourceUrl:'https://www.youtube.com/shorts/actual'}}];}},async runCandidateEvidence(items){return{accepted:items.map(accepted),suggestions:[],failed:[]};}});
 assert.equal(result.run?.status,'partial',JSON.stringify(result.run));assert.equal(result.run?.platformStats?.youtube?.accepted,1);
 assert.equal(result.run?.failureDetails?.find(f=>f.platform==='tiktok')?.errorCode,'provider_budget_exhausted');
 assert.deepEqual(result.run?.evidenceOutcomes?.momentum?.acceptedCandidateIds,['actual-source']);
});
