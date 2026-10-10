import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildStoryboardQaReport, inspectStoryboardTechnicalFrames, reviewStoryboardQaReport, storyboardQaObservationContractIssues, storyboardQaRequiredChecks } from './storyboardAigcQuality.js';

const base = {
  phase: 'video' as const, sceneType: 'usage' as const, hasProduct: true,
  hasNamedPerson: false, hasContact: true, hasAction: true,
  evidenceFrameLabels: ['产品参考', '视频0s', '视频2s', '视频4s'], checkedAt: '2026-10-03T00:00:00.000Z',
};
const keys = storyboardQaRequiredChecks(base);
assert.deepEqual(keys, ['product_identity', 'layout_continuity', 'visual_integrity', 'contact_continuity', 'action_order', 'end_state']);

const evidenceFor = (key: string) => key === 'end_state' ? ['视频4s'] : ['视频0s', '视频2s'];
const allPass = buildStoryboardQaReport({ ...base, observations: keys.map(key => ({ key, verdict: 'pass', evidenceFrames: evidenceFor(key), note: '画面可见' })) });
assert.equal(allPass.status, 'needs_review');
assert.equal(allPass.automatedPassed, true);
assert.equal(allPass.passed, false);
assert.equal(reviewStoryboardQaReport(allPass, { decision: 'accept', reviewedBy: 'tenant-user' }).passed, true);

const identityFail = buildStoryboardQaReport({ ...base, observations: keys.map(key => ({ key, verdict: key === 'product_identity' ? 'fail' : 'pass', action: 'needs_assets', evidenceFrames: evidenceFor(key), note: '包装不一致' })) });
assert.equal(identityFail.status, 'needs_assets');
assert.deepEqual(identityFail.reasonCodes, ['PRODUCT_IDENTITY_FAILED']);
assert.throws(() => reviewStoryboardQaReport(identityFail, { decision: 'accept', reviewedBy: 'tenant-user' }), /硬失败/);

const missingEnd = buildStoryboardQaReport({ ...base, observations: keys.filter(key => key !== 'end_state').map(key => ({ key, verdict: 'pass', evidenceFrames: evidenceFor(key) })) });
assert.equal(missingEnd.status, 'needs_review');
assert.equal(missingEnd.automatedPassed, false);
assert.deepEqual(missingEnd.reasonCodes, ['END_STATE_UNCERTAIN']);

const singleFrameClaims = buildStoryboardQaReport({ ...base, observations: keys.map(key => ({ key, verdict: 'pass', evidenceFrames: ['视频2s'] })) });
assert.equal(singleFrameClaims.checks.action_order.verdict, 'uncertain', 'one frame cannot prove action order');
assert.equal(singleFrameClaims.checks.product_identity.verdict, 'uncertain', 'one frame cannot prove cross-frame identity');
assert.equal(singleFrameClaims.checks.end_state.verdict, 'uncertain', 'middle frame cannot prove the visible final state');

const seamBase = { ...base, hasSeam: true, evidenceFrameLabels: ['上一段合格末帧', '视频0s', '视频2s', '视频4s'] };
const seamKeys = storyboardQaRequiredChecks(seamBase);
assert(seamKeys.includes('seam_continuity'));
const unprovenSeam = buildStoryboardQaReport({ ...seamBase, observations: seamKeys.map(key => ({ key,
  verdict: 'pass', evidenceFrames: key === 'seam_continuity' ? ['视频0s', '视频2s'] : evidenceFor(key) })) });
assert.equal(unprovenSeam.checks.seam_continuity.verdict, 'uncertain', 'two candidate frames cannot prove the segment seam');
assert.equal(unprovenSeam.automatedPassed, false);
const provenSeam = buildStoryboardQaReport({ ...seamBase, observations: seamKeys.map(key => ({ key,
  verdict: 'pass', evidenceFrames: key === 'seam_continuity' ? ['上一段合格末帧', '视频0s'] : evidenceFor(key) })) });
assert.equal(provenSeam.checks.seam_continuity.verdict, 'pass');
assert.equal(provenSeam.automatedPassed, true);

const badContact = buildStoryboardQaReport({ ...base, observations: keys.map(key => ({ key, verdict: key === 'contact_continuity' ? 'fail' : 'pass', evidenceFrames: evidenceFor(key), note: '手指穿模' })) });
assert.equal(badContact.status, 'retry_video');
assert.equal(badContact.findings[0].action, 'retry_video');

const firstFrame = buildStoryboardQaReport({
  ...base, phase: 'first_frame', observations: [{ key: 'product_identity', verdict: 'pass' }, { key: 'contact', verdict: 'fail', note: '产品悬浮' }],
});
assert.equal(firstFrame.status, 'retry_first_frame');
assert(firstFrame.reasonCodes.includes('CONTACT_FAILED'));
assert(firstFrame.reasonCodes.includes('START_STATE_UNCERTAIN'));

const ordinaryFactory = storyboardQaRequiredChecks({ phase: 'video', sceneType: 'factory', hasProduct: false, hasNamedPerson: false, hasContact: false, hasAction: true });
assert(!ordinaryFactory.includes('product_identity'));
assert(ordinaryFactory.includes('end_state'));
const referencedFactory = storyboardQaRequiredChecks({ phase: 'video', sceneType: 'factory', hasProduct: false,
  hasNamedPerson: false, hasEnvironmentReference: true, hasContact: false, hasAction: false });
assert(referencedFactory.includes('environment_fidelity'));
const environmentMismatch = buildStoryboardQaReport({ ...base, sceneType: 'factory', hasProduct: false,
  hasEnvironmentReference: true, hasContact: false, hasAction: false,
  observations: [{ key: 'environment_fidelity', verdict: 'fail', evidenceFrames: ['视频0s', '视频2s'],
    note: '设备布局与企业参考图不符', action: 'retry_video' }] });
assert(environmentMismatch.reasonCodes.includes('ENVIRONMENT_FIDELITY_FAILED'));
assert.equal(environmentMismatch.status, 'retry_video');

const black = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000000' } }).jpeg().toBuffer();
const normal = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aaaaaa' } }).jpeg().toBuffer();
const tiny = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
assert.deepEqual(await inspectStoryboardTechnicalFrames('video', [{ bytes: normal, timeLabel: '视频0s' }]), []);
const technical = await inspectStoryboardTechnicalFrames('first_frame', [
  { bytes: black, timeLabel: '首帧' }, { bytes: tiny, timeLabel: '无效小图' },
]);
assert.equal(technical[0].verdict, 'fail');
assert.equal(technical[0].action, 'retry_first_frame');
assert.deepEqual(technical[0].evidenceFrames, ['首帧', '无效小图']);

const firstFrameContract = {
  requiredKeys: ['product_identity', 'layout', 'visual_integrity'],
  allowedCitationLabels: ['企业产品参考1：冰沙面霜', '候选首帧'],
  candidateLabels: ['候选首帧'],
};
assert.deepEqual(storyboardQaObservationContractIssues({ ...firstFrameContract, observations: [
  { key: 'product_identity', verdict: 'pass', evidenceFrames: ['企业产品参考1：冰沙面霜', '候选首帧'] },
  { key: 'layout', verdict: 'pass', evidenceFrames: ['候选首帧'] },
  { key: 'visual_integrity', verdict: 'pass', evidenceFrames: ['候选首帧'] },
] }), []);
assert(storyboardQaObservationContractIssues({ ...firstFrameContract, observations: [
  { key: 'product_identity', verdict: 'pass', evidenceFrames: ['候选0s'] },
  { key: 'layout', verdict: 'pass', evidenceFrames: ['候选首帧'] },
] }).includes('product_identity:unknown_evidence_label'), 'unknown model citations are a service-contract error');
assert(storyboardQaObservationContractIssues({ ...firstFrameContract, observations: [
  { key: 'product_identity', verdict: 'pass', evidenceFrames: ['企业产品参考1：冰沙面霜'] },
  { key: 'layout', verdict: 'pass', evidenceFrames: ['候选首帧'] },
  { key: 'visual_integrity', verdict: 'uncertain', evidenceFrames: [] },
] }).includes('product_identity:candidate_evidence_required'), 'references alone cannot prove the candidate passed');
assert(storyboardQaObservationContractIssues({ ...firstFrameContract, observations: [], technicalKeys: ['visual_integrity'] })
  .includes('product_identity:missing_or_invalid_verdict'), 'technical QA must not hide a missing visual-model contract');
