import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSeedanceSentenceVideo } from './seedanceImageVideo.js';

test('Seedance sentence generation uses only the rebuilt target frame and records the supplier task id', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []; let polls = 0; const submitted: string[] = [];
  const transport = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'task-123' }), { status: 200 });
    polls += 1; return new Response(JSON.stringify(polls === 1 ? { id: 'task-123', status: 'running' } : { id: 'task-123', status: 'completed', content: { video_url: 'https://cdn.example/result.mp4' } }), { status: 200 });
  }) as typeof fetch;
  const result = await generateSeedanceSentenceVideo({ apiKey: 'secret', model: 'seedance-test', imageUrl: 'https://signed.example/target.png', prompt: 'say hello', duration: 1.2, ratio: '9:16', pollMs: 1, transport, onSubmitted: id => { submitted.push(id); } });
  assert.deepEqual(result, { taskId: 'task-123', videoUrl: 'https://cdn.example/result.mp4' }); assert.deepEqual(submitted, ['task-123']);
  const body = JSON.parse(String(calls[0]!.init?.body)); assert.equal(body.duration, 4); assert.equal(body.generate_audio, true);
  assert.deepEqual(body.content, [{ type: 'text', text: 'say hello' }, { type: 'image_url', image_url: { url: 'https://signed.example/target.png' }, role: 'first_frame' }]);
  assert.equal(calls.filter(call => call.url.endsWith('/task-123')).length, 2);
});

test('Seedance does not silently retry an unknown submission', async () => {
  let calls = 0; const transport = (async () => { calls += 1; return new Response(JSON.stringify({ status: 'accepted' }), { status: 200 }); }) as typeof fetch;
  await assert.rejects(generateSeedanceSentenceVideo({ apiKey: 'secret', model: 'seedance-test', imageUrl: 'https://signed.example/target.png', prompt: 'line', duration: 2, ratio: '9:16', transport }), /提交结果未知.*不能自动重试/);
  assert.equal(calls, 1);
});

test('Seedance exposes a definitive supplier rejection', async () => {
  const transport = (async () => new Response(JSON.stringify({ error: { message: 'AccessDenied' } }), { status: 403 })) as typeof fetch;
  await assert.rejects(generateSeedanceSentenceVideo({ apiKey: 'secret', model: 'seedance-test', imageUrl: 'https://signed.example/target.png', prompt: 'line', duration: 2, ratio: '9:16', transport }), /Seedance 403: AccessDenied/);
});

test('Seedance sentence generation accepts only a verified image trusted asset as the first frame', async () => {
  let body: any;
  const transport = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') { body = JSON.parse(String(init.body)); return Response.json({ id: 'trusted-image-task' }); }
    return Response.json({ id: 'trusted-image-task', status: 'completed', content: { video_url: 'https://cdn.example/result.mp4' } });
  }) as typeof fetch;
  await generateSeedanceSentenceVideo({ apiKey: 'secret', model: 'seedance-test', imageUrl: 'asset://asset-image-123', trustedAssetKind: 'image', prompt: 'line', duration: 4, ratio: '9:16', pollMs: 1, transport });
  assert.equal(body.content[1].image_url.url, 'asset://asset-image-123');
  await assert.rejects(generateSeedanceSentenceVideo({ apiKey: 'secret', model: 'seedance-test', imageUrl: 'asset://asset-video-123', trustedAssetKind: 'video', prompt: 'line', duration: 4, ratio: '9:16', transport }), /视频型可信资产不能作为 image_url 首帧/);
  await assert.rejects(generateSeedanceSentenceVideo({ apiKey: 'secret', model: 'seedance-test', imageUrl: 'asset://asset-image-123', prompt: 'line', duration: 4, ratio: '9:16', transport }), /缺少已核验的图片类型/);
});
