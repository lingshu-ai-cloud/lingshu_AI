import test from 'node:test';
import assert from 'node:assert/strict';
import { sentenceCueQualityFromEvidence } from './sentenceCueQuality.js';

const technical = {
  source: { width: 720, height: 1280, duration: 4, fps: 24, hasAudio: true },
  candidate: { width: 720, height: 1280, duration: 4, fps: 24, hasAudio: true },
  durationDeltaFrames: 0, audioCorrelation: .2, wholeFrameSimilarity: .7, meanFrameDifference: 20,
  temporalMotionDifference: 2, freezeMismatchRatio: 0, comparedFrames: 20, limitations: [],
};

test('independent proxies keep semantic checks pending while recording safe decisions', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c1', mediaEvidence: 'media ok', technical,
    visual: { normalizedPoseError: .03, posePairCount: 20, handPckAt008: null, handPairCount: 0,
      wristSeparationMae: .1, wristMotionCorrelation: .8, wristPosePairCount: 18, backgroundSsim: .92,
      landmarkArtifactCount: 0, faceAppearanceCorrelationProxy: .9, facePairCount: 20 } });
  assert.equal(result.state, 'manual_review');
  assert.equal(result.checks.find(check => check.key === 'background')?.status, 'passed');
  assert.equal(result.checks.find(check => check.key === 'reuse_risk')?.status, 'passed');
  assert.equal(result.checks.find(check => check.key === 'identity')?.status, 'pending');
  assert.equal(result.checks.find(check => check.key === 'product_brand_text')?.status, 'pending');
  assert.equal(result.checks.find(check => check.key === 'audio_sync')?.status, 'pending');
});

test('obvious technical anomalies fail only the affected cue', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c2', mediaEvidence: 'media ok', technical: {
    ...technical, candidate: { ...technical.candidate, hasAudio: false }, durationDeltaFrames: 4,
    wholeFrameSimilarity: .97, temporalMotionDifference: 12, freezeMismatchRatio: .3,
  } });
  assert.equal(result.state, 'failed');
  for (const key of ['motion', 'audio_sync', 'reuse_risk']) assert.equal(result.checks.find(check => check.key === key)?.status, 'failed');
  assert.equal(result.checks.find(check => check.key === 'identity')?.status, 'pending');
});

test('high-confidence semantic evidence can decide identity and product while lip sync stays pending', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c3', mediaEvidence: 'media ok', technical, semantic: { version: 1, model: 'qwen-test',
    identity: { status: 'pass', confidence: .91, evidence: '人物可见特征一致', frameRefs: ['presenter', 'candidate_start'] },
    productBrandText: { status: 'fail', confidence: .88, evidence: '候选标签文字发生变化', frameRefs: ['source_middle', 'candidate_middle'] }, limitations: ['静态帧不能判断口型'] } });
  assert.equal(result.checks.find(check => check.key === 'identity')?.status, 'passed');
  assert.equal(result.checks.find(check => check.key === 'product_brand_text')?.status, 'failed');
  assert.equal(result.checks.find(check => check.key === 'audio_sync')?.status, 'pending');
  assert.equal(result.state, 'failed');
});
