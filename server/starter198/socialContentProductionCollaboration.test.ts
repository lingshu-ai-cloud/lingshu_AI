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
