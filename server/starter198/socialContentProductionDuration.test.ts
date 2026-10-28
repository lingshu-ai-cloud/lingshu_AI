import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSocialQualityStage } from './socialContentProductionStages.js';

test('voice-driven policy records visual observations without aesthetic/distinct/BGM gates and retains decode failures', async () => {
  for (const sampleCount of [0, 2]) {
    const report = await executeSocialQualityStage({ outputPath: '/local/output.mp4', duration: 3,
      scenes: [{ start: 0, end: 3 }], expectedUniqueScenes: 2, checkpointEnabled: false, minimalVideoPolicy: true,
      expectedBgm: { source: '/local/bgm.mp3', sourceHash: 'a'.repeat(64), volume: 1 },
      inspectVisuals: async () => ({ passed: false, failures: ['dark image'], metrics: { sampleCount } as never, evidenceFrames: [] }),
      inspectScenes: async input => {
        assert.equal(input.requireDistinct, false);
        return { passed: false, checkedScenes: 1, issues: [{ sceneIndex: 0, start: 0, end: 3, code: 'blank', reason: 'flat background' }] };
      },
      runFfmpeg: async args => {
        assert.equal(args.some(value => value.includes('volumedetect')), false);
        return { ok: true, stdout: Buffer.alloc(0), stderr: '' };
      },
    });
    assert.equal(report.quality.passed, sampleCount > 0);
    assert.equal(report.sceneQuality.passed, true);
    assert.equal(report.audio.bgm, undefined);
  }
});

test('quality gate measures decoded video length and rejects a 10.923 second artifact on a 38 second timeline', async () => {
  for (const seconds of [10.923, 38]) {
    const report = await executeSocialQualityStage({
      outputPath: '/local/output.mp4', duration: 38, scenes: [{ start: 0, end: 38 }], expectedUniqueScenes: 1,
      checkpointEnabled: false, verifyDuration: true,
      inspectVisuals: async () => ({ passed: true, failures: [], metrics: {} as never, evidenceFrames: [] }),
      inspectScenes: async () => ({ passed: true, checkedScenes: 1, issues: [] } as never),
      runFfmpeg: async args => ({ ok: true, stdout: Buffer.from(args.includes('-progress')
        ? `out_time_us=${seconds * 1e6}\nprogress=end\n` : ''), stderr: '' }),
    });
    assert.equal(report.measuredDurationSeconds, seconds);
    assert.equal(report.quality.passed, seconds === 38);
  }
});

test('duration gate fails closed when video EOF cannot be measured', async () => {
  const report = await executeSocialQualityStage({
    outputPath: '/local/output.mp4', duration: 38, scenes: [], expectedUniqueScenes: 1,
    checkpointEnabled: false, verifyDuration: true,
    inspectVisuals: async () => ({ passed: true, failures: [], metrics: {} as never, evidenceFrames: [] }),
    inspectScenes: async () => ({ passed: true, checkedScenes: 1, issues: [] } as never),
    runFfmpeg: async () => ({ ok: true, stdout: Buffer.alloc(0), stderr: '' }),
  });
  assert.equal(report.quality.passed, false);
  assert.equal(report.measuredDurationSeconds, 0);
});

test('quality gate persists BGM input, normalized mix and final-track audibility evidence', async () => {
  const report = await executeSocialQualityStage({
    outputPath: '/local/output.mp4', duration: 3, scenes: [], expectedUniqueScenes: 1,
    checkpointEnabled: false, expectedBgm: { source: '/local/bgm.mp3', sourceHash: 'a'.repeat(64), volume: 18 },
    inspectVisuals: async () => ({ passed: true, failures: [], metrics: {} as never, evidenceFrames: [] }),
    inspectScenes: async () => ({ passed: true, checkedScenes: 1, issues: [] } as never),
    runFfmpeg: async args => {
      if (!args.some(value => value.includes('volumedetect'))) return { ok: true, stdout: Buffer.alloc(0), stderr: '' };
      const normalized = args.some(value => value.includes('loudnorm='));
      const source = args.includes('/local/bgm.mp3');
      const mean = normalized ? -32.5 : source ? -47.9 : -19.1;
      const max = normalized ? -20.6 : source ? -36 : -3.1;
      return { ok: true, stdout: Buffer.alloc(0), stderr: `mean_volume: ${mean} dB\nmax_volume: ${max} dB` };
    },
  });
  assert.equal(report.quality.passed, true);
  assert.deepEqual(report.audio.bgm, {
    required: true, configuredVolume: 18,
    inputMeanDb: -47.9, inputMaxDb: -36,
    normalizedMeanDb: -32.5, normalizedMaxDb: -20.6,
    finalMixMeanDb: -19.1, finalMixMaxDb: -3.1,
    passed: true, failure: null,
  });
});

test('quality gate fails when the frozen BGM remains inaudible after normalized gain', async () => {
  const report = await executeSocialQualityStage({
    outputPath: '/local/output.mp4', duration: 3, scenes: [], expectedUniqueScenes: 1,
    checkpointEnabled: false, expectedBgm: { source: '/local/bgm.mp3', sourceHash: 'b'.repeat(64), volume: 18 },
    inspectVisuals: async () => ({ passed: true, failures: [], metrics: {} as never, evidenceFrames: [] }),
    inspectScenes: async () => ({ passed: true, checkedScenes: 1, issues: [] } as never),
    runFfmpeg: async args => {
      if (!args.some(value => value.includes('volumedetect'))) return { ok: true, stdout: Buffer.alloc(0), stderr: '' };
      const normalized = args.some(value => value.includes('loudnorm='));
      return { ok: true, stdout: Buffer.alloc(0), stderr: `mean_volume: ${normalized ? -55 : -47} dB\nmax_volume: ${normalized ? -44 : -36} dB` };
    },
  });
  assert.equal(report.quality.passed, false);
  assert.equal(report.audio.bgm?.passed, false);
  assert.match(report.audio.bgm?.failure || '', /不可闻/);
});
