import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rootUrl = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, rootUrl), 'utf8');
const shellFiles = [
  'deploy/backup.sh',
  'deploy/ensure-pb-volume.sh',
  'deploy/make-production-env.sh',
  'deploy/start.sh',
  'deploy/update.sh',
  'scripts/backup-production-data.sh',
  'scripts/restore-production-data.sh',
];

execFileSync('bash', ['-n', ...shellFiles], { cwd: rootUrl, stdio: 'pipe' });

const wrapper = read('deploy/backup.sh');
const backup = read('scripts/backup-production-data.sh');
const restore = read('scripts/restore-production-data.sh');
const update = read('deploy/update.sh');
const productionEnv = read('deploy/make-production-env.sh');
const start = read('deploy/start.sh');
const dockerignore = read('.dockerignore');

for (const operationalPath of ['backups/contract.tar.gz.age', 'restore/contract/data/secret.json']) {
  const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', operationalPath], { cwd: rootUrl });
  assert.equal(ignored.status, 0, `${operationalPath} must stay outside the tracked working tree`);
}
assert.match(dockerignore, /^restore\/?$/m, 'decrypted restore rehearsals must not enter the Docker build context');

assert.match(wrapper, /exec .*scripts\/backup-production-data\.sh/, 'deploy backup must delegate to the one canonical implementation');
assert.match(wrapper, /BACKUP_SOURCE_MODE=production-docker/, 'the production wrapper must forbid filesystem fallback');
assert.match(backup, /AGE_RECIPIENT is required/);
assert.match(backup, /tar[\s\S]*\| age -r/, 'backup must encrypt before the archive reaches its final path');
assert.match(backup, /shasum -a 256/);
assert.match(backup, /app_was_running[\s\S]*pb_was_running/, 'backup must restore only services that were running');
assert.match(
  backup,
  /if ! restart_previous_services; then[\s\S]*service recovery failed[\s\S]*exit 1/,
  'backup must fail closed instead of reporting success when service restart fails',
);
assert.match(backup, /BACKUP_SOURCE_MODE:-production-docker/, 'direct backups must default to the Docker production source');
assert.match(backup, /refusing to fall back to a local pb_data directory/, 'a missing production container must fail closed');
assert.match(backup, /ensure-pb-volume\.sh" --require-existing/, 'production backup must verify the owned PB volume');
assert.match(backup, /unexpected \/pb\/pb_data mount/, 'production backup must verify the container mount before snapshotting');
assert.match(backup, /unexpected \/app\/data mount/, 'production backup must verify the canonical application-data bind mount');
assert.match(backup, /Production backup only supports the canonical application data directory/, 'production backup must reject ambient application-data sources');
assert.match(backup, /env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME/, 'production backup must clear ambient Compose topology selectors');
assert.match(backup, /--project-directory "\$ROOT_DIR" -f "\$ROOT_DIR\/docker-compose\.yml"/, 'production backup must select the reviewed Compose file explicitly');
assert.match(backup, /PB_DATA_VOLUME_NAME=\$pb_data_volume_name["']?\s+"APP_HOST_PORT=\$app_host_port"\s+"ENV_FILE_PATH=\$COMPOSE_ENV_FILE"/, 'production backup must pin validated topology values');

assert.match(restore, /Checksum manifest not found/);
assert.match(restore, /Backup checksum mismatch/);
assert.match(restore, /RESTORE_CONFIRM=replace-live-data/);
assert.match(restore, /unexpected path/, 'restore must reject archive paths outside its two data roots');
assert.match(restore, /encrypted, checksummed snapshot of current live data/, 'live replacement must first create a recoverable encrypted snapshot');
assert.match(restore, /Restore failed after replacement began; restoring the pre-change snapshot/);
assert.match(restore, /Refusing live replacement while app or PocketBase is stopped/, 'live replacement must not skip readiness when the app was initially stopped');
assert.match(restore, /verify_owned_pocketbase_target[\s\S]*ensure-pb-volume\.sh" --require-existing/, 'live restore must verify the owned PB target');
assert.ok((restore.match(/verify_owned_pocketbase_target/g) ?? []).length >= 3, 'live restore must verify before its backup and again before replacement');
assert.match(restore, /unexpected \/pb\/pb_data mount/, 'live restore must verify the container mount before replacement');
assert.match(restore, /unsupported \$member_kind member/, 'restore must reject links and special archive members');
assert.match(restore, /unexpected \/app\/data mount/, 'live restore must verify the canonical application-data bind mount');
assert.match(restore, /env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME/, 'live restore must clear ambient Compose topology selectors');
assert.match(restore, /--project-directory "\$ROOT_DIR" -f "\$ROOT_DIR\/docker-compose\.yml"/, 'live restore must select the reviewed Compose file explicitly');
assert.match(restore, /PB_DATA_VOLUME_NAME=\$pb_data_volume_name["']?\s+"APP_HOST_PORT=\$app_host_port"\s+"ENV_FILE_PATH=\$COMPOSE_ENV_FILE"/, 'live restore must pin validated topology values');
assert.match(restore, /port app 8788/, 'restore readiness must use the running container port mapping instead of a guessed host port');
assert.match(restore, /\^127\\\.0\\\.0\\\.1:/, 'restore readiness must stay on the loopback binding');
const replacementCopy = restore.indexOf('docker cp "$extracted/pb_data/."');
const readinessAfterReplacement = restore.indexOf('\nwait_for_app_readiness\n', replacementCopy);
const markApplyComplete = restore.indexOf('\napply_complete=1\n', readinessAfterReplacement);
const deletePreviousData = restore.indexOf('rm -rf -- "$live_previous"', markApplyComplete);
const reportLiveSuccess = restore.indexOf("printf 'Live data restored", deletePreviousData);
assert.ok(
  replacementCopy >= 0
    && readinessAfterReplacement > replacementCopy
    && markApplyComplete > readinessAfterReplacement
    && deletePreviousData > markApplyComplete
    && reportLiveSuccess > deletePreviousData,
  'live restore may delete the old copy and report success only after restored readiness passes',
);

assert.match(update, /backup-production-data\.sh/);
assert.match(update, /git pull --ff-only/);
assert.match(update, /git status --porcelain --untracked-files=normal/);
assert.match(update, /api\/overseas\/ready/);
assert.doesNotMatch(update, /setup:pb|demo:sync-accounts/, 'updates must rely on versioned migrations and never inject demo accounts');
assert.match(productionEnv, /ENABLE_LOCAL_DEV_FALLBACK=false/);
assert.match(productionEnv, /RUNTIME_SCHEMA_REPAIR_ENABLED=false/);
assert.match(productionEnv, /REQUIRED_CAPABILITIES=/);
assert.match(productionEnv, /TRUST_PROXY_HOPS=1/);
assert.match(start, /--wait --wait-timeout/);
assert.match(start, /api\/overseas\/ready/);

// Exercise the non-destructive backup/restore path without Docker, real age
// keys, repository data or external services. The fake age binary preserves
// byte flow so archive and checksum behavior are still covered.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-ops-contract-'));
try {
  const fakeBin = path.join(temporary, 'bin');
  const appData = path.join(temporary, 'app-data');
  const pbData = path.join(temporary, 'pb-data');
  const backups = path.join(temporary, 'backups');
  const restored = path.join(temporary, 'restored');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(pbData, { recursive: true });
  fs.writeFileSync(path.join(appData, 'asset.txt'), 'application-data\n');
  fs.writeFileSync(path.join(pbData, 'data.db'), 'pocketbase-data\n');
  const identity = path.join(temporary, 'identity.txt');
  fs.writeFileSync(identity, 'fake-offline-identity\n', { mode: 0o600 });
  const fakeAge = path.join(fakeBin, 'age');
  fs.writeFileSync(fakeAge, `#!/bin/sh
set -eu
decrypt=0
output=''
input=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) decrypt=1; shift ;;
    -r|-i) shift 2 ;;
    -o) output="$2"; shift 2 ;;
    *) input="$1"; shift ;;
  esac
done
if [ "$decrypt" = 1 ]; then cp "$input" "$output"; else cat > "$output"; fi
`, { mode: 0o700 });
  const fakeDocker = path.join(fakeBin, 'docker');
  fs.writeFileSync(fakeDocker, '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const environment = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    APP_DATA_DIR: appData,
    PB_DATA_DIR: pbData,
    BACKUP_DIR: backups,
    AGE_RECIPIENT: 'age1offlinecontract',
  };
  const unsafeFallback = spawnSync('bash', ['scripts/backup-production-data.sh'], {
    cwd: rootUrl,
    env: environment,
    encoding: 'utf8',
  });
  assert.notEqual(unsafeFallback.status, 0, 'production mode must fail when Docker is unavailable even if a local pb_data directory exists');
  assert.match(unsafeFallback.stderr, /docker compose is required for a production backup/);
  assert.equal(fs.existsSync(backups) && fs.readdirSync(backups).some(name => name.endsWith('.tar.gz.age')), false);

  const localEnvironment = { ...environment, BACKUP_SOURCE_MODE: 'local-filesystem' };
  execFileSync('bash', ['scripts/backup-production-data.sh'], { cwd: rootUrl, env: localEnvironment, stdio: 'pipe' });
  const encrypted = fs.readdirSync(backups).find(name => name.endsWith('.tar.gz.age'));
  assert.ok(encrypted, 'backup must emit an encrypted archive');
  const encryptedPath = path.join(backups, encrypted);
  assert.equal(fs.existsSync(encryptedPath.replace(/\.tar\.gz\.age$/, '.manifest.txt')), true);
  execFileSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: rootUrl,
    env: { ...localEnvironment, AGE_IDENTITY: identity, RESTORE_DIR: restored, RESTORE_APPLY: 'false' },
    stdio: 'pipe',
  });
  assert.equal(fs.readFileSync(path.join(restored, 'data', 'asset.txt'), 'utf8'), 'application-data\n');
  assert.equal(fs.readFileSync(path.join(restored, 'pb_data', 'data.db'), 'utf8'), 'pocketbase-data\n');

  const writeManifest = archivePath => {
    const checksum = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
    const manifestPath = archivePath.replace(/\.tar\.gz\.age$/, '.manifest.txt');
    fs.writeFileSync(manifestPath, `${checksum}  ${path.basename(archivePath)}\n`);
    return manifestPath;
  };
  const assertUnsafeMemberRejected = (label, buildData, expectedKind) => {
    const payload = path.join(temporary, `unsafe-${label}`);
    fs.mkdirSync(path.join(payload, 'pb_data'), { recursive: true });
    fs.writeFileSync(path.join(payload, 'pb_data', 'data.db'), 'fixture\n');
    buildData(payload);
    const archivePath = path.join(temporary, `unsafe-${label}.tar.gz.age`);
    execFileSync('tar', ['-czf', archivePath, '-C', payload, 'pb_data', 'data']);
    const result = spawnSync('bash', ['scripts/restore-production-data.sh', archivePath], {
      cwd: rootUrl,
      env: {
        ...localEnvironment,
        AGE_IDENTITY: identity,
        BACKUP_MANIFEST: writeManifest(archivePath),
        RESTORE_DIR: path.join(temporary, `unsafe-${label}-output`),
        RESTORE_APPLY: 'false',
      },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `${label} archive member must fail closed`);
    assert.match(result.stderr, new RegExp(`unsupported ${expectedKind} member`, 'i'));
    assert.equal(fs.existsSync(path.join(temporary, `unsafe-${label}-output`)), false);
  };

  assertUnsafeMemberRejected('symlink', payload => {
    const outside = path.join(temporary, 'symlink-outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(payload, 'data'), 'dir');
  }, 'symlink');
  assertUnsafeMemberRejected('hardlink', payload => {
    const dataDir = path.join(payload, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const first = path.join(dataDir, 'first.txt');
    fs.writeFileSync(first, 'linked\n');
    fs.linkSync(first, path.join(dataDir, 'second.txt'));
  }, 'hardlink');
  assertUnsafeMemberRejected('fifo', payload => {
    const dataDir = path.join(payload, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    execFileSync('mkfifo', [path.join(dataDir, 'pipe')]);
  }, 'fifo');

  // Upgrade the fake Docker implementation for fully offline service lifecycle
  // and live-restore tests. All container data remains under this temp root.
  fs.writeFileSync(fakeDocker, `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1 $2" = "volume inspect" ]; then
  last=''
  for argument in "$@"; do last="$argument"; done
  case "$*" in
    *'{{.Name}}'*) printf '%s\n' "$last" ;;
    *'com.lingshu-ai.data-role'*) printf '%s\n' "$FAKE_VOLUME_ROLE" ;;
    *'com.lingshu-ai.installation-owner'*) printf '%s\n' "$FAKE_VOLUME_OWNER" ;;
  esac
  exit 0
fi
if [ "$1" = inspect ] && [ "$2" = --format ]; then
  last=''
  for argument in "$@"; do last="$argument"; done
  if [ "$last" = fake-app ]; then
    printf 'bind|%s\n' "$FAKE_MOUNTED_APP_DATA"
  else
    printf 'volume|%s\n' "$FAKE_MOUNTED_PB_VOLUME"
  fi
  exit 0
fi
if [ "$1" = compose ]; then
  shift
  if [ "$1" = version ]; then exit 0; fi
  if [ "\${COMPOSE_FILE+x}" = x ] || [ "\${COMPOSE_PROJECT_NAME+x}" = x ]; then
    echo 'ambient Compose topology selector reached an operational command' >&2
    exit 65
  fi
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --project-directory|-f|--env-file) shift 2 ;;
      *) break ;;
    esac
  done
  command="$1"
  shift
  case "$command" in
    ps)
      flag="$1"
      service="$2"
      if [ "$flag" = -aq ]; then
        if [ "$service" = app ]; then echo fake-app; else echo fake-pocketbase; fi
      elif [ "$service" = app ] && [ "$FAKE_APP_RUNNING" = 1 ]; then
        echo fake-app
      elif [ "$service" = pocketbase ] && [ "$FAKE_PB_RUNNING" = 1 ]; then
        echo fake-pocketbase
      fi
      exit 0
      ;;
    stop) exit 0 ;;
    port)
      echo "$FAKE_APP_BIND_HOST:$FAKE_APP_HOST_PORT"
      exit 0
      ;;
    start)
      for service in "$@"; do
        if [ "$service" = app ]; then
          app_start_count=0
          if [ -f "$FAKE_APP_START_COUNT_FILE" ]; then app_start_count="$(cat "$FAKE_APP_START_COUNT_FILE")"; fi
          app_start_count=$((app_start_count + 1))
          printf '%s\n' "$app_start_count" > "$FAKE_APP_START_COUNT_FILE"
          if [ "$FAKE_FAIL_START_APP" = 1 ]; then exit 42; fi
          if [ "$FAKE_FAIL_START_APP_ON" -gt 0 ] && [ "$app_start_count" -eq "$FAKE_FAIL_START_APP_ON" ]; then exit 42; fi
        fi
        if [ "$service" = pocketbase ] && [ "$FAKE_FAIL_START_PB" = 1 ]; then exit 43; fi
      done
      exit 0
      ;;
  esac
fi
if [ "$1" = cp ]; then
  source_path="$2"
  destination="$3"
  case "$source_path" in
    *:/pb/pb_data/.)
      mkdir -p "$destination"
      cp -a "$FAKE_PB_DATA_DIR/." "$destination"
      ;;
    *)
      mkdir -p "$FAKE_PB_DATA_DIR"
      cp -a "$source_path" "$FAKE_PB_DATA_DIR"
      ;;
  esac
  exit 0
fi
if [ "$1" = run ]; then
  find "$FAKE_PB_DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  exit 0
fi
exit 64
`, { mode: 0o700 });
  const fakeCurl = path.join(fakeBin, 'curl');
  fs.writeFileSync(fakeCurl, `#!/bin/sh
set -eu
count=0
if [ -f "$FAKE_CURL_COUNT_FILE" ]; then count="$(cat "$FAKE_CURL_COUNT_FILE")"; fi
count=$((count + 1))
printf '%s\n' "$count" > "$FAKE_CURL_COUNT_FILE"
printf '%s\n' "$*" >> "$FAKE_CURL_LOG"
if [ "$count" -le "$FAKE_CURL_FAILS" ]; then exit 22; fi
exit 0
`, { mode: 0o700 });
  fs.writeFileSync(path.join(fakeBin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });

  const createLiveRepo = label => {
    const requestedRepo = path.join(temporary, label);
    fs.mkdirSync(requestedRepo, { recursive: true });
    const repo = fs.realpathSync(requestedRepo);
    const scripts = path.join(repo, 'scripts');
    const deploy = path.join(repo, 'deploy');
    const liveData = path.join(repo, 'data');
    const livePbData = path.join(repo, 'fake-pb-data');
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(deploy, { recursive: true });
    fs.mkdirSync(liveData, { recursive: true });
    fs.mkdirSync(livePbData, { recursive: true });
    fs.mkdirSync(path.join(repo, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(liveData, 'asset.txt'), `old-app-${label}\n`);
    fs.writeFileSync(path.join(livePbData, 'data.db'), `old-pb-${label}\n`);
    fs.writeFileSync(path.join(repo, '.env.production'), [
      'COMPOSE_PROJECT_NAME=offline-contract',
      'PB_DATA_VOLUME_NAME=contract-pb-data',
      'PB_DATA_VOLUME_OWNER=contract-install-owner',
      'APP_HOST_PORT=19888',
      '',
    ].join('\n'));
    for (const script of ['backup-production-data.sh', 'restore-production-data.sh']) {
      const destination = path.join(scripts, script);
      fs.copyFileSync(new URL(`scripts/${script}`, rootUrl), destination);
      fs.chmodSync(destination, 0o700);
    }
    const volumeVerifier = path.join(deploy, 'ensure-pb-volume.sh');
    fs.copyFileSync(new URL('deploy/ensure-pb-volume.sh', rootUrl), volumeVerifier);
    fs.chmodSync(volumeVerifier, 0o700);
    return { repo, liveData, livePbData };
  };
  const liveEnvironment = (fixture, overrides = {}) => ({
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    TMPDIR: path.join(fixture.repo, 'tmp'),
    APP_DATA_DIR: fixture.liveData,
    PB_DATA_DIR: fixture.livePbData,
    BACKUP_DIR: path.join(fixture.repo, 'backups'),
    COMPOSE_ENV_FILE: path.join(fixture.repo, '.env.production'),
    AGE_IDENTITY: identity,
    AGE_RECIPIENT: 'age1offlinecontract',
    RESTORE_APPLY: 'true',
    RESTORE_CONFIRM: 'replace-live-data',
    BACKUP_SOURCE_MODE: 'production-docker',
    FAKE_PB_DATA_DIR: fixture.livePbData,
    FAKE_DOCKER_LOG: path.join(fixture.repo, 'docker.log'),
    FAKE_APP_START_COUNT_FILE: path.join(fixture.repo, 'app-start-count'),
    FAKE_CURL_COUNT_FILE: path.join(fixture.repo, 'curl-count'),
    FAKE_CURL_LOG: path.join(fixture.repo, 'curl.log'),
    FAKE_CURL_FAILS: '0',
    FAKE_APP_BIND_HOST: '127.0.0.1',
    FAKE_APP_HOST_PORT: '19888',
    FAKE_APP_RUNNING: '1',
    FAKE_PB_RUNNING: '1',
    FAKE_FAIL_START_APP: '0',
    FAKE_FAIL_START_APP_ON: '0',
    FAKE_FAIL_START_PB: '0',
    FAKE_VOLUME_ROLE: 'pocketbase',
    FAKE_VOLUME_OWNER: 'contract-install-owner',
    FAKE_MOUNTED_PB_VOLUME: 'contract-pb-data',
    FAKE_MOUNTED_APP_DATA: fixture.liveData,
    COMPOSE_FILE: path.join(temporary, 'ambient-wrong-compose.yml'),
    COMPOSE_PROJECT_NAME: 'ambient-wrong-project',
    ...overrides,
  });

  const assertNoLiveMutation = fixture => {
    const log = fs.existsSync(path.join(fixture.repo, 'docker.log'))
      ? fs.readFileSync(path.join(fixture.repo, 'docker.log'), 'utf8')
      : '';
    assert.doesNotMatch(log, /compose .*\bstop\b/, 'identity failure must happen before stopping services');
    assert.doesNotMatch(log, /(^|\n)(?:cp|run)\s/, 'identity failure must happen before copying or clearing PB data');
  };

  const wrongOwnerBackupFixture = createLiveRepo('backup-wrong-owner');
  const wrongOwnerBackup = spawnSync('bash', ['scripts/backup-production-data.sh'], {
    cwd: wrongOwnerBackupFixture.repo,
    env: liveEnvironment(wrongOwnerBackupFixture, { FAKE_VOLUME_OWNER: 'another-install-owner' }),
    encoding: 'utf8',
  });
  assert.notEqual(wrongOwnerBackup.status, 0, 'production backup must reject a volume owned by another installation');
  assert.match(wrongOwnerBackup.stderr, /owned by another or unknown installation/);
  assertNoLiveMutation(wrongOwnerBackupFixture);

  const wrongMountBackupFixture = createLiveRepo('backup-wrong-mount');
  const wrongMountBackup = spawnSync('bash', ['scripts/backup-production-data.sh'], {
    cwd: wrongMountBackupFixture.repo,
    env: liveEnvironment(wrongMountBackupFixture, { FAKE_MOUNTED_PB_VOLUME: 'another-pb-volume' }),
    encoding: 'utf8',
  });
  assert.notEqual(wrongMountBackup.status, 0, 'production backup must reject a PB container mounted to another volume');
  assert.match(wrongMountBackup.stderr, /unexpected \/pb\/pb_data mount/);
  assertNoLiveMutation(wrongMountBackupFixture);

  const wrongAppMountBackupFixture = createLiveRepo('backup-wrong-app-mount');
  const wrongAppMountBackup = spawnSync('bash', ['scripts/backup-production-data.sh'], {
    cwd: wrongAppMountBackupFixture.repo,
    env: liveEnvironment(wrongAppMountBackupFixture, { FAKE_MOUNTED_APP_DATA: path.join(temporary, 'another-app-data') }),
    encoding: 'utf8',
  });
  assert.notEqual(wrongAppMountBackup.status, 0, 'production backup must reject an app container mounted to another data directory');
  assert.match(wrongAppMountBackup.stderr, /unexpected \/app\/data mount/);
  assertNoLiveMutation(wrongAppMountBackupFixture);

  const ambientAppDataBackupFixture = createLiveRepo('backup-ambient-app-data');
  const ambientAppData = path.join(ambientAppDataBackupFixture.repo, 'other-data');
  fs.mkdirSync(ambientAppData, { recursive: true });
  const ambientAppDataBackup = spawnSync('bash', ['scripts/backup-production-data.sh'], {
    cwd: ambientAppDataBackupFixture.repo,
    env: liveEnvironment(ambientAppDataBackupFixture, { APP_DATA_DIR: ambientAppData }),
    encoding: 'utf8',
  });
  assert.notEqual(ambientAppDataBackup.status, 0, 'production backup must reject an ambient application data source');
  assert.match(ambientAppDataBackup.stderr, /canonical application data directory/);
  assertNoLiveMutation(ambientAppDataBackupFixture);

  const failedBackupFixture = createLiveRepo('backup-restart-failure');
  const failedBackup = spawnSync('bash', ['scripts/backup-production-data.sh'], {
    cwd: failedBackupFixture.repo,
    env: liveEnvironment(failedBackupFixture, { FAKE_FAIL_START_APP: '1' }),
    encoding: 'utf8',
  });
  assert.notEqual(failedBackup.status, 0, 'backup must exit nonzero when restarting a previously running service fails');
  assert.match(failedBackup.stderr, /service recovery failed; backup command is failing closed/);
  assert.doesNotMatch(failedBackup.stdout, /^Encrypted backup:/m, 'restart failure must not print the backup success result');
  assert.equal(
    fs.readdirSync(path.join(failedBackupFixture.repo, 'backups')).some(name => name.endsWith('.tar.gz.age')),
    true,
    'the recoverable encrypted archive should remain available even though service recovery failed',
  );

  const successfulRestoreFixture = createLiveRepo('restore-ready-success');
  const successfulRestore = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: successfulRestoreFixture.repo,
    env: liveEnvironment(successfulRestoreFixture),
    encoding: 'utf8',
  });
  assert.equal(successfulRestore.status, 0, successfulRestore.stderr);
  assert.match(successfulRestore.stdout, /Live data restored from the verified encrypted backup/);
  assert.equal(fs.readFileSync(path.join(successfulRestoreFixture.liveData, 'asset.txt'), 'utf8'), 'application-data\n');
  assert.equal(fs.readFileSync(path.join(successfulRestoreFixture.livePbData, 'data.db'), 'utf8'), 'pocketbase-data\n');
  assert.equal(
    fs.readdirSync(successfulRestoreFixture.repo).some(name => name.startsWith('.pre-restore-live-data-')),
    false,
    'the previous live-data copy should be removed only after readiness succeeds',
  );
  assert.ok(Number(fs.readFileSync(path.join(successfulRestoreFixture.repo, 'curl-count'), 'utf8')) >= 1);
  assert.match(
    fs.readFileSync(path.join(successfulRestoreFixture.repo, 'curl.log'), 'utf8'),
    /http:\/\/127\.0\.0\.1:19888\/api\/overseas\/ready/,
    'readiness must target the actual loopback port reported by Docker Compose',
  );

  for (const [label, overrides, expected] of [
    ['restore-wrong-owner', { FAKE_VOLUME_OWNER: 'another-install-owner' }, /owned by another or unknown installation/],
    ['restore-wrong-mount', { FAKE_MOUNTED_PB_VOLUME: 'another-pb-volume' }, /unexpected \/pb\/pb_data mount/],
    ['restore-wrong-app-mount', { FAKE_MOUNTED_APP_DATA: path.join(temporary, 'another-app-data') }, /unexpected \/app\/data mount/],
  ]) {
    const fixture = createLiveRepo(label);
    const result = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
      cwd: fixture.repo,
      env: liveEnvironment(fixture, overrides),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `${label} must fail closed`);
    assert.match(result.stderr, expected);
    assertNoLiveMutation(fixture);
    assert.equal(fs.readFileSync(path.join(fixture.liveData, 'asset.txt'), 'utf8'), `old-app-${label}\n`);
    assert.equal(fs.readFileSync(path.join(fixture.livePbData, 'data.db'), 'utf8'), `old-pb-${label}\n`);
  }

  const rollbackFixture = createLiveRepo('restore-readiness-rollback');
  const failedRestore = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: rollbackFixture.repo,
    env: liveEnvironment(rollbackFixture, { FAKE_CURL_FAILS: '30' }),
    encoding: 'utf8',
  });
  assert.notEqual(failedRestore.status, 0, 'restored readiness failure must fail the live restore');
  assert.match(failedRestore.stderr, /Restored application did not pass readiness/);
  assert.match(failedRestore.stderr, /restoring the pre-change snapshot/);
  assert.doesNotMatch(failedRestore.stdout, /Live data restored from the verified encrypted backup/);
  assert.equal(fs.readFileSync(path.join(rollbackFixture.liveData, 'asset.txt'), 'utf8'), 'old-app-restore-readiness-rollback\n');
  assert.equal(fs.readFileSync(path.join(rollbackFixture.livePbData, 'data.db'), 'utf8'), 'old-pb-restore-readiness-rollback\n');
  assert.equal(
    fs.readdirSync(rollbackFixture.repo).some(name => name.startsWith('.pre-restore-live-data-')),
    false,
    'rollback must put the previous live-data directory back in place',
  );
  assert.ok(
    Number(fs.readFileSync(path.join(rollbackFixture.repo, 'curl-count'), 'utf8')) >= 31,
    'the harness must observe failed restored readiness followed by successful rollback readiness',
  );

  const restartFailureFixture = createLiveRepo('restore-restart-rollback');
  const restartFailureRestore = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: restartFailureFixture.repo,
    env: liveEnvironment(restartFailureFixture, { FAKE_FAIL_START_APP_ON: '2' }),
    encoding: 'utf8',
  });
  assert.notEqual(restartFailureRestore.status, 0, 'service restart failure must fail the live restore');
  assert.match(restartFailureRestore.stderr, /Failed to restart the application after restore/);
  assert.match(restartFailureRestore.stderr, /restoring the pre-change snapshot/);
  assert.doesNotMatch(restartFailureRestore.stdout, /Live data restored from the verified encrypted backup/);
  assert.equal(fs.readFileSync(path.join(restartFailureFixture.liveData, 'asset.txt'), 'utf8'), 'old-app-restore-restart-rollback\n');
  assert.equal(fs.readFileSync(path.join(restartFailureFixture.livePbData, 'data.db'), 'utf8'), 'old-pb-restore-restart-rollback\n');

  const stoppedFixture = createLiveRepo('restore-stopped-service');
  const stoppedRestore = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: stoppedFixture.repo,
    env: liveEnvironment(stoppedFixture, { FAKE_APP_RUNNING: '0' }),
    encoding: 'utf8',
  });
  assert.notEqual(stoppedRestore.status, 0, 'live restore must not bypass readiness when the app is initially stopped');
  assert.match(stoppedRestore.stderr, /both must be running so restored readiness can be verified/);
  assert.equal(fs.readFileSync(path.join(stoppedFixture.liveData, 'asset.txt'), 'utf8'), 'old-app-restore-stopped-service\n');
  assert.equal(fs.readFileSync(path.join(stoppedFixture.livePbData, 'data.db'), 'utf8'), 'old-pb-restore-stopped-service\n');

  const exposedPortFixture = createLiveRepo('restore-non-loopback-port');
  const exposedPortRestore = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: exposedPortFixture.repo,
    env: liveEnvironment(exposedPortFixture, { FAKE_APP_BIND_HOST: '0.0.0.0' }),
    encoding: 'utf8',
  });
  assert.notEqual(exposedPortRestore.status, 0, 'live restore must not probe an externally bound or ambiguous app port');
  assert.match(exposedPortRestore.stderr, /Could not resolve app:8788 to a single 127\.0\.0\.1 host port/);
  assert.equal(fs.readFileSync(path.join(exposedPortFixture.liveData, 'asset.txt'), 'utf8'), 'old-app-restore-non-loopback-port\n');
  assert.equal(fs.readFileSync(path.join(exposedPortFixture.livePbData, 'data.db'), 'utf8'), 'old-pb-restore-non-loopback-port\n');

  const mismatchedReadyUrlFixture = createLiveRepo('restore-mismatched-ready-url');
  const mismatchedReadyUrlRestore = spawnSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: mismatchedReadyUrlFixture.repo,
    env: liveEnvironment(mismatchedReadyUrlFixture, {
      RESTORE_READY_URL: 'http://127.0.0.1:19999/api/overseas/ready',
    }),
    encoding: 'utf8',
  });
  assert.notEqual(mismatchedReadyUrlRestore.status, 0, 'an override must not redirect readiness to another loopback service');
  assert.match(mismatchedReadyUrlRestore.stderr, /must exactly match the running app:8788 loopback mapping/);
  assert.equal(fs.readFileSync(path.join(mismatchedReadyUrlFixture.liveData, 'asset.txt'), 'utf8'), 'old-app-restore-mismatched-ready-url\n');
  assert.equal(fs.readFileSync(path.join(mismatchedReadyUrlFixture.livePbData, 'data.db'), 'utf8'), 'old-pb-restore-mismatched-ready-url\n');

  fs.appendFileSync(encryptedPath, 'tampered');
  assert.throws(() => execFileSync('bash', ['scripts/restore-production-data.sh', encryptedPath], {
    cwd: rootUrl,
    env: { ...environment, AGE_IDENTITY: identity, RESTORE_DIR: `${restored}-tampered`, RESTORE_APPLY: 'false' },
    stdio: 'pipe',
  }), 'tampered backup must fail checksum validation before extraction');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('production backup, restore and update safety contract passed');

await import('./deployment-bootstrap-contract.test.mjs');
