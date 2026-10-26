import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {DataStore} from '../storage/datastore.js';
import type {FirstFrameGenerator} from '../lib/firstFrameGenerator.js';
import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import {socialPaidIntentOperation} from '../lib/socialContentTaskBudgetAuthority.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {createSocialContentPaidOperationPermit} from '../lib/socialContentPaidOperationPermit.js';
import {storyboardQaRequiredChecks} from '../lib/storyboardAigcQuality.js';
import {isPresenterBackgroundFirstEvidence,isPresenterOriginalSceneFirstEvidence} from '../../shared/contracts/presenterBackgroundFirst.js';
import {preparePresenterBackgroundFirst,preparePresenterOriginalSceneFirst,type PresenterBackgroundFirstInput} from './socialContentPresenterBackgroundFirst.js';
import {createPresenterFirstFrameProductionRuntime,createPresenterFirstFrameStaticExecutor} from './socialContentPresenterFirstFrameRuntime.js';
import {automaticallyConfirmPresenterFirstFrameApproval,readConfirmedPresenterFirstFrameApproval,createPresenterFirstFrameApproval} from './socialContentPresenterFirstFrameApproval.js';
import {readCurrentConfirmedPresenterFirstFrame} from './socialContentPresenterFirstFrameCurrent.js';

import {socialRequestHash} from './socialContentValidation.js';
const hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
async function fixture(ratio:'1:1'|'9:16'|'16:9'='1:1',retries=false,originalScene=false){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'background-first-'));
 const scope={tenantId:'tenant-a',taskId:'task-a',runId:'run-a',planHash:'a'.repeat(64)},groupId='presenter-mother-1';
 const [width,height]=ratio==='9:16'?[144,256]:ratio==='16:9'?[256,144]:[144,144];
 const png=async(color:string)=>sharp({create:{width:width!,height:height!,channels:3,background:color}}).png().toBuffer();
 const [original,person,plate,composite]=await Promise.all(['#334455','#aa8866','#557788','#6688aa'].map(png));
 const image=(bytes:Buffer)=>({bytes,mimeType:'image/png' as const,sha256:hash(bytes)});
 const source=image(original),identity=image(person);
 const make=(operationId:string,provider:'seedream'|'qwen',shotId:string,parents:string[],seed:string):SocialPaidOperationIntent=>({operationId,provider,model:provider==='qwen'?'qwen3-vl-plus':'seedream-test',accountRef:provider==='qwen'?'qwen-account':'ark-account',stage:provider==='qwen'?'first_frame_qa':'first_frame',shotId,inputContractHash:seed.repeat(64),maximumUnits:provider==='qwen'?{inputTokens:260096,outputTokens:4096}:{inputImages:shotId.endsWith(':background')?1:2,outputImages:1},executionBindingPolicy:{schemaVersion:'paid-execution-binding-policy.v1',parentOperationIds:parents}});
 const background=make('background','seedream',`${groupId}:background`,[],'1'),backgroundQa=make('backgroundQa','qwen',`${groupId}:background`,['background'],'2');
 const compositeIntent=make('composite','seedream',groupId,['background','backgroundQa'],'3'),compositeQa=make('compositeQa','qwen',groupId,['composite'],'4');
 let rows:SocialPaidOperationIntent[]=[background,backgroundQa,compositeIntent,compositeQa];
 let intents:PresenterBackgroundFirstInput['intents']={background,backgroundQa,composite:compositeIntent,compositeQa};
 if(retries){
  const background1=make('background-1','seedream',`${groupId}:background`,['background','backgroundQa'],'5'),backgroundQa1=make('backgroundQa-1','qwen',`${groupId}:background`,['background-1'],'6');
  compositeIntent.executionBindingPolicy={schemaVersion:'paid-execution-binding-policy.v2',allowedParentOperationSets:[['background','backgroundQa'],['background-1','backgroundQa-1']]};
  const composite1=make('composite-1','seedream',groupId,[],'7'),compositeQa1=make('compositeQa-1','qwen',groupId,['composite-1'],'8');
  composite1.executionBindingPolicy={schemaVersion:'paid-execution-binding-policy.v2',allowedParentOperationSets:[['background','backgroundQa','composite','compositeQa'],['background-1','backgroundQa-1','composite','compositeQa']]};
  rows=[background,backgroundQa,background1,backgroundQa1,compositeIntent,compositeQa,composite1,compositeQa1];
  intents={background:[background,background1],backgroundQa:[backgroundQa,backgroundQa1],composite:[compositeIntent,composite1],compositeQa:[compositeQa,compositeQa1]};
 }
 const ledger=new SocialContentTaskBudget(path.join(root,'ledger'),{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'owned-test-budget'}),quote:async()=>({upperBoundCny:.2,quoteRef:'controlled-quote',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
 const operations=rows.map(intent=>socialPaidIntentOperation(scope,intent));await ledger.reserveBatch(scope,operations);
 const config={scope,operations,intents:rows,ledger,root:path.join(root,'permit'),assertCurrent:async()=>{}};
 const events:string[]=[];let backgroundPassed=true,backgroundFailures=0,compositeFailures=0,omitLighting=false,available=true;
 const generator:FirstFrameGenerator={provider:'seedream',model:'seedream-test',estimatedCostCny:.2,generate:async request=>{
  assert.equal(request.ratio,ratio);const bg=request.referenceMode==='environment_plate'||request.referenceMode==='storyboard_scene';events.push(bg?'image:background':'image:composite');
  if(!bg||!originalScene)assert.equal(request.references[0]!.sha256,bg?source.sha256:hash(plate),'fusion must consume the actual clean background, not the benchmark image');
  assert.equal(request.references.length,bg?(originalScene?0:1):2);if(!bg){assert.equal(request.references[1]!.sha256,identity.sha256);assert.match(request.prompt,/光照方向/);}
  return{bytes:bg?plate:composite,mimeType:'image/png',provider:'seedream',model:'seedream-test',providerRequestId:bg?'seedream-bg':'seedream-fg',estimatedCostCny:.2};
 }};
 const inspect:NonNullable<PresenterBackgroundFirstInput['inspect']>=async request=>{
  const bg=!request.naturalCompositeRequired;if(originalScene&&bg){assert.equal(request.personRemovalRequired,false);assert.equal(request.personAbsenceRequired,true);assert.deepEqual(request.environmentReferences,[]);assert.match(request.productInfo,/没有参考图/);}events.push(bg?'qa:background':'qa:composite');assert.equal(request.naturalCompositeRequired,!bg);
  const refs=[...(request.personReferences??[]),...(request.productReferences??[]),...(request.environmentReferences??[]),...request.frames];assert.equal(refs.length,bg?(originalScene?1:2):3);
  await request.paidSubmission!({model:request.model,max_tokens:4096,messages:[{role:'user',content:refs.map(()=>({type:'image_url',image_url:{url:'fixture'}}))}]});
  request.onReceipt?.({id:bg?'qwen-bg':'qwen-fg'});
  const failBackground=bg&&(!backgroundPassed||backgroundFailures>0),failComposite=!bg&&compositeFailures>0;if(bg&&backgroundFailures>0)backgroundFailures--;if(!bg&&compositeFailures>0)compositeFailures--;
  return storyboardQaRequiredChecks({phase:'first_frame',sceneType:'general',hasProduct:false,hasNamedPerson:!bg,hasEnvironmentReference:!bg||!originalScene,hasContact:false,hasAction:false,personRemovalRequired:bg&&!originalScene,personAbsenceRequired:bg&&originalScene,naturalCompositeRequired:!bg}).filter(key=>!omitLighting||key!=='lighting_perspective').map(key=>({key,verdict:(failBackground&&key==='person_absence')||(failComposite&&key==='lighting_perspective')?'fail' as const:'pass' as const,evidenceFrames:[request.frames[0]!.timeLabel],note:'controlled contract fixture'}));
 };
 const input:PresenterBackgroundFirstInput={scope,groupId,presenterAssetId:'presenter',presenterAssetVersion:1,ratio,sceneDescription:'工厂中景，平视、居中',source,person:identity,products:[],intents,permit:createSocialContentPaidOperationPermit(config),mediaRoot:root,artifactRoot:path.join(root,'artifacts'),generator,inspect,assertProviderBinding:async()=>{if(!available)throw Error('provider_unavailable');}};
 return{root,input,events,config,ledger,plate,composite,source,identity,rows,setBackgroundPassed:(value:boolean)=>{backgroundPassed=value;},setBackgroundFailures:(value:number)=>{backgroundFailures=value;},setCompositeFailures:(value:number)=>{compositeFailures=value;},setOmitLighting:()=>{omitLighting=true;},setUnavailable:()=>{available=false;}};
}

test('four funded steps persist distinct original/background/composite identities and recover with vendors offline',async()=>{
 const f=await fixture();try{
  const result=await preparePresenterBackgroundFirst(f.input);assert.equal(isPresenterBackgroundFirstEvidence(result),true);
  assert.deepEqual(f.events,['image:background','qa:background','image:composite','qa:composite']);
  assert.equal(result.sourceFirstFrameSha256,f.source.sha256);assert.equal(result.background.sha256,hash(f.plate));assert.equal(result.composite.sha256,hash(f.composite));assert.notEqual(result.background.sha256,result.sourceFirstFrameSha256);
  for(const artifact of [result.background,result.composite])assert.equal(hash(await fs.readFile(path.join(f.root,artifact.artifactRef.slice('/media/'.length)))),artifact.sha256);
  f.setUnavailable();const recovered=await preparePresenterBackgroundFirst({...f.input,permit:createSocialContentPaidOperationPermit(f.config)});
  assert.deepEqual(recovered,result,'timestamps, reports and dependency identities must survive an approval-write interruption');assert.equal(f.events.length,4);assert.equal(f.ledger.status(f.input.scope)?.retainedCny,.8);
  const changed=structuredClone(result);changed.composite.plateSha256='0'.repeat(64);assert.equal(isPresenterBackgroundFirstEvidence(changed),false);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('failed background inspection never buys a composite and cannot rewrite the completed failed report',async()=>{
 const f=await fixture();try{
  f.setBackgroundPassed(false);await assert.rejects(preparePresenterBackgroundFirst(f.input),/presenter_background_quality_failed/);
  assert.deepEqual(f.events,['image:background','qa:background']);assert.equal(f.ledger.status(f.input.scope)?.entries.find(row=>row.operationId==='composite')?.status,'reserved');
  f.setBackgroundPassed(true);await assert.rejects(preparePresenterBackgroundFirst(f.input),/presenter_background_quality_failed/);assert.equal(f.events.length,2);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('a failed background candidate advances once, binds the passing candidate, and recovery does not repay either attempt',async()=>{
 const f=await fixture('1:1',true);try{
  f.setBackgroundFailures(1);const result=await preparePresenterBackgroundFirst(f.input);
  assert.deepEqual(f.events,['image:background','qa:background','image:background','qa:background','image:composite','qa:composite']);
  assert.equal(result.background.operationId,'background-1');assert.equal(result.background.qa.operationId,'backgroundQa-1');assert.equal(result.composite.operationId,'composite');
  f.setUnavailable();const recovered=await preparePresenterBackgroundFirst({...f.input,permit:createSocialContentPaidOperationPermit(f.config)});
  assert.deepEqual(recovered,result);assert.equal(f.events.length,6);assert.equal(f.ledger.status(f.input.scope)?.retainedCny,1.6);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('a failed composite candidate retries against the same accepted background without regenerating it',async()=>{
 const f=await fixture('1:1',true);try{
  f.setCompositeFailures(1);const result=await preparePresenterBackgroundFirst(f.input);
  assert.deepEqual(f.events,['image:background','qa:background','image:composite','qa:composite','image:composite','qa:composite']);
  assert.equal(result.background.operationId,'background');assert.equal(result.composite.operationId,'composite-1');assert.equal(result.composite.qa.operationId,'compositeQa-1');
  f.setUnavailable();assert.deepEqual(await preparePresenterBackgroundFirst({...f.input,permit:createSocialContentPaidOperationPermit(f.config)}),result);assert.equal(f.events.length,6);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('missing fusion lighting/perspective evidence remains unknown and cannot create an approval',async()=>{
 const f=await fixture();try{f.setOmitLighting();await assert.rejects(preparePresenterBackgroundFirst(f.input),/presenter_composite_quality_failed/);assert.equal(f.events.length,4);}
 finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('a mismatched paid dependency chain stops before the first supplier call',async()=>{
 const f=await fixture();try{
  const changed=structuredClone(f.input.intents),composite=Array.isArray(changed.composite)?changed.composite[0]!:changed.composite;composite.executionBindingPolicy={schemaVersion:'paid-execution-binding-policy.v1',parentOperationIds:[]};
  await assert.rejects(preparePresenterBackgroundFirst({...f.input,intents:changed}),/presenter_background_paid_plan_invalid/);assert.equal(f.events.length,0);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('production writes a v2 approval after four receipts, restores a missing public background and preserves v1 meanings',async()=>{
 const f=await fixture();try{
  const tables:Record<string,any[]>={};let failWrite=true;
  const presenter={id:'presenter',authorized:true,assetVersion:1,avatarId:'avatar',voiceId:'voice',rightsEvidence:{authorizationRef:'rights://fixture',consentRef:'consent://fixture',grantedAt:'2026-01-01',subjectAdultConfirmed:true,permittedProviders:['heygen','volcengine_ark','dashscope'],permittedUses:['digital_presenter','voice_synthesis','person_replacement','quality_inspection'],providerScopes:[{provider:'dashscope',uses:['quality_inspection']}]}};
  const store={list:async(collection:string,query:any={})=>{if(collection==='studio_production_defaults')return{totalItems:1,items:[{payload:{defaultPresenterId:'presenter',presenters:[presenter]}}]};const items=(tables[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));return{items,totalItems:items.length};},create:async(collection:string,row:any)=>{if(collection==='social_presenter_first_frame_approvals'&&failWrite){failWrite=false;return null;}const value={id:`${collection}-${tables[collection]?.length??0}`,...structuredClone(row)};(tables[collection]??=[]).push(value);return value;}} as unknown as DataStore;
  const executor=createPresenterFirstFrameStaticExecutor(store,{root:f.root,generator:f.input.generator as never,inspect:f.input.inspect,assertProviderBinding:f.input.assertProviderBinding,loadReferenceFrame:async()=>f.source,loadPresenterMaster:async()=>f.identity,loadProductReferences:async()=>[]});
  const runtime=createPresenterFirstFrameProductionRuntime(store,executor,{mediaRoot:f.root});
  const group={groupId:f.input.groupId,presenterGroupContractHash:'b'.repeat(64),presenterAssetId:'presenter',firstFramePipeline:'background-first.v2' as const,compositions:[{referenceSourceId:'video',referenceShotId:'R1',startSeconds:0,endSeconds:3,referenceFirstFrameUrl:'/api/overseas/videos/video/shot/1/first-frame',background:'工厂',framing:'中景',camera:'平视',composition:'居中'}]};
  const requirements=f.rows.map(row=>({key:row.operationId,stage:row.stage,shotId:row.shotId,sourceRef:null,durationSeconds:null,text:null,frameCount:null,inputContractHash:row.inputContractHash,presenterGroupId:f.input.groupId}));
  const input={scope:f.input.scope,grouping:{} as never,targetAspectRatio:'1:1',groups:[group],paidStatic:{requirements,intents:f.rows,permit:f.input.permit}};
  await assert.rejects(runtime.preparePresenterMotherFirstFrames!(input),/contract_write_failed/);assert.equal(f.events.length,4);
  const [approval]=await runtime.preparePresenterMotherFirstFrames!(input);assert.ok(approval);assert.equal(approval.schemaVersion,'social-presenter-first-frame-approval.v2');assert.equal(f.events.length,4);
  assert.equal(approval.backgroundPlateSha256,hash(f.plate));assert.equal(approval.assetProvenance?.background.referenceFirstFrameSha256,f.source.sha256);assert.equal(approval.personRemovalEvidence.outputSha256,hash(f.plate));
  const {schemaVersion:_,recordHash:__,...approvedInput}=approval;
  for(const mutate of [
   (value:typeof approvedInput)=>{value.backgroundPlateSha256=f.source.sha256;},
   (value:typeof approvedInput)=>{value.backgroundFirst!.composite.plateSha256=f.source.sha256;},
   (value:typeof approvedInput)=>{value.backgroundFirst!.background.qa.passed=false;},
   (value:typeof approvedInput)=>{value.backgroundFirst!.background.artifactRef='/media/tenants/other/background.png';},
   (value:typeof approvedInput)=>{value.backgroundFirst!.background.artifactRef+='?token=fixture';},
  ]){const changed=structuredClone(approvedInput);mutate(changed);await assert.rejects(createPresenterFirstFrameApproval(store,changed),/contract_invalid/);}

  await automaticallyConfirmPresenterFirstFrameApproval(store,{scope:input.scope,groupId:group.groupId,expectedRecordHash:approval.recordHash});
  const query={scope:input.scope,groupId:group.groupId,presenterGroupContractHash:group.presenterGroupContractHash,presenterAssetId:'presenter'};
  const readOptions={mediaRoot:f.root,readAssetProvenance:async()=>approval.assetProvenance!.manifestHash};assert.ok(await readCurrentConfirmedPresenterFirstFrame(store,query,readOptions));
  const backgroundFile=path.join(f.root,approval.backgroundFirst!.background.artifactRef.slice('/media/'.length));await fs.unlink(backgroundFile);
  assert.equal(await readCurrentConfirmedPresenterFirstFrame(store,query,readOptions),null);
  const [restored]=await runtime.preparePresenterMotherFirstFrames!(input);assert.equal(restored!.recordHash,approval.recordHash);assert.equal(f.events.length,4);assert.ok(await readCurrentConfirmedPresenterFirstFrame(store,query,readOptions));
  await fs.writeFile(backgroundFile,'changed');await assert.rejects(readCurrentConfirmedPresenterFirstFrame(store,query,readOptions),/background_artifact_changed/);
  const row=tables.social_presenter_first_frame_approvals![0]!;row.payload.backgroundFirst.composite.plateSha256='0'.repeat(64);
  assert.equal(await readConfirmedPresenterFirstFrameApproval(store,query),null);assert.equal(f.events.length,4);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});


test('both stages keep the task portrait or landscape ratio and record decoded pixel sizes',async()=>{
 for(const ratio of ['9:16','16:9'] as const){const f=await fixture(ratio);try{
  const evidence=await preparePresenterBackgroundFirst(f.input);assert.equal(evidence.aspectRatio,ratio);assert.equal(isPresenterBackgroundFirstEvidence(evidence),true);
  const expected=ratio==='9:16'?[144,256]:[256,144];
  for(const frame of [evidence.background,evidence.composite])assert.deepEqual([frame.width,frame.height],expected);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}}
});

test('original scene generates without benchmark images and preserves four-step recovery',async()=>{
 const f=await fixture('9:16',false,true);try{
 const {source:_,sceneDescription:__,...base}=f.input;
 const scenePrompt='冻结规划：明亮工厂，居中中景，无人无字';
 const input={...base,scenePrompt,source:{kind:'original_scene' as const,sceneContractHash:'c'.repeat(64),promptHash:socialRequestHash(scenePrompt)}};
 const result=await preparePresenterOriginalSceneFirst(input);
 assert.equal(isPresenterOriginalSceneFirstEvidence(result),true);
 assert.equal('sourceFirstFrameSha256' in result,false);assert.equal('personRemovalMethod' in result.background,false);
 assert.deepEqual(f.events,['image:background','qa:background','image:composite','qa:composite']);
 f.setUnavailable();assert.deepEqual(await preparePresenterOriginalSceneFirst(input),result);
 await assert.rejects(preparePresenterOriginalSceneFirst({...input,scenePrompt:'changed'}),/prompt_changed/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('original runtime writes v3 provenance and restores files without a reference or removal claim',async()=>{
 const f=await fixture('1:1',false,true);try{
  const tables:Record<string,any[]>={};let failWrite=false;
  const presenter={id:'presenter',authorized:true,assetVersion:1,avatarId:'avatar',voiceId:'voice',rightsEvidence:{authorizationRef:'rights://fixture',consentRef:'consent://fixture',grantedAt:'2026-01-01',subjectAdultConfirmed:true,permittedProviders:['heygen','volcengine_ark','dashscope'],permittedUses:['digital_presenter','voice_synthesis','person_replacement','quality_inspection'],providerScopes:[{provider:'dashscope',uses:['quality_inspection']}]}};
  const store={list:async(collection:string,query:any={})=>{if(collection==='studio_production_defaults')return{totalItems:1,items:[{payload:{defaultPresenterId:'presenter',presenters:[presenter]}}]};const items=(tables[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));return{items,totalItems:items.length};},create:async(collection:string,row:any)=>{if(collection==='social_presenter_first_frame_approvals'&&failWrite){failWrite=false;return null;}const value={id:`${collection}-${tables[collection]?.length??0}`,...structuredClone(row)};(tables[collection]??=[]).push(value);return value;}} as unknown as DataStore;
  const executor=createPresenterFirstFrameStaticExecutor(store,{root:f.root,generator:f.input.generator as never,inspect:f.input.inspect,assertProviderBinding:f.input.assertProviderBinding,loadReferenceFrame:async()=>{throw Error('original_must_not_load_reference');},loadPresenterMaster:async()=>f.identity,loadProductReferences:async()=>[]});
  const runtime=createPresenterFirstFrameProductionRuntime(store,executor,{mediaRoot:f.root});
  const group={groupId:f.input.groupId,presenterGroupContractHash:'b'.repeat(64),presenterAssetId:'presenter',firstFramePipeline:'background-first.v2' as const,compositions:[{source:{kind:'original_scene' as const,sceneId:'scene',sceneContractHash:'c'.repeat(64),promptHash:socialRequestHash('authored scene')},prompt:'authored scene',sceneContract:{} as never,background:'factory',framing:'medium',camera:'static',composition:'centered'}]};
  const requirements=f.rows.map(row=>({key:row.operationId,stage:row.stage,shotId:row.shotId,sourceRef:null,durationSeconds:null,text:null,frameCount:null,inputContractHash:row.inputContractHash,presenterGroupId:f.input.groupId}));
  const input={scope:f.input.scope,grouping:{} as never,targetAspectRatio:'1:1',groups:[group],paidStatic:{requirements,intents:f.rows,permit:f.input.permit}};

 const [approval]=await runtime.preparePresenterMotherFirstFrames!(input);
 assert.equal(approval?.schemaVersion,'social-presenter-first-frame-approval.v3');
 if(approval?.schemaVersion!=='social-presenter-first-frame-approval.v3')throw Error('v3 required');
 assert.equal(approval.personRemovalEvidence,undefined);assert.equal(approval.originalSceneProvenance.source.kind,'original_scene');
 assert.equal(f.events.length,4);
 assert.deepEqual((await runtime.preparePresenterMotherFirstFrames!(input))[0],approval);
 const file=path.join(f.root,approval.originalScene.background.artifactRef.slice('/media/'.length));
 await fs.unlink(file);assert.deepEqual((await runtime.preparePresenterMotherFirstFrames!(input))[0],approval);assert.equal(f.events.length,4);
 await fs.writeFile(file,'tampered');await assert.rejects(runtime.preparePresenterMotherFirstFrames!(input),/background_artifact_changed/);
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
