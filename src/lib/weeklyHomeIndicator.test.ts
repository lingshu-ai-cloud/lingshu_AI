import assert from 'node:assert/strict';
import test from 'node:test';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { weeklyHomeIndicator } from './weeklyHomeIndicator';

const base = { plan: { id: 'plan' }, run: { id: 'run', status: 'running' }, tasks: [] } as unknown as DigitalEmployeeOverview;
test('weekly home indicator requires a started run and production evidence', () => {
  assert.equal(weeklyHomeIndicator(null), 'idle');
  assert.equal(weeklyHomeIndicator({ ...base, run: null }), 'idle');
  assert.equal(weeklyHomeIndicator(base), 'idle');
  assert.equal(weeklyHomeIndicator({ ...base, tasks: [{ run_id: 'run', kind: 'production', status: 'running' }] } as DigitalEmployeeOverview), 'producing');
  assert.equal(weeklyHomeIndicator({ ...base, tasks: [{ run_id: 'run', kind: 'analysis', status: 'running' }] } as DigitalEmployeeOverview), 'idle');
  assert.equal(weeklyHomeIndicator({ ...base, tasks: [{ run_id: 'other', status: 'running' }] } as DigitalEmployeeOverview), 'idle');
});
test('actionable problems override active production and unrelated jobs do not', () => {
  assert.equal(weeklyHomeIndicator({ ...base, tasks: [{ run_id: 'run', status: 'running' }, { run_id: 'run', status: 'blocked' }] } as DigitalEmployeeOverview), 'attention');
  assert.equal(weeklyHomeIndicator({ ...base, executionRuntime: { sourceStatus: 'available', jobs: [{ runId: 'other', status: 'blocked' }, { runId: 'run', status: 'running' }] } } as DigitalEmployeeOverview), 'producing');
  assert.equal(weeklyHomeIndicator({ ...base, executionRuntime: { sourceStatus: 'available', jobs: [{ runId: 'run', status: 'dead_letter' }] } } as DigitalEmployeeOverview), 'attention');
  assert.equal(weeklyHomeIndicator({ ...base, tasks: [{ run_id: 'run', kind: 'production', status: 'waiting_external', output: { waitState: { kind: 'processing', requiresAttention: false } } }] } as unknown as DigitalEmployeeOverview), 'producing');
  assert.equal(weeklyHomeIndicator({ ...base, tasks: [{ run_id: 'run', kind: 'production', status: 'waiting_external', output: { waitState: { kind: 'input', requiresAttention: true } } }] } as unknown as DigitalEmployeeOverview), 'attention');
});
