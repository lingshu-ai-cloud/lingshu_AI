import assert from 'node:assert/strict';
import {
  buildDigitalHumanTrustedAcceptance,
  attestDigitalHumanHumanReview,
  validateDigitalHumanHumanReview,
  verifyDigitalHumanTrustedAcceptance,
} from './digitalHumanTrustedAcceptance.js';

const now = Date.parse('2026-09-03T08:00:00.000Z');
const secret = 'acceptance-test-secret';
const review = (language: string, jobId: string) => ({
  reviewer: 'QA reviewer', reviewerId: 'qa-user', reviewedAt: '2026-09-03T07:55:00.000Z',
  outputSha256: language.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a'), sourceJobId: jobId,
  doubleMouth: 'approved' as const, complexHands: 'approved' as const, voiceMatch: 'approved' as const,
  performanceContinuity: 'approved' as const,
});
const job = (language: 'zh' | 'en' | 'es', withReview = true) => {
  const jobId = `job-${language}`;
  const outputSha256 = language.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a');
  const segments = [0, 1, 2].map(index => ({
    start: index * 5, end: index * 5 + 3, language, sourceProjectId: 'project-1',
    provenance: {
      avatarMaterialId: 'avatar-1', performanceProfileFingerprint: `profile-${index}`,
      configuredGesture: `gesture-${index}`, inputSignature: `input-${index}`, workerOutputSha256: 'f'.repeat(64),
    },
  }));
  return {
    jobId, batchId: 'batch-1', language, sourceProjectId: 'project-1', status: 'completed',
    containsDigitalHuman: true, downloadable: true, manifestSha256: 'b'.repeat(64),
    computedManifestSha256: 'b'.repeat(64), snapshotManifestSha256: 'b'.repeat(64),
    outputFilename: `studio-${language}.mp4`, outputSizeBytes: 1000, outputSha256,
    actualOutputSizeBytes: 1000, actualOutputSha256: outputSha256, downloadUrl: `/download/${language}`,
    timelineEvidencePassed: true, digitalHumanSegments: segments,
    qualityReport: { schemaVersion: 'final-v1', passed: true, checkedAt: '2026-09-03T07:50:00.000Z', media: { sha256: outputSha256 }, timelineIntegrity: { passed: true } },
    completedAt: '2026-09-03T07:50:00.000Z',
    ...(withReview ? { humanReview: attestDigitalHumanHumanReview(review(language, jobId), secret) } : {}),
  };
};

const accepted = buildDigitalHumanTrustedAcceptance({
  batchId: 'batch-1', tenantId: 'tenant-1', jobs: [job('zh'), job('en'), job('es')], attestationSecret: secret, nowMs: now,
});
assert.equal(accepted.summary.passed, true);
assert.equal(accepted.summary.automatedEvidenceCount, 3);
assert.equal(accepted.summary.manualEvidenceCount, 3);
assert.equal(verifyDigitalHumanTrustedAcceptance(accepted, secret), true);
assert.equal(verifyDigitalHumanTrustedAcceptance({ ...accepted, sourceProjectId: 'tampered' }, secret), false);

const pending = buildDigitalHumanTrustedAcceptance({
  batchId: 'batch-1', tenantId: 'tenant-1', jobs: [job('zh', false), job('en'), job('es')], attestationSecret: secret, nowMs: now,
});
assert.equal(pending.summary.passed, false);
assert.equal(pending.summary.validationStatus, 'requires_human_review');
assert.equal(pending.items[0]!.manualEvidence.valid, false);

assert.throws(() => buildDigitalHumanTrustedAcceptance({
  batchId: 'batch-1', tenantId: 'tenant-1', jobs: [job('zh'), job('en')], attestationSecret: secret, nowMs: now,
}), /zh\/en\/es/);
assert.throws(() => buildDigitalHumanTrustedAcceptance({
  batchId: 'batch-1', tenantId: 'tenant-1', jobs: [{ ...job('zh'), actualOutputSha256: 'c'.repeat(64) }, job('en'), job('es')], attestationSecret: secret, nowMs: now,
}), /SHA256/);
assert.throws(() => buildDigitalHumanTrustedAcceptance({
  batchId: 'batch-1', tenantId: 'tenant-1', jobs: [{ ...job('zh'), sourceProjectId: 'other' }, job('en'), job('es')], attestationSecret: secret, nowMs: now,
}), /sourceProjectId/);
const futureReview = validateDigitalHumanHumanReview({
  value: { ...review('zh', 'job-zh'), reviewedAt: '2026-09-04T00:00:00.000Z' },
  outputSha256: job('zh').outputSha256, sourceJobId: 'job-zh', nowMs: now,
});
assert.equal(futureReview.valid, false);
const wrongShaReview = validateDigitalHumanHumanReview({
  value: { ...review('zh', 'job-zh'), outputSha256: 'f'.repeat(64) },
  outputSha256: job('zh').outputSha256, sourceJobId: 'job-zh', nowMs: now,
});
assert.equal(wrongShaReview.valid, false);

console.log('digital human trusted acceptance tests passed');
