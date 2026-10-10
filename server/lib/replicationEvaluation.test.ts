import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateReplication,
  type ReplicationEvaluationInput,
  type ReuseRiskEvidence,
} from './replicationEvaluation.js';

const provenance = { producer: 'cv_worker' as const, detector: 'fixture-detector', detectorVersion: '1' };
const referenceTimeline = [
  { shotId: 'ref-1', startSeconds: 0, endSeconds: 2, purpose: 'hook' },
  { shotId: 'ref-2', startSeconds: 2, endSeconds: 5, purpose: 'proof' },
];
const outputTimeline = [
  { shotId: 'scene-1', referenceShotId: 'ref-1', startSeconds: 0.1, endSeconds: 2.05, purpose: 'hook' },
  { shotId: 'scene-2', referenceShotId: 'ref-2', startSeconds: 2.05, endSeconds: 5.1, purpose: 'proof' },
];
const factors = [
  {
    factorId: 'cap-open', sceneId: 'scene-1', referenceShotId: 'ref-1', category: 'object_state',
    description: '瓶盖保持打开', policy: 'lock' as const, importance: 'critical' as const, expected: 'open',
  },
  {
    factorId: 'lived-in-desk', sceneId: 'scene-1', referenceShotId: 'ref-1', category: 'environment',
    description: '生活化桌面氛围等价', policy: 'equivalent' as const, importance: 'high' as const,
  },
  {
    factorId: 'product-ratio', sceneId: 'scene-2', referenceShotId: 'ref-2', category: 'composition',
    description: '产品画面占比', policy: 'bounded' as const, importance: 'high' as const, tolerance: { min: 0.25, max: 0.4 },
  },
];
const factorEvidence = [
  { factorId: 'cap-open', sceneId: 'scene-1', outcome: 'pass' as const, actual: 'open', evidenceRefs: ['frame://scene-1/1'], provenance },
  { factorId: 'lived-in-desk', sceneId: 'scene-1', outcome: 'pass' as const, evidenceRefs: ['cv://scene-1/environment'], provenance },
  { factorId: 'product-ratio', sceneId: 'scene-2', outcome: 'pass' as const, actual: 0.32, evidenceRefs: ['cv://scene-2/mask'], provenance },
];
const passRiskEvidence: ReuseRiskEvidence[] = [
  {
    evidenceId: 'frames', kind: 'consecutive_frame_similarity', similarity: 0.22, riskThreshold: 0.92,
    status: 'available', authorization: 'unknown', evidenceRefs: ['cv://reuse/frames'], provenance,
  },
  {
    evidenceId: 'audio', kind: 'audio_fingerprint_similarity', similarity: 0.08, riskThreshold: 0.9,
    status: 'available', authorization: 'unknown', evidenceRefs: ['audio://fingerprint'],
    provenance: { producer: 'audio_worker', detector: 'fixture-audio', detectorVersion: '1' },
  },
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replication-evaluation-'));
try {
  const referencePath = path.join(root, 'reference.mp4');
  const outputPath = path.join(root, 'output.mp4');
  fs.writeFileSync(referencePath, 'reference-media');
  fs.writeFileSync(outputPath, 'new-output-media');

  const base: ReplicationEvaluationInput = {
    referenceTimeline,
    outputTimeline,
    factors,
    factorEvidence,
    identityRequirements: [
      { requirementId: 'product', identityType: 'product', originalIdentity: '竞品面霜', expectedReplacement: '自有面霜', required: true, sceneIds: ['scene-2'] },
      { requirementId: 'face', identityType: 'face', originalIdentity: '原人物', expectedReplacement: '数字人A', required: true, sceneIds: ['scene-1'] },
    ],
    identityEvidence: [
      { requirementId: 'product', outcome: 'replaced', detectedOriginal: false, detectedReplacement: '自有面霜', evidenceRefs: ['cv://identity/product'], provenance },
      { requirementId: 'face', outcome: 'replaced', detectedOriginal: false, detectedReplacement: '数字人A', evidenceRefs: ['cv://identity/face'], provenance },
    ],
    reuseRiskEvidence: passRiskEvidence,
    accountProductFitChecks: [
      { checkId: 'fact', label: '产品事实来自企业知识库', outcome: 'pass', required: true, evidenceRefs: ['knowledge://product/1'] },
    ],
    media: {
      referenceVideoPath: referencePath,
      outputVideoPath: outputPath,
      referenceText: '三秒看懂这瓶面霜为什么适合干皮',
      outputText: '秋冬护肤先看屏障状态，再按需补充保湿',
    },
  };

  const passed = await evaluateReplication(base);
  assert.equal(passed.releaseDecision, 'pass', JSON.stringify(passed, null, 2));
  assert.equal(passed.dimensions.viralFactorFidelity.status, 'pass');
  assert.equal(passed.dimensions.viralFactorFidelity.score, 100);
  assert.equal(passed.dimensions.identityReplacement.score, 100);
  assert.equal(passed.dimensions.unauthorizedReuseRisk.status, 'pass');
  assert.equal(passed.dimensions.accountProductFit.status, 'pass');
  assert.equal(passed.shotResults.every(item => item.status === 'pass'), true);

  const failed = await evaluateReplication({
    ...base,
    outputTimeline: [
      { shotId: 'scene-1', referenceShotId: 'ref-1', startSeconds: 0, endSeconds: 4, purpose: 'proof' },
      { shotId: 'scene-2', referenceShotId: 'ref-2', startSeconds: 4, endSeconds: 5, purpose: 'proof' },
    ],
    factorEvidence: factorEvidence.map(item => item.factorId === 'product-ratio' ? { ...item, actual: 0.7 } : item),
    identityEvidence: base.identityEvidence?.map(item => item.requirementId === 'face'
      ? { ...item, outcome: 'not_replaced' as const, detectedOriginal: true }
      : item),
    reuseRiskEvidence: [
      ...passRiskEvidence,
      { evidenceId: 'copied-frames', kind: 'consecutive_frame_similarity', similarity: 0.97, riskThreshold: 0.92, status: 'available', authorization: 'unknown', sceneId: 'scene-1', evidenceRefs: ['cv://copied'], provenance },
    ],
  });
  assert.equal(failed.releaseDecision, 'blocked');
  assert.equal(failed.dimensions.viralFactorFidelity.status, 'fail');
  assert.equal(failed.dimensions.identityReplacement.status, 'fail');
  assert.equal(failed.dimensions.unauthorizedReuseRisk.status, 'fail');
  assert.ok(failed.blockers.some(item => item.code === 'bounded_value_outside_tolerance'));
  assert.ok(failed.blockers.some(item => item.code === 'identity_replacement_failed'));
  assert.ok(failed.blockers.some(item => item.code === 'reuse_risk_consecutive_frame_similarity'));
  assert.equal(failed.shotResults.find(item => item.sceneId === 'scene-1')?.status, 'fail');

  const honestMissingEvidence = await evaluateReplication({
    referenceTimeline: referenceTimeline.slice(0, 1),
    outputTimeline: outputTimeline.slice(0, 1),
    factors: factors.slice(0, 1),
    factorEvidence: factorEvidence.slice(0, 1),
  });
  assert.equal(honestMissingEvidence.releaseDecision, 'review_required');
  assert.equal(honestMissingEvidence.dimensions.unauthorizedReuseRisk.status, 'incomplete');
  assert.equal(honestMissingEvidence.dimensions.unauthorizedReuseRisk.score, null);
  assert.deepEqual(honestMissingEvidence.evidenceInventory.unavailableReuseChecks.sort(), [
    'audio_fingerprint_similarity', 'consecutive_frame_similarity', 'exact_media_hash', 'text_similarity',
  ]);
  assert.ok(honestMissingEvidence.limitations.some(item => item.includes('不会臆造')));

  const samePath = path.join(root, 'same.mp4');
  fs.writeFileSync(samePath, 'identical-media');
  const exactCopy = await evaluateReplication({
    ...base,
    media: { ...base.media, referenceVideoPath: samePath, outputVideoPath: samePath },
  });
  assert.equal(exactCopy.releaseDecision, 'blocked');
  assert.ok(exactCopy.blockers.some(item => item.code === 'reuse_risk_exact_media_hash'));

  const missingLockedEvidence = await evaluateReplication({
    ...base,
    factorEvidence: factorEvidence.filter(item => item.factorId !== 'cap-open'),
  });
  assert.equal(missingLockedEvidence.releaseDecision, 'blocked');
  assert.ok(missingLockedEvidence.blockers.some(item => item.code === 'factor_evidence_missing' && item.factorId === 'cap-open'));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('replication evaluation tests passed');
