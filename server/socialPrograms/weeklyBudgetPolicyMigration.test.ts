import test from 'node:test';
import assert from 'node:assert/strict';
import type {Record_} from '../storage/datastore.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareWeeklyEnterpriseFactFixture,reopenWeeklyEnterpriseFactFixtureStore} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {prepareWeeklyBudgetPolicyMigration,activateWeeklyBudgetIndependentPreproduction,WEEKLY_BUDGET_POLICY_MIGRATIONS} from './weeklyBudgetPolicyMigration.js';
import {adoptWeeklyAutomationTemplate} from './weeklyAutomationTemplate.js';
import {collectionBusinessDate,readDailyCollectionCapacity} from '../socialDiscovery/dailyCollectionQuota.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from './weeklyIndependentAdmission.js';
import {LOCAL_WEEKLY_CONSUMERS} from '../runtime/localWeeklyExecutionRuntime.js';
import {bindWeeklyPreproductionAuthority,WEEKLY_PREPRODUCTION_JOBS} from '../runtime/weeklyPreproductionProducer.js';
import {supplementConsumerHash} from './weeklySupplementRequests.js';
import {uniqueApprovedWeeklyDiscoveryAuthority} from './weeklyAutomaticScheduleFlow.js';

test('restart recovers the same immutable budget revision after a crash, with no consumer activation',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),scope={tenantId:'tenant-a',actorUserId:'owner',programId:'program-a',packageId:'package-a',packageVersion:1};
 const sourceRow=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 const source={...f.pkg,status:'draft' as const,socialContentPackage:{...f.pkg.socialContentPackage,weeklyBudgetCny:240,perItemBudgetCny:10,authorization:{...f.pkg.socialContentPackage.authorization,allowRealPublishing:false}}};
 await f.store.update('social_weekly_operating_packages',sourceRow.id,{payload:source,status:'draft'});
 const old=structuredClone(f.task);
 Object.assign(old,{status:'pending_activation',attempt:0,lease:null,resultRefs:[],productionProgress:undefined});
 old.schedule={...old.schedule,actualStartedAt:null,actualFinishedAt:null};
 for(const step of ['script','asset_generation','video_generation'] as const)await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:`old-${step}`,idempotency_key:`old-${step}`,payload:{...structuredClone(old),taskId:`old-${step}`,schedule:{...old.schedule,stepKind:step},budget:{category:'production',limitCny:15}}});
 let reviseCalls=0,scheduleCalls=0;
 const revise=async(_scope:typeof scope,marker:string)=>{
  reviseCalls++;
  const revised={...structuredClone(source),version:2,previousVersion:1,changeReason:marker};
  await f.store.create('social_weekly_operating_packages',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',version:2,status:'draft',payload:revised});
  for(const step of ['script','asset_generation','video_generation'] as const)await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,task_id:`new-${step}`,idempotency_key:`new-${step}`,payload:{...structuredClone(old),taskId:`new-${step}`,packageVersion:2,schedule:{...old.schedule,stepKind:step},budget:{category:'production',limitCny:10}}});
  throw Error('simulated death after revise commit');
 };
 await assert.rejects(()=>prepareWeeklyBudgetPolicyMigration(f.store,scope,{revise,schedule:async()=>{scheduleCalls++;return {status:'blocked',targetVersion:null};}}),/simulated death/);
 assert.equal((await f.store.list(WEEKLY_BUDGET_POLICY_MIGRATIONS)).totalItems,1);
 const prepared=await prepareWeeklyBudgetPolicyMigration(f.store,scope,{revise,schedule:async()=>{scheduleCalls++;return {status:'blocked',targetVersion:null};}});
 assert.equal(prepared.state,'schedule_blocked');assert.equal(prepared.revisedVersion,2);assert.equal(prepared.targetVersion,null);
 assert.equal(reviseCalls,1);assert.equal(scheduleCalls,1);
 assert.equal((await prepareWeeklyBudgetPolicyMigration(f.store,scope,{revise,schedule:async()=>{scheduleCalls++;return {status:'blocked',targetVersion:null};}})).state,'schedule_blocked');
 assert.equal(reviseCalls,1);assert.equal(scheduleCalls,1);
 const oldRows=(await f.store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:1}})).items;
 const nextRows=(await f.store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:2}})).items;
 assert.equal(oldRows.length,3);assert(oldRows.every(row=>(row.payload as typeof old).budget.limitCny===15));
 assert.equal(nextRows.length,3);assert(nextRows.every(row=>(row.payload as typeof old).budget.limitCny===10));
 assert.equal(((await f.store.getById<Record_>('social_weekly_operating_packages',sourceRow.id))!.payload as typeof source).socialContentPackage.weeklyBudgetCny,240);
});

test('started legacy production cannot be silently replaced by a fresh budget revision',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),scope={tenantId:'tenant-a',actorUserId:'owner',programId:'program-a',packageId:'package-a',packageVersion:1};
 const sourceRow=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 await f.store.update('social_weekly_operating_packages',sourceRow.id,{payload:{...f.pkg,socialContentPackage:{...f.pkg.socialContentPackage,weeklyBudgetCny:240,perItemBudgetCny:10,authorization:{...f.pkg.socialContentPackage.authorization,allowRealPublishing:false}}}});
 await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:'old-video',idempotency_key:'old-video',payload:{...f.task,taskId:'old-video',status:'blocked',attempt:1,budget:{category:'production',limitCny:15},schedule:{...f.task.schedule,stepKind:'video_generation'}}});
 await assert.rejects(()=>prepareWeeklyBudgetPolicyMigration(f.store,scope,{revise:async()=>{throw Error('must not revise');}}),/weekly_budget_migration_source_ineligible/);
 assert.equal((await f.store.list(WEEKLY_BUDGET_POLICY_MIGRATIONS)).totalItems,0);
});

test('schedule confirmation crash recovers the committed target without a second schedule or consumer',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),scope={tenantId:'tenant-a',actorUserId:'owner',programId:'program-a',packageId:'package-a',packageVersion:1};
 const sourceRow=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 const source={...f.pkg,status:'draft' as const,socialContentPackage:{...f.pkg.socialContentPackage,weeklyBudgetCny:240,perItemBudgetCny:10,authorization:{...f.pkg.socialContentPackage.authorization,allowRealPublishing:false}}};
 await f.store.update('social_weekly_operating_packages',sourceRow.id,{payload:source,status:'draft'});
 const old={...structuredClone(f.task),status:'pending_activation' as const,attempt:0,lease:null,resultRefs:[],productionProgress:undefined,schedule:{...f.task.schedule,stepKind:'video_generation' as const,actualStartedAt:null,actualFinishedAt:null}};
 await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:'old-video',idempotency_key:'old-video',payload:{...old,taskId:'old-video',budget:{category:'production',limitCny:15}}});
 let scheduleCalls=0,recoverCalls=0;
 const createVersion=async(version:number,previousVersion:number,marker:string)=>{
  await f.store.create('social_weekly_operating_packages',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',version,status:'draft',payload:{...structuredClone(source),version,previousVersion,changeReason:marker}});
  await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:version,task_id:`video-${version}`,idempotency_key:`video-${version}`,payload:{...structuredClone(old),taskId:`video-${version}`,packageVersion:version,budget:{category:'production',limitCny:10}}});
 };
 const ports={revise:async(_scope:typeof scope,marker:string)=>{await createVersion(2,1,marker);return 2;},schedule:async()=>{scheduleCalls++;await createVersion(3,2,'automatic schedule');throw Error('simulated death after schedule commit');},recoverSchedule:async()=>{recoverCalls++;return {status:'scheduled',targetVersion:3};}};
 await assert.rejects(()=>prepareWeeklyBudgetPolicyMigration(f.store,scope,ports),/simulated death/);
 const receipt=await prepareWeeklyBudgetPolicyMigration(f.store,scope,ports);
 assert.equal(receipt.state,'scheduled');assert.equal(receipt.revisedVersion,2);assert.equal(receipt.targetVersion,3);
 assert.equal(scheduleCalls,1);assert.equal(recoverCalls,1);
 assert.equal((await prepareWeeklyBudgetPolicyMigration(f.store,scope,ports)).targetVersion,3);
 assert.equal(scheduleCalls,1);assert.equal(recoverCalls,1);
 assert.equal(((await f.store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:1}})).items[0]!.payload as typeof old).budget.limitCny,15);
});

test('blocked budget revision activates independent branches only by explicit, restart-safe step',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-budget-independent-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'store.json'),f=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const scope={tenantId:'tenant-a',actorUserId:'owner',programId:'program-a',packageId:'package-a',packageVersion:1};
 const sourceRow=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 const source={...f.pkg,status:'draft' as const,socialContentPackage:{...f.pkg.socialContentPackage,weeklyBudgetCny:240,perItemBudgetCny:10,authorization:{...f.pkg.socialContentPackage.authorization,allowRealPublishing:false}}};
 await f.store.update('social_weekly_operating_packages',sourceRow.id,{payload:source,status:'draft'});
 const old={...structuredClone(f.task),status:'pending_activation' as const,attempt:0,lease:null,resultRefs:[],schedule:{...f.task.schedule,stepKind:'business_outline' as const,actualStartedAt:null,actualFinishedAt:null}};
 for(const step of ['business_outline','benchmark_collection','video_generation'] as const)await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:`old-${step}`,idempotency_key:`old-${step}`,payload:{...structuredClone(old),taskId:`old-${step}`,schedule:{...old.schedule,stepKind:step},budget:step==='video_generation'?{category:'production',limitCny:15}:{category:'none',limitCny:null}}});
 const revise=async(_scope:typeof scope,marker:string)=>{
  await f.store.create('social_weekly_operating_packages',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',version:2,status:'draft',payload:{...structuredClone(source),version:2,previousVersion:1,changeReason:marker}});
  for(const step of ['business_outline','benchmark_collection','video_generation'] as const)await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,task_id:`new-${step}`,idempotency_key:`new-${step}`,payload:{...structuredClone(old),taskId:`new-${step}`,packageVersion:2,schedule:{...old.schedule,stepKind:step},budget:step==='video_generation'?{category:'production',limitCny:10}:{category:'none',limitCny:null}}});
  return 2;
 };
 const prepared=await prepareWeeklyBudgetPolicyMigration(f.store,scope,{revise,schedule:async()=>({status:'blocked',targetVersion:null})});
 assert.equal(prepared.state,'schedule_blocked');
 const revisedScope={...scope,packageVersion:2};
 await assert.rejects(activateWeeklyBudgetIndependentPreproduction(f.store,scope,{blockedAdmission:async()=>false,bind:async()=>{throw Error('must not bind');}}),/independent_admission_missing/);
 await adoptWeeklyAutomationTemplate(f.store,revisedScope,'owner');
 const day=collectionBusinessDate(new Date());
 for(let i=0;i<10;i++)await f.store.create('social_discovery_daily_reservations',{id:`quota-${i}`,tenant_id:'tenant-a',day,run_id:`prior-${i}`,request_key:`prior-${i}`,count:1});
 assert.equal((await readDailyCollectionCapacity(f.store,{tenantId:'tenant-a',runId:'budget-test'})).remainingCount,0);
 const discovery={scopeId:'approved-scope-v2',scopeVersion:2,requestedModes:['momentum' as const]};
 await f.store.create('social_discovery_scopes',{id:discovery.scopeId,tenant_id:'tenant-a',version:2,status:'active',created_by:'owner',payload:{approval:{status:'approved',scopeVersion:2,approvedByUserId:'owner'},discoveryBrief:{discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true}}}}});
 let binds=0,activeStore=f.store;
 const ports={blockedAdmission:async()=>true,bind:async()=>{
  binds++;
  const id=independentAdmissionId(revisedScope);
  if(!await activeStore.getById(WEEKLY_INDEPENDENT_ADMISSIONS,id))await activeStore.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id,tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,payload:{...revisedScope,admittedAt:new Date().toISOString(),mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
  if(!await activeStore.getById(LOCAL_WEEKLY_CONSUMERS,id))await activeStore.create(LOCAL_WEEKLY_CONSUMERS,{id,tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,payload:revisedScope});
  const tasks=(await activeStore.list<Record_>('social_weekly_execution_tasks',{where:{package_version:2}})).items;
  const currentDiscovery=await uniqueApprovedWeeklyDiscoveryAuthority(activeStore,'tenant-a');
  assert.deepEqual(currentDiscovery,discovery,'binding reads the currently approved discovery scope');
  for(const row of tasks.filter(row=>['business_outline','benchmark_collection'].includes((row.payload as typeof old).schedule.stepKind))){
   const task=row.payload as typeof old,kind=String(task.schedule.stepKind);
   await bindWeeklyPreproductionAuthority({store:activeStore,...revisedScope,taskId:task.taskId,kind:kind==='business_outline'?'outline':'discovery',expectedConsumerInputHash:supplementConsumerHash(task),...(kind==='benchmark_collection'?{discovery:currentDiscovery}:{})});
   if(binds===1)throw Error('crash after first durable job before scan');
  }
 }};
 await assert.rejects(activateWeeklyBudgetIndependentPreproduction(f.store,scope,ports),/crash after first durable job before scan/);
 const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
 assert.equal(((await reopened.list<Record_>(WEEKLY_BUDGET_POLICY_MIGRATIONS)).items[0]!.payload as {state:string}).state,'activating_independent');
 assert.equal((await reopened.list(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).totalItems,1);
 const corruptFile=path.join(directory,'corrupt.json');fs.copyFileSync(file,corruptFile);
 const corrupted=reopenWeeklyEnterpriseFactFixtureStore(corruptFile);
 const partial=(await corrupted.list<Record_>(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).items[0]!;
 await corrupted.update(WEEKLY_PREPRODUCTION_JOBS,partial.id,{record_hash:'tampered'});
 activeStore=corrupted;
 await assert.rejects(activateWeeklyBudgetIndependentPreproduction(corrupted,scope,ports),/weekly_preproduction_job_corrupt/);
 assert.equal((await corrupted.list(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).totalItems,1,'corrupt partial binding cannot be silently replaced');
 activeStore=reopened;
 const completed=await activateWeeklyBudgetIndependentPreproduction(reopened,scope,ports);
 assert.equal(completed.state,'independent_active');assert.equal(binds,3);
 const discoveryJobs=(await reopened.list<Record_>(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).items.filter(row=>(row.payload as {kind:string}).kind==='discovery');
 assert.equal((discoveryJobs[0]!.payload as {authority:{scopeId:string;scopeVersion:number}}).authority.scopeId,discovery.scopeId);
 assert.equal((discoveryJobs[0]!.payload as {authority:{scopeId:string;scopeVersion:number}}).authority.scopeVersion,2);
 await reopened.update('social_discovery_scopes',discovery.scopeId,{status:'retired'});
 await reopened.create('social_discovery_scopes',{id:'approved-scope-v3',tenant_id:'tenant-a',version:3,status:'active',payload:{approval:{status:'approved',scopeVersion:3,approvedByUserId:'owner'},discoveryBrief:{discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true}}}}});
 assert.equal((await uniqueApprovedWeeklyDiscoveryAuthority(reopened,'tenant-a'))?.scopeVersion,3);
 assert.equal((await activateWeeklyBudgetIndependentPreproduction(reopened,scope,ports)).state,'independent_active');assert.equal(binds,3);
 const retained=(await reopened.list<Record_>(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).items.find(row=>(row.payload as {kind:string}).kind==='discovery')!;
 assert.equal((retained.payload as {authority:{scopeId:string;scopeVersion:number}}).authority.scopeVersion,2,'activation replay cannot silently rebind v2 jobs to the later v3 scope');
 assert.equal((await reopened.list<Record_>('social_discovery_daily_reservations')).totalItems,10,'activation cannot mint same-day capacity');
 assert.equal((await reopened.list<Record_>(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).totalItems,2,'restart reuses first binding and creates only the missing job');
 assert.equal((await reopened.list<Record_>('social_discovery_runs')).totalItems,0,'partial binding recovery did not call a provider');
});

test('disk restart after first scan settlement resumes exact v2 binding without rebinding a completed outline',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-budget-scanned-recovery-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'store.json'),f=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const scope={tenantId:'tenant-a',actorUserId:'owner',programId:'program-a',packageId:'package-a',packageVersion:1};
 const sourceRow=(await f.store.list<Record_>('social_weekly_operating_packages')).items[0]!;
 const source={...f.pkg,status:'draft' as const,socialContentPackage:{...f.pkg.socialContentPackage,weeklyBudgetCny:240,perItemBudgetCny:10,authorization:{...f.pkg.socialContentPackage.authorization,allowRealPublishing:false}}};
 await f.store.update('social_weekly_operating_packages',sourceRow.id,{payload:source,status:'draft'});
 const base={...structuredClone(f.task),status:'pending_activation' as const,attempt:0,lease:null,resultRefs:[],schedule:{...f.task.schedule,actualStartedAt:null,actualFinishedAt:null}};
 for(const step of ['business_outline','benchmark_collection','video_generation'] as const)await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:1,task_id:`old-${step}`,idempotency_key:`old-${step}`,payload:{...structuredClone(base),taskId:`old-${step}`,schedule:{...base.schedule,stepKind:step},budget:step==='video_generation'?{category:'production',limitCny:15}:{category:'none',limitCny:null}}});
 const revise=async(_scope:typeof scope,marker:string)=>{
  await f.store.create('social_weekly_operating_packages',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',version:2,status:'draft',payload:{...structuredClone(source),version:2,previousVersion:1,changeReason:marker}});
  for(const step of ['business_outline','benchmark_collection','video_generation'] as const)await f.store.create('social_weekly_execution_tasks',{tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,task_id:`new-${step}`,idempotency_key:`new-${step}`,payload:{...structuredClone(base),taskId:`new-${step}`,packageVersion:2,schedule:{...base.schedule,stepKind:step},budget:step==='video_generation'?{category:'production',limitCny:10}:{category:'none',limitCny:null}}});
  return 2;
 };
 await prepareWeeklyBudgetPolicyMigration(f.store,scope,{revise,schedule:async()=>({status:'blocked',targetVersion:null})});
 const revisedScope={...scope,packageVersion:2};await adoptWeeklyAutomationTemplate(f.store,revisedScope,'owner');
 await f.store.create('social_discovery_scopes',{id:'approved-scope-v2',tenant_id:'tenant-a',version:2,status:'retired',payload:{approval:{status:'approved',scopeVersion:2,approvedBy:'owner'},discoveryBrief:{discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true}}}}});
 const discovery={scopeId:'approved-scope-v3',scopeVersion:3,requestedModes:['momentum' as const]};
 await f.store.create('social_discovery_scopes',{id:discovery.scopeId,tenant_id:'tenant-a',version:3,status:'active',payload:{approval:{status:'approved',scopeVersion:3,approvedBy:'owner'},discoveryBrief:{discoveryModes:['momentum'],modePolicies:{momentum:{enabled:true}}}}});
 let binds=0,resumes=0;
 const bind=async()=>{
  binds++;
  await f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(revisedScope),tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,payload:{...revisedScope,admittedAt:new Date().toISOString(),mode:'independent_branches',authorizePublishing:false,authorizeMessaging:false}});
  await f.store.create(LOCAL_WEEKLY_CONSUMERS,{id:independentAdmissionId(revisedScope),tenant_id:'tenant-a',program_id:'program-a',package_id:'package-a',package_version:2,payload:revisedScope});
  const tasks=(await f.store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:2}})).items;
  const currentDiscovery=await uniqueApprovedWeeklyDiscoveryAuthority(f.store,'tenant-a');
  assert.deepEqual(currentDiscovery,discovery,'v3 is approved before binding the immutable v2 budget revision');
  for(const row of tasks.filter(row=>['business_outline','benchmark_collection'].includes((row.payload as typeof base).schedule.stepKind))){const task=row.payload as typeof base;await bindWeeklyPreproductionAuthority({store:f.store,...revisedScope,taskId:task.taskId,kind:task.schedule.stepKind==='business_outline'?'outline':'discovery',expectedConsumerInputHash:supplementConsumerHash(task),...(task.schedule.stepKind==='benchmark_collection'?{discovery:currentDiscovery}:{})});}
  const outline=tasks.find(row=>(row.payload as typeof base).schedule.stepKind==='business_outline')!;
  await f.store.update('social_weekly_execution_tasks',outline.id,{status:'succeeded',payload:{...(outline.payload as typeof base),status:'succeeded',attempt:1,resultRefs:[{type:'business_content_goal',id:'goal',version:1}]}});
  throw Error('crash after scoped scan before receipt');
 };
 await assert.rejects(activateWeeklyBudgetIndependentPreproduction(f.store,scope,{blockedAdmission:async()=>true,bind}),/crash after scoped scan/);
 const unsafeFile=path.join(directory,'non-independent-execution.json');fs.copyFileSync(file,unsafeFile);
 const unsafe=reopenWeeklyEnterpriseFactFixtureStore(unsafeFile);
 const video=(await unsafe.list<Record_>('social_weekly_execution_tasks',{where:{package_version:2}})).items.find(row=>(row.payload as typeof base).schedule.stepKind==='video_generation')!;
 await unsafe.update('social_weekly_execution_tasks',video.id,{status:'running',payload:{...(video.payload as typeof base),status:'running',attempt:1}});
 await assert.rejects(activateWeeklyBudgetIndependentPreproduction(unsafe,scope,{blockedAdmission:async()=>true,bind:async()=>{throw Error('must not rebind');},resumeScan:async()=>{throw Error('must not scan');}}),/weekly_budget_migration_non_independent_execution/);
 assert.equal((await unsafe.list<Record_>(WEEKLY_BUDGET_POLICY_MIGRATIONS)).items[0]!.state,'activating_independent');
 const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
 const result=await activateWeeklyBudgetIndependentPreproduction(reopened,scope,{blockedAdmission:async()=>true,bind,resumeScan:async()=>{resumes++;}});
 assert.equal(result.state,'independent_active');assert.equal(binds,1);assert.equal(resumes,1);
 assert.equal((await reopened.list<Record_>(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).totalItems,2);
 const discoveryJob=(await reopened.list<Record_>(WEEKLY_PREPRODUCTION_JOBS,{where:{package_version:2}})).items.find(row=>(row.payload as {kind:string}).kind==='discovery')!;
 assert.equal((discoveryJob.payload as {authority:{scopeId:string;scopeVersion:number}}).authority.scopeId,discovery.scopeId);
 assert.equal((discoveryJob.payload as {authority:{scopeId:string;scopeVersion:number}}).authority.scopeVersion,3);
 assert.equal((await activateWeeklyBudgetIndependentPreproduction(reopened,scope,{blockedAdmission:async()=>true,bind,resumeScan:async()=>{resumes++;}})).state,'independent_active');
 assert.equal(binds,1);assert.equal(resumes,1);
});
