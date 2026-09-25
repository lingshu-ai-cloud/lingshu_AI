import assert from 'node:assert/strict';
import test from 'node:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateSeedanceConceptVideo, generateVeoConceptVideo } from './generativeVideoGateway.js';

test('Seedance concept gateway is text-only, budgeted and records the supplier task', async () => {
  const requests: Array<{ url: string; body?: any }> = [];
  const transport: typeof fetch = async (url, init) => {
    const address = String(url);
    requests.push({ url: address, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (address.endsWith('/contents/generations/tasks')) return Response.json({ id: 'task-concept-1' });
    if (address.includes('/tasks/task-concept-1')) {
      return Response.json({ status: 'succeeded', content: { video_url: 'https://media.example/concept.mp4' } });
    }
    return new Response(Buffer.from('video-bytes'), { status: 200, headers: { 'content-type': 'video/mp4' } });
  };
  const result = await generateSeedanceConceptVideo({
    tenantId: 'tenant-a', prompt: 'abstract green particles', durationSeconds: 5, ratio: '9:16',
    idempotencyKey: 'stable-key', timeoutMs: 1_000, apiKey: 'secret', model: 'seedance-test',
    transport, pollMs: 1,
    reserveBudget: () => ({ ok: true, reservationId: 'budget-1', limitCny: 20, usedCny: 7.5, reservedCny: 7.5, remainingCny: 12.5 }),
    releaseBudget: () => { throw new Error('accepted task budget must not be released'); },
  });
  assert.equal(result.providerTaskId, 'task-concept-1');
  assert.equal(result.bytes.toString(), 'video-bytes');
  const submitted = requests[0]!.body;
  assert.deepEqual(submitted.content, [{ type: 'text', text: 'abstract green particles' }]);
  assert.equal(JSON.stringify(submitted).includes('image_url'), false);
  assert.equal(submitted.generate_audio, false);
});

test('Seedance concept gateway releases reservation only when submission was not accepted', async () => {
  const released: string[] = [];
  await assert.rejects(generateSeedanceConceptVideo({
    tenantId: 'tenant-a', prompt: 'abstract', durationSeconds: 5, ratio: '9:16',
    idempotencyKey: 'stable-key', timeoutMs: 100, apiKey: 'secret', model: 'seedance-test',
    transport: async () => Response.json({ status: 'queued' }),
    reserveBudget: () => ({ ok: true, reservationId: 'budget-2', limitCny: 20, usedCny: 7.5, reservedCny: 7.5, remainingCny: 12.5 }),
    releaseBudget: (_tenantId, reservationId) => { released.push(reservationId); },
  }), /提交结果未知/);
  assert.deepEqual(released, ['budget-2']);
});

test('Veo concept gateway consumes only a controlled worker output file', async () => {
  const outputDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'veo-gateway-'));
  await fsp.writeFile(path.join(outputDirectory, 'result.mp4'), Buffer.from('veo-video'));
  const result = await generateVeoConceptVideo({
    tenantId: 'tenant-a', prompt: 'abstract nodes', durationSeconds: 5, ratio: '9:16',
    idempotencyKey: 'veo-key', timeoutMs: 1_000, model: 'veo-test', outputDirectory,
    estimatedCostCny: 4,
    worker: async job => {
      assert.equal(job.idempotencyKey, 'veo-key');
      return { ok: true, id: 'operation-1', file: 'result.mp4', model: 'veo-test' };
    },
  });
  assert.equal(result.providerTaskId, 'operation-1');
  assert.equal(result.bytes.toString(), 'veo-video');
});
