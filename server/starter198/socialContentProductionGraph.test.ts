import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { admitContentExecutionJob } from '../contentExecution/durableQueue.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { createSocialProductionExecutorCheckpoint, socialProductionExecutor, socialProductionGraphInput, loadSocialProductionGraphApproval, resumeApprovedSocialProductionGraph } from './socialContentProductionGraph.js';
import { socialRequestHash } from './socialContentValidation.js';

type Detail = Parameters<typeof socialProductionGraphInput>[0];
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
