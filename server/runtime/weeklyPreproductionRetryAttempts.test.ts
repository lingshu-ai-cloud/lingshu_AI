import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {ensureWeeklyPreproductionRetryAttempt,readWeeklyPreproductionRetryAttempt,PREPRODUCTION_RETRY_ATTEMPTS} from './weeklyPreproductionRetryAttempts.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {Record_} from '../storage/datastore.js';

test('single scoped retry attempt preserves original run/job and excludes unproven sources; exhausted grant still verifies history',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),root={jobId:'root',tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,consumerTaskId:'task',consumerInputHash:'input',kind:'discovery',status:'blocked',originalRunKey:'original',actorUserId:'owner',dueAt:'2026-10-16T06:00:00Z',boundAt:'2026-10-16T06:00:00Z',updatedAt:'2026-10-16T06:00:00Z',sourceHash:'scopehash',authority:{scopeId:'scope',scopeVersion:1,scopeHash:'scopehash',requestedModes:['momentum']},code:'provider_budget_exhausted',resultRefs:[],recordHash:'root-hash'} as WeeklyPreproductionJob;
 const run={tenant_id:root.tenantId,runId:`weekly_discovery_${socialRequestHash({tenantId:root.tenantId,key:root.originalRunKey})}`,status:'failed',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{fetched:0,accepted:0}},failureDetails:[{mode:'momentum',platform:'tiktok',queryRef:'q',error:'Apify HTTP 402 not-enough-usage-to-run-paid-actor'},{mode:'momentum',platform:'instagram',queryRef:'q',error:'source outcome unavailable'}]};
 await store.create('social_discovery_runs',run);const before=(await store.list<Record_>('social_discovery_runs')).items[0]!;
 const noGrant=async()=>null;
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-16T08:00:00Z',noGrant),null);
 let remainingCount=10;
 const grant=async(_store:unknown,scope:{tenantId:string;packageVersion:number})=>scope.tenantId===root.tenantId&&scope.packageVersion===root.packageVersion?{grantId:'user-grant',remainingCount,businessDate:'2026-10-16'}:null;
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-17T08:00:00Z',grant),null,'expired daily grant cannot create an attempt');
 const first=await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-16T08:00:00Z',grant);assert(first);
 assert.deepEqual(first.retry.sourceSelection,[{mode:'momentum',platform:'tiktok',queryRef:'q'}]);
 assert.notEqual(first.originalRunKey,root.originalRunKey);assert.equal(first.status,'bound');
 assert.equal((await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-16T09:00:00Z',grant))?.jobId,first.jobId);
 assert.equal((await store.list(PREPRODUCTION_RETRY_ATTEMPTS)).totalItems,1);
 remainingCount=0;assert.equal((await readWeeklyPreproductionRetryAttempt(store,root,grant))?.jobId,first.jobId);
 assert.deepEqual((await store.list<Record_>('social_discovery_runs')).items[0],before);assert.equal(root.status,'blocked');
 await assert.rejects(readWeeklyPreproductionRetryAttempt(store,{...root,consumerInputHash:'changed'},grant),/lineage_changed/);
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,{...root,tenantId:'foreign'},'2026-10-16T08:00:00Z',grant),null);
});
test('daily-limit block stays closed across business days without a scoped grant, then accepts explicit scope',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),root={jobId:'daily-root',tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,consumerTaskId:'task',consumerInputHash:'input',kind:'discovery',status:'blocked',originalRunKey:'daily-original',actorUserId:'owner',dueAt:'2026-10-18T06:00:00Z',boundAt:'2026-10-18T06:00:00Z',updatedAt:'2026-10-18T06:00:00Z',sourceHash:'scopehash',authority:{scopeId:'scope',scopeVersion:1,scopeHash:'scopehash',requestedModes:['momentum']},code:'daily_collection_limit_reached',resultRefs:[],recordHash:'daily-root-hash'} as WeeklyPreproductionJob;
 const run={tenant_id:root.tenantId,runId:`weekly_discovery_${socialRequestHash({tenantId:root.tenantId,key:root.originalRunKey})}`,status:'stopped',stopReason:'daily_collection_limit_reached',startedAt:'2026-10-18T03:00:00.000Z',finishedAt:'2026-10-18T03:01:00.000Z',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{requested:10,fetched:0,accepted:0,failed:0}},failureDetails:[],queryBasis:{momentum:['q']},scopeSnapshot:{modePolicies:{momentum:{platforms:['tiktok']}}}};
 await store.create('social_discovery_runs',run);const before=structuredClone(run),noGrant=async()=>null;
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-18T08:00:00.000Z',noGrant),null,'same business day cannot reuse the exhausted normal window');
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-19T00:01:00.000+08:00',noGrant),null);
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-20T00:01:00.000+08:00',noGrant),null);
 assert.equal((await store.list(PREPRODUCTION_RETRY_ATTEMPTS)).totalItems,0);
 assert.deepEqual((await store.list<Record_>('social_discovery_runs')).items[0]?.runId,before.runId);
 assert.equal(root.status,'blocked');
 const grant=async()=>({grantId:'new-day-explicit',remainingCount:1,businessDate:'2026-10-19'});
 const permitted=await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-19T00:01:00.000+08:00',grant);assert(permitted);
 assert.equal(permitted.retry.authorization?.kind,'explicit_grant');
 assert.equal((await store.list(PREPRODUCTION_RETRY_ATTEMPTS)).totalItems,1);
 assert.equal((await readWeeklyPreproductionRetryAttempt(store,root,grant))?.jobId,permitted.jobId);
});

test('historical natural week keeps its daily-limit run for audit and does not create a retry after restart',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);
 const root={jobId:'historical-root',tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,consumerTaskId:'task',consumerInputHash:'input',kind:'discovery',status:'blocked',originalRunKey:'historical-original',actorUserId:'owner',dueAt:'2026-10-18T06:00:00Z',boundAt:'2026-10-18T06:00:00Z',updatedAt:'2026-10-18T06:00:00Z',sourceHash:'scopehash',authority:{scopeId:'scope',scopeVersion:1,scopeHash:'scopehash',requestedModes:['momentum']},code:'daily_collection_limit_reached',resultRefs:[],recordHash:'historical-root-hash'} as WeeklyPreproductionJob;
 await store.create('social_weekly_operating_packages',{tenant_id:'tenant-a',program_id:'program-a',package_id:'newer-week',version:1,payload:{packageId:'newer-week',version:1,status:'completed',weekStart:'2026-10-19'}});
 const run={tenant_id:root.tenantId,runId:`weekly_discovery_${socialRequestHash({tenantId:root.tenantId,key:root.originalRunKey})}`,status:'stopped',stopReason:'daily_collection_limit_reached',startedAt:'2026-10-18T03:00:00.000Z',finishedAt:'2026-10-18T03:01:00.000Z',discoveryScopeId:'scope',discoveryScopeVersion:1,modeStats:{momentum:{requested:10,fetched:0,accepted:0,failed:0}},failureDetails:[],queryBasis:{momentum:['q']},scopeSnapshot:{modePolicies:{momentum:{platforms:['tiktok']}}}};
 await store.create('social_discovery_runs',run);
 assert.equal(await ensureWeeklyPreproductionRetryAttempt(store,root,'2026-10-19T00:01:00.000+08:00',async()=>null),null);
 assert.equal((await store.list(PREPRODUCTION_RETRY_ATTEMPTS)).totalItems,0);
 assert.equal((await store.list<Record_>('social_discovery_runs')).totalItems,1);
});
