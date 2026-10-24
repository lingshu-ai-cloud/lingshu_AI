import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { reinspectSplitShotDescriptions } from './videoSplitShotDescriptions.js';
import { splitExactGeminiShotsAtSceneCuts } from './videoAnalysisTimelineProjection.js';
import type { VideoAiAnalysis } from '../types/index.js';
const run = promisify(execFile);
const base: VideoAiAnalysis = { theme: 'two distinct shots', hooks: [], sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard',
  scriptDetails15s: [{ time: '0-2s', visual: 'mixed red and blue', environment: 'parent context', classificationEvidence: 'parent evidence' }] };
test('split descriptions receive independently decoded clips with no adjacent-scene frames', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-description-'));
  const source = path.join(dir, 'source.mp4');
  try {
    await run(ffmpeg!, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:r=30:d=1',
      '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=30:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-c:v', 'libx264', '-y', source]);
    const observations: string[] = [];
    const result = await reinspectSplitShotDescriptions(source, splitExactGeminiShotsAtSceneCuts(base, [1]), async bytes => {
      const file = path.join(dir, 'received.mp4'); await fs.writeFile(file, bytes);
      const { stdout } = await run(ffmpeg!, ['-loglevel', 'error', '-i', file, '-vf', 'scale=1:1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' });
      const red = stdout[0]! > stdout[2]!;
      for (let i = 0; i < stdout.length; i += 3) assert.equal(stdout[i]! > stdout[i + 2]!, red, 'clip contains another shot');
      const visual = red ? 'red scene' : 'blue scene'; observations.push(visual);
      return { ...base, scriptDetails15s: [{ time: '0-1s', visual, needsReview: false,
        materialType: 'product', narrativeRole: 'product_intro', classificationEvidence: visual }] };
    });
    assert.deepEqual(observations, ['red scene', 'blue scene']);
    assert.deepEqual(result.scriptDetails15s?.map(row => [row.time, row.visual, row.environment]), [
      ['0s–1s', 'red scene', undefined], ['1s–2s', 'blue scene', undefined],
    ]);
    await assert.rejects(reinspectSplitShotDescriptions(source, splitExactGeminiShotsAtSceneCuts(base, [1]),
      async () => ({ ...base, scriptDetails15s: [] })), /description_unverified/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
