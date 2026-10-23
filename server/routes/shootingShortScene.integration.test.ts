import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpeg from 'ffmpeg-static';
import { detectVideoSceneCuts } from './videoFrameExtraction.js';
import { createShootingReferencePreview } from './shootingReferencePreview.js';
import { prepareWeeklyQualityAuditFixture } from '../runtime/weeklyContentQualityAudit.fixture.js';

const run = promisify(execFile);
async function media() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shooting-short-scenes-'));
  const dir = path.join(root, 'tenants/t/reference-videos');
  await fs.mkdir(dir, { recursive: true });
  const source = path.join(dir, 'shortcuts.mp4');
  assert.ok(ffmpeg);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=red:s=64x64:r=60:d=0.166666667',
    '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=60:d=1',
    '-f', 'lavfi', '-i', 'color=green:s=64x64:r=60:d=0.183333333',
    '-f', 'lavfi', '-i', 'color=yellow:s=64x64:r=60:d=1',
    '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]',
    '-map', '[v]', '-frames:v', '141', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
  return { root, source };
}

test('a real ten-frame opening cut is retained before 0.2 seconds', async t => {
  const { root, source } = await media();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cuts = await detectVideoSceneCuts(source);
  assert.ok(cuts.some(cut => Math.abs(cut - 10 / 60) < 0.000001), `missing source cut: ${cuts}`);
});

test('short neighbouring scenes do not block a normal preview or leak adjacent frames', async t => {
  const f = await prepareWeeklyQualityAuditFixture(); t.after(f.cleanup);
  const { root, source } = await media();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const analysis = { analysisMode: 'exact', analysisQuality: 'video_review_required', analysisRunId: 'short-scenes', contentSha256: sha,
    gemini: { scriptDetails15s: [
      { time: '0-0.166667', visual: 'red' }, { time: '0.166667-1.166667', visual: 'blue' },
      { time: '1.166667-1.35', visual: 'green' }, { time: '1.35-2.35', visual: 'yellow' },
    ] } };
  await f.store.create('trend_videos', { id: 'shortcuts', tenantId: 't', videoFileId: 'tenants/t/reference-videos/shortcuts.mp4', aiAnalysis: JSON.stringify(analysis) });
  const preview = createShootingReferencePreview(f.store, { mediaRoot: root });
  for (const [taskId, shotId, start, end, frames] of [
    ['blue', 'slot-2', 0.166667, 1.166667, 60], ['opening', 'slot-1', 0, 0.166667, 10],
  ] as const) {
    await f.store.create('studio_shooting_tasks', { id: taskId, tenant_id: 't', payload: {
      sourceProjectId: 'p', sourceAssemblyId: 'a', sourceShotId: taskId, sourceStoryboardSlotId: shotId, requirements: 'v1',
      referenceClip: { schemaVersion: 'shooting-reference.v1', projectId: 'p', shotId: taskId, storyboardSlotId: shotId,
        videoId: 'shortcuts', referenceShotId: shotId, startSeconds: start, endSeconds: end, description: taskId },
    } });
    const clip = await preview('t', taskId);
    assert.equal(clip.physicalClip, true); assert.equal(clip.start, 0);
    const file = path.join(root, new URL(clip.url, 'http://local').pathname.slice('/media/'.length));
    const { stdout } = await run(ffmpeg!, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(stdout.length, frames * 64 * 64 * 3);
    for (let i = 0; i < stdout.length; i += 3) {
      if (taskId === 'blue') assert.ok(stdout[i]! < 50 && stdout[i + 1]! < 50 && stdout[i + 2]! > 180);
      else assert.ok(stdout[i]! > 180 && stdout[i + 1]! < 50 && stdout[i + 2]! < 50);
    }
  }
  assert.equal(f.tables.reference_exact_shot_evidence!.length, 1);
  assert.equal(f.tables.starter_usage_ledger?.length || 0, 0);
  assert.equal(f.tables.content_execution_jobs?.length || 0, 0);
});
