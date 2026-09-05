import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import { approvalRunBlockedReason, digitalEmployeeRunBlockedReason, withDigitalEmployeeExternalAction, withDigitalEmployeeRunLock } from './runControl.js';

const run = { id: 'run-control', tenant_id: 'tenant-control', status: 'running' };
const originalGet = store.getById;
store.getById = (async (collection: string, id: string) => collection === 'workflow_runs' && id === run.id ? run : null) as typeof store.getById;
try {
  for (const status of ['paused', 'cancelled', 'waiting_human', 'failed', 'succeeded', 'unknown']) {
    run.status = status;
    assert.equal(await digitalEmployeeRunBlockedReason(run.tenant_id, run.id), `workflow_run_${status}`);
    assert.equal(approvalRunBlockedReason(run, run.tenant_id, 'waiting_approval'), `workflow_run_${status}`);
    await assert.rejects(() => withDigitalEmployeeExternalAction(run.tenant_id, run.id, async () => assert.fail('must not call provider')), new RegExp(`workflow_run_${status}`));
  }
  run.status = 'running';
  assert.equal(await digitalEmployeeRunBlockedReason('other-tenant', run.id), 'workflow_run_unavailable');
  assert.equal(await digitalEmployeeRunBlockedReason(run.tenant_id, 'missing'), 'workflow_run_unavailable');
  assert.equal(await digitalEmployeeRunBlockedReason(run.tenant_id, ''), 'workflow_run_unavailable');
  assert.equal(approvalRunBlockedReason(run, run.tenant_id, 'cancelled'), 'approval_task_not_waiting');
  assert.equal(approvalRunBlockedReason(run, run.tenant_id, 'waiting_approval'), '');

  let started!: () => void;
  let release!: () => void;
  const hasStarted = new Promise<void>(resolve => { started = resolve; });
  const releaseProvider = new Promise<void>(resolve => { release = resolve; });
  const receipts: string[] = [];
  const inFlight = withDigitalEmployeeExternalAction(run.tenant_id, run.id, async () => {
    started();
    await releaseProvider;
    receipts.push('provider-accepted');
  });
  await hasStarted;
  const cancel = withDigitalEmployeeRunLock(run.tenant_id, run.id, async () => { run.status = 'cancelled'; });
  const nextSend = withDigitalEmployeeExternalAction(run.tenant_id, run.id, async () => assert.fail('no new sends after cancellation'));
  const blockedSend = assert.rejects(() => nextSend, /workflow_run_cancelled/);
  release();
  await Promise.all([inFlight, cancel, blockedSend]);
  assert.deepEqual(receipts, ['provider-accepted'], 'an already in-flight provider receipt must be retained');
  assert.equal(run.status, 'cancelled');
  await withDigitalEmployeeRunLock(run.tenant_id, run.id, () => withDigitalEmployeeRunLock(run.tenant_id, run.id, async () => undefined));
} finally { store.getById = originalGet; }
console.log('digital employee run control tests passed');
