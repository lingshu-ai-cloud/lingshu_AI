import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';

test('tsx eval CJS scope survives dynamic ESM route import and forbids ASR prepare',async()=>{
  const tsx=path.resolve('node_modules/.bin/tsx');
  const source=`(async()=>{
    process.env.DASHSCOPE_API_KEY='isolated-test-key';process.env.DASHSCOPE_BASE_URL='https://isolated.invalid/v1';process.env.QWEN_VL_MODEL='wrong-default-model';
    const exact=await import('./server/agents/exactQwenScope.js');
    let requestedModel='',receipt=null;globalThis.fetch=async(input,init)=>{const request=input instanceof Request?input:new Request(input,init);requestedModel=(await request.json()).model;return new Response(JSON.stringify({error:{message:'stop-after-scope-check'}}),{status:404,headers:{'content-type':'application/json'}});};
    const result=await exact.withExactQwenScope({model:'scope-marker',configurationHash:'frozen',endpoint:'https://isolated.invalid/v1',credentialDigest:(await import('node:crypto')).createHash('sha256').update('isolated-test-key').digest('hex'),onProviderReceipt:async value=>{receipt=value;}},async()=>{
      const routes=await import('./server/routes/videos.js');let prepares=0;
      const narration=await routes.referenceNarrationForVideoAnalysis('/must-not-open.mp4',1,'tenant',{readCached:()=>null,prepare:async()=>{prepares++;return {text:'UNSCOPED_PREPARE',segments:[],words:[],alignmentStatus:'aligned'};}});
      const qwen=await import('./server/agents/qwen.js');try{await qwen.analyzeVideoFramesWithQwen({frames:[{base64:'isolated',mimeType:'image/jpeg',timeLabel:'0s'}],analysisMode:'strategy'});}catch{}
      return {outer:exact.exactQwenScope()?.model,innerText:narration.text,alignmentError:narration.alignmentError,prepares,requestedModel,receiptStatus:receipt?.httpStatus,receiptModel:receipt?.requestModel};
    });process.stdout.write(JSON.stringify(result));
  })().catch(error=>{console.error(error);process.exitCode=1;});`;
  const {stdout}=await promisify(execFile)(tsx,['-e',source],{cwd:process.cwd(),env:{...process.env}});
  assert.deepEqual(JSON.parse(stdout),{outer:'scope-marker',innerText:'',alignmentError:'scoped_visual_revision_has_no_asr_authorization',prepares:0,requestedModel:'scope-marker',receiptStatus:404,receiptModel:'scope-marker'});
});
