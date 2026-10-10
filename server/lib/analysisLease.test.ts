import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AnalysisAlreadyRunningError, AnalysisLeaseRegistry } from './analysisLease.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lease-'));
try {
  const first = new AnalysisLeaseRegistry(dir);
  const second = new AnalysisLeaseRegistry(dir);
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const pending = first.run('tenant/video', () => new Promise<void>(resolve => { release = resolve; acquired(); }));
  await ready;
  assert.equal(second.has('tenant/video'), true);
  await assert.rejects(second.run('tenant/video', async () => 'duplicate'), AnalysisAlreadyRunningError);
  release(); await pending;
  assert.equal(second.has('tenant/video'), false);
  // A killed process leaves a real owner file; a new registry recovers it.
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { AnalysisLeaseRegistry } from './server/lib/analysisLease.ts';
    new AnalysisLeaseRegistry(${JSON.stringify(dir)}).run('tenant/video', async () => { process.exit(0); });
  `]);
  assert.equal(child.status, 0, child.stderr.toString());
  let calls = 0;
  await second.run('tenant/video', async () => { calls += 1; });
  assert.equal(calls, 1);
  await assert.rejects(second.run('tenant/video', async () => { throw Error('provider failed'); }));
  assert.equal(second.has('tenant/video'), false);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('Persistent analysis ownership, dead-process recovery and failure release passed');
