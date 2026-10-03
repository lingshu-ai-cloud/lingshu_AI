import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { dataAuthorityRequestScope } from '../server/storage/dataAuthority.js';
import { createSocialProgramsRouter } from '../server/routes/socialPrograms.js';
import { inspectSocialOperatingSignals, SOCIAL_OPERATING_REQUIRED_COLLECTIONS } from '../server/runtime/socialOperatingObservability.js';
import { invalidatePbAdminToken, pbCreateStrict, pbListStrict } from '../server/storage/pb.js';
import { pbStore } from '../server/storage/pbStore.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const migrationsDir = path.join(repositoryRoot, 'pb_migrations');
const adminEmail = 'release-harness@example.invalid';
const adminPassword = 'release-harness-password-2026';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-social-release-'));

function pocketBaseBinary(): string {
  const candidates = [
    process.env.PB_BIN,
    path.join(os.homedir(), '.local/share/lingshu/pocketbase/pocketbase'),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  const resolved = spawnSync('sh', ['-c', 'command -v pocketbase'], { encoding: 'utf8' }).stdout.trim();
  if (resolved) return resolved;
  throw new Error('PocketBase binary missing: set PB_BIN (CI installs the pinned release before this gate)');
}

const pbBin = pocketBaseBinary();
const pbVersion = spawnSync(pbBin, ['--version'], { encoding: 'utf8' }).stdout.trim();
if (!/\b0\.39\.5\b/.test(pbVersion)) {
  throw new Error(`Release harness requires PocketBase 0.39.5 (the Dockerfile release version); received: ${pbVersion || 'unknown'}`);
}

function runPb(args: string[]): void {
  const result = spawnSync(pbBin, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    input: args[0] === 'migrate' && args[1] === 'down' ? 'y\n' : undefined,
  });
  if (result.status !== 0) {
    throw new Error(`PocketBase command failed: ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

type RunningPocketBase = { process: ChildProcess; url: string; dataDir: string };

async function startPocketBase(
  dataDir: string,
  sourceMigrations = migrationsDir,
  automigrate = false,
  provisionSuperuser = true,
): Promise<RunningPocketBase> {
  // The superuser CLI may auto-apply pending migrations. Do not invoke it
  // between a rollback and the assertion that the rolled-back schema is gone.
  if (provisionSuperuser) runPb(['superuser', 'upsert', adminEmail, adminPassword, `--dir=${dataDir}`]);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(pbBin, [
    'serve', `--http=127.0.0.1:${port}`, `--dir=${dataDir}`,
    `--migrationsDir=${sourceMigrations}`, `--automigrate=${automigrate ? 'true' : 'false'}`,
  ], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  child.stderr?.on('data', chunk => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`PocketBase exited during startup (${child.exitCode})\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { process: child, url, dataDir };
    } catch { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw new Error(`PocketBase did not become ready\n${output}`);
}

async function stopPocketBase(instance: RunningPocketBase | null): Promise<void> {
  if (!instance || instance.process.exitCode !== null) return;
  instance.process.kill('SIGTERM');
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => { instance.process.kill('SIGKILL'); resolve(); }, 5_000);
    instance.process.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}

async function adminToken(url: string): Promise<string> {
  const response = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
  });
  if (!response.ok) throw new Error(`PocketBase superuser login failed (${response.status}): ${await response.text()}`);
  return String((await response.json() as { token?: string }).token || '');
}

async function adminRequest(url: string, token: string, requestPath: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}${requestPath}`, {
    ...init,
    headers: { authorization: token, 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

async function collectionNames(url: string, token: string): Promise<string[]> {
  const response = await adminRequest(url, token, '/api/collections?perPage=500');
  if (!response.ok) throw new Error(`PocketBase collection listing failed (${response.status}): ${await response.text()}`);
  return (await response.json() as { items: Array<{ name: string }> }).items.map(item => item.name);
}

// studio_production_defaults is normally provisioned by scripts/setup-pb.ts,
// outside the migration set exercised by this isolated release harness. Build
// the same real PocketBase collection locally so authority resolution crosses
// the production datastore boundary without relying on process-memory mocks.
async function ensureReleaseFixtureCollection(url: string, token: string): Promise<void> {
  const name = 'studio_production_defaults';
  if ((await collectionNames(url, token)).includes(name)) return;
  const response = await adminRequest(url, token, '/api/collections', {
    method: 'POST', body: JSON.stringify({
      name, type: 'base', fields: [
        { name: 'tenant_id', type: 'text', required: true },
        { name: 'payload', type: 'json', maxSize: 2_000_000 },
        { name: 'version', type: 'number', onlyInt: true },
      ], indexes: [`CREATE UNIQUE INDEX idx_${name}_tenant ON ${name} (tenant_id)`],
    }),
  });
  assert.equal(response.status, 200, `release fixture collection create failed: ${await response.text()}`);
}

function copyMigrationBaseline(target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(migrationsDir)) {
    if (!name.endsWith('.js') || name >= '1790985600') continue;
    fs.copyFileSync(path.join(migrationsDir, name), path.join(target, name));
  }
}

async function migrationDrill(): Promise<{ instance: RunningPocketBase; dataDir: string }> {
  const freshData = path.join(root, 'fresh-data');
  runPb(['migrate', 'up', `--dir=${freshData}`, `--migrationsDir=${migrationsDir}`]);
  let fresh = await startPocketBase(freshData);
  const freshNames = await collectionNames(fresh.url, await adminToken(fresh.url));
  for (const name of SOCIAL_OPERATING_REQUIRED_COLLECTIONS) assert.ok(freshNames.includes(name), `fresh migration missing ${name}`);
  assert.ok(freshNames.includes('publishing_schedules'), 'fresh migration must create posting schedules before its updated-field migration');
  await stopPocketBase(fresh);

  const baselineMigrations = path.join(root, 'baseline-migrations');
  copyMigrationBaseline(baselineMigrations);
  const dataDir = path.join(root, 'upgrade-data');
  runPb(['migrate', 'up', `--dir=${dataDir}`, `--migrationsDir=${baselineMigrations}`]);
  let instance = await startPocketBase(dataDir, baselineMigrations);
  let token = await adminToken(instance.url);
  const sentinel = {
    tenant_id: 'tenant-upgrade', program_id: 'program-upgrade', version: 1, status: 'active', stage: 'foundation',
    route: 'cold_start', brand_name: 'Upgrade Sentinel', market: 'US', payload: { sentinel: true },
    created_by: 'release-harness', updated_by: 'release-harness',
    created_at: '2026-09-26T00:00:00.000Z', updated_at: '2026-09-26T00:00:00.000Z',
  };
  const created = await adminRequest(instance.url, token, '/api/collections/social_programs/records', {
    method: 'POST', body: JSON.stringify(sentinel),
  });
  assert.equal(created.status, 200, `upgrade sentinel create failed: ${await created.text()}`);
  await stopPocketBase(instance);

  runPb(['migrate', 'up', `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`]);
  instance = await startPocketBase(dataDir);
  token = await adminToken(instance.url);
  let names = await collectionNames(instance.url, token);
  for (const name of SOCIAL_OPERATING_REQUIRED_COLLECTIONS) assert.ok(names.includes(name), `upgrade migration missing ${name}`);
  let sentinelResponse = await adminRequest(instance.url, token, '/api/collections/social_programs/records?filter=program_id%3D%22program-upgrade%22');
  assert.equal((await sentinelResponse.json() as { totalItems: number }).totalItems, 1, 'upgrade must preserve existing business rows');
  await stopPocketBase(instance);

  const postBaselineCount = fs.readdirSync(migrationsDir)
    .filter(name => name.endsWith('.js') && name >= '1790985600').length;
  runPb(['migrate', 'down', String(postBaselineCount), `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`]);
  // Serve against the baseline migration directory so PocketBase cannot
  // immediately reapply the just-reverted forward migrations on startup.
  instance = await startPocketBase(dataDir, baselineMigrations, false, false);
  token = await adminToken(instance.url);
  names = await collectionNames(instance.url, token);
  assert.ok(!names.includes('social_operating_worker_heartbeats'), 'rollback removes runtime heartbeat collection');
  assert.ok(!names.includes('social_business_content_goals'), 'rollback removes Gap-V1 operating evidence collections');
  sentinelResponse = await adminRequest(instance.url, token, '/api/collections/social_programs/records?filter=program_id%3D%22program-upgrade%22');
  assert.equal((await sentinelResponse.json() as { totalItems: number }).totalItems, 1, 'rollback must preserve pre-existing business rows');
  await stopPocketBase(instance);

  runPb(['migrate', 'up', `--dir=${dataDir}`, `--migrationsDir=${migrationsDir}`]);
  instance = await startPocketBase(dataDir);
  return { instance, dataDir };
}

type ProviderState = { calls: Map<string, number>; ready: Set<string>; failOnce: Set<string> };

async function startMockProvider(): Promise<{ server: http.Server; url: string; state: ProviderState }> {
  const state: ProviderState = { calls: new Map(), ready: new Set(), failOnce: new Set() };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && url.pathname === '/inventory') {
      const key = `${url.searchParams.get('tenantId')}:${url.searchParams.get('gapTaskId')}`;
      const gapTaskId = String(url.searchParams.get('gapTaskId') || '');
      res.end(JSON.stringify({ items: state.ready.has(key) ? [{
        candidateId: `candidate-${gapTaskId}`, evidenceId: `evidence-${gapTaskId}`, evidenceVersion: 1,
        readiness: 'production_reference', taskRelevance: 0.95, transferability: 0.9,
        rightsClear: true, sceneIds: ['opening'], sourceRef: `mock-provider://${gapTaskId}`,
      }] : [] }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/discover') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tenantId: string; gapTaskId: string; idempotencyKey: string };
      const key = `${body.tenantId}:${body.gapTaskId}`;
      const calls = (state.calls.get(key) || 0) + 1;
      state.calls.set(key, calls);
      if (state.failOnce.has(key) && calls === 1) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: 'injected_provider_failure' }));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      state.ready.add(key);
      res.end(JSON.stringify({ receiptId: `mock-receipt-${body.gapTaskId}`, costCny: 2 }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, state };
}

async function startApplicationHttp(): Promise<{ server: http.Server; url: string }> {
  const app = express();
  app.use(express.json());
  app.use(dataAuthorityRequestScope);
  app.use('/api/overseas/social-programs', createSocialProgramsRouter(pbStore, true));
  app.use(((error, _req, res, _next) => {
    res.status(500).json({ error: error instanceof Error ? error.message : 'unknown' });
  }) as express.ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function appJson(appUrl: string, userToken: string, requestPath: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${appUrl}${requestPath}`, {
    ...init,
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${userToken}`,
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json() };
}

async function createProgram(appUrl: string, userToken: string, brandName: string): Promise<any> {
  const created = await appJson(appUrl, userToken, '/api/overseas/social-programs', {
    method: 'POST', body: JSON.stringify({
      brandName, market: 'US', targetAudience: 'B2B buyer',
      candidatePlatforms: ['tiktok', 'facebook', 'instagram', 'youtube'], route: 'cold_start',
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const platform of ['tiktok', 'facebook', 'instagram', 'youtube']) {
    for (let position = 1; position <= 2; position += 1) {
      const account = await appJson(appUrl, userToken, `/api/overseas/social-programs/${created.body.item.programId}/accounts`, {
        method: 'POST', body: JSON.stringify({
          platform, displayName: `${brandName} ${platform} ${position}`, businessRole: 'lead',
          audiencePromise: 'verified buyer guidance', contentPromise: 'evidence-backed content',
        }),
      });
      assert.equal(account.status, 201, JSON.stringify(account.body));
    }
  }
  return created.body.item;
}

async function prepareAuthoritativeOperatingPlan(input: {
  appUrl: string;
  pbUrl: string;
  userToken: string;
  tenantId: string;
  programId: string;
}): Promise<any> {
  const token = await adminToken(input.pbUrl);
  const now = new Date().toISOString();
  await ensureReleaseFixtureCollection(input.pbUrl, token);

  const profile = await adminRequest(input.pbUrl, token, '/api/collections/tenant_profiles/records', {
    method: 'POST', body: JSON.stringify({
      tenant_id: input.tenantId,
      profile: {
        company: { name: 'Release Factory', description: 'Verified ISO production and batch traceability.', mainMarkets: 'US', primaryLanguages: 'en' },
        products: { highlights: 'Documented batch traceability', items: [{ name: 'Release Serum', images: [{ id: 'release-product-image' }] }] },
        brand: { usp: 'Verified batch traceability', taboos: 'No unsupported medical claims' },
        strategy: { currentGoal: 'Generate qualified wholesale inquiries', focusProducts: 'Release Serum', focusMarkets: 'US' },
        customers: { targetProfiles: 'B2B beauty buyer' },
      },
      updated_by: 'release-harness',
    }),
  });
  assert.equal(profile.status, 200, `release profile create failed: ${await profile.text()}`);

  const accountsResponse = await appJson(input.appUrl, input.userToken, `/api/overseas/social-programs/${input.programId}/accounts`);
  assert.equal(accountsResponse.status, 200, JSON.stringify(accountsResponse.body));
  const accounts = accountsResponse.body.items as Array<{ accountId: string; version: number; platform: string }>;
  const activeAccount = accounts[0]!;
  const accountRows = await adminRequest(input.pbUrl, token, `/api/collections/social_owned_accounts/records?filter=${encodeURIComponent(`tenant_id = "${input.tenantId}" && account_id = "${activeAccount.accountId}"`)}`);
  const accountRowsBody = await accountRows.json() as { items?: Array<{ id: string; payload: Record<string, unknown> }>; message?: string };
  assert.equal(accountRows.status, 200, `release account lookup failed: ${JSON.stringify(accountRowsBody)}`);
  const accountRow = accountRowsBody.items?.[0];
  assert.ok(accountRow, 'release active account row missing');
  const activatedAccount = await adminRequest(input.pbUrl, token, `/api/collections/social_owned_accounts/records/${accountRow.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'active', payload: { ...accountRow.payload, status: 'active' } }),
  });
  assert.equal(activatedAccount.status, 200, `release account activation fixture failed: ${await activatedAccount.text()}`);

  const playbook = await appJson(input.appUrl, input.userToken, `/api/overseas/social-programs/${input.programId}/accounts/${activeAccount.accountId}/playbook`, {
    method: 'PUT', body: JSON.stringify({
      expectedAccountVersion: activeAccount.version,
      audience: ['B2B beauty buyer'], pillars: ['verified production proof'], evidenceRules: ['cite versioned enterprise facts'],
      conversionRoute: {
        entryType: 'form', entryRef: 'https://example.invalid/release-inquiry', callToAction: 'Request verified wholesale details',
        qualificationFields: ['company', 'volume'], handoffTarget: 'release-sales-owner', verifiedAt: now,
      },
      activate: true,
    }),
  });
  assert.equal(playbook.status, 201, JSON.stringify(playbook.body));

  const config = await adminRequest(input.pbUrl, token, '/api/collections/digital_employee_configs/records', {
    method: 'POST', body: JSON.stringify({
      tenant_id: input.tenantId, status: 'active', activated_at: now, config_version: 1,
      config: {
        autonomyMode: 'managed', approvalOwner: 'release-sales-owner', videoLanguages: ['en'],
        enabledWorkflows: ['product_content', 'content_publish', 'customer_segmentation'],
        publishingTargets: [{ platform: activeAccount.platform, accountId: activeAccount.accountId, accountLabel: 'Release account' }],
      },
      updated_by: 'release-harness', created_at: now, updated_at: now,
    }),
  });
  assert.equal(config.status, 200, `release digital employee config create failed: ${await config.text()}`);
  const studio = await adminRequest(input.pbUrl, token, '/api/collections/studio_production_defaults/records', {
    method: 'POST', body: JSON.stringify({ tenant_id: input.tenantId, version: 1, payload: { presenters: [{ id: 'release-presenter', authorized: true }] } }),
  });
  assert.equal(studio.status, 200, `release studio defaults create failed: ${await studio.text()}`);

  const capacities = Object.fromEntries(accounts.map(account => [account.accountId, account.accountId === activeAccount.accountId ? 1 : 0]));
  const constraints = await appJson(input.appUrl, input.userToken, `/api/overseas/social-programs/${input.programId}/operating-constraints`, {
    method: 'PUT', body: JSON.stringify({
      expectedVersion: 0, weeklyBudgetCny: 100, costPerOriginalCny: 20, costPerAdaptationCny: 10,
      materialUnitsPerOriginal: 1, productionItemsPerDay: 1, interactionItemsPerWeek: 10, salesLeadsPerWeek: 5,
      expectedInteractionsPerPublication: 1, expectedLeadsPerPublication: 1, accountWeeklyPublicationCapacity: capacities,
    }),
  });
  assert.equal(constraints.status, 201, JSON.stringify(constraints.body));
  const resolution = await appJson(input.appUrl, input.userToken, `/api/overseas/social-programs/${input.programId}/operating-plan/resolve`, {
    method: 'POST', body: JSON.stringify({
      weekStart: '2026-09-21', desiredOriginalContents: 1, desiredAdaptations: 0,
      requestedReferenceMode: 'ordinary_inspiration', expectedSnapshotVersion: 0,
    }),
  });
  assert.equal(resolution.status, 201, JSON.stringify(resolution.body));
  assert.equal(resolution.body.item.goal.status, 'ready');
  assert.equal(resolution.body.item.capacityPlan.publicationQuota, 1);
  assert.equal(resolution.body.item.automationPolicy.status, 'allowed');
  return resolution.body;
}

async function provisionUser(pbUrl: string, tenantId: string, suffix: string): Promise<string> {
  const token = await adminToken(pbUrl);
  const email = `release-${suffix}@example.invalid`;
  const password = `release-user-${suffix}-password-2026`;
  const created = await adminRequest(pbUrl, token, '/api/collections/users/records', {
    method: 'POST', body: JSON.stringify({
      email, password, passwordConfirm: password, verified: true, emailVisibility: false, tenantId,
    }),
  });
  assert.equal(created.status, 200, `release user create failed: ${await created.text()}`);
  const authenticated = await fetch(`${pbUrl}/api/collections/users/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: email, password }),
  });
  if (!authenticated.ok) throw new Error(`release user auth failed (${authenticated.status}): ${await authenticated.text()}`);
  return String((await authenticated.json() as { token?: string }).token || '');
}

async function seedGapTask(tenantId: string, gapTaskId: string, budgetLimitCny = 5): Promise<void> {
  const now = new Date().toISOString();
  await pbCreateStrict('social_discovery_gap_tasks', {
    tenant_id: tenantId, gapTaskId, upstreamTaskRef: `weekly-${gapTaskId}`, productionGap: 'opening proof',
    status: 'collecting', stopReason: '', budgetLimitCny, spentCny: 0,
    taskGap: {
      description: 'opening proof', requiredSceneIds: ['opening'], minimumReferences: 1,
      requiredReadiness: 'production_reference', requestedModes: ['momentum', 'account', 'innovation'],
    },
    budget: { currency: 'CNY', limitCny: budgetLimitCny, spentCny: 0 },
    attemptCount: 0, lastError: null, lastAttemptAt: null, referenceSelectionRef: null,
    runRefs: [], selectedEvidenceRefs: [], createdAt: now, updatedAt: now,
  });
}

async function runWorker(input: { tenantId: string; gapTaskId: string; providerUrl: string; workerId: string }): Promise<{ code: number; output: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(repositoryRoot, 'scripts/social-operating-release-worker.ts')], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PB_URL: process.env.PB_URL,
      PB_ADMIN_EMAIL: adminEmail,
      PB_ADMIN_PASSWORD: adminPassword,
      NODE_ENV: 'test',
      RELEASE_TENANT_ID: input.tenantId,
      RELEASE_GAP_TASK_ID: input.gapTaskId,
      RELEASE_PROVIDER_URL: input.providerUrl,
      RELEASE_WORKER_ID: input.workerId,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const code = await new Promise<number>(resolve => child.once('exit', value => resolve(value ?? 1)));
  return { code, output };
}

async function loadGapTask(tenantId: string, gapTaskId: string): Promise<any> {
  const result = await pbListStrict<any>('social_discovery_gap_tasks', {
    filter: `tenant_id = "${tenantId}" && gapTaskId = "${gapTaskId}"`, page: 1, perPage: 1,
  });
  return result.items[0];
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>(resolve => server.close(() => resolve()));
}

let pocketBase: RunningPocketBase | null = null;
let application: { server: http.Server; url: string } | null = null;
let provider: Awaited<ReturnType<typeof startMockProvider>> | null = null;
try {
  const drill = await migrationDrill();
  pocketBase = drill.instance;
  process.env.PB_URL = pocketBase.url;
  process.env.PB_ADMIN_EMAIL = adminEmail;
  process.env.PB_ADMIN_PASSWORD = adminPassword;
  process.env.NODE_ENV = 'test';
  invalidatePbAdminToken();

  application = await startApplicationHttp();
  provider = await startMockProvider();
  const tenantA = 'tenant-release-a';
  const tenantB = 'tenant-release-b';
  let tokenA = await provisionUser(pocketBase.url, tenantA, 'a');
  const tokenB = await provisionUser(pocketBase.url, tenantB, 'b');
  const programA = await createProgram(application.url, tokenA, 'Release A');
  await createProgram(application.url, tokenB, 'Release B');
  const crossTenant = await appJson(application.url, tokenB, `/api/overseas/social-programs/${programA.programId}`);
  assert.equal(crossTenant.status, 404, 'tenant B must not read tenant A program over HTTP');

  const currentProgram = await appJson(application.url, tokenA, `/api/overseas/social-programs/${programA.programId}`);
  const operatingPlan = await prepareAuthoritativeOperatingPlan({
    appUrl: application.url, pbUrl: pocketBase.url, userToken: tokenA, tenantId: tenantA, programId: programA.programId,
  });
  const accountId = operatingPlan.item.capacityPlan.accountQuotas.find((item: { publicationQuota: number }) => item.publicationQuota > 0)?.accountId;
  assert.ok(accountId, 'authoritative capacity plan must allocate the release publication');
  const factRef = operatingPlan.item.goal.publicFactRefs[0];
  assert.ok(factRef, 'authoritative business goal must expose a versioned public fact');
  const draftResponse = await appJson(application.url, tokenA, `/api/overseas/social-programs/${programA.programId}/operating-packages`, {
    method: 'POST', body: JSON.stringify({
      ...operatingPlan.weeklyAuthority,
      weekStart: '2026-09-21', objective: 'release chain', successCriteria: ['durable receipt'],
      perItemBudgetCny: 20,
      publicationTasks: [{
        accountId, businessProposition: 'Verified batch traceability for wholesale buyers',
        cta: 'Request verified wholesale details', factRefs: [factRef],
        metricTargets: ['1 qualified wholesale inquiry'], publishWindow: '2026-09-21T14:00:00.000Z',
      }],
    }),
  });
  assert.equal(draftResponse.status, 201, JSON.stringify(draftResponse.body));
  const draft = draftResponse.body.item;
  assert.deepEqual(draft.operatingDecisionSnapshotRef, operatingPlan.weeklyAuthority.operatingDecisionSnapshotRef);
  assert.deepEqual(draft.businessContentGoalRef, operatingPlan.item.snapshot.businessContentGoalRef);
  assert.equal(draft.planningBlockers.length, 0, JSON.stringify(draft.planningBlockers));
  const activeResponse = await appJson(application.url, tokenA, `/api/overseas/social-programs/${programA.programId}/operating-packages/${draft.packageId}/activate`, {
    method: 'POST', body: JSON.stringify({
      expectedVersion: 1, expectedProgramVersion: currentProgram.body.item.version, authorizePublishing: true,
    }),
  });
  assert.equal(activeResponse.status, 200, JSON.stringify(activeResponse.body));
  assert.equal(activeResponse.body.item.socialContentPackage.authorization.allowRealPublishing, true);

  const concurrentGap = 'gap-concurrent';
  await seedGapTask(tenantA, concurrentGap);
  let signals = await inspectSocialOperatingSignals({ role: 'web' });
  assert.ok(signals.queueBacklog.count >= 1, 'collecting tasks must surface as queue backlog');
  const concurrent = await Promise.all([
    runWorker({ tenantId: tenantA, gapTaskId: concurrentGap, providerUrl: provider.url, workerId: 'worker-a' }),
    runWorker({ tenantId: tenantA, gapTaskId: concurrentGap, providerUrl: provider.url, workerId: 'worker-b' }),
  ]);
  assert.ok(concurrent.every(item => item.code === 0), concurrent.map(item => item.output).join('\n'));
  assert.equal(provider.state.calls.get(`${tenantA}:${concurrentGap}`), 1, 'durable lease permits one external provider call');
  assert.equal((await loadGapTask(tenantA, concurrentGap)).status, 'resumed');

  const recoveryGap = 'gap-recovery';
  await seedGapTask(tenantA, recoveryGap);
  provider.state.failOnce.add(`${tenantA}:${recoveryGap}`);
  const failed = await runWorker({ tenantId: tenantA, gapTaskId: recoveryGap, providerUrl: provider.url, workerId: 'worker-before-restart' });
  assert.notEqual(failed.code, 0, 'injected provider outage must fail the worker process');
  assert.equal((await loadGapTask(tenantA, recoveryGap)).status, 'collecting', 'failed work remains recoverable');
  const recovered = await runWorker({ tenantId: tenantA, gapTaskId: recoveryGap, providerUrl: provider.url, workerId: 'worker-after-restart' });
  assert.equal(recovered.code, 0, recovered.output);
  assert.equal((await loadGapTask(tenantA, recoveryGap)).status, 'resumed', 'replacement worker resumes persisted work');

  const budgetGap = 'gap-budget';
  await seedGapTask(tenantA, budgetGap, 0);
  const budgetWorker = await runWorker({ tenantId: tenantA, gapTaskId: budgetGap, providerUrl: provider.url, workerId: 'worker-budget' });
  assert.equal(budgetWorker.code, 0, budgetWorker.output);
  assert.equal((await loadGapTask(tenantA, budgetGap)).stopReason, 'budget_exhausted');
  assert.equal(provider.state.calls.get(`${tenantA}:${budgetGap}`) || 0, 0, 'exhausted budget must not call provider');

  await pbCreateStrict('posts', {
    tenant_id: tenantA, platform: 'tiktok', track_code: 'release-unknown-receipt',
    stats: { status: 'needs_attention', publishResults: { account: { status: 'unknown', attemptId: 'attempt-release' } } },
  });
  signals = await inspectSocialOperatingSignals({ role: 'web' });
  assert.equal(signals.worker.ready, true, 'a real worker heartbeat must satisfy split-web readiness');
  assert.ok(signals.unknownReceipts.count >= 1, 'unknown provider receipts must be observable');
  assert.ok(signals.exhaustedBudgets.count >= 1, 'budget exhaustion must be observable');

  const latestProgram = await appJson(application.url, tokenA, `/api/overseas/social-programs/${programA.programId}`);
  const retiredResponse = await appJson(application.url, tokenA, `/api/overseas/social-programs/${programA.programId}/operating-packages/${draft.packageId}/retire`, {
    method: 'POST', body: JSON.stringify({ expectedVersion: 1, expectedProgramVersion: latestProgram.body.item.version }),
  });
  assert.equal(retiredResponse.status, 200, JSON.stringify(retiredResponse.body));
  assert.equal(retiredResponse.body.item.socialContentPackage.authorization.allowRealPublishing, false);
  signals = await inspectSocialOperatingSignals({ role: 'web' });
  assert.ok(signals.invalidAuthorizations.count >= 1, 'revoked publishing authorization must be observable');

  await stopPocketBase(pocketBase);
  pocketBase = await startPocketBase(drill.dataDir);
  process.env.PB_URL = pocketBase.url;
  invalidatePbAdminToken();
  tokenA = await fetch(`${pocketBase.url}/api/collections/users/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: 'release-a@example.invalid', password: 'release-user-a-password-2026' }),
  }).then(async response => {
    if (!response.ok) throw new Error(`release user re-auth failed (${response.status}): ${await response.text()}`);
    return String((await response.json() as { token?: string }).token || '');
  });
  const afterDatabaseRestart = await appJson(application.url, tokenA, `/api/overseas/social-programs/${programA.programId}`);
  assert.equal(afterDatabaseRestart.status, 200, 'HTTP application must recover after PocketBase restart');

  await closeServer(application.server);
  application = null;
  await closeServer(provider.server);
  provider = null;
  await stopPocketBase(pocketBase);
  pocketBase = null;

  const backupDir = path.join(root, 'backup-data');
  fs.cpSync(drill.dataDir, backupDir, { recursive: true });
  pocketBase = await startPocketBase(drill.dataDir);
  process.env.PB_URL = pocketBase.url;
  invalidatePbAdminToken();
  await seedGapTask(tenantA, 'gap-after-backup');
  await stopPocketBase(pocketBase);
  pocketBase = null;
  fs.rmSync(drill.dataDir, { recursive: true, force: true });
  fs.cpSync(backupDir, drill.dataDir, { recursive: true });
  pocketBase = await startPocketBase(drill.dataDir);
  process.env.PB_URL = pocketBase.url;
  invalidatePbAdminToken();
  assert.equal((await pbListStrict('social_programs', { filter: `tenant_id = "${tenantA}" && program_id = "${programA.programId}"`, page: 1, perPage: 1 })).totalItems, 1,
    'backup restore preserves pre-backup business data');
  assert.equal((await pbListStrict('social_discovery_gap_tasks', { filter: 'gapTaskId = "gap-after-backup"', page: 1, perPage: 1 })).totalItems, 0,
    'backup restore removes post-backup mutations');

  console.log('Social operating release gate passed: real PocketBase fresh/upgrade/rollback/restore, HTTP isolation, worker concurrency/restart/recovery, authorization and operational signals.');
} finally {
  await closeServer(application?.server || null);
  await closeServer(provider?.server || null);
  await stopPocketBase(pocketBase);
  if (root.startsWith(path.join(os.tmpdir(), 'lingshu-social-release-'))) fs.rmSync(root, { recursive: true, force: true });
}
