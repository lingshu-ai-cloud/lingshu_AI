import assert from 'node:assert/strict';
import { buildSocialReferenceReviewHandoff } from './socialReferenceReviewHandoff.js';
import { reviewShotMaterialRefs } from '../lib/referenceShotReview.js';

const record = {
  id: 'trend_videos_1954d63792ac44259b32556090d71457',
  aiAnalysis: JSON.stringify({
    analysisRunId: 'run-2', analysisMode: 'exact', analysisQuality: 'video_review_required', geminiStatus: 'needs_review',
    gemini: {
      detectedSceneCuts: [1.5],
      audioTranscript: { segments: [{ start: 0, end: 3, text: '原片口播', timingPrecision: 'coarse' }] },
      scriptDetails15s: [
        { time: '0-0.1s', visual: '封面闪帧', needsReview: true, materialEvidence: { extractionStatus: 'unavailable' } },
        { time: '0.1-3.47s', visual: '人物在工厂中靠近镜头并抬手', purpose: '开场吸引', observedFacts: '可见人物抬手', inferredIntent: '吸引注意', needsReview: true,
          beats: [{ action: '模型自述动作' }], startState: '站立', endState: '靠近',
          materialEvidence: { extractionStatus: 'ready', clipRef: '/api/overseas/videos/x/shot/2/clip', firstFrameRef: '/api/overseas/videos/x/shot/2/first-frame' } },
      ],
    },
  }),
};

const handoff = buildSocialReferenceReviewHandoff({ record });
assert.equal(handoff.status, 'review_only');
assert.equal(handoff.productionExecutionAllowed, false);
assert.equal(handoff.selectedHookShotId, 'shot-2', 'flash frame cannot become the primary hook');
assert.equal(handoff.analysisRunId, 'run-2');
assert.equal(handoff.hookActionInterval.startSeconds, .1);
assert.equal(handoff.hookActionInterval.endSeconds, 3.47);
const noHook = buildSocialReferenceReviewHandoff({ record: { id: 'missing', aiAnalysis: { gemini: { scriptDetails15s: [] } } } });
assert.equal(noHook.hookActionInterval.startSeconds, null);
assert.equal(noHook.hookActionInterval.endSeconds, null);
assert.equal(noHook.productionExecutionAllowed, false);
assert.equal(handoff.shots[0]?.originalSpeech, '原片口播', 'coarse ASR supplies approximate dialogue');
assert.equal(handoff.shots[0]?.originalSpeechTimingPrecision, 'coarse');
assert.equal(handoff.shots[0]?.originalSpeechIsVerified, false);
assert.equal(handoff.shots[0]?.evidence.firstFrameRef, '/api/overseas/videos/x/shot/2/first-frame');
for (const issue of ['hook_action_unverified', 'presenter_asset_unlocked', 'mixed_scene_possible']) {
  assert.ok(handoff.issues.some(item => item.code === issue), `${issue} should be actionable`);
}
assert.ok(handoff.issues.every(item => item.action && item.evidenceRefs));
assert.equal(handoff.sourceClaimsAreEnterpriseFacts, false);
assert.equal(buildSocialReferenceReviewHandoff({ record }).versionHash, handoff.versionHash);
const replacedSource = { ...record, aiAnalysis: JSON.stringify({ ...JSON.parse(record.aiAnalysis), contentSha256: 'replacement-video-sha' }) };
assert.notEqual(buildSocialReferenceReviewHandoff({ record: replacedSource }).versionHash, handoff.versionHash,
  'replacing the source video must invalidate the Director handoff version');
const locked = buildSocialReferenceReviewHandoff({ record, presenter: { assetId: 'sales-asset', assetVersion: 'v3', rightsVerified: true, rightsEvidenceRef: 'rights:sales-asset:v3' }, verifiedEnterpriseFactRefs: ['fact:1'] });
assert.deepEqual(locked.presenterLock, { assetId: 'sales-asset', assetVersion: 'v3' });
assert.deepEqual(locked.verifiedEnterpriseFactRefs, ['fact:1']);
assert.equal(locked.status, 'review_only', 'locking presenter and facts cannot override failed reference evidence');
assert.notEqual(locked.versionHash, handoff.versionHash);

const declaredOnly = buildSocialReferenceReviewHandoff({ record,
  presenter: { assetId: '<企业销售人物资产ID>', assetVersion: '<已授权版本>', rightsVerified: true },
  verifiedEnterpriseFactRefs: ['<事实引用>'],
});
assert.equal(declaredOnly.presenterLock, null, 'a claimed true without an authorization reference is insufficient');
assert.deepEqual(declaredOnly.verifiedEnterpriseFactRefs, []);
assert.ok(declaredOnly.issues.some(issue => issue.code === 'presenter_asset_unlocked'));

const invalidVerifiedSpeech = { ...record, aiAnalysis: JSON.stringify({
  ...JSON.parse(record.aiAnalysis), contentSha256: 'source-sha',
}), referenceVerifiedSpeech: JSON.stringify({
  schemaVersion: 1, analysisRunId: 'run-2', sourceSha256: 'source-sha', coverageConfirmed: true,
  reviewerId: 'reviewer', verifiedAt: '2026-09-28T00:00:00Z',
  lines: [{ start: 0, end: 3, text: '<逐句原文>', timingPrecision: 'phrase' }],
}) };
const invalidSpeechHandoff = buildSocialReferenceReviewHandoff({ record: invalidVerifiedSpeech });
assert.ok(invalidSpeechHandoff.issues.some(issue => issue.code === 'speech_line_invalid'));
assert.equal(invalidSpeechHandoff.shots[0]?.originalSpeechTimingPrecision, 'coarse');
assert.equal(invalidSpeechHandoff.productionExecutionAllowed, false);

const alignedRecord = { ...record, aiAnalysis: JSON.stringify({
  ...JSON.parse(record.aiAnalysis), contentSha256: 'source-sha',
  gemini: { ...JSON.parse(record.aiAnalysis).gemini, scriptDetails15s: [
    { time: '0-1s', visual: '人物动作', purpose: '截流', materialEvidence: { extractionStatus: 'ready', clipRef: 'clip:1', firstFrameRef: 'frame:1' } },
    { time: '1-2s', visual: '人物口播', purpose: '提出问题', materialEvidence: { extractionStatus: 'ready', clipRef: 'clip:2', firstFrameRef: 'frame:2' } },
  ] },
}), referenceVerifiedSpeech: JSON.stringify({
  schemaVersion: 1, analysisRunId: 'run-2', sourceSha256: 'source-sha', coverageConfirmed: true,
  reviewerId: 'reviewer', verifiedAt: '2026-09-28T00:00:00Z',
  lines: [{ start: 0.5, end: 1.5, text: '一个句子跨两个镜头', visibility: 'on_camera' }],
}) };
const aligned = buildSocialReferenceReviewHandoff({ record: alignedRecord });
assert.deepEqual(aligned.shots.map(shot => shot.cueIds), [['speech-001'], ['speech-001']]);
assert.ok(!aligned.issues.some(issue => issue.code === 'speech_timing_coarse' || issue.code === 'speech_line_invalid' || issue.code === 'speech_unassigned'));
assert.equal(aligned.shots[0]?.originalSpeechIsVerified, true);

const coarseLabeledAsVerified = { ...alignedRecord, referenceVerifiedSpeech: JSON.stringify({
  ...JSON.parse(alignedRecord.referenceVerifiedSpeech),
  lines: [{ start: 0.5, end: 1.5, text: '粗时间窗', visibility: 'on_camera', timingPrecision: 'coarse' }],
}) };
const rejectedCoarse = buildSocialReferenceReviewHandoff({ record: coarseLabeledAsVerified });
assert.equal(rejectedCoarse.shots[0]?.originalSpeech, '原片口播');
assert.ok(rejectedCoarse.issues.some(issue => issue.code === 'speech_line_invalid'));

const reviewedHookRecord = { ...alignedRecord } as typeof alignedRecord & { referenceShotReview: string };
const firstShot = { shotId: 'shot-1', start: 0, end: 1 };
const secondShot = { shotId: 'shot-2', start: 1, end: 2 };
const hookScript = { camera: '固定机位，人物快速前移', visual: '人物从工厂背景迅速靠近镜头',
  subject: '企业销售人物', music: '无', voiceover: '无', soundEffects: '敲击声', spokenWords: '无',
  subjectAction: '0.00 秒起步，0.55 秒靠近，0.80 秒敲门手势触点' };
reviewedHookRecord.referenceShotReview = JSON.stringify({
  referenceRecordId: reviewedHookRecord.id, sourceAnalysisRunId: 'run-2', version: 'review-v1', reviewComplete: true,
  selectedHookShotId: 'shot-1', sections: Array.from({ length: 6 }, (_, i) => ({ id: i })),
  shots: [
    { ...firstShot, sourceShotIds: ['shot-1'], reviewStatus: 'confirmed', content: '人物靠近并敲门',
      purpose: '快速截流', evidenceRefs: reviewShotMaterialRefs(reviewedHookRecord, firstShot),
      hookAction: '0.00 秒人物从远处起步；0.55 秒快速接近镜头；0.80 秒完成敲门手势触点。',
      hookMotionConfirmed: true, hookScript, hookScriptConfirmed: true },
    { ...secondShot, sourceShotIds: ['shot-2'], reviewStatus: 'confirmed', content: '人物站立口播',
      purpose: '提出问题', evidenceRefs: reviewShotMaterialRefs(reviewedHookRecord, secondShot) },
  ],
});
const humanReviewed = buildSocialReferenceReviewHandoff({ record: reviewedHookRecord });
assert.ok(!humanReviewed.issues.some(issue => issue.code === 'hook_action_unverified'),
  'current human motion review with extracted shot evidence must not require model verified status');
assert.equal(humanReviewed.hookScript.confirmed, true);
const revokedMotionRecord = { ...reviewedHookRecord, referenceShotReview: JSON.stringify({
  ...JSON.parse(reviewedHookRecord.referenceShotReview),
  shots: JSON.parse(reviewedHookRecord.referenceShotReview).shots.map((shot: Record<string, unknown>, i: number) =>
    i === 0 ? { ...shot, hookMotionConfirmed: false } : shot),
}) };
assert.ok(buildSocialReferenceReviewHandoff({ record: revokedMotionRecord }).issues.some(issue => issue.code === 'hook_action_unverified'));

console.log('social reference review handoff quality gate passed');
