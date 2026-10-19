import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { HeyGenPresenterClient } from './heygenPresenters';
import { extractPresenterVoiceCandidate, inspectPresenterVideo, normalizePresenterAudio, normalizePresenterTrainingVideo, PresenterAudioPreparationError } from './presenterVideo';

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
  assert.deepEqual(await client.cloneVoice('test', webm, 'audio/webm', 'zh-CN', 'request-1'), ['real-shaped-test-id']);
  assert.equal(submitted,1);
  await assert.rejects(normalizePresenterAudio(Buffer.from('invalid recording')), PresenterAudioPreparationError);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('video voice candidate is local MP3 and reports estimated non-silent duration', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-candidate-test-'));
 try {
  const file = path.join(dir, 'sample.mp4');
  execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x240:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libx264','-c:a','aac',file]);
  const result = await extractPresenterVoiceCandidate(await fs.readFile(file));
  assert.equal(result.audio.toString('ascii', 0, 3), 'ID3');
  assert.ok(result.durationSeconds >= 1.9 && result.durationSeconds <= 2.1);
  assert.ok(result.nonSilentSeconds > 1);
  await assert.rejects(extractPresenterVoiceCandidate(Buffer.from('invalid video')), PresenterAudioPreparationError);
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('streaming WebM voice candidate uses decoded output time when the container has no duration header', async () => {
 const bytes = execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=320x240:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libvpx','-c:a','libopus','-f','webm','pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
 const result = await extractPresenterVoiceCandidate(bytes);
 assert.ok(result.durationSeconds >= 1.9, `expected decoded duration, got ${result.durationSeconds}`);
 assert.ok(result.nonSilentSeconds > 1);
});

test('streaming browser WebM inspection uses packet time when the container has no duration header', async () => {
 const bytes = execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=1280x720:r=30:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libvpx','-c:a','libopus','-f','webm','pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
 const result = await inspectPresenterVideo(bytes);
 assert.ok(result.duration >= 1.9, `expected packet duration, got ${result.duration}`);
 assert.equal(result.width, 1280);
 assert.equal(result.height, 720);
 assert.ok(result.fps >= 24);
 assert.equal(result.hasAudio, true);
});

test('browser WebM training video is standardized to provider-safe 720p 30fps MP4', async () => {
 const bytes = execFileSync(ffmpeg!, ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=640x480:r=20:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-shortest','-c:v','libvpx','-c:a','libopus','-f','webm','pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
 const normalized = await normalizePresenterTrainingVideo(bytes);
 assert.equal(normalized.toString('ascii', 4, 8), 'ftyp');
 const result = await inspectPresenterVideo(normalized);
 assert.equal(result.width, 1280);
 assert.equal(result.height, 720);
 assert.ok(result.fps >= 29);
 assert.equal(result.hasAudio, true);
});
