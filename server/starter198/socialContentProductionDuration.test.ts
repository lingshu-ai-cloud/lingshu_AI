import assert from 'node:assert/strict';
import test from 'node:test';
import { executeSocialQualityStage } from './socialContentProductionStages.js';

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
