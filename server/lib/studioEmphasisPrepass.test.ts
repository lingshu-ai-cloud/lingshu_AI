import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runStudioEmphasisPrepass } from './studioEmphasisPrepass.js';
import type { StudioVisualAnalyzerInput } from './studioVisualEvidence.js';

test('orchestrates shot, contact, occupancy and one visual analysis then caches the result', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-emphasis-prepass-'));
  const calls: string[] = [];
  const dependencies = {
    detectShots: async () => { calls.push('shots'); return [{ id: 'shot-1', startMs: 0, endMs: 2_000, confidence: .9, source: 'ffmpeg_scene' as const }]; },
    selectSamples: () => { calls.push('samples'); return [{ shotId: 'shot-1', timeMs: 400 }, { shotId: 'shot-1', timeMs: 1_000 }]; },
    extractFrames: async ({ samples }: { samples: Array<{ shotId: string; timeMs: number }> }) => { calls.push('frames'); return samples.map(sample => ({ ...sample, bytes: Buffer.from('frame') })); },
    analyzeOccupancy: async () => { calls.push('occupancy'); return { captionBoxes: [{ x: .1, y: .75, width: .8, height: .1 }], texts: ['已有字幕'], source: 'ocr' as const, ocrFailed: false }; },
    buildContactSheet: async () => { calls.push('sheet'); return { bytes: Buffer.from('sheet'), width: 256, height: 172,
      frames: [{ shotId: 'shot-1', timeMs: 400, column: 0, row: 0 }] }; },
    analyzeVisual: async (input: StudioVisualAnalyzerInput) => { calls.push('visual'); assert.equal(input.contactFrames.length, 1); return [{ shotId: 'shot-1', subjectType: 'product' as const,
      subjectBox: { x: .2, y: .2, width: .5, height: .5 }, subjectAnchor: { x: .45, y: .45 }, safeZones: [], captionBoxes: [], confidence: .9 }]; },
  };
  try {
    const first = await runStudioEmphasisPrepass({ sourcePath: '/tmp/video.mp4', sourceHash: 'abc', durationMs: 2_000, cacheDir, dependencies });
    assert.deepEqual(calls, ['shots', 'samples', 'frames', 'occupancy', 'sheet', 'visual']);
    assert.equal(first.shotWindows.length, 1);
    assert.equal(first.captionOccupancy[0]?.text, '已有字幕');
    assert.deepEqual(first.visualEvidence[0]?.captionBoxes, [{ x: .1, y: .75, width: .8, height: .1 }]);
    calls.length = 0;
    const cached = await runStudioEmphasisPrepass({ sourcePath: '/tmp/video.mp4', sourceHash: 'abc', durationMs: 2_000, cacheDir, dependencies });
    assert.deepEqual(calls, []);
    assert.deepEqual(cached, first);
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }); }
});

test('all optional analysis failures return a conservative preanalysis instead of blocking', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-emphasis-prepass-fail-'));
  try {
    const result = await runStudioEmphasisPrepass({ sourcePath: '/missing.mp4', sourceHash: 'missing', durationMs: 3_000, cacheDir,
      dependencies: {
        detectShots: async () => { throw new Error('ffmpeg failed'); },
        extractFrames: async () => { throw new Error('frames failed'); },
        buildContactSheet: async () => { throw new Error('sharp failed'); },
      } });
    assert.deepEqual(result, { shotWindows: [{ id: 'shot-1', startMs: 0, endMs: 3_000, confidence: 0, source: 'fallback' }],
      captionOccupancy: [], visualEvidence: [] });
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }); }
});
