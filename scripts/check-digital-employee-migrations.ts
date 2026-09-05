/**
 * Read-only release guard. Never connects to PocketBase or changes migration
 * history. A passing result is only a repository check, not an upgrade rehearsal.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIGITAL_EMPLOYEE_MIGRATIONS = [
  '1788307200_create_digital_employee_mvp.js',
  '1788393600_expand_digital_employee_business_workflows.js',
  '1788480000_connect_followup_dispatch_worker.js',
  '1788825600_version_digital_employee_configuration.js',
  '1788912600_create_content_batch_plans.js',
] as const;

type BlockerCode = 'missing_migration' | 'uncommitted_migration' | 'historical_content_conflict' | 'incomplete_git_history';
export interface MigrationReleaseBlocker {
  code: BlockerCode;
  path?: string;
  currentSha256?: string;
  historicalVersions?: Array<{ commit: string; sha256: string }>;
  message: string;
}

export interface MigrationReleaseReport {
  status: 'passed' | 'blocked';
  scope: 'read_only_repository_preflight';
  head: string;
  checkedMigrations: number;
  blockers: MigrationReleaseBlocker[];
  limitations: string[];
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function checkDigitalEmployeeMigrations(root: string): MigrationReleaseReport {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const blockers: MigrationReleaseBlocker[] = [];
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    blockers.push({ code: 'incomplete_git_history', message: 'Shallow Git history cannot establish migration immutability; inspect the full release history before publishing.' });
  }

  // Include every pending migration, not just this feature's five files: all
  // files in pb_migrations are mounted into PocketBase by docker-compose.yml.
  const changedPaths = new Set([
    ...git(root, ['diff', '--name-only', '-z', 'HEAD', '--', 'pb_migrations']).split('\0'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'pb_migrations']).split('\0'),
  ].filter(value => value.endsWith('.js')));
  for (const migrationPath of [...changedPaths].sort()) {
    blockers.push({
      code: 'uncommitted_migration', path: migrationPath,
      message: 'The release migration set is not an immutable committed snapshot; review this file before creating the release artifact.',
    });
  }

  for (const name of DIGITAL_EMPLOYEE_MIGRATIONS) {
    const migrationPath = `pb_migrations/${name}`;
    const absolutePath = path.join(root, migrationPath);
    if (!fs.existsSync(absolutePath)) {
      blockers.push({ code: 'missing_migration', path: migrationPath, message: 'A required Digital Employee migration is missing.' });
      continue;
    }
    const currentSha256 = sha256(fs.readFileSync(absolutePath, 'utf8'));
    // --all deliberately includes local branches and cached remote refs. A file
    // untracked on this branch may already be committed under the same name on
    // a different release branch; checking only HEAD misses this collision.
    const commits = git(root, ['log', '--all', '--format=%H', '--', migrationPath]).trim().split('\n').filter(Boolean);
    const historicalVersions = new Map<string, { commit: string; sha256: string }>();
    for (const commit of commits) {
      const exists = git(root, ['ls-tree', '--name-only', commit, '--', migrationPath]).trim();
      if (!exists) continue; // A deletion commit does not contain the file.
      const fingerprint = sha256(git(root, ['show', `${commit}:${migrationPath}`]));
      if (fingerprint !== currentSha256 && !historicalVersions.has(fingerprint)) {
        historicalVersions.set(fingerprint, { commit, sha256: fingerprint });
      }
    }
    if (historicalVersions.size) {
      blockers.push({
        code: 'historical_content_conflict', path: migrationPath, currentSha256,
        historicalVersions: [...historicalVersions.values()],
        message: 'The same migration filename has different content in known Git history. Reconcile the deployed baseline and add a new forward-only migration; do not overwrite or mark old migrations applied to bypass this check.',
      });
    }
  }

  return {
    status: blockers.length ? 'blocked' : 'passed', scope: 'read_only_repository_preflight', head,
    checkedMigrations: DIGITAL_EMPLOYEE_MIGRATIONS.length, blockers,
    limitations: [
      'Only locally available Git history was inspected; cached remote refs do not prove what has been deployed.',
      'No PocketBase process, database, deployment workflow, or remote host was accessed or changed.',
      'Before release, separately rehearse fresh installation and upgrade from a backup of the exact target schema with the real PocketBase version, including a setup-pb-first baseline.',
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
