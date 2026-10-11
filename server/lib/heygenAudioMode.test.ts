import test from 'node:test';
import assert from 'node:assert/strict';
import { HeyGenClient } from './heygen.js';

test('verified audio request maps documented v3 Avatar IV engine without text or voice TTS', async () => {
  let calls = 0, body: any;
  const client = new HeyGenClient('fixture-only', async (url, init) => {
    assert.equal(String(url), 'https://api.heygen.com/v3/videos'); calls++;
    body = JSON.parse(String(init?.body));
    return Response.json({ data: { video_id: 'controlled-iv' } });
  });
  const input = { avatarId: 'original-digital-twin', voiceId: '', script: '', ratio: '9:16', transparent: false, title: 'hook', audioAssetId: 'verified-upload', engine: 'avatar_iv' as const };
  assert.equal(await client.create(input, 'fixed-audio-request'), 'controlled-iv');
  assert.deepEqual(body.engine, { type: 'avatar_iv' }); assert.equal(body.type, 'avatar');
  assert.equal(body.avatar_id, input.avatarId); assert.equal(body.audio_asset_id, input.audioAssetId);
  assert.equal('script' in body, false); assert.equal('voice_id' in body, false);
  await assert.rejects(client.create({ ...input, script: 'another text' }, 'invalid'), /不能同时/);
  await assert.rejects(client.create({ ...input, voiceId: 'another-voice' }, 'invalid'), /不能同时/);
  await assert.rejects(client.create({ ...input, engine: 'avatar_iii' as any }, 'invalid'), /仅允许Avatar IV/);
  assert.equal(calls, 1, 'invalid mode never contacts provider');
});

test('HeyGen actual create body consumes trusted boundary before new provider POST',async()=>{
 let posts=0;const client=new HeyGenClient('controlled',async()=>{posts++;throw Error('must not submit');},{beforeSubmit:async(body,id)=>{assert.equal(id,'exact-request');assert.equal(body.audio_asset_id,'actual-audio-asset');assert.equal(body.avatar_id,'actual-avatar');assert.equal(body.resolution,'720p');assert.equal('script' in body,false);throw Error('frozen_presenter_intent_missing');},onAccepted:async()=>{throw Error('must not accept');}});
 await assert.rejects(client.create({avatarId:'actual-avatar',voiceId:'',script:'',audioAssetId:'actual-audio-asset',engine:'avatar_iv',ratio:'9:16',transparent:false,title:'frozen'},'exact-request'),/frozen_presenter_intent_missing/);assert.equal(posts,0);
});
