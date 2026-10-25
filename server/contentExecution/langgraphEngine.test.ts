import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { runWithContentExecutionContext } from './context.js';
import { productionGraphNodeChainIdentity, runLangGraphProduction, type GraphApproval, type LangGraphProductionInput } from './langgraphEngine.js';
import type { ContentGraphCheckpointDocument } from './langgraphCheckpoint.js';
import { BACKGROUND_FIRST_GRAPH_VERSION, CONTENT_GRAPH_VERSION, LEGACY_CONTENT_GRAPH_VERSION, PREVIOUS_CONTENT_GRAPH_VERSION,
  VISUAL_PRESENTER_GRAPH_VERSION, graphIdentityHash, type ProductionGraphIdentity } from './langgraphIdentity.js';

const identity: ProductionGraphIdentity = {tenantId:'tenant-a',taskId:'task-a',runId:'run-a',jobId:'job-a',planVersion:'1',inputHash:'input-a',graphVersion:VISUAL_PRESENTER_GRAPH_VERSION};
function fixture() {
  const job: Record<string,unknown> = {id:'job-a',tenant_id:'tenant-a',task_id:'task-a',run_id:'run-a',worker_id:'worker-a',attempt:1,status:'running',checkpoints:{},provider_receipts:[]};
  let active = true;
  const dataStore = {
    supportsAtomicCompareAndSwap: () => true,
    getById: async (_collection:string,id:string) => id===job.id ? structuredClone(job) : null,
    update: async (_collection:string,id:string,patch:Record<string,unknown>) => {if(id!==job.id)return false;Object.assign(job,structuredClone(patch));return true;},
    compareAndSwap: async (_collection:string,id:string,expected:Record<string,unknown>,patch:Record<string,unknown>) => {
      if(id!==job.id||!Object.entries(expected).every(([key,value])=>JSON.stringify(job[key])===JSON.stringify(value)))return false;
      Object.assign(job,structuredClone(patch));return true;
    },
  } as unknown as DataStore;
  const assertActive = async()=>{if(!active)throw Error('lease_lost');};
  const counts = {assets:0,voice:0,trim:0,effects:0,render:0,technical_quality:0,creative_quality:0,delivery:0};
  let approval:GraphApproval|null=null;
  const makePhase = (name: keyof typeof counts) => async () => {
    counts[name]++;
    return {artifactRefs:[`phase:${name}`],inputHash:'input-a'};
  };
  const phases = { assets:makePhase('assets'),voice:makePhase('voice'),trim:makePhase('trim'),effects:makePhase('effects'),
    render:makePhase('render'),technical_quality:makePhase('technical_quality'),creative_quality:makePhase('creative_quality'),delivery:makePhase('delivery') };
  const input:LangGraphProductionInput={identity,dataStore,assertActive,phases,review:{loadApproval:async()=>approval,verifyResume:async token=>token==='canonical-receipt'&&approval?.approved===true}};
  const run = (resume?:unknown)=>runWithContentExecutionContext({dataStore,jobId:'job-a',checkpoints:job.checkpoints,providerReceipts:job.provider_receipts,expectedWorkerId:'worker-a',expectedAttempt:1,executionStillOwned:()=>active,action:()=>runLangGraphProduction({...input,...(resume===undefined?{}:{resume})})});
  return {job,dataStore,counts,input,run,setApproval:()=>{approval={approved:true,receiptRef:'canonical-receipt',subjectVersion:'1',contentHash:'artifact-hash'};},loseLease:()=>{active=false;}};
}
test('actual graph persists interrupt and resumes with a new saver without rerunning finished phases',async()=>{
  const f=fixture();
  const waiting=await f.run();
  assert.equal(waiting.status,'waiting_review');assert.ok(waiting.interrupts.length);assert.equal(waiting.state.completed,false);
  assert.deepEqual(f.counts,{assets:1,voice:1,trim:1,effects:1,render:1,technical_quality:1,creative_quality:1,delivery:0});
  await assert.rejects(f.run({approved:true}),/resume_not_authorized/);
  f.setApproval();
  const done=await f.run('canonical-receipt');
  assert.equal(done.status,'completed');assert.deepEqual(f.counts,{assets:1,voice:1,trim:1,effects:1,render:1,technical_quality:1,creative_quality:1,delivery:1});
  await f.run();await f.run('canonical-receipt');assert.equal(f.counts.delivery,1,'completed invocation reuses stored terminal state');
});
test('failure keeps completed stage writes and resumes only failed work',async()=>{
  const f=fixture();let fail=true;
  const original=f.input.phases.render!;
  f.input.phases.render=async state=>{if(fail)throw Error('controlled-render-failure');return original(state);};
  await assert.rejects(f.run(),/controlled-render-failure/);
  assert.deepEqual({...f.counts,delivery:0},{assets:1,voice:1,trim:1,effects:1,render:0,technical_quality:0,creative_quality:0,delivery:0});
  const failed=(f.job.checkpoints as any)['langgraph.node.render'];
  assert.equal(failed.version,'2');assert.equal(failed.payload.status,'failed');assert.equal(failed.payload.attempt,1);
  assert.equal(failed.payload.failureCode,'controlled-render-failure');assert.equal(failed.payload.failureReason,'controlled-render-failure');
  assert.match(failed.payload.phaseContractVersion,/render\.contract\.v1$/);
  assert.match(failed.payload.predecessorEvidenceSha256,/^[a-f0-9]{64}$/);assert.match(failed.payload.nodeIdentityHash,/^[a-f0-9]{64}$/);
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

test('in-flight v1 jobs retain their original four-node topology after the v2 rollout',async()=>{
  const f=fixture();let quality=0;
  f.input.identity={...f.input.identity,graphVersion:LEGACY_CONTENT_GRAPH_VERSION};
  f.input.phases.quality=async()=>{quality++;return{artifactRefs:['legacy-quality'],inputHash:'input-a'};};
  const waiting=await f.run();
  assert.equal(waiting.status,'waiting_review');
  assert.equal(quality,1);
  assert.deepEqual(f.counts,{assets:1,voice:0,trim:0,effects:0,render:1,technical_quality:0,creative_quality:0,delivery:0});
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
    assert.equal(f.counts.assets,failAfterAssets?1:0);assert.equal(f.counts.voice,0);assert.equal(f.counts.render,0);
  }
});
test('corrupt stored checkpoint is rejected instead of silently starting paid work again',async()=>{
  const f=fixture();f.job.checkpoints={'langgraph.v1':{version:'bad'}};
  await assert.rejects(f.run(),/checkpoint_corrupt/);assert.equal(f.counts.assets,0);
});

test('authorized correction has an independent graph and preserves the old review history while retries reuse new phases',async()=>{
 const f=fixture();await f.run();const original=JSON.stringify((f.job.checkpoints as Record<string,any>)['langgraph.v1']);
 const correctionHash='d'.repeat(64);
 const correctedInput={...f.input,identity:{...f.input.identity,inputHash:'corrected-input-a'},correctionHash};
 const corrected=()=>runWithContentExecutionContext({dataStore:f.dataStore,jobId:'job-a',checkpoints:f.job.checkpoints,providerReceipts:f.job.provider_receipts,expectedWorkerId:'worker-a',expectedAttempt:1,executionStillOwned:()=>true,action:()=>runLangGraphProduction(correctedInput)});
 assert.equal((await corrected()).status,'waiting_review');
 assert.deepEqual(f.counts,{assets:2,voice:2,trim:2,effects:2,render:2,technical_quality:2,creative_quality:2,delivery:0});
 assert.equal(JSON.stringify((f.job.checkpoints as Record<string,any>)['langgraph.v1']),original);
 assert.ok((f.job.checkpoints as Record<string,any>)[`lg.fix.${correctionHash}.v1`]);
 assert.ok((f.job.checkpoints as Record<string,any>)[`lg.fix.${correctionHash}.assets`]);
 await corrected();assert.deepEqual(f.counts,{assets:2,voice:2,trim:2,effects:2,render:2,technical_quality:2,creative_quality:2,delivery:0});
});


test('in-flight v2 topology remains readable with a distinct identity from new visual v3 tasks',async()=>{
 const f=fixture();f.input.identity={...f.input.identity,graphVersion:PREVIOUS_CONTENT_GRAPH_VERSION};
 assert.notEqual(graphIdentityHash(f.input.identity),graphIdentityHash({...f.input.identity,graphVersion:CONTENT_GRAPH_VERSION}));
 const waiting=await f.run();assert.equal(waiting.status,'waiting_review');
 assert.deepEqual(f.counts,{assets:1,voice:1,trim:1,effects:1,render:1,technical_quality:1,creative_quality:1,delivery:0});
 f.setApproval();assert.equal((await f.run('canonical-receipt')).status,'completed');assert.equal(f.counts.delivery,1);
});

test('new v4 jobs freeze source assets before voice and presenter assets, then hand off only after review',async()=>{
 const f=fixture();f.input.identity={...f.input.identity,graphVersion:CONTENT_GRAPH_VERSION};
 const order:string[]=[];
 const phase=(name:string)=>async()=>{order.push(name);return{artifactRefs:[`phase:${name}`],inputHash:'input-a'};};
 f.input.phases={source_assets:phase('source_assets'),voice:phase('voice'),presenter_assets:phase('presenter_assets'),
   trim:phase('trim'),effects:phase('effects'),render:phase('render'),technical_quality:phase('technical_quality'),
   creative_quality:phase('creative_quality'),handoff:phase('handoff'),delivery:phase('delivery')};
 const waiting=await f.run();
 assert.equal(waiting.status,'waiting_review');
 assert.deepEqual(order,['source_assets','voice','presenter_assets','trim','effects','render','technical_quality','creative_quality']);
 f.setApproval();
 assert.equal((await f.run('canonical-receipt')).status,'completed');
 assert.deepEqual(order,['source_assets','voice','presenter_assets','trim','effects','render','technical_quality','creative_quality','handoff','delivery']);
});

test('node identity changes with direct predecessor evidence and phase contract policy',()=>{
 const input={identity,phaseContractVersions:{render:'render-policy.v1'}};
 const first=productionGraphNodeChainIdentity(input,'render',{effects:{artifactRefs:['effect:a'],inputHash:'effect-v1'}});
 const changedPredecessor=productionGraphNodeChainIdentity(input,'render',{effects:{artifactRefs:['effect:b'],inputHash:'effect-v1'}});
 const changedPolicy=productionGraphNodeChainIdentity({...input,phaseContractVersions:{render:'render-policy.v2'}},'render',
   {effects:{artifactRefs:['effect:a'],inputHash:'effect-v1'}});
 assert.notEqual(first.predecessorEvidenceSha256,changedPredecessor.predecessorEvidenceSha256);
 assert.notEqual(first.nodeIdentityHash,changedPredecessor.nodeIdentityHash);
 assert.equal(first.predecessorEvidenceSha256,changedPolicy.predecessorEvidenceSha256);
 assert.notEqual(first.nodeIdentityHash,changedPolicy.nodeIdentityHash);
});

test('completed fast path fails closed when a phase contract changes and preserves provider receipts',async()=>{
 const f=fixture();f.setApproval();f.input.phaseContractVersions={assets:'assets-policy.v1'};
 assert.equal((await f.run()).status,'completed');
 const counts=structuredClone(f.counts);
 f.job.provider_receipts=[{provider:'heygen',requestId:'accepted-request',state:'accepted',providerTaskId:'provider-task',metadata:{},firstRecordedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
 f.input.phaseContractVersions={assets:'assets-policy.v2'};
 await assert.rejects(f.run(),/content_graph_node_chain_identity_changed:assets/);
 assert.deepEqual(f.counts,counts,'an invalid terminal chain must not execute or repeat a phase');
 assert.equal((f.job.provider_receipts as Array<{requestId:string}>)[0]?.requestId,'accepted-request');
});

test('completed fast path asks the authoritative reader and rejects external domain evidence drift',async()=>{
 const f=fixture();f.setApproval();
 const authoritative=new Map<string,string>();
 for(const phase of Object.keys(f.counts))authoritative.set(phase,'input-a');
 f.input.validateRestoredPhaseEvidence=async(phase,restored)=>{
   if(authoritative.get(phase)!==restored.inputHash)throw Error(`content_graph_authoritative_evidence_changed:${phase}`);
 };
 assert.equal((await f.run()).status,'completed');
 const counts=structuredClone(f.counts);
 authoritative.set('assets','replaced-domain-evidence');
 await assert.rejects(f.run(),/content_graph_authoritative_evidence_changed:assets/);
 assert.deepEqual(f.counts,counts,'the terminal snapshot must not bypass the authoritative domain reader');
});

test('interrupt resume validates authoritative predecessor evidence before delivery',async()=>{
 const f=fixture();let assetsHash='input-a';
 f.input.validateRestoredPhaseEvidence=async(phase,restored)=>{
   if(phase==='assets'&&restored.inputHash!==assetsHash)throw Error('content_graph_authoritative_evidence_changed:assets');
 };
 assert.equal((await f.run()).status,'waiting_review');
 f.setApproval();assetsHash='new-domain-hash';
 await assert.rejects(f.run('canonical-receipt'),/content_graph_authoritative_evidence_changed:assets/);
 assert.equal(f.counts.delivery,0);
});

test('in-flight v3 keeps its original assets to voice topology and resumes without entering v4 nodes',async()=>{
 const f=fixture();const order:string[]=[];let fail=true;
 for(const phase of ['assets','voice','trim','effects','render','technical_quality','creative_quality','delivery'] as const){
   const original=f.input.phases[phase]!;
   f.input.phases[phase]=async state=>{order.push(phase);if(phase==='trim'&&fail)throw Error('controlled-v3-stop');return original(state);};
 }
 await assert.rejects(f.run(),/controlled-v3-stop/);
 assert.deepEqual(order,['assets','voice','trim']);
 fail=false;f.setApproval();assert.equal((await f.run()).status,'completed');
 assert.deepEqual(order,['assets','voice','trim','trim','effects','render','technical_quality','creative_quality','delivery']);
 assert.equal('source_assets' in f.input.phases,false);assert.equal('presenter_assets' in f.input.phases,false);
});

test('v4 binds each paid supplier submission to one phase and recovery never repeats accepted work',async()=>{
 const f=fixture();f.input.identity={...f.input.identity,graphVersion:BACKGROUND_FIRST_GRAPH_VERSION};
 const calls={source_assets:0,voice:0,presenter_assets:0,trim:0,effects:0,render:0,technical_quality:0,creative_quality:0,handoff:0,delivery:0};
 const order:string[]=[];let stopAtTrim=true;
 const paidPhase=async(phase:'source_assets'|'voice'|'presenter_assets',provider:string)=>{
   calls[phase]++;order.push(phase);
   const requestId=`${phase}-request`;
   (f.job.provider_receipts as Array<Record<string,unknown>>).push({provider,requestId,state:'accepted',providerTaskId:`${phase}-task`,
     metadata:{},firstRecordedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
   return {artifactRefs:[`phase:${phase}`],inputHash:`${phase}-input`,metadata:{providerReceiptRefs:[`${provider}:${requestId}`]}};
 };
 const localPhase=(phase:Exclude<keyof typeof calls,'source_assets'|'voice'|'presenter_assets'>)=>async()=>{
   calls[phase]++;order.push(phase);if(phase==='trim'&&stopAtTrim)throw Error('controlled-v4-stop');
   return {artifactRefs:[`phase:${phase}`],inputHash:`${phase}-input`};
 };
 f.input.phases={source_assets:()=>paidPhase('source_assets','source-provider'),voice:()=>paidPhase('voice','voice-provider'),
   presenter_assets:()=>paidPhase('presenter_assets','presenter-provider'),trim:localPhase('trim'),effects:localPhase('effects'),
   render:localPhase('render'),technical_quality:localPhase('technical_quality'),creative_quality:localPhase('creative_quality'),
   handoff:localPhase('handoff'),delivery:localPhase('delivery')};
 await assert.rejects(f.run(),/controlled-v4-stop/);
 assert.deepEqual(order,['source_assets','voice','presenter_assets','trim']);
 assert.deepEqual((f.job.provider_receipts as Array<{provider:string;requestId:string}>).map(row=>`${row.provider}:${row.requestId}`).sort(),[
   'presenter-provider:presenter_assets-request','source-provider:source_assets-request','voice-provider:voice-request']);
 stopAtTrim=false;f.setApproval();assert.equal((await f.run()).status,'completed');
 assert.deepEqual(calls,{source_assets:1,voice:1,presenter_assets:1,trim:2,effects:1,render:1,technical_quality:1,creative_quality:1,handoff:1,delivery:1});
 assert.equal((f.job.provider_receipts as unknown[]).length,3,'checkpoint recovery must not create a second paid submission');
});

test('v4 node evidence attributes provider receipts only to the phase that owns them',async()=>{
 const f=fixture();f.input.identity={...f.input.identity,graphVersion:BACKGROUND_FIRST_GRAPH_VERSION};
 f.job.provider_receipts=[
   {provider:'source-provider',requestId:'source-request',state:'completed',providerTaskId:'source-task',metadata:{actualCostCny:1},firstRecordedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
   {provider:'voice-provider',requestId:'voice-request',state:'completed',providerTaskId:'voice-task',metadata:{actualCostCny:2},firstRecordedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
 ];
 const local=(name:string)=>async()=>({artifactRefs:[`phase:${name}`],inputHash:`${name}-input`});
 f.input.phases={
   source_assets:async()=>({artifactRefs:['phase:source_assets'],inputHash:'source-input',metadata:{providerReceiptRefs:['source-provider:source-request']}}),
   voice:async()=>({artifactRefs:['phase:voice'],inputHash:'voice-input',metadata:{providerReceiptRefs:['voice-provider:voice-request']}}),
   presenter_assets:local('presenter_assets'),trim:local('trim'),effects:local('effects'),render:local('render'),
   technical_quality:local('technical_quality'),creative_quality:local('creative_quality'),handoff:local('handoff'),delivery:local('delivery'),
 };
 await f.run();
 const checkpoints=f.job.checkpoints as Record<string,any>;
 assert.equal(checkpoints['langgraph.node.source_assets'].version,'3');
 assert.deepEqual(checkpoints['langgraph.node.source_assets'].payload.providerReceiptRefs,['source-provider:source-request']);
 assert.equal(checkpoints['langgraph.node.source_assets'].payload.actualCostCny,1);
 assert.deepEqual(checkpoints['langgraph.node.voice'].payload.providerReceiptRefs,['voice-provider:voice-request']);
 assert.equal(checkpoints['langgraph.node.voice'].payload.actualCostCny,2);
 assert.deepEqual(checkpoints['langgraph.node.presenter_assets'].payload.providerReceiptRefs,[]);
 assert.equal(checkpoints['langgraph.node.presenter_assets'].payload.actualCostCny,null);
});

test('v4 retry carries its accepted phase receipt without inheriting another phase or resubmitting',async()=>{
 const f=fixture();f.input.identity={...f.input.identity,graphVersion:BACKGROUND_FIRST_GRAPH_VERSION};
 const chain=productionGraphNodeChainIdentity({identity:f.input.identity},'source_assets',{});
 const now=new Date().toISOString();
 const before=new Date(Date.parse(now)-60_000).toISOString();
 f.job.provider_receipts=[
   {provider:'source-provider',requestId:'accepted-source',state:'accepted',providerTaskId:'source-task',metadata:{reservedCny:3},firstRecordedAt:now,updatedAt:now},
   {provider:'unrelated-provider',requestId:'prior-analysis',state:'completed',providerTaskId:'analysis-task',metadata:{actualCostCny:9},firstRecordedAt:before,updatedAt:now},
 ];
 (f.job.checkpoints as Record<string,unknown>)['langgraph.node.source_assets']={version:'2',inputHash:chain.nodeIdentityHash,updatedAt:now,payload:{
   node:'source_assets',nodeVersion:'2',graphVersion:BACKGROUND_FIRST_GRAPH_VERSION,planVersion:'1',inputHash:'input-a',
   startedAt:now,endedAt:now,durationMs:0,status:'failed',attempt:1,failureCode:'worker_stopped',failureReason:'worker_stopped',
   outputSha256:null,providerReceiptRefs:[],reservedCny:null,actualCostCny:null,...chain,
 }};
 let submissions=0;
 const local=(name:string)=>async()=>({artifactRefs:[`phase:${name}`],inputHash:`${name}-input`});
 f.input.phases={source_assets:async()=>{
   const accepted=(f.job.provider_receipts as Array<{provider:string;requestId:string;state:string}>).some(row=>row.provider==='source-provider'&&row.requestId==='accepted-source'&&row.state==='accepted');
   if(!accepted)submissions++;
   return {artifactRefs:['phase:source_assets'],inputHash:'source-input'};
 },voice:local('voice'),presenter_assets:local('presenter_assets'),trim:local('trim'),effects:local('effects'),render:local('render'),
 technical_quality:local('technical_quality'),creative_quality:local('creative_quality'),handoff:local('handoff'),delivery:local('delivery')};
 await f.run();
 const saved=(f.job.checkpoints as Record<string,any>)['langgraph.node.source_assets'];
 assert.equal(submissions,0);
 assert.equal(saved.payload.attempt,2);
 assert.equal(saved.version,'3');
 assert.deepEqual(saved.payload.providerReceiptRefs,['source-provider:accepted-source']);
 assert.equal(saved.payload.reservedCny,3);
 assert.equal(saved.payload.actualCostCny,null);
});

test('v4 dependency identities isolate upstream evidence and invalidate only its downstream boundary',()=>{
 const v4:ProductionGraphIdentity={...identity,graphVersion:BACKGROUND_FIRST_GRAPH_VERSION};
 const base={source_assets:{artifactRefs:['source:v1'],inputHash:'source-input'},voice:{artifactRefs:['voice:v1'],inputHash:'voice-input'},
   presenter_assets:{artifactRefs:['presenter:v1'],inputHash:'presenter-input'}};
 const changedPresenter={...base,presenter_assets:{artifactRefs:['presenter:v2'],inputHash:'presenter-input'}};
 assert.deepEqual(productionGraphNodeChainIdentity({identity:v4},'source_assets',base),
   productionGraphNodeChainIdentity({identity:v4},'source_assets',changedPresenter));
 assert.deepEqual(productionGraphNodeChainIdentity({identity:v4},'voice',base),
   productionGraphNodeChainIdentity({identity:v4},'voice',changedPresenter));
 assert.deepEqual(productionGraphNodeChainIdentity({identity:v4},'presenter_assets',base),
   productionGraphNodeChainIdentity({identity:v4},'presenter_assets',changedPresenter));
 assert.notDeepEqual(productionGraphNodeChainIdentity({identity:v4},'trim',base),
   productionGraphNodeChainIdentity({identity:v4},'trim',changedPresenter));
});
