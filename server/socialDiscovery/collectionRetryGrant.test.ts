import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWeeklyEnterpriseFactFixture} from '../runtime/weeklyEnterpriseFactSupplement.fixture.js';
import {recordCollectionRetryGrant,COLLECTION_RETRY_GRANTS} from './collectionRetryGrant.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

function root(jobId:string,taskId:string,sourceHash='scope-hash',scopeVersion=1){
 const value={jobId,tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,consumerTaskId:taskId,consumerInputHash:`input-${taskId}`,kind:'discovery',status:'blocked',originalRunKey:`weekly-preproduction:${jobId}`,actorUserId:'owner',dueAt:'2026-10-16T06:00:00Z',boundAt:'2026-10-16T05:00:00Z',updatedAt:'2026-10-16T05:00:00Z',sourceHash,authority:{scopeId:`scope-${sourceHash}`,scopeVersion,scopeHash:sourceHash,requestedModes:['momentum']},code:'daily_collection_limit_reached',resultRefs:[],recordHash:''};
 return {...value,recordHash:socialRequestHash(value)};
}
async function saveRoot(store:Awaited<ReturnType<typeof prepareWeeklyEnterpriseFactFixture>>['store'],value:ReturnType<typeof root>){
 await store.create('social_weekly_preproduction_jobs',{id:value.jobId,tenant_id:value.tenantId,program_id:value.programId,package_id:value.packageId,package_version:value.packageVersion,task_id:value.consumerTaskId,input_hash:value.consumerInputHash,kind:value.kind,status:value.status,original_run_key:value.originalRunKey,record_hash:value.recordHash,payload:value});
}
function parent(value:ReturnType<typeof root>){
 return {tenant_id:value.tenantId,runId:`weekly_discovery_${socialRequestHash({tenantId:value.tenantId,key:value.originalRunKey})}`,status:'stopped',stopReason:'daily_collection_limit_reached',startedAt:'2026-10-18T03:00:00.000Z',finishedAt:'2026-10-18T03:01:00.000Z',discoveryScopeId:value.authority.scopeId,discoveryScopeVersion:value.authority.scopeVersion,modeStats:{momentum:{requested:0,fetched:0,accepted:0,failed:0}},failureDetails:[],queryBasis:{momentum:['q']},scopeSnapshot:{weeklyProducer:{key:value.originalRunKey},modePolicies:{momentum:{platforms:['tiktok']}}}};
}

test('follower authorization is normalized to the deterministic shared discovery leader',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),leader=root('a-leader','leader-task'),follower=root('z-follower','follower-task');
 await saveRoot(store,follower);await saveRoot(store,leader);
 const run=parent(leader);await store.create('social_discovery_runs',run);const stored=(await store.list<typeof run>('social_discovery_runs')).items[0]!;
 const input={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,taskId:follower.consumerTaskId,parentRunId:stored.runId,parentRunHash:socialRequestHash(stored),count:10,businessDate:'2026-10-18',actorUserId:'owner',authorizedAt:'2026-10-18T04:00:00Z',authorizationRef:'user-message',authorizationText:'本次额外最多十条'};
 const grant=await recordCollectionRetryGrant(store,input);
 assert.equal(grant.taskId,leader.consumerTaskId);assert.equal(grant.parentRunId,stored.runId);assert.equal(grant.count,10);
 assert.equal((await recordCollectionRetryGrant(store,input)).grantId,grant.grantId,'restart/replay returns the same sealed grant');
 assert.equal((await store.list(COLLECTION_RETRY_GRANTS)).totalItems,1);
 await assert.rejects(recordCollectionRetryGrant(store,{...input,count:9}),/grant_conflict/);
});

test('cohort normalization fails closed for a missing leader parent and never crosses authority scope',async t=>{
 const {store}=await prepareWeeklyEnterpriseFactFixture(t),leader=root('a-leader','leader-task'),follower=root('z-follower','follower-task'),other=root('0-other','other-task','other-scope',2);
 await saveRoot(store,leader);await saveRoot(store,follower);await saveRoot(store,other);
 const run=parent(leader),base={tenantId:'tenant-a',programId:'program-a',packageId:'package-a',packageVersion:1,count:10,businessDate:'2026-10-18',actorUserId:'owner',authorizedAt:'2026-10-18T04:00:00Z',authorizationRef:'user-message',authorizationText:'本次额外最多十条'};
 await assert.rejects(recordCollectionRetryGrant(store,{...base,taskId:follower.consumerTaskId,parentRunId:run.runId,parentRunHash:socialRequestHash(run)}),/parent_unverified/);
 await store.create('social_discovery_runs',run);
 await assert.rejects(recordCollectionRetryGrant(store,{...base,taskId:other.consumerTaskId,parentRunId:run.runId,parentRunHash:socialRequestHash(run)}),/parent_scope_changed/);
 assert.equal((await store.list(COLLECTION_RETRY_GRANTS)).totalItems,0);
 await assert.rejects(recordCollectionRetryGrant(store,{...base,taskId:follower.consumerTaskId,parentRunId:run.runId,parentRunHash:socialRequestHash(run),count:11}),/authorization_invalid/);
});
