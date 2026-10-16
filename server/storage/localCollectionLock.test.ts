import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { acquireLocalCollectionFileLock, LOCAL_STORE_MAINTENANCE_FENCE, withLocalCollectionFileLock } from './localCollectionLock.js';

function fixture(t: { after(fn: () => void): void }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'local-owner-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'ledger.json');
}
test('owner proof is recorded; release is idempotent and cannot remove another owner', async t => {
  const file = fixture(t), release = await acquireLocalCollectionFileLock(file);
  const ownerFile = `${file}.lock/owner.json`, owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  assert.equal(owner.pid, process.pid);assert.equal(owner.schema, 'local-collection-lock.v1');assert.ok(owner.processInstanceId);assert.ok(owner.token);
  release();release();assert.equal(fs.existsSync(`${file}.lock`), false);
  const wrongRelease = await acquireLocalCollectionFileLock(file);
  const replacement = { ...JSON.parse(fs.readFileSync(ownerFile, 'utf8')), token: 'another-owner-token' };
  fs.writeFileSync(ownerFile, JSON.stringify(replacement));
  assert.throws(wrongRelease, /ownership_changed_reconciliation_required/);
  assert.deepEqual(JSON.parse(fs.readFileSync(ownerFile, 'utf8')), replacement);
});
test('legacy ownerless lock blocks only the writer; health/event-loop remains responsive and no lock or ledger is stolen', async t => {
  const file = fixture(t);fs.writeFileSync(file, '[{"id":"history","cost":12,"receipt":"unknown"}]');fs.mkdirSync(`${file}.lock`);
  const before = fs.readFileSync(file, 'utf8');let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 5);t.after(() => clearInterval(timer));
  const server = createServer((_q, r) => { r.end('healthy'); });server.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));t.after(() => { server.close(); });
  const address = server.address();assert.ok(address && typeof address === 'object');
  const failure = assert.rejects(acquireLocalCollectionFileLock(file, { timeoutMs: 120 }), /lock_busy_reconciliation_required/);
  const response = await fetch(`http://127.0.0.1:${address.port}/health`, { signal: AbortSignal.timeout(1000) });
  assert.equal(await response.text(), 'healthy');await failure;
  assert.ok(ticks >= 3, 'contention must yield rather than Atomics.wait on the main thread');
  assert.equal(fs.readFileSync(file, 'utf8'), before);assert.deepEqual(fs.readdirSync(`${file}.lock`), []);
});
test('independent process crash leaves its owner proof and is not automatically reclaimed by PID or clock', async t => {
  const file = fixture(t), module = new URL('./localCollectionLock.ts', import.meta.url).href;
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', `const {acquireLocalCollectionFileLock}=await import(${JSON.stringify(module)});await acquireLocalCollectionFileLock(${JSON.stringify(file)});console.log(process.pid);process.exit(0);`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';child.stdout.on('data', c => { stdout += c; });child.stderr.on('data', c => { stderr += c; });child.once('error', reject);child.once('exit', code => code === 0 ? resolve(stdout) : reject(Error(stderr)));
  });
  const ownerFile = `${file}.lock/owner.json`, before = fs.readFileSync(ownerFile, 'utf8');
  assert.equal(JSON.parse(before).pid, Number(output.trim()));
  await assert.rejects(acquireLocalCollectionFileLock(file, { timeoutMs: 40 }), /lock_busy_reconciliation_required/);
  assert.equal(fs.readFileSync(ownerFile, 'utf8'), before);
});
test('maintenance fence rejects acquisition and a fence appearing before the critical section prevents business work', async t => {
  const file = fixture(t), fence = path.join(path.dirname(file), LOCAL_STORE_MAINTENANCE_FENCE);
  fs.mkdirSync(fence);await assert.rejects(acquireLocalCollectionFileLock(file), /maintenance_active/);fs.rmdirSync(fence);
  let writes = 0;const pending = withLocalCollectionFileLock(file, () => { writes++; });
  fs.mkdirSync(fence);await assert.rejects(pending, /maintenance_active/);assert.equal(writes, 0);assert.equal(fs.existsSync(`${file}.lock`), false);
});
