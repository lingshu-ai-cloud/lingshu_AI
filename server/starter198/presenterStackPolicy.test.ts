import assert from 'node:assert/strict';
import { decidePresenterStack } from './presenterStackPolicy.js';
import type { PresenterShotMeasurements } from '../../shared/contracts/presenterStackPolicy.js';

const base: PresenterShotMeasurements = {
  shotId: 'shot-1', durationSeconds: 5, sourceFirstFrameRef: 'frame-1', enterprisePresenterAssetRef: 'presenter-1',
  visibleSpeechSeconds: 3, lipSyncRequired: true, specificGestureCount: 0,
  bodyCenterTravelFrameWidth: 0.02, cameraTravelFrameDiagonal: 0.01,
  compositionLockRequired: false, physicalProductContact: false, decisionConfidence: 0.93,
  evidence: [{ startSeconds: 0, endSeconds: 3, frameRef: 'frame-1', observation: '人物正面口播，机位稳定' }],
};
const ready = { heygen: true, seedance: true, budget: true };
assert.equal(decidePresenterStack(base, ready).route, 'heygen_talking');
assert.equal(decidePresenterStack({ ...base, bodyCenterTravelFrameWidth: 0.08, cameraTravelFrameDiagonal: 0.05,
  decisionConfidence: 0.85 }, ready).route, 'heygen_talking');
assert.equal(decidePresenterStack({ ...base, specificGestureCount: 1 }, ready).route, 'heygen_talking');
assert.equal(decidePresenterStack({ ...base, bodyCenterTravelFrameWidth: 0.09, visibleSpeechSeconds: 0, lipSyncRequired: false }, ready).route, 'seedance_first_frame');
assert.equal(decidePresenterStack({ ...base, cameraTravelFrameDiagonal: 0.06, visibleSpeechSeconds: 0, lipSyncRequired: false }, ready).route, 'seedance_first_frame');
assert.equal(decidePresenterStack({ ...base, compositionLockRequired: true }, ready).route, 'split_motion_and_speech');
assert.equal(decidePresenterStack({ ...base, decisionConfidence: 0.84 }, ready).route, 'needs_evidence');
assert.equal(decidePresenterStack({ ...base, durationSeconds: 0 }, ready).route, 'needs_evidence');
assert.equal(decidePresenterStack({ ...base, specificGestureCount: null }, ready).route, 'needs_evidence');
assert.equal(decidePresenterStack({ ...base, evidence: [] }, ready).route, 'needs_evidence');
assert.equal(decidePresenterStack({ ...base, sourceFirstFrameRef: null }, ready).route, 'needs_evidence');
assert.deepEqual(decidePresenterStack({ ...base, physicalProductContact: true }, ready), {
  policyVersion: '1', route: 'blocked', executable: false,
  reasonCodes: ['physical_product_contact_requires_enterprise_product_asset'],
  measurements: { ...base, physicalProductContact: true },
});
assert.deepEqual(decidePresenterStack({ ...base, physicalProductContact: true }, {
  ...ready, enterpriseProductAsset: true,
}).reasonCodes, ['enterprise_product_contact_requires_dynamic_presenter']);
assert.equal(decidePresenterStack({ ...base, physicalProductContact: true }, {
  ...ready, enterpriseProductAsset: true,
}).route, 'split_motion_and_speech');
assert.equal(decidePresenterStack({ ...base, physicalProductContact: true, visibleSpeechSeconds: 0, lipSyncRequired: false }, {
  ...ready, enterpriseProductAsset: true,
}).route, 'seedance_first_frame');
assert.equal(decidePresenterStack({ ...base, visibleSpeechSeconds: 0, lipSyncRequired: false, bodyCenterTravelFrameWidth: 0.09, durationSeconds: 16,
  evidence: [{ startSeconds: 0, endSeconds: 3, frameRef: 'frame-1', observation: '手势' }] }, ready).route, 'blocked');
assert.equal(decidePresenterStack(base, { ...ready, heygen: false }).route, 'blocked');
console.log('presenter stack policy tests passed');
