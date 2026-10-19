import test from 'node:test';
import assert from 'node:assert/strict';
import {initialSceneG4Evidence, type InitialSceneQualityReport} from './socialContentInitialSceneCache.js';

const cleanReport: InitialSceneQualityReport = {
  schemaVersion: 'initial-scene-quality.v1',
  visual: {passed: true, failures: [], metrics: {sampleCount: 1, contentFrameCount: 1,
    nonBackgroundFrameRatio: 1, meanBrightness: 100, meanLumaDeviation: 20, meanEdgeRatio: 1,
    meanFrameDifference: 1, maxFrameDifference: 1, motionDetected: true,
    estimatedDistinctFrames: 1, nearDuplicateFrameRatio: 0, sharpFrameRatio: 1}, evidenceFrames: []},
  scenes: {passed: true, issues: [], checkedScenes: 1},
  audio: {ok: true, error: null},
};

test('initial G4 does not promote a decodable local render to an automatic passed audit', () => {
  const evidence = initialSceneG4Evidence(cleanReport, 0, 1, 'a'.repeat(64));
  assert.equal(evidence.status, 'review_required');
  assert.deepEqual(evidence.checks.filter(check => !check.passed).map(check => check.code),
    ['format', 'duration', 'audio_visual_sync', 'caption', 'sensitive_data']);
  assert.deepEqual(evidence.checks.filter(check => check.passed).map(check => check.code),
    ['linked_assets', 'render']);
});

test('actual detector failure cannot be softened to review_required', () => {
  const report: InitialSceneQualityReport = {
    ...cleanReport,
    scenes: {passed: false, checkedScenes: 1, issues: [{sceneIndex: 0, start: 0, end: 3, code: 'black_scene', reason: 'decoded frames are black'}]},
  };
  const evidence = initialSceneG4Evidence(report, 0, 1, 'b'.repeat(64));
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.checks.find(check => check.code === 'render')?.passed, false);
});
