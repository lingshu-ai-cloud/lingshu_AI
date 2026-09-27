/**
 * Read-only PocketBase migration integrity guard.
 *
 * The worktree manifest locks every migration byte-for-byte. A baseline
 * manifest (HEAD locally, the PR/push base in CI) makes existing entries
 * append-only: changing a migration and its checksum together is still
 * rejected. New entries may be declared while they are untracked during
 * development and become immutable as soon as that manifest lands.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATION_CHECKSUM_MANIFEST = 'scripts/pb-migration-checksums.json';

// Exact, reviewed repairs for PocketBase 0.39.5 compatibility. The original
// rule expression is rejected even on fresh installs; these hashes permit only
// replacing it with PocketBase's locked (superuser-only) null rule and making
// initial zero budget/spend and empty evidence valid. Existing installations are repaired
// by 1790985601_lock_social_operating_rules.js.
const APPROVED_COMPATIBILITY_REPAIRS: Record<string, { from: string; to: string }> = {
  '1790899200_create_social_weekly_reviews.js': {
    from: '1806d2a05adcadbf5e043169509abc1602aae6ae11d9e3b15ab07c09b85d0a99',
    to: 'c931ba098ac2b421eee9e68b4b7d1887080fdea1455b46fac6d3d9c827f0035d',
  },
  '1790985600_create_social_operating_evidence.js': {
    from: '17d77979799b7924748962b37e7222be19daa841dbe3b57deb8cb59b367628f7',
    to: 'a2227a71afa8c7ed82ce8fb75cb44a89d3d1892759ec6a07a6a4433a28819a65',
  },
};

type BlockerCode =
  | 'missing_manifest'
  | 'invalid_manifest'
  | 'missing_migration'
  | 'invalid_migration_file'
  | 'unregistered_migration'
  | 'checksum_mismatch'
  | 'immutable_manifest_conflict'
  | 'incomplete_git_history';

export interface MigrationReleaseBlocker {
  code: BlockerCode;
  path?: string;
  expectedSha256?: string;
  currentSha256?: string;
  baselineCommit?: string;
  message: string;
}

export interface MigrationChecksumManifest {
  version: 1;
  algorithm: 'sha256';
  migrations: Record<string, string>;
}

export interface MigrationReleaseReport {
  status: 'passed' | 'blocked';
  scope: 'read_only_repository_preflight';
  head: string;
  baselineRef: string;
  baselineCommit: string | null;
  checkedMigrations: number;
  blockers: MigrationReleaseBlocker[];
  limitations: string[];
}

export interface MigrationReleaseCheckOptions {
  /** Defaults to MIGRATION_BASE_REF, then HEAD for local worktree checks. */
  baselineRef?: string;
}

function gitRaw(root: string, args: string[]): Buffer {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function gitText(root: string, args: string[]): string {
  return gitRaw(root, args).toString('utf8');
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseManifest(value: Buffer | string, source: string): MigrationChecksumManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.algorithm !== 'sha256' || !isRecord(parsed.migrations)) {
    throw new Error(`${source} must use manifest version 1 with algorithm sha256 and a migrations object`);
  }

  const migrations: Record<string, string> = {};
  const names = Object.keys(parsed.migrations);
  if (names.join('\0') !== [...names].sort().join('\0')) {
    throw new Error(`${source} migration keys must be sorted lexicographically`);
  }
  for (const name of names) {
    const fingerprint = parsed.migrations[name];
    if (!/^\d+_[A-Za-z0-9][A-Za-z0-9_.-]*\.js$/.test(name)) {
      throw new Error(`${source} contains an invalid migration filename: ${name}`);
    }
    if (typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error(`${source} contains an invalid sha256 for ${name}`);
    }
    migrations[name] = fingerprint;
  }
  if (!names.length) throw new Error(`${source} must contain at least one migration`);
  return { version: 1, algorithm: 'sha256', migrations };
}

function migrationNamesOnDisk(root: string): string[] {
  const directory = path.join(root, 'pb_migrations');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.name.endsWith('.js'))
    .map(entry => entry.name)
    .sort();
}

function trackedMigrationNames(root: string): string[] {
  return gitText(root, ['ls-files', '-z', '--', 'pb_migrations'])
    .split('\0')
    .filter(value => value.startsWith('pb_migrations/') && value.endsWith('.js'))
    .map(value => value.slice('pb_migrations/'.length))
    .sort();
}

function pushOnce(blockers: MigrationReleaseBlocker[], blocker: MigrationReleaseBlocker): void {
  if (!blockers.some(item => item.code === blocker.code && item.path === blocker.path && item.message === blocker.message)) {
    blockers.push(blocker);
  }
}

function loadPreManifestBaseline(
  root: string,
  commit: string,
  blockers: MigrationReleaseBlocker[],
): MigrationChecksumManifest | null {
  let migrationPaths: string[];
  try {
    migrationPaths = gitText(root, ['ls-tree', '-r', '--name-only', '-z', commit, '--', 'pb_migrations'])
      .split('\0')
      .filter(value => /^pb_migrations\/[^/]+\.js$/.test(value))
      .sort();
  } catch {
    blockers.push({
      code: 'incomplete_git_history',
      baselineCommit: commit,
      message: `Git could not enumerate baseline migrations at ${commit}; partial or damaged history must not pass migration validation.`,
    });
    return null;
  }

  const migrations: Record<string, string> = {};
  let complete = true;
  for (const migrationPath of migrationPaths) {
    try {
      migrations[migrationPath.slice('pb_migrations/'.length)] = sha256(gitRaw(root, ['show', `${commit}:${migrationPath}`]));
    } catch {
      complete = false;
      blockers.push({
        code: 'incomplete_git_history',
        path: migrationPath,
        baselineCommit: commit,
        message: `The baseline migration blob at ${commit} is unavailable; partial-clone blob failures are release blockers.`,
      });
    }
  }
  return complete ? { version: 1, algorithm: 'sha256', migrations } : null;
}

function loadBaselineManifest(
  root: string,
  baselineRef: string,
  blockers: MigrationReleaseBlocker[],
): { commit: string | null; manifest: MigrationChecksumManifest | null } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}^~:+-]*$/.test(baselineRef)) {
    blockers.push({
      code: 'incomplete_git_history',
      message: `Migration baseline ref is invalid: ${baselineRef}`,
    });
    return { commit: null, manifest: null };
  }

  let commit: string;
  try {
    commit = gitText(root, ['rev-parse', '--verify', `${baselineRef}^{commit}`]).trim();
  } catch {
    blockers.push({
      code: 'incomplete_git_history',
      message: `Migration baseline ref cannot be resolved locally: ${baselineRef}`,
    });
    return { commit: null, manifest: null };
  }

  let manifestPath: string;
  try {
    manifestPath = gitText(root, ['ls-tree', '--name-only', commit, '--', MIGRATION_CHECKSUM_MANIFEST]).trim();
  } catch {
    blockers.push({
      code: 'incomplete_git_history',
      baselineCommit: commit,
      message: `Git could not read the baseline tree at ${commit}; partial or damaged history must not pass migration validation.`,
    });
    return { commit, manifest: null };
  }

  // During the one-time manifest rollout, use every migration blob in the
  // baseline tree as the trust root. This prevents the initial manifest from
  // blessing a simultaneous rewrite of an already tracked migration.
  if (manifestPath !== MIGRATION_CHECKSUM_MANIFEST) {
    return { commit, manifest: loadPreManifestBaseline(root, commit, blockers) };
  }

  let rawManifest: Buffer;
  try {
    rawManifest = gitRaw(root, ['show', `${commit}:${MIGRATION_CHECKSUM_MANIFEST}`]);
  } catch {
    blockers.push({
      code: 'incomplete_git_history',
      path: MIGRATION_CHECKSUM_MANIFEST,
      baselineCommit: commit,
      message: `The baseline manifest blob at ${commit} is unavailable; partial-clone blob failures are release blockers.`,
    });
    return { commit, manifest: null };
  }

  try {
    return { commit, manifest: parseManifest(rawManifest, `${commit}:${MIGRATION_CHECKSUM_MANIFEST}`) };
  } catch (error) {
    blockers.push({
      code: 'incomplete_git_history',
      path: MIGRATION_CHECKSUM_MANIFEST,
      baselineCommit: commit,
      message: `The baseline migration manifest cannot be trusted: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { commit, manifest: null };
  }
}

export function checkDigitalEmployeeMigrations(
  root: string,
  options: MigrationReleaseCheckOptions = {},
): MigrationReleaseReport {
  const head = gitText(root, ['rev-parse', 'HEAD']).trim();
  const baselineRef = String(options.baselineRef ?? process.env.MIGRATION_BASE_REF ?? 'HEAD').trim() || 'HEAD';
  const blockers: MigrationReleaseBlocker[] = [];

  const manifestPath = path.join(root, MIGRATION_CHECKSUM_MANIFEST);
  let manifest: MigrationChecksumManifest | null = null;
  if (!fs.existsSync(manifestPath)) {
    blockers.push({ code: 'missing_manifest', path: MIGRATION_CHECKSUM_MANIFEST, message: 'The PocketBase migration checksum manifest is missing.' });
  } else {
    try {
      manifest = parseManifest(fs.readFileSync(manifestPath), MIGRATION_CHECKSUM_MANIFEST);
    } catch (error) {
      blockers.push({
        code: 'invalid_manifest',
        path: MIGRATION_CHECKSUM_MANIFEST,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const baseline = loadBaselineManifest(root, baselineRef, blockers);
  if (manifest) {
    let trackedNames: string[] = [];
    try {
      trackedNames = trackedMigrationNames(root);
    } catch {
      blockers.push({
        code: 'incomplete_git_history',
        message: 'Git could not enumerate tracked PocketBase migrations.',
      });
    }

    const currentNames = migrationNamesOnDisk(root);
    const registeredNames = Object.keys(manifest.migrations);
    for (const name of [...new Set([...trackedNames, ...currentNames])].sort()) {
      if (!(name in manifest.migrations)) {
        pushOnce(blockers, {
          code: 'unregistered_migration',
          path: `pb_migrations/${name}`,
          message: 'Every tracked or on-disk PocketBase migration must be registered in the checksum manifest.',
        });
      }
    }

    for (const name of registeredNames) {
      const migrationPath = `pb_migrations/${name}`;
      const absolutePath = path.join(root, migrationPath);
      if (!fs.existsSync(absolutePath)) {
        blockers.push({ code: 'missing_migration', path: migrationPath, message: 'A migration registered in the checksum manifest is missing.' });
        continue;
      }
      const stat = fs.lstatSync(absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        blockers.push({ code: 'invalid_migration_file', path: migrationPath, message: 'Registered migrations must be regular files, not links or directories.' });
        continue;
      }
      const currentSha256 = sha256(fs.readFileSync(absolutePath));
      const expectedSha256 = manifest.migrations[name];
      if (currentSha256 !== expectedSha256) {
        blockers.push({
          code: 'checksum_mismatch',
          path: migrationPath,
          expectedSha256,
          currentSha256,
          message: 'Migration bytes differ from the reviewed checksum manifest; add a new forward-only migration instead of editing this file.',
        });
      }
    }

    if (baseline.manifest) {
      for (const [name, baselineSha256] of Object.entries(baseline.manifest.migrations)) {
        const currentSha256 = manifest.migrations[name];
        const repair = APPROVED_COMPATIBILITY_REPAIRS[name];
        const exactApprovedRepair = repair?.from === baselineSha256 && repair.to === currentSha256;
        if (currentSha256 !== baselineSha256 && !exactApprovedRepair) {
          blockers.push({
            code: 'immutable_manifest_conflict',
            path: `pb_migrations/${name}`,
            expectedSha256: baselineSha256,
            currentSha256,
            baselineCommit: baseline.commit || undefined,
            message: 'An entry already present in the baseline manifest was removed or changed; create a new migration and append its checksum instead.',
          });
        }
      }
    }
  }

  return {
    status: blockers.length ? 'blocked' : 'passed',
    scope: 'read_only_repository_preflight',
    head,
    baselineRef,
    baselineCommit: baseline.commit,
    checkedMigrations: manifest ? Object.keys(manifest.migrations).length : 0,
    blockers,
    limitations: [
      'This check proves repository file integrity against the reviewed manifest; it does not prove which migrations have been deployed.',
      'No PocketBase process, database, deployment workflow, or remote host was accessed or changed.',
      'Before release, separately rehearse fresh installation and upgrade from a backup of the exact target schema with the real PocketBase version.',
      'This check does not establish schema compatibility, data preservation, deployment authorization, or full release readiness.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = checkDigitalEmployeeMigrations(process.cwd());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== 'passed') process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`Migration release preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
