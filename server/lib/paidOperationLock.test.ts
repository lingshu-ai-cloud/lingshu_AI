import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withPaidOperationLock } from './paidOperationLock.js';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('independent callers share an exclusive disk lock; errors release it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-lock-test-'));
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  try {
    const first = withPaidOperationLock(root, 'tenant:request', () => wait);
    await assert.rejects(withPaidOperationLock(root, 'tenant:request', async () => assert.fail('duplicate call')), /任务正在处理/);
    assert.equal(await withPaidOperationLock(root, 'different', async () => 1), 1);
    release(); await first;
    await assert.rejects(withPaidOperationLock(root, 'tenant:request', async () => { throw new Error('network'); }), /network/);
    assert.equal(await withPaidOperationLock(root, 'tenant:request', async () => 2), 2);
    assert.equal(fs.readdirSync(root).length, 0);
  } finally { release(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('orphaned locks never expire automatically and never call the supplier', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-orphan-test-'));
  try {
    let release!: () => void;
    const first = withPaidOperationLock(root, 'key', () => new Promise<void>(resolve => { release = resolve; }));
    const file = path.join(root, fs.readdirSync(root)[0]);
    fs.writeFileSync(file, JSON.stringify({ owner: 'orphan', createdAt: '2000-01-01' }));
    release(); await first;
    await assert.rejects(withPaidOperationLock(root, 'key', async () => assert.fail('paid call')), /任务正在处理/);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).owner, 'orphan');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('another OS process is excluded and a killed worker leaves a fail-closed lock', { timeout: 10000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-process-test-'));
  const child = fork(fileURLToPath(new URL('../../tests/paid-lock-worker.ts', import.meta.url)), [root], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    const [message] = await once(child, 'message');
    assert.equal(message, 'locked');
    await assert.rejects(withPaidOperationLock(root, 'cross-process', async () => assert.fail('duplicate')), /任务正在处理/);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    await assert.rejects(withPaidOperationLock(root, 'cross-process', async () => assert.fail('crash retry')), /异常中断/);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); fs.rmSync(root, { recursive: true, force: true }); }
});
