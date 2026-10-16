import assert from 'node:assert/strict';
import test from 'node:test';
import { FIXED_YIELD_PATH_IDS } from './fixedYieldCapabilityMap.js';
import { fixedYieldPathReadinessIssues, fixedYieldPathRegistry, fixedYieldRuntimeSnapshotId, type FixedYieldRuntimeReadinessSnapshot } from './fixedYieldPathRegistry.js';

const checkedAt = '2026-10-15T00:00:00.000Z';
const seal = (value: Omit<FixedYieldRuntimeReadinessSnapshot, 'snapshotId'>): FixedYieldRuntimeReadinessSnapshot => ({
  ...value, snapshotId: fixedYieldRuntimeSnapshotId(value),
});
const snapshot = (overrides: Partial<FixedYieldRuntimeReadinessSnapshot['states']> = {}): FixedYieldRuntimeReadinessSnapshot => seal({
  schemaVersion: 'fixed-yield-runtime-readiness.v2', capabilityMapVersion: 'fixed-yield-capability.v2', checkedAt,
  states: Object.assign(Object.fromEntries(FIXED_YIELD_PATH_IDS.map(pathId => [pathId, {
    pathId, state: 'available', allowedModes: pathId === 'P1_PRESENTER' ? ['pipeline_1', 'pipeline_2', 'pipeline_3'] : ['local_video_match'],
    reasonCodes: [], checkedAt,
  }])), overrides) as FixedYieldRuntimeReadinessSnapshot['states'],
});

test('dynamic snapshot never enables an undeclared production mode', () => {
  const result = fixedYieldPathRegistry(snapshot({ P2_PRODUCT_REAL: {
    pathId: 'P2_PRODUCT_REAL', state: 'available', allowedModes: ['local_video_match', 'pipeline_3'], reasonCodes: [], checkedAt,
  } }), checkedAt);
  assert.deepEqual(result.P2_PRODUCT_REAL.executableModes, ['local_video_match']);
});

test('missing or unavailable runtime facts block compilation instead of relying on static claims', () => {
  const complete = snapshot();
  const missingStates = { ...complete.states } as Partial<typeof complete.states>;
  delete missingStates.P1_PRESENTER;
  const missing = seal({ schemaVersion: complete.schemaVersion, capabilityMapVersion: complete.capabilityMapVersion,
    checkedAt, states: missingStates as typeof complete.states });
  assert.match(fixedYieldPathReadinessIssues({ snapshot: missing, evaluatedAt: checkedAt,
    requirements: [{ pathId: 'P1_PRESENTER', productionMode: 'pipeline_1' }] }).join(), /runtime_snapshot_path_missing/);
  const denied = snapshot({ P1_PRESENTER: { pathId: 'P1_PRESENTER', state: 'unavailable', allowedModes: [], reasonCodes: ['heygen_auth_failed'], checkedAt } });
  assert.match(fixedYieldPathReadinessIssues({ snapshot: denied, evaluatedAt: checkedAt,
    requirements: [{ pathId: 'P1_PRESENTER', productionMode: 'pipeline_1' }] }).join(), /heygen_auth_failed/);
});

test('tampered or stale runtime snapshots fail closed', () => {
  const tampered = { ...snapshot(), snapshotId: '0'.repeat(64) };
  assert.match(fixedYieldPathReadinessIssues({ snapshot: tampered, evaluatedAt: checkedAt,
    requirements: [{ pathId: 'P1_PRESENTER', productionMode: 'pipeline_1' }] }).join(), /runtime_snapshot_hash_invalid/);
  assert.match(fixedYieldPathReadinessIssues({ snapshot: snapshot(), evaluatedAt: '2026-10-15T00:16:00.000Z',
    requirements: [{ pathId: 'P1_PRESENTER', productionMode: 'pipeline_1' }] }).join(), /runtime_snapshot_stale/);
});
