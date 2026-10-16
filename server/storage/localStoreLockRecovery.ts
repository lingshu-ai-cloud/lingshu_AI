import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { LOCAL_STORE_MAINTENANCE_FENCE } from './localCollectionLock.js';

const collection = 'durable_operation_leases';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface LocalStoreUserInventory {
  complete: boolean;
  scope: 'all_users' | 'owner_restricted' | 'insufficient';
  users: Array<{ pid: number; reasons: string[] }>;
  missingEvidence: string[];
}
const within = (file: string, root: string) => file === root || file.startsWith(`${root}${path.sep}`);

/** Prove ordinary foreign UIDs cannot write this local store. Privileged root
 * is part of the trusted OS, not claimed to be visible to an unprivileged scan. */
export function inspectLocalStoreOwnership(storeRoot: string): string[] {
  const errors: string[] = [], uid = process.getuid?.(), checked: string[] = [];
  const visit = (file: string, recursive: boolean) => {
    const stat = fs.lstatSync(file);checked.push(file);
    if (stat.isSymbolicLink() || (stat.uid !== uid && stat.uid !== 0) || (stat.mode & 0o022)) errors.push('store_ownership_or_foreign_write_permission');
    if (recursive && stat.uid !== uid) errors.push('store_not_owned_by_current_uid');
    if (recursive && stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name), true);
  };
  try {
    if (fs.realpathSync(storeRoot) !== storeRoot) return ['store_realpath_alias'];
    visit(storeRoot, true);
    for (let parent = path.dirname(storeRoot);; parent = path.dirname(parent)) { visit(parent, false);if (parent === path.dirname(parent)) break; }
    if (process.platform === 'darwin') {
      const acl = spawnSync('/bin/ls', ['-lde', ...checked], { encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
      // Even apparently harmless ACLs are refused; do not interpret an ACL as
      // Unix mode bits or silently miss an inherited write grant.
      const entries = acl.stdout.split('\n').filter(line => /^\s*\d+:/.test(line));
      if (acl.error || acl.status !== 0 || acl.stderr?.trim() || entries.some(line => !/^\s*\d+:\s+group:everyone deny delete\s*$/.test(line))) errors.push('store_acl_absence_unverified');
    } else errors.push('store_acl_visibility_unverified_on_this_platform');
  } catch { errors.push('store_ownership_inspection_failed'); }
  return [...new Set(errors)];
}

/** Inspect OS process/open-file evidence, never provider APIs or task state.
 * Unprivileged lsof may silently omit another user's process, so it is never
 * accepted as cross-user quiescence proof, even if it reports zero matches. */
export function inspectLocalStoreUsers(repoRoot: string, storeRoot: string): LocalStoreUserInventory {
  const missingEvidence: string[] = [], users = new Map<number, Set<string>>();
  const ownerErrors = process.getuid?.() === 0 ? [] : inspectLocalStoreOwnership(storeRoot);
  missingEvidence.push(...ownerErrors);
  const ps = spawnSync('/bin/ps', ['eww', '-axo', 'pid=,uid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
  const lsof = spawnSync('lsof', ['-nP', ...(process.getuid?.() === 0 ? [] : ['-u', String(process.getuid?.())]), '-Fpcfna'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15_000 });
  const ignored = new Set([process.pid, ps.pid, lsof.pid]);
  const add = (pid: number, reason: string) => { if (ignored.has(pid)) return;const reasons = users.get(pid) ?? new Set<string>();reasons.add(reason);users.set(pid, reasons); };
  if (ps.error || ps.status !== 0 || ps.stderr?.trim()) missingEvidence.push('system_process_inventory_incomplete');
  if (lsof.error || lsof.status !== 0 || lsof.stderr?.trim()) missingEvidence.push('system_open_file_inventory_incomplete');
  const commands = new Map<number, string>();
  for (const line of (ps.stdout ?? '').split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);if (!match) continue;
    if (process.getuid?.() !== 0 && Number(match[2]) !== process.getuid?.()) continue;
    const pid = Number(match[1]), commandAndEnvironment = match[3]!;commands.set(pid, commandAndEnvironment);
    // tsx launches a Node child; exempt only the exact recovery CLI launcher,
    // never arbitrary tsx, test runners, servers or caller-provided PID lists.
    if (/(?:^|\/)node\s/.test(commandAndEnvironment.split(/\s/)[0]! + ' ') && /(?:^|\s)(?:[^\s]*\/)?scripts\/reconcile-local-store-lock\.ts(?:\s|$)/.test(commandAndEnvironment)) { ignored.add(pid);continue; }
    const reader = /(?:node_modules\/vite\/bin\/vite\.js|\/vite\/bin\/vite\.js)(?:\s|$)/.test(commandAndEnvironment);
    const executable = /(?:^|\/)(node|tsx|bun|deno|python\d*(?:\.\d+)?)$/.test(commandAndEnvironment.split(/\s/)[0]!);
    if (!reader && executable && commandAndEnvironment.includes(repoRoot)) add(pid, 'repository_executable_may_write_store');
    const configured = /(?:^|\s)LOCAL_STORE_DIR=([^\s]+)/.exec(commandAndEnvironment)?.[1];
    if (configured && (!path.isAbsolute(configured) || within(path.resolve(configured), storeRoot) || within(storeRoot, path.resolve(configured)))) add(pid, 'local_store_environment_or_unresolved_relative_path');
  }
  let pid = 0, descriptor = '';
  for (const line of (lsof.stdout ?? '').split('\n')) {
    if (line.startsWith('p')) { pid = Number(line.slice(1));descriptor = ''; }
    else if (line.startsWith('f')) descriptor = line.slice(1);
    else if (line.startsWith('n')) {
      const name = line.slice(1).replace(/ \(deleted\)$/, '');
      if (within(name, storeRoot)) add(pid, 'local_store_open_file_or_directory');
      if (descriptor === 'cwd' && within(name, repoRoot)) {
        const command = commands.get(pid) ?? '';
        if (!/(?:node_modules\/vite\/bin\/vite\.js|\/vite\/bin\/vite\.js)(?:\s|$)/.test(command) && /(?:^|\/)(node|tsx|bun|deno|python\d*(?:\.\d+)?)$/.test(command.split(/\s/)[0]!)) add(pid, 'repository_executable_working_directory');
      }
    }
  }
  return { complete: missingEvidence.length === 0, scope: missingEvidence.length ? 'insufficient' : process.getuid?.() === 0 ? 'all_users' : 'owner_restricted', users: [...users].map(([pid, reasons]) => ({ pid, reasons: [...reasons].sort() })).sort((a, b) => a.pid - b.pid), missingEvidence };
}

export function createLocalStoreLockRecovery(input: { repoRoot: string; storeRoot: string; auditRoot: string; inventory?: () => LocalStoreUserInventory }) {
  const repoRoot = path.resolve(input.repoRoot), storeRoot = path.resolve(input.storeRoot), auditRoot = path.resolve(input.auditRoot);
  const file = path.join(storeRoot, `${collection}.json`), lock = `${file}.lock`, fence = path.join(storeRoot, LOCAL_STORE_MAINTENANCE_FENCE);
  const inventory = input.inventory ?? (() => inspectLocalStoreUsers(repoRoot, storeRoot));
  function files() {
    if (fs.realpathSync(storeRoot) !== storeRoot || fs.lstatSync(file).isSymbolicLink() || fs.lstatSync(lock).isSymbolicLink()) throw Error('local_recovery_symlink_or_alias_forbidden');
    // Cross-host NFS/SMB users cannot be disproved by this machine's ps/lsof.
    // Fail closed on unknown filesystems rather than claiming global quiescence.
    const fileSystemType = fs.statfsSync(storeRoot).type;
    if (![0x1a, 0x11, 0xef53, 0x01021994, 0x58465342, 0x9123683e, 0x794c7630].includes(fileSystemType)) throw Error('local_recovery_nonlocal_or_unverified_filesystem');
    const before = fs.statSync(file), bytes = fs.readFileSync(file), after = fs.statSync(file), lockStat = fs.statSync(lock);
    if (!before.isFile() || !lockStat.isDirectory() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('local_recovery_snapshot_changed');
    const entries = fs.readdirSync(lock).sort();
    if (entries.some(name => name !== 'owner.json')) throw Error('local_recovery_unexplained_lock_entries');
    const ownerPath = path.join(lock, 'owner.json');
    if (entries.length && (!fs.lstatSync(ownerPath).isFile() || fs.lstatSync(ownerPath).isSymbolicLink())) throw Error('local_recovery_owner_not_regular_file');
    return { schema: 'local-store-lock-recovery-snapshot.v1', collection, storeRoot, fileSystemType, json: { dev: after.dev, inode: after.ino, size: after.size, mtimeMs: after.mtimeMs, sha256: digest(bytes) }, lock: { dev: lockStat.dev, inode: lockStat.ino, birthtimeMs: lockStat.birthtimeMs, entries, ownerSha256: entries.length ? digest(fs.readFileSync(ownerPath)) : null } };
  }
  function inspect() {
    let snapshot: ReturnType<typeof files> | null = null;const refusalReasons: string[] = [];
    try { snapshot = files(); } catch (error) { refusalReasons.push(error instanceof Error ? error.message : 'local_recovery_snapshot_unavailable'); }
    const currentUsers = inventory();
    if (!currentUsers.complete || currentUsers.scope === 'insufficient') refusalReasons.push(...currentUsers.missingEvidence, 'local_recovery_cross_user_quiescence_unproven');
    if (currentUsers.users.length) refusalReasons.push('local_recovery_active_store_or_repository_users');
    if (fs.existsSync(fence)) refusalReasons.push('local_recovery_existing_maintenance_fence');
    return { observedAt: new Date().toISOString(), snapshot, snapshotHash: snapshot ? digest(JSON.stringify(snapshot)) : null, inventory: currentUsers, refusalReasons: [...new Set(refusalReasons)] };
  }
  function apply(expectedSnapshotHash: string) {
    if (!/^[a-f0-9]{64}$/.test(expectedSnapshotHash)) throw Error('local_recovery_expected_snapshot_hash_required');
    const initial = inspect(), operationId = randomUUID(), token = randomUUID();
    fs.mkdirSync(auditRoot, { recursive: true });
    const operationDirectory = path.join(auditRoot, operationId);fs.mkdirSync(operationDirectory, { mode: 0o700 });
    const writeAudit = (name: string, payload: unknown) => { const p = path.join(operationDirectory, name);fs.writeFileSync(p, JSON.stringify(payload, null, 2), { flag: 'wx', mode: 0o600 });const fd = fs.openSync(p, 'r');try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }const directoryFd=fs.openSync(operationDirectory,'r');try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);} };
    writeAudit('prepared.json', { schema: 'local-store-lock-recovery.v1', operationId, actor: { uid: process.getuid?.() ?? null, pid: process.pid }, expectedSnapshotHash, inspection: initial, changesBusinessJson: false, releasesBusinessLeaseOrCost: false });
    let ownsFence = false;
    let fenceIdentity: fs.Stats | null = null;
    const assertOwnFence = () => {
      const current = fs.statSync(fence), owner = JSON.parse(fs.readFileSync(path.join(fence, 'owner.json'), 'utf8'));
      if (!fenceIdentity || current.dev !== fenceIdentity.dev || current.ino !== fenceIdentity.ino || owner.operationId !== operationId || owner.pid !== process.pid || owner.token !== token || fs.readdirSync(fence).length !== 1) throw Error('local_recovery_fence_ownership_changed');
    };
    try {
      if (initial.refusalReasons.length || initial.snapshotHash !== expectedSnapshotHash) throw Error(`local_recovery_apply_refused:${initial.refusalReasons.join(',') || 'snapshot_hash_changed'}`);
      if (fs.statSync(operationDirectory).dev !== initial.snapshot!.lock.dev) throw Error('local_recovery_atomic_isolation_cross_device_forbidden');
      fs.mkdirSync(fence);ownsFence = true;
      fenceIdentity = fs.statSync(fence);
      fs.writeFileSync(path.join(fence, 'owner.json'), JSON.stringify({ schema: 'local-store-maintenance-fence.v1', operationId, pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
      const second = inventory();
      if (!second.complete || second.scope === 'insufficient' || second.users.length) throw Error('local_recovery_quiescence_changed');
      assertOwnFence();
      const latest = files();if (digest(JSON.stringify(latest)) !== expectedSnapshotHash) throw Error('local_recovery_snapshot_changed_after_fence');
      if (fs.statSync(operationDirectory).dev !== latest.lock.dev) throw Error('local_recovery_atomic_isolation_cross_device_forbidden');
      const destination = path.join(operationDirectory, 'isolated.lock');
      assertOwnFence();
      fs.renameSync(lock, destination);
      const resultingHash = digest(fs.readFileSync(file));
      if (resultingHash !== latest.json.sha256) throw Error('local_recovery_business_json_changed_after_isolation');
      writeAudit('committed.json', { operationId, originalSnapshot: latest, isolatedLock: destination, businessJsonSha256Before: latest.json.sha256, businessJsonSha256After: resultingHash, lockRemovedByDeletion: false, releasesBusinessLeaseOrCost: false, inventory: second, committedAt: new Date().toISOString() });
      return { operationId, auditDirectory: operationDirectory, isolatedLock: destination, businessJsonSha256: resultingHash };
    } catch (error) {
      writeAudit('failed.json', { operationId, reason: error instanceof Error ? error.message : 'local_recovery_failed', failedAt: new Date().toISOString(), changesBusinessJson: false, lockMayBeIsolated: !fs.existsSync(lock) });
      throw Error(`${error instanceof Error ? error.message : 'local_recovery_failed'};audit=${operationDirectory}`);
    } finally {
      if (ownsFence) {
        try {
          assertOwnFence();
          const releasedFence = path.join(operationDirectory, 'released.maintenance-fence');fs.renameSync(fence, releasedFence);
          fs.unlinkSync(path.join(releasedFence, 'owner.json'));fs.rmdirSync(releasedFence);
        } catch { console.error('[local-store-recovery] own fence cleanup requires reconciliation', { operationId }); }
      }
    }
  }
  return { inspect, apply };
}
