import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSocialContentGraphQuality, socialContentGraphQualityFailures } from './socialContentGraphQualityGate.js';

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
