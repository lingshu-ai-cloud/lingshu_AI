import test from 'node:test';import assert from 'node:assert/strict';
import {prepareDefaultPublication} from '../runtime/weeklyDefaultPublication.fixture.js';
import {startSocialContentTask} from './socialContentTasks.js';
import {enqueueSocialContentAutoProduction} from './socialContentProductionQueue.js';
import {readSocialTaskDetail} from './socialContentRecords.js';

test('a stored frozen output fixture is not sufficient authority for a new weekly production start',async t=>{
 const {f}=await prepareDefaultPublication(t);const stored=f.tables.starter_social_content_tasks![0]!;stored.status='draft';stored.run_id='';stored.orchestrator_item_id='';
 await f.store.create('social_programs',{tenant_id:'t',program_id:'p',payload:{programId:'p',version:1}});
 const before=await readSocialTaskDetail({repository:f.repository,tenantId:'t',taskId:'content'});assert.ok(before);
 let enqueues=0;await assert.rejects(startSocialContentTask({repository:f.repository,orchestratorQueue:{enqueue:async()=>{enqueues++;throw Error('must not queue without exact authority');}},tenantId:'t',userId:'owner',taskId:'content',expectedVersion:before.version,idempotencyKey:'actual-weekly-production-start-0001'}),{code:'weekly_production_start_authority_invalid'});
 assert.equal(enqueues,0);assert.equal(f.tables.content_execution_jobs?.length??0,0);
});

test('frozen output fixture cannot register fresh paid work without actual material classification',async t=>{
 const {f}=await prepareDefaultPublication(t);
 await assert.rejects(enqueueSocialContentAutoProduction({repository:f.repository,tenantId:'t',userId:'owner',taskId:'content',runId:'run'}));
 assert.equal(f.tables.content_execution_jobs?.length??0,0);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
