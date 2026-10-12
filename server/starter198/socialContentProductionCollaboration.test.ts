import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentAgentWorkflow } from '../../shared/contracts/socialContentAgentContract.js';
import type { SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import { socialProductionCollaborationFailures, socialProductionCollaborationTrace } from './socialContentProductionCollaboration.js';

const workflow = {
  directorBrief: { scenes: [{ sceneId: 'scene-1', acceptanceCriteria: ['主体清晰'] }] },
  executionPlan: { scenes: [{ sceneId: 'scene-1' }] },
  executionPlanReview: { approved: true, sceneResults: [{ sceneId: 'scene-1', approved: true }] },
} as unknown as SocialContentAgentWorkflow;
const handoff = {
  directorPlanId: 'director-plan', planVersion: '2', lineageHash: 'lineage', handoffHash: 'handoff',
  scenes: [{ sceneId: 'scene-1', source: { assetId: 'asset-1', clipId: 'clip-1' } }],
  collaboration: null,
} as unknown as SocialDirectorContentHandoff;

test('final content execution remains traceable to every reviewed Agent stage', () => {
  assert.deepEqual(socialProductionCollaborationFailures(workflow, handoff), []);
  const trace = socialProductionCollaborationTrace(workflow, handoff);
  assert.equal(trace.finalExecutionLock.handoffHash, 'handoff');
  assert.deepEqual(trace.sceneLineage[0], {
    order: 1, finalSceneId: 'scene-1', directorSceneId: 'scene-1', executionSceneId: 'scene-1',
    reviewApproved: true, assetId: 'asset-1', clipId: 'clip-1',
  });
});

test('collaboration gate rejects duplicate final scene identities', () => {
  const extra = { ...handoff, scenes: [...handoff.scenes, handoff.scenes[0]!] } as SocialDirectorContentHandoff;
  assert.ok(socialProductionCollaborationFailures(workflow, extra).length >= 1);
});

test('a selected subset keeps lineage by original DirectorBrief order', () => {
  const orderedWorkflow = {
    directorBrief: { scenes: Array.from({ length: 6 }, (_, index) => ({
      sceneId: `replication-shot-${index + 1}`, order: index + 1, acceptanceCriteria: ['主体清晰'],
    })) },
    executionPlan: { scenes: Array.from({ length: 6 }, (_, index) => ({ sceneId: `replication-shot-${index + 1}` })) },
    executionPlanReview: { approved: true, sceneResults: Array.from({ length: 6 }, (_, index) => ({
      sceneId: `replication-shot-${index + 1}`, approved: true,
    })) },
  } as unknown as SocialContentAgentWorkflow;
  const selected = {
    ...handoff,
    scenes: ['scene-1', 'scene-2', 'scene-3', 'scene-6'].map((sceneId, index) => ({
      sceneId, source: { assetId: `asset-${index + 1}`, clipId: `clip-${index + 1}` },
    })),
  } as SocialDirectorContentHandoff;
  assert.deepEqual(socialProductionCollaborationFailures(orderedWorkflow, selected), []);
  assert.equal(socialProductionCollaborationTrace(orderedWorkflow, selected).sceneLineage[3]?.directorSceneId, 'replication-shot-6');
});

function fidelityFixture() {
  const referenceAnalysis = { analysisId: 'reference', durationSeconds: 38, shots: Array.from({ length: 37 }, (_, i) => ({
    shotId: `shot-${i + 1}`, startSeconds: i * 38 / 37, endSeconds: (i + 1) * 38 / 37,
  })) } as import('../../shared/contracts/socialContentReplication.js').SocialReferenceVideoAnalysis;
  const scenes = referenceAnalysis.shots.map((shot, i) => ({ sceneId: `scene-${i + 1}`, order: i + 1,
    referenceShotId: shot.shotId, acceptanceCriteria: ['主体清晰'],
    duration: { startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, targetSeconds: shot.endSeconds - shot.startSeconds },
  }));
  const wf = { ...workflow, directorBrief: { referenceMode: 'single_source_fidelity', totalDurationSeconds: 38, scenes },
    executionPlan: { scenes }, executionPlanReview: { approved: true, sceneResults: scenes.map(s => ({ sceneId: s.sceneId, approved: true })) },
  } as unknown as SocialContentAgentWorkflow;
  const hf = { ...handoff, outputSpec: { targetDurationSeconds: 38 }, scenes: scenes.map(s => ({
    sceneId: s.sceneId, source: { assetId: 'reusable-asset', clipId: 'reusable-clip' },
  })) } as unknown as SocialDirectorContentHandoff;
  return { wf, hf, referenceAnalysis };
}

test('single reference preserves all 37 cuts while permitting source asset reuse', () => {
  const { wf, hf, referenceAnalysis } = fidelityFixture();
  assert.deepEqual(socialProductionCollaborationFailures(wf, hf, { referenceAnalysis, renderedDurationSeconds: 38.01,
    renderedTimeline: referenceAnalysis.shots.map((s, i) => ({ sceneId: hf.scenes[i]!.sceneId, startSeconds: s.startSeconds, endSeconds: s.endSeconds })),
  }), []);
});

test('compressed five scenes cannot certify coverage against their own DirectorBrief', () => {
  const { wf, hf, referenceAnalysis } = fidelityFixture();
  wf.directorBrief.scenes = wf.directorBrief.scenes.slice(0, 5);
  hf.scenes = hf.scenes.slice(0, 5);
  assert.ok(socialProductionCollaborationFailures(wf, hf, { referenceAnalysis }).some(s => s.includes('全部 37')));
});

test('single reference rejects missing analysis, reordered cuts, altered timing and short render', () => {
  const { wf, hf, referenceAnalysis } = fidelityFixture();
  assert.ok(socialProductionCollaborationFailures(wf, hf).some(s => s.includes('缺少完整')));
  [hf.scenes[0], hf.scenes[1]] = [hf.scenes[1]!, hf.scenes[0]!];
  assert.ok(socialProductionCollaborationFailures(wf, hf, { referenceAnalysis }).some(s => s.includes('顺序')));
  [hf.scenes[0], hf.scenes[1]] = [hf.scenes[1]!, hf.scenes[0]!];
  wf.directorBrief.scenes[0]!.duration.endSeconds += 0.2;
  const failures = socialProductionCollaborationFailures(wf, hf, { referenceAnalysis, renderedDurationSeconds: 10.923 });
  assert.ok(failures.some(s => s.includes('时间区间')));
  assert.ok(failures.some(s => s.includes('实际成片时长')));
});
