import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {firstFrameInputFingerprint,type FirstFrameRequest} from './firstFrameGenerator.js';
import {QwenFirstFrameGenerator} from './qwenFirstFrameGenerator.js';

const request=(model='qwen-test')=>{const one=Buffer.from('composition'),two=Buffer.from('presenter');const value:FirstFrameRequest={tenantId:'tenant',videoId:'video',compositionId:'front',presenterVersion:'v1',prompt:'keep composition replace presenter',ratio:'9:16',idempotencyKey:'',references:[{role:'source_composition',bytes:one,mimeType:'image/jpeg',sha256:createHash('sha256').update(one).digest('hex')},{role:'authorized_presenter',bytes:two,mimeType:'image/png',sha256:createHash('sha256').update(two).digest('hex')}]};value.idempotencyKey=firstFrameInputFingerprint(value,'qwen',model);return value;};

test('Qwen first-frame adapter sends exactly two ordered references and one image',async()=>{let body:any;const generator=new QwenFirstFrameGenerator({apiKey:'key',model:'qwen-test',estimatedCostCny:.22,transport:async(url,init)=>{if(String(url).includes('/images/generations')){body=JSON.parse(String(init?.body));return new Response(JSON.stringify({data:[{url:'https://output.example/frame.jpg'}],request_id:'qwen-1'}),{status:200,headers:{'content-type':'application/json'}});}return new Response(Buffer.from('image'),{status:200,headers:{'content-type':'image/jpeg'}});}});const result=await generator.generate(request());assert.equal(body.n,1);assert.equal(body.size,'1024*1792');assert.equal(body.image.length,2);assert.match(body.image[0],/^data:image\/jpeg/);assert.match(body.image[1],/^data:image\/png/);assert.equal(result.provider,'qwen');assert.equal(result.providerRequestId,'qwen-1');});

test('Qwen first-frame adapter never retries an uncertain request',async()=>{let calls=0;const generator=new QwenFirstFrameGenerator({apiKey:'key',model:'qwen-test',transport:async()=>{calls++;throw new Error('timeout');}});await assert.rejects(()=>generator.generate(request()),/状态未知/);assert.equal(calls,1);});
