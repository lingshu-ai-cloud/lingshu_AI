import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {firstFrameInputFingerprint,type FirstFrameRequest} from './firstFrameGenerator.js';
import {QwenFirstFrameGenerator} from './qwenFirstFrameGenerator.js';

const request=(model='qwen-test')=>{const one=Buffer.from('composition'),two=Buffer.from('presenter');const value:FirstFrameRequest={tenantId:'tenant',videoId:'video',compositionId:'front',presenterVersion:'v1',prompt:'keep composition replace presenter',ratio:'9:16',idempotencyKey:'',references:[{role:'source_composition',bytes:one,mimeType:'image/jpeg',sha256:createHash('sha256').update(one).digest('hex')},{role:'authorized_presenter',bytes:two,mimeType:'image/png',sha256:createHash('sha256').update(two).digest('hex')}]};value.idempotencyKey=firstFrameInputFingerprint(value,'qwen',model);return value;};

test('Qwen first-frame adapter sends exactly two ordered references and one image',async()=>{let body:any;const generator=new QwenFirstFrameGenerator({apiKey:'key',model:'qwen-test',estimatedCostCny:.22,transport:async(url,init)=>{if(String(url).includes('/images/generations')){body=JSON.parse(String(init?.body));return new Response(JSON.stringify({data:[{url:'https://output.example/frame.jpg'}],request_id:'qwen-1'}),{status:200,headers:{'content-type':'application/json'}});}return new Response(Buffer.from('image'),{status:200,headers:{'content-type':'image/jpeg'}});}});const result=await generator.generate(request());assert.equal(body.n,1);assert.equal(body.size,'1024*1792');assert.equal(body.image.length,2);assert.match(body.image[0],/^data:image\/jpeg/);assert.match(body.image[1],/^data:image\/png/);assert.equal(result.provider,'qwen');assert.equal(result.providerRequestId,'qwen-1');});

test('Qwen first-frame adapter never retries an uncertain request',async()=>{let calls=0;const generator=new QwenFirstFrameGenerator({apiKey:'key',model:'qwen-test',transport:async()=>{calls++;throw new Error('timeout');}});await assert.rejects(()=>generator.generate(request()),/状态未知/);assert.equal(calls,1);});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FirstFrameBudget } from './firstFrameBudget.js';
import { produceFirstFrame } from './firstFrameProduction.js';
import { FirstFrameProviderError } from './firstFrameGenerator.js';
for (const status of [302, 408, 409, 429, 500, 502, 503, 504]) {
  test(`Qwen HTTP ${status} preserves the original reserved operation without a second generation`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-uncertain-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let calls = 0;
    const generator = new QwenFirstFrameGenerator({ apiKey: 'controlled-key', model: 'qwen-test', transport: async () => {
      calls++;
      return Response.json({ error: { message: 'controlled uncertain outcome' } }, { status, headers: { 'x-request-id': 'original-provider-request' } });
    } });
    const budget = new FirstFrameBudget(root, () => 2, () => 3), input = request();
    await assert.rejects(produceFirstFrame(input, generator, { budget }), error => error instanceof FirstFrameProviderError && error.status === 'uncertain' && error.providerRequestId === 'original-provider-request');
    await assert.rejects(produceFirstFrame(input, generator, { budget }), /禁止自动重提/);
    const reservation = await budget.reserve({ tenantId: input.tenantId, videoId: input.videoId, operationId: input.idempotencyKey, compositionId: input.compositionId, estimatedCostCny: generator.estimatedCostCny });
    assert.equal(reservation.existing, true);
    assert.equal(reservation.entry.status, 'uncertain');
    assert.equal(reservation.entry.output?.providerRequestId, 'original-provider-request');
    assert.equal(reservation.entry.amountMicros, 220000);
    assert.equal(calls, 1);
  });
}


test('Qwen interrupted artifact body preserves provider ID and blocks paid replay', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-body-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const generator = new QwenFirstFrameGenerator({ apiKey: 'controlled-key', model: 'qwen-test', transport: async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'error');
    if (calls === 1) return Response.json({ data: [{ url: 'https://output.invalid/frame.jpg' }] }, { headers: { 'x-request-id': 'accepted-original-task' } });
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error('controlled body interrupted')); } }));
  } });
  const budget = new FirstFrameBudget(root, () => 2, () => 3), input = request();
  await assert.rejects(produceFirstFrame(input, generator, { budget }), error => error instanceof FirstFrameProviderError && error.status === 'uncertain' && error.providerRequestId === 'accepted-original-task');
  await assert.rejects(produceFirstFrame(input, generator, { budget }), /禁止自动重提/);
  const reservation = await budget.reserve({ tenantId: input.tenantId, videoId: input.videoId, operationId: input.idempotencyKey, compositionId: input.compositionId, estimatedCostCny: generator.estimatedCostCny });
  assert.equal(reservation.entry.output?.providerRequestId, 'accepted-original-task');
  assert.equal(reservation.entry.status, 'uncertain');
  assert.equal(calls, 2);
});
