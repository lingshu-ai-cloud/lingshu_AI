import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { compileStoryboardShotSpec } from '../../shared/storyboardShotSpec';
import { planStoryboardActionSegments } from '../../shared/storyboardActionSegments';
import { assembleStoryboardActionSegments } from './storyboardActionAssembly';

assert.ok(ffmpegStatic, 'ffmpeg-static must be available');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-action-assembly-'));
const makeVideo = (file: string, color: string, duration: number) => execFileSync(String(ffmpegStatic), [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=${color}:s=96x160:r=24:d=${duration}`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file,
]);

try {
  const spec = compileStoryboardShotSpec({
    shotId: 'install-1', mode: 'free_creation', scene: 'usage', description: '在家安装吊灯', ratio: '9:16',
    startSeconds: 0, endSeconds: 8.5,
    assets: [{ role: 'product', id: 'lamp', version: '1', source: 'knowledge_base' }],
    action: { startState: '手持灯具', beats: ['对准安装位', '固定灯具'], endState: '灯具固定完成', evidence: 'confirmed_storyboard' },
  });
  const plan = planStoryboardActionSegments({
    shot: spec, firstFrameAssetId: 'frame-1', beatDurationsSeconds: [4.5, 4],
    capability: { minDurationSeconds: 4, maxDurationSeconds: 5, integerDurationSeconds: true, supportsFirstFrame: true, supportsEndFrame: false },
    keyStates: [{ afterBeat: 1, description: '灯具已对准安装位', source: 'confirmed_storyboard', imageAssetId: 'frame-2' }],
  });
  assert.equal(plan.status, 'planned');
  if (plan.status !== 'planned') throw new Error('expected segment plan');
  assert.equal(plan.segments.length, 2);
  assert.equal(plan.segments[0]!.trimTailSeconds, .5);
  const clip1 = path.join(root, 'one.mp4');
  const clip2 = path.join(root, 'two.mp4');
  makeVideo(clip1, 'red', 5);
  makeVideo(clip2, 'blue', 4);
  const segments = [
    { plan: plan.segments[0]!, videoPath: clip1, qualityPassed: true as const, terminalStateVerified: true },
    { plan: plan.segments[1]!, videoPath: clip2, qualityPassed: true as const, terminalStateVerified: true },
  ];
  await assert.rejects(() => assembleStoryboardActionSegments({ segments: [{ ...segments[0]!, terminalStateVerified: false }, segments[1]!], outputPath: path.join(root, 'reject.mp4') }), /storyboard_segment_tail_unverified/);
  await assert.rejects(() => assembleStoryboardActionSegments({ segments: [segments[1]!, segments[0]!], outputPath: path.join(root, 'wrong-order.mp4') }), /storyboard_segment_not_verified_or_out_of_order/);
  const outputPath = path.join(root, 'joined.mp4');
  const result = await assembleStoryboardActionSegments({ segments, outputPath });
  assert.equal(result.outputPath, outputPath);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.trimmedTailSeconds, .5);
  assert.ok(Math.abs(result.durationSeconds - 8.5) < .15, `actual duration ${result.durationSeconds}`);
  assert.equal(result.width, 96);
  assert.equal(result.height, 160);
  assert.ok(result.bytes > 1000);
  assert.ok(fs.existsSync(outputPath));
  console.log('storyboardActionAssembly tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
