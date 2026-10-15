import test from 'node:test';import assert from 'node:assert/strict';
import {prepareDefaultPublication} from '../runtime/weeklyDefaultPublication.fixture.js';
import {startSocialContentTask} from './socialContentTasks.js';
import {assertWeeklyProductionGraphJob,enqueueSocialContentAutoProduction} from './socialContentProductionQueue.js';
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

test('weekly queue binding upgrades only pristine jobs and keeps started legacy recovery isolated',()=>{
 const base={tenantId:'t',userId:'owner',taskId:'content',runId:'run',id:'job',accountId:null,taskType:'social_content_weekly',status:'queued',attempt:0,maxAttempts:3,retryClass:null,nextRetryAt:null,providerState:'none',providerReceipts:[],checkpoints:{},workerId:null,leaseExpiresAt:null,lastError:null,createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z',lastStartedAt:null,completedAt:null} as any;
 assert.throws(()=>assertWeeklyProductionGraphJob({taskMode:'weekly',requestedExecutor:'langgraph',job:base}),/graph_bridge_required/,'a pristine row must be atomically upgraded before this boundary');
 const legacy={...base,lastStartedAt:'2026-10-13T00:00:00Z',checkpoints:{'social.executor':{version:'1',inputHash:'legacy',updatedAt:'2026-10-13T00:00:00Z',payload:{executor:'legacy',planVersion:'legacy',inputHash:'legacy'}}}};
 assert.doesNotThrow(()=>assertWeeklyProductionGraphJob({taskMode:'weekly',requestedExecutor:'langgraph',job:legacy}));
 assert.throws(()=>assertWeeklyProductionGraphJob({taskMode:'weekly',requestedExecutor:'langgraph',job:{...base,lastStartedAt:'2026-10-13T00:00:00Z'}}),/graph_bridge_required/);
 assert.throws(()=>assertWeeklyProductionGraphJob({taskMode:'weekly',requestedExecutor:'langgraph',job:{...legacy,checkpoints:{'social.executor':{...legacy.checkpoints['social.executor'],payload:{executor:'damaged'}}}}}),/graph_bridge_required/);
});
