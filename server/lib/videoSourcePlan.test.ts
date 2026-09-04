import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import ffmpegStatic from 'ffmpeg-static';
import { withLocalRenderAssets } from './localRenderAssets.js';
import { planVideoSourceSegments, resolveSourceDurations, type TimedSourceAsset } from './videoSourcePlan.js';

const video = (id: string, duration: number): TimedSourceAsset => ({ id, name: id, duration, type: 'video' });
const short = planVideoSourceSegments(Array(5).fill(video('short', 1.93)), Array(5).fill(4));
assert.equal(short.segments.length, 0);
assert.match(short.gaps.join('；'), /1.93.*20.00/);
const long = planVideoSourceSegments(Array(5).fill(video('long', 25)), Array(5).fill(4));
assert.deepEqual(long.segments.map(s => [s.trimStart, s.trimEnd]), [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20]]);
assert.equal(long.gaps.length, 0);
assert.ok(planVideoSourceSegments(Array(5).fill(video('long', 20)), Array(5).fill(4.944)).gaps.length, 'actual TTS duration must be rechecked');
assert.ok(planVideoSourceSegments([video('unknown', 0)], [4]).gaps.length);
assert.ok(planVideoSourceSegments([video('bad', NaN)], [4]).gaps.length);
assert.ok(planVideoSourceSegments([video('bad-target', 20)], [NaN]).gaps.length);
assert.ok(planVideoSourceSegments([video('short-shot', 20)], [0.1]).gaps.length);
assert.equal(planVideoSourceSegments([{ id: 'image', type: 'image', duration: 0 }], [4]).gaps.length, 0, 'intentional image hold remains supported');
assert.deepEqual(planVideoSourceSegments([video('a', 10), video('b', 10), video('a', 10)], [3, 4, 3]).segments.map(s => s.trimStart), [0, 0, 3]);

// Technical fixtures only: no business acceptance, external service or tenant data.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-segments-regression-'));
const ffmpeg = String(ffmpegStatic);
const run = (args: string[]) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { timeout: 30_000 });
try {
  const source = path.join(root, 'three-scenes.mp4');
  // Some FFmpeg builds report a zero duration for the final decoded frame.
  // Keep the conservative production probe and provide real footage headroom;
  // the three one-second output segments still sample distinct source scenes.
  run(['-f', 'lavfi', '-i', 'color=red:s=160x160:r=10:d=1.1', '-f', 'lavfi', '-i', 'color=green:s=160x160:r=10:d=1.1',
    '-f', 'lavfi', '-i', 'color=blue:s=160x160:r=10:d=1.1', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-y', source]);
  const assets = await resolveSourceDurations(Array(3).fill({ ...video('source', 999), localPath: source }));
  assert.ok(Math.abs(assets[0]!.duration - 3.3) < 0.15, 'real video duration overrides stale metadata');
  const plan = planVideoSourceSegments(assets, [1, 1, 1]);
  assert.deepEqual(plan.gaps, []);
  const aliasPlan = planVideoSourceSegments([{ ...assets[0]!, id: 'alias-a' }, { ...assets[0]!, id: 'alias-b' }], [2, 2]);
  assert.ok(aliasPlan.gaps.length, 'two IDs referencing one file cannot double its duration');
  const require = createRequire(import.meta.url);
  const { composite } = require('../../desktop/render.cjs');
  const dataUrl = `data:video/mp4;base64,${fs.readFileSync(source).toString('base64')}`;
  const rendered = await withLocalRenderAssets<{ ok: boolean; outputPath: string; error?: string }>({ jobId: 'source-segments', requireVisualAssets: true,
    spec: { ratio: '1:1', duration: 3, bgmVol: 0, voiceVol: 0 },
    timeline: plan.segments.map(segment => ({ ...segment, type: 'video', url: dataUrl })),
    subtitles: { mode: 'off', cues: [] },
  }, authorized => composite(authorized, undefined, root));
  assert.equal(rendered.ok, true, rendered.error);
  const rgb = [0.5, 1.5, 2.5].map(time => [...run(['-ss', String(time), '-i', rendered.outputPath,
    '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])]);
  assert.ok(rgb[0]![0]! > rgb[0]![2]! * 2, 'first scene must be red');
  assert.ok(rgb[1]![1]! > rgb[1]![0]! * 2, 'second scene must use green source interval, not replay red');
  assert.ok(rgb[2]![2]! > rgb[2]![0]! * 2, 'third scene must use blue source interval');

  const longAudio = path.join(root, 'short-video-long-audio.mp4');
  run(['-f', 'lavfi', '-i', 'testsrc2=s=160x160:r=10:d=1', '-f', 'lavfi', '-i', 'sine=duration=4', '-map', '0:v', '-map', '1:a', '-y', longAudio]);
  const [probed] = await resolveSourceDurations([{ ...video('audio-trap', 4), localPath: longAudio }]);
  assert.ok(probed!.duration <= 1.1, 'long audio must not inflate available visual footage');
  assert.ok(planVideoSourceSegments([probed!], [3]).gaps.length);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('video source segment tests passed (local technical fixtures, not business acceptance)');
