import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import ffmpeg from 'ffmpeg-static';
import { extractReferenceSourceAudio, REFERENCE_AUDIO_CLOCK_POLICY } from './referenceNarration.js';
const run = promisify(execFile);
const binary = String(ffmpeg || 'ffmpeg');

function pcmData(wav: Buffer): Buffer {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString('ascii', offset, offset + 4) === 'data') return wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error('Missing WAV PCM data');
}

for (const mediaOrigin of [0, 5]) test(`delayed source audio is padded at the video clock zero; media origin ${mediaOrigin}s; no ASR call`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-source-clock-'));
  try {
    const input = path.join(dir, 'delayed.mkv');
    const output = path.join(dir, 'source.wav');
    await run(binary, ['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i', "color=black:s=64x64:r=25:d=2,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(t,0.4)'",
      '-itsoffset','0.4','-f','lavfi','-i','sine=frequency=1000:sample_rate=16000:duration=1',
      '-map','0:v','-map','1:a','-c:v','ffv1','-c:a','pcm_s16le',
      '-output_ts_offset',String(mediaOrigin),input]);
    const metadata = await extractReferenceSourceAudio(input, output);
    assert.equal(metadata.clockPolicy, REFERENCE_AUDIO_CLOCK_POLICY);
    assert.equal(metadata.sourceMediaStartSeconds, mediaOrigin);
    assert.equal(metadata.firstAudioPtsSeconds, 0.4);
    assert.equal(metadata.initialPaddingSamples, 6400);
    assert.equal(metadata.dynamicResampling, false);
    assert.equal(metadata.videoFrameTimingVerified, false);
    assert.ok(metadata.audioClockContinuityVerified);
    const pcm = pcmData(fs.readFileSync(output));
    assert.ok(pcm.subarray(0, 6400 * 2).every(byte => byte === 0), 'retain the 0.4s source silence preceding the speech');
    const old = await run(binary, ['-hide_banner','-loglevel','error','-i',input,'-map','0:a:0',
      '-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024 });
    assert.deepEqual(pcm.subarray(6400 * 2), old.stdout, 'all original spoken samples remain byte identical; no time stretching');
    assert.equal(pcm.length, (6400 + 16000) * 2);
    const pixel = async (time: string) => (await run(binary, ['-hide_banner','-loglevel','error','-ss',time,'-i',input,
      '-map','0:v:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'], { encoding: 'buffer' })).stdout[0];
    assert.ok((await pixel('0.36')) < 10, 'source visual event has not begun before 0.4 seconds');
    assert.ok((await pixel('0.40')) > 240, 'source visual event is present at 0.4 seconds, when audio begins');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('discontinuous audio clock fails locally rather than squeezing the source or shifting ASR words', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-source-clock-gap-'));
  try {
    const input = path.join(dir, 'gap.mkv');
    await run(binary, ['-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','lavfi','-i','color=black:s=64x64:r=25:d=2',
      '-f','lavfi','-i', "sine=frequency=1000:sample_rate=16000:duration=1,asetpts='PTS+if(gte(T,0.5),0.2/TB,0)'",
      '-map','0:v','-map','1:a','-c:v','ffv1','-c:a','pcm_s16le',input]);
    await assert.rejects(extractReferenceSourceAudio(input, path.join(dir, 'source.wav')), /时间戳不连续/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
