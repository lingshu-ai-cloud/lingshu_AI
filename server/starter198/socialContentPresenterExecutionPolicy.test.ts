import assert from 'node:assert/strict';
import { replicationExecutionGaps, selectPresenterExecutions, verifyNamedPresenterLock } from './socialContentPresenterExecutionPolicy.js';
import type { PresenterShotMeasurements } from '../../shared/contracts/presenterStackPolicy.js';
import { parseCreateSocialTask } from './socialContentValidation.js';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseSocialTaskBrief } from './socialContentRecords.js';

const measurement: PresenterShotMeasurements = {
  shotId: 'ref-1', durationSeconds: 3, sourceFirstFrameRef: 'model-value-must-not-win',
  enterprisePresenterAssetRef: 'model-value-must-not-win', visibleSpeechSeconds: 2,
  lipSyncRequired: true, specificGestureCount: 0, bodyCenterTravelFrameWidth: 0.02,
  cameraTravelFrameDiagonal: 0.01, compositionLockRequired: false,
  physicalProductContact: false, decisionConfidence: 0.95,
  evidence: [{ startSeconds: 0, endSeconds: 0.5, frameRef: 'frame-1', observation: 'visible speech and stable camera' }],
};

function detail(value: Partial<PresenterShotMeasurements> | null, strategy = 'authorized_digital_presenter') {
  return {
    referenceVideoAnalysis: { shots: [{ shotId: 'ref-1', presenterMeasurements: value ? { ...measurement, ...value } : undefined }] },
    agentWorkflow: {
      directorBrief: { scenes: [{
        sceneId: 'scene-1', referenceShotId: 'ref-1', duration: { targetSeconds: 3 },
        productionRouting: { presenterVisible: true, enterprisePresenterAssetRef: 'authorized-person-1',
          needsPreciseLipSync: true, needsCameraOrCompositionReconstruction: false },
        referenceMaterial: { extractionStatus: 'ready', firstFrameRef: 'server-frame-1' },
      }] },
      executionPlan: { scenes: [{ sceneId: 'scene-1', selectedSourceStrategy: strategy }] },
    },
  } as any;
}

const route = (value: Partial<PresenterShotMeasurements> | null, strategy?: string) => selectPresenterExecutions({
  detail: detail(value, strategy), heygenReady: true, seedancePresenterReady: false, budgetReady: true,
})[0]!;

assert.equal(route(null).decision.route, 'needs_evidence');
assert.equal(route(null).executionStatus, 'blocked');
assert.equal(route({ bodyCenterTravelFrameWidth: null }).executionStatus, 'blocked');
assert.equal(route({}).decision.route, 'heygen_talking');
assert.equal(route({}).providerId, 'heygen');
assert.equal(route({}).decision.measurements.enterprisePresenterAssetRef, 'authorized-person-1');
assert.equal(route({}).decision.measurements.sourceFirstFrameRef, 'server-frame-1');
assert.equal(route({}, 'aigc_product_scene_replication').executionStatus, 'blocked');
assert.ok(route({}, 'aigc_product_scene_replication').reasonCodes.includes('execution_strategy_does_not_match_heygen'));
const motion = route({ specificGestureCount: 1, visibleSpeechSeconds: 0, lipSyncRequired: false });
assert.equal(motion.decision.route, 'blocked');
assert.ok(motion.reasonCodes.includes('seedance_capability_unavailable'));
const split = route({ specificGestureCount: 1 });
assert.equal(split.decision.route, 'split_motion_and_speech');
assert.equal(split.executionStatus, 'blocked');
const contact = route({ physicalProductContact: true, specificGestureCount: 1 });
assert.equal(contact.decision.route, 'blocked');
assert.equal(contact.providerId, null);
assert.ok(contact.reasonCodes.includes('physical_product_contact_requires_separate_verified_capability'));
assert.deepEqual(await verifyNamedPresenterLock({ store: null, tenantId: 'tenant', name: '销售', lock: null }),
  { ok: false, reason: 'published_account_presenter_lock_missing' });
const lock: any = { status: 'published', commercialRightsStatus: 'cleared', presenterAssetId: 'one',
  socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: 'v3',
  consistencyKey: 'account-1:profile-1:v3', consentRef: 'consent://person', avatarId: 'avatar-1',
  voiceProfileId: 'voice-1' };
const fakeStore: any = { list: async () => ({ totalItems: 1, items: [{ payload: { presenters: [
  { id: 'one', name: '销售' }, { id: 'two', name: '销售' },
] } }] }) };
assert.deepEqual(await verifyNamedPresenterLock({ store: fakeStore, tenantId: 'tenant', name: '销售', lock }),
  { ok: false, reason: 'requested_presenter_ambiguous' });
const exactStore: any = { list: async () => ({ totalItems: 1, items: [{ payload: { presenters: [{
  id: 'one', name: '客户顾问', authorized: true, assetVersion: 3,
  presenterProfileStatus: 'published', commercialRightsStatus: 'cleared',
  socialAccountId: lock.socialAccountId, presenterProfileId: lock.presenterProfileId,
  presenterProfileVersion: lock.presenterProfileVersion, consistencyKey: lock.consistencyKey,
  consentRef: lock.consentRef, avatarId: lock.avatarId, voiceId: lock.voiceProfileId,
  rightsEvidence: { authorizationRef: 'rights://person', consentRef: lock.consentRef,
    grantedAt: '2026-01-01T00:00:00.000Z', subjectAdultConfirmed: true,
    permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'] },
}] } }] }) };
assert.deepEqual(await verifyNamedPresenterLock({ store: exactStore, tenantId: 'tenant', lock }),
  { ok: true, presenterAssetId: 'one', assetVersion: 3 });
assert.deepEqual(await verifyNamedPresenterLock({ store: exactStore, tenantId: 'tenant', name: '销售', lock }),
  { ok: false, reason: 'requested_presenter_missing_or_lock_mismatch' });
const explicitBrief = parseSocialTaskBrief(defaultBrief(parseCreateSocialTask({
  title: '本次样片', objective: '爆款复刻', creationMode: 'viral_replication',
  requestedPresenterName: '销售', requestedPresenterAssetId: 'one',
})));
assert.equal(explicitBrief.requestedPresenterName, '销售');
assert.equal(explicitBrief.requestedPresenterAssetId, 'one');
const ordinaryBrief = parseSocialTaskBrief(defaultBrief(parseCreateSocialTask({
  title: '其他租户任务', objective: '爆款复刻', creationMode: 'viral_replication',
})));
assert.equal(ordinaryBrief.requestedPresenterName, null);
assert.equal(ordinaryBrief.requestedPresenterAssetId, null);
const handoff: any = detail({});
handoff.referenceVideoAnalysis.status = 'ready';
handoff.referenceVideoAnalysis.coverage = { fullTimelineCovered: true, gaps: [] };
handoff.referenceVideoAnalysis.shots[0].spokenText = null;
handoff.agentWorkflow.directorBrief.scenes[0].audioLayers = { dialogue: '示范口播', voiceover: null };
handoff.agentWorkflow.directorBrief.scenes[0].referenceMaterial.isPrimaryHook = true;
handoff.agentWorkflow.directorBrief.scenes[0].referenceMaterial.clipRef = 'server-clip-1';
handoff.agentWorkflow.directorBrief.scenes[0].referenceMaterial.hookDetail = null;
handoff.agentWorkflow.directorBrief.scenes[0].action = { startState: '面对镜头', path: '', endState: '张开双臂' };
const gaps = replicationExecutionGaps(handoff);
assert.ok(gaps.some(gap => gap.reasonCodes.includes('source_phrase_timing_unverified')));
assert.ok(gaps.some(gap => gap.reasonCodes.includes('primary_hook_script_unverified')));
assert.ok(gaps.some(gap => gap.reasonCodes.includes('enterprise_presenter_version_unlocked')));
assert.ok(gaps.every(gap => gap.nextActions.length > 0));
handoff.referenceVideoAnalysis.shots[0].spokenText = '示范口播';
handoff.referenceVideoAnalysis.shots[0].startSeconds = 0;
handoff.referenceVideoAnalysis.shots[0].endSeconds = 3;
handoff.referenceVideoAnalysis.analysisLayers = [{ level: 'L3', status: 'complete' }];
handoff.agentWorkflow.directorBrief.accountPresenterLock = { presenterAssetId: 'authorized-person-1' };
handoff.agentWorkflow.directorBrief.scenes[0].referenceMaterial.hookDetail = { actionStartAndPeak: '靠近镜头' };
handoff.agentWorkflow.directorBrief.scenes[0].action.path = '手靠近镜头';
handoff.agentWorkflow.directorBrief.scenes[0].voiceoverAlignment = { text: '示范口播', startSeconds: 0.1, endSeconds: 2.9 };
assert.ok(replicationExecutionGaps(handoff).some(gap => gap.reasonCodes.includes('source_phrase_timing_unverified')),
  'model L3 and generated cue cannot release the source phrase gate');
handoff.referenceVideoAnalysis.shots[0].spokenTextTiming = {
  precision: 'phrase', provenance: 'asr_alignment:clip-1:sentence-1', startSeconds: 0.1, endSeconds: 2.9,
};
assert.ok(replicationExecutionGaps(handoff).some(gap => gap.reasonCodes.includes('source_phrase_timing_unverified')),
  'a phrase-labeled aggregate timing span does not certify each sentence');
handoff.referenceVideoAnalysis.shots[0].spokenLines = [{
  text: '示范口播', precision: 'phrase', provenance: 'asr_alignment:clip-1:sentence-1',
  startSeconds: 0.1, endSeconds: 2.9,
}];
assert.deepEqual(replicationExecutionGaps(handoff), []);
handoff.referenceVideoAnalysis.shots[0].spokenLines[0].text = '遗漏半句';
assert.ok(replicationExecutionGaps(handoff).some(gap => gap.reasonCodes.includes('source_phrase_timing_unverified')));
handoff.referenceVideoAnalysis.shots[0].spokenLines[0].text = '示范口播';
handoff.referenceVideoAnalysis.shots[0].spokenLines[0].provenance = '';
assert.ok(replicationExecutionGaps(handoff).some(gap => gap.reasonCodes.includes('source_phrase_timing_unverified')));
handoff.referenceVideoAnalysis.shots[0].spokenLines[0].provenance = 'asr_alignment:clip-1:sentence-1';
handoff.referenceVideoAnalysis.shots[0].spokenText = '示范口播第二句';
assert.ok(replicationExecutionGaps(handoff).some(gap => gap.reasonCodes.includes('source_phrase_timing_unverified')),
  'two original sentences cannot pass with only the first sentence aligned');
handoff.referenceVideoAnalysis.shots[0].spokenLines[0].endSeconds = 1.4;
handoff.referenceVideoAnalysis.shots[0].spokenLines.push({ text: '第二句', precision: 'phrase',
  provenance: 'asr_alignment:clip-1:sentence-2', startSeconds: 1.4, endSeconds: 2.9 });
assert.deepEqual(replicationExecutionGaps(handoff), []);
handoff.agentWorkflow.directorBrief.scenes[0].audioLayers.dialogue = null;
assert.ok(replicationExecutionGaps(handoff).some(gap => gap.reasonCodes.includes('source_speech_missing_from_handoff')));
console.log('social content presenter execution policy tests passed');
