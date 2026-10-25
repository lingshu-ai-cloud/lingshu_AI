import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { admitContentExecutionJob } from '../contentExecution/durableQueue.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { assertCurrentGraphReviewSubject, createSocialProductionExecutorCheckpoint, socialProductionExecutor, socialProductionGraphInput, loadSocialProductionGraphApproval, resumeApprovedSocialProductionGraph, socialGraphPhaseCheckpointEvidence } from './socialContentProductionGraph.js';
import { socialRequestHash } from './socialContentValidation.js';

type Detail = Parameters<typeof socialProductionGraphInput>[0];
test('restored graph review cannot attach an older checkpoint to changed film bytes or version', () => {
  const sha = 'a'.repeat(64);
  const content = { workflowSchema: 'social-content.auto-production.v3', productionWorkspaceSource: { runId: 'run-a', outputSha256: sha } };
  const artifact = { artifact_id: 'artifact-a', version: '1', content } as any;
  const checkpoint = { version: '1', inputHash: 'graph', updatedAt: new Date().toISOString(), payload: {
    runId: 'run-a', artifactId: 'artifact-a', version: '1', contentHash: socialRequestHash(content), outputSha256: sha,
  } };
  assert.doesNotThrow(() => assertCurrentGraphReviewSubject(checkpoint, artifact, 'run-a'));
  assert.doesNotThrow(() => assertCurrentGraphReviewSubject(checkpoint, { ...artifact, version: '2' }, 'run-a', true));
  for (const changed of [
    { ...checkpoint, payload: { ...checkpoint.payload, outputSha256: 'b'.repeat(64) } },
    { ...checkpoint, payload: { ...checkpoint.payload, contentHash: 'b'.repeat(64) } },
    { ...checkpoint, payload: { ...checkpoint.payload, artifactId: 'other' } },
  ]) assert.throws(() => assertCurrentGraphReviewSubject(changed, artifact, 'run-a'), /graph_review_subject_changed/);
  assert.throws(() => assertCurrentGraphReviewSubject(checkpoint, { ...artifact, version: '2' }, 'run-a'), /graph_review_subject_changed/);
  assert.throws(() => assertCurrentGraphReviewSubject(checkpoint, artifact, 'run-b'), /graph_review_subject_changed/);
});
function detail(): Detail {
  return { version:'1', brief:{productionApproach:'automatic',title:'same'},sources:[],assetSupplyPlan:null,
    agentWorkflow:{ directorBrief:{version:'1',goal:'sell'},executionPlan:{version:'1',directorBriefVersion:'1',scenes:[{id:'scene',idempotencyKey:'derived1',candidates:[{provenance:{inputVersion:'1'},prompt:'original'}]}]},
      executionPlanReview:{version:'1',executionPlanVersion:'1',directorBriefVersion:'1',reviewId:'derived1',status:'approved'},productionResult:null,replicationEvaluation:null } } as unknown as Detail;
}
test('admission binds graph or legacy once, rejects damaged bindings',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'graph-domain-'));const dataStore=new LangGraphTestStore(path.join(folder,'db.json'));
  try {
    const first=createSocialProductionExecutorCheckpoint(detail(),{SOCIAL_CONTENT_EXECUTOR:'langgraph'});
    const args={dataStore,tenantId:'tenant-a',userId:'user-a',taskId:'task-a',runId:'run-a',taskType:'social-production'};
    const job=await admitContentExecutionJob({...args,initialCheckpoints:{'social.executor':first}});
    assert.equal(socialProductionExecutor(job),'langgraph');
    const replay=await admitContentExecutionJob({...args,initialCheckpoints:{'social.executor':createSocialProductionExecutorCheckpoint(detail(),{})}});
    assert.equal(socialProductionExecutor(replay),'langgraph');
    assert.equal(socialProductionExecutor({...job,checkpoints:{}}),'legacy');
    assert.throws(()=>socialProductionExecutor({...job,checkpoints:{}},{'social.executor':null}),/binding_invalid/);
    assert.throws(()=>socialProductionExecutor({...job,checkpoints:{'social.executor':{...first,inputHash:'tampered'}}}),/binding_invalid/);
    assert.throws(()=>socialProductionExecutor({...job,checkpoints:{'langgraph.v1':first}}),/binding_invalid/);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
test('new producing tasks default to LangGraph while frozen legacy and shooting-plan boundaries remain explicit',()=>{
  const weekly={...detail(),mode:'weekly' as const};
  assert.equal(createSocialProductionExecutorCheckpoint(weekly,{}).payload.executor,'langgraph');
  assert.equal(createSocialProductionExecutorCheckpoint(weekly,{SOCIAL_CONTENT_EXECUTOR:'legacy'}).payload.executor,'langgraph');
  const shooting={...detail(),mode:'weekly' as const};shooting.brief={...shooting.brief,productionApproach:'shooting_plan'} as typeof shooting.brief;
  assert.equal(createSocialProductionExecutorCheckpoint(shooting,{SOCIAL_CONTENT_EXECUTOR:'langgraph'}).payload.executor,'legacy');
  assert.equal(createSocialProductionExecutorCheckpoint({...detail(),mode:'instant' as const},{}).payload.executor,'langgraph');
  assert.equal(createSocialProductionExecutorCheckpoint({...detail(),mode:'instant' as const},{SOCIAL_CONTENT_EXECUTOR:'legacy'}).payload.executor,'legacy');
});
test('graph phases require their persisted domain checkpoint and render exports its actual sha256',()=>{
 const digest='a'.repeat(64),upstream='b'.repeat(64),base={version:'1',inputHash:'c'.repeat(64),updatedAt:new Date().toISOString()};
 const checkpoints:any={
  'social.asset_supply':{...base,payload:{assetSupplyExecution:{schemaVersion:'social-content.asset-supply-execution.v1',planVersion:'1',creationMode:'instant',productionRoute:'auto',managementMode:'managed',executedAt:new Date().toISOString(),shots:[{shotId:'shot',sceneId:'scene',assetId:'asset',providerId:'local',sourceStrategy:'owned_exact_local_video'}]},selectedAssets:[{assetId:'asset',sourceId:'source'}]}},
  'social.graph_source_assets':{...base,payload:{phase:'source_assets',planHash:digest,assetSupplyExecution:{schemaVersion:'social-content.asset-supply-execution.v1',planVersion:'1',creationMode:'instant',productionRoute:'auto',managementMode:'managed',executedAt:new Date().toISOString(),shots:[{shotId:'shot',sceneId:'scene',assetId:'asset',providerId:'local',sourceStrategy:'owned_exact_local_video'}]},selectedAssets:[{assetId:'asset',sourceId:'source'}]}},
  'social.graph_voice':{...base,payload:{outputSha256:digest,narrationCheckpointInputHash:upstream,durationSeconds:3,cueCount:1}},
  'social.graph_presenter_assets':{...base,payload:{phase:'presenter_assets',planHash:digest,assetSupplyExecution:{schemaVersion:'social-content.asset-supply-execution.v1',planVersion:'1',creationMode:'instant',productionRoute:'auto',managementMode:'managed',executedAt:new Date().toISOString(),shots:[]},selectedAssets:[]}},
  'social.graph_trim':{...base,payload:{timelineHash:digest,directorPlanHash:upstream,voiceOutputSha256:digest,sceneCount:1,durationSeconds:3}},
  'social.graph_effects':{...base,payload:{manifestHash:digest,effectPlanHash:upstream,subtitleCueHash:digest,trimCheckpointInputHash:upstream,sceneCount:1}},
  'social.graph_render':{...base,version:'2',payload:{sha256:digest,inputHash:base.inputHash,cachePath:'/private/render.mp4'}},
  'social.graph_technical_quality':{...base,payload:{outputSha256:digest,renderCheckpointInputHash:upstream,manifestHash:digest,policyVersion:'technical.v1',reportHash:upstream,approved:true,failureCount:0,failures:[]}},
 };
 const phaseStages={assets:'social.asset_supply',voice:'social.graph_voice',trim:'social.graph_trim',effects:'social.graph_effects',
  render:'social.graph_render',technical_quality:'social.graph_technical_quality'} as const;
 for(const phase of ['assets','voice','trim','effects','render','technical_quality'] as const){
  const evidence=socialGraphPhaseCheckpointEvidence({checkpoints},phase);
  assert.equal(evidence.inputHash,base.inputHash);
  assert.equal(evidence.metadata.checkpointStage,phaseStages[phase]);
 }
 assert.equal(socialGraphPhaseCheckpointEvidence({checkpoints},'render').metadata.outputSha256,digest);
 assert.equal((socialGraphPhaseCheckpointEvidence({checkpoints},'source_assets').metadata as {planHash?:unknown}).planHash,digest);
 assert.equal((socialGraphPhaseCheckpointEvidence({checkpoints},'presenter_assets').metadata as {phase?:unknown}).phase,'presenter_assets');
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{}},'render'),/graph_phase_checkpoint_missing:render/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_render':{...checkpoints['social.graph_render'],payload:{outputSha256:digest}}}},'render'),/graph_phase_checkpoint_missing:render/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_render':{...checkpoints['social.graph_render'],payload:{sha256:'bad'}}}},'render'),/graph_phase_checkpoint_invalid:render/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.asset_supply':{...base,payload:{assetSupplyExecution:{},selectedAssets:[]}}}},'assets'),/graph_phase_checkpoint_invalid:assets/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_source_assets':{...base,payload:{...checkpoints['social.graph_source_assets'].payload,planHash:'bad'}}}},'source_assets'),/graph_phase_checkpoint_invalid:source_assets/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_presenter_assets':{...base,payload:{...checkpoints['social.graph_presenter_assets'].payload,phase:'source_assets'}}}},'presenter_assets'),/graph_phase_checkpoint_invalid:presenter_assets/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_trim':{...checkpoints['social.graph_trim'],payload:{...checkpoints['social.graph_trim'].payload,timelineHash:'short'}}}},'trim'),/graph_phase_checkpoint_invalid:trim/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_effects':{...checkpoints['social.graph_effects'],payload:{...checkpoints['social.graph_effects'].payload,trimCheckpointInputHash:'short'}}}},'effects'),/graph_phase_checkpoint_invalid:effects/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_render':{...checkpoints['social.graph_render'],payload:{...checkpoints['social.graph_render'].payload,inputHash:upstream}}}},'render'),/graph_phase_checkpoint_invalid:render/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_technical_quality':{...checkpoints['social.graph_technical_quality'],payload:{...checkpoints['social.graph_technical_quality'].payload,approved:false,failureCount:1,failures:['decode_failed']}}}},'technical_quality'),/graph_phase_checkpoint_failed:technical_quality/);
 assert.throws(()=>socialGraphPhaseCheckpointEvidence({checkpoints:{...checkpoints,'social.graph_technical_quality':{...checkpoints['social.graph_technical_quality'],payload:{...checkpoints['social.graph_technical_quality'].payload,manifestHash:'bad'}}}},'technical_quality'),/graph_phase_checkpoint_invalid:technical_quality/);
});
test('frozen hash tolerates derived projection versions but rejects human plan/director/review edits',()=>{
  const original=detail();const binding=createSocialProductionExecutorCheckpoint(original,{SOCIAL_CONTENT_EXECUTOR:'langgraph'});
  const frozen=binding.payload.approvedContext!;
  const projected=structuredClone(original);projected.version='9';
  projected.agentWorkflow!.executionPlan.version='9';projected.agentWorkflow!.directorBrief.version='9';
  projected.agentWorkflow!.executionPlanReview.version='9';
  const director=projected.agentWorkflow!.directorBrief as any;
  if(director.replicationJobRef){director.replicationJobRef.version='9';director.replicationJobRef.factorSpecVersion='9';}
  for(const scene of director.scenes||[])for(const factor of scene.replicationFactors||[])factor.factorSpecVersion='9';
  assert.equal(socialProductionGraphInput(projected,frozen).inputHash,binding.inputHash);
  for(const section of ['executionPlan','directorBrief','executionPlanReview'] as const){
    const edited=structuredClone(original);
    Object.assign(edited.agentWorkflow![section],{humanChange:'new authority'});
    assert.throws(()=>socialProductionGraphInput(edited,frozen),/graph_production_plan_changed/);
  }
  const brief=structuredClone(original);Object.assign(brief.brief,{title:'changed'});
  assert.notEqual(socialProductionGraphInput(brief,frozen).inputHash,binding.inputHash);
});

test('approval requires exact artifact version/hash and successful individual or batch receipt; changes requested grants nothing',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'graph-approval-'));const store=new LangGraphTestStore(path.join(folder,'db.json'));
  try{
    const repository=createStarter198Repository(store);
    const content={productionWorkspaceSource:{runId:'run-a'},sourceKey:'local-render',videoUrl:'asset-ref'};
    const job=await admitContentExecutionJob({dataStore:store,tenantId:'tenant-a',userId:'user-a',taskId:'task-a',runId:'run-a',taskType:'social-production',
      initialCheckpoints:{'social.executor':createSocialProductionExecutorCheckpoint(detail(),{SOCIAL_CONTENT_EXECUTOR:'langgraph'}),'social.graph_review':{version:'1',inputHash:'review',updatedAt:new Date().toISOString(),payload:{artifactId:'artifact-a',version:'1',contentHash:socialRequestHash(content),runId:'run-a',waitingReview:true}}}});
    await store.create(STARTER_COLLECTIONS.socialContentArtifacts,{id:'artifact-row',tenant_id:'tenant-a',task_id:'task-a',artifact_id:'artifact-a',origin:'agent',artifact_kind:'short_video',status:'approved',content,version:'2',last_operation_id:'receipt-a'});
    await store.create(STARTER_COLLECTIONS.socialContentOperations,{id:'operation-row',tenant_id:'tenant-a',operation_id:'receipt-a',idempotency_key:'receipt-a',target_id:'task-a',operation:'decide_social_content_artifact',status:'succeeded'});
    assert.equal((await loadSocialProductionGraphApproval(repository,job))?.receiptRef,'receipt-a');
    await store.update(STARTER_COLLECTIONS.socialContentOperations,'operation-row',{operation:'decide_social_content_artifact_batch'});
    assert.equal((await loadSocialProductionGraphApproval(repository,job))?.approved,true);
    await store.update(STARTER_COLLECTIONS.socialContentOperations,'operation-row',{target_id:'other-task'});
    await assert.rejects(loadSocialProductionGraphApproval(repository,job),/receipt_invalid/);
    await store.update(STARTER_COLLECTIONS.socialContentOperations,'operation-row',{target_id:'task-a'});
    await store.update(STARTER_COLLECTIONS.socialContentArtifacts,'artifact-row',{version:'3'});
    await assert.rejects(loadSocialProductionGraphApproval(repository,job),/version_changed/);
    await store.update(STARTER_COLLECTIONS.socialContentArtifacts,'artifact-row',{version:'2',content:{...content,edited:true}});
    await assert.rejects(loadSocialProductionGraphApproval(repository,job),/subject_changed/);
    await store.update(STARTER_COLLECTIONS.socialContentArtifacts,'artifact-row',{status:'changes_requested',content});
    await assert.rejects(loadSocialProductionGraphApproval(repository,job),/artifact_not_unique/);
    await store.update('content_execution_jobs',job.id,{status:'paused',checkpoints:{...job.checkpoints,'runtime.pause':{version:'1',inputHash:'pause',updatedAt:new Date().toISOString(),payload:{origin:'workflow_review'}}}});
    await assert.rejects(resumeApprovedSocialProductionGraph({repository,tenantId:'tenant-a',userId:'user-a',taskId:'task-a',artifactId:'artifact-a'}),/artifact_not_unique/);
    assert.equal((await store.getById<Record<string,unknown>>('content_execution_jobs',job.id))!.status,'paused');
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('legacy review checkpoint and human approval cannot release an auto film with failed hard QA',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'graph-failed-qa-'));const store=new LangGraphTestStore(path.join(folder,'db.json'));
  try{
    const repository=createStarter198Repository(store);
    const content={workflowSchema:'social-content.auto-production.v3',productionWorkspaceSource:{type:'actual_social_render',runId:'run-a',outputSha256:'a'.repeat(64)},productionResult:{technicalReview:{approved:false,failures:['decode_failed']}}};
    const job=await admitContentExecutionJob({dataStore:store,tenantId:'tenant-a',userId:'user-a',taskId:'task-a',runId:'run-a',taskType:'social-production',
      initialCheckpoints:{'social.executor':createSocialProductionExecutorCheckpoint(detail(),{SOCIAL_CONTENT_EXECUTOR:'langgraph'}),'social.graph_review':{version:'1',inputHash:'review',updatedAt:new Date().toISOString(),payload:{artifactId:'artifact-a',version:'1',contentHash:socialRequestHash(content),runId:'run-a',waitingReview:true}}}});
    await store.create(STARTER_COLLECTIONS.socialContentArtifacts,{id:'artifact-row',tenant_id:'tenant-a',task_id:'task-a',artifact_id:'artifact-a',origin:'agent',artifact_kind:'short_video',status:'approved',content,version:'2',last_operation_id:'receipt-a'});
    await store.create(STARTER_COLLECTIONS.socialContentOperations,{id:'operation-row',tenant_id:'tenant-a',operation_id:'receipt-a',idempotency_key:'receipt-a',target_id:'task-a',operation:'decide_social_content_artifact',status:'succeeded'});
    await assert.rejects(loadSocialProductionGraphApproval(repository,job),/social_graph_quality_failed/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('corrected execution context requires exact grant, parent plan and persisted context',async()=>{
 const {matchesAuthorizedCorrectionContext}=await import('./socialContentProductionGraph.js');
 const parent=createSocialProductionExecutorCheckpoint(detail(),{SOCIAL_CONTENT_EXECUTOR:'langgraph'});
 const context=structuredClone(parent.payload.approvedContext!);context.version='2';
 const grantHash='d'.repeat(64);
 const job={checkpoints:{'social.executor':parent,'social.corrected_executor':{inputHash:grantHash,payload:{originalInputHash:parent.inputHash,originalApprovedContextHash:socialRequestHash(parent.payload.approvedContext),approvedContext:context}}}} as any;
 assert.equal(matchesAuthorizedCorrectionContext(job,context,parent.inputHash,grantHash),true);
 assert.equal(matchesAuthorizedCorrectionContext(job,context,parent.inputHash,'e'.repeat(64)),false);
 assert.equal(matchesAuthorizedCorrectionContext(job,context,'f'.repeat(64),grantHash),false);
 assert.equal(matchesAuthorizedCorrectionContext(job,{...context,version:'3'},parent.inputHash,grantHash),false);
});


test('a weekly artifact paused at review cannot bypass missing cache finalization',async()=>{
 const row={origin:'agent',artifact_kind:'short_video',status:'review_required',artifact_id:'artifact',
   content:{productionWorkspaceSource:{runId:'run'},initialSceneCacheInput:{schemaVersion:'initial-scene-cache-input.v1'}}};
 const repository={list:async(collection:string)=>({items:collection===STARTER_COLLECTIONS.socialContentArtifacts?[row]:[],totalItems:collection===STARTER_COLLECTIONS.socialContentArtifacts?1:0}),
   dataStore:{list:async()=>({items:[],totalItems:0,totalPages:0,page:1,perPage:2})}} as any;
 await assert.rejects(loadSocialProductionGraphApproval(repository,{tenantId:'t',taskId:'content',runId:'run',taskType:'social_content_weekly',checkpoints:{}} as any),/weekly_scene_cache_finalization_required/);
});
