import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

// Fail closed if this isolated initializer ever attempts an external API.
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error('restart_acceptance_external_api_forbidden'); };
const { store } = await import('../../server/storage/index.js');
const { runWithDataAuthority, currentDataAuthority } = await import('../../server/storage/dataAuthority.js');
const { initSocialSceneReworkCompletionRecovery } = await import('../../server/runtime/socialSceneReworkCompletionRuntime.js');
const read = () => runWithDataAuthority('local', async () => {
  assert.equal(currentDataAuthority(), 'local');
  const runs = await store.list<any>('workflow_runs', { perPage: 100 });
  const artifacts = await store.list<any>('starter_social_content_artifacts', { perPage: 100 });
  const jobs = await store.list<any>('content_execution_jobs', { perPage: 100 });
  return { run: runs.items.find(row => row.id === 'rework-run'), source: runs.items.find(row => row.id === 'run'), artifacts: artifacts.items, jobs: jobs.items };
});
const before = await read();
const phase = process.argv[2];
assert.equal(before.run?.status, phase === 'idempotent' ? 'completed' : 'running');
let injectedWriteFailures = 0;
if (phase === 'first') {
  const actualUpdate = store.update.bind(store);
  store.update = async (collection, id, data) => {
    if (collection === 'workflow_runs' && id === 'rework-run' && data.status === 'completed') { injectedWriteFailures++; return false; }
    return actualUpdate(collection, id, data);
  };
}
initSocialSceneReworkCompletionRecovery();
initSocialSceneReworkCompletionRecovery();
const deadline = Date.now() + 10_000;
let after = await read();
while ((phase === 'first' ? injectedWriteFailures === 0 : after.run?.status !== 'completed') && Date.now() < deadline) { await delay(25); after = await read(); }
assert.equal(after.run?.status, phase === 'first' ? 'running' : 'completed', 'actual initializer must preserve a failed projection, then recover on process restart');
assert.equal(injectedWriteFailures, phase === 'first' ? 1 : 0);
// Let the immediate scan settle before comparing its side effects on restart.
await delay(150);
after = await read();
assert.deepEqual(after.jobs, before.jobs, 'initializer must not claim, retry or replace a production job');
assert.deepEqual(after.artifacts, before.artifacts, 'initializer must not produce another artifact');
assert.deepEqual(after.source, before.source, 'original production run must be preserved');
assert.equal(networkAttempts, 0, 'local authority must prevent external API access');
if (phase === 'idempotent') assert.deepEqual(after.run, before.run, 'restart must preserve the original completion timestamp and receipt');
console.log(JSON.stringify({ phase: process.argv[2], pid: process.pid, completedAt: after.run.completed_at, jobIds: after.jobs.map(row => row.id), artifactIds: after.artifacts.map(row => row.artifact_id), networkAttempts, injectedWriteFailures, runStatus: after.run.status }));
