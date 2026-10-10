import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePersonReplacementVisualReport } from './personReplacementVisualQuality.js';

test('visual QA parser accepts complete proxy evidence and rejects malformed output', () => {
  const report = parsePersonReplacementVisualReport({ version: 1, normalizedPoseError: .03, posePairCount: 20, handPckAt008: null, handPairCount: 0,
    wristSeparationMae: .1, wristMotionCorrelation: .8, wristPosePairCount: 18, backgroundSsim: .92, landmarkArtifactCount: 0,
    faceAppearanceCorrelationProxy: .6, facePairCount: 12 });
  assert.equal(report.posePairCount, 20); assert.equal(report.backgroundSsim, .92); assert.equal(report.faceAppearanceCorrelationProxy, .6);
  assert.throws(() => parsePersonReplacementVisualReport({ version: 1, normalizedPoseError: 2, posePairCount: 1, handPckAt008: null, handPairCount: 0,
    wristSeparationMae: null, wristMotionCorrelation: null, wristPosePairCount: 0, backgroundSsim: null, landmarkArtifactCount: 0, faceAppearanceCorrelationProxy: null, facePairCount: 0 }), /超出范围/);
  assert.throws(() => parsePersonReplacementVisualReport({ version: 2 }), /版本/);
});
