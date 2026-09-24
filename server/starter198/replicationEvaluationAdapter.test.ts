import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentAgentWorkflow, SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';
import { evaluateSocialReplicationResult } from './replicationEvaluationAdapter.js';

const workflow = {
  replicationJob: {
    replicationJobId: 'job-1', version: '2', factorSpecVersion: '3',
    target: {
      productRef: 'product-1', accountRef: { objectType: 'owned_account', id: 'account-1', version: '1' },
      accountPlaybookRef: { objectType: 'account_playbook', id: 'playbook-1', version: '4', accountRef: 'account-1' },
    },
    factorSpecs: [{
      factorId: 'factor-cap', version: '3', beatId: 'beat-1', referenceShotId: 'reference-1',
      category: 'object_state', description: '瓶盖保持打开', causalRole: 'proof', causalStatus: 'observed_correlation',
      policy: 'lock', importance: 'critical', target: { metric: 'cap_state', value: 'open', unit: null, regionRef: null, stateKey: 'cap' },
      tolerance: { metric: 'enum', minimum: null, maximum: null, allowedValues: ['open'], maximumDeviation: null, unit: null, humanReviewWhen: [] },
      observationConfidence: .9, causalConfidence: .6, evidenceRefs: [],
      validator: { validatorId: 'v1', kind: 'vision_state', detector: 'state-detector', blocking: true, threshold: .8, evidenceOutput: ['measurement'], fallbackToHuman: true },
      status: 'frozen', frozenAt: '2026-09-24T00:00:00.000Z', decisionOwner: 'director_agent',
    }],
  },
  directorBrief: {
    factSourceRefs: ['enterprise:product-1:v3'],
    scenes: [{
      sceneId: 'scene-1', referenceShotId: 'reference-1', purpose: 'proof',
      duration: { startSeconds: 0, endSeconds: 2, targetSeconds: 2 },
      replicationFactors: [{ factorId: 'factor-cap' }],
    }],
  },
} as unknown as SocialContentAgentWorkflow;

const script = {
  shots: [{ shotId: 'shot-1', referenceShotId: 'reference-1', startSeconds: 0, endSeconds: 2, purpose: 'proof' }],
} as unknown as SocialReplicationScriptVersion;

const provenance = { producer: 'cv_worker' as const, detector: 'test-detector', detectorVersion: '1' };

test('replication adapter keeps missing detector evidence visible and blocks release', async () => {
  const result = await evaluateSocialReplicationResult({
    workflow, replicationScript: script, productionResultId: 'result-1', outputVideoPath: '/not/required.mp4',
    now: new Date('2026-09-24T00:00:00.000Z'),
  });
  assert.equal(result.evaluation?.status, 'failed');
  assert.equal(result.evaluation?.viralFactorFidelity.status, 'failed');
  assert.equal(result.evaluation?.accountAndFactFit.status, 'passed');
  assert.equal(result.evaluation?.directorDecision.status, 'pending');
});

test('replication adapter maps auditable worker evidence to a releasable five-dimension report', async () => {
  const reuse = ['exact_media_hash', 'text_similarity', 'consecutive_frame_similarity', 'audio_fingerprint_similarity'].map((kind, index) => ({
    evidenceId: `reuse-${index}`, kind: kind as 'exact_media_hash' | 'text_similarity' | 'consecutive_frame_similarity' | 'audio_fingerprint_similarity',
    similarity: 0.1, riskThreshold: 0.9, status: 'available' as const, authorization: 'unknown' as const,
    evidenceRefs: [`worker://reuse/${index}`], provenance,
  }));
  const result = await evaluateSocialReplicationResult({
    workflow, replicationScript: script, productionResultId: 'result-2', outputVideoPath: '/not/required.mp4',
    evidence: {
      factorEvidence: [{ factorId: 'factor-cap', sceneId: 'scene-1', outcome: 'pass', actual: 'open', evidenceRefs: ['worker://frame/1'], provenance }],
      reuseRiskEvidence: reuse,
    },
    now: new Date('2026-09-24T00:00:00.000Z'),
  });
  assert.equal(result.report?.releaseDecision, 'pass', JSON.stringify(result.report, null, 2));
  assert.equal(result.evaluation?.status, 'passed');
  assert.equal(result.evaluation?.unauthorizedReuseRisk.status, 'passed');
  assert.equal(result.evaluation?.productionResultId, 'result-2');
});

test('replication adapter is not applicable to material-processing workflows', async () => {
  const result = await evaluateSocialReplicationResult({
    workflow: { ...workflow, replicationJob: null } as SocialContentAgentWorkflow,
    replicationScript: null, productionResultId: 'result-3', outputVideoPath: '/unused.mp4',
  });
  assert.deepEqual(result, { evaluation: null, report: null });
});
