import assert from 'node:assert/strict';
import test from 'node:test';
import { HeyGenClient } from './heygen.js';
import { generateHeyGenPhotoVideo } from './heygenPhotoVideo.js';

test('photo video uploads the exact image and submits image_asset_id without avatar training', async () => {
  const events: string[] = []; let body: any;
  const client = new HeyGenClient('test-only', async (url, init) => {
    if (String(url).endsWith('/assets')) { events.push('upload'); const file = (init?.body as FormData).get('file') as Blob; assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3])); return Response.json({ data: {asset_id: 'target-frame'} }); }
    if (init?.method === 'POST') { events.push('create'); body = JSON.parse(String(init.body)); assert.equal(new Headers(init.headers).get('Idempotency-Key'), 'tenant:request:cue'); return Response.json({data:{video_id:'video-1'}}); }
    events.push('status'); return Response.json({data:{status:'completed',video_url:'https://files.heygen.ai/result.mp4',duration:3}});
  });
  const result = await generateHeyGenPhotoVideo({ bytes: new Uint8Array([1,2,3]), mimeType:'image/jpeg', voiceId:'voice-1', script:'Hello.',ratio:'9:16', requestId:'tenant:request:cue',client,
    reserve: async () => {events.push('reserve');}, onSubmitted: async id => {assert.equal(id,'video-1');events.push('persist');} });
  assert.deepEqual(events,['upload','reserve','create','persist','status']);
  assert.equal(body.image_asset_id,'target-frame'); assert.equal(body.avatar_id,undefined); assert.equal(body.script,'Hello.'); assert.equal(body.voice_id,'voice-1'); assert.equal(result.taskId,'video-1');
});

test('unknown submission never retries or replaces the photo with an avatar', async () => {
  let attempts=0;
  const client = new HeyGenClient('test-only', async (url) => { if(String(url).endsWith('/assets')) return Response.json({data:{asset_id:'photo'}}); attempts++; throw new Error('connection lost'); });
  await assert.rejects(generateHeyGenPhotoVideo({bytes:new Uint8Array([1]),mimeType:'image/png',voiceId:'voice',script:'Hello',ratio:'9:16',requestId:'same-request',client,reserve:async()=>{}}), /connection lost/);
  assert.equal(attempts,1);
});
