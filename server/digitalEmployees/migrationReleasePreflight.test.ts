import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDigitalEmployeeMigrations, DIGITAL_EMPLOYEE_MIGRATIONS } from '../../scripts/check-digital-employee-migrations.js';

// These fixtures exercise the repository guard only. They never import the
// application, execute a migration, open PocketBase, or read business data.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-migration-release-test-'));
function git(...args: string[]): string {
  return execFileSync('git', ['-C', fixture, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Migration Test', '-c', 'user.email=migration-test@example.invalid', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
  });
}
function commit(message: string): void {
  git('add', '.');
  git('commit', '-m', message);
}

try {
  git('init', '-b', 'fixture-main');
  const migrationDir = path.join(fixture, 'pb_migrations');
  fs.mkdirSync(migrationDir);
  for (const name of DIGITAL_EMPLOYEE_MIGRATIONS) {
    fs.writeFileSync(path.join(migrationDir, name), `// immutable fixture: ${name}\n`);
  }
  commit('Initial fixture migrations');
  const originalHead = git('rev-parse', 'HEAD').trim();
  const clean = checkDigitalEmployeeMigrations(fixture);
  assert.equal(clean.status, 'passed');
  assert.equal(clean.scope, 'read_only_repository_preflight');
  assert.equal(clean.checkedMigrations, DIGITAL_EMPLOYEE_MIGRATIONS.length);
  assert.match(clean.limitations.join(' '), /real PocketBase/);
  assert.match(clean.limitations.join(' '), /does not establish schema compatibility/);

  const collisionPath = `pb_migrations/${DIGITAL_EMPLOYEE_MIGRATIONS[0]}`;
  const original = fs.readFileSync(path.join(fixture, collisionPath), 'utf8');
  fs.writeFileSync(path.join(fixture, collisionPath), `${original}// competing release branch schema\n`);
  const modified = checkDigitalEmployeeMigrations(fixture);
  assert.ok(modified.blockers.some(item => item.code === 'uncommitted_migration' && item.path === collisionPath));
  assert.ok(modified.blockers.some(item => item.code === 'historical_content_conflict' && item.path === collisionPath));

  // Persist the competing version on another branch, then return to the
  // original branch. --all must still see the collision even with a clean tree.
  git('checkout', '-b', 'fixture-competing-release');
  commit('Competing filename on another branch');
  const competingHead = git('rev-parse', 'HEAD').trim();
  git('checkout', 'fixture-main');
  const branchCollision = checkDigitalEmployeeMigrations(fixture);
  const conflict = branchCollision.blockers.find(item => item.code === 'historical_content_conflict');
  assert.ok(conflict);
  assert.equal(conflict.path, collisionPath);
  assert.equal(conflict.historicalVersions?.[0].commit, competingHead);
  assert.match(conflict.historicalVersions?.[0].sha256 || '', /^[a-f0-9]{64}$/);
  assert.ok(!branchCollision.blockers.some(item => item.code === 'uncommitted_migration'));
  assert.equal(git('rev-parse', 'HEAD').trim(), originalHead, 'preflight must not change the checkout');
  assert.equal(git('status', '--porcelain'), '', 'preflight must not modify files or Git state');

  const generated = 'pb_migrations/1788500322_created_unreviewed_fixture.js';
  fs.writeFileSync(path.join(fixture, generated), '// unreviewed generated migration\n');
  const pending = checkDigitalEmployeeMigrations(fixture);
  assert.ok(pending.blockers.some(item => item.code === 'uncommitted_migration' && item.path === generated));

  // Removing a required migration is represented by renaming only a disposable
  // fixture; production migrations and user files are never touched.
  const missingPath = path.join(migrationDir, DIGITAL_EMPLOYEE_MIGRATIONS[4]);
  fs.renameSync(missingPath, `${missingPath}.fixture-backup`);
  const missing = checkDigitalEmployeeMigrations(fixture);
  assert.ok(missing.blockers.some(item => item.code === 'missing_migration' && item.path?.endsWith(DIGITAL_EMPLOYEE_MIGRATIONS[4])));
  assert.equal(missing.status, 'blocked');

  console.log('Digital Employee migration release preflight tests passed (isolated Git fixtures; not PocketBase upgrade tests)');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
