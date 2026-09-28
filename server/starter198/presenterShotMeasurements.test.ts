import assert from 'node:assert/strict';
import { presenterShotMeasurements } from './presenterShotMeasurements.js';
import { decidePresenterStack } from './presenterStackPolicy.js';

const extracted = {
  sourceVideoRef: '/api/overseas/videos/v1/media',
  clipRef: '/api/overseas/videos/v1/shot/1/clip',
  firstFrameRef: '/api/overseas/videos/v1/shot/1/first-frame',
  firstFrameSeconds: 1.04,
  extractionStatus: 'ready' as const,
};
const shot = presenterShotMeasurements({ shotId: 'reference-shot-1', startSeconds: 1, endSeconds: 4, materialEvidence: extracted });
assert.equal(shot.sourceFirstFrameRef, extracted.firstFrameRef);
assert.equal(shot.durationSeconds, 3);
assert.equal(shot.evidence[0]?.sourceKind, 'server_extracted_frame');
assert.equal(shot.evidence[0]?.startSeconds, 0);
assert.equal(shot.visibleSpeechSeconds, null, 'ASR is not visible lip motion');
assert.equal(shot.specificGestureCount, null, 'model prose is not a gesture measurement');
assert.equal(shot.bodyCenterTravelFrameWidth, null, 'one frame cannot measure body displacement');
assert.equal(shot.cameraTravelFrameDiagonal, null, 'one frame cannot measure camera displacement');
assert.equal(shot.decisionConfidence, 0);
assert.equal(decidePresenterStack(shot, { heygen: true, seedance: true, budget: true }).route, 'needs_evidence');

for (const invalid of [
  { ...extracted, extractionStatus: 'unavailable' as const },
  { ...extracted, firstFrameSeconds: 4.1 },
  { ...extracted, clipRef: null },
]) {
  const result = presenterShotMeasurements({ shotId: 'reference-shot-1', startSeconds: 1, endSeconds: 4, materialEvidence: invalid });
  assert.equal(result.sourceFirstFrameRef, null);
  assert.deepEqual(result.evidence, []);
}
