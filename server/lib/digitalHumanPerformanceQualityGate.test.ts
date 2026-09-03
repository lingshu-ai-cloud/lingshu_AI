import assert from 'node:assert/strict';
import {
  DIGITAL_HUMAN_PERFORMANCE_SCHEMA_V2,
  digitalHumanPerformanceGate,
  type PerformanceQualityInput,
} from './digitalHumanPerformanceQualityGate.js';

function validInput(overrides: Partial<PerformanceQualityInput> = {}): PerformanceQualityInput {
  return {
    schemaVersion: DIGITAL_HUMAN_PERFORMANCE_SCHEMA_V2,
    durationSeconds: 15.04,
    ratio: '9:16',
    semanticBeatCount: 3,
    semanticBeatCountSource: 'manifest_time_anchor',
    sampledFrameCount: 126,
    sceneSampleCount: 126,
    presenterExpectedSampleCount: 100,
    presenterDetectedSampleCount: 99,
    poseSampleCount: 88,
    observedDistinctGestureCount: 3,
    observedExpressionChangeCount: 1,
    observedAdjacentRepeatedActions: 0,
    observedGlobalRepeatedActions: 0,
    observedGlobalRepeatedExpressions: 0,
    maximumNonMouthStaticSeconds: 3.2,
    observedSceneOrCompositionCount: 3,
    observedActionChangeCount: 2,
    observedActionPeakCount: 3,
    actionAlignmentObservationCount: 3,
    actionAlignmentMaxMs: 600,
    multipleFaceRate: 0,
    missingPresenterFaceRate: 0.01,
    identityGeometryOutlierRate: 0.02,
    identityProxyStatus: 'passed',
    freezeSegments: 0,
    handStructuralAnomalyDetected: false,
    greenEdgeStatus: 'not_applicable',
    doubleMouthReview: 'approved',
    complexHandReview: 'approved',
    voiceMatchReview: 'approved',
    humanReviewRecordValid: true,
    ...overrides,
  };
}

const valid = digitalHumanPerformanceGate(validInput());
assert.equal(valid.passed, true);
assert.equal(valid.automatedPassed, true);
assert.equal(valid.requiresHumanReview, false);
assert.equal(valid.validationStatus, 'passed');
assert.equal(valid.gateVersion, 'performance-gate-v3');
assert.ok(valid.checks.every((check) => check.status === 'passed'));
assert.equal(valid.checks.find((check) => check.id === 'semantic_beats')?.source, 'manifest_time_anchor');

// Current landmarks cannot reliably clear a second generated mouth or malformed
// fingers. A clean automated measurement must therefore stop at human review.
const pendingReview = digitalHumanPerformanceGate(validInput({
  doubleMouthReview: 'pending',
  complexHandReview: 'pending',
}));
assert.equal(pendingReview.automatedPassed, true);
assert.equal(pendingReview.passed, false);
assert.equal(pendingReview.requiresHumanReview, true);
assert.equal(pendingReview.validationStatus, 'requires_human_review');
assert.equal(pendingReview.humanReviewReasons.length, 2);

const rejectedReview = digitalHumanPerformanceGate(validInput({ complexHandReview: 'rejected' }));
assert.equal(rejectedReview.automatedPassed, false);
assert.equal(rejectedReview.validationStatus, 'failed');
assert.ok(rejectedReview.failures.some((failure) => failure.includes('复杂手部')));

const unauditableReview = digitalHumanPerformanceGate(validInput({ humanReviewRecordValid: false }));
assert.equal(unauditableReview.passed, false);
assert.ok(unauditableReview.failures.some((failure) => failure.includes('不可审计')));

const invalidMeasurements = digitalHumanPerformanceGate(validInput({
  durationSeconds: 17,
  semanticBeatCount: 2,
  sampledFrameCount: 20,
  sceneSampleCount: 20,
  presenterDetectedSampleCount: 60,
  poseSampleCount: 20,
  observedDistinctGestureCount: 1,
  observedExpressionChangeCount: 0,
  observedAdjacentRepeatedActions: 1,
  observedGlobalRepeatedActions: 1,
  observedGlobalRepeatedExpressions: 1,
  maximumNonMouthStaticSeconds: 4.1,
  observedSceneOrCompositionCount: 1,
  observedActionChangeCount: 0,
  observedActionPeakCount: 1,
  actionAlignmentObservationCount: 1,
  actionAlignmentMaxMs: 1_200,
  multipleFaceRate: 0.02,
  missingPresenterFaceRate: 0.4,
  identityGeometryOutlierRate: 0.2,
  identityProxyStatus: 'failed',
  freezeSegments: 1,
  handStructuralAnomalyDetected: true,
  greenEdgeStatus: 'failed',
  ratio: '16:9',
}));
assert.equal(invalidMeasurements.passed, false);
assert.equal(invalidMeasurements.requiresHumanReview, false);
assert.ok(invalidMeasurements.failures.length >= 18);
assert.ok(invalidMeasurements.failures.some((failure) => failure.includes('实测明确不同的手势')));
assert.ok(invalidMeasurements.failures.some((failure) => failure.includes('绿边')));

const unavailableIdentity = digitalHumanPerformanceGate(validInput({ identityProxyStatus: 'unavailable' }));
assert.equal(unavailableIdentity.automatedPassed, true);
assert.equal(unavailableIdentity.requiresHumanReview, true);
assert.ok(unavailableIdentity.humanReviewReasons.some((reason) => reason.includes('身份稳定代理')));

const missingRequiredMetric = digitalHumanPerformanceGate({
  ...validInput(),
  observedActionPeakCount: Number.NaN,
});
assert.equal(missingRequiredMetric.passed, false);
assert.ok(missingRequiredMetric.failures.some((failure) => failure.includes('observedActionPeakCount')));

const missingRequiredStatus = digitalHumanPerformanceGate({
  ...validInput(),
  humanReviewRecordValid: undefined,
} as unknown as PerformanceQualityInput);
assert.equal(missingRequiredStatus.passed, false);
assert.ok(missingRequiredStatus.failures.some((failure) => failure.includes('humanReviewRecordValid')));

const legacyPayload = digitalHumanPerformanceGate({
  ...validInput(),
  schemaVersion: 'performance-observation-v1',
} as unknown as PerformanceQualityInput);
assert.equal(legacyPayload.passed, false);
assert.ok(legacyPayload.failures.some((failure) => failure.includes('schema')));

console.log('digitalHumanPerformanceQualityGate tests passed');
