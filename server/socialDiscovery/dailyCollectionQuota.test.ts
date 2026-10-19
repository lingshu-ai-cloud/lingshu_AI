import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {reserveDailyCollection,readDailyCollectionCapacity,collectionBusinessDate} from './dailyCollectionQuota.js';
import {readCollectionRetryGrant} from './dailyCollectionQuota.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {COLLECTION_RETRY_GRANTS} from './collectionRetryGrant.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
test('daily ceiling spans runs and sources, retains failed/unknown reservations and uses Shanghai midnight',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-15T12:00:00Z');
 const reserve=(runId:string,requestKey:string,requested:number,tenantId='tenant-a')=>reserveDailyCollection(store,{tenantId,runId,requestKey,requested,now});
 assert.equal(await reserve('a','q1',4),4);assert.equal(await reserve('b','q2',4),4);assert.equal(await reserve('c','q3',8),2);assert.equal(await reserve('d','q4',1),0);
 await assert.rejects(reserve('a','q1',4),/already_reserved/);
 assert.equal(await reserve('a','q1',10,'foreign'),10);
 assert.equal(collectionBusinessDate(new Date('2026-10-15T16:00:00Z')),'2026-10-16');
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'tomorrow',requestKey:'q',requested:10,now:new Date('2026-10-15T16:00:00Z')}),10);
});
test('atomic minimum prevents a five-item request from becoming a partial paid reservation',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-15T12:00:00Z');
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'other',requestKey:'prior',requested:6,now}),6);
 await assert.rejects(reserveDailyCollection(store,{tenantId:'tenant-a',runId:'five',requestKey:'account:tiktok:factory',requested:5,minimumRequired:5,now}),/daily_collection_minimum_capacity_required/);
 const rows=await store.list('social_discovery_daily_reservations',{where:{tenant_id:'tenant-a',day:collectionBusinessDate(now)}});
 assert.equal(rows.totalItems,1);
 assert.equal((await readDailyCollectionCapacity(store,{tenantId:'tenant-a',runId:'five',now})).remainingCount,4);
});
test('one-time extra quota is sealed, source scoped, capped and separate from normal daily quota',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-16T03:00:00Z');
 const scope={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:'task-a',parentRunId:'failed-original',parentRunHash:'original-hash'};
 const grantId=socialRequestHash(scope),grant:any={...scope,grantId,count:10,businessDate:'2026-10-16',actorUserId:'user-a',authorizedAt:now.toISOString(),source:'explicit_user_authorization',authorizationRef:'test-human-consent',authorizationText:'one-time extra 10',recordHash:''};grant.recordHash=socialRequestHash(grant);
 await store.create(COLLECTION_RETRY_GRANTS,{id:grantId,tenant_id:scope.tenantId,record_hash:grant.recordHash,payload:grant});
 const {tenantId,...rest}=scope,ref={...rest,grantId},attempt:any={jobId:'retry',originalRunKey:'root:retry:retry',retry:{grant:ref,parentRunHash:scope.parentRunHash,sourceSelection:[{mode:'momentum',platform:'tiktok',queryRef:'cleanser'},{mode:'momentum',platform:'facebook',queryRef:'cleanser'}]},recordHash:''};attempt.recordHash=socialRequestHash(attempt);
 await store.create('social_weekly_preproduction_retry_attempts',{id:'retry',tenant_id:tenantId,package_id:scope.packageId,package_version:1,task_id:scope.taskId,record_hash:attempt.recordHash,payload:attempt});
 const runId=`weekly_discovery_${socialRequestHash({tenantId,key:attempt.originalRunKey})}`;
 const reserve=(requestKey:string,requested:number,retryGrant=ref)=>reserveDailyCollection(store,{tenantId,runId,requestKey,requested,retryGrant,now});
 assert.equal(await reserveDailyCollection(store,{tenantId,runId:'base',requestKey:'base',requested:10,now}),10);
 await assert.rejects(reserve('momentum:instagram:cleanser',1),/attempt_unverified/);
 await assert.rejects(reserve('momentum:tiktok:cleanser',1,{...ref,packageVersion:2}),/scope_invalid/);
 assert.equal(await reserve('momentum:tiktok:cleanser',6),6);
 assert.equal(await reserve('momentum:facebook:cleanser',10),4);
 assert.deepEqual(await readCollectionRetryGrant(store,scope),{grantId,remainingCount:0,businessDate:'2026-10-16'});
 assert.equal(await reserveDailyCollection(store,{tenantId,runId:'another-base',requestKey:'q',requested:1,now}),0);
 await assert.rejects(reserveDailyCollection(store,{tenantId,runId,requestKey:'q',requested:1,retryGrant:ref,now:new Date('2026-10-17T03:00:00Z')}),/scope_invalid/);
 assert.equal(await readCollectionRetryGrant(store,{...scope,tenantId:'foreign'}),null);
});
test('preexisting same-day collection consumes quota without double counting ledger-backed runs',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-15T12:00:00Z');
 await store.create('social_discovery_runs',{tenant_id:'tenant-a',runId:'legacy',startedAt:now.toISOString(),modeStats:{momentum:{requested:7}}});
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'new',requestKey:'q',requested:10,now}),3);
 await store.create('social_discovery_runs',{tenant_id:'tenant-a',runId:'new',startedAt:now.toISOString(),modeStats:{momentum:{requested:3}}});
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'next',requestKey:'q',requested:1,now}),0);
});
test('read-only capacity equals subsequent reservation and counts unknown submissions',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-15T12:00:00Z');
 const scope={tenantId:'tenant-a',runId:'new',now};
 assert.equal((await readDailyCollectionCapacity(store,scope)).remainingCount,10);
 const before=(await store.list('social_discovery_daily_reservations')).totalItems;
 assert.equal((await readDailyCollectionCapacity(store,scope)).remainingCount,10);
 assert.equal((await store.list('social_discovery_daily_reservations')).totalItems,before,'read creates no reservation');
 assert.equal(await reserveDailyCollection(store,{...scope,requestKey:'submitted-unknown',requested:4}),4);
 assert.equal((await readDailyCollectionCapacity(store,{...scope,runId:'after-restart'})).remainingCount,6);
 assert.equal(await reserveDailyCollection(store,{...scope,runId:'after-restart',requestKey:'second',requested:9}),6);
 assert.equal((await readDailyCollectionCapacity(store,{...scope,runId:'new-runtime'})).remainingCount,0);
 assert.equal(await reserveDailyCollection(store,{...scope,runId:'new-runtime',requestKey:'third',requested:1}),0);
 const tomorrow={...scope,runId:'tomorrow',now:new Date('2026-10-15T16:00:00Z')};
 assert.equal((await readDailyCollectionCapacity(store,tomorrow)).remainingCount,10);
 assert.equal(await reserveDailyCollection(store,{...tomorrow,requestKey:'new-day',requested:10}),10);
});

test('read-only capacity uses the same legacy-run and grant ledgers but grants no new quota',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),now=new Date('2026-10-16T03:00:00Z');
 await store.create('social_discovery_runs',{tenant_id:'tenant-a',runId:'legacy-unknown',startedAt:now.toISOString(),status:'running',modeStats:{momentum:{requested:7}}});
 assert.equal((await readDailyCollectionCapacity(store,{tenantId:'tenant-a',runId:'new',now})).remainingCount,3);
 assert.equal(await reserveDailyCollection(store,{tenantId:'tenant-a',runId:'new',requestKey:'normal',requested:5,now}),3);
 const scope={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:'task-a',parentRunId:'failed-original',parentRunHash:'original-hash'};
 const grantId=socialRequestHash(scope),grant:any={...scope,grantId,count:2,businessDate:'2026-10-16',actorUserId:'user-a',authorizedAt:now.toISOString(),source:'explicit_user_authorization',authorizationRef:'test-human-consent',authorizationText:'two extra',recordHash:''};grant.recordHash=socialRequestHash(grant);
 await store.create(COLLECTION_RETRY_GRANTS,{id:grantId,tenant_id:scope.tenantId,record_hash:grant.recordHash,payload:grant});
 const {tenantId,...rest}=scope,ref={...rest,grantId},attempt:any={jobId:'retry-read',originalRunKey:'root:retry:retry-read',retry:{grant:ref,parentRunHash:scope.parentRunHash,sourceSelection:[{mode:'momentum',platform:'tiktok',queryRef:'q'}]},recordHash:''};attempt.recordHash=socialRequestHash(attempt);
 await store.create('social_weekly_preproduction_retry_attempts',{id:attempt.jobId,tenant_id:tenantId,package_id:scope.packageId,package_version:1,task_id:scope.taskId,record_hash:attempt.recordHash,payload:attempt});
 const runId=`weekly_discovery_${socialRequestHash({tenantId,key:attempt.originalRunKey})}`;
 const granted={tenantId,runId,now,retryGrant:ref};
 assert.equal((await readDailyCollectionCapacity(store,granted)).remainingCount,2);
 assert.equal(await reserveDailyCollection(store,{...granted,requestKey:'momentum:tiktok:q',requested:2}),2);
 assert.equal((await readDailyCollectionCapacity(store,granted)).remainingCount,0);
 assert.equal((await readDailyCollectionCapacity(store,{tenantId,runId:'normal-only',now})).remainingCount,0,'grant never enlarges normal capacity');
 await assert.rejects(readDailyCollectionCapacity(store,{...granted,now:new Date('2026-10-17T03:00:00Z')}),/scope_invalid/);
});

test('fresh local-store processes read the persisted unknown reservation before another submission',async t=>{
 const directory=mkdtempSync(path.join(tmpdir(),'daily-capacity-restart-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const storeUrl=new URL('../storage/pbStore.ts',import.meta.url).href;
 const authorityUrl=new URL('../storage/dataAuthority.ts',import.meta.url).href;
 const quotaUrl=new URL('./dailyCollectionQuota.ts',import.meta.url).href;
 const run=(body:string)=>new Promise<string>((resolve,reject)=>{
  const code=`const {pbStore}=await import(${JSON.stringify(storeUrl)});const {runWithDataAuthority}=await import(${JSON.stringify(authorityUrl)});const {reserveDailyCollection,readDailyCollectionCapacity}=await import(${JSON.stringify(quotaUrl)});await runWithDataAuthority('local',async()=>{const now=new Date('2026-10-15T12:00:00Z');${body}});`;
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',code],{env:{...process.env,NODE_ENV:'test',ENABLE_LOCAL_DEV_FALLBACK:'true',LOCAL_STORE_DIR:directory},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('exit',exit=>exit===0?resolve(output.trim()):reject(Error(output)));
 });
 assert.equal(await run(`console.log(await reserveDailyCollection(pbStore,{tenantId:'tenant',runId:'first',requestKey:'submitted-unknown',requested:6,now}));`),'6');
 assert.equal(await run(`console.log((await readDailyCollectionCapacity(pbStore,{tenantId:'tenant',runId:'second',now})).remainingCount);`),'4');
 assert.equal(await run(`console.log(await reserveDailyCollection(pbStore,{tenantId:'tenant',runId:'second',requestKey:'next',requested:5,now}));`),'4');
 assert.equal(await run(`console.log((await readDailyCollectionCapacity(pbStore,{tenantId:'tenant',runId:'third',now})).remainingCount);`),'0');
});
