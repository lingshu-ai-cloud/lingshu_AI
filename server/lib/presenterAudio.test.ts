import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { HeyGenPresenterClient } from './heygenPresenters';
import { normalizePresenterAudio, PresenterAudioPreparationError } from './presenterVideo';

test('browser WebM audio is converted to matching MP3 before clone submission', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-audio-test-'));
 try {
  const file = path.join(dir, 'sample.webm');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','libopus',file]);
  const webm = await fs.readFile(file);
  let submitted = 0;
  const client = new HeyGenPresenterClient('test', async (_url, init) => {
   submitted++;
   const body = JSON.parse(String(init?.body));
   assert.equal(body.audio.media_type, 'audio/mpeg');
   const bytes = Buffer.from(body.audio.data, 'base64');
   assert.equal(bytes.toString('ascii',0,3),'ID3');
   return Response.json({data:{voice_clone_id:'real-shaped-test-id'}});
  });
  assert.equal(await client.cloneVoice('test', webm, 'audio/webm', 'zh-CN', 'request-1'), 'real-shaped-test-id');
  assert.equal(submitted,1);
  await assert.rejects(normalizePresenterAudio(Buffer.from('invalid recording')), PresenterAudioPreparationError);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
