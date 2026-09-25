import test from 'node:test';
import assert from 'node:assert/strict';
import { SeedanceReferenceAdapter } from './seedanceReferenceAdapter.js';

test('Seedance reference adapter submits image and video references and polls the same task', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const adapter = new SeedanceReferenceAdapter({ apiKey: 'secret-injected', model: 'seedance-endpoint', estimatedCostCnyPerSecond: 1.5, cnyPerThousandTokens: 0.02, resolution: '480p', generateAudio: false,
    transport: async (url, init) => { calls.push({ url: String(url), init: init || {} }); return calls.length === 1 ? Response.json({ id: 'task-1', status: 'queued' }) : Response.json({ id: 'task-1', status: 'succeeded', content: { video_url: 'https://output.example/video.mp4' }, usage: { completion_tokens: 2500 } }); } });
  const submitted = await adapter.submit({ characterUrl: 'https://assets.example/person.png', characterType: 'image', referenceVideoUrl: 'https://assets.example/source.mp4', ratio: '9:16', targetDurationSeconds: 5, shot: { narration: '介绍产品', digitalHuman: { preserve: '保留动作与构图' } } });
  assert.equal(submitted.externalTaskId, 'task-1');
  const body = JSON.parse(String(calls[0]!.init.body)); assert.equal(body.model, 'seedance-endpoint'); assert.equal(body.resolution, '480p'); assert.equal(body.generate_audio, false); assert.equal(body.content[1].type, 'image_url'); assert.equal(body.content[1].role, 'reference_image'); assert.equal(body.content[2].type, 'video_url'); assert.equal(body.content[2].role, 'reference_video');
  assert.deepEqual(await adapter.status('task-1'), { state: 'completed', outputUrl: 'https://output.example/video.mp4', actualCostCny: 0.05, costSourceRef: 'seedance-task:task-1:completion_tokens:2500' });
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer secret-injected');
});

test('Seedance reference adapter classifies definitive rejection and uncertain missing task id', async () => {
  const rejected = new SeedanceReferenceAdapter({ apiKey: 'x', model: 'm', estimatedCostCnyPerSecond: 1, transport: async () => Response.json({ error: { message: 'model unavailable' } }, { status: 403 }) });
  await assert.rejects(rejected.submit({ characterUrl: 'https://a.test/a.png', referenceVideoUrl: 'https://a.test/v.mp4' }), (error: any) => error.definitiveSubmissionRejection === true);
  const uncertain = new SeedanceReferenceAdapter({ apiKey: 'x', model: 'm', estimatedCostCnyPerSecond: 1, transport: async () => Response.json({ status: 'queued' }) });
  await assert.rejects(uncertain.submit({ characterUrl: 'https://a.test/a.png', referenceVideoUrl: 'https://a.test/v.mp4' }), /结果未知/);
});

test('Seedance reference adapter accepts a trusted portrait asset URI and deduplicates the same video input', async () => {
  let body: any;
  const adapter = new SeedanceReferenceAdapter({
    apiKey: 'secret-injected',
    model: 'seedance-endpoint',
    estimatedCostCnyPerSecond: 1.5,
    transport: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ id: 'task-trusted', status: 'queued' });
    },
  });
  const trustedVideo = 'asset://asset-20260925130116-xjmzj';
  const submitted = await adapter.submit({
    characterUrl: trustedVideo,
    characterType: 'video',
    referenceVideoUrl: trustedVideo,
    targetDurationSeconds: 4,
    shot: { digitalHuman: { action: '按参考视频的表演节奏重新演绎' } },
  });
  assert.equal(submitted.externalTaskId, 'task-trusted');
  assert.equal(body.content.length, 2);
  assert.deepEqual(body.content[1], {
    type: 'video_url',
    video_url: { url: trustedVideo },
    role: 'reference_video',
  });
});
