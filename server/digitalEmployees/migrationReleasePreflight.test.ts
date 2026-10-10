import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkDigitalEmployeeMigrations,
  MIGRATION_CHECKSUM_MANIFEST,
  type MigrationChecksumManifest,
} from '../../scripts/check-digital-employee-migrations.js';

// These fixtures exercise the repository guard only. They never import the
// application, execute a migration, open PocketBase, or read business data.
const fixtures: string[] = [];

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-migration-release-test-'));
  fixtures.push(root);
  git(root, 'init', '-b', 'fixture-main');
  fs.mkdirSync(path.join(root, 'pb_migrations'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  return root;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', [
    '-C', root,
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgSign=false',
    '-c', 'user.name=Migration Test',
    '-c', 'user.email=migration-test@example.invalid',
    ...args,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
}

function commit(root: string, message: string): string {
  git(root, 'add', '.');
  git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD').trim();
}

function checksum(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function migrationPath(root: string, name: string): string {
  return path.join(root, 'pb_migrations', name);
}

function writeManifest(root: string, migrations: Record<string, string>): void {
  const manifest: MigrationChecksumManifest = {
    version: 1,
    algorithm: 'sha256',
    migrations: Object.fromEntries(Object.entries(migrations).sort(([left], [right]) => left.localeCompare(right))),
  };
  fs.writeFileSync(path.join(root, MIGRATION_CHECKSUM_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
}

try {
  const fixture = createFixture();
  const legacyName = '1788999000_create_review_todo_boards.js';
  const starterName = '1789689600_update_starter198_cancelling_active_run_guard.js';
  const legacyContent = `// immutable fixture: ${legacyName}\n`;
  const starterContent = `// immutable fixture: ${starterName}\n`;
  fs.writeFileSync(migrationPath(fixture, legacyName), legacyContent);
  fs.writeFileSync(migrationPath(fixture, starterName), starterContent);
  writeManifest(fixture, {
    [legacyName]: checksum(legacyContent),
    [starterName]: checksum(starterContent),
  });
  const baselineHead = commit(fixture, 'Initial migration checksum baseline');

  const clean = checkDigitalEmployeeMigrations(fixture, { baselineRef: baselineHead });
  assert.equal(clean.status, 'passed');
  assert.equal(clean.scope, 'read_only_repository_preflight');
  assert.equal(clean.checkedMigrations, 2);
  assert.equal(clean.baselineCommit, baselineHead);
  assert.match(clean.limitations.join(' '), /does not establish schema compatibility/);

  // A new Starter migration is protected like every older migration. Changing
  // its bytes without changing the manifest must fail immediately.
  const changedStarter = `${starterContent}// tampered starter schema\n`;
  fs.writeFileSync(migrationPath(fixture, starterName), changedStarter);
  const starterTampered = checkDigitalEmployeeMigrations(fixture, { baselineRef: baselineHead });
  assert.ok(starterTampered.blockers.some(item => (
    item.code === 'checksum_mismatch' && item.path === `pb_migrations/${starterName}`
  )));

  // Updating both migration and worktree checksum cannot bypass a baseline
  // that already contains the migration.
  writeManifest(fixture, {
    [legacyName]: checksum(legacyContent),
    [starterName]: checksum(changedStarter),
  });
  const checksumRewritten = checkDigitalEmployeeMigrations(fixture, { baselineRef: baselineHead });
  assert.ok(checksumRewritten.blockers.some(item => (
    item.code === 'immutable_manifest_conflict' && item.path === `pb_migrations/${starterName}`
  )));

  fs.writeFileSync(migrationPath(fixture, starterName), starterContent);
  writeManifest(fixture, {
    [legacyName]: checksum(legacyContent),
    [starterName]: checksum(starterContent),
  });

  const undeclaredName = '1789776000_create_undeclared_fixture.js';
  fs.writeFileSync(migrationPath(fixture, undeclaredName), '// undeclared migration\n');
  const undeclared = checkDigitalEmployeeMigrations(fixture, { baselineRef: baselineHead });
  assert.ok(undeclared.blockers.some(item => (
    item.code === 'unregistered_migration' && item.path === `pb_migrations/${undeclaredName}`
  )));
  fs.rmSync(migrationPath(fixture, undeclaredName));

  fs.renameSync(migrationPath(fixture, starterName), `${migrationPath(fixture, starterName)}.fixture-backup`);
  const missing = checkDigitalEmployeeMigrations(fixture, { baselineRef: baselineHead });
  assert.ok(missing.blockers.some(item => (
    item.code === 'missing_migration' && item.path === `pb_migrations/${starterName}`
  )));
  fs.renameSync(`${migrationPath(fixture, starterName)}.fixture-backup`, migrationPath(fixture, starterName));

  // Development branches may append a manifest entry before the new migration
  // is staged. It becomes immutable after its baseline commit lands.
  const appendedName = '1789776001_create_starter198_append_only_fixture.js';
  const appendedContent = `// new forward-only fixture: ${appendedName}\n`;
  fs.writeFileSync(migrationPath(fixture, appendedName), appendedContent);
  writeManifest(fixture, {
    [legacyName]: checksum(legacyContent),
    [starterName]: checksum(starterContent),
    [appendedName]: checksum(appendedContent),
  });
  const untrackedAppend = checkDigitalEmployeeMigrations(fixture, { baselineRef: baselineHead });
  assert.equal(untrackedAppend.status, 'passed', 'a declared new migration may be untracked during branch development');

  const appendedBaseline = commit(fixture, 'Append forward-only Starter migration');
  const changedAppend = `${appendedContent}// rewritten after merge\n`;
  fs.writeFileSync(migrationPath(fixture, appendedName), changedAppend);
  writeManifest(fixture, {
    [legacyName]: checksum(legacyContent),
    [starterName]: checksum(starterContent),
    [appendedName]: checksum(changedAppend),
  });
  commit(fixture, 'Attempt to rewrite locked Starter migration');
  const postMergeRewrite = checkDigitalEmployeeMigrations(fixture, { baselineRef: appendedBaseline });
  assert.ok(postMergeRewrite.blockers.some(item => (
    item.code === 'immutable_manifest_conflict' && item.path === `pb_migrations/${appendedName}`
  )));

  // The one reviewed manifest-defect correction cannot be transplanted into
  // another repository. Even the exact filename and exact from/to hashes stay
  // blocked unless Git contains the pinned historical introduction commit.
  const transplantedFixture = createFixture();
  const correctedName = '1791072008_create_content_execution_queue.js';
  const correctedContent = fs.readFileSync(path.join(process.cwd(), 'pb_migrations', correctedName), 'utf8');
  const erroneousChecksum = '17082ecdb5a6228182507d1d2a01f55c6aac48922cd376c489fecce8c8fb2f07';
  fs.writeFileSync(migrationPath(transplantedFixture, correctedName), correctedContent);
  writeManifest(transplantedFixture, { [correctedName]: erroneousChecksum });
  const transplantedBaseline = commit(transplantedFixture, 'Transplanted manifest defect fixture');
  writeManifest(transplantedFixture, { [correctedName]: checksum(correctedContent) });
  const transplantedCorrection = checkDigitalEmployeeMigrations(transplantedFixture, { baselineRef: transplantedBaseline });
  assert.ok(transplantedCorrection.blockers.some(item => (
    item.code === 'immutable_manifest_conflict' && item.path === `pb_migrations/${correctedName}`
  )), 'the reviewed correction must fail closed outside its pinned Git provenance');

  // The first manifest rollout uses tracked baseline migration blobs as its
  // trust root; changing an old migration and the new manifest together fails.
  const partialFixture = createFixture();
  const partialContent = '// blob availability fixture\n';
  fs.writeFileSync(migrationPath(partialFixture, starterName), partialContent);
  const partialHead = commit(partialFixture, 'Pre-manifest migration baseline');
  writeManifest(partialFixture, { [starterName]: checksum(partialContent) });
  const bootstrapClean = checkDigitalEmployeeMigrations(partialFixture, { baselineRef: partialHead });
  assert.equal(bootstrapClean.status, 'passed');

  const rewrittenPartialContent = `${partialContent}// rewritten during manifest rollout\n`;
  fs.writeFileSync(migrationPath(partialFixture, starterName), rewrittenPartialContent);
  writeManifest(partialFixture, { [starterName]: checksum(rewrittenPartialContent) });
  const bootstrapRewrite = checkDigitalEmployeeMigrations(partialFixture, { baselineRef: partialHead });
  assert.ok(bootstrapRewrite.blockers.some(item => (
    item.code === 'immutable_manifest_conflict' && item.path === `pb_migrations/${starterName}`
  )));

  // Missing partial-clone blobs are blockers, not an implicit bootstrap pass.
  fs.writeFileSync(migrationPath(partialFixture, starterName), partialContent);
  writeManifest(partialFixture, { [starterName]: checksum(partialContent) });
  const migrationBlob = git(partialFixture, 'rev-parse', `${partialHead}:pb_migrations/${starterName}`).trim();
  const objectPath = path.join(partialFixture, '.git', 'objects', migrationBlob.slice(0, 2), migrationBlob.slice(2));
  assert.equal(fs.existsSync(objectPath), true, 'fixture migration should be a loose object');
  fs.renameSync(objectPath, `${objectPath}.missing-fixture`);
  const missingBlob = checkDigitalEmployeeMigrations(partialFixture, { baselineRef: partialHead });
  assert.ok(missingBlob.blockers.some(item => (
    item.code === 'incomplete_git_history' && item.path === `pb_migrations/${starterName}`
  )));
  assert.equal(missingBlob.status, 'blocked');

  console.log('PocketBase migration checksum guard tests passed (isolated Git fixtures; not PocketBase upgrade tests)');
} finally {
  for (const fixture of fixtures) fs.rmSync(fixture, { recursive: true, force: true });
}
