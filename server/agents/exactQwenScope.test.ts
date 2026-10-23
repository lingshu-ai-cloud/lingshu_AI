import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {assertExactQwenRequestModel,withExactQwenScope,exactQwenScope} from './exactQwenScope.js';import {analyzeVideoFramesWithQwen,analyzeVideoTimelineDetailsWithQwen} from './qwen.js';
import {permitsCrossProviderHookMotionInspection,referenceNarrationForVideoAnalysis} from '../routes/videos.js';
import {RecordWorkRegistry} from '../lib/downloadExecution.js';import {AnalysisLeaseRegistry} from '../lib/analysisLease.js';
test('actual Qwen request selects only authorized scoped model and provider; environment restored and SDK does not retry 404',async t=>{
 const before={key:process.env.DASHSCOPE_API_KEY,url:process.env.DASHSCOPE_BASE_URL,model:process.env.QWEN_EXACT_VL_MODEL};process.env.DASHSCOPE_API_KEY='isolated-test-key';process.env.DASHSCOPE_BASE_URL='https://isolated.invalid/v1';process.env.QWEN_EXACT_VL_MODEL='unchanged-global-model';t.after(()=>{for(const [k,v]of Object.entries({DASHSCOPE_API_KEY:before.key,DASHSCOPE_BASE_URL:before.url,QWEN_EXACT_VL_MODEL:before.model}))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 let calls=0;t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{calls++;const request=input instanceof Request?input:new Request(input,init);assert.equal(request.url,'https://isolated.invalid/v1/chat/completions');const body=await request.json() as any;assert.equal(body.model,'human-approved-plus');return new Response(JSON.stringify({error:{message:'Model not exist.',type:'model_not_found'}}),{status:404,headers:{'content-type':'application/json'}});});
 const receipts:any[]=[];const scope={model:'human-approved-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:createHash('sha256').update('isolated-test-key').digest('hex'),onProviderReceipt:async(receipt:any)=>{receipts.push(receipt);}};
 await assert.rejects(withExactQwenScope(scope,()=>analyzeVideoTimelineDetailsWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],timeline:{boundaries:[{id:'b1',start:0,end:1,reason:'real test clock'}]} as any})),/Model not exist/);assert.equal(calls,1);assert.equal(exactQwenScope(),undefined);assert.equal(process.env.QWEN_EXACT_VL_MODEL,'unchanged-global-model');
 assert.equal(receipts.length,1);assert.deepEqual({...receipts[0],requestHash:'redacted',receivedAt:'redacted'}, {provider:'qwen',responseId:null,model:null,usage:null,httpStatus:404,requestModel:'human-approved-plus',requestHash:'redacted',receivedAt:'redacted',responseBodySha256:createHash('sha256').update(JSON.stringify({error:{message:'Model not exist.',type:'model_not_found'}})).digest('hex'),providerRequestId:null});assert.ok(Number.isFinite(Date.parse(receipts[0].receivedAt)));
 await assert.rejects(withExactQwenScope({...scope,credentialDigest:'a'.repeat(64)},()=>analyzeVideoTimelineDetailsWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],timeline:{boundaries:[{id:'b1',start:0,end:1}]}} as any)),/provider_binding_changed/);assert.equal(calls,1);
});
test('scoped Qwen paid POST rejects 307 and 308 without replaying credentials or body',async t=>{
 const before={key:process.env.DASHSCOPE_API_KEY,url:process.env.DASHSCOPE_BASE_URL};
 process.env.DASHSCOPE_API_KEY='isolated-redirect-key';
 let redirectStatus=307,originalCalls=0,targetCalls=0;
 const server=createServer((request,response)=>{
  if(request.url==='/redirect-target'){targetCalls++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');return;}
  originalCalls++;response.writeHead(redirectStatus,{location:'/redirect-target'});response.end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));for(const[k,v]of Object.entries({DASHSCOPE_API_KEY:before.key,DASHSCOPE_BASE_URL:before.url}))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 const address=server.address();assert.ok(address&&typeof address==='object');
 const endpoint=`http://127.0.0.1:${address.port}/v1`;process.env.DASHSCOPE_BASE_URL=endpoint;
 let claims=0,receipts=0;
 const binding={model:'human-approved-plus',configurationHash:'frozen',endpoint,credentialDigest:createHash('sha256').update('isolated-redirect-key').digest('hex'),paidGuardRequired:true,
  beforeProviderRequest:async()=>{claims++;},onProviderReceipt:async()=>{receipts++;}};
 for(const status of [307,308]){
  redirectStatus=status;
  await assert.rejects(withExactQwenScope(binding,()=>analyzeVideoTimelineDetailsWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],timeline:{boundaries:[{id:'b1',start:0,end:1,reason:'redirect test'}]} as any})));
 }
 assert.equal(originalCalls,2);assert.equal(targetCalls,0);assert.equal(claims,2);assert.equal(receipts,0);
});
test('scoped paid request refuses a child model change before HTTP transport',async()=>{
 const binding={model:'human-approved-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:'a'.repeat(64)};
 await withExactQwenScope(binding,async()=>{
  assert.doesNotThrow(()=>assertExactQwenRequestModel(JSON.stringify({model:binding.model})));
  assert.throws(()=>assertExactQwenRequestModel(JSON.stringify({model:'unapproved-child-model'})),/request_scope_changed/);
  assert.throws(()=>assertExactQwenRequestModel('{broken'),/request_unreadable/);
 });
});
test('authorized exact scope also binds the coarse strategy-shaped vision pass',async t=>{
 const before={key:process.env.DASHSCOPE_API_KEY,url:process.env.DASHSCOPE_BASE_URL,vision:process.env.QWEN_VL_MODEL};process.env.DASHSCOPE_API_KEY='isolated-test-key';process.env.DASHSCOPE_BASE_URL='https://isolated.invalid/v1';process.env.QWEN_VL_MODEL='unapproved-coarse-model';t.after(()=>{for(const[k,v]of Object.entries({DASHSCOPE_API_KEY:before.key,DASHSCOPE_BASE_URL:before.url,QWEN_VL_MODEL:before.vision}))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 let calls=0;t.mock.method(globalThis,'fetch',async(input:any,init:any)=>{calls++;const request=input instanceof Request?input:new Request(input,init),body=await request.json() as any;assert.equal(body.model,'human-approved-plus');assert.notEqual(body.model,'unapproved-coarse-model');return new Response(JSON.stringify({error:{message:'stop after binding assertion',type:'test'}}),{status:400,headers:{'content-type':'application/json'}});});
 const binding={model:'human-approved-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:createHash('sha256').update('isolated-test-key').digest('hex')};
 await assert.rejects(withExactQwenScope(binding,()=>analyzeVideoFramesWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],analysisMode:'strategy'})),/stop after binding assertion/);assert.equal(calls,1);assert.equal(exactQwenScope(),undefined);
});
test('future successful SDK response records actual provider identity and usage, not requested model as a substitute',async t=>{
 const before={key:process.env.DASHSCOPE_API_KEY,url:process.env.DASHSCOPE_BASE_URL};process.env.DASHSCOPE_API_KEY='isolated-test-key';process.env.DASHSCOPE_BASE_URL='https://isolated.invalid/v1';t.after(()=>{for(const[k,v]of Object.entries({DASHSCOPE_API_KEY:before.key,DASHSCOPE_BASE_URL:before.url}))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({id:'actual-provider-response',model:'provider-returned-model',usage:{prompt_tokens:123,completion_tokens:45},choices:[{message:{content:JSON.stringify({summary:{theme:'observed'},shots:[{boundaryId:'b1',visual:'real test observation',materialType:'product',narrativeRole:'hook',classificationEvidence:'原帧可见实际产品瓶身',needsReview:false}]})},finish_reason:'stop'}]}),{status:200,headers:{'content-type':'application/json'}}));
 const receipts:unknown[]=[];const binding={model:'human-approved-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:createHash('sha256').update('isolated-test-key').digest('hex'),onProviderReceipt:async(r:unknown)=>{receipts.push(r);}};
 await withExactQwenScope(binding,()=>analyzeVideoTimelineDetailsWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],timeline:{boundaries:[{id:'b1',start:0,end:1,reason:'real test clock'}]} as any}));
 assert.equal(receipts.length,1);const receipt=receipts[0] as any;assert.equal(receipt.responseId,'actual-provider-response');assert.equal(receipt.model,'provider-returned-model');assert.equal(receipt.requestModel,'human-approved-plus');assert.deepEqual(receipt.usage,{prompt_tokens:123,completion_tokens:45});assert.match(receipt.requestHash,/^[a-f0-9]{64}$/);assert.equal(exactQwenScope(),undefined);
});
test('scoped visual revision reuses ASR cache only and disables cross-provider hook enrichment',async()=>{
 const binding={model:'human-approved-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:'a'.repeat(64)};
 let cached=0,submitted=0;
 await withExactQwenScope(binding,async()=>{
  assert.equal(permitsCrossProviderHookMotionInspection(),false);
  const missing=await referenceNarrationForVideoAnalysis('/not-read.mp4',12,'tenant',{readCached:()=>{cached++;return null;},prepare:async()=>{submitted++;throw Error('must not submit');}});
  assert.equal((missing as any).alignmentError,'scoped_visual_revision_has_no_asr_authorization');
  const existing={text:'measured',segments:[],words:[{text:'measured',start:0,end:1}],alignmentStatus:'aligned'} as any;
  assert.equal(await referenceNarrationForVideoAnalysis('/not-read.mp4',12,'tenant',{readCached:()=>{cached++;return existing;},prepare:async()=>{submitted++;throw Error('must not submit');}}),existing);
  const failedCache=await referenceNarrationForVideoAnalysis('/not-read.mp4',12,'tenant',{readCached:()=>{cached++;throw Error('千问词级对齐FAILED');},prepare:async()=>{submitted++;throw Error('must not submit');}});
  assert.equal((failedCache as any).alignmentError,'scoped_visual_revision_cached_asr_unavailable');
 });
 assert.equal(cached,3);assert.equal(submitted,0);assert.equal(permitsCrossProviderHookMotionInspection(),true);
});
test('exact scope survives dynamic import, in-process registry and durable analysis lease',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'exact-scope-lease-'));
 try{const binding={model:'human-approved-plus',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:'a'.repeat(64)};
  await withExactQwenScope(binding,async()=>{
   await import('../routes/videos.js');assert.equal(exactQwenScope()?.model,binding.model);
   await new RecordWorkRegistry().run('candidate',async()=>{await Promise.resolve();assert.equal(exactQwenScope()?.model,binding.model);
    await new AnalysisLeaseRegistry(root).run('candidate',async()=>{await Promise.resolve();assert.equal(exactQwenScope()?.model,binding.model);});
   });
  });
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
