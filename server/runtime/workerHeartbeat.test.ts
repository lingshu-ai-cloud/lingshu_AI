import test from 'node:test';
import assert from 'node:assert/strict';
import { contentWorkerLivenessIssue, starterContentWorkerState } from './workerHeartbeat.js';

const now = new Date('2026-10-27T10:10:00.000Z');

test('content worker liveness requires the weekly scanner and detects a wedged scan', () => {
  const base = { configuredEnabled: true, started: true, state: 'idle' as const, workerId: 'worker',
    startedAt: '2026-10-27T10:00:00.000Z', lastScanStartedAt: '2026-10-27T10:09:00.000Z',
    lastScanFinishedAt: '2026-10-27T10:09:01.000Z', lastResult: null, lastErrorCode: null };
  assert.equal(contentWorkerLivenessIssue(base, now), null);
  assert.equal(contentWorkerLivenessIssue({ ...base, configuredEnabled: false }), 'weekly_execution_disabled');
  assert.equal(contentWorkerLivenessIssue({ ...base, state: 'failed' }), 'weekly_execution_failed');
  assert.equal(contentWorkerLivenessIssue({ ...base, state: 'scanning', lastScanStartedAt: '2026-10-27T09:00:00.000Z' }, now), 'weekly_execution_stalled');
});

test('starter content workers fail closed unless every consumer has valid runtime dependencies', () => {
  const local = starterContentWorkerState({ NODE_ENV: 'development', STARTER_198_ORCHESTRATOR_WORKER_ENABLED: 'true',
    STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED: 'true', STARTER_QUOTE_ARTIFACT_WORKER_ENABLED: 'true' });
  assert.deepEqual(local, { ready: true, issues: [] });
  const disabled = starterContentWorkerState({ NODE_ENV: 'development', STARTER_198_ORCHESTRATOR_WORKER_ENABLED: 'true' });
  assert.equal(disabled.ready, false); assert.equal(disabled.issues.length, 2);
});
