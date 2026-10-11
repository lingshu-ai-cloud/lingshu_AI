import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LangGraphTestStore } from './langgraphTestStore.js';
import { runLangGraphProduction, type LangGraphProductionInput } from '../server/contentExecution/langgraphEngine.js';
import { CONTENT_GRAPH_VERSION } from '../server/contentExecution/langgraphIdentity.js';
import { assertCurrentContentExecutionActive, runWithContentExecutionContext } from '../server/contentExecution/context.js';

test('actual graph checkpoints and provider receipt survive process termination and repeated human resume', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'langgraph-persistence-')); t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'store.json'), log = path.join(root, 'calls.log'), store = new LangGraphTestStore(filename);
  await store.create('workflow_runs', { id: 'run-a', tenant_id: 'tenant-a', status: 'running' });
  await store.create('content_execution_jobs', { id: 'job-a', tenant_id: 'tenant-a', task_id: 'task-a', run_id: 'run-a', status: 'running', checkpoints: {}, provider_receipts: [] });
  const worker = fileURLToPath(new URL('./langgraphRestartWorker.ts', import.meta.url));
  const launch = (mode: string) => spawnSync(process.execPath, ['--import', 'tsx', worker, filename, mode, log], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NODE_ENV: 'test', LANGSMITH_TRACING: 'true', LANGCHAIN_TRACING_V2: 'true', LANGSMITH_ENDPOINT: 'http://127.0.0.1:1', LANGCHAIN_ENDPOINT: 'http://127.0.0.1:1', LANGSMITH_API_KEY: 'controlled-test-not-a-secret' },
  });
  const crashed = launch('crash'); assert.equal(crashed.status, 73, crashed.stderr);
  const jobAfterCrash = await store.getById<Record<string, unknown>>('content_execution_jobs', 'job-a');
  assert.ok(jobAfterCrash?.checkpoints); assert.match(JSON.stringify(jobAfterCrash?.provider_receipts), /provider-task-a/);
  const resumed = launch('continue'); assert.equal(resumed.status, 0, resumed.stderr);
  assert.deepEqual(JSON.parse(resumed.stdout), { status: 'waiting_review', telemetry: 0, checkpointsPresent: true }, resumed.stderr);
  assert.equal((await readFile(log, 'utf8')).split('\n').filter(line => line === 'provider-submit').length, 1);
  // Approval is an independently persisted business fact, never the resume payload.
  await store.create('test_approval', { id: 'approval-a', tenant_id: 'tenant-a', plan_version: '1', content_hash: 'artifact-hash-a', status: 'approved' });
  const approved = launch('resume'); assert.equal(approved.status, 0, approved.stderr);
  assert.equal(JSON.parse(approved.stdout).status, 'completed');
  const repeated = launch('continue'); assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).status, 'completed');
  const calls = (await readFile(log, 'utf8')).trim().split('\n');
  for (const phase of ['provider-submit', 'assets', 'render', 'quality', 'delivery']) assert.equal(calls.filter(value => value === phase).length, 1, phase);
});

test('persisted scope/version changes and pause/cancel fail before new phase effects', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'langgraph-scope-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'store.json'));
  const identity = { tenantId: 'tenant-a', taskId: 'task-a', runId: 'run-a', jobId: 'job-a', planVersion: '1', inputHash: 'frozen-hash', graphVersion: CONTENT_GRAPH_VERSION };
  await store.create('workflow_runs', { id: identity.runId, tenant_id: identity.tenantId, status: 'running' });
  await store.create('content_execution_jobs', { id: identity.jobId, tenant_id: identity.tenantId, task_id: identity.taskId, run_id: identity.runId, status: 'running', checkpoints: {} });
  let effects = 0;
  const phase = async () => { effects++; return { artifactRefs: ['artifact:1'], inputHash: identity.inputHash }; };
  const input: LangGraphProductionInput = { identity, dataStore: store, assertActive: assertCurrentContentExecutionActive,
    phases: { assets: phase, render: phase, quality: phase, delivery: phase }, review: { loadApproval: async () => null, verifyResume: async () => false } };
  const execute = async (override: Partial<LangGraphProductionInput> = {}) => {
    const job = await store.getById<Record<string, unknown>>('content_execution_jobs', identity.jobId);
    return runWithContentExecutionContext({ dataStore: store, jobId: identity.jobId, checkpoints: job?.checkpoints, action: () => runLangGraphProduction({ ...input, ...override }) });
  };
  await assert.rejects(execute({ identity: { ...identity, tenantId: 'tenant-b' } }), /scope_mismatch/); assert.equal(effects, 0);
  for (const status of ['paused', 'cancelled']) {
    await store.update('content_execution_jobs', identity.jobId, { status });
    await assert.rejects(execute(), /content_execution_stopped/); assert.equal(effects, 0);
  }
  await store.update('content_execution_jobs', identity.jobId, { status: 'running' });
  assert.equal((await execute()).status, 'waiting_review'); assert.equal(effects, 3);
  await assert.rejects(execute({ identity: { ...identity, planVersion: '2' } }), /checkpoint_version_changed/); assert.equal(effects, 3);
  await assert.rejects(execute({ identity: { ...identity, inputHash: 'new-plan-hash' } }), /checkpoint_version_changed/); assert.equal(effects, 3);
  await assert.rejects(execute({ resume: { approved: true } }), /resume_not_authorized/); assert.equal(effects, 3);
});
