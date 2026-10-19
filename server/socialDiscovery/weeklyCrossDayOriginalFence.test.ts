import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {DataStore} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {prepareWeeklyEnterpriseFactFixture,reopenWeeklyEnterpriseFactFixtureStore} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {reserveDailyCollection,DAILY_COLLECTION_RESERVATIONS} from './dailyCollectionQuota.js';
import {assertWeeklyOriginalCrossDayFence,type WeeklyOriginalCollectionScope} from './weeklyCrossDayOriginalFence.js';
import {executeApprovedDiscoveryRun} from './service.js';

const tenantId='tenant-a',programId='program-a',packageId='package-a';
const day18=new Date('2026-10-18T15:59:59.000Z'),day19=new Date('2026-10-18T16:00:01.000Z');
async function job(store:DataStore,version:number,key:string,authority?:{scopeId:string;scopeVersion:number;scopeHash:string}){
 const payload={jobId:`job-${version}`,tenantId,programId,packageId,packageVersion:version,kind:'discovery',originalRunKey:key,authority,recordHash:''};
 payload.recordHash=socialRequestHash({...payload,recordHash:''});
 await store.create('social_weekly_preproduction_jobs',{id:payload.jobId,tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:version,kind:'discovery',original_run_key:key,record_hash:payload.recordHash,payload});
 return payload;
}
async function run(store:DataStore,key:string,startedAt:string,status='stopped'){
 const runId=`weekly_discovery_${socialRequestHash({tenantId,key})}`;
 await store.create('social_discovery_runs',{id:socialRequestHash({tenantId,key}).slice(0,15),tenant_id:tenantId,runId,status,startedAt,scopeSnapshot:{weeklyProducer:{key}},modeStats:{}});
 return runId;
}
const scope=(version:number,key:string):WeeklyOriginalCollectionScope=>({programId,packageId,packageVersion:version,originalRunKey:key});

test('a revised package cannot spend next-day ordinary quota after an older-version original run',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);await job(store,5,'root-v5');await run(store,'root-v5',day18.toISOString());await job(store,7,'root-v7');
 const before=store.snapshot();
 await assert.rejects(assertWeeklyOriginalCrossDayFence(store,tenantId,scope(7,'root-v7'),day19),/weekly_discovery_cross_day_revision_collection_required/);
 await assert.rejects(reserveDailyCollection(store,{tenantId,runId:`weekly_discovery_${socialRequestHash({tenantId,key:'root-v7'})}`,requestKey:'momentum:tiktok:source',requested:1,now:day19,weeklyOriginal:scope(7,'root-v7')}),/weekly_discovery_cross_day_revision_collection_required/);
 assert.equal((await store.list(DAILY_COLLECTION_RESERVATIONS)).totalItems,0);
 assert.deepEqual((await store.list('social_discovery_runs')).items,before.social_discovery_runs,'old run stays immutable');
});

test('late activation rejects before creating a new run, reservation, or provider request',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);await job(store,5,'root-v5');await run(store,'root-v5',day18.toISOString());await job(store,7,'root-v7');
 const discovery={approval:{status:'approved',scopeVersion:1},discoveryBrief:{discoveryModes:['momentum']}};
 await store.create('social_discovery_scopes',{id:'scope',tenant_id:tenantId,status:'active',version:1,payload:discovery});
 let providerCalls=0;const request={tenantId,triggerType:'manual' as const,expectedScopeId:'scope',expectedScopeVersion:1,requestedModes:['momentum' as const],originalRun:{key:'root-v7',scopeHash:socialRequestHash(discovery)},now:day19};
 const dependencies={dataStore:store,async crawl(){providerCalls++;throw Error('provider_must_not_run');},candidateEvidenceAdapter:{async toEvidenceWorkItems(){throw Error('evidence_must_not_run');}},async runCandidateEvidence(){throw Error('evidence_must_not_run');}} as any;
 const results=await Promise.allSettled([executeApprovedDiscoveryRun(request,dependencies),executeApprovedDiscoveryRun(request,dependencies)]);
 assert(results.every(result=>result.status==='rejected'&&/weekly_discovery_cross_day_revision_collection_required/.test(String(result.reason))));
 assert.equal(providerCalls,0);assert.equal((await store.list('social_discovery_runs')).totalItems,1);assert.equal((await store.list(DAILY_COLLECTION_RESERVATIONS)).totalItems,0);
});

test('a genuinely never-submitted revision may first collect after midnight',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);await job(store,5,'root-v5');await job(store,7,'root-v7');
 const runId=`weekly_discovery_${socialRequestHash({tenantId,key:'root-v7'})}`;
 assert.equal(await reserveDailyCollection(store,{tenantId,runId,requestKey:'momentum:tiktok:source',requested:1,now:day19,weeklyOriginal:scope(7,'root-v7')}),1);
 assert.equal((await store.list(DAILY_COLLECTION_RESERVATIONS)).totalItems,1);
});

test('an earlier unknown provider submission cannot be replaced by another version even on the same day',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t);await job(store,5,'root-v5');await run(store,'root-v5',day18.toISOString(),'running');await job(store,7,'root-v7');
 await assert.rejects(assertWeeklyOriginalCrossDayFence(store,tenantId,scope(7,'root-v7'),day18),/weekly_discovery_prior_submission_unknown/);
 assert.equal((await store.list(DAILY_COLLECTION_RESERVATIONS)).totalItems,0);
});

test('a newly user-approved scope may replace yesterday’s different scope, but not replay it the next day',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),old={scopeId:'scope-old',scopeVersion:1,scopeHash:'old-hash'};
 await job(store,4,'root-v4',old);await run(store,'root-v4','2026-10-17T15:00:00.000Z');
 const payload={approval:{status:'approved',scopeVersion:2,approvedAt:'2026-10-18T03:00:00.000Z'}},fresh={scopeId:'scope-new',scopeVersion:2,scopeHash:socialRequestHash(payload)};
 await store.create('social_discovery_scopes',{id:'scope-new',tenant_id:tenantId,status:'active',version:2,payload});
 await job(store,5,'root-v5',fresh);
 await assert.doesNotReject(assertWeeklyOriginalCrossDayFence(store,tenantId,scope(5,'root-v5'),day18));
 await run(store,'root-v5',day18.toISOString());await job(store,7,'root-v7',fresh);
 await assert.rejects(assertWeeklyOriginalCrossDayFence(store,tenantId,scope(7,'root-v7'),day19),/weekly_discovery_cross_day_revision_collection_required/);
});

test('a previous child run and an unknown previous original remain fenced after disk restart',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'weekly-cross-day-fence-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'store.json'),{store}=await prepareWeeklyEnterpriseFactFixture(t,{persistentFile:file});
 const root=await job(store,5,'root-v5');await job(store,7,'root-v7');
 const childKey='root-v5:retry:child',attempt={tenantId,programId,packageId,packageVersion:5,originalRunKey:childKey,retry:{rootJobId:root.jobId},recordHash:''};
 attempt.recordHash=socialRequestHash({...attempt,recordHash:''});
 await store.create('social_weekly_preproduction_retry_attempts',{id:'child',tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:5,root_job_id:root.jobId,record_hash:attempt.recordHash,payload:attempt});
 await run(store,childKey,day18.toISOString());
 const reopened=reopenWeeklyEnterpriseFactFixtureStore(file);
 await assert.rejects(assertWeeklyOriginalCrossDayFence(reopened,tenantId,scope(7,'root-v7'),day19),/weekly_discovery_cross_day_revision_collection_required/);
 await reopened.create('social_discovery_runs',{tenant_id:tenantId,runId:`weekly_discovery_${socialRequestHash({tenantId,key:'root-v5'})}`,status:'running',startedAt:day18.toISOString(),scopeSnapshot:{weeklyProducer:{key:'root-v5'}},modeStats:{}});
 await assert.rejects(assertWeeklyOriginalCrossDayFence(reopenWeeklyEnterpriseFactFixtureStore(file),tenantId,scope(7,'root-v7'),day19),/weekly_discovery_prior_submission_unknown/);
 assert.equal((await reopened.list(DAILY_COLLECTION_RESERVATIONS)).totalItems,0);
});
