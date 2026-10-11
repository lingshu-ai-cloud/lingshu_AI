import test from 'node:test';import assert from 'node:assert/strict';
import {readWeeklyProductionStartAttempt} from './weeklyProductionStartAttempt.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
test('failed prerequisite retries revised subject only without run effects; unknown retains original request',async()=>{
 const row={id:'op',idempotency_key:'binding:start',target_id:'task',operation:'start_social_content_task',status:'failed',error_code:'social_content_execution_director_review_required',request_hash:socialRequestHash({expectedVersion:'v1'}),result:{expectedVersion:'v1'},updated_at:'now'};
 const subject={run_id:'',orchestrator_item_id:''};let jobs=0;
 const repository={list:async(collection:string)=>({items:collection==='starter_social_content_operations'?[row]:[subject],totalItems:1}),dataStore:{list:async()=>({items:[],totalItems:jobs})}};
 const input={repository:repository as never,tenantId:'tenant',taskId:'task',binding:'binding',version:'v2'};
 assert.deepEqual(await readWeeklyProductionStartAttempt(input),{idempotencyKey:'binding:start:version:v2',expectedVersion:'v2'});
 row.status='processing';assert.deepEqual(await readWeeklyProductionStartAttempt(input),{idempotencyKey:'binding:start',expectedVersion:'v1'});
 row.status='failed';jobs=1;assert.equal((await readWeeklyProductionStartAttempt(input)).idempotencyKey,'binding:start');jobs=0;
 subject.orchestrator_item_id='queued';assert.equal((await readWeeklyProductionStartAttempt(input)).idempotencyKey,'binding:start');subject.orchestrator_item_id='';
 row.error_code='provider_outcome_unknown';assert.equal((await readWeeklyProductionStartAttempt(input)).expectedVersion,'v1');
 row.request_hash='corrupt';await assert.rejects(readWeeklyProductionStartAttempt(input),/corrupt/);
});
