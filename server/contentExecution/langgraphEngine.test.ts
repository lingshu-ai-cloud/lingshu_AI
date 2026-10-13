import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { runWithContentExecutionContext } from './context.js';
import { runLangGraphProduction, type GraphApproval, type LangGraphProductionInput } from './langgraphEngine.js';
import type { ContentGraphCheckpointDocument } from './langgraphCheckpoint.js';
import { CONTENT_GRAPH_VERSION, type ProductionGraphIdentity } from './langgraphIdentity.js';

const identity: ProductionGraphIdentity = {tenantId:'tenant-a',taskId:'task-a',runId:'run-a',jobId:'job-a',planVersion:'1',inputHash:'input-a',graphVersion:CONTENT_GRAPH_VERSION};
function fixture() {
  const job: Record<string,unknown> = {id:'job-a',tenant_id:'tenant-a',task_id:'task-a',run_id:'run-a',worker_id:'worker-a',attempt:1,status:'running',checkpoints:{},provider_receipts:[]};
  let active = true;
  const dataStore = {
    getById: async (_collection:string,id:string) => id===job.id ? structuredClone(job) : null,
    update: async (_collection:string,id:string,patch:Record<string,unknown>) => {if(id!==job.id)return false;Object.assign(job,structuredClone(patch));return true;},
  } as unknown as DataStore;
  const assertActive = async()=>{if(!active)throw Error('lease_lost');};
  const counts = {assets:0,render:0,quality:0,delivery:0};
  let approval:GraphApproval|null=null;
  const makePhase = (name: keyof typeof counts) => async () => {
    counts[name]++;
    return {artifactRefs:[`phase:${name}`],inputHash:'input-a'};
  };
  const phases = { assets:makePhase('assets'),render:makePhase('render'),quality:makePhase('quality'),delivery:makePhase('delivery') };
  const input:LangGraphProductionInput={identity,dataStore,assertActive,phases,review:{loadApproval:async()=>approval,verifyResume:async token=>token==='canonical-receipt'&&approval?.approved===true}};
  const run = (resume?:unknown)=>runWithContentExecutionContext({dataStore,jobId:'job-a',checkpoints:job.checkpoints,providerReceipts:job.provider_receipts,expectedWorkerId:'worker-a',expectedAttempt:1,executionStillOwned:()=>active,action:()=>runLangGraphProduction({...input,...(resume===undefined?{}:{resume})})});
  return {job,dataStore,counts,input,run,setApproval:()=>{approval={approved:true,receiptRef:'canonical-receipt',subjectVersion:'1',contentHash:'artifact-hash'};},loseLease:()=>{active=false;}};
}
test('actual graph persists interrupt and resumes with a new saver without rerunning finished phases',async()=>{
  const f=fixture();
  const waiting=await f.run();
  assert.equal(waiting.status,'waiting_review');assert.ok(waiting.interrupts.length);assert.equal(waiting.state.completed,false);
  assert.deepEqual(f.counts,{assets:1,render:1,quality:1,delivery:0});
  await assert.rejects(f.run({approved:true}),/resume_not_authorized/);
  f.setApproval();
  const done=await f.run('canonical-receipt');
  assert.equal(done.status,'completed');assert.deepEqual(f.counts,{assets:1,render:1,quality:1,delivery:1});
  await f.run();await f.run('canonical-receipt');assert.equal(f.counts.delivery,1,'completed invocation reuses stored terminal state');
});
test('failure keeps completed stage writes and resumes only failed work',async()=>{
  const f=fixture();let fail=true;
  const original=f.input.phases.render;
  f.input.phases.render=async state=>{if(fail)throw Error('controlled-render-failure');return original(state);};
  await assert.rejects(f.run(),/controlled-render-failure/);assert.equal(f.counts.assets,1);
  const failed=(f.job.checkpoints as any)['langgraph.node.render'];
  assert.equal(failed.version,'1');assert.equal(failed.payload.status,'failed');assert.equal(failed.payload.attempt,1);
  assert.equal(failed.payload.failureCode,'controlled-render-failure');assert.equal(failed.payload.failureReason,'controlled-render-failure');
  assert.ok(failed.payload.startedAt);assert.ok(failed.payload.endedAt);assert.ok(failed.payload.durationMs>=0);
  fail=false;await f.run();assert.equal(f.counts.assets,1);assert.equal(f.counts.render,1);
  const recovered=(f.job.checkpoints as any)['langgraph.node.render'].payload;
  assert.equal(recovered.status,'completed');assert.equal(recovered.attempt,2);assert.equal(recovered.failureReason,null);
});
test('node evidence persists output, provider receipts and cost without full provider payloads',async()=>{
  const f=fixture();
  f.job.provider_receipts=[{provider:'seedance',requestId:'visual-request',state:'completed',providerTaskId:'provider-task',metadata:{reservedCny:1.25,actualCostCny:1.1},firstRecordedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
  f.input.phases.assets=async()=>{
    return {artifactRefs:['asset'],inputHash:'input-a',metadata:{outputSha256:'a'.repeat(64),providerReceiptRefs:['receipt:file'],reservedCny:1.25,actualCostCny:1.1}};
  };
  await f.run();
  const value=(f.job.checkpoints as any)['langgraph.node.assets'].payload;
  assert.equal(value.status,'completed');assert.equal(value.attempt,1);assert.equal(value.outputSha256,'a'.repeat(64));
  assert.deepEqual(value.providerReceiptRefs,['receipt:file','seedance:visual-request']);
  assert.equal(value.reservedCny,1.25);assert.equal(value.actualCostCny,1.1);
  assert.equal(JSON.stringify(value).includes('provider-task'),false);
});
test('node evidence rejects malformed output hashes and negative cost',async()=>{
  for (const metadata of [{outputSha256:'not-a-sha'}, {reservedCny:-1}, {actualCostCny:-1}]) {
    const f=fixture();f.input.phases.assets=async()=>({artifactRefs:['asset'],inputHash:'input-a',metadata});
    await assert.rejects(f.run(),/content_graph_phase_metadata_invalid/);
    const value=(f.job.checkpoints as any)['langgraph.node.assets'].payload;
    assert.equal(value.status,'failed');assert.equal(value.failureCode,'content_graph_phase_metadata_invalid');
  }
});
test('tenant/version mismatch and lost lease reject before side effects',async()=>{
  const f=fixture();await f.run();
  await assert.rejects(runWithContentExecutionContext({dataStore:f.dataStore,jobId:'job-a',checkpoints:f.job.checkpoints,action:()=>runLangGraphProduction({...f.input,identity:{...identity,tenantId:'tenant-b'}})}),/scope_mismatch/);
  await assert.rejects(runWithContentExecutionContext({dataStore:f.dataStore,jobId:'job-a',checkpoints:f.job.checkpoints,action:()=>runLangGraphProduction({...f.input,identity:{...identity,planVersion:'2'}})}),/checkpoint_version_changed/);
  f.loseLease();await assert.rejects(f.run(),/lease_lost|content_execution_stopped/);assert.equal(f.counts.delivery,0);
});
test('missing durable context never silently becomes an in-memory production saver',async()=>{
  const f=fixture();await assert.rejects(runLangGraphProduction(f.input),/content_graph_job_context_required/);assert.equal(f.counts.assets,0);
});

test('sync durability stops before next phase when checkpoint persistence fails',async()=>{
  for (const failAfterAssets of [false,true]) {
    const f=fixture();let stored:ContentGraphCheckpointDocument|null=null;
    const checkpointPort={read:async()=>structuredClone(stored),assertActive:f.input.assertActive,
      write:async(document:ContentGraphCheckpointDocument)=>{
        if(!failAfterAssets || f.counts.assets>0)throw Error('controlled-checkpoint-write-failure');
        stored=structuredClone(document);
      }};
    await assert.rejects(runLangGraphProduction({...f.input,checkpointPort}),/controlled-checkpoint-write-failure/);
    assert.equal(f.counts.assets,failAfterAssets?1:0);assert.equal(f.counts.render,0);
  }
});
test('corrupt stored checkpoint is rejected instead of silently starting paid work again',async()=>{
  const f=fixture();f.job.checkpoints={'langgraph.v1':{version:'bad'}};
  await assert.rejects(f.run(),/checkpoint_corrupt/);assert.equal(f.counts.assets,0);
});
