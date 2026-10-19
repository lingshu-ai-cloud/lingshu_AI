import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,ListQuery,Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {adoptWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from './weeklyIndependentAdmission.js';
import {reconcileWeeklyDiscoveryScopeMigrations,WEEKLY_DISCOVERY_SCOPE_MIGRATIONS} from './weeklyDiscoveryScopeMigration.js';
import {WEEKLY_PREPRODUCTION_JOBS,type WeeklyPreproductionJob} from '../runtime/weeklyPreproductionProducer.js';

function memory(){
 const tables=new Map<string,Record_[]>();
 const store:DataStore={
  async getById<T>(collection:string,id:string){return structuredClone(tables.get(collection)?.find(row=>row.id===id)??null) as T|null;},
  async list<T>(collection:string,query:ListQuery={}){let all=(tables.get(collection)??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));if(query.sort==='-version')all=all.sort((a,b)=>Number(b.version)-Number(a.version));else if(query.sort==='id')all=all.sort((a,b)=>String(a.id).localeCompare(String(b.id)));const page=query.page??1,perPage=query.perPage??30;return {items:structuredClone(all.slice((page-1)*perPage,page*perPage)) as T[],totalItems:all.length,totalPages:Math.max(1,Math.ceil(all.length/perPage)),page,perPage};},
  async create<T>(collection:string,data:Record<string,unknown>){const all=tables.get(collection)??[];const id=String(data.id??`${collection}-${all.length}`);if(all.some(row=>row.id===id))return null;const row={...structuredClone(data),id} as Record_;tables.set(collection,[...all,row]);return structuredClone(row) as T;},
  async update(collection:string,id:string,data:Record<string,unknown>){const row=tables.get(collection)?.find(item=>item.id===id);if(!row)return false;Object.assign(row,structuredClone(data));return true;},
  async delete(){return false;},
 };
 return {store,tables,push:(collection:string,row:Record_)=>tables.set(collection,[...(tables.get(collection)??[]),structuredClone(row)])};
}

test('retired discovery authority creates one resumable migration and never mutates the old job',async()=>{
 const f=memory(),source={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:4,actorUserId:'owner'};
 f.push('users',{id:'owner',tenantId:'tenant',role:'social_operator',active:true});
 f.push('social_weekly_operating_packages',{id:'week-v4',tenant_id:'tenant',program_id:'program',package_id:'week',version:4,payload:{programId:'program',packageId:'week',version:4,status:'draft'}});
 await adoptWeeklyAutomationTemplate(f.store,source,'owner');
 const admission={...source,admittedAt:'2026-10-18T00:00:00.000Z',mode:'independent_branches' as const,authorizePublishing:false as const,authorizeMessaging:false as const};
 f.push(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(source),tenant_id:'tenant',program_id:'program',package_id:'week',package_version:4,payload:admission});
 const oldPayload={approval:{status:'approved',scopeVersion:1},discoveryBrief:{discoveryModes:['momentum']}};
 const nextPayload={approval:{status:'approved',scopeVersion:2},discoveryBrief:{discoveryModes:['momentum','account']}};
 f.push('social_discovery_scopes',{id:'scope-old',tenant_id:'tenant',version:1,status:'retired',payload:oldPayload});
 f.push('social_discovery_scopes',{id:'scope-next',tenant_id:'tenant',version:2,status:'active',payload:nextPayload});
 const body:Omit<WeeklyPreproductionJob,'recordHash'>={jobId:'old-job',tenantId:'tenant',programId:'program',packageId:'week',packageVersion:4,consumerTaskId:'task-old',consumerInputHash:'input-old',kind:'discovery',status:'blocked',originalRunKey:'weekly-preproduction:old-job',actorUserId:'owner',dueAt:'2026-10-20T00:00:00.000Z',boundAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:00.000Z',sourceHash:socialRequestHash(oldPayload),authority:{scopeId:'scope-old',scopeVersion:1,scopeHash:socialRequestHash(oldPayload),requestedModes:['momentum']},code:'weekly_preproduction_scope_changed',resultRefs:[]};
 const job={...body,recordHash:socialRequestHash({...body,recordHash:''})};
 f.push(WEEKLY_PREPRODUCTION_JOBS,{id:job.jobId,tenant_id:'tenant',program_id:'program',package_id:'week',package_version:4,record_hash:job.recordHash,payload:job});
 const before=structuredClone(job),calls:Array<{authorityId:string;sourceVersion:number}>=[];
 const advance=async({receipt,authority}:{receipt:any;authority:any})=>{calls.push({authorityId:authority.scopeId,sourceVersion:receipt.source.packageVersion});return {revisedVersion:5,targetVersion:6};};
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{now:()=> '2026-10-18T01:00:00.000Z',advance}),{migrated:1,deferred:0});
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{now:()=> '2026-10-18T01:01:00.000Z',advance}),{migrated:1,deferred:0});
 assert.deepEqual(calls,[{authorityId:'scope-next',sourceVersion:4}]);
 assert.deepEqual((await f.store.getById<Record_>(WEEKLY_PREPRODUCTION_JOBS,'old-job'))?.payload,before);
 const migrations=await f.store.list<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS);
 assert.equal(migrations.totalItems,1);assert.equal((migrations.items[0]!.payload as any).state,'completed');assert.equal((migrations.items[0]!.payload as any).targetVersion,6);
});

test('ambiguous current approved scopes and provider-unknown old jobs defer without revision',async()=>{
 const f=memory(),source={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,actorUserId:'owner'};
 f.push('users',{id:'owner',tenantId:'tenant',role:'social_operator',active:true});
 f.push('social_weekly_operating_packages',{id:'week-v1',tenant_id:'tenant',program_id:'program',package_id:'week',version:1,payload:{programId:'program',packageId:'week',version:1,status:'draft'}});
 await adoptWeeklyAutomationTemplate(f.store,source,'owner');
 f.push(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(source),tenant_id:'tenant',program_id:'program',package_id:'week',package_version:1,payload:{...source,admittedAt:'2026-10-18T00:00:00.000Z',mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
 const payload=(version:number)=>({approval:{status:'approved',scopeVersion:version},discoveryBrief:{discoveryModes:['momentum']}});
 f.push('social_discovery_scopes',{id:'old',tenant_id:'tenant',version:1,status:'retired',payload:payload(1)});
 f.push('social_discovery_scopes',{id:'new-a',tenant_id:'tenant',version:2,status:'active',payload:payload(2)});
 f.push('social_discovery_scopes',{id:'new-b',tenant_id:'tenant',version:3,status:'active',payload:payload(3)});
 const raw:any={jobId:'job',tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,consumerTaskId:'task',consumerInputHash:'hash',kind:'discovery',status:'unknown',originalRunKey:'run',actorUserId:'owner',dueAt:'2026-10-20T00:00:00.000Z',boundAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:00.000Z',sourceHash:'source',authority:{scopeId:'old',scopeVersion:1,scopeHash:'old-hash',requestedModes:['momentum']},code:null,resultRefs:[],recordHash:''};raw.recordHash=socialRequestHash({...raw,recordHash:''});
 f.push(WEEKLY_PREPRODUCTION_JOBS,{id:'job',tenant_id:'tenant',program_id:'program',package_id:'week',package_version:1,record_hash:raw.recordHash,payload:raw});
 let calls=0;assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{advance:async()=>{calls++;return {revisedVersion:2,targetVersion:3};}}),{migrated:0,deferred:1});assert.equal(calls,0);assert.equal((await f.store.list(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS)).totalItems,0);
});

function migrationReceipt(input:{id:string;packageId:string;weekVersion?:number;state?:'planned'|'revised'|'scheduled';revisedVersion?:number|null}){
 const source={tenantId:'tenant',programId:'program',packageId:input.packageId,packageVersion:input.weekVersion??1,actorUserId:'owner'};
 const body={schemaVersion:'weekly-discovery-scope-migration.v1' as const,migrationId:input.id,source,oldAuthority:{scopeId:'scope-old',scopeVersion:1,requestedModes:['momentum'],scopeHash:'old-hash'},nextAuthority:{scopeId:'scope-next',scopeVersion:2,requestedModes:['momentum'],scopeHash:''},oldJobIds:[`${input.packageId}-job`],state:input.state??'planned',revisedVersion:input.revisedVersion??null,targetVersion:null,createdAt:'2026-10-18T00:00:00.000Z',updatedAt:'2026-10-18T00:00:00.000Z'};
 return body;
}

function pushApprovedScope(f:ReturnType<typeof memory>){
 const payload={approval:{status:'approved',scopeVersion:2},discoveryBrief:{discoveryModes:['momentum']}};
 f.push('social_discovery_scopes',{id:'scope-next',tenant_id:'tenant',version:2,status:'active',payload});
 return socialRequestHash(payload);
}

function pushMigration(f:ReturnType<typeof memory>,raw:ReturnType<typeof migrationReceipt>){
 const nextAuthority={...raw.nextAuthority,scopeHash:(f.tables.get('social_discovery_scopes')?.find(row=>row.id==='scope-next')?.payload?socialRequestHash(f.tables.get('social_discovery_scopes')!.find(row=>row.id==='scope-next')!.payload):raw.nextAuthority.scopeHash)};
 const body={...raw,nextAuthority};
 const payload={...body,recordHash:socialRequestHash(body)};
 f.push(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,{id:payload.migrationId,tenant_id:'tenant',program_id:'program',package_id:payload.source.packageId,package_version:payload.source.packageVersion,state:payload.state,record_hash:payload.recordHash,payload});
 return payload;
}

test('restart resumes a durable migration intent after revision persisted but consumer binding was interrupted',async()=>{
 const f=memory();
 pushApprovedScope(f);
 f.push('social_weekly_operating_packages',{id:'current-v1',tenant_id:'tenant',program_id:'program',package_id:'current-week',version:1,payload:{programId:'program',packageId:'current-week',version:1,status:'draft',weekStart:'2026-10-26',weekEnd:'2026-11-01'}});
 const receipt=pushMigration(f,migrationReceipt({id:'migration-current',packageId:'current-week'}));
 let firstCalls=0;
 await assert.rejects(reconcileWeeklyDiscoveryScopeMigrations(f.store,{now:()=> '2026-10-18T01:00:00.000Z',advance:async({receipt:attempt})=>{
  firstCalls+=1;
  assert.equal(attempt.migrationId,receipt.migrationId);
  // The immutable revision committed, then the process stopped before the
  // existing schedule/consumer binding flow could complete.
  f.push('social_weekly_operating_packages',{id:'current-v2',tenant_id:'tenant',program_id:'program',package_id:'current-week',version:2,payload:{programId:'program',packageId:'current-week',version:2,previousVersion:1,status:'draft',weekStart:'2026-10-26',weekEnd:'2026-11-01',changeReason:`discovery-scope-migration:${attempt.migrationId}`}});
  throw Error('simulated_binding_interruption');
 }}),/simulated_binding_interruption/);
 assert.equal(firstCalls,1);
 assert.equal(((await f.store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,receipt.migrationId))!.payload as any).state,'planned');

 // A fresh reconciler instance sees the same durable receipt and committed
 // revision, and resumes binding instead of manufacturing another revision.
 let resumedCalls=0;
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{now:()=> '2026-10-18T01:01:00.000Z',advance:async({receipt:attempt})=>{
  resumedCalls+=1;
  const revisions=(await f.store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:'tenant',program_id:'program',package_id:'current-week'}})).items;
  assert.deepEqual(revisions.map(row=>row.version).sort(),[1,2]);
  assert.equal(attempt.state,'planned');
  return {revisedVersion:2,targetVersion:2};
 }}),{migrated:1,deferred:0});
 assert.equal(resumedCalls,1);
 const completed=(await f.store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,receipt.migrationId))!.payload as any;
 assert.equal(completed.state,'completed');
 assert.equal(completed.revisedVersion,2);
 assert.equal(completed.targetVersion,2);
});

test('restart supersedes historical pending receipt and only resumes the latest natural week',async()=>{
 const f=memory();
 pushApprovedScope(f);
 f.push('social_weekly_operating_packages',{id:'history-v1',tenant_id:'tenant',program_id:'program',package_id:'history-week',version:1,payload:{programId:'program',packageId:'history-week',version:1,status:'draft',weekStart:'2026-10-19',weekEnd:'2026-10-25'}});
 f.push('social_weekly_operating_packages',{id:'current-v1',tenant_id:'tenant',program_id:'program',package_id:'current-week',version:1,payload:{programId:'program',packageId:'current-week',version:1,status:'draft',weekStart:'2026-10-26',weekEnd:'2026-11-01'}});
 const historical=pushMigration(f,migrationReceipt({id:'migration-history',packageId:'history-week'}));
 const current=pushMigration(f,migrationReceipt({id:'migration-current',packageId:'current-week'}));
 const calls:string[]=[];
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{now:()=> '2026-10-18T02:00:00.000Z',advance:async({receipt})=>{
  calls.push(receipt.source.packageId);
  return {revisedVersion:2,targetVersion:2};
 }}),{migrated:1,deferred:0});
 assert.deepEqual(calls,['current-week']);
 const historicalAfter=(await f.store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,historical.migrationId))!.payload as any;
 const currentAfter=(await f.store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,current.migrationId))!.payload as any;
 assert.equal(historicalAfter.state,'superseded');
 assert.equal(historicalAfter.revisedVersion,null);
 assert.equal(currentAfter.state,'completed');

 // Further restarts preserve the historical receipt as audit-only evidence and
 // never invoke the revision/binding flow again for either completed intent.
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{now:()=> '2026-10-18T02:01:00.000Z',advance:async()=>{throw Error('completed_or_historical_migration_replayed');}}),{migrated:0,deferred:0});
 assert.equal((await f.store.list<Record_>('social_weekly_operating_packages',{where:{package_id:'history-week'}})).totalItems,1);
});

test('a later completed natural week still prevents an older draft from being revised',async()=>{
 const f=memory();pushApprovedScope(f);
 f.push('social_weekly_operating_packages',{id:'old-v1',tenant_id:'tenant',program_id:'program',package_id:'old-week',version:1,payload:{programId:'program',packageId:'old-week',version:1,status:'draft',weekStart:'2026-10-19'}});
 f.push('social_weekly_operating_packages',{id:'new-v1',tenant_id:'tenant',program_id:'program',package_id:'new-week',version:1,payload:{programId:'program',packageId:'new-week',version:1,status:'completed',weekStart:'2026-10-26'}});
 const receipt=pushMigration(f,migrationReceipt({id:'migration-old-completed-newer',packageId:'old-week'}));
 assert.deepEqual(await reconcileWeeklyDiscoveryScopeMigrations(f.store,{advance:async()=>{throw Error('historical_week_revised');}}),{migrated:0,deferred:0});
 assert.equal(((await f.store.getById<Record_>(WEEKLY_DISCOVERY_SCOPE_MIGRATIONS,receipt.migrationId))!.payload as any).state,'superseded');
});
