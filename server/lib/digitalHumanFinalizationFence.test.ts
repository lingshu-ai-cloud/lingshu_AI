import assert from 'node:assert/strict';
import { digitalHumanFinalizationFenceFailure } from './digitalHumanFinalizationFence.js';

const now = Date.now();
const active = {
  status: 'quality_check' as const,
  workerId: 'gpu-a',
  workerLeaseId: 'lease-a',
  workerLeaseUntil: new Date(now + 60_000).toISOString(),
};
assert.equal(digitalHumanFinalizationFenceFailure(active, { workerId: 'gpu-a', leaseId: 'lease-a' }, now), null);
assert.equal(digitalHumanFinalizationFenceFailure({ ...active, workerLeaseUntil: new Date(now - 1).toISOString() }, { workerId: 'gpu-a', leaseId: 'lease-a' }, now), 'WORKER_LEASE_MISMATCH');
assert.equal(digitalHumanFinalizationFenceFailure({ ...active, cancelRequested: true }, { workerId: 'gpu-a', leaseId: 'lease-a' }, now), 'JOB_CANCELLED');
assert.equal(digitalHumanFinalizationFenceFailure({ status: 'completed' }), 'JOB_TERMINAL');

console.log('digital human finalization fence tests passed');
