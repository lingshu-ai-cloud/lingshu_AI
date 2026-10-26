import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LangGraphTestStore } from '../../scripts/langgraphTestStore.js';
import { admitContentExecutionJob, readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { runWithContentExecutionContext } from '../contentExecution/context.js';
import { runLangGraphProduction } from '../contentExecution/langgraphEngine.js';
import { VISUAL_PRESENTER_GRAPH_VERSION } from '../contentExecution/langgraphIdentity.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from './repository.js';
import { completeSocialContentGraphRun, recoverSocialContentGraphCompletions } from './socialContentGraphCompletion.js';
import { writeExecutionStage } from './socialContentProductionRuntimeSupport.js';
import { AUTO_TASK_KEY } from './socialContentAutoProduction.js';
import { socialRequestHash } from './socialContentValidation.js';
import { SOCIAL_CONTENT_CORRECTION_POLICY_VERSION, socialContentCorrectionRuntimeHash } from './socialContentProductionGraph.js';

test('single-scene correction execution and crash recovery share one versioned identity', () => {
  const grantHash = 'b'.repeat(64);
  assert.equal(SOCIAL_CONTENT_CORRECTION_POLICY_VERSION, 'bound-voice-strict-approved-intro.v4');
  assert.equal(socialContentCorrectionRuntimeHash(grantHash), socialRequestHash({
    grantHash,
    policyVersion: SOCIAL_CONTENT_CORRECTION_POLICY_VERSION,
  }));
  assert.throws(() => socialContentCorrectionRuntimeHash('untrusted-client-value'), /correction_identity_invalid/);
});

async function fixture(terminal=true){
  const folder=mkdtempSync(path.join(tmpdir(),'graph-completion-'));const store=new LangGraphTestStore(path.join(folder,'db.json'));
  const repository=createStarter198Repository(store);const inputHash='a'.repeat(64);const now=new Date().toISOString();
  const outputSha256='f'.repeat(64),fileId=`socialfile_${'a'.repeat(24)}`,resourceRef=`socialfile:${fileId}`;
  const content={productionWorkspaceSource:{type:'actual_social_render',creationMode:'material_processing',runId:'run-a',baselineHash:'b'.repeat(64),outputSha256},sourceKey:'local-render'};
  const approval={approved:true,receiptRef:'receipt-a',subjectVersion:'2',contentHash:socialRequestHash(content)};
  const checkpoints={
    'social.executor':{version:'1',inputHash,updatedAt:now,payload:{executor:'langgraph',inputHash,planVersion:'1',graphVersion:VISUAL_PRESENTER_GRAPH_VERSION}},
    'social.graph_review':{version:'1',inputHash,updatedAt:now,payload:{artifactId:'artifact-a',version:'1',contentHash:approval.contentHash,runId:'run-a'}},
  };
  const job=await admitContentExecutionJob({dataStore:store,tenantId:'tenant-a',userId:'user-a',taskId:'task-a',runId:'run-a',taskType:'social-production',initialCheckpoints:checkpoints});
  await store.update('content_execution_jobs',job.id,{status:'running'});
  await store.create(STARTER_COLLECTIONS.runs,{id:'run-a',tenant_id:'tenant-a',status:'running'});
  await store.create(STARTER_COLLECTIONS.tasks,{id:'execution-task',tenant_id:'tenant-a',run_id:'run-a',task_key:AUTO_TASK_KEY,status:'running',output:{}});
  await store.create(STARTER_COLLECTIONS.socialContentArtifacts,{id:'artifact-row',tenant_id:'tenant-a',task_id:'task-a',artifact_id:'artifact-a',origin:'agent',artifact_kind:'short_video',status:'approved',resource_ref:resourceRef,content,content_hash:socialRequestHash({resourceRef,content}),version:'2',last_operation_id:'receipt-a'});
  await store.create('starter_social_content_files',{id:'file-row',tenant_id:'tenant-a',task_id:'task-a',file_id:fileId,usage:'artifact_media',content_sha256:outputSha256,byte_size:1024});
  await store.create(STARTER_COLLECTIONS.socialContentOperations,{id:'operation-row',tenant_id:'tenant-a',operation_id:'receipt-a',idempotency_key:'receipt-a',target_id:'task-a',operation:'decide_social_content_artifact',status:'succeeded'});
  const manifest={taskId:'task-a',packageId:'package-a',artifactIds:['artifact-a']};
  await store.create(STARTER_COLLECTIONS.socialDeliveryPackages,{id:'package-row',tenant_id:'tenant-a',task_id:'task-a',package_id:'package-a',status:'ready',manifest,package_hash:socialRequestHash(manifest),artifact_ids:['artifact-a']});
  const identity={tenantId:'tenant-a',taskId:'task-a',runId:'run-a',jobId:job.id,planVersion:'1',inputHash,graphVersion:VISUAL_PRESENTER_GRAPH_VERSION} as const;
  if(terminal){
    const phase=async()=>({artifactRefs:['artifact-a'],inputHash});
    await runWithContentExecutionContext({dataStore:store,jobId:job.id,checkpoints,action:()=>runLangGraphProduction({identity,dataStore:store,assertActive:async()=>undefined,
      phases:{assets:phase,voice:phase,trim:phase,effects:phase,render:phase,technical_quality:phase,creative_quality:phase,
        delivery:async()=>({artifactRefs:['artifact-a','package-a'],inputHash})},review:{loadApproval:async()=>approval,verifyResume:async()=>false}})});
  }
  const row=await store.getById<Record<string,unknown>>('content_execution_jobs',job.id);
  await store.update('content_execution_jobs',job.id,{status:'succeeded',checkpoints:{...(row!.checkpoints as object),'social.graph_completion':{version:'1',inputHash,updatedAt:now,payload:{...identity,approval,artifactIds:['artifact-a'],packageIds:['package-a'],externalPublishPerformed:false}}}});
  const read=async()=> (await readContentExecutionJob(store,'tenant-a','task-a','run-a'))!;
  return{store,repository,read,manifest,cleanup:()=>rmSync(folder,{recursive:true,force:true})};
}
test('terminal graph plus settled queue and canonical delivery evidence completes once, recovery projects missed callback',async()=>{
  const f=await fixture();try{
    await f.store.update('content_execution_jobs',(await f.read()).id,{status:'running'});
    assert.equal(await completeSocialContentGraphRun(f.repository,await f.read()),false);
    assert.equal((await f.repository.get(STARTER_COLLECTIONS.runs,'tenant-a','run-a'))!.status,'running');
    await f.store.update('content_execution_jobs',(await f.read()).id,{status:'succeeded'});
    await recoverSocialContentGraphCompletions(f.repository);
    assert.equal((await f.repository.get(STARTER_COLLECTIONS.runs,'tenant-a','run-a'))!.status,'completed');
    const projects=await f.store.list<Record<string,unknown>>('studio_projects',{where:{tenant_id:'tenant-a'},perPage:10});
    assert.equal(projects.totalItems,1);
    const spec=projects.items[0]!.spec as Record<string,any>;
    assert.equal(spec.socialProductionWorkspace.artifactId,'artifact-a');
    assert.equal(spec.socialProductionWorkspace.sceneMappings[0].sceneId,'final-film');
    assert.equal(spec.automation.recoveredFromArtifact,true);
    assert.equal(await completeSocialContentGraphRun(f.repository,await f.read()),true);
    assert.equal((await f.store.list('studio_projects',{where:{tenant_id:'tenant-a'},perPage:10})).totalItems,1);
    const task=await f.repository.get(STARTER_COLLECTIONS.tasks,'tenant-a','execution-task');
    assert.equal(task!.status,'completed');
  }finally{f.cleanup();}
});
test('workspace output hash drift fails closed before business completion',async()=>{
  const f=await fixture();try{
    await f.store.update('starter_social_content_files','file-row',{content_sha256:'e'.repeat(64)});
    await assert.rejects(completeSocialContentGraphRun(f.repository,await f.read()),/social_workspace_output_hash_drift/);
    assert.equal((await f.repository.get(STARTER_COLLECTIONS.runs,'tenant-a','run-a'))!.status,'running');
    assert.equal((await f.store.list('studio_projects',{where:{tenant_id:'tenant-a'},perPage:10})).totalItems,0);
  }finally{f.cleanup();}
});
test('recovery scanner repairs an archived completed run left at production_workspace_pending',async()=>{
  const f=await fixture();try{
    await writeExecutionStage({repository:f.repository,tenantId:'tenant-a',runId:'run-a',stage:'production_workspace_pending',message:'workspace interrupted'});
    await f.store.update(STARTER_COLLECTIONS.runs,'run-a',{status:'completed'});
    await recoverSocialContentGraphCompletions(f.repository);
    const projects=await f.store.list('studio_projects',{where:{tenant_id:'tenant-a'},perPage:10});
    assert.equal(projects.totalItems,1);
    const task=await f.repository.get(STARTER_COLLECTIONS.tasks,'tenant-a','execution-task');
    assert.equal((task!.output as {production:{stage:string}}).production.stage,'delivery_prepared');
    assert.equal(task!.status,'completed');
    assert.equal((await f.store.list(STARTER_COLLECTIONS.socialContentArtifacts,{where:{tenant_id:'tenant-a'},perPage:10})).totalItems,1,
      'recovery must not render or archive a second artifact');
  }finally{f.cleanup();}
});
test('forged receipt without actual terminal graph cannot complete business run',async()=>{
  const f=await fixture(false);try{
    await assert.rejects(completeSocialContentGraphRun(f.repository,await f.read()),/not_terminal/);
    assert.equal((await f.repository.get(STARTER_COLLECTIONS.runs,'tenant-a','run-a'))!.status,'running');
  }finally{f.cleanup();}
});
test('manifest tampering, invalid receipt authority and cancelled run prevent completion',async()=>{
  const f=await fixture();try{
    await f.store.update(STARTER_COLLECTIONS.socialDeliveryPackages,'package-row',{manifest:{...f.manifest,artifactIds:['other']}});
    await assert.rejects(completeSocialContentGraphRun(f.repository,await f.read()),/delivery_invalid/);
    await f.store.update(STARTER_COLLECTIONS.socialDeliveryPackages,'package-row',{manifest:f.manifest});
    await f.store.update(STARTER_COLLECTIONS.socialContentOperations,'operation-row',{status:'failed'});
    await assert.rejects(completeSocialContentGraphRun(f.repository,await f.read()),/receipt_invalid/);
    await f.store.update(STARTER_COLLECTIONS.socialContentOperations,'operation-row',{status:'succeeded'});
    await f.store.update(STARTER_COLLECTIONS.runs,'run-a',{status:'cancelled'});
    assert.equal(await completeSocialContentGraphRun(f.repository,await f.read()),false);
    assert.equal((await f.store.list('studio_projects',{where:{tenant_id:'tenant-a'},perPage:10})).totalItems,0);
  }finally{f.cleanup();}
});
test('UI production graph remains nonterminal during review and handoff until explicit settled completion',async()=>{
  const f=await fixture(false);try{
    for(const stage of ['review_ready','delivery_prepared']){
      await writeExecutionStage({repository:f.repository,tenantId:'tenant-a',runId:'run-a',stage,message:'await settlement'});
      const task=await f.repository.get(STARTER_COLLECTIONS.tasks,'tenant-a','execution-task');
      const output=task!.output as {production:{productionGraph:{nodes:{nodeId:string,status:string}[],activeNode:string}}};
      assert.equal(output.production.productionGraph.nodes.find(node=>node.nodeId==='approval')!.status,'running');
      assert.equal(output.production.productionGraph.activeNode,'approval');
      assert.equal(task!.status,'running');
    }
    await writeExecutionStage({repository:f.repository,tenantId:'tenant-a',runId:'run-a',stage:'delivery_prepared',status:'completed',message:'settled'});
    const task=await f.repository.get(STARTER_COLLECTIONS.tasks,'tenant-a','execution-task');
    assert.equal((task!.output as {production:{productionGraph:{nodes:{nodeId:string,status:string}[]}}}).production.productionGraph.nodes.find(node=>node.nodeId==='approval')!.status,'completed');
  }finally{f.cleanup();}
});
