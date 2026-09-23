import assert from 'node:assert/strict';
import type { SocialProductionResult, SocialReferenceVideoAnalysis } from './contracts/socialContentWorkflow';
import { buildSocialCreativePatternMemory } from './socialCreativePatternMemory';

function analysis(id: string): SocialReferenceVideoAnalysis {
  return {
    analysisId: id, version: `v-${id}`, referenceSourceId: `source-${id}`, status: 'ready', durationSeconds: 8,
    shots: [
      { shotId: `${id}-1`, startSeconds: 0, endSeconds: 3, visualDescription: '开场', spokenText: null, captionText: null, audioDescription: null, rhythmDescription: '快切', purpose: 'hook', tags: { sceneTypes: [], subjects: [], subjectRelations: [], cameraLanguage: [], contentFunctions: ['hook'], soundTypes: [], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] }, fidelityPoints: ['前三秒建立主题'], mustDifferPoints: ['替换原话'] },
      { shotId: `${id}-2`, startSeconds: 3, endSeconds: 6, visualDescription: '证据', spokenText: null, captionText: null, audioDescription: null, rhythmDescription: '稳定展示', purpose: 'proof', tags: { sceneTypes: [], subjects: [], subjectRelations: [], cameraLanguage: [], contentFunctions: ['proof'], soundTypes: [], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] }, fidelityPoints: ['证据在中段'], mustDifferPoints: ['替换品牌'] },
      { shotId: `${id}-3`, startSeconds: 6, endSeconds: 8, visualDescription: '行动', spokenText: null, captionText: null, audioDescription: null, rhythmDescription: '停留', purpose: 'call_to_action', tags: { sceneTypes: [], subjects: [], subjectRelations: [], cameraLanguage: [], contentFunctions: ['call_to_action'], soundTypes: [], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] }, fidelityPoints: ['末尾行动'], mustDifferPoints: ['改写文案'] },
    ],
    hookAnalysis: { hookId: `hook-${id}`, role: 'primary', firstFrame: '主体', firstSecondAction: '推进', spokenLine: null, caption: null, mechanism: '结果前置', audiovisualPlan: '同步', sourceStrategy: 'motion_graphics', truthBoundary: { subject: 'none', syntheticVisualAllowed: true, customerEvidenceRequired: false, customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true, prohibitedRepresentations: [] }, referencePoints: [], mustDifferPoints: [], status: 'recommended' },
    rightsNotice: '仅分析结构', createdAt: '2026-09-23T00:00:00.000Z',
  };
}

const productionResult = {
  productionResultId: 'result-1', version: 'v1', executionPlanId: 'plan-1', executionPlanVersion: 'v1', executionPlanReviewId: 'review-1', artifactId: 'artifact-1', creativeReviewId: 'creative-1', publishAssignmentId: null, status: 'asset_review', sceneResults: [], technicalReview: { approved: true, checkedScenes: 3, failures: [] }, creativeReview: { approved: true, failedCriteria: [], reviewedBy: 'director_agent' }, artifactResourceRef: 'artifact-1', createdAt: '2026-09-23T00:00:00.000Z',
} satisfies SocialProductionResult;

assert.equal(buildSocialCreativePatternMemory({ samples: [{ analysis: analysis('a'), industry: 'beauty' }], productionResults: [productionResult] }), null,
  'one reference must never become a reusable pattern');
const memory = buildSocialCreativePatternMemory({
  samples: [
    { analysis: analysis('a'), industry: 'beauty', emotionTags: ['好奇→信任'] },
    { analysis: analysis('b'), industry: 'beauty', failureConditions: ['缺少真实证据时失效'] },
  ],
  productionResults: [productionResult],
  now: new Date('2026-09-23T08:00:00.000Z'),
});
assert.ok(memory);
assert.deepEqual(memory.revealOrder, ['hook', 'proof', 'call_to_action']);
assert.deepEqual(memory.evidencePositions, [2]);
assert.deepEqual(memory.ctaPositions, [3]);
assert.equal(memory.createdBy, 'system_learning');
assert.equal(memory.status, 'candidate');
console.log('social creative pattern memory tests passed');
