import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { outputFixture } from './output-status.fixture.js';
import { socialRequestHash } from '../../server/starter198/socialContentValidation.js';

test('actual initializer restart recovers a failed file-backed OutputPort completion and remains idempotent', { timeout: 30_000 }, async () => {
  const x = await outputFixture();
  const directory = await mkdtemp(path.join(tmpdir(), 'scene-completion-restart-'));
  try {
    const output = await x.port(x.input);
    const file = x.f.tables.starter_social_content_files!.find(row => `socialfile:${row.file_id}` === output.fileRef)!;
    // Persist actual OutputPort bytes for the default owned socialfile reader; no in-memory backend port in children.
    const ownedPath = path.join(path.dirname(x.f.local), `${output.sha256}.mp4`);
    await copyFile(x.input.outputPath, ownedPath);
    Object.assign(file, { storage_kind: 'local', storage_key: path.relative(path.resolve('data/social-content-sources'), ownedPath) });
    const job = x.f.tables.content_execution_jobs!.find(row => row.id === x.input.job.id)!;
    Object.assign(job, { status: 'succeeded', completed_at: new Date().toISOString(), worker_id: '', lease_expires_at: '' });
    const run = x.f.tables.workflow_runs!.find(row => row.id === x.input.job.runId)!;
    const receipt = { operationId: x.input.intent.operationId, jobId: x.input.job.id, executionRunId: x.input.job.runId, ...output };
    Object.assign(run, { status: 'running', starter_context: { ...run.starter_context as object, sceneReworkOutput: { ...receipt, recordHash: socialRequestHash(receipt) } } });
    for (const [collection, rows] of Object.entries(x.f.tables)) await writeFile(path.join(directory, `${collection}.json`), JSON.stringify(rows));
    const child = fileURLToPath(new URL('./completion-restart.child.ts', import.meta.url));
    const launch = (phase: string) => new Promise<any>((resolve, reject) => {
      const processChild = spawn(process.execPath, ['--import', 'tsx', child, phase], { cwd: process.cwd(), env: { ...process.env, LOCAL_STORE_DIR: directory, DATA_BACKEND: 'pocketbase', NODE_ENV: 'test', LINGSHU_LOCAL_PREVIEW: '1', ENABLE_LOCAL_DEV_FALLBACK: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      processChild.stdout.on('data', data => { stdout += data; });
      processChild.stderr.on('data', data => { stderr += data; });
      const timeout = setTimeout(() => { processChild.kill('SIGKILL'); reject(new Error(`initializer child timeout: ${stderr}`)); }, 12_000);
      processChild.on('error', error => { clearTimeout(timeout); reject(error); });
      processChild.on('exit', code => { clearTimeout(timeout); if (code !== 0) reject(new Error(`initializer child failed (${code}): ${stderr}\n${stdout}`)); else { try { resolve(JSON.parse(stdout.trim().split('\n').at(-1)!)); } catch (error) { reject(error); } } });
    });
    const first = await launch('first');
    assert.equal(first.runStatus, 'running');
    assert.equal(first.injectedWriteFailures, 1);
    const second = await launch('restart');
    const restoredRuns = await readFile(path.join(directory, 'workflow_runs.json'), 'utf8');
    const third = await launch('idempotent');
    assert.equal(second.runStatus, 'completed');
    assert.equal(new Set([first.pid, second.pid, third.pid]).size, 3);
    assert.notEqual(first.pid, second.pid);
    assert.equal(second.completedAt, third.completedAt);
    assert.deepEqual(first.artifactIds, second.artifactIds);
    assert.deepEqual(second.artifactIds, third.artifactIds);
    assert.deepEqual(first.jobIds, second.jobIds);
    assert.deepEqual(second.jobIds, third.jobIds);
    assert.equal(await readFile(path.join(directory, 'workflow_runs.json'), 'utf8'), restoredRuns);
    assert.equal(first.networkAttempts + second.networkAttempts + third.networkAttempts, 0);
    console.log('Real initializer restart acceptance: three fresh processes, projection failure survives exit and restart recovers, isolated pbStore files, actual OutputPort media, same succeeded job/artifacts/completion timestamp, zero external API attempts.');
  } finally { await x.f.cleanup(); await rm(directory, { recursive: true, force: true }); }
});
