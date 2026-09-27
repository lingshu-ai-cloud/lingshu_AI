import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMaterialSceneReview,
  evaluateMaterialGoldSet,
  materialDecisionFeedback,
  materialReviewBundle,
} from './materialQualityLearning.js';

test('ambiguous or unsafe material matches are kept for focused human review', () => {
  const review = buildMaterialSceneReview({
    sceneId: 'scene-1', intent: '打开盒盖展示内部结构', selectedClipId: 'clip-a', candidates: [
      { type: 'video', assetId: 'a', clipId: 'clip-a', sourceStart: 1, sourceEnd: 3, score: 22,
        analysisConfidence: .82, boundaryConfidence: .7, cleanEntry: true, cleanExit: true, needsReview: false, evidenceBasis: 'visual_analysis' },
      { type: 'video', assetId: 'b', clipId: 'clip-b', sourceStart: 0, sourceEnd: 2, score: 20,
        analysisConfidence: .9, boundaryConfidence: .9, cleanEntry: true, cleanExit: true, needsReview: false, evidenceBasis: 'visual_analysis' },
    ],
  });
  assert.equal(review.decision, 'human_review_required');
  assert.ok(review.reasonCodes.includes('small_score_margin'));
  assert.equal(materialReviewBundle([review]).requiresFocusedReview, true);
});

test('ordinary approval creates only a weak label, not a training gold label', () => {
  const review = materialReviewBundle([]);
  const feedback = materialDecisionFeedback({
    artifactContent: { materialLearning: review }, decision: 'approved', decidedAt: '2026-09-27T00:00:00.000Z',
  });
  assert.equal(feedback?.strength, 'weak_label');
  assert.equal(feedback?.label, 'accepted_weak');
});

test('gold set evaluator reports ranking and severe mismatch metrics without training', () => {
  const result = evaluateMaterialGoldSet([{ queryId: 'q1', candidates: [
    { candidateId: 'wrong', predictedScore: 2, relevance: 0 },
    { candidateId: 'right', predictedScore: 1, relevance: 2 },
  ] }]);
  assert.equal(result.recallAt5, 1);
  assert.equal(result.top1AcceptRate, 0);
  assert.equal(result.severeMismatchRate, 1);
});
