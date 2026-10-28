import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {SocialContentTaskDetail} from '../../shared/contracts/socialContentTaskContract.js';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {socialRequestHash} from './socialContentValidation.js';
import {autoCompleteMissingBenchmarkLabels,MISSING_LABEL_COMPLETION_STAGE} from './socialContentMissingLabelCompletion.js';
import {projectMissingLabelOverlay,readMissingLabelRuntimeOverlay} from './socialContentMissingLabelOverlay.js';
import {repairVideoShotClassifications} from '../agents/qwenClassificationRepair.js';

async function fixture(t:test.TestContext){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'label-completion-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new LangGraphTestStore(path.join(root,'store.json')),repository=createStarter198Repository(store);
 const source={sourceId:'source',sourceRef:'https://example.com/video'};
 const record={id:'video',tenantId:'tenant',sourceUrl:source.sourceRef,aiAnalysis:JSON.stringify({analysisRunId:'analysis',contentSha256:'a'.repeat(64),analysisMode:'exact'})};
 const raw={recordId:record.id,analysis:record.aiAnalysis,shotReview:undefined,verifiedSpeech:undefined};
 const analysisId=`reference-analysis-${socialRequestHash({sourceId:source.sourceId,sourceRef:source.sourceRef,...raw}).slice(0,20)}`;
 const detail={taskId:'film',version:'1',brief:{materialRoutingPolicyVersion:'type-aware.v3',referenceReuse:{recordId:record.id,analysisId:'analysis',contentSha256:'a'.repeat(64)}},sources:[source],
  referenceVideoAnalysis:{analysisId,version:socialRequestHash(raw).slice(0,12),referenceRecordId:record.id,referenceSourceId:'source',shots:[{shotId:'ref',startSeconds:0,endSeconds:3,visualDescription:'工厂生产线正在运转',materialType:'unknown'}]},
  replicationScript:{referenceAnalysisId:analysisId,shots:[{shotId:'slot',referenceShotId:'ref',startSeconds:0,endSeconds:3}]},
  agentWorkflow:{directorBrief:{scenes:[{sceneId:'slot',referenceShotId:'ref',duration:{startSeconds:0,endSeconds:3}}]}},
  assetSupplyPlan:{materialRoutingPolicyVersion:'type-aware.v3',shots:[{shotId:'slot',materialRouting:{materialType:'unknown',pendingReason:'material_label_unresolved'}}]}} as unknown as SocialContentTaskDetail;
 await store.create('trend_videos',record);
 await store.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:'tenant',task_id:'film',run_id:'run',brief:detail.brief});
 await store.create('content_execution_jobs',{id:'job',tenant_id:'tenant',task_id:'film',run_id:'run',job_key:'job-key',user_id:'user',account_id:'account',task_type:'social_content_auto',status:'running',checkpoints:{},provider_receipts:[],created_at:'2026-10-28T00:00:00.000Z',updated_at:'2026-10-28T00:00:00.000Z'});
 let posts=0;const receipts=new Map<string,unknown>();let output=JSON.stringify({shots:[{index:1,materialType:'factory',classificationEvidence:'工厂生产线',needsReview:false}]});
 const input={repository,tenantId:'tenant',taskId:'film',runId:'run',detail,planHash:'b'.repeat(64),assertCurrent:async()=>{},ports:{ledgerRoot:root,
  readBinding:()=>({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256:'c'.repeat(64),materialModel:'qwen3-vl-plus',imageModel:'qwen3-vl-plus'}),
  readTariff:async(intent:any)=>({provider:intent.provider,model:intent.model,stage:intent.stage,accountRef:intent.accountRef,currency:'CNY' as const,verifiedAccountPrice:true,evidenceRef:'test-price',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:'2099-01-01',meters:{inputTokens:{priceCny:1,unitsPerPrice:260096,minimumUnits:0,increment:1},outputTokens:{priceCny:0,unitsPerPrice:1,minimumUnits:0,increment:1}}}),
  send:async()=>{posts++;return {choices:[{message:{content:output}}]};},
  persistProviderReceipt:async({response}:{response:unknown})=>{receipts.set('receipt',response);return 'receipt';},
  readProviderReceipt:async(ref:string)=>receipts.get(ref),record:async(entry:any)=>{
   const job=await store.getById<any>('content_execution_jobs','job');await store.update('content_execution_jobs','job',{checkpoints:{...job.checkpoints,[entry.stage]:{...entry,updatedAt:'2026-10-28T00:00:00.000Z'}}});}}};
 return {input,store,detail,get posts(){return posts;},setOutput:(text:string)=>{output=text;}};
}

test('observed-fact repair creates a bound overlay and replay keeps original source and fixed slots',async t=>{
 const f=await fixture(t),before=structuredClone(f.detail),overlay=await autoCompleteMissingBenchmarkLabels(f.input);
 assert.ok(overlay);assert.equal(f.posts,1);assert.deepEqual(f.detail,before);
 assert.equal(overlay.labels[0]!.materialType,'factory');
 const projected=projectMissingLabelOverlay({...f.input,reference:f.detail.referenceVideoAnalysis,overlay});
 assert.equal(projected.shots[0]!.materialType,'factory');assert.equal(projected.analysisId,f.detail.referenceVideoAnalysis!.analysisId);
 assert.deepEqual({...projected.shots[0],materialType:'unknown'},f.detail.referenceVideoAnalysis!.shots[0]);
 assert.deepEqual(await readMissingLabelRuntimeOverlay(f.input),overlay);
 assert.deepEqual(await autoCompleteMissingBenchmarkLabels(f.input),overlay);assert.equal(f.posts,1);
 await assert.rejects(readMissingLabelRuntimeOverlay({...f.input,runId:'other'}).then(value=>{if(!value)throw Error('no-other-run');}),/no-other-run/);
 const job=await f.store.getById<any>('content_execution_jobs','job');job.checkpoints[MISSING_LABEL_COMPLETION_STAGE].payload.labels[0].materialType='product';
 await f.store.update('content_execution_jobs','job',{checkpoints:job.checkpoints});
 await assert.rejects(readMissingLabelRuntimeOverlay(f.input),/overlay_invalid/);
});

test('no source observation performs no paid request; uncertain observation remains unknown',async t=>{
 const f=await fixture(t);f.detail.referenceVideoAnalysis!.shots[0]!.visualDescription='';
 assert.equal(await autoCompleteMissingBenchmarkLabels(f.input),null);assert.equal(f.posts,0);
 f.detail.referenceVideoAnalysis!.shots[0]!.visualDescription='只看到无法辨别的背景';
 f.setOutput(JSON.stringify({shots:[{index:1,materialType:'unknown',classificationEvidence:'',needsReview:true}]}));
 const overlay=await autoCompleteMissingBenchmarkLabels(f.input);assert.equal(overlay!.labels[0]!.materialType,'unknown');assert.equal(f.posts,1);
});

test('material-only mode preserves narrative, timing and known shots; invented evidence rejects',async()=>{
 const analysis:any={scriptDetails15s:[{time:'0-2',visual:'产品包装特写',dialogue:'原话',narrativeRole:'cta',materialType:'unknown'},{time:'2-3',visual:'工厂',narrativeRole:'hook',materialType:'factory'}]};
 const repaired=await repairVideoShotClassifications({analysis,materialOnlyIndexes:[1],complete:async()=>JSON.stringify({shots:[{index:1,materialType:'product',classificationEvidence:'包装特写',needsReview:false,narrativeRole:'hook'}]})});
 assert.deepEqual({...repaired.scriptDetails15s![0],materialType:'unknown',classificationEvidence:undefined,needsReview:undefined},{...analysis.scriptDetails15s[0],classificationEvidence:undefined,needsReview:undefined});
 assert.deepEqual(repaired.scriptDetails15s![1],analysis.scriptDetails15s[1]);
 await assert.rejects(repairVideoShotClassifications({analysis,materialOnlyIndexes:[1],complete:async()=>JSON.stringify({shots:[{index:1,materialType:'product',classificationEvidence:'人物在涂抹',needsReview:false}]})}),/evidence_invalid/);
});

test('crash after paid response recovers original receipt and does not buy another classification',async t=>{
 const f=await fixture(t),record=f.input.ports.record;let crash=true;
 f.input.ports.record=async entry=>{if(crash){crash=false;throw Error('checkpoint-write-failed');}await record(entry);};
 await assert.rejects(autoCompleteMissingBenchmarkLabels(f.input),/checkpoint-write-failed/);assert.equal(f.posts,1);
 const overlay=await autoCompleteMissingBenchmarkLabels(f.input);assert.equal(overlay!.labels[0]!.materialType,'factory');assert.equal(f.posts,1);
});

test('invalid paid output blocks user action and never becomes a guessed label on retry',async t=>{
 const f=await fixture(t);f.setOutput('{"shots":[{"index":1,"materialType":"factory","classificationEvidence":"不存在的画面","needsReview":false}]}');
 await assert.rejects(autoCompleteMissingBenchmarkLabels(f.input),/user_input_required:benchmark_label_completion_unresolved/);
 await assert.rejects(autoCompleteMissingBenchmarkLabels(f.input),/user_input_required:benchmark_label_completion_unresolved/);
 assert.equal(f.posts,1);
 assert.equal(await readMissingLabelRuntimeOverlay(f.input),null);
});

test('source observation changes during a paid response cannot publish a stale overlay',async t=>{
 const f=await fixture(t),send=f.input.ports.send;
 f.input.ports.send=async()=>{
  const response=await send();
  const rows=await f.input.repository.list(STARTER_COLLECTIONS.socialContentTasks,'tenant',{where:{task_id:'film'},perPage:2});
  await f.store.update(STARTER_COLLECTIONS.socialContentTasks,rows.items[0]!.id,{reference_video_analysis:{changed:true}});
  return response;
 };
 await assert.rejects(autoCompleteMissingBenchmarkLabels(f.input),/benchmark_label_task_source_changed/);
 assert.equal(f.posts,1);
 assert.equal(await readMissingLabelRuntimeOverlay(f.input),null);
});

test('missing provider binding blocks with a stable public code before paid submission',async t=>{
 const f=await fixture(t);f.input.ports.readBinding=()=>{throw Error('DASHSCOPE_API_KEY is not set');};
 await assert.rejects(autoCompleteMissingBenchmarkLabels(f.input),error=>{
  assert.equal((error as Error).message,'user_input_required:benchmark_label_provider_unavailable');return true;
 });assert.equal(f.posts,0);
});
