import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import { createPresenterFirstFrameProductionRuntime,createPresenterFirstFrameStaticExecutor } from './socialContentPresenterFirstFrameRuntime.js';

const sha=(value:string)=>value.padEnd(64,'a').slice(0,64);
const scope={tenantId:'tenant-a',taskId:'task-a',runId:'run-a',planHash:sha('plan')};
const grouping={} as never;
const group={groupId:'presenter-mother-1',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter-1',compositions:[{referenceShotId:'shot-1',referenceFirstFrameUrl:'/api/overseas/videos/v/shot/1/first-frame',background:'office',framing:'medium',camera:'eye-level',composition:'centered'}]};
const paidStatic={requirements:[],intents:[],permit:{} as never};
test('motion-only first frame uses Ark enterprise identity without HeyGen avatar, voice or default selection',async()=>{
 const presenter={id:'presenter-1',authorized:true,assetVersion:2,referenceMaterialIds:['owned-person-image'],rightsEvidence:{authorizationRef:'rights://1',consentRef:'consent://1',grantedAt:'2026-01-01T00:00:00.000Z',subjectAdultConfirmed:true,permittedProviders:['volcengine_ark'],permittedUses:['digital_presenter','person_replacement']}};
 const store={list:async()=>({totalItems:1,items:[{payload:{presenters:[presenter]}}]})} as never;
 const runtime=createPresenterFirstFrameProductionRuntime(store);
 await assert.rejects(runtime.preparePresenterMotherFirstFrames!({scope,grouping,groups:[{...group,executionKind:'seedance_motion'}],paidStatic}),/presenter_first_frame_paid_static_executor_missing/);
 await assert.rejects(runtime.preparePresenterMotherFirstFrames!({scope,grouping,groups:[group],paidStatic}),/default_presenter_missing/);
});

test('real runtime validates the authorized default presenter and stops before an unbudgeted static supplier call',async()=>{
 let calls=0;const store={list:async(collection:string)=>{calls++;assert.equal(collection,'studio_production_defaults');return{totalItems:1,items:[{payload:{defaultPresenterId:'presenter-1',presenters:[{id:'presenter-1',authorized:true,assetVersion:2,avatarId:'avatar-1',voiceId:'voice-1',rightsEvidence:{authorizationRef:'rights://1',consentRef:'consent://1',grantedAt:'2026-01-01T00:00:00.000Z',subjectAdultConfirmed:true,permittedProviders:['heygen','volcengine_ark','dashscope'],permittedUses:['digital_presenter','voice_synthesis','person_replacement','quality_inspection'],providerScopes:[{provider:'dashscope',uses:['quality_inspection']}]}}]}}]};}} as never;
 const runtime=createPresenterFirstFrameProductionRuntime(store);
 await assert.rejects(runtime.preparePresenterMotherFirstFrames!({scope,grouping,groups:[group],paidStatic}),/presenter_first_frame_paid_static_executor_missing/);assert.equal(calls,1);
});

test('real runtime keeps the task-frozen authorized presenter when the account default changes',async()=>{
 const presenter={id:'presenter-1',authorized:true,assetVersion:2,avatarId:'avatar-1',voiceId:'voice-1',rightsEvidence:{authorizationRef:'rights://1',consentRef:'consent://1',grantedAt:'2026-01-01T00:00:00.000Z',subjectAdultConfirmed:true,permittedProviders:['heygen','volcengine_ark','dashscope'],permittedUses:['digital_presenter','voice_synthesis','person_replacement','quality_inspection'],providerScopes:[{provider:'dashscope',uses:['quality_inspection']}]}};
 const store={list:async()=>({totalItems:1,items:[{payload:{defaultPresenterId:'presenter-2',presenters:[presenter]}}]})} as never;
 const runtime=createPresenterFirstFrameProductionRuntime(store);
 await assert.rejects(runtime.preparePresenterMotherFirstFrames!({scope,grouping,groups:[group],paidStatic}),/presenter_first_frame_paid_static_executor_missing/);
});

test('static executor submits exactly the frozen Seedream and Qwen operations and persists real supplier evidence',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-static-'));const source=await sharp({create:{width:100,height:100,channels:3,background:'#334455'}}).png().toBuffer(),person=await sharp({create:{width:100,height:100,channels:3,background:'#aa8866'}}).png().toBuffer(),output=await sharp({create:{width:100,height:100,channels:3,background:'#6688aa'}}).png().toBuffer();
 const maximum={first_frame:{inputImages:2,outputImages:1},first_frame_qa:{inputTokens:262144,outputTokens:4096}} as const;
 const intents=(['first_frame','first_frame_qa'] as const).map(stage=>({operationId:`op-${stage}`,provider:stage==='first_frame'?'seedream':'qwen',model:stage==='first_frame'?'doubao-seedream-5-0-flash-test':'qwen3-vl-plus',accountRef:`account-${stage}`,stage,shotId:group.groupId,inputContractHash:sha(stage),maximumUnits:maximum[stage]}));
 const calls:string[]=[],completed:Array<[string,string]>=[];
 const permit={beforeSubmit:async(request:any)=>{calls.push(request.stage);assert.deepEqual(request.actualUnits,maximum[request.stage as keyof typeof maximum]);},markOutcome:async(operationId:string,status:string,receipt:string)=>{assert.equal(status,'completed');completed.push([operationId,receipt]);}};
 const executor=createPresenterFirstFrameStaticExecutor({list:async()=>({totalItems:0,items:[]})} as never,{root,assertProviderBinding:async()=>{},loadReferenceFrame:async()=>({bytes:source,mimeType:'image/png',sha256:sha256(source)}),loadPresenterMaster:async()=>({bytes:person,mimeType:'image/png',sha256:sha256(person)}),generator:{provider:'seedream',model:intents[0]!.model,estimatedCostCny:.1,generate:async()=>({bytes:output,mimeType:'image/png',provider:'seedream',model:intents[0]!.model,providerRequestId:'seedream-real-request',estimatedCostCny:.1})} as never,inspect:async options=>{await options.paidSubmission!({model:intents[1]!.model,enable_thinking:false,max_tokens:4096,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'a'}},{type:'image_url',image_url:{url:'b'}},{type:'image_url',image_url:{url:'c'}}]}]});options.onReceipt?.({id:'qwen-real-request',choices:[{message:{content:'{}'}}]});return['person_identity','environment_fidelity','layout','visual_integrity'].map(key=>({key,verdict:'pass' as const,evidenceFrames:['候选首帧'],note:'visible'}));}});
 const result=await executor.prepare({scope,grouping,groups:[group],group,presenter:{id:'presenter-1',assetVersion:2},frameOperationId:'op-first_frame',qaOperationId:'op-first_frame_qa',paidStatic:{requirements:[],intents:intents as never,permit:permit as never}});
 assert.deepEqual(calls,['first_frame','first_frame_qa']);assert.equal(completed.length,2);assert.match(result.personRemovalEvidence.receiptRef,/^seedream:seedream-real-request:/);assert.match(result.qa.receiptRef,/^qwen:qwen-real-request:/);assert.equal(result.qa.passed,true);assert.equal(result.compositeFirstFrameSha256,sha256(output));assert.equal((await fs.stat(path.join(root,result.compositeFirstFrameUrl.slice('/media/'.length)))).size,output.length);
 await fs.rm(root,{recursive:true,force:true});
});

function sha256(value:Buffer){return createHash('sha256').update(value).digest('hex');}
