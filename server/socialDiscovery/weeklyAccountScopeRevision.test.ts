import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {reviseWeeklyAccountCollectionScope} from './weeklyAccountScopeRevision.js';
import {reconcileWeeklyDiscoveryScopeMigrations,WEEKLY_DISCOVERY_SCOPE_MIGRATIONS} from '../socialPrograms/weeklyDiscoveryScopeMigration.js';
import {adoptWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from '../socialPrograms/weeklyIndependentAdmission.js';
import {WEEKLY_PREPRODUCTION_JOBS} from '../runtime/weeklyPreproductionProducer.js';

function diskFixture(){
 const tables=new Map<string,Record_[]>();let interruptActivation=false;
 const store:DataStore={
  supportsAtomicCompareAndSwap:()=>true,
  async getById<T>(collection:string,id:string){return structuredClone(tables.get(collection)?.find(row=>row.id===id)??null) as T|null;},
  async list<T>(collection:string,query:ListQuery={}){let all=(tables.get(collection)??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));if(query.sort==='-version')all=all.sort((a,b)=>Number(b.version)-Number(a.version));const page=query.page??1,perPage=query.perPage??30;return {items:structuredClone(all.slice((page-1)*perPage,page*perPage)) as T[],totalItems:all.length,totalPages:Math.max(1,Math.ceil(all.length/perPage)),page,perPage};},
  async create<T>(collection:string,data:Record<string,unknown>){const rows=tables.get(collection)??[],id=String(data.id??`${collection}-${rows.length}`);if(rows.some(row=>row.id===id))return null;const row={...structuredClone(data),id} as Record_;tables.set(collection,[...rows,row]);return structuredClone(row) as T;},
  async update(collection,id,data){const row=tables.get(collection)?.find(item=>item.id===id);if(!row)return false;Object.assign(row,structuredClone(data));return true;},
  async compareAndSwap(collection,id,expected,data){if(interruptActivation&&collection==='social_discovery_scopes'&&data.status==='active'){interruptActivation=false;return false;}const row=tables.get(collection)?.find(item=>item.id===id);if(!row||Object.entries(expected).some(([key,value])=>row[key]!==value))return false;Object.assign(row,structuredClone(data));return true;},
  async delete(){return false;},
 };
 const push=(collection:string,row:Record_)=>tables.set(collection,[...(tables.get(collection)??[]),structuredClone(row)]);
 return {store,push,tables,interrupt:()=>{interruptActivation=true;}};
}

test('approved five-video account revision survives restart and migrates only current week; old scope and job remain',async()=>{
 const f=diskFixture(),accountUrl='https://www.tiktok.com/@factory_reference';
 const oldPayload:any={approval:{status:'approved',scopeVersion:1,approvedBy:'user'},productFactBinding:{version:1,selectedProducts:['产品 A'],enterpriseProductNames:['产品 A']},keywordSet:{keywordSetId:'keywords',version:1},discoveryBrief:{keywordSetVersion:1,platforms:['tiktok','facebook'],competitorAccounts:[],discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true,sourceRefs:['product'],platforms:['tiktok'],resultLimit:10,refreshIntervalMinutes:60,budgetLimitCny:null}}},benchmarkAccounts:[]};
 f.push('social_discovery_scopes',{id:'old-scope',tenant_id:'tenant',keyword_set_id:'keywords',version:1,status:'active',payload:oldPayload});
 f.push('competitor_accounts',{id:'account',tenantId:'tenant',platform:'tiktok',accountUrl});
 f.push('users',{id:'owner',tenantId:'tenant',role:'social_operator',active:true});
 const input={tenantId:'tenant',actorUserId:'owner',accountId:'account',expectedScopeId:'old-scope',expectedScopeVersion:1,expectedScopeHash:socialRequestHash(oldPayload),expectedProductFactBindingHash:socialRequestHash(oldPayload.productFactBinding),targetCount:5 as const};
 f.interrupt();await assert.rejects(reviseWeeklyAccountCollectionScope(f.store,input),/activation_unknown/);
 assert.equal((await f.store.getById<Record_>('social_discovery_scopes','old-scope'))?.status,'retired');
 const revised=await reviseWeeklyAccountCollectionScope(f.store,input);
 assert.equal(revised.targetCount,5);assert.equal((await f.store.getById<any>('social_discovery_scopes',revised.scopeId))?.payload.discoveryBrief.weeklyAccountCollectionTarget.accountUrl,accountUrl);
 assert.deepEqual(await reviseWeeklyAccountCollectionScope(f.store,input),revised);
 const source={tenantId:'tenant',programId:'program',packageId:'current-week',packageVersion:1,actorUserId:'owner'};
 f.push('social_weekly_operating_packages',{id:'historical',tenant_id:'tenant',program_id:'program',package_id:'historical-week',version:1,payload:{programId:'program',packageId:'historical-week',version:1,status:'draft',weekStart:'2026-10-05'}});
 f.push('social_weekly_operating_packages',{id:'current',tenant_id:'tenant',program_id:'program',package_id:'current-week',version:1,payload:{programId:'program',packageId:'current-week',version:1,status:'draft',weekStart:'2026-10-19'}});
 await adoptWeeklyAutomationTemplate(f.store,source,'owner');
 f.push(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(source),tenant_id:'tenant',program_id:'program',package_id:'current-week',package_version:1,payload:{...source,admittedAt:'2026-10-19T00:00:00Z',mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
 const body:any={jobId:'old-job',...source,consumerTaskId:'consumer',consumerInputHash:'consumer-hash',kind:'discovery',status:'blocked',originalRunKey:'weekly-preproduction:old-job',dueAt:'2026-10-20T00:00:00Z',boundAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z',sourceHash:socialRequestHash(oldPayload),authority:{scopeId:'old-scope',scopeVersion:1,scopeHash:socialRequestHash(oldPayload),requestedModes:['momentum']},code:'weekly_preproduction_scope_changed',resultRefs:[],recordHash:''};body.recordHash=socialRequestHash({...body,recordHash:''});
 f.push(WEEKLY_PREPRODUCTION_JOBS,{id:'old-job',tenant_id:'tenant',program_id:'program',package_id:'current-week',package_version:1,record_hash:body.recordHash,payload:body});
 const before=structuredClone(body);let advances=0;
 const advance=async({authority}:{authority:any})=>{assert.equal(authority.scopeId,revised.scopeId);advances++;return {revisedVersion:2,targetVersion:3};};
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{advance}),{migrated:1,deferred:0});
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{advance}),{migrated:1,deferred:0});
 assert.equal(advances,1);assert.deepEqual((await f.store.getById<any>(WEEKLY_PREPRODUCTION_JOBS,'old-job'))?.payload,before);
 assert.equal((await f.store.list(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS)).totalItems,1);
 assert.equal((await f.store.list('social_weekly_operating_packages')).totalItems,2);
});

test('account target cannot be self-declared, cross-tenant, or detached from product fact',async()=>{
 const f=diskFixture(),payload:any={approval:{status:'approved',scopeVersion:1},productFactBinding:{selectedProducts:['A']},keywordSet:{version:1},discoveryBrief:{platforms:['tiktok'],competitorAccounts:[],discoveryModes:['momentum']},benchmarkAccounts:[]};
 f.push('social_discovery_scopes',{id:'old',tenant_id:'tenant',version:1,status:'active',payload});f.push('competitor_accounts',{id:'account',tenantId:'foreign',platform:'tiktok',accountUrl:'https://www.tiktok.com/@other'});
 f.push('users',{id:'owner',tenantId:'tenant',role:'social_operator',active:true});
 const base={tenantId:'tenant',actorUserId:'owner',accountId:'account',expectedScopeId:'old',expectedScopeVersion:1,expectedScopeHash:socialRequestHash(payload),expectedProductFactBindingHash:socialRequestHash(payload.productFactBinding),targetCount:5 as const};
 await assert.rejects(reviseWeeklyAccountCollectionScope(f.store,base),/account_invalid/);
 await assert.rejects(reviseWeeklyAccountCollectionScope(f.store,{...base,expectedProductFactBindingHash:'stale'}),/account_invalid|product_fact_changed/);
 assert.equal((await f.store.getById<Record_>('social_discovery_scopes','old'))?.status,'active');
});

test('five-video source revision requires an active authorized tenant actor',async()=>{
 const f=diskFixture(),payload:any={approval:{status:'approved',scopeVersion:1},productFactBinding:{selectedProducts:['A']},keywordSet:{version:1},discoveryBrief:{platforms:['tiktok'],competitorAccounts:['https://www.tiktok.com/@factory_reference'],discoveryModes:['account']},benchmarkAccounts:[]};
 f.push('social_discovery_scopes',{id:'old',tenant_id:'tenant',version:1,status:'active',payload});
 f.push('competitor_accounts',{id:'account',tenantId:'tenant',platform:'tiktok',accountUrl:'https://www.tiktok.com/@factory_reference'});
 const base={tenantId:'tenant',actorUserId:'actor',accountId:'account',expectedScopeId:'old',expectedScopeVersion:1,expectedScopeHash:socialRequestHash(payload),expectedProductFactBindingHash:socialRequestHash(payload.productFactBinding),targetCount:5 as const};
 for(const row of [{id:'actor',tenantId:'tenant',role:'customer_service',active:true},{id:'actor',tenantId:'foreign',role:'admin',active:true},{id:'actor',tenantId:'tenant',role:'social_operator',disabled:true}]){
  const prior=await f.store.getById<Record_>('users','actor');
  if(prior)await f.store.update('users','actor',row);else f.push('users',row);
  await assert.rejects(reviseWeeklyAccountCollectionScope(f.store,base),/weekly_account_scope_actor_forbidden/);
  assert.equal((await f.store.getById<Record_>('social_discovery_scopes','old'))?.status,'active');
 }
});
