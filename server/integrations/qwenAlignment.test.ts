import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { alignQwenFile, trustedQwenTranscriptionUrl, verifiedAudioCues } from './qwenAlignment.js';

test('accepts the official DashScope OSS result host without opening external download hosts', () => {
  const url = trustedQwenTranscriptionUrl('http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json?signature=sample');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'dashscope-result-bj.oss-cn-beijing.aliyuncs.com');
  assert.equal(url.search, '?signature=sample');
  assert.equal(trustedQwenTranscriptionUrl('https://oss-cn-beijing.aliyuncs.com/result.json').hostname,
    'oss-cn-beijing.aliyuncs.com');
  for (const value of [
    'https://oss-cn-beijing.aliyuncs.com.evil.test/result.json',
    'https://evil.oss-cn-beijing.aliyuncs.com.evil.test/result.json',
    'https://user@oss-cn-beijing.aliyuncs.com/result.json',
    'file:///tmp/result.json',
    'https://example.com/result.json',
  ]) assert.throws(() => trustedQwenTranscriptionUrl(value), /不可信/);
});

test('retains measured source sentence boundaries for matching spoken copy', () => {
  const raw = { transcripts: [{ text: 'Hello world.', sentences: [
    { text: 'Hello world.', begin_time: 120, end_time: 1880 },
  ] }] };
  assert.deepEqual(verifiedAudioCues(raw, 'Hello world.', 2), [{ text: 'Hello world.', start: 0.12, end: 1.88 }]);
  assert.throws(() => verifiedAudioCues(raw, 'Different words.', 2), /实际音频与口播文本不一致/);
});

test('file transcription downloads an official signed result and bounds its size', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-qwen-alignment-'));
  const priorFetch = globalThis.fetch;
  const priorKey = process.env.DASHSCOPE_API_KEY;
  let oversized = false;
  let downloadUrl = '';
  process.env.DASHSCOPE_API_KEY = 'test-key';
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/services/audio/asr/transcription')) return Response.json({ output: { task_id: 'task-test' } });
    if (url.endsWith('/tasks/task-test')) return Response.json({ output: { task_status: 'SUCCEEDED', result: {
      transcription_url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.json?signature=sample',
    } } });
    downloadUrl = url;
    return oversized
      ? new Response(new Uint8Array(8 * 1024 * 1024 + 1))
      : Response.json({ transcripts: [{ text: 'Hello world.', sentences: [
        { text: 'Hello world.', begin_time: 120, end_time: 1880 },
      ] }] });
  }) as typeof fetch;
  try {
    assert.deepEqual(await alignQwenFile('https://assets.example.test/source.mp3', 'Hello world.', 2,
      path.join(dir, 'good.json')), [{ text: 'Hello world.', start: 0.12, end: 1.88 }]);
    assert.match(downloadUrl, /^https:\/\/dashscope-result-bj\.oss-cn-beijing\.aliyuncs\.com\/result\.json\?signature=sample$/);
    oversized = true;
    await assert.rejects(alignQwenFile('https://assets.example.test/source.mp3', 'Hello world.', 2,
      path.join(dir, 'large.json')), /音频字幕文件过大/);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = priorKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('paid alignment fences unknown POST across workspace cleanup and never resubmits',async()=>{
 const {withStudioVoicePaidContext}=await import('../lib/studioVoicePaidOperation.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'paid-alignment-durable-'));const workspace=path.join(root,'workspace');fs.mkdirSync(workspace);
 const priorFetch=globalThis.fetch;let posts=0;globalThis.fetch=(async()=>{posts++;throw Error('controlled ambiguous transport');}) as typeof fetch;
 const context:any={primaryProvider:'qwen',forRequest:async()=>({intent:{operationId:'alignment-once',provider:'qwen',model:'qwen3-asr-flash-filetrans',stage:'voice_alignment',accountRef:'fixture',shotId:null,inputContractHash:'a'.repeat(64),maximumUnits:{audioSeconds:300}},assertProviderBinding:async()=>{},measureUsage:async()=>({audioSeconds:2}),persistProviderReceipt:async()=>{throw Error('no accepted receipt');},permit:{beforeSubmit:async()=>{},assertRecovery:async()=>{},markOutcome:async()=>{}}})};
 try {
  const run=()=>withStudioVoicePaidContext(context,()=>alignQwenFile('https://controlled.test/audio.wav','Hello world.',2,path.join(workspace,'cache.json'),{audioSha256:'b'.repeat(64),durableRoot:path.join(root,'stable')}));
  await assert.rejects(run(),/controlled ambiguous transport/);fs.rmSync(workspace,{recursive:true});
  await assert.rejects(run(),/submission_unknown_no_repost/);assert.equal(posts,1);
  await assert.rejects(withStudioVoicePaidContext(context,()=>alignQwenFile('https://controlled.test/audio.wav','Changed speech.',2,'unused',{audioSha256:'b'.repeat(64),durableRoot:path.join(root,'stable')})),/original_scope_changed/);
 }finally {globalThis.fetch=priorFetch;fs.rmSync(root,{recursive:true,force:true});}
});

test('accepted alignment original receipt recovers task ID after crash without another POST',async()=>{
 const {withStudioVoicePaidContext}=await import('../lib/studioVoicePaidOperation.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alignment-accepted-recovery-'));
 const originalFetch=global.fetch;let posts=0,queries=0,crash=true;
 const acceptedReceipt=path.join(root,'original-accepted.json');let recovery:any;
 const intent={operationId:'accepted-alignment-once',provider:'qwen',model:'qwen3-asr-flash-filetrans',stage:'voice_alignment',accountRef:'controlled',shotId:null,inputContractHash:'a'.repeat(64),maximumUnits:{audioSeconds:300}};
 const context:any={primaryProvider:'qwen',forRequest:async(request:any)=>({intent,assertProviderBinding:async()=>{},measureUsage:async()=>({audioSeconds:2}),
  persistProviderReceipt:async(receipt:any)=>{fs.writeFileSync(acceptedReceipt,JSON.stringify({...receipt,operationId:intent.operationId,inputContractHash:intent.inputContractHash,accountKeyHash:request.accountKeyHash}),{mode:0o600});return acceptedReceipt;},
  permit:{beforeSubmit:async()=>{},assertRecovery:async()=>recovery,markOutcome:async(_id:string,status:string,receiptRef:string)=>{recovery={status,receiptRef};if(status==='accepted'&&crash){crash=false;throw Error('controlled crash after accepted receipt');}}}})};
 global.fetch=async(url:any,init:any)=>{
  if(init?.method==='POST'){posts++;return new Response(JSON.stringify({output:{task_id:'original-accepted-task'}}));}
  if(String(url).endsWith('/tasks/original-accepted-task')){queries++;return new Response(JSON.stringify({output:{task_status:'SUCCEEDED',result:{transcription_url:'https://controlled.oss-cn-beijing.aliyuncs.com/result.json'}}}));}
  if(String(url)==='https://controlled.oss-cn-beijing.aliyuncs.com/result.json')return new Response(JSON.stringify({transcripts:[{text:'Hello world.',sentences:[{begin_time:100,end_time:1500,text:'Hello world.'}]}]}));
  throw Error('unexpected original recovery request');
 };
 try {
  const run=()=>withStudioVoicePaidContext(context,()=>alignQwenFile('https://owned.example/audio.wav','Hello world.',2,'unused-workspace',{audioSha256:'b'.repeat(64),durableRoot:path.join(root,'stable')}));
  await assert.rejects(run(),/controlled crash/);
  assert.deepEqual(await run(),[{start:.1,end:1.5,text:'Hello world.'}]);
  assert.equal(posts,1);assert.equal(queries,1);
  assert.deepEqual(await run(),[{start:.1,end:1.5,text:'Hello world.'}]);
  assert.equal(posts,1);assert.equal(queries,1);
 }finally{global.fetch=originalFetch;fs.rmSync(root,{recursive:true,force:true});}
});
