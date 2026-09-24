import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPersonReplacementPair } from './personReplacementMediaQuality.js';

const fixtureDir = '/Users/julia_chen/Downloads/edit/runway-person-test';

test('measures a video against itself as an exact technical match', async () => {
  const source = `${fixtureDir}/IMG_1865-first5s-SDR.mp4`;
  const report = await inspectPersonReplacementPair(source, source);
  assert.equal(report.durationDeltaFrames, 0);
  assert.ok((report.audioCorrelation || 0) > 0.9999);
  assert.ok(report.wholeFrameSimilarity > 0.9999);
  assert.ok(report.comparedFrames >= 5);
});

test('detects the known Act-Two output as a visual mismatch while preserving its audio', async () => {
  const report = await inspectPersonReplacementPair(
    `${fixtureDir}/IMG_1865-first5s-SDR.mp4`,
    `${fixtureDir}/act-two-expert-person-reenactment-2026-09-22.mp4`,
  );
  assert.ok((report.audioCorrelation || 0) > 0.99);
  assert.ok(report.wholeFrameSimilarity < 0.9);
});
