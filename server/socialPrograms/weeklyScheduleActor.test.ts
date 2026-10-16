import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertWeeklyScheduleActor} from './weeklyScheduleActor.js';
import {runWithDataAuthority} from '../storage/dataAuthority.js';
import {writeLocalAccountRecords} from '../lib/localAccountStore.js';
import type {DataStore} from '../storage/datastore.js';

test('local weekly actor uses persisted tenant identity only under local authority',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'weekly-actor-'));
 const old={mode:process.env.NODE_ENV,file:process.env.LOCAL_AUTH_ACCOUNTS_FILE};
 process.env.NODE_ENV='test';process.env.LOCAL_AUTH_ACCOUNTS_FILE=path.join(dir,'accounts.json');
 const scope={tenantId:'tenant',actorUserId:'actor',packageVersion:1};
 const missing={getById:async()=>null} as unknown as DataStore;
 try{
  writeLocalAccountRecords(process.env.LOCAL_AUTH_ACCOUNTS_FILE,[{userId:'actor',tenantId:'tenant',email:'preview@local.test',name:'Preview',accountType:'customer',role:'admin',salt:'salt',passwordHash:'hash',createdAt:new Date().toISOString()}]);
  await runWithDataAuthority('local',()=>assertWeeklyScheduleActor(missing,scope));
  await assert.rejects(runWithDataAuthority('pocketbase',()=>assertWeeklyScheduleActor(missing,scope)),/无权/);
  await assert.rejects(runWithDataAuthority('local',()=>assertWeeklyScheduleActor(missing,{...scope,tenantId:'other'})),/无权/);
  const disabled={getById:async()=>({id:'actor',tenantId:'tenant',role:'admin',disabled:true})} as unknown as DataStore;
  await assert.rejects(runWithDataAuthority('local',()=>assertWeeklyScheduleActor(disabled,scope)),/无权/);
 }finally{
  if(old.mode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old.mode;
  if(old.file===undefined)delete process.env.LOCAL_AUTH_ACCOUNTS_FILE;else process.env.LOCAL_AUTH_ACCOUNTS_FILE=old.file;
  await rm(dir,{recursive:true,force:true});
 }
});
