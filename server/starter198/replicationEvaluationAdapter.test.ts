import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentAgentWorkflow, SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';
import { evaluateSocialReplicationResult } from './replicationEvaluationAdapter.js';
import type { SocialReferenceVideoAnalysis } from '../../shared/contracts/socialContentReplication.js';

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

test('single source fidelity grades the original 37 shots even when the authored script shrinks to one', async () => {
  const strictWorkflow = structuredClone(workflow);
  strictWorkflow.replicationJob!.referenceMode = 'single_source_fidelity';
  strictWorkflow.directorBrief.scenes[0]!.replicationFactors![0]!.semanticAdaptation = {
    status: 'functionally_replaced', sourceFactorId: 'factor-cap', targetFunction: 'proof', replacementReason: 'budget',
  };
  const result = await evaluateSocialReplicationResult({
    workflow: strictWorkflow, replicationScript: script, productionResultId: 'strict-result', outputVideoPath: '/unused.mp4',
    referenceAnalysis: { shots: Array.from({ length: 37 }, (_, index) => ({
      shotId: `reference-${index + 1}`, startSeconds: index, endSeconds: index === 36 ? 38 : index + 1, purpose: 'proof',
    })) } as SocialReferenceVideoAnalysis,
  });
  assert.equal(result.evaluation?.status, 'failed');
  assert.ok(result.report?.blockers.some(issue => issue.code === 'shot_missing'));
  assert.ok(result.report?.blockers.some(issue => issue.factorId === 'factor-cap'), 'functional replacement cannot exempt a fidelity factor');
});

test('single source fidelity cannot substitute an authored script for missing reference analysis', async () => {
  const strictWorkflow = structuredClone(workflow);
  strictWorkflow.replicationJob!.referenceMode = 'single_source_fidelity';
  const result = await evaluateSocialReplicationResult({
    workflow: strictWorkflow, replicationScript: script, productionResultId: 'missing-reference', outputVideoPath: '/unused.mp4',
  });
  assert.equal(result.evaluation?.status, 'failed');
  assert.ok(result.report?.blockers.some(issue => issue.code === 'fidelity_reference_analysis_missing'));
});

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

test('replication adapter grades only factors still applicable after a compact semantic revision', async () => {
  const replacedFactors = Array.from({ length: 500 }, (_, index) => ({
    ...workflow.replicationJob!.factorSpecs[0]!,
    factorId: `factor-from-long-reference-${index}`,
    beatId: `beat-from-long-reference-${index}`,
    referenceShotId: `reference-from-long-reference-${index}`,
    description: `38 秒参考片中的原视觉细节 ${index}`,
  }));
  const compactWorkflow = structuredClone(workflow);
  compactWorkflow.replicationJob!.factorSpecs.push(...replacedFactors);
  compactWorkflow.directorBrief.scenes[0]!.replicationFactors = [
    {
      factorId: 'factor-cap',
      semanticAdaptation: { status: 'applicable', sourceFactorId: 'factor-cap', targetFunction: 'proof', replacementReason: null },
    },
    ...replacedFactors.map(replacedFactor => ({
      factorId: replacedFactor.factorId,
      semanticAdaptation: {
        status: 'functionally_replaced', sourceFactorId: replacedFactor.factorId,
        targetFunction: 'proof', replacementReason: '压缩成片以企业产品镜头承担相同证明功能',
      },
    })),
  ] as never;
  const reuse = ['exact_media_hash', 'text_similarity', 'consecutive_frame_similarity', 'audio_fingerprint_similarity'].map((kind, index) => ({
    evidenceId: `compact-reuse-${index}`, kind: kind as 'exact_media_hash' | 'text_similarity' | 'consecutive_frame_similarity' | 'audio_fingerprint_similarity',
    similarity: 0.1, riskThreshold: 0.9, status: 'available' as const, authorization: 'unknown' as const,
    evidenceRefs: [`worker://compact-reuse/${index}`], provenance,
  }));
  const result = await evaluateSocialReplicationResult({
    workflow: compactWorkflow as SocialContentAgentWorkflow,
    replicationScript: script,
    productionResultId: 'result-compact', outputVideoPath: '/not/required.mp4',
    evidence: {
      factorEvidence: [{ factorId: 'factor-cap', sceneId: 'scene-1', outcome: 'pass', actual: 'open', evidenceRefs: ['worker://frame/compact'], provenance }],
      reuseRiskEvidence: reuse,
    },
    now: new Date('2026-09-24T00:00:00.000Z'),
  });
  assert.equal(result.evaluation?.status, 'passed', JSON.stringify(result.report, null, 2));
  assert.equal(result.report?.dimensions.viralFactorFidelity.required, 2, 'one compact timeline shot plus one applicable factor');
  assert.equal(result.report?.blockers.some(issue => replacedFactors.some(factor => factor.factorId === issue.factorId)), false);
  assert.equal(result.report?.evidenceInventory.factorEvidence, 1);
});

test('replication adapter builds identity requirements from normalized applicable factor specs', async () => {
  const identityWorkflow = structuredClone(workflow);
  identityWorkflow.replicationJob!.factorSpecs[0] = {
    ...identityWorkflow.replicationJob!.factorSpecs[0]!,
    factorId: 'factor-identity', category: 'identity', policy: 'replace_identity',
    target: { metric: 'identity', value: 'reference-person', unit: null, regionRef: null, stateKey: 'person' },
  };
  identityWorkflow.directorBrief.scenes[0]!.replicationFactors = [{ factorId: 'factor-identity' }] as never;
  const reuse = ['exact_media_hash', 'text_similarity', 'consecutive_frame_similarity', 'audio_fingerprint_similarity'].map((kind, index) => ({
    evidenceId: `identity-reuse-${index}`, kind: kind as 'exact_media_hash' | 'text_similarity' | 'consecutive_frame_similarity' | 'audio_fingerprint_similarity',
    similarity: 0.1, riskThreshold: 0.9, status: 'available' as const, authorization: 'unknown' as const,
    evidenceRefs: [`worker://identity-reuse/${index}`], provenance,
  }));
  const result = await evaluateSocialReplicationResult({
    workflow: identityWorkflow as SocialContentAgentWorkflow, replicationScript: script,
    productionResultId: 'result-identity', outputVideoPath: '/not/required.mp4',
    evidence: {
      factorEvidence: [{ factorId: 'factor-identity', sceneId: 'scene-1', outcome: 'pass', actual: 'reference-person', evidenceRefs: ['worker://identity-factor'], provenance }],
      identityEvidence: [{ requirementId: 'factor-identity', outcome: 'replaced', detectedOriginal: false, detectedReplacement: 'product-1', evidenceRefs: ['worker://identity'], provenance }],
      reuseRiskEvidence: reuse,
    },
  });
  assert.equal(result.evaluation?.identityReplacement.status, 'passed', JSON.stringify(result.report, null, 2));
});

test('five selected scenes do not inherit 38-second timeline or 501 source-factor assertions', async () => {
  const base = workflow.replicationJob!.factorSpecs[0]!;
  const replaced = Array.from({ length: 300 }, (_, index) => ({
    ...base, factorId: `replaced-${index}`, beatId: `source-beat-${index}`,
    referenceShotId: `source-reference-${index}`, description: `已由紧凑脚本功能替换 ${index}`,
  }));
  const identities = Array.from({ length: 100 }, (_, index) => ({
    ...base, factorId: `identity-${index}`, beatId: `source-identity-${index}`,
    referenceShotId: `selected-reference-${index % 5}`, category: 'identity', policy: 'replace_identity' as const,
    description: `来源身份 ${index}`, target: { ...base.target, metric: 'identity', value: `source-person-${index}` },
  }));
  const prohibitReuse = Array.from({ length: 101 }, (_, index) => ({
    ...base, factorId: `prohibit-${index}`, beatId: `source-reuse-${index}`,
    referenceShotId: `selected-reference-${index % 5}`, policy: 'prohibit_reuse' as const,
    description: `禁止复用来源媒体 ${index}`,
  }));
  const allFactors = [...replaced, ...identities, ...prohibitReuse];
  assert.equal(allFactors.length, 501);
  const scenes = Array.from({ length: 5 }, (_, index) => ({
    ...workflow.directorBrief.scenes[0]!, sceneId: `selected-scene-${index}`,
    referenceShotId: `selected-reference-${index}`, purpose: 'proof',
    duration: { startSeconds: index * 2, endSeconds: index * 2 + 2, targetSeconds: 2 },
    replicationFactors: allFactors.filter((_, factorIndex) => factorIndex % 5 === index).map(factor => ({
      factorId: factor.factorId,
      semanticAdaptation: factor.factorId.startsWith('replaced-')
        ? { status: 'functionally_replaced', sourceFactorId: factor.factorId, targetFunction: 'proof', replacementReason: '预算语义修订' }
        : { status: 'applicable', sourceFactorId: factor.factorId, targetFunction: 'proof', replacementReason: null },
    })),
  }));
  const selectedShots = scenes.map((scene, index) => ({
    shotId: scene.sceneId, referenceShotId: scene.referenceShotId,
    startSeconds: index * 2, endSeconds: index * 2 + 2, purpose: 'proof',
  }));
  const unselectedShots = Array.from({ length: 95 }, (_, index) => ({
    shotId: `unselected-${index}`, referenceShotId: `unselected-reference-${index}`,
    startSeconds: 10 + index * .3, endSeconds: 10.3 + index * .3, purpose: 'source-only',
  }));
  const compactWorkflow = {
    ...workflow,
    replicationJob: { ...workflow.replicationJob!, factorSpecs: allFactors },
    directorBrief: { ...workflow.directorBrief, scenes },
  } as unknown as SocialContentAgentWorkflow;
  const reuse = ['exact_media_hash', 'text_similarity', 'consecutive_frame_similarity', 'audio_fingerprint_similarity'].map((kind, index) => ({
    evidenceId: `selected-reuse-${index}`, kind: kind as 'exact_media_hash' | 'text_similarity' | 'consecutive_frame_similarity' | 'audio_fingerprint_similarity',
    similarity: 0.1, riskThreshold: 0.9, status: 'available' as const, authorization: 'unknown' as const,
    evidenceRefs: [`worker://selected-reuse/${index}`], provenance,
  }));
  const result = await evaluateSocialReplicationResult({
    workflow: compactWorkflow,
    replicationScript: { shots: [...selectedShots, ...unselectedShots] } as unknown as SocialReplicationScriptVersion,
    productionResultId: 'result-five-scenes', outputVideoPath: '/not/required.mp4',
    evidence: {
      identityEvidence: Array.from({ length: 5 }, (_, index) => ({
        requirementId: `identity-${index}`, outcome: 'replaced' as const, detectedOriginal: false,
        detectedReplacement: 'product-1', evidenceRefs: [`worker://selected-identity/${index}`], provenance,
      })),
      reuseRiskEvidence: reuse,
    },
  });
  assert.equal(result.report?.releaseDecision, 'pass', JSON.stringify(result.report, null, 2));
  assert.equal(result.report?.dimensions.viralFactorFidelity.required, 5, 'only the five selected timeline shots remain');
  assert.equal(result.report?.dimensions.identityReplacement.required, 5, 'source identity factors collapse to one requirement per final scene');
  assert.equal(result.report?.blockers.some(issue => issue.code === 'shot_missing'), false);
  assert.equal(result.report?.blockers.some(issue => issue.factorId?.startsWith('replaced-')), false);
});
