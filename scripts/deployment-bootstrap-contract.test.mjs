import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapWorkbenchAdmin, WorkbenchBootstrapError } from './bootstrap-workbench-admin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const compose = read('docker-compose.yml');
const start = read('deploy/start.sh');
const update = read('deploy/update.sh');
const productionEnvGenerator = read('deploy/make-production-env.sh');
const productionEnvExample = read('.env.production.example');
const setup = read('scripts/setup-pb.ts');
const bootstrap = read('scripts/bootstrap-workbench-admin.mjs');
const migrationName = '1790121600_backfill_trend_video_content_format.js';
const migration = read(`pb_migrations/${migrationName}`);
const manifest = JSON.parse(read('scripts/pb-migration-checksums.json'));

assert.match(compose, /127\.0\.0\.1:\$\{APP_HOST_PORT:-18788\}:8788/, 'the host readiness port must bind only to loopback');
assert.doesNotMatch(compose, /172\.17\.0\.1|lingshu-ai-cs-preview/, 'deployment must not retain the bridge IP or preview volume fallback');
assert.match(compose, /PB_DATA_VOLUME_NAME:\?/, 'Compose must reject an unspecified PocketBase volume');
for (const [name, source] of [['generator', productionEnvGenerator], ['example', productionEnvExample]]) {
  assert.match(source, /PB_DATA_VOLUME_NAME=/, `${name} must declare an installation-specific PB volume`);
  assert.match(source, /PB_DATA_VOLUME_OWNER=/, `${name} must declare an installation-specific PB volume owner`);
  assert.match(source, /APP_HOST_PORT=18788/, `${name} must declare the loopback readiness port`);
}

function generateProductionEnv({ geminiKey = '', dashscopeKey = '' }) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-env-generator-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'deploy'), { recursive: true });
    const generator = path.join(sandbox, 'deploy', 'make-production-env.sh');
    fs.copyFileSync(path.join(root, 'deploy', 'make-production-env.sh'), generator);
    fs.chmodSync(generator, 0o700);
    const answers = [
      'app.example.com',
      'pb@example.com',
      'pb-password-for-contract',
      'workbench@example.com',
      'workbench-password-for-contract',
      geminiKey,
      dashscopeKey,
      '', '', '', '', '', '', '',
    ].join('\n') + '\n';
    execFileSync('bash', ['deploy/make-production-env.sh'], {
      cwd: sandbox,
      input: answers,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return fs.readFileSync(path.join(sandbox, '.env.production'), 'utf8');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

assert.throws(
  () => generateProductionEnv({ geminiKey: 'gemini-contract-key' }),
  'a Gemini-only install must fail because core production workflows require Qwen',
);
const qwenOnlyEnv = generateProductionEnv({ dashscopeKey: 'dashscope-contract-key' });
assert.match(qwenOnlyEnv, /^OVERSEAS_LLM_BACKEND=qwen$/m, 'a DashScope-only install must select Qwen');
assert.match(qwenOnlyEnv, /^DASHSCOPE_API_KEY=dashscope-contract-key$/m);
assert.match(qwenOnlyEnv, /^REQUIRED_CAPABILITIES=text_generation,qwen_generation,platform_ads$/m);
assert.match(qwenOnlyEnv, /^PB_DATA_VOLUME_OWNER=lingshu-install-[0-9a-f]{32}$/m, 'the installer must generate a unique owner identity');
assert.match(start, /volume_mode="--require-existing"/, 'normal starts must never create a missing PB volume');
assert.match(start, /--fresh-install\)[\s\S]{0,180}volume_mode="--create-if-missing"/, 'fresh volume creation must require an explicit install flag');
assert.match(start, /ensure-pb-volume\.sh" "\$volume_mode"/, 'start must pass the selected safe volume mode to the verifier');
assert.match(update, /ensure-pb-volume\.sh" --require-existing/, 'update must never create a missing production PB volume');
for (const [name, source] of [['start', start], ['update', update]]) {
  assert.match(source, /up -d --force-recreate --wait --wait-timeout 180 pocketbase[\s\S]*bootstrap-workbench-admin\.mjs[\s\S]*up -d --no-build --wait/, `${name} must restart/migrate PB, bootstrap records, then start the app`);
  assert.match(source, /exec -T app node scripts\/check-runtime-readiness\.mjs http:\/\/127\.0\.0\.1:8788\/api\/overseas\/ready/, `${name} must validate JSON readiness inside the app container without requiring host Node`);
  assert.match(source, /env -u COMPOSE_FILE -u COMPOSE_PROJECT_NAME/, `${name} must clear ambient Compose topology selectors`);
  assert.match(source, /--project-directory "\$ROOT_DIR" -f "\$ROOT_DIR\/docker-compose\.yml"/, `${name} must select the reviewed Compose file explicitly`);
  assert.match(source, /PB_DATA_VOLUME_NAME=\$pb_data_volume_name["']?\s+"APP_HOST_PORT=\$app_host_port"\s+"ENV_FILE_PATH=\$ENV_FILE"/, `${name} must pin validated topology values against ambient overrides`);
}
for (const [name, source] of [['start', start], ['update', update]]) {
  assert.match(source, /build app worker pocketbase[\s\S]*stop caddy app worker[\s\S]*up -d --force-recreate --wait --wait-timeout 180 pocketbase/, `${name} must stop old traffic and the worker before applying database migrations`);
}
assert.doesNotMatch(setup, /WORKBENCH_ADMIN|ensureWorkbenchAdmin/, 'full schema repair must not own application-account creation');
assert.doesNotMatch(bootstrap, /method:\s*['"](?:PUT|PATCH|POST)['"][\s\S]{0,160}\/api\/collections(?:['"`?]|\$\{baseUrl\}\/?['"`])/, 'account bootstrap must not write a collection schema endpoint');

assert.match(migration, /findRecordsByFilter\([\s\S]*contentFormat = \"\"[\s\S]*200,[\s\S]*0/, 'historical rows must be consumed in bounded first-page batches');
assert.match(migration, /analysis\.contentFormat === "image"[\s\S]*\? "image"[\s\S]*: "video"/, 'the immutable migration must preserve legacy image classification and default other rows to video');
assert.match(migration, /Forward-only data classification/, 'rollback must document why later legitimate values cannot be cleared');
assert.equal(
  manifest.migrations[migrationName],
  createHash('sha256').update(migration).digest('hex'),
  'the immutable migration must be locked by the checksum manifest',
);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-deploy-bootstrap-'));
try {
  const fakeBin = path.join(temporary, 'bin');
  const fakeState = path.join(temporary, 'volume-created');
  const fakeLog = path.join(temporary, 'docker.log');
  const envFile = path.join(temporary, 'production.env');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(envFile, 'PB_DATA_VOLUME_NAME=contract-pb-data\nPB_DATA_VOLUME_OWNER=contract-install-owner\nAPP_HOST_PORT=18788\n');
  fs.writeFileSync(path.join(fakeBin, 'docker'), `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1 $2" = "volume create" ]; then
  touch "$FAKE_DOCKER_STATE"
  printf '%s\n' "contract-pb-data"
  exit 0
fi
if [ "$1 $2" = "volume inspect" ]; then
  last=''
  for argument in "$@"; do last="$argument"; done
  if [ "$last" != legacy-pb-data ]; then [ -f "$FAKE_DOCKER_STATE" ] || exit 1; fi
  case "$*" in
    *'{{.Name}}'*) printf '%s\n' "$last" ;;
    *'com.lingshu-ai.data-role'*)
      if [ "$last" = legacy-pb-data ]; then printf '\n'; else printf '%s\n' "\${FAKE_DOCKER_DATA_ROLE:-pocketbase}"; fi
      ;;
    *'com.lingshu-ai.installation-owner'*)
      if [ "$last" = legacy-pb-data ]; then printf '%s\n' "\${FAKE_LEGACY_OWNER:-}"; else printf '%s\n' "\${FAKE_DOCKER_OWNER:-contract-install-owner}"; fi
      ;;
    *'com.docker.compose.volume'*)
      if [ "$last" = legacy-pb-data ]; then printf '%s\n' 'preview_pb_data'; else printf '\n'; fi
      ;;
  esac
  exit 0
fi
if [ "$1 $2" = "volume rm" ]; then rm -f "$FAKE_DOCKER_STATE"; exit 0; fi
if [ "$1" = ps ]; then printf '%s' "\${FAKE_LEGACY_RUNNING_CONTAINER:-}"; exit 0; fi
if [ "$1" = run ]; then exit 0; fi
exit 2
`, { mode: 0o700 });
  const environment = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    FAKE_DOCKER_LOG: fakeLog,
    FAKE_DOCKER_STATE: fakeState,
  };
  execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--create-if-missing', envFile], { cwd: root, env: environment, stdio: 'pipe' });
  execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--require-existing', envFile], { cwd: root, env: environment, stdio: 'pipe' });
  const dockerLog = fs.readFileSync(fakeLog, 'utf8');
  assert.match(dockerLog, /volume create --label com\.lingshu-ai\.data-role=pocketbase --label com\.lingshu-ai\.installation-owner=contract-install-owner contract-pb-data/);
  assert.equal((dockerLog.match(/volume create/g) ?? []).length, 1, 'an existing labelled volume must never be recreated');

  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--require-existing', envFile], {
    cwd: root,
    env: { ...environment, FAKE_DOCKER_DATA_ROLE: 'unrelated' },
    stdio: 'pipe',
  }), 'an existing volume with an unrelated ownership label must fail closed');

  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--require-existing', envFile], {
    cwd: root,
    env: { ...environment, FAKE_DOCKER_OWNER: 'another-install-owner' },
    stdio: 'pipe',
  }), 'a correctly-typed volume owned by another install must fail closed');

  fs.rmSync(fakeState);
  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--require-existing', envFile], {
    cwd: root, env: environment, stdio: 'pipe',
  }), 'an update must fail instead of recreating a missing PB volume');

  const legacyTargetEnv = path.join(temporary, 'legacy-target.env');
  fs.writeFileSync(legacyTargetEnv, 'PB_DATA_VOLUME_NAME=legacy-pb-data\nPB_DATA_VOLUME_OWNER=contract-install-owner\n');
  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--require-existing', legacyTargetEnv], {
    cwd: root, env: environment, stdio: 'pipe',
  }), 'normal startup must reject an unowned legacy volume even when its name is configured');

  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--adopt-legacy', 'legacy-pb-data', envFile], {
    cwd: root,
    env: { ...environment, FAKE_LEGACY_OWNER: 'another-install-owner' },
    stdio: 'pipe',
  }), 'legacy adoption must not copy a volume already owned by another installation');

  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--adopt-legacy', 'legacy-pb-data', envFile], {
    cwd: root,
    env: { ...environment, FAKE_LEGACY_RUNNING_CONTAINER: 'running-pocketbase' },
    stdio: 'pipe',
  }), 'legacy adoption must not copy a volume while its PocketBase container may still be writing');

  execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--adopt-legacy', 'legacy-pb-data', envFile], {
    cwd: root, env: environment, stdio: 'pipe',
  });
  const adoptionLog = fs.readFileSync(fakeLog, 'utf8');
  assert.match(adoptionLog, /run --rm --mount type=volume,src=legacy-pb-data,dst=\/source,readonly --mount type=volume,src=contract-pb-data,dst=\/target/);
  assert.match(adoptionLog, /volume create --label com\.lingshu-ai\.data-role=pocketbase --label com\.lingshu-ai\.installation-owner=contract-install-owner contract-pb-data/);

  fs.writeFileSync(envFile, 'PB_DATA_VOLUME_NAME=../unsafe\n');
  assert.throws(() => execFileSync('bash', ['deploy/ensure-pb-volume.sh', '--create-if-missing', envFile], {
    cwd: root, env: environment, stdio: 'pipe',
  }), 'unsafe Docker volume names must fail before creation');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const state = { tenant: null, user: null, requests: [] };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  const body = raw ? JSON.parse(raw) : {};
  state.requests.push({ method: request.method, path: url.pathname, body });
  const send = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === '/api/collections/_superusers/auth-with-password' && request.method === 'POST') {
    return send(body.identity === 'pb@example.com' && body.password === 'pb-secret' ? 200 : 401, { token: 'bootstrap-token' });
  }
  if (request.headers.authorization !== 'bootstrap-token') return send(401, { message: 'unauthorized' });
  const match = url.pathname.match(/^\/api\/collections\/(tenants|users)\/records(?:\/([^/]+))?$/);
  if (!match) return send(404, { message: 'unexpected route' });
  const kind = match[1] === 'tenants' ? 'tenant' : 'user';
  if (request.method === 'GET') return send(200, { items: state[kind] ? [state[kind]] : [] });
  if (request.method === 'POST') {
    if (state[kind]) return send(409, { message: 'already exists' });
    state[kind] = { ...body, id: body.id };
    return send(200, state[kind]);
  }
  if (request.method === 'PATCH' && state[kind]?.id === match[2]) {
    state[kind] = { ...state[kind], ...body };
    return send(200, state[kind]);
  }
  return send(404, { message: 'not found' });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const env = {
    PB_URL: `http://127.0.0.1:${address.port}`,
    PB_ADMIN_EMAIL: 'pb@example.com',
    PB_ADMIN_PASSWORD: 'pb-secret',
    WORKBENCH_ADMIN_EMAIL: 'ops@example.com',
    WORKBENCH_ADMIN_PASSWORD: 'a-long-bootstrap-password',
    WORKBENCH_ADMIN_NAME: 'Contract Admin',
    PB_BOOTSTRAP_TIMEOUT_MS: '3000',
  };
  await assert.rejects(
    bootstrapWorkbenchAdmin({ env: { ...env, WORKBENCH_ADMIN_EMAIL: 'PB@example.com' } }),
    error => error instanceof WorkbenchBootstrapError && /separate accounts/.test(error.message),
  );
  assert.equal(state.requests.length, 0, 'invalid bootstrap identities must fail before authenticating to PocketBase');
  const first = await bootstrapWorkbenchAdmin({ env, now: () => new Date('2026-09-14T00:00:00.000Z') });
  const second = await bootstrapWorkbenchAdmin({ env, now: () => new Date('2026-09-15T00:00:00.000Z') });
  assert.deepEqual(second, first);
  assert.equal(state.tenant.registeredEmail, 'ops@example.com');
  assert.equal(state.user.tenantId, state.tenant.id);
  assert.equal(state.user.role, 'super_admin');
  assert.equal(state.requests.filter(item => item.method === 'POST' && item.path.endsWith('/tenants/records')).length, 1);
  assert.equal(state.requests.filter(item => item.method === 'POST' && item.path.endsWith('/users/records')).length, 1);
  assert.equal(state.requests.filter(item => item.method === 'PATCH').length, 0, 'a second run must be a read-only verification when desired state already exists');
  assert.equal(state.requests.some(item => item.path === '/api/collections' || /^\/api\/collections\/[^/]+$/.test(item.path)), false, 'bootstrap must never call schema endpoints');

  state.user.role = 'admin';
  await assert.rejects(
    bootstrapWorkbenchAdmin({ env }),
    error => error instanceof WorkbenchBootstrapError && /Refusing to elevate/.test(error.message),
  );
  assert.equal(state.user.role, 'admin', 'bootstrap must fail closed instead of elevating an explicitly different role');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log('deployment volume, account bootstrap and PB data migration contracts passed');
