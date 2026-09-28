import assert from 'node:assert/strict';
import { asrCandidatesToReviewDraft, reviseDirectorHookAction, splitDirectorReviewedShot } from './InspirationDashboard.js';

const review = {
  referenceRecordId: 'reference-1', sourceAnalysisRunId: 'analysis-1', version: 'v1',
  sections: [], selectedHookShotId: 'shot-1', reviewComplete: false, productionExecutionAllowed: false as const,
  shots: [{ shotId: 'shot-1', start: 0.1, end: 3.1, content: '人物提问', purpose: '抓注意力',
    sourceShotIds: ['shot-1'], reviewStatus: 'confirmed' as const, mixedScene: false,
    labels: ['真人口播'], evidenceRefs: ['/old/clip', '/old/first-frame'],
    hookAction: '先近距离伸手靠近镜头，再退后发问，并切换到工厂画面', hookMotionConfirmed: true }],
};

const revised = reviseDirectorHookAction(review, 'shot-1', '改为另一种手势');
assert.equal(revised.shots[0]?.hookMotionConfirmed, false, 'changing the action must revoke hook motion verification');
assert.equal(review.shots[0]?.hookMotionConfirmed, true, 'source review must remain immutable');

const split = splitDirectorReviewedShot(review, 'shot-1', 1.5);
assert.equal(split.shots.length, 2);
assert.deepEqual(split.shots.map(shot => [shot.start, shot.end]), [[0.1, 1.5], [1.5, 3.1]]);
assert.deepEqual(split.shots.map(shot => shot.sourceShotIds), [['shot-1'], ['shot-1']], 'both halves retain source provenance');
assert.ok(split.shots.every(shot => !shot.hookMotionConfirmed && shot.evidenceRefs.length === 0), 'cut edits invalidate old motion and media');
assert.equal(split.selectedHookShotId, null, 'hook must be selected again after splitting');
assert.throws(() => splitDirectorReviewedShot(review, 'shot-1', 0.2), /invalid_review_cut/);

const speechDraft = asrCandidatesToReviewDraft({ analysisRunId: 'analysis-1', sourceSha256: 'hash', duration: 10,
  status: 'verified', coverageConfirmed: true, lines: [] }, [{ text: '第一句', start: 0.2, end: 1.1,
  precision: 'phrase', provenance: 'qwen_asr:task-1', visibility: 'unknown' }]);
assert.equal(speechDraft.coverageConfirmed, false, 'machine candidates must revoke full coverage confirmation');
assert.equal(speechDraft.lines[0]?.visibility, 'unknown', 'machine candidates must await on-camera/voiceover review');
assert.equal(speechDraft.status, 'partial_review');
console.log('InspirationDashboard reviewed-shot editing tests passed');
