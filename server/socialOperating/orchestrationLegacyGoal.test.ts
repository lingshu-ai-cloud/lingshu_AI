import assert from 'node:assert/strict';
import test from 'node:test';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import type {BusinessGoalBuildInput} from '../../shared/contracts/socialOperatingDecision.js';
import {createSocialOperatingOrchestrationService} from './orchestration.js';
import {createSocialOperatingDecisionService} from './service.js';
function memoryStore(seed: Record<string, Record_[]>): DataStore & { rows: Map<string, Record_[]> } {
  const rows = new Map(Object.entries(structuredClone(seed)));
  let sequence = 0;
  return {
    rows,
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(collection)?.find(item => item.id === id) ?? null) as T | null; },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++sequence}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? []; const index = list.findIndex(item => item.id === id);
      if (index < 0) return false; list[index] = { ...list[index], ...structuredClone(data) }; return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? []; const next = list.filter(item => item.id !== id); rows.set(collection, next); return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(item => Object.entries(query.where ?? {}).every(([key, value]) => item[key] === value));
      if (query.sort) { const desc = query.sort.startsWith('-'); const key = desc ? query.sort.slice(1) : query.sort; items = [...items].sort((a, b) => { const av = a[key]; const bv = b[key]; const delta = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? '')); return delta * (desc ? -1 : 1); }); }
      const page = query.page ?? 1; const perPage = query.perPage ?? 30; const start = (page - 1) * perPage;
      return { items: structuredClone(items.slice(start, start + perPage)) as T[], totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

const now = '2026-09-26T00:00:00.000Z';
const program = {
  programId: 'program-a', brandName: 'Factory', businessLine: null, market: 'US', targetAudience: 'brand buyer',
  candidatePlatforms: ['tiktok'], route: 'cold_start', stage: 'ready_for_week', readiness: {}, enterpriseProfileRef: null,
  productMarketingProfileRefs: [], activeMonthlyPlanRef: null, activeWeeklyPlanRef: null, activeWeeklyOperatingPackageRef: null,
  version: 1, status: 'active', createdAt: now, updatedAt: now,
};
const account = {
  accountId: 'account-a', programId: 'program-a', platform: 'tiktok', displayName: 'TikTok', handle: '@factory', businessRole: 'proof',
  audiencePromise: 'facts', contentPromise: 'evidence', status: 'active', connectionId: 'connection-a', connectionCapabilities: ['publish'],
  playbookRef: { type: 'account_playbook', id: 'playbook-a', version: 1 },
  conversionRoute: { routeId: 'route-a', entryType: 'form', entryRef: 'https://example.test/form', callToAction: 'Submit', qualificationFields: [], handoffTarget: 'sales-a', verifiedAt: now },
  version: 2, createdAt: now, updatedAt: now,
};


const legacyInput:BusinessGoalBuildInput={programRef:{type:'social_program',id:'program-a',version:1},enterprise:{ref:{type:'enterprise_profile',id:'legacy-profile',version:1},products:['Old product'],markets:['US'],audiences:['buyers'],languages:['en'],publicFacts:[{ref:{type:'enterprise_fact',id:'legacy-fact',version:1},statement:'Legacy confirmed fact'}],prohibitedClaims:[],weeklyBudgetCny:500,salesOwnerId:'owner-a'},accounts:[{ref:{type:'owned_social_account',id:'account-a',version:2},accountId:'account-a',platform:'tiktok',role:'proof',status:'active',conversionRouteId:'route-a'}],conversionRoutes:[{ref:{type:'conversion_route',id:'route-a',version:1},routeId:'route-a',kind:'form',target:'https://example.test/form',verified:true}]};
async function setup(){
 const store=memoryStore({social_programs:[{id:'program-row',tenant_id:'tenant-a',program_id:'program-a',payload:program}],tenant_profiles:[{id:'profile-a',tenant_id:'tenant-a',version:4,profile:{company:{description:'Verified factory',mainMarkets:'US',primaryLanguages:'en'},products:{items:[{name:'Serum',images:[{id:1}]}]},customers:{targetProfiles:'brand buyer'}}}],social_owned_accounts:[{id:'account-row',tenant_id:'tenant-a',program_id:'program-a',account_id:'account-a',payload:account}],digital_employee_configs:[{id:'config-a',tenant_id:'tenant-a',status:'active',activated_at:now,config_version:3,config:{autonomyMode:'managed',approvalOwner:'owner-a',enabledWorkflows:['product_content','content_publish','customer_segmentation'],publishingTargets:[{platform:'tiktok',accountId:'account-a',accountLabel:'TikTok'}]}}],studio_production_defaults:[{id:'studio-a',tenant_id:'tenant-a',version:2,payload:{}}]});
 const goals=createSocialOperatingDecisionService(store,()=>now);await goals.buildAndSave({tenantId:'tenant-a',operator:{type:'user',id:'owner-a'},expectedVersion:0,input:legacyInput});
 // A foreign tenant's goal must not supply the initial snapshot version.
 await goals.buildAndSave({tenantId:'foreign',operator:{type:'user',id:'owner-a'},expectedVersion:0,input:legacyInput});
 await goals.buildAndSave({tenantId:'foreign',operator:{type:'user',id:'owner-a'},expectedVersion:1,input:{...legacyInput,objective:'Foreign tenant version two'}});
 for(let version=0;version<3;version++)await goals.buildAndSave({tenantId:'tenant-a',operator:{type:'user',id:'owner-a'},expectedVersion:version,input:{...legacyInput,programRef:{type:'social_program',id:'program-b',version:1},objective:`Foreign program version ${version+1}`}});
 const service=createSocialOperatingOrchestrationService(store,()=>now);await service.saveConstraints('tenant-a','owner-a','program-a',{expectedVersion:0,weeklyBudgetCny:500,costPerOriginalCny:50,costPerAdaptationCny:20,materialUnitsPerOriginal:1,productionItemsPerDay:5,interactionItemsPerWeek:20,salesLeadsPerWeek:10,expectedInteractionsPerPublication:2,expectedLeadsPerPublication:1,accountWeeklyPublicationCapacity:{'account-a':5}});return {store,goals,service};
}
test('first formal authority snapshot migrates an actual tenant/program legacy goal with its current version',async()=>{const f=await setup();const result=await f.service.resolve('tenant-a','owner-a','program-a',{weekStart:'2026-09-28',desiredOriginalContents:1,desiredAdaptations:0,requestedReferenceMode:'ordinary_inspiration',expectedSnapshotVersion:0});assert.equal(result.goal.version,2);assert.equal(result.snapshot.businessContentGoalRef.version,2);assert.equal(result.snapshot.status,'ready');assert.equal(f.store.rows.get('social_operating_authority_snapshots')?.length,1);});
test('a concurrent legacy goal change still fails the first snapshot CAS without retry',async()=>{const f=await setup(),list=f.store.list.bind(f.store);let injected=false;f.store.list=async<T>(collection:string,query:ListQuery={}):Promise<ListResult<T>>=>{const result=await list<T>(collection,query);if(!injected&&collection==='social_business_content_goals'&&query.where?.tenant_id==='tenant-a'){injected=true;await f.goals.buildAndSave({tenantId:'tenant-a',operator:{type:'user',id:'owner-a'},expectedVersion:1,input:{...legacyInput,objective:'Concurrent explicit goal'}});}return result;};await assert.rejects(f.service.resolve('tenant-a','owner-a','program-a',{weekStart:'2026-09-28',desiredOriginalContents:1,desiredAdaptations:0,requestedReferenceMode:'ordinary_inspiration',expectedSnapshotVersion:0}),{code:'version_conflict'});assert.equal(f.store.rows.get('social_operating_authority_snapshots')?.length??0,0);});
