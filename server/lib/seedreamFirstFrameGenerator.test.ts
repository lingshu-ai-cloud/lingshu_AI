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
