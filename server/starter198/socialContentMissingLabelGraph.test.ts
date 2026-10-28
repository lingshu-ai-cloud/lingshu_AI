import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {missingLabelStartFixture} from './socialContentMissingLabelQueueAdmission.fixture.js';
import {readSocialTaskDetail} from './socialContentRecords.js';
import {STARTER_COLLECTIONS} from './repository.js';
import {createSocialProductionExecutorCheckpoint,executeSocialProductionGraph} from './socialContentProductionGraph.js';
import {admitContentExecutionJob,readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import {recoverSocialContentExecution} from './socialContentExecutionRecovery.js';
import {buildMaterialScriptAnalysis} from '../../shared/materialScriptAnalysis.js';
import type {MaterialRecord} from '../lib/materialLibrary.js';
import {socialRequestHash} from './socialContentValidation.js';

test('frozen unapproved graph completes only missing labels, then records real material blockers before state admission',async t=>{
 const f=await missingLabelStartFixture(t);
 let inventory:MaterialRecord[]=[];
 const repository={...f.repository,materialLibrary:async()=>({status:'ready' as const,items:inventory,sources:[]})};
 await f.store.update(STARTER_COLLECTIONS.socialContentTasks,'task-row',{run_id:'run',status:'producing'});
 await f.store.create('workflow_runs',{id:'run',tenant_id:'tenant',status:'running',starter_context:{socialTaskId:'film'}});
 const detail=await readSocialTaskDetail({repository,tenantId:'tenant',taskId:'film'});assert.ok(detail);
 const before=await f.store.getById<any>(STARTER_COLLECTIONS.socialContentTasks,'task-row');
 const executor=createSocialProductionExecutorCheckpoint(detail);
 assert.equal(detail.agentWorkflow!.executionPlanReview.approved,false);
 const job=await admitContentExecutionJob({dataStore:f.store,tenantId:'tenant',userId:'owner',taskId:'film',runId:'run',taskType:'social_content_instant',initialCheckpoints:{'social.executor':executor}});
 const ledgerRoot=path.join(path.dirname(f.store.filename),'label-test-ledger');
 // Keep all paid state in an isolated test directory supplied by the fixture.
 let posts=0;const receipts=new Map<string,unknown>();
 const runtime:any={productionBudgetReadPorts:{ledgerRoot},benchmarkLabelCompletionPorts:{ledgerRoot,
  readBinding:()=>({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256:'c'.repeat(64),materialModel:'qwen3-vl-plus',imageModel:'qwen3-vl-plus'}),
  readTariff:async(intent:any)=>({provider:intent.provider,model:intent.model,stage:intent.stage,accountRef:intent.accountRef,currency:'CNY',verifiedAccountPrice:true,evidenceRef:'fixture',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:'2099-01-01',meters:{inputTokens:{priceCny:1,unitsPerPrice:260096,minimumUnits:0,increment:1},outputTokens:{priceCny:0,unitsPerPrice:1,minimumUnits:0,increment:1}}}),
  send:async()=>{posts++;return{choices:[{message:{content:JSON.stringify({shots:[{index:1,materialType:'factory',classificationEvidence:'工厂生产线',needsReview:false},{index:2,materialType:'factory',classificationEvidence:'仓库画面',needsReview:false}]})}}]};},
  persistProviderReceipt:async({response}:{response:unknown})=>{receipts.set('receipt',response);return'receipt';},readProviderReceipt:async(ref:string)=>receipts.get(ref)}};
 const execute=async()=>{const current=await readContentExecutionJob(f.store,'tenant','film','run');assert.ok(current);return runWithContentExecutionContext({dataStore:f.store,jobId:job.id,checkpoints:current.checkpoints,action:()=>executeSocialProductionGraph({repository,dataStore:f.store,job:current,runtime})});};
 await assert.rejects(execute(),/initial_material|awaiting_theme_material/);
 assert.equal(posts,1);
 const current=await readContentExecutionJob(f.store,'tenant','film','run');assert.ok(current!.checkpoints['social.benchmark_label_completion']);
 assert.ok(current!.checkpoints['social.initial_material_block']);assert.deepEqual(current!.checkpoints['social.executor'],executor);
 assert.ok(!current!.checkpoints['social.graph_source_assets']);
 const after=await f.store.getById<any>(STARTER_COLLECTIONS.socialContentTasks,'task-row');
 assert.equal(socialRequestHash(after.reference_video_analysis),socialRequestHash(before.reference_video_analysis));
 assert.equal(socialRequestHash(after.replication_script),socialRequestHash(before.replication_script));
 await assert.rejects(execute(),/initial_material|awaiting_theme_material/);assert.equal(posts,1,'restart uses the saved label proof');
 const sha='d'.repeat(64);
 inventory=[{id:'uploaded',type:'video',tenantId:'tenant',name:'工厂产线',duration:12,sourceRevision:sha,
  scriptAnalysis:buildMaterialScriptAnalysis({materialId:'uploaded',name:'工厂产线',sourceRevision:sha,duration:12,
   segments:[{start:0,end:12,observedFacts:'工厂生产线运转',subject:'工厂',confidence:.99}],visualObservations:['工厂生产线运转']}),
  materialRoles:['factory'],rightsStatus:'owned',rightsEvidenceRef:'ownership:uploaded',commercialUseApproved:true,derivativeUseAllowed:true,
  visualObservations:['工厂生产线运转'],segments:[{start:0,end:12}]}];
 const slots=(current!.checkpoints['social.initial_material_block'].payload as any).pending.map((row:any)=>row.shotId);
 for(const [index,slotId]of slots.entries()){
  await f.store.update('content_execution_jobs',job.id,{status:'blocked'});
  const task=await f.store.getById<any>(STARTER_COLLECTIONS.socialContentTasks,'task-row');
  const resumed=await recoverSocialContentExecution({repository,tenantId:'tenant',taskId:'film',userId:'owner',idempotencyKey:`supply-${index}`,
   command:{action:'resume_material_supply',jobId:job.id,runId:'run',expectedVersion:String(task.version),slotId,materialId:'uploaded'}});
  assert.equal(resumed.jobId,job.id);assert.equal(resumed.runId,'run');
  if(index<slots.length-1)await assert.rejects(execute(),/initial_material|awaiting_theme_material/);
 }
 // Isolate source bytes and omit the voice execution binding deliberately:
 // the original graph must reach the existing budget node and stop there.
 runtime.loadProductionAssets=async()=>[];
 runtime.productionBudgetReadPorts.readVoicePlan=async()=>null;
 await assert.rejects(execute(),/whole_film_budget_preflight:selected_voice_runtime_route_missing/);
 assert.equal(posts,1,'user supply recovery never buys another label request');
 const resumed=await readContentExecutionJob(f.store,'tenant','film','run');
 assert.deepEqual(resumed!.checkpoints['social.executor'],executor);
 assert.equal((resumed!.checkpoints['social.material_recovery_selection'].payload as any).selections[slots[0]].materialId,'uploaded');
});
