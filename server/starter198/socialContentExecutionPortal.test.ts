import assert from 'node:assert/strict';
import test from 'node:test';
import { socialContentExecutionAccepted } from './socialContentExecutionPortal.js';

test('only the exact accepted queue and run can produce a portal', () => {
  const record = { run_id: 'run-1', orchestrator_item_id: 'queue-1', brief: {
    _executionQueueReceipt: { disposition: 'queued', runId: 'run-1', queueItemId: 'queue-1' },
  } };
  assert.equal(socialContentExecutionAccepted(record), true);
  assert.equal(socialContentExecutionAccepted({ ...record, brief: JSON.stringify(record.brief) }), true);
  for (const disposition of ['awaiting_initial_confirmation', 'requires_manual_production', 'failed', 'processing', '']) {
    assert.equal(socialContentExecutionAccepted({ ...record, brief: { _executionQueueReceipt: { ...record.brief._executionQueueReceipt, disposition } } }), false, disposition);
  }
  assert.equal(socialContentExecutionAccepted({ ...record, run_id: 'another-run' }), false);
  assert.equal(socialContentExecutionAccepted({ ...record, orchestrator_item_id: 'another-queue' }), false);
  assert.equal(socialContentExecutionAccepted({ ...record, run_id: '' }), false);
  assert.equal(socialContentExecutionAccepted({ ...record, brief: {} }), false, 'saved task or UI status alone is not queue evidence');
  assert.equal(socialContentExecutionAccepted({ ...record, run_id: '', brief: {
    _executionQueueReceipt: { disposition: 'queued', queueItemId: 'queue-1', runId: null },
  } }), true, 'an accepted queue may wait for a run to be assigned');
});
