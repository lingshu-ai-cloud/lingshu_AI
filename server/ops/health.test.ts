import assert from 'node:assert/strict';
import {
  markWorkerStopped,
  recordWorkerHeartbeat,
  registerHealthCheck,
  registerWorkerHeartbeat,
  runReadinessChecks,
  setProcessDraining,
} from './health.js';

const unregisterCore = registerHealthCheck('test-core', () => ({ ok: true }), { critical: true });
const unregisterOptional = registerHealthCheck('test-optional', () => ({ ok: false, message: 'test_warning' }), { critical: false });
let snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'degraded');
assert.equal(snapshot.checks.find(check => check.name === 'test-optional')?.message, 'test_warning');
unregisterOptional();

const unregisterWorker = registerWorkerHeartbeat('test-worker', { staleAfterMs: 5_000, critical: true });
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'not_ready');
assert.equal(snapshot.checks.find(check => check.name === 'worker:test-worker')?.message, 'worker_has_not_heartbeat');

recordWorkerHeartbeat('test-worker', { state: 'starting' });
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'not_ready');
assert.equal(snapshot.checks.find(check => check.name === 'worker:test-worker')?.message, 'worker_starting');

recordWorkerHeartbeat('test-worker', { queueDepth: 0 });
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'ready');
assert.equal(snapshot.checks.find(check => check.name === 'worker:test-worker')?.details?.queueDepth, 0);

recordWorkerHeartbeat('test-worker', { error: 'provider_unavailable' });
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'not_ready', 'a fresh heartbeat carrying an error must fail readiness');
assert.equal(snapshot.checks.find(check => check.name === 'worker:test-worker')?.message, 'worker_reported_error');

recordWorkerHeartbeat('test-worker', { queueDepth: 0, state: 'running' });
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'ready', 'a later successful heartbeat must recover readiness');

markWorkerStopped('test-worker');
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'not_ready');
assert.equal(snapshot.checks.find(check => check.name === 'worker:test-worker')?.message, 'worker_stopped');
unregisterWorker();
unregisterCore();

setProcessDraining(true);
snapshot = await runReadinessChecks();
assert.equal(snapshot.status, 'not_ready');
assert.equal(snapshot.checks[0]?.name, 'process-draining');

console.log('readiness registry, worker heartbeat, degradation, and draining semantics passed');
