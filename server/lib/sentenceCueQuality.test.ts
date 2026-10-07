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

test('moderate generated gesture differences do not block photo talking', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c2b', mediaEvidence: 'media ok', technical: {
    ...technical, temporalMotionDifference: 12.86, freezeMismatchRatio: 0,
  } });
  assert.equal(result.checks.find(check => check.key === 'motion')?.status, 'pending');
  assert.equal(result.state, 'manual_review');
});

test('high-confidence semantic evidence can decide identity and product while lip sync stays pending', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c3', mediaEvidence: 'media ok', technical, semantic: { version: 1, model: 'qwen-test',
    identity: { status: 'pass', confidence: .91, evidence: '人物可见特征一致', frameRefs: ['presenter', 'candidate_start'] },
    actionMotion: { status: 'pass', confidence: .9, evidence: '动作顺序一致', frameRefs: ['source_start', 'candidate_start', 'source_middle', 'candidate_middle'] },
    productBrandText: { status: 'fail', confidence: .88, evidence: '候选标签文字发生变化', frameRefs: ['source_middle', 'candidate_middle'] }, limitations: ['静态帧不能判断口型'] } });
  assert.equal(result.checks.find(check => check.key === 'identity')?.status, 'passed');
  assert.equal(result.checks.find(check => check.key === 'motion')?.status, 'passed');
  assert.equal(result.checks.find(check => check.key === 'product_brand_text')?.status, 'failed');
  assert.equal(result.checks.find(check => check.key === 'audio_sync')?.status, 'pending');
  assert.equal(result.state, 'failed');
});

test('automatic release requires every independent check to pass', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c4', mediaEvidence: 'media ok', technical,
    visual: { normalizedPoseError: .03, posePairCount: 20, handPckAt008: .9, handPairCount: 12,
      wristSeparationMae: .1, wristMotionCorrelation: .8, wristPosePairCount: 18, backgroundSsim: .92,
      landmarkArtifactCount: 0, faceAppearanceCorrelationProxy: .9, facePairCount: 20 },
    semantic: { version: 1, model: 'qwen-test',
      identity: { status: 'pass', confidence: .91, evidence: '人物跨帧一致', frameRefs: ['presenter', 'candidate_start', 'candidate_end'] },
      actionMotion: { status: 'pass', confidence: .9, evidence: '动作顺序一致', frameRefs: ['source_start', 'candidate_start', 'source_end', 'candidate_end'] },
      productBrandText: { status: 'pass', confidence: .9, evidence: '产品外形与可见文字一致', frameRefs: ['source_middle', 'candidate_middle'] }, limitations: [] },
    lipSync: { version: 1, detector: 'official_syncnet', modelSha256: 'a'.repeat(64), passed: true,
      confidence: 7.5, avOffsetFrames: 1, thresholds: { confidenceMin: 7, absoluteOffsetFramesMax: 1 }, failures: [] },
  });
  assert.equal(result.state, 'accepted');
  assert.ok(result.checks.every(check => check.status === 'passed'));
});

test('provider or structural audio evidence alone never passes lip sync', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c5', mediaEvidence: 'media ok', technical,
    lipSyncError: '官方 SyncNet 模型未安装' });
  assert.equal(result.checks.find(check => check.key === 'audio_sync')?.status, 'pending');
  assert.equal(result.state, 'manual_review');
});

test('a generated clip duration that differs from the reference cue does not fail audio sync', () => {
  const result = sentenceCueQualityFromEvidence({ cueId: 'c6', mediaEvidence: '4.200s · audio=true', technical: {
    ...technical,
    source: { ...technical.source, duration: 5.6 },
    candidate: { ...technical.candidate, duration: 4.2, hasAudio: true },
    durationDeltaFrames: 34,
  } });
  assert.equal(result.checks.find(check => check.key === 'audio_sync')?.status, 'pending',
    'reference timing is composition evidence; generated speech keeps its measured duration and awaits lip-sync review');
  assert.notEqual(result.state, 'failed');
});
