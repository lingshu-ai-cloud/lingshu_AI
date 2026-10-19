import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEKLY_GOLDEN_PACKAGE_BASELINE,
  WEEKLY_RECOVERY_FAULT_MATRIX,
} from './weeklyGoldenPackageRecovery.fixture.js';

const observedFaults = [
  'execution_window_required',
  'durable_gate_busy',
  'orphan_local_store_lock',
  'provider_outcome_unknown',
  'retired_discovery_scope',
  'migration_binding_interrupted',
  'historical_week_candidate',
  'whole_graph_schedule_blocked',
  'daily_collection_limit_cross_day',
] as const;

test('golden weekly package is a sanitised recovery baseline with safe boundaries', () => {
  assert.equal(WEEKLY_GOLDEN_PACKAGE_BASELINE.naturalWeekPolicy, 'latest_only');
  assert.equal(WEEKLY_GOLDEN_PACKAGE_BASELINE.historicalWeekPolicy, 'audit_only');
  assert.equal(WEEKLY_GOLDEN_PACKAGE_BASELINE.restartRequired, true);
  assert.equal(WEEKLY_GOLDEN_PACKAGE_BASELINE.expectedBoundaries.userRequiredBeforeFinalReview, false);
  assert.equal(WEEKLY_GOLDEN_PACKAGE_BASELINE.expectedBoundaries.automaticBudgetIncrease, false);
  assert.equal(WEEKLY_GOLDEN_PACKAGE_BASELINE.expectedBoundaries.publishingAuthorized, false);
  assert.deepEqual(WEEKLY_GOLDEN_PACKAGE_BASELINE.requiredBranches, ['business_outline', 'benchmark_collection']);
  assert.equal(JSON.stringify(WEEKLY_GOLDEN_PACKAGE_BASELINE).includes('apiKey'), false);
  assert.equal(JSON.stringify(WEEKLY_GOLDEN_PACKAGE_BASELINE).includes('secret'), false);
});

test('fault matrix permanently accounts for every observed recovery blockage', () => {
  assert.equal(new Set(WEEKLY_RECOVERY_FAULT_MATRIX.map(row => row.id)).size, WEEKLY_RECOVERY_FAULT_MATRIX.length);
  assert.deepEqual(WEEKLY_RECOVERY_FAULT_MATRIX.map(row => row.id).sort(), [...observedFaults].sort());
  for (const row of WEEKLY_RECOVERY_FAULT_MATRIX) {
    assert.ok(row.originalBlockedState.trim(), `${row.id}: original state`);
    assert.ok(row.durableEvidence.trim(), `${row.id}: durable evidence`);
    assert.match(row.restartTrigger, /重启/u, `${row.id}: restart regression is mandatory`);
    assert.ok(row.expectedRecovery.trim(), `${row.id}: expected recovery`);
    assert.ok(row.mustNotHappen.length > 0, `${row.id}: negative invariant`);
    assert.ok(row.regressionOwner.trim(), `${row.id}: existing module owner`);
  }
});

test('latest-week-only and immutable-history rules are explicit fault invariants', () => {
  const staleScope = WEEKLY_RECOVERY_FAULT_MATRIX.find(row => row.id === 'retired_discovery_scope');
  const historical = WEEKLY_RECOVERY_FAULT_MATRIX.find(row => row.id === 'historical_week_candidate');
  assert.match(staleScope?.expectedRecovery ?? '', /仅.*最新自然周/u);
  assert.ok(staleScope?.mustNotHappen.includes('修订历史自然周'));
  assert.match(historical?.expectedRecovery ?? '', /历史周只保留审计/u);
  assert.ok(historical?.mustNotHappen.includes('自动修订历史周'));
});
