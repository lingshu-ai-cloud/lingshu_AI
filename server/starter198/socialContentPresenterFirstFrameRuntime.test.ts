import type {SocialPaidOperationIntent} from '../lib/socialContentTaskBudgetAuthority.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import { createPresenterFirstFrameProductionRuntime,createPresenterFirstFrameStaticExecutor,currentPresenterFirstFrameAssetProvenanceHash } from './socialContentPresenterFirstFrameRuntime.js';
import {createPresenterFirstFrameAssetProvenance} from './socialContentPresenterFirstFrameAssetProvenance.js';

const sha=(value:string)=>value.padEnd(64,'a').slice(0,64);
const scope={tenantId:'tenant-a',taskId:'task-a',runId:'run-a',planHash:sha('plan')};
const grouping={} as never;
const group={groupId:'presenter-mother-1',presenterGroupContractHash:sha('group'),presenterAssetId:'presenter-1',compositions:[{referenceSourceId:'v',referenceShotId:'shot-1',startSeconds:1,endSeconds:3,referenceFirstFrameUrl:'/api/overseas/videos/v/shot/1/first-frame',background:'office',framing:'medium',camera:'eye-level',composition:'centered'}]};
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

test('approval reuse provenance is recomputed from current person, product and background bytes',async()=>{
 const person=Buffer.from('person-v2'),product=Buffer.from('product-v3'),background=Buffer.from('background-v1');
 const assetProvenance=createPresenterFirstFrameAssetProvenance({presenter:{assetId:'presenter-1',assetVersion:2,referenceAssetIds:['presenter-1'],referenceSha256s:[sha256(person)]},products:[{productId:'SKU-1',enterpriseFactRef:'enterprise-product:SKU-1',enterpriseFactVersion:'facts:3:hash',referenceImageIds:['product-front'],referenceImageSha256s:[sha256(product)]}],background:{referenceSourceId:'video-1',referenceShotId:'shot-1',startSeconds:0,endSeconds:3,referenceFirstFrameRef:'/api/overseas/videos/video-1/shot/1/first-frame',referenceFirstFrameSha256:sha256(background)}});
 const approval={assetProvenance} as never;
 const store={list:async()=>({totalItems:1,items:[{payload:{presenters:[{id:'presenter-1',assetVersion:2}]}}]})} as never;
 const loaders={loadPresenterMaster:async()=>({bytes:person,mimeType:'image/png' as const,sha256:sha256(person)}),loadProductReferences:async()=>[{assetId:'product-front',bytes:product,mimeType:'image/png' as const,sha256:sha256(product)}],loadReferenceFrame:async()=>({bytes:background,mimeType:'image/png' as const,sha256:sha256(background)})};
 assert.equal(await currentPresenterFirstFrameAssetProvenanceHash(store,{tenantId:'tenant-a',approval},loaders),assetProvenance.manifestHash);
 const changedProduct=Buffer.from('product-v4');
 assert.notEqual(await currentPresenterFirstFrameAssetProvenanceHash(store,{tenantId:'tenant-a',approval},{...loaders,loadProductReferences:async()=>[{assetId:'product-front',bytes:changedProduct,mimeType:'image/png' as const,sha256:sha256(changedProduct)}]}),assetProvenance.manifestHash);
});

test('static executor submits exactly the frozen Seedream and Qwen operations and persists real supplier evidence',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-static-'));const source=await sharp({create:{width:100,height:100,channels:3,background:'#334455'}}).png().toBuffer(),person=await sharp({create:{width:100,height:100,channels:3,background:'#aa8866'}}).png().toBuffer(),product=await sharp({create:{width:100,height:100,channels:3,background:'#55aa77'}}).png().toBuffer(),output=await sharp({create:{width:100,height:100,channels:3,background:'#6688aa'}}).png().toBuffer();
 const productGroup={...group,productAssetBinding:{productId:'SKU-1',enterpriseFactRef:'enterprise-product:SKU-1',enterpriseFactVersion:'fact-v3:3:hash',referenceImageIds:['product-front']}};
 const maximum={first_frame:{inputImages:3,outputImages:1},first_frame_qa:{inputTokens:260096,outputTokens:4096}} as const;
 const intents=(['first_frame','first_frame_qa'] as const).map(stage=>({operationId:`op-${stage}`,provider:stage==='first_frame'?'seedream':'qwen',model:stage==='first_frame'?'doubao-seedream-5-0-flash-test':'qwen3-vl-plus',accountRef:`account-${stage}`,stage,shotId:group.groupId,inputContractHash:sha(stage),maximumUnits:maximum[stage]}));
 const calls:string[]=[],completed:Array<[string,string]>=[],idempotencyKeys:string[]=[];let omitRequiredQaCheck=false;
 const permit={assertRecovery:async(operationId:string)=>({status:'completed',receiptRef:completed.find(item=>item[0]===operationId)![1],submission:intents.find(item=>item.operationId===operationId)}),beforeSubmit:async(request:any)=>{calls.push(request.stage);assert.deepEqual(request.actualUnits,maximum[request.stage as keyof typeof maximum]);},markOutcome:async(operationId:string,status:string,receipt:string)=>{assert.equal(status,'completed');completed.push([operationId,receipt]);}};
 const executor=createPresenterFirstFrameStaticExecutor({list:async()=>({totalItems:0,items:[]})} as never,{root,assertProviderBinding:async()=>{},loadReferenceFrame:async()=>({bytes:source,mimeType:'image/png',sha256:sha256(source)}),loadPresenterMaster:async()=>({bytes:person,mimeType:'image/png',sha256:sha256(person)}),loadProductReferences:async(_tenant,ids)=>{assert.deepEqual(ids,['product-front']);return[{assetId:'product-front',bytes:product,mimeType:'image/png',sha256:sha256(product)}];},generator:{provider:'seedream',model:intents[0]!.model,estimatedCostCny:.1,generate:async (request:any)=>{assert.equal(request.ratio,'1:1');assert.match(request.prompt,/输出目标画幅 1:1/);assert.match(request.prompt,/铺满目标画布/);assert.match(request.prompt,/允许延展背景并合理重排构图/);assert.deepEqual(request.references.map((item:any)=>item.role),['source_composition','authorized_presenter','product_identity']);idempotencyKeys.push(request.idempotencyKey);return{bytes:output,mimeType:'image/png',provider:'seedream',model:intents[0]!.model,providerRequestId:'seedream-real-request',estimatedCostCny:.1};}} as never,inspect:async options=>{assert.match(options.storyboard!,/输出目标画幅 1:1/);assert.match(options.storyboard!,/主体大小与位置须适合目标画幅/);assert.equal(options.productReferences?.length,1);await options.paidSubmission!({model:intents[1]!.model,enable_thinking:false,max_tokens:4096,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'a'}},{type:'image_url',image_url:{url:'b'}},{type:'image_url',image_url:{url:'c'}}]}]});options.onReceipt?.({id:'qwen-real-request',choices:[{message:{content:'{}'}}]});return['person_identity','product_identity','packaging_visibility','subject_visibility','contact','start_state','environment_fidelity','layout','visual_integrity'].filter(key=>!omitRequiredQaCheck||key!=='packaging_visibility').map(key=>({key,verdict:'pass' as const,evidenceFrames:['候选首帧'],note:'visible'}));}});
 const result=await executor.prepare({scope,grouping,targetAspectRatio:'1:1',groups:[productGroup],group:productGroup,presenter:{id:'presenter-1',assetVersion:2},frameOperationId:'op-first_frame',qaOperationId:'op-first_frame_qa',paidStatic:{requirements:[],intents:intents as never,permit:permit as never}});
 assert.deepEqual(calls,['first_frame','first_frame_qa']);assert.equal(completed.length,2);assert.ok(result.personRemovalEvidence);assert.match(result.personRemovalEvidence.receiptRef,/^seedream:seedream-real-request:/);assert.match(result.qa.receiptRef,/^qwen:qwen-real-request:/);assert.equal(result.qa.passed,true);assert.match(idempotencyKeys[0]!,/^[a-f0-9]{64}$/);assert.deepEqual(result.productReferences,[{assetId:'product-front',sha256:sha256(product)}]);assert.equal(result.presenterReference.sha256s[0],sha256(person));assert.equal(result.compositeFirstFrameSha256,sha256(output));assert.equal((await fs.stat(path.join(root,result.compositeFirstFrameUrl.slice('/media/'.length)))).size,output.length);
 const repeated=await executor.prepare({scope,grouping,targetAspectRatio:'1:1',groups:[productGroup],group:productGroup,presenter:{id:'presenter-1',assetVersion:2},frameOperationId:'op-first_frame',qaOperationId:'op-first_frame_qa',paidStatic:{requirements:[],intents:intents as never,permit:permit as never}});
 assert.equal(repeated.qa.receiptRef,result.qa.receiptRef);assert.deepEqual(calls,['first_frame','first_frame_qa'],'a completed image and QA report are restored without another supplier submission');
 omitRequiredQaCheck=true;intents.push({...intents[1]!,operationId:'op-first_frame_qa-review2'});
 const incompleteQa=await executor.prepare({scope,grouping,targetAspectRatio:'1:1',groups:[productGroup],group:productGroup,presenter:{id:'presenter-1',assetVersion:2},frameOperationId:'op-first_frame',qaOperationId:'op-first_frame_qa-review2',paidStatic:{requirements:[],intents:intents as never,permit:permit as never}});
 assert.equal(incompleteQa.qa.passed,false,'missing required packaging QA must fail closed');assert.equal(idempotencyKeys.length,1,'QA retry reuses the paid image instead of generating another candidate');
 await fs.rm(root,{recursive:true,force:true});
});

function sha256(value:Buffer){return createHash('sha256').update(value).digest('hex');}

test('local four-frame intro repair preserves all short and long source video frames and exact decoded audio',async()=>{
 const {ensureStrictPresenterFirstFrames}=await import('./socialContentPresenterFirstFrameRuntime.js');
 const {runVisualFfmpeg}=await import('../lib/renderVisualQuality.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-intro-timeline-'));
 try{
  const approved=path.join(root,'approved.png');await sharp({create:{width:720,height:1280,channels:3,background:'#d9e8f4'}}).png().toFile(approved);
  const approvedSha256=createHash('sha256').update(await fs.readFile(approved)).digest('hex');
  for(const duration of [2.08,7.2]){
   const source=path.join(root,'source-'+duration+'.mp4');
   const generated=await runVisualFfmpeg(['-y','-f','lavfi','-i',`testsrc2=size=720x1280:rate=25:duration=${duration}`,'-f','lavfi','-i',`sine=frequency=440:sample_rate=48000:duration=${duration+.03}`,'-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',source],false,{timeoutMs:120000});assert.equal(generated.ok,true,generated.stderr);
   const bytes=await fs.readFile(source),sourceSha256=createHash('sha256').update(bytes).digest('hex');
   const result=await ensureStrictPresenterFirstFrames({tenantId:'fixture',runId:'fixture',groupId:'group-'+duration,sourcePath:source,sourceSha256,approvedPath:approved,approvedSha256},{root:path.join(root,'derived')});assert.equal(result.repaired,true);
   const decodeFrames=async(file:string)=>{const r=await runVisualFfmpeg(['-i',file,'-map','0:v:0','-vf','scale=8:8,format=gray','-f','rawvideo','-pix_fmt','gray','pipe:1'],true);assert.equal(r.ok,true,r.stderr);return r.stdout.length/64;};
   assert.equal(await decodeFrames(source),Math.round(duration*25));assert.equal(await decodeFrames(result.outputPath),await decodeFrames(source));
   const audio=async(file:string)=>{const r=await runVisualFfmpeg(['-i',file,'-map','0:a:0','-ac','1','-ar','24000','-f','s16le','pipe:1'],true);assert.equal(r.ok,true,r.stderr);return r.stdout;};
   assert.deepEqual(await audio(result.outputPath),await audio(source),'local picture repair must leave decoded source audio unchanged');
   assert.deepEqual(await fs.readFile(source),bytes,'provider source stays immutable');
   const evidence=JSON.parse(await fs.readFile(result.outputPath.replace(/\.mp4$/,'.json'),'utf8'));assert.equal(evidence.policy,'approved-four-frame-intro-source-geometry.v3');assert.equal(evidence.sourceFrameCount,evidence.outputFrameCount);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('explicit target ratio reaches Seedream and validates generated bytes before approval, with ratio-bound identity',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-ratio-'));
 const source=await sharp({create:{width:128,height:128,channels:3,background:'#557799'}}).png().toBuffer();
 const reference={bytes:source,mimeType:'image/png' as const,sha256:sha256(source)};
 let output=source;const requests:any[]=[];
 const intents=[{operationId:'frame',stage:'first_frame',provider:'seedream',model:'seedream-test',accountRef:'ark',maximumUnits:{inputImages:2,outputImages:1}},{operationId:'qa',stage:'first_frame_qa',provider:'qwen',model:'qwen',accountRef:'qwen',maximumUnits:{inputTokens:100,outputTokens:100}}];
 const executor=createPresenterFirstFrameStaticExecutor({} as never,{root,assertProviderBinding:async()=>{},loadReferenceFrame:async()=>reference,loadPresenterMaster:async()=>reference,loadProductReferences:async()=>[],generator:{model:'seedream-test',generate:async(request:any)=>{requests.push(structuredClone(request));return{bytes:output,mimeType:'image/png',provider:'seedream',model:'seedream-test',estimatedCostCny:0.1,providerRequestId:'fixture-receipt'};}} as never});
 const input={scope,grouping,groups:[group],group,presenter:{id:'presenter-1',assetVersion:2,qualityInspectionAllowed:false},frameOperationId:'frame',qaOperationId:'qa',paidStatic:{requirements:[],intents:intents as never,permit:{beforeSubmit:async()=>{},markOutcome:async()=>{}} as never}};
 try{
  for(const [ratio,width,height] of [['9:16',144,256],['16:9',256,144],['1:1',144,144]] as const){
   output=await sharp({create:{width,height,channels:3,background:'#557799'}}).png().toBuffer();
   const result=await executor.prepare({...input,targetAspectRatio:ratio});
   assert.equal(requests.at(-1).ratio,ratio);assert.equal(result.compositeFirstFrameSha256,sha256(output));assert.equal(result.qa.passed,false,'technical-only checks must not certify visual fidelity');
  }
  assert.equal(new Set(requests.map(value=>value.idempotencyKey)).size,3,'ratio is part of immutable supplier input identity');
  output=source;
  const invalidIntent={...intents[0]!,operationId:'frame-invalid-ratio'};
  await assert.rejects(executor.prepare({...input,targetAspectRatio:'9:16',frameOperationId:invalidIntent.operationId,paidStatic:{...input.paidStatic,intents:[...intents,invalidIntent] as never}}),/target_ratio_mismatch/);
  const count=requests.length;
  await assert.rejects(executor.prepare({...input,targetAspectRatio:'4:3'}),/target_ratio_unsupported/);
  assert.equal(requests.length,count,'unsupported ratio never submits');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('explicit target composition never substitutes catalogue source when cross-provider person rights are absent',async()=>{
 const avatarId='a'.repeat(32),voiceId='b'.repeat(32);
 const presenter={id:'presenter-1',authorized:true,assetVersion:1,avatarId,voiceId,rightsEvidence:{authorizationRef:'license://heygen/public-catalog/'+avatarId,consentRef:'license://heygen/public-catalog/'+voiceId,grantedAt:'2026-01-01',subjectAdultConfirmed:false,permittedProviders:['heygen'],permittedUses:['digital_presenter','voice_synthesis']}};
 let calls=0;
 const store={list:async(collection:string)=>{assert.equal(collection,'studio_production_defaults');return{totalItems:1,items:[{payload:{defaultPresenterId:'presenter-1',presenters:[presenter]}}]};}} as never;
 const runtime=createPresenterFirstFrameProductionRuntime(store,{prepare:async()=>{calls++;throw Error('unexpected_supplier');}});
 await assert.rejects(runtime.preparePresenterMotherFirstFrames!({scope,grouping,groups:[group],paidStatic,targetAspectRatio:'1:1'}),/default_presenter_not_authorized/);
 assert.equal(calls,0);
});


test('intro repair preserves landscape and square geometry and rejects incompatible approved frames',async()=>{
 const {ensureStrictPresenterFirstFrames}=await import('./socialContentPresenterFirstFrameRuntime.js');
 const {runVisualFfmpeg}=await import('../lib/renderVisualQuality.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-intro-geometry-'));
 try{
  for(const [width,height] of [[320,180],[240,240]]){
   const sourcePath=path.join(root,`source-${width}.mp4`),approvedPath=path.join(root,`approved-${width}.png`);
   const generated=await runVisualFfmpeg(['-y','-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=25:duration=1.2`,'-c:v','libx264','-preset','ultrafast',sourcePath]);assert.equal(generated.ok,true,generated.stderr);
   await sharp({create:{width:width*2,height:height*2,channels:3,background:'#d9e8f4'}}).png().toFile(approvedPath);
   const input={tenantId:'fixture',runId:'geometry',groupId:String(width),sourcePath,sourceSha256:sha256(await fs.readFile(sourcePath)),approvedPath,approvedSha256:sha256(await fs.readFile(approvedPath))};
   const result=await ensureStrictPresenterFirstFrames(input,{root});assert.equal(result.repaired,true);
   const decoded=await runVisualFfmpeg(['-i',result.outputPath,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],true);assert.equal(decoded.ok,true);
   const metadata=await sharp(decoded.stdout).metadata();assert.equal(metadata.width,width);assert.equal(metadata.height,height);
   await sharp({create:{width:144,height:256,channels:3,background:'#d9e8f4'}}).png().toFile(approvedPath);
   await assert.rejects(ensureStrictPresenterFirstFrames({...input,approvedSha256:sha256(await fs.readFile(approvedPath))},{root}),/repair_ratio_mismatch/);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('missing visual inspection permission blocks before any paid image submission',async()=>{
 const presenter={id:'presenter-1',authorized:true,assetVersion:2,avatarId:'avatar-1',voiceId:'voice-1',rightsEvidence:{authorizationRef:'rights://1',consentRef:'consent://1',grantedAt:'2026-01-01',subjectAdultConfirmed:true,permittedProviders:['heygen','volcengine_ark'],permittedUses:['digital_presenter','voice_synthesis','person_replacement']}};
 const store={list:async(collection:string)=>collection==='studio_production_defaults'?{totalItems:1,items:[{payload:{defaultPresenterId:'presenter-1',presenters:[presenter]}}]}:{totalItems:0,items:[]}} as never;
 let submitted=0;
 const runtime=createPresenterFirstFrameProductionRuntime(store,{prepare:async()=>{submitted++;throw Error('unexpected_submit');}});
 await assert.rejects(runtime.preparePresenterMotherFirstFrames!({scope,grouping,groups:[group],paidStatic,targetAspectRatio:'9:16'}),/quality_inspection_authorization_required/);
 assert.equal(submitted,0);
});

test('dynamic technical inspection spans the frozen mother segment, including a late blank section',async()=>{
 const digest=(text:string)=>sha256(Buffer.from(text));
 const {MEDIA_ROOT}=await import('./socialContentAutoProduction.js');
 const {tenantAssetDir}=await import('../lib/assetAccess.js');
 const {createPresenterFirstFrameApproval}=await import('./socialContentPresenterFirstFrameApproval.js');
 const {runVisualFfmpeg,inspectRenderedVisuals}=await import('../lib/renderVisualQuality.js');
 const tenantId='dynamic-range-fixture',tenantRoot=tenantAssetDir(MEDIA_ROOT,tenantId);await fs.mkdir(tenantRoot,{recursive:true});
 const root=await fs.mkdtemp(path.join(tenantRoot,'dynamic-range-'));
 try{
  const approved=path.join(root,'approved.png'),video=path.join(root,'late-blank.mp4');
  const pixels=Buffer.from(Array.from({length:192*192*3},(_,index)=>32+(Math.floor(index/3)*37%192)));
  await sharp(pixels,{raw:{width:192,height:192,channels:3}}).png().toFile(approved);
  const generated=await runVisualFfmpeg(['-y','-loop','1','-i',approved,'-f','lavfi','-i','color=c=black:s=192x192:r=25:d=6','-filter_complex','[0:v]trim=duration=4,setpts=PTS-STARTPTS,setsar=1[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v]','-map','[v]','-t','10','-r','25','-c:v','libx264','-pix_fmt','yuv420p',video]);assert.equal(generated.ok,true,generated.stderr);
  assert.equal((await inspectRenderedVisuals({outputPath:video,expectedDuration:4})).passed,true,'old four-second sampling misses the late defect');
  const rows:any[]=[];
  const store={list:async()=>({items:rows,totalItems:rows.length}),create:async(_collection:string,value:unknown)=>{const row={id:'approval',...(value as object)};rows.push(row);return row;}} as never;
  await createPresenterFirstFrameApproval(store,{...scope,planHash:digest('plan'),tenantId,groupId:'group-a',presenterGroupContractHash:digest('group'),referenceCompositionHashes:[digest('composition')],backgroundPlateSha256:digest('background'),personRemovalEvidence:{receiptRef:'seedream:fixture',sourceSha256:digest('source'),outputSha256:digest('removed')},presenter:{assetId:'presenter-1',assetVersion:1,authorizationRef:'rights:fixture',consentRef:'consent:fixture',providerId:'heygen',providerPresenterId:'avatar',providerVoiceId:'voice'},compositeFirstFrameSha256:sha256(await fs.readFile(approved)),compositeFirstFrameUrl:'/media/'+path.relative(MEDIA_ROOT,approved),qa:{passed:true,receiptRef:'qwen:fixture',reportHash:digest('qa')},createdAt:new Date().toISOString()});
  const runtime=createPresenterFirstFrameProductionRuntime(store,undefined,{dynamicQaRoot:path.join(root,'reports')});
  await assert.rejects(runtime.evaluatePresenterMotherDynamicQa!({tenantId,taskId:scope.taskId,runId:scope.runId,segmentId:'group-a',segmentHash:digest('segment'),presenterAssetId:'presenter-1',outputPath:video,outputSha256:sha256(await fs.readFile(video)),spokenText:'fixture',durationSeconds:10}),/presenter_mother_dynamic_qa_failed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('visual-v2 static runtime binds real image bytes to paid QA and resumes both operations',async()=>{
 const {SocialContentTaskBudget}=await import('../lib/socialContentTaskBudget.js');
 const {socialPaidIntentOperation}=await import('../lib/socialContentTaskBudgetAuthority.js');
 const {createSocialContentPaidOperationPermit}=await import('../lib/socialContentPaidOperationPermit.js');
 const {storyboardQaRequiredChecks}=await import('../lib/storyboardAigcQuality.js');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'presenter-static-binding-'));
 try{
  const fundedScope={...scope,planHash:'a'.repeat(64)},pixels=await sharp({create:{width:144,height:144,channels:3,background:'#6688aa'}}).png().toBuffer();
  const intents:SocialPaidOperationIntent[]=[{operationId:'image',provider:'seedream',model:'seedream-test',accountRef:'ark',stage:'first_frame',shotId:group.groupId,inputContractHash:'b'.repeat(64),maximumUnits:{inputImages:2,outputImages:1},executionBindingPolicy:{schemaVersion:'paid-execution-binding-policy.v1' as const,parentOperationIds:[] as string[]}},{operationId:'qa',provider:'qwen',model:'qwen3-vl-plus',accountRef:'qwen',stage:'first_frame_qa',shotId:group.groupId,inputContractHash:'c'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:4096},executionBindingPolicy:{schemaVersion:'paid-execution-binding-policy.v1' as const,parentOperationIds:['image']}}];
  const operations=intents.map(intent=>socialPaidIntentOperation(fundedScope,intent));
  const ledger=new SocialContentTaskBudget(path.join(root,'ledger'),{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'owned-test-budget'}),quote:async()=>({upperBoundCny:.2,quoteRef:'test-bounded-price',validUntil:'2099-01-01'}),verifyRejection:async()=>false});await ledger.reserveBatch(fundedScope,operations);
  const permitConfig={scope:fundedScope,operations,intents,ledger,root:path.join(root,'permit'),assertCurrent:async()=>{}};
  let imageCalls=0,qaCalls=0;
  const reference={bytes:pixels,mimeType:'image/png' as const,sha256:sha256(pixels)};
  const executor=createPresenterFirstFrameStaticExecutor({} as never,{root,assertProviderBinding:async()=>{},loadReferenceFrame:async()=>reference,loadPresenterMaster:async()=>reference,loadProductReferences:async()=>[],generator:{model:'seedream-test',generate:async()=>{imageCalls++;return{bytes:pixels,mimeType:'image/png',provider:'seedream',model:'seedream-test',providerRequestId:'controlled-image',estimatedCostCny:.2};}} as never,inspect:async request=>{
   qaCalls++;await request.paidSubmission!({model:'qwen3-vl-plus',max_tokens:4096,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'fixture'}}]}]});request.onReceipt?.({id:'controlled-qa'});
   return storyboardQaRequiredChecks({phase:'first_frame',sceneType:'general',hasProduct:false,hasNamedPerson:true,hasEnvironmentReference:true,hasContact:false,hasAction:false}).map(key=>({key,verdict:'pass' as const,evidenceFrames:['候选首帧'],note:'controlled fixture'}));
  }});
  const input={scope:fundedScope,grouping,groups:[group],group,targetAspectRatio:'1:1',presenter:{id:'presenter-1',assetVersion:2},frameOperationId:'image',qaOperationId:'qa',paidStatic:{requirements:[],intents,permit:createSocialContentPaidOperationPermit(permitConfig)}};
  const first=await executor.prepare(input);assert.equal(first.qa.passed,true);
  const resumed=await executor.prepare({...input,paidStatic:{...input.paidStatic,permit:createSocialContentPaidOperationPermit(permitConfig)}});
  assert.equal(resumed.compositeFirstFrameSha256,first.compositeFirstFrameSha256);assert.equal(resumed.qa.receiptRef,first.qa.receiptRef);assert.equal(imageCalls,1);assert.equal(qaCalls,1);
  for(const id of ['image','qa']){const recovered=await input.paidStatic.permit.assertRecovery(id);assert.equal(recovered.status,'completed');assert.match(recovered.submission.executionBindingHash!,/^[a-f0-9]{64}$/);}
  assert.equal(ledger.status(fundedScope)?.retainedCny,.4);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
