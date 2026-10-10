import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { FirstFrameProviderError, firstFrameInputFingerprint, type FirstFrameRequest } from './firstFrameGenerator.js';
import { SeedreamFirstFrameGenerator } from './seedreamFirstFrameGenerator.js';

function request(): FirstFrameRequest {
  const source = Buffer.from('source'); const presenter = Buffer.from('presenter');
  const input: FirstFrameRequest = { tenantId: 'tenant-a', videoId: 'video-a', compositionId: 'medium-front', presenterVersion: 'presenter-v1', prompt: '保持图一构图，以图二人物替换主体。', ratio: '9:16', idempotencyKey: '', references: [
    { role: 'source_composition', bytes: source, mimeType: 'image/jpeg', sha256: createHash('sha256').update(source).digest('hex') },
    { role: 'authorized_presenter', bytes: presenter, mimeType: 'image/jpeg', sha256: createHash('sha256').update(presenter).digest('hex') },
  ] };
  input.idempotencyKey = firstFrameInputFingerprint(input, 'seedream', 'seedream-test'); return input;
}

test('Seedream creates exactly one final frame from the two allowed references', async () => {
  let sent: any;
  const generator = new SeedreamFirstFrameGenerator({ apiKey: 'key', model: 'seedream-test', estimatedCostCny: 0.22, transport: (async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({ model: 'seedream-test', data: [{ b64_json: Buffer.from('final-frame').toString('base64') }] }, { headers: { 'x-request-id': 'provider-1' } });
  }) as typeof fetch });
  const result = await generator.generate(request());
  assert.equal(result.bytes.toString(), 'final-frame'); assert.equal(result.providerRequestId, 'provider-1');
  assert.equal(sent.response_format, 'url');
  assert.equal(sent.image.length, 2); assert.equal(sent.size, '1600x2848');
  assert.deepEqual(Object.keys(sent).sort(), ['image', 'model', 'output_format', 'prompt', 'response_format', 'size', 'watermark']);
});

test('Seedream network ambiguity is surfaced as uncertain and never silently retried', async () => {
  let calls = 0; const generator = new SeedreamFirstFrameGenerator({ apiKey: 'key', model: 'seedream-test', transport: (async () => { calls += 1; throw new Error('socket closed'); }) as typeof fetch });
  await assert.rejects(() => generator.generate(request()), (error: unknown) => error instanceof FirstFrameProviderError && error.status === 'uncertain');
  assert.equal(calls, 1);
});

test('Seedream supports a prompt-only storyboard scene and does not invoke a fallback provider', async () => {
  let calls = 0; let sent: any;
  const generator = new SeedreamFirstFrameGenerator({ apiKey: 'key', model: 'seedream-test', transport: (async (_url, init) => {
    calls += 1; sent = JSON.parse(String(init?.body));
    return Response.json({ model: 'seedream-test', data: [{ b64_json: Buffer.from('storyboard-frame').toString('base64') }] });
  }) as typeof fetch });
  const input: FirstFrameRequest = { tenantId: 'tenant-a', videoId: 'project-a', compositionId: 'shot-a',
    presenterVersion: 'shot-fingerprint', prompt: 'Create a clean factory scene.', ratio: '16:9',
    referenceMode: 'storyboard_scene', references: [], idempotencyKey: 'storyboard-request-a' };
  const result = await generator.generate(input);
  assert.equal(result.provider, 'seedream'); assert.equal(calls, 1);
  assert.equal(sent.model, 'seedream-test'); assert.equal('image' in sent, false);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FirstFrameBudget } from './firstFrameBudget.js';
import { produceFirstFrame } from './firstFrameProduction.js';

for (const status of [302, 408, 409, 429, 500, 502, 503, 504]) {
  test(`Seedream HTTP ${status} preserves the original reserved operation without a second generation`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedream-uncertain-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let calls = 0;
    const generator = new SeedreamFirstFrameGenerator({ apiKey: 'controlled-key', model: 'seedream-test', transport: async () => {
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

test('Seedream explicit authorization rejection releases reservation without recording an accepted task', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedream-rejected-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const generator = new SeedreamFirstFrameGenerator({ apiKey: 'controlled-key', model: 'seedream-test', transport: async () => {
    calls++;
    return Response.json({ error: { message: 'authorization denied' } }, { status: 403 });
  } });
  const budget = new FirstFrameBudget(root, () => 2, () => 3), input = request();
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(produceFirstFrame(input, generator, { budget }), error => error instanceof FirstFrameProviderError && error.status === 'rejected');
  assert.equal(calls, 2);
});

test('Seedream generation and image download refuse redirects while the download carries no API credential', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const generator = new SeedreamFirstFrameGenerator({ apiKey: 'controlled-key', model: 'seedream-test', transport: async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return Response.json({ data: [{ url: 'https://output.invalid/frame.jpg' }] });
    return new Response(Buffer.from('controlled-image'), { headers: { 'content-type': 'image/jpeg' } });
  } });
  await generator.generate(request());
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.init?.redirect === 'error'));
  assert.equal(new Headers(calls[1]!.init?.headers).has('Authorization'), false);
});

test('Seedream interrupted artifact body preserves provider ID and blocks paid replay', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedream-body-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const generator = new SeedreamFirstFrameGenerator({ apiKey: 'controlled-key', model: 'seedream-test', transport: async (_url, init) => {
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
