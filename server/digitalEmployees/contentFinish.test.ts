import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { inspectBgmAudibility } from './contentFinish.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-audibility-'));
const ffmpeg = (args: string[]) => execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', ...args], { timeout: 30_000 });
try {
  const voice = path.join(root, 'voice.wav');
  const bgm = path.join(root, 'bgm.wav');
  const quietMix = path.join(root, 'quiet.wav');
  const audibleMix = path.join(root, 'audible.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*880*t)*between(t\\,0.4\\,0.8):s=16000:d=1.2', '-y', voice]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=16000:duration=1.2', '-af', 'volume=2', '-y', bgm]);
  const mix = (volume: number, output: string) => ffmpeg(['-i', bgm, '-i', voice, '-filter_complex', `[0:a]volume=${volume}[music];[music][1:a]amix=inputs=2:duration=longest:normalize=0[out]`, '-map', '[out]', '-y', output]);
  mix(.02, quietMix);
  mix(.2, audibleMix);
  const quiet = await inspectBgmAudibility(quietMix, voice);
  const audible = await inspectBgmAudibility(audibleMix, voice);
  assert.equal(quiet.checked, true);
  assert.equal(quiet.passed, false, JSON.stringify(quiet));
  assert.equal(audible.checked, true);
  assert.equal(audible.passed, true, JSON.stringify(audible));
  console.log('BGM audibility gate rejects inaudible mixes and accepts audible background music');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
