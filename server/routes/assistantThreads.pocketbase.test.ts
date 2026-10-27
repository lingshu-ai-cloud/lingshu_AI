import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import express from 'express';

// Opt-in real-adapter regression: use the production PocketBase version, with
// disposable databases and actual migrations rather than a permissive mock.
test('real PocketBase preserves assistant saves, clear/delete and pending receipts', {
  skip: !process.env.PB_INTEGRATION_BINARY,
}, async () => {
  const binary = process.env.PB_INTEGRATION_BINARY!;
  const dir = await mkdtemp(path.join(tmpdir(), 'assistant-pb-'));
  const migrations = path.join(dir, 'migrations');
  await mkdir(migrations);
  for (const name of [
    '1788500322_created_assistant_threads.js',
    '1791536000_extend_assistant_thread_state.js',
    '1791536200_isolate_and_version_assistant_threads.js',
    '1791536300_create_datastore_cas_claims.js',
    '1791639999_prepare_assistant_owner_index.js',
    '1791640000_mobile_assistant_sessions.js',
    '1791640001_isolate_desktop_mobile_assistant_threads.js',
    '1792800000_extend_assistant_creation_draft.js',
    '1793059200_assistant_conversation_lifecycle.js',
    '1793062800_assistant_pending_content_binding.js',
  ]) await copyFile(path.resolve('pb_migrations', name), path.join(migrations, name));
  const flags = [`--dir=${path.join(dir, 'data')}`, `--migrationsDir=${migrations}`];
  const password = 'Disposable-PocketBase-test-427!';
  execFileSync(binary, ['superuser', 'upsert', 'test@example.test', password, ...flags]);
  const pb = spawn(binary, ['serve', '--http=127.0.0.1:18097', ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
  let pbOutput = '';
  pb.stdout.on('data', value => { pbOutput += String(value); });
  pb.stderr.on('data', value => { pbOutput += String(value); });
  const original = { PB_URL: process.env.PB_URL, PB_ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL,
    PB_ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD };
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    process.env.PB_URL = 'http://127.0.0.1:18097';
    process.env.PB_ADMIN_EMAIL = 'test@example.test';
    process.env.PB_ADMIN_PASSWORD = password;
    for (let attempt = 0; ; attempt++) {
      try { if ((await fetch(`${process.env.PB_URL}/api/health`)).ok) break; } catch {}
      if (attempt > 100) throw new Error('Disposable PocketBase failed to start: ' + pbOutput);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const { pbStore } = await import('../storage/pbStore.js');
    const { pbListStrict } = await import('../storage/pb.js');
    const { createAssistantThreadsRouter } = await import('./assistantThreads.js');
    const app = express(); app.use(express.json());
    app.use('/threads', createAssistantThreadsRouter({ dataStore: pbStore,
      authMiddleware: (_req, res, next) => {
        res.locals.tenantId = 'test-tenant'; res.locals.userId = 'test-user'; next();
      },
    }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/threads/business`;
    const request = async (method: string, body: unknown, suffix = '', status = 200) => {
      const res = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await res.json(); assert.equal(res.status, status, JSON.stringify(result)); return result;
    };
    const created = await request('PUT', { expectedVersion: 0, draftInput: 'preserve original', focusedTaskId: null });
    assert.equal(created.version, 1);
    const saved = await request('PUT', { expectedVersion: 1, draftInput: 'second save', focusedTaskId: null });
    assert.equal(saved.version, 2);
    assert.equal(saved.focusedTaskId, null);
    const binding = { intentFingerprint: 'assistant-content-intent:1234abcd',
      idempotencyKey: 'assistant-content:123456789:1234abcd', contentTaskId: null, createdAt: new Date().toISOString() };
    await request('PUT', { expectedVersion: 2, pendingContentTaskBinding: binding });
    const rows = await pbStore.list<Record<string, unknown>>('assistant_threads');
    assert.deepEqual(rows.items[0].pendingContentTaskBinding, binding);
    await request('POST', { expectedVersion: 3 }, '/clear', 409);
    await request('PUT', { expectedVersion: 3, pendingContentTaskBinding: null });
    const cleared = await request('POST', { expectedVersion: 4 }, '/clear');
    assert.equal(cleared.version, 5); assert.equal(cleared.draftInput, '');
    await request('PUT', { expectedVersion: 4, draftInput: 'stale write' }, '', 409);
    const undone = await request('POST', { expectedVersion: 5 }, '/restore');
    assert.equal(undone.draftInput, 'second save');
    assert.equal(undone.conversationResetVersion, 6);
    await request('POST', { expectedVersion: 6 }, '/clear');
    const deleted = await request('DELETE', { expectedVersion: 7 });
    assert.ok(deleted.deletedAt); assert.equal(deleted.version, 8);
    await request('PUT', { expectedVersion: 8 }, '', 410);
    const restored = await request('POST', { expectedVersion: 8 }, '/restore');
    assert.equal(restored.deletedAt, ''); assert.equal(restored.version, 9);
    await request('POST', { expectedVersion: 8 }, '/restore', 409);
    assert.equal((await pbListStrict('datastore_cas_claims')).totalItems, 0, 'Successful writes must release every claim');
    // Reproduce the pre-fix committed-but-locked state, then exercise the
    // guarded recovery against the real database, including its dry run.
    const { pbCreateStrict, pbPatchStrict } = await import('../storage/pb.js');
    const prior = await pbCreateStrict('assistant_threads', {
      tenantId: 'test-tenant', userId: 'recovery-user', source: 'desktop', agentId: 'business', version: 1,
    }) as Record<string, unknown>;
    const expected = { tenantId: prior.tenantId, userId: prior.userId, agentId: prior.agentId, version: 1 };
    const data = { ...expected, source: 'desktop', version: 2, messages: [], draftInput: 'keep this',
      scrollPosition: 0, unreadCount: 0, isFollowingLatest: true, paused: false, taskCards: {},
      focusedTaskId: null, updatedAt: new Date().toISOString() };
    const canonical = (value: unknown): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
      : value && typeof value === 'object' ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => JSON.stringify(key) + ':' + canonical(child)).join(',') + '}' : JSON.stringify(value) ?? 'null';
    const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
    await pbCreateStrict('datastore_cas_claims', { target_key: `assistant_threads:${prior.id}`,
      expected_fingerprint: hash(expected), operation_fingerprint: hash({ kind: 'compare_and_swap', expected, data }),
      owner_token: 'disposable-owner', created_at: new Date(0).toISOString(), lease_expires_at: new Date(0).toISOString() });
    await pbPatchStrict('assistant_threads', String(prior.id), data);
    await pbCreateStrict('datastore_cas_claims', { target_key: `assistant_threads:${created.id}`,
      expected_fingerprint: '0'.repeat(64), operation_fingerprint: '1'.repeat(64),
      owner_token: 'uncertain-owner', created_at: new Date(0).toISOString(), lease_expires_at: new Date(0).toISOString() });
    const beforeRecovery = await pbStore.getById('assistant_threads', String(prior.id));
    const recover = (args: string[]) => execFileSync(process.execPath,
      ['--import', 'tsx', 'scripts/recover-assistant-pb-claims.ts', ...args],
      { env: { ...process.env, RECOVERY_BACKUP_DIR: path.join(dir, 'recovery-backup') }, encoding: 'utf8' });
    assert.match(recover([]), /committed_claim_proven/);
    assert.equal((await pbListStrict('datastore_cas_claims')).totalItems, 2);
    assert.match(recover(['--apply']), /committed_claim_released/);
    assert.deepEqual(await pbStore.getById('assistant_threads', String(prior.id)), beforeRecovery);
    const remaining = await pbListStrict('datastore_cas_claims');
    assert.equal(remaining.totalItems, 1);
    assert.equal(remaining.items[0].target_key, `assistant_threads:${created.id}`, 'Unproven claims must remain fenced');
  } finally {
    await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve());
    if (pb.exitCode === null && pb.signalCode === null) {
      const exited = new Promise<void>(resolve => pb.once('exit', () => resolve()));
      pb.kill(); await exited;
    }
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
