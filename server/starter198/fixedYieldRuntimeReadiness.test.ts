import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFixedYieldRuntimeReadinessSnapshot, type FixedYieldModeProbe } from './fixedYieldRuntimeReadiness.js';

const ready = (): FixedYieldModeProbe => ({ adapterRegistered: true, authenticationReady: true, quotaAndBillingReady: true,
  qualityInspectionReady: true, objectStorageReady: true, reasonCodes: [] });

test('snapshot is fail-closed per exact mode while local footage remains independently available', () => {
  const facts = { checkedAt: '2026-10-15T00:00:00Z', localVideo: { ffmpegReady: true, segmentProfilesReady: true, localQualityReady: true, reasonCodes: [] },
    presenter: { pipeline_1: ready(), pipeline_2: { ...ready(), qualityInspectionReady: false }, pipeline_3: { ...ready(), authenticationReady: false } } };
  const snapshot = buildFixedYieldRuntimeReadinessSnapshot(facts);
  assert.equal(snapshot.states.P1_PRESENTER.state, 'degraded');
  assert.deepEqual(snapshot.states.P1_PRESENTER.allowedModes, ['pipeline_1']);
  assert.equal(snapshot.states.P2_PRODUCT_REAL.state, 'available');
  assert.match(snapshot.states.P1_PRESENTER.reasonCodes.join(','), /quality_inspection_unavailable/);
  assert.equal(snapshot.snapshotId.length, 64);
  assert.equal(snapshot.snapshotId, buildFixedYieldRuntimeReadinessSnapshot(facts).snapshotId);
});
