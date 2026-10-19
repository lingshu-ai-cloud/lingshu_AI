import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore} from '../storage/datastore.js';
import {runWithDataAuthority} from '../storage/dataAuthority.js';
import {readWeeklyReviewActor} from './weeklyReviewEvidence.js';
import {assertWeeklyScheduleActor} from './weeklyScheduleActor.js';
test('local review identity never falls through to a different authority user record',async()=>{
 let reads=0;
 const store={async getById(){reads++;return {id:'not-a-local-user',tenantId:'foreign',role:'admin'};}} as unknown as DataStore;
 const actor=await runWithDataAuthority('local',()=>readWeeklyReviewActor(store,'not-a-local-tenant','not-a-local-user'));
 assert.equal(actor,null);assert.equal(reads,0);
 const formal=await runWithDataAuthority('pocketbase',()=>readWeeklyReviewActor(store,'foreign','not-a-local-user'));
 assert.equal(formal?.role,'admin');assert.equal(reads,1);
});
test('local capacity confirmation never falls through to formal authority membership',async()=>{
 let reads=0;
 const store={async getById(){reads++;return {id:'not-a-local-user',tenantId:'foreign',role:'admin'};}} as unknown as DataStore;
 await assert.rejects(runWithDataAuthority('local',()=>assertWeeklyScheduleActor(store,{tenantId:'foreign',actorUserId:'not-a-local-user',packageVersion:1})),{code:'weekly_schedule_user_forbidden'});
 assert.equal(reads,0);
 await runWithDataAuthority('pocketbase',()=>assertWeeklyScheduleActor(store,{tenantId:'foreign',actorUserId:'not-a-local-user',packageVersion:1}));
 assert.equal(reads,1);
});
