import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalStoreLockRecovery, inspectLocalStoreOwnership, type LocalStoreUserInventory } from './localStoreLockRecovery.js';
import { assertLocalStoreWritable, LOCAL_STORE_MAINTENANCE_FENCE } from './localCollectionLock.js';

const quiet = (): LocalStoreUserInventory => ({ complete: true, scope: 'all_users', users: [], missingEvidence: [] });
function fixture(t: { after(fn: () => void): void }, inventory: () => LocalStoreUserInventory = quiet) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'local-lock-recovery-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = path.join(root, 'store'), audits = path.join(root, 'audits');fs.mkdirSync(store);
  const file = path.join(store, 'durable_operation_leases.json'), lock = `${file}.lock`;
  const original = '[{"id":"historical","lease":"preserve","cost":12,"receipt":"unknown"}]';
  fs.writeFileSync(file, original);fs.mkdirSync(lock);
  return { root, store, audits, file, lock, original, service: createLocalStoreLockRecovery({ repoRoot: root, storeRoot: store, auditRoot: audits, inventory }) };
}
test('dry run is byte-for-byte read-only, records inode/hash and never treats a caller assertion as quiescence', t => {
  const f = fixture(t, () => ({ complete: false, scope: 'insufficient', users: [{ pid: 1234, reasons: ['local_store_open_file_or_directory'] }], missingEvidence: ['cross_user_process_and_open_file_visibility_unverified'] }));
  const result = f.service.inspect();
  assert.ok(result.snapshot?.lock.inode);assert.match(result.snapshotHash!, /^[a-f0-9]{64}$/);
  assert.ok(result.refusalReasons.includes('local_recovery_cross_user_quiescence_unproven'));
  assert.ok(result.refusalReasons.includes('local_recovery_active_store_or_repository_users'));
  assert.equal(fs.existsSync(f.audits), false);assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.deepEqual(fs.readdirSync(f.lock), []);
  assert.throws(() => f.service.apply(result.snapshotHash!), /apply_refused/);
  const operation = fs.readdirSync(f.audits)[0]!;assert.ok(fs.existsSync(path.join(f.audits, operation, 'prepared.json')));assert.ok(fs.existsSync(path.join(f.audits, operation, 'failed.json')));
  assert.ok(fs.existsSync(f.lock));assert.equal(fs.existsSync(path.join(f.store, LOCAL_STORE_MAINTENANCE_FENCE)), false);
});
test('apply fences writes, rechecks all-user evidence, isolates only exact legacy lock, and preserves JSON/lease/cost bytes', t => {
  let f!: ReturnType<typeof fixture>, calls = 0;
  f = fixture(t, () => { calls++;if (calls === 3) assert.throws(() => assertLocalStoreWritable(f.store), /maintenance_active/);return quiet(); });
  const before = f.service.inspect(), result = f.service.apply(before.snapshotHash!);
  assert.equal(fs.existsSync(f.lock), false);assert.ok(fs.statSync(result.isolatedLock).isDirectory());assert.equal(fs.statSync(result.isolatedLock).ino, before.snapshot!.lock.inode);
  assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.equal(fs.existsSync(path.join(f.store, LOCAL_STORE_MAINTENANCE_FENCE)), false);
  const committed = JSON.parse(fs.readFileSync(path.join(result.auditDirectory, 'committed.json'), 'utf8'));
  assert.equal(committed.businessJsonSha256Before, committed.businessJsonSha256After);assert.equal(committed.releasesBusinessLeaseOrCost, false);assert.ok(fs.existsSync(path.join(result.auditDirectory, 'prepared.json')));
});
test('changed inode/hash or a writer appearing after the maintenance fence refuses isolation and retains prepared audit', t => {
  const f = fixture(t);const original = f.service.inspect();fs.writeFileSync(f.file, '[{"id":"changed outside tool"}]');
  assert.throws(() => f.service.apply(original.snapshotHash!), /snapshot_hash_changed/);assert.ok(fs.existsSync(f.lock));
  let calls = 0;const second = fixture(t, () => ++calls >= 3 ? { ...quiet(), users: [{ pid: 5678, reasons: ['repository_working_directory'] }] } : quiet());
  const inspection = second.service.inspect();assert.throws(() => second.service.apply(inspection.snapshotHash!), /quiescence_changed/);assert.ok(fs.existsSync(second.lock));assert.equal(fs.readFileSync(second.file, 'utf8'), second.original);
  assert.equal(fs.existsSync(path.join(second.store, LOCAL_STORE_MAINTENANCE_FENCE)), false);
});
test('a replaced maintenance owner is never released or used to isolate a lock', t => {
  let f!: ReturnType<typeof fixture>, calls = 0;
  f = fixture(t, () => { if (++calls === 3) { const file = path.join(f.store, LOCAL_STORE_MAINTENANCE_FENCE, 'owner.json'), owner = JSON.parse(fs.readFileSync(file, 'utf8'));fs.writeFileSync(file, JSON.stringify({ ...owner, token: 'replacement-token' })); }return quiet(); });
  const inspection = f.service.inspect();assert.throws(() => f.service.apply(inspection.snapshotHash!), /fence_ownership_changed/);
  assert.ok(fs.existsSync(f.lock));const owner = JSON.parse(fs.readFileSync(path.join(f.store, LOCAL_STORE_MAINTENANCE_FENCE, 'owner.json'), 'utf8'));assert.equal(owner.token, 'replacement-token');assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
});
test('verified owner-restricted inventory is accepted, but foreign write permission and symlinks cannot prove ownership', t => {
  const f = fixture(t, () => ({ complete: true, scope: 'owner_restricted', users: [], missingEvidence: [] }));
  const before = f.service.inspect();assert.deepEqual(before.refusalReasons, []);
  const result = f.service.apply(before.snapshotHash!);assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.ok(fs.existsSync(result.isolatedLock));
  fs.chmodSync(f.store, 0o777);assert.ok(inspectLocalStoreOwnership(f.store).includes('store_ownership_or_foreign_write_permission'));
  fs.chmodSync(f.store, 0o700);fs.symlinkSync(f.file, path.join(f.store, 'unexpected-link'));
  assert.ok(inspectLocalStoreOwnership(f.store).includes('store_ownership_or_foreign_write_permission'));
});
