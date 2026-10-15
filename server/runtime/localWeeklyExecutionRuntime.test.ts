import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeLocalAccountRecords} from '../lib/localAccountStore.js';
import {currentDataAuthority,runWithDataAuthority} from '../storage/dataAuthority.js';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {createLocalWeeklyExecutionRuntime,LOCAL_WEEKLY_CONSUMERS} from './localWeeklyExecutionRuntime.js';
import type {WeeklyScanScope} from './weeklyScanScope.js';

test('local consumer persists exact scope, re-enters local authority on restart, fails closed after revision',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),dir=await mkdtemp(path.join(os.tmpdir(),'local-weekly-consumer-'));
 const prior={NODE_ENV:process.env.NODE_ENV,LOCAL_AUTH_ACCOUNTS_FILE:process.env.LOCAL_AUTH_ACCOUNTS_FILE};
 process.env.NODE_ENV='test';process.env.LOCAL_AUTH_ACCOUNTS_FILE=path.join(dir,'accounts.json');
 writeLocalAccountRecords(process.env.LOCAL_AUTH_ACCOUNTS_FILE,[{userId:'owner',tenantId:'tenant-a',email:'controlled@example.test',name:'Controlled test operator',accountType:'admin',role:'social_operator',salt:'test-only-unused',passwordHash:'test-only-unused',createdAt:'2026-10-01T00:00:00Z'}]);
 t.after(async()=>{for(const [k,v] of Object.entries(prior))if(v===undefined)delete process.env[k];else process.env[k]=v;await rm(dir,{recursive:true,force:true});});
 const scope={tenantId:'tenant-a',programId:f.task.programId,packageId:f.task.packageId,packageVersion:1,actorUserId:'owner'},seen:string[]=[];
 const scan=async(a:WeeklyScanScope)=>{assert.equal(currentDataAuthority(),'local');assert.deepEqual(a,scope);seen.push(a.packageId);return{claimed:0,succeeded:0,pending:0,blocked:0,failed:0};};
 const runtime=createLocalWeeklyExecutionRuntime(f.store,{enabled:()=>true,scan});t.after(()=>runtime.stop());
 await assert.rejects(runWithDataAuthority('pocketbase',()=>runtime.connect(scope)),{code:'local_weekly_consumer_unavailable'});
 await assert.rejects(runWithDataAuthority('local',()=>runtime.connect({...scope,tenantId:'foreign'})),{code:'local_weekly_consumer_actor_forbidden'});
 const actual=await runWithDataAuthority('local',()=>runtime.connect(scope));runtime.stop();
 assert.equal(actual.started,true);assert.equal(actual.state,'idle');assert.equal(actual.dataAuthority,'local');assert(actual.lastScanFinishedAt);assert.equal(actual.lastResult?.succeeded,0);
 assert.equal((await f.store.list(LOCAL_WEEKLY_CONSUMERS)).totalItems,1);
 const resumed=createLocalWeeklyExecutionRuntime(f.store,{enabled:()=>true,scan});t.after(()=>resumed.stop());await resumed.tick();assert.equal(resumed.read(scope).state,'idle');assert(seen.length>=2);
 const before=seen.length;await f.store.create('social_weekly_operating_packages',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:2,payload:{...f.pkg,version:2}});
 await resumed.tick();assert.equal(seen.length,before);assert.equal(resumed.read(scope).lastErrorCode,'local_weekly_consumer_scope_stale');
});
