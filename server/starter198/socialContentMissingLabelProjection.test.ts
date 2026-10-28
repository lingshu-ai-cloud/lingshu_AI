import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {STARTER_198_CAPABILITIES} from '../../shared/contracts/starter198.js';
import {STARTER_198_DEFAULT_LIMITS} from './provisioning.js';
import {createSocialContentTask} from './socialContentTasks.js';
import {parseCreateSocialTask,socialRequestHash} from './socialContentValidation.js';
import {readSocialTaskDetail,requireSocialTask} from './socialContentRecords.js';
import {createSocialAssetSupplyPlan} from '../../shared/socialContentAssetSupply.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import {admitSocialContentProduction} from './socialContentProductionAdmission.js';
import type {MissingLabelOverlay} from './socialContentMissingLabelCompletion.js';

test('actual records reader rebuilds v3 routes from runtime labels despite frozen unknown script fields',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'label-records-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new LangGraphTestStore(path.join(root,'store.json')),repository={...createStarter198Repository(store),materialLibrary:async()=>({status:'available',items:[]}) as any};
 const now=new Date();
 await store.create(STARTER_COLLECTIONS.access,{tenant_id:'tenant',product_profile:'starter_198',profile_version:'starter_198.v1',entitlement_snapshot_id:'test',feature_entitlements:STARTER_198_CAPABILITIES.map(capability=>({capability,enabled:true})),resource_limits:STARTER_198_DEFAULT_LIMITS,status:'active',cycle_started_at:new Date(now.getTime()-86400000).toISOString(),cycle_ends_at:new Date(now.getTime()+86400000).toISOString()});
 const task=await createSocialContentTask({repository,tenantId:'tenant',userId:'owner',idempotencyKey:'create-label-records',value:parseCreateSocialTask({title:'主题复刻',objective:'标签补齐',mode:'instant',themeId:'customization_process',productionApproach:'ai_enhanced'})});
 const input={repository,tenantId:'tenant',taskId:task.taskId};
 const row=await requireSocialTask(input);
 const unknown=createSocialAssetSupplyPlan({creationMode:'viral_replication',materialRoutingPolicyVersion:'type-aware.v3',shots:[{shotId:'slot',function:'hook',materialType:'unknown'}]}).shots[0]!;
 const reference={analysisId:'reference',version:'1',referenceSourceId:'source',referenceRecordId:'record',status:'blocked',rightsNotice:'已授权分析',createdAt:now.toISOString(),hookAnalysis:null,
  shots:[{shotId:'ref',startSeconds:0,endSeconds:3,visualDescription:'工厂生产线正在运转',materialType:'unknown',spokenText:'工厂介绍',purpose:'hook',rhythmDescription:'快',fidelityPoints:[],mustDifferPoints:[],tags:{sceneTypes:[],subjects:[],subjectRelations:[],cameraLanguage:[],contentFunctions:['hook'],soundTypes:[],onScreenInformation:[],truthRequirements:[],suggestedProductionMethods:[]}}]};
 const script={version:'1',referenceAnalysisId:'reference',status:'draft',primaryHookId:'hook1',hookOptions:[{hookId:'hook1'},{hookId:'hook2'},{hookId:'hook3'}],structureFidelitySummary:'保留结构',originalityDifferenceSummary:'替换品牌',createdAt:now.toISOString(),
  shots:[{shotId:'slot',referenceShotId:'ref',startSeconds:0,endSeconds:3,purpose:'hook',fidelityPoints:[],spokenText:'工厂介绍',narration:'工厂介绍',captionText:'工厂介绍',visualInstruction:'工厂生产线正在运转',materialPlan:unknown}]};
 await store.update(STARTER_COLLECTIONS.socialContentTasks,row.id,{run_id:'run',reference_video_analysis:reference,replication_script:script});
 const original=await readSocialTaskDetail(input);assert.equal(original!.assetSupplyPlan!.shots[0]!.materialRouting!.materialType,'unknown');
 for(const materialType of ['factory','talking_head'] as const){
  const overlay:MissingLabelOverlay={schemaVersion:'social-benchmark-label-completion.v1',tenantId:'tenant',taskId:task.taskId,runId:'run',planHash:'a'.repeat(64),
   sourceIdentity:{recordId:'record',sourceContentSha256:'b'.repeat(64),analysisRunId:'analysis',referenceAnalysisId:'reference',referenceAnalysisVersion:'1',slots:[{shotId:'slot',referenceShotId:'ref',observationHash:'c'.repeat(64)}]},
   labels:[{shotId:'slot',referenceShotId:'ref',materialType,classificationEvidence:'工厂生产线'}],operationId:'operation',requestHash:'d'.repeat(64),recordHash:''};
  overlay.recordHash=socialRequestHash({...overlay,recordHash:''});
  const derived=await readSocialTaskDetail({...input,missingLabelOverlay:overlay}),shot=derived!.assetSupplyPlan!.shots[0]!;
  assert.equal(shot.materialRouting!.materialType,materialType);
  assert.equal(shot.materialRouting!.pendingReason,materialType==='factory'?'awaiting_theme_material':'awaiting_shoot');
  assert.deepEqual(derived!.replicationScript,original!.replicationScript);
  assert.equal(derived!.referenceVideoAnalysis!.analysisId,original!.referenceVideoAnalysis!.analysisId);
 }
 assert.deepEqual((await requireSocialTask(input)).reference_video_analysis,reference);
 // Exercise the actual production consumer, including its durable completion
 // checkpoint, without a supplier or a render. A recovered label must reach
 // the *theme supply* block, rather than repeat the label block.
 const exact={analysisMode:'exact',analysisRunId:'original-analysis',contentSha256:'b'.repeat(64)};
 const record={id:'record',tenantId:'tenant',sourceUrl:'https://example.com/source',aiAnalysis:JSON.stringify(exact)};
 const source={source_id:'source',tenant_id:'tenant',task_id:task.taskId,source_kind:'reference_link',source_ref:record.sourceUrl,status:'active',label:'对标',created_at:now.toISOString()};
 await store.create('trend_videos',record);await store.create(STARTER_COLLECTIONS.socialTaskSources,source);
 const ref=structuredClone(reference);
 const version=socialRequestHash({recordId:record.id,analysis:record.aiAnalysis,shotReview:undefined,verifiedSpeech:undefined}).slice(0,12);
 ref.analysisId=`reference-analysis-${socialRequestHash({sourceId:'source',sourceRef:record.sourceUrl,recordId:record.id,analysis:record.aiAnalysis,shotReview:undefined,verifiedSpeech:undefined}).slice(0,20)}`;
 ref.version=version;
 const scripted={...script,referenceAnalysisId:ref.analysisId};
 await store.update(STARTER_COLLECTIONS.socialContentTasks,row.id,{source_count:1,brief:{...task.brief,referenceReuse:{recordId:record.id,contentSha256:exact.contentSha256,analysisId:exact.analysisRunId,analysisHash:socialRequestHash(exact)}},reference_video_analysis:ref,replication_script:scripted});
 await store.create('content_execution_jobs',{id:'job',tenant_id:'tenant',task_id:task.taskId,run_id:'run',job_key:'job',user_id:'owner',account_id:'account',task_type:'social_content_test',status:'running',checkpoints:{},provider_receipts:[],created_at:now.toISOString(),updated_at:now.toISOString()});
 await store.create('workflow_runs',{id:'run',tenant_id:'tenant',status:'running'});
 let posts=0;
 await assert.rejects(runWithContentExecutionContext({dataStore:store,jobId:'job',checkpoints:{},action:()=>admitSocialContentProduction({...input,runId:'run',userId:'owner',runtime:{benchmarkLabelCompletionPorts:{ledgerRoot:path.join(root,'budget'),
  readBinding:()=>({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256:'c'.repeat(64),materialModel:'qwen3-vl-plus',imageModel:'qwen3-vl-plus'}),
  readTariff:async(intent:any)=>({provider:intent.provider,model:intent.model,stage:intent.stage,accountRef:intent.accountRef,currency:'CNY' as const,verifiedAccountPrice:true,evidenceRef:'test-price',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:'2099-01-01',meters:{inputTokens:{priceCny:1,unitsPerPrice:260096,minimumUnits:0,increment:1},outputTokens:{priceCny:0,unitsPerPrice:1,minimumUnits:0,increment:1}}}),
  send:async()=>{posts++;return {choices:[{message:{content:JSON.stringify({shots:[{index:1,materialType:'factory',classificationEvidence:'工厂生产线',needsReview:false}]})}}]};},persistProviderReceipt:async()=> 'fixture-receipt'}}})}),/initial_material_supply:slot/);
 assert.equal(posts,1);
 const job=await store.getById<any>('content_execution_jobs','job');
 assert.equal(job.checkpoints['social.benchmark_label_completion'].payload.labels[0].materialType,'factory');
 assert.equal(job.checkpoints['social.initial_material_block'].payload.pending[0].materialType,'factory');
 assert.equal(job.checkpoints['social.initial_material_block'].payload.pending[0].reason,'awaiting_theme_material');
 assert.deepEqual((await requireSocialTask(input)).reference_video_analysis,ref);
});
