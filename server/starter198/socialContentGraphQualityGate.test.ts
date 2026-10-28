import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSocialContentGraphQuality, socialContentGraphQualityFailures } from './socialContentGraphQualityGate.js';
import {socialVideoQualityAcceptanceRecord} from './socialVideoQualityAcceptance.js';

const sha = 'a'.repeat(64);
function acceptedContent() {
  return {
    workflowSchema: 'social-content.auto-production.v3',
    productionWorkspaceSource: { type: 'actual_social_render', creationMode: 'viral_replication', runId: 'run-a', outputSha256: sha },
    mediaStorage: { video: { fileId: 'file-a', sha256: sha } },
    productionResult: {
      technicalReview: { approved: true, failures: [] },
      creativeReview: { approved: true, failedCriteria: [] },
    },
    technicalQualityReport: {
      schemaVersion: 'initial-scene-quality.v1',
      visual: { passed: true, failures: [] },
      scenes: { passed: true, issues: [], checkedScenes: 2 },
      audio: { ok: true, error: null },
    },
    render: { completed: true, qualityPassed: true, audioDecoded: true },
    review: { automatedChecksPassed: true, technicalChecksPassed: true, creativeChecksPassed: true, state: 'requires_user_approval' },
    delivery: { status: 'publish_candidate' },
    replicationEvaluation: {
      status: 'passed', directorDecision: { failedCriteria: [] },
      viralFactorFidelity: { status: 'passed' }, identityReplacement: { status: 'passed' },
      unauthorizedReuseRisk: { status: 'passed' }, originalityDifference: { status: 'passed' },
      accountAndFactFit: { status: 'passed' },
      referenceTimelineAudit: { fullCoverageValidated: true, referenceShotCount: 2, outputShotCount: 2 },
    },
  };
}

test('only internally accepted real media can cross graph quality into human review', () => {
  assert.deepEqual(socialContentGraphQualityFailures(acceptedContent()), []);
  assert.doesNotThrow(() => assertSocialContentGraphQuality(acceptedContent()));
});

test('voice-driven review requires byte-bound actual checks and does not require legacy replication scores', () => {
  const content = acceptedContent();
  Object.assign(content.technicalQualityReport, { policyVersion: 'voice-driven-slots.v1' });
  (content as { replicationEvaluation: unknown }).replicationEvaluation = null;
  assert.ok(socialContentGraphQualityFailures(content).includes('voice_driven_quality_unverified'));
  Object.assign(content.technicalQualityReport, { voiceDrivenReview: {
    schemaVersion: 'voice-driven-video-quality.v1', mediaSha256: sha,
    timeline: { status: 'passed', toleranceSeconds: 0.3, maxLocalOffsetSeconds: 0.1, cumulativeOffsetSeconds: 0.1, evidenceRef: 'measured:actual-film' },
    subtitleStyle: { status: 'passed', mediaSha256: sha, samples: [0, 1].map(atSeconds => ({atSeconds,frameSha256:sha,subtitlePresent:true,font:true,fontSize:true,color:true})) },
  } });
  assert.deepEqual(socialContentGraphQualityFailures(content), []);
  Object.assign(content.technicalQualityReport, { voiceDrivenReview: {
    schemaVersion: 'voice-driven-video-quality.v1', mediaSha256: 'b'.repeat(64),
    timeline: { status: 'passed', evidenceRef: 'measured:another-film' },
    subtitleStyle: { status: 'passed', mediaSha256: sha, samples: [0, 1].map(atSeconds => ({atSeconds,frameSha256:sha,subtitlePresent:true,font:true,fontSize:true,color:true})) },
  } });
  assert.ok(socialContentGraphQualityFailures(content).includes('voice_driven_quality_unverified'));
});

test('explicit user receipt admits unknown measurement only for its frozen media hash',()=>{
 const content=acceptedContent();Object.assign(content.technicalQualityReport,{policyVersion:'voice-driven-slots.v1'});(content as {replicationEvaluation:unknown}).replicationEvaluation=null;
 const receipt=socialVideoQualityAcceptanceRecord({tenantId:'tenant',taskId:'task',runId:'run-a',jobId:'job',mediaSha256:sha,qualityInputHash:'b'.repeat(64),acceptedBy:'owner',acceptedAt:'2026-10-28T00:00:00.000Z'});
 Object.assign(content.technicalQualityReport,{voiceDrivenReview:{schemaVersion:'voice-driven-video-quality.v1',mediaSha256:sha,timeline:{status:'passed',toleranceSeconds:0.3,maxLocalOffsetSeconds:0.1,cumulativeOffsetSeconds:0.1,evidenceRef:'measured:film'},subtitleStyle:{status:'unknown',mediaSha256:sha,samples:[]},userAcceptance:receipt}});
 assert.deepEqual(socialContentGraphQualityFailures(content),[]);
 receipt.acceptedBy='other';assert.ok(socialContentGraphQualityFailures(content).includes('voice_driven_quality_unverified'));
});

test('failed or missing technical, creative, reference and media evidence cannot reach waiting_review', () => {
  const mutations: Array<(value: ReturnType<typeof acceptedContent>) => void> = [
    value => { value.productionResult.technicalReview.approved = false; },
    value => { value.technicalQualityReport.scenes.passed = false; },
    value => { value.technicalQualityReport.audio.ok = false; },
    value => { value.productionResult.creativeReview.approved = false; },
    value => { value.replicationEvaluation.status = 'failed'; },
    value => { (value as { replicationEvaluation: unknown }).replicationEvaluation = null; },
    value => { value.mediaStorage.video.sha256 = 'b'.repeat(64); },
    value => { value.review.automatedChecksPassed = false; },
    value => { value.delivery.status = 'requires_revision'; },
  ];
  for (const mutate of mutations) {
    const content = acceptedContent();
    mutate(content);
    assert.throws(() => assertSocialContentGraphQuality(content), /social_graph_quality_failed/);
  }
});

test('subjective factor review can reach human review, but unknown rights, facts or timeline cannot', () => {
  const subjective = acceptedContent();
  subjective.replicationEvaluation.status = 'review_required';
  subjective.replicationEvaluation.viralFactorFidelity.status = 'review_required';
  assert.doesNotThrow(() => assertSocialContentGraphQuality(subjective));
  for (const mutate of [
    (value: ReturnType<typeof acceptedContent>) => { value.replicationEvaluation.unauthorizedReuseRisk.status = 'review_required'; },
    (value: ReturnType<typeof acceptedContent>) => { value.replicationEvaluation.accountAndFactFit.status = 'review_required'; },
    (value: ReturnType<typeof acceptedContent>) => { value.replicationEvaluation.referenceTimelineAudit.fullCoverageValidated = false; },
  ]) {
    const content = acceptedContent();
    content.replicationEvaluation.status = 'review_required';
    content.replicationEvaluation.viralFactorFidelity.status = 'review_required';
    mutate(content);
    assert.throws(() => assertSocialContentGraphQuality(content), /social_graph_quality_failed/);
  }
});

test('measured final-media defects cannot be overwritten by aggregate approvals', () => {
  for (const probe of [
    { formatPassed: false },
    { captionTimeline: { status: 'invalid' } },
    { captionSpeechAlignment: { status: 'mismatch' } },
    { captionMaskAudit: { status: 'unknown', plainCueBinding: { status: 'mismatch', reason: 'wrong ASS cue' } } },
    { sensitiveFrozenSpeechEvidence: { status: 'hit' } },
    { scenes: [{ durationPassed: false }] },
    { scenes: [{ audioIdentity: { status: 'failed' } }] },
    { fullFrozenAudioIdentity: { status: 'failed', failedWindowIndexes: [1] } },
    { mediaSha256: sha, finalSensitiveFrameAudit: { schemaVersion: 'final-sensitive-frame-audit.v1', status: 'hit', mediaSha256: sha } },
    { finalPrivacyCoverage: { schemaVersion: 'final-privacy-coverage.v1', status: 'unknown', failureCode: 'frame_count_mismatch' } },
  ]) {
    const content = acceptedContent();
    (content.technicalQualityReport as Record<string, unknown>).mediaHardProbe = { version: 'scene-media-hard-probe.v1', ...probe };
    assert.ok(socialContentGraphQualityFailures(content).includes('measured_media_hard_failure'));
    assert.throws(() => assertSocialContentGraphQuality(content), /measured_media_hard_failure/);
  }
  const content = acceptedContent();
  (content.technicalQualityReport as Record<string, unknown>).mediaHardProbe = {
    version: 'scene-media-hard-probe.v1',
    finalPrivacyCoverage: { schemaVersion: 'final-privacy-coverage.v1', status: 'unknown' },
  };
  assert.ok(!socialContentGraphQualityFailures(content).includes('measured_media_hard_failure'));
});

test('explicit subtitle confirmation can cross human intervention but cannot bypass a failed cut timeline',()=>{
 const content=acceptedContent();Object.assign(content.technicalQualityReport,{policyVersion:'voice-driven-slots.v1'});(content as {replicationEvaluation:unknown}).replicationEvaluation=null;
 const base={tenantId:'tenant',taskId:'task',runId:'run-a',jobId:'job',mediaSha256:sha,qualityInputHash:'b'.repeat(64),acceptedBy:'owner',acceptedAt:'2026-10-28T00:00:00.000Z'};
 const node={schemaVersion:'voice-driven-video-quality.v1',mediaSha256:sha,timeline:{status:'unknown',toleranceSeconds:0.3},subtitleStyle:{status:'blocked',mediaSha256:sha,samples:[]},userAcceptance:socialVideoQualityAcceptanceRecord(base)};
 Object.assign(content.technicalQualityReport,{voiceDrivenReview:node});
 assert.ok(socialContentGraphQualityFailures(content).includes('voice_driven_quality_unverified'));
 node.userAcceptance=socialVideoQualityAcceptanceRecord(base,'accept_subtitle_style');
 assert.deepEqual(socialContentGraphQualityFailures(content),[]);
 node.timeline.status='blocked';assert.ok(socialContentGraphQualityFailures(content).includes('voice_driven_quality_unverified'));
 node.timeline.status='unknown';node.userAcceptance.acceptedBy='another';assert.ok(socialContentGraphQualityFailures(content).includes('voice_driven_quality_unverified'));
});
