import assert from 'node:assert/strict';
import test from 'node:test';
import { HeyGenClient } from './heygen.js';
import { generateHeyGenPhotoVideo } from './heygenPhotoVideo.js';

test('photo video uploads the exact image and submits the documented image subject without avatar training', async () => {
  const events: string[] = []; let body: any;
  const client = new HeyGenClient('test-only', async (url, init) => {
    if (String(url).endsWith('/assets')) { events.push('upload'); const file = (init?.body as FormData).get('file') as Blob; assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3])); return Response.json({ data: {asset_id: 'target-frame'} }); }
    if (init?.method === 'POST') { events.push('create'); body = JSON.parse(String(init.body)); assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'tenant:request:cue'); return Response.json({data:{video_id:'video-1'}}); }
    events.push('status'); return Response.json({data:{status:'completed',video_url:'https://files.heygen.ai/result.mp4',duration:3}});
  });
  const result = await generateHeyGenPhotoVideo({ bytes: new Uint8Array([1,2,3]), mimeType:'image/jpeg', voiceId:'voice-1', script:'Hello.',ratio:'9:16', requestId:'tenant:request:cue',client,
    reserve: async () => {events.push('reserve');}, onSubmitted: async id => {assert.equal(id,'video-1');events.push('persist');} });
  assert.deepEqual(events,['reserve','upload','create','persist','status']);
  assert.equal(body.type,'image'); assert.deepEqual(body.image,{type:'asset_id',asset_id:'target-frame'}); assert.equal(body.avatar_id,undefined); assert.equal(body.script,'Hello.'); assert.equal(body.voice_id,'voice-1'); assert.equal(result.taskId,'video-1');
});

test('unknown submission never retries or replaces the photo with an avatar', async () => {
  let attempts=0;
  const client = new HeyGenClient('test-only', async (url) => { if(String(url).endsWith('/assets')) return Response.json({data:{asset_id:'photo'}}); attempts++; throw new Error('connection lost'); });
  await assert.rejects(generateHeyGenPhotoVideo({bytes:new Uint8Array([1]),mimeType:'image/png',voiceId:'voice',script:'Hello',ratio:'9:16',requestId:'same-request',client,reserve:async()=>{}}), /提交结果未知.*connection lost/);
  assert.equal(attempts,1);
});

test('a 400 schema rejection is reported as definitive and does not retry', async () => {
  let attempts = 0;
  const client = new HeyGenClient('test-only', async url => {
    if (String(url).endsWith('/assets')) return Response.json({ data: { asset_id: 'photo' } });
    attempts += 1;
    return Response.json({ error: { code: 'invalid_parameter', message: 'image is required' } }, { status: 400 });
  });
  await assert.rejects(generateHeyGenPhotoVideo({ bytes: new Uint8Array([1]), mimeType: 'image/png', voiceId: 'voice', script: 'Hi boss!', ratio: '9:16', requestId: 'same-request', client, reserve: async () => {} }), /明确拒绝.*invalid_parameter.*未创建视频任务/);
  assert.equal(attempts, 1);
});

test('status failure preserves the submitted task id for recovery', async () => {
  const client = new HeyGenClient('test-only', async (url, init) => {
    if (String(url).endsWith('/assets')) return Response.json({ data: { asset_id: 'photo' } });
    if (init?.method === 'POST') return Response.json({ data: { video_id: 'heygen-task-1' } });
    throw new Error('status network lost');
  });
  await assert.rejects(generateHeyGenPhotoVideo({ bytes: new Uint8Array([1]), mimeType: 'image/png', voiceId: 'voice', script: 'Hello', ratio: '9:16', requestId: 'same-request', client, reserve: async () => {} }), /状态查询未知（任务 heygen-task-1）/);
});

test('resuming a known HeyGen task only reads its status and never submits or reserves again', async () => {
  const events: string[] = [];
  const client = new HeyGenClient('test-only', async (_url, init) => {
    assert.notEqual(init?.method, 'POST');
    events.push('status');
    return Response.json({ data: { status: 'completed', video_url: 'https://files.heygen.ai/recovered.mp4', duration: 6 } });
  });
  const result = await generateHeyGenPhotoVideo({ bytes: new Uint8Array([1]), mimeType: 'image/png', voiceId: 'voice', script: 'Hello', ratio: '9:16', requestId: 'same-request', existingTaskId: 'known-task', client,
    reserve: async () => { throw new Error('must not reserve'); }, onSubmitted: async () => { throw new Error('must not submit'); } });
  assert.deepEqual(events, ['status']);
  assert.equal(result.taskId, 'known-task');
  assert.equal(result.duration, 6);
});

test('supplier-reported failure is definitive during recovery', async () => {
  const client = new HeyGenClient('test-only', async () => Response.json({ data: { status: 'failed', failure_code: 'supplier_rejected' } }));
  await assert.rejects(generateHeyGenPhotoVideo({ bytes: new Uint8Array([1]), mimeType: 'image/png', voiceId: 'voice', script: 'Hello', ratio: '9:16', requestId: 'same-request', existingTaskId: 'known-task', client }), /HeyGen任务明确失败：supplier_rejected/);
});
