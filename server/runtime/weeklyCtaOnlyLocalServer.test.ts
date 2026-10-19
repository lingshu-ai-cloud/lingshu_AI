import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { createWeeklyCtaOnlyLocalApp, weeklyCtaOnlyLoopbackPeerAllowed } from './weeklyCtaOnlyLocalServer.js';
import { issueLocalDemoToken, verifyLocalDemoToken } from '../auth/localDemoToken.js';
import { createWeeklyTaskCardTokenAuthority } from './weeklyTaskCardToken.js';
import { prepareWeeklyEnterpriseFactFixture } from './weeklyEnterpriseFactSupplement.fixture.js';
import { adoptWeeklyAutomationTemplate } from '../socialPrograms/weeklyAutomationTemplate.js';
import { WEEKLY_PUBLICATION_PRODUCT_SELECTIONS } from '../socialPrograms/weeklyPublicationProductSelection.js';
import { WEEKLY_SAMPLE_POLICY_CANDIDATES } from '../socialPrograms/weeklySamplePolicyEvidence.js';
import type { AuthProvider } from '../storage/datastore.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import ffmpegStatic from 'ffmpeg-static';
import { enterpriseAssetObjectKey } from '../storage/enterpriseAssets.js';

async function freePort() {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

test('CTA-only HTTP allows existing scoped Bearer contact but never unlocks sample or other API', async t => {
  const f = await prepareWeeklyEnterpriseFactFixture(t);
  const scope = { tenantId: f.task.tenantId, programId: f.task.programId, packageId: f.task.packageId, packageVersion: 1 };
  await adoptWeeklyAutomationTemplate(f.store, scope, 'owner');
  const tokenAuth: AuthProvider = { async verifyToken(header) { return header === 'Bearer valid' ? { tenantId: scope.tenantId, userId: 'owner', dataAuthority: 'local' } : null; } };
  const port = await freePort();
  const server = createWeeklyCtaOnlyLocalApp(f.store, tokenAuth, { port, tenantId: scope.tenantId, userId: 'owner', programId: scope.programId, packageId: scope.packageId, packageVersion: scope.packageVersion }).listen(port, '127.0.0.1');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${port}`;
  const endpoint = `${root}/api/overseas/social-programs/${scope.programId}/operating-packages/${scope.packageId}`;
  const bearer = { Authorization: 'Bearer valid' };
  assert.equal((await fetch(`${endpoint}/collection-runtime?version=1`)).status, 401);
  assert.equal((await fetch(`${endpoint}/collection-runtime?version=2`, { headers: bearer })).status, 409);
  const collectionRuntime = await fetch(`${endpoint}/collection-runtime?version=1`, { headers: bearer });
  assert.equal(collectionRuntime.status, 200);
  assert.equal(collectionRuntime.headers.get('cache-control'), 'private, no-store');
  const collectionState = (await collectionRuntime.json() as { item: { status: string; operationallyVerified: boolean } }).item;
  assert.equal(collectionState.operationallyVerified, false);
  assert.ok(['configuration_present', 'needs_intervention'].includes(collectionState.status));
  assert.equal((await fetch(`${endpoint}/cta-contact?version=1`)).status, 401);
  assert.equal((await fetch(`${endpoint}/product-footage?version=1`)).status, 401);
  assert.equal((await fetch(`${endpoint}/cta-contact?version=1`, { headers: { Cookie: 'lingshu_asset_session=x' } })).status, 401);
  assert.equal((await fetch(`${endpoint}/cta-contact?version=1`, { headers: { Authorization: 'Bearer other' } })).status, 401);
  const spoofedHostStatus = await new Promise<number>((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: `/api/overseas/social-programs/${scope.programId}/operating-packages/${scope.packageId}/cta-contact?version=1`, headers: { Host: 'evil.test', Authorization: 'Bearer valid' } }, response => { response.resume(); resolve(response.statusCode ?? 0); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(spoofedHostStatus, 403);
  assert.equal((await fetch(`${endpoint}/execution-pipeline/start-independent`, { headers: bearer })).status, 404);
  assert.equal((await fetch(`${endpoint}/cta-contact?version=1`, { method: 'HEAD', headers: bearer })).status, 404);
  assert.equal((await fetch(`${endpoint}/cta-contact`, { method: 'OPTIONS', headers: bearer })).status, 404);
  assert.equal((await fetch(`${root}/api/overseas/auth/local-preview-session`, { method: 'POST', headers: { Origin: root, 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  const first = await fetch(`${endpoint}/cta-contact?version=1`, { headers: bearer });
  assert.equal(first.status, 200);
  const footage = await fetch(`${endpoint}/product-footage?version=1`, { headers: bearer });
  assert.equal(footage.status, 409, 'an incomplete fixture has no certified publication choice and must not infer a product');
  const before = (await first.json() as { item: { contextHash: string; status: string } }).item;
  assert.equal(before.status, 'missing');
  const payload = { expectedPackageVersion: 1, contactChannel: 'whatsapp', contactValue: '+8619653282176', expectedContextHash: before.contextHash, expectedReceiptId: null };
  const post = (headers: Record<string, string>) => fetch(`${endpoint}/cta-contact`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const foreignPackage = `${root}/api/overseas/social-programs/${scope.programId}/operating-packages/another-package`;
  assert.equal((await fetch(`${foreignPackage}/cta-contact?version=1`, { headers: bearer })).status, 404);
  assert.equal((await fetch(`${endpoint}/cta-contact?version=2`, { headers: bearer })).status, 409);
  assert.equal((await fetch(`${endpoint}/product-footage?version=2`, { headers: bearer })).status, 409);
  assert.equal((await fetch(`${foreignPackage}/cta-contact`, { method: 'POST', headers: { ...bearer, Origin: root, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 404);
  assert.equal((await fetch(`${endpoint}/cta-contact`, { method: 'POST', headers: { ...bearer, Origin: root, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, expectedPackageVersion: 2 }) })).status, 409);
  assert.equal((await f.store.list('social_weekly_cta_contacts')).totalItems, 0, 'wrong package or old version cannot write');
  assert.equal((await post({ ...bearer, 'Content-Type': 'application/json' })).status, 403, 'mutations require exact Origin');
  assert.equal((await post({ ...bearer, Origin: 'http://evil.test', 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post({ ...bearer, Origin: root, 'Content-Type': 'text/plain' })).status, 415);
  const saved = await post({ ...bearer, Origin: root, 'Content-Type': 'application/json' });
  assert.equal(saved.status, 200);
  const item = (await saved.json() as { item: { status: string; samplePromiseConfirmed: boolean } }).item;
  assert.equal(item.status, 'recorded');
  assert.equal(item.samplePromiseConfirmed, false);
  assert.equal((await f.store.list('social_weekly_cta_contacts')).totalItems, 1);
  assert.equal((await f.store.list('social_local_weekly_consumers')).totalItems, 0);
  assert.equal((await f.store.list('social_content_tasks')).totalItems, 0);
  assert.equal((await f.store.list('social_content_jobs')).totalItems, 0);
});

test('isolated CTA-only process exposes no issuer or production route and writes no store files', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekly-cta-only-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storage = path.join(dir, 'store');
  const objects = path.join(storage, 'objects');
  const accounts = path.join(dir, 'accounts.json');
  const tenants = path.join(dir, 'tenants.json');
  mkdirSync(storage);
  mkdirSync(objects);
  writeFileSync(accounts, '[]');
  writeFileSync(tenants, '[]');
  const port = await freePort();
  const child = spawn(path.resolve('node_modules/.bin/tsx'), ['server/runtime/startWeeklyCtaOnlyLocal.ts'], {
    cwd: path.resolve('.'),
    env: { ...process.env, NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', LINGSHU_LOCAL_PREVIEW: '1', LOCAL_STORE_DIR: storage, LOCAL_OBJECT_STORAGE_ROOT: objects, OBJECT_STORAGE_DRIVER: 'local', LOCAL_AUTH_ACCOUNTS_FILE: accounts, LOCAL_TENANTS_DATA_FILE: tenants, WEEKLY_CTA_ONLY_PORT: String(port), WEEKLY_CTA_ONLY_TENANT_ID: 'tenant', WEEKLY_CTA_ONLY_USER_ID: 'owner', WEEKLY_CTA_ONLY_PROGRAM_ID: 'p', WEEKLY_CTA_ONLY_PACKAGE_ID: 'w', WEEKLY_CTA_ONLY_PACKAGE_VERSION: '1', PB_AUTO_START: 'false' },
    stdio: 'ignore',
  });
  t.after(() => { child.kill('SIGTERM'); });
  const root = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`${root}/api/overseas/unknown`); if (response.status === 404) { ready = true; break; } } catch { /* startup */ }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'separate process started');
  assert.equal((await fetch(`${root}/api/overseas/social-programs/p/operating-packages/w/cta-contact?version=1`)).status, 401);
  assert.equal((await fetch(`${root}/api/overseas/social-programs/p/operating-packages/w/execution-pipeline/start-independent`)).status, 404);
  assert.equal((await fetch(`${root}/api/overseas/auth/local-preview-session`, { method: 'POST', headers: { Origin: root, 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.deepEqual(readdirSync(storage), ['objects']);
  assert.equal(readFileSync(accounts, 'utf8'), '[]');
  assert.equal(readFileSync(tenants, 'utf8'), '[]');
});

test('opt-in local task card issues only a short-lived token for the exact registered customer', async t => {
  assert.equal(weeklyCtaOnlyLoopbackPeerAllowed('192.0.2.1'), false);
  assert.equal(weeklyCtaOnlyLoopbackPeerAllowed('127.0.0.1'), true);
  const dir = mkdtempSync(path.join(tmpdir(), 'weekly-card-session-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const storage = path.join(dir, 'store'), objects = path.join(storage, 'objects'), ui = path.join(dir, 'ui');
  const accounts = path.join(dir, 'accounts.json'), tenants = path.join(dir, 'tenants.json');
  mkdirSync(storage); mkdirSync(objects); mkdirSync(ui);
  writeFileSync(path.join(ui, 'weekly-task-card.html'), '<!doctype html><html><body>isolated task card</body></html>');
  writeFileSync(accounts, JSON.stringify([{ userId: 'owner', tenantId: 'tenant', email: 'owner@local.test', name: 'Owner',
    accountType: 'customer', role: 'admin', salt: 'unused', passwordHash: 'unused', createdAt: '2026-10-18T00:00:00Z' }]));
  writeFileSync(tenants, JSON.stringify([{ id: 'tenant', name: 'Test' }]));
  const port = await freePort(), root = `http://127.0.0.1:${port}`;
  const common = { ...process.env, NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true', LINGSHU_LOCAL_PREVIEW: '1',
    LOCAL_STORE_DIR: storage, LOCAL_OBJECT_STORAGE_ROOT: objects, OBJECT_STORAGE_DRIVER: 'local',
    LOCAL_AUTH_ACCOUNTS_FILE: accounts, LOCAL_TENANTS_DATA_FILE: tenants, WEEKLY_CTA_ONLY_PORT: String(port),
    WEEKLY_CTA_ONLY_TENANT_ID: 'tenant', WEEKLY_CTA_ONLY_USER_ID: 'owner', WEEKLY_CTA_ONLY_PROGRAM_ID: 'program',
    WEEKLY_CTA_ONLY_PACKAGE_ID: 'package', WEEKLY_CTA_ONLY_PACKAGE_VERSION: '1', WEEKLY_CTA_ONLY_UI_DIR: ui,
    WEEKLY_CTA_ONLY_SESSION_ISSUER: '1', LOCAL_DEMO_TOKEN_SECRET: 'isolated-task-card-test-secret', PB_AUTO_START: 'false' };
  let child = spawn(path.resolve('node_modules/.bin/tsx'), ['server/runtime/startWeeklyCtaOnlyLocal.ts'],
    { cwd: path.resolve('.'), env: common, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${root}/weekly-task-card`)).status === 200) { ready = true; break; } } catch { /* startup */ }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  const endpoint = `${root}/api/overseas/auth/local-task-session`;
  const post = (origin?: string) => fetch(endpoint, { method: 'POST',
    headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await post()).status, 403);
  assert.equal((await post('http://evil.test')).status, 403);
  const issued = await post(root);
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get('Cache-Control'), 'no-store');
  const token = (await issued.json() as { token: string }).token;
  assert.match(token, /^weekly-cta-card\.v1\./);
  assert.equal(verifyLocalDemoToken(`Bearer ${token}`), null, 'ordinary local-demo verifier rejects card audience and prefix');
  assert.equal((await fetch(`${root}/api/overseas/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  const claims = JSON.parse(Buffer.from(token.split('.')[2]!, 'base64url').toString('utf8')) as { userId: string; tenantId: string; programId: string; packageId: string; packageVersion: number; exp: number; iat: number };
  assert.deepEqual({ userId: claims.userId, tenantId: claims.tenantId, programId: claims.programId,
    packageId: claims.packageId, packageVersion: claims.packageVersion, ttl: claims.exp - claims.iat },
  { userId: 'owner', tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 1, ttl: 900 });
  const previousSecret = process.env.LOCAL_DEMO_TOKEN_SECRET;
  process.env.LOCAL_DEMO_TOKEN_SECRET = common.LOCAL_DEMO_TOKEN_SECRET;
  const ordinary = issueLocalDemoToken({ userId: 'owner', tenantId: 'tenant' });
  if (previousSecret === undefined) delete process.env.LOCAL_DEMO_TOKEN_SECRET; else process.env.LOCAL_DEMO_TOKEN_SECRET = previousSecret;
  assert.equal((await fetch(`${root}/api/overseas/auth/me`, { headers: { Authorization: `Bearer ${ordinary}` } })).status, 401,
    'ordinary local-demo Bearer is not accepted by the card bridge');
  assert.equal((await fetch(`${root}/api/overseas/social-programs/program/operating-packages/package/execution-pipeline/start-independent`,
    { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
  child = spawn(path.resolve('node_modules/.bin/tsx'), ['server/runtime/startWeeklyCtaOnlyLocal.ts'],
    { cwd: path.resolve('.'), env: common, stdio: 'ignore' });
  ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${root}/weekly-task-card`)).status === 200) { ready = true; break; } } catch { /* restart */ }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  assert.equal((await fetch(`${root}/api/overseas/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401,
    'a process restart revokes the earlier card token');
  assert.equal((await post(root)).status, 200, 'the new process can issue its own card token');
  writeFileSync(accounts, JSON.stringify([{ userId: 'owner', tenantId: 'tenant', email: 'owner@local.test', name: 'Owner',
    accountType: 'admin', role: 'admin', salt: 'unused', passwordHash: 'unused', createdAt: '2026-10-18T00:00:00Z' }]));
  assert.equal((await post(root)).status, 403, 'a platform account with the same IDs is not the registered customer');
  writeFileSync(accounts, '[]');
  assert.equal((await fetch(`${root}/api/overseas/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401,
    'removing the registered account revokes the token');
  assert.equal((await post(root)).status, 403, 'an absent whitelisted user cannot be issued a token');
});

test('task-card tokens are scoped, short lived, and independently signed', () => {
  const scope = { tenantId: 'tenant', userId: 'owner', programId: 'p', packageId: 'w', packageVersion: 7 };
  const first = createWeeklyTaskCardTokenAuthority(scope);
  const second = createWeeklyTaskCardTokenAuthority(scope);
  const now = Date.parse('2026-10-18T00:00:00Z');
  const token = first.issue(now);
  assert.equal(first.verify(`Bearer ${token}`, now), true);
  assert.equal(first.verify(`Bearer ${token}`, now + 15 * 60_000), false);
  assert.equal(second.verify(`Bearer ${token}`, now), false);
  assert.equal(verifyLocalDemoToken(`Bearer ${token}`, { nowMs: now }), null);
});

test('isolated bridge accepts scoped selection and local PDF candidate without granting production', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'weekly-cta-bridge-'));
  const defaultMaterialFile = path.resolve('data/materials.json');
  const defaultMaterialBytes = existsSync(defaultMaterialFile) ? readFileSync(defaultMaterialFile) : null;
  const objects = path.join(dir, 'objects');
  mkdirSync(objects);
  const previous = { store: process.env.LOCAL_STORE_DIR, root: process.env.LOCAL_OBJECT_STORAGE_ROOT,
    driver: process.env.OBJECT_STORAGE_DRIVER, materialFile: process.env.MATERIAL_LIBRARY_FILE };
  process.env.LOCAL_STORE_DIR = dir;
  process.env.LOCAL_OBJECT_STORAGE_ROOT = objects;
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  process.env.MATERIAL_LIBRARY_FILE = path.join(dir, 'materials.json');
  t.after(() => {
    if (previous.store === undefined) delete process.env.LOCAL_STORE_DIR; else process.env.LOCAL_STORE_DIR = previous.store;
    if (previous.root === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previous.root;
    if (previous.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previous.driver;
    if (previous.materialFile === undefined) delete process.env.MATERIAL_LIBRARY_FILE; else process.env.MATERIAL_LIBRARY_FILE = previous.materialFile;
    rmSync(dir, { recursive: true, force: true });
  });
  const f = await prepareWeeklyEnterpriseFactFixture(t);
  const scope = { tenantId: f.task.tenantId, programId: f.task.programId, packageId: f.task.packageId, packageVersion: 1 };
  const packageRow = (await f.store.list<any>('social_weekly_operating_packages')).items[0]!;
  const publication = { ...packageRow.payload.socialContentPackage.publicationTasks[0], motherContentId: 'mother', status: 'planned' };
  await f.store.update('social_weekly_operating_packages', packageRow.id, { payload: { ...packageRow.payload,
    socialContentPackage: { ...packageRow.payload.socialContentPackage, publicationTasks: [publication] } } });
  await adoptWeeklyAutomationTemplate(f.store, scope, 'owner');
  const tokenAuth: AuthProvider = { async verifyToken(header) { return header === 'Bearer valid'
    ? { tenantId: scope.tenantId, userId: 'owner', dataAuthority: 'local' } : null; } };
  const port = await freePort();
  const server = createWeeklyCtaOnlyLocalApp(f.store, tokenAuth, { port, tenantId: scope.tenantId, userId: 'owner', programId: scope.programId, packageId: scope.packageId, packageVersion: scope.packageVersion }).listen(port, '127.0.0.1');
  t.after(() => server.close());
  const root = `http://127.0.0.1:${port}`;
  const base = `${root}/api/overseas/social-programs/${scope.programId}/operating-packages/${scope.packageId}`;
  const auth = { Authorization: 'Bearer valid' };
  const post = (path: string, body: unknown, headers: Record<string, string> = auth) => fetch(`${base}/${path}`,
    { method: 'POST', headers: { Origin: root, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/product-selection?version=1`)).status, 401);
  assert.equal((await post('product-selection', { expectedPackageVersion: 1 }, {})).status, 401);
  assert.equal((await post('sample-policy-candidates', { pdfDataUrl: 'x'.repeat(70_000) }, {})).status, 401,
    'large candidate parser must not run before authentication');
  const choicesResponse = await fetch(`${base}/product-selection?version=1`, { headers: auth });
  assert.equal(choicesResponse.status, 200, await choicesResponse.clone().text());
  const choices = (await choicesResponse.json()).item;
  const selected = await post('product-selection', { expectedPackageVersion: 1, expectedContextHash: choices.contextHash,
    productId: choices.products[0].id, publicationTaskIds: ['pub'] });
  assert.equal(selected.status, 200, await selected.clone().text());
  assert.equal((await f.store.list(WEEKLY_PUBLICATION_PRODUCT_SELECTIONS)).totalItems, 1);
  const footage = await fetch(`${base}/product-footage?version=1`, { headers: auth });
  assert.equal(footage.status, 200, await footage.clone().text());
  const footageCard = (await footage.json() as { item: { product: { id: string }; status: string; candidateCount: number } }).item;
  assert.equal(footageCard.product.id, choices.products[0].id);
  assert.equal(footageCard.status, 'material_intervention_required');
  assert.equal(footageCard.candidateCount, 0, 'image identity or a publication choice cannot fabricate local footage');
  const uploadBody = { expectedPackageVersion: 1, productId: choices.products[0].id, name: 'same-product.mp4',
    productIdentityEvidenceRef: 'enterprise-document:product-1', rightsEvidenceRef: 'license-document:video-1',
    dataUrl: 'data:video/mp4;base64,' + Buffer.from('not a video').toString('base64') };
  assert.equal((await post('product-footage', uploadBody, {})).status, 401);
  assert.equal((await post('product-footage', { ...uploadBody, productId: 'another-product' })).status, 409);
  assert.equal((await post('product-footage', { ...uploadBody, rightsEvidenceRef: 'confirmed' })).status, 400);
  assert.notEqual((await post('product-footage', uploadBody)).status, 200, 'invalid video bytes are rejected');
  const tinyVideo = path.join(dir, 'tiny.mp4');
  const encoded = spawnSync(ffmpegStatic as string, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=blue:s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', tinyVideo]);
  assert.equal(encoded.status, 0);
  const validVideo = { ...uploadBody, dataUrl: `data:video/mp4;base64,${readFileSync(tinyVideo).toString('base64')}` };
  const uploaded = await post('product-footage', validVideo);
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  const uploadedItem = (await uploaded.json() as { item: { id: string; status: string } }).item;
  assert.equal(uploadedItem.status, 'pending_independent_review');
  assert.equal((await post('product-footage', validVideo)).status, 200, 'same bytes replay without duplicate candidate');
  const uploadedCard = await fetch(`${base}/product-footage?version=1`, { headers: auth });
  const uploadedState = (await uploadedCard.json() as { item: { candidateCount: number; status: string; candidates: Array<{ bytesCurrent: boolean }> } }).item;
  assert.equal(uploadedState.candidates[0]?.bytesCurrent, true);
  assert.equal(uploadedState.status,
    'material_intervention_required', 'upload cannot unlock production');
  const uploadedRecord = readLocalMaterials().find(item => item.id === uploadedItem.id)!;
  assert.equal(uploadedRecord.provenance?.uploadedByUserId, 'owner');
  assert.equal(String(uploadedRecord.objectKey), enterpriseAssetObjectKey(scope.tenantId,
    String(uploadedRecord.sourceUrl).split('/').at(-1)!));
  writeFileSync(path.join(objects, String(uploadedRecord.objectKey)), Buffer.from('changed video bytes'));
  const changedCard = await fetch(`${base}/product-footage?version=1`, { headers: auth });
  assert.equal((await changedCard.json() as { item: { candidates: Array<{ bytesCurrent: boolean }> } }).item.candidates[0]?.bytesCurrent,
    false, 'same material metadata cannot hide changed object bytes');
  assert.equal((await post('product-footage', validVideo)).status, 409,
    'same upload cannot acknowledge a candidate whose stored bytes have drifted');
  saveLocalMaterials([{ id: 'unrelated', tenantId: scope.tenantId, productId: 'another-product', type: 'video',
    name: 'unrelated video', contentSha256: 'a'.repeat(64), provenance: { footageCandidate: { status: 'pending_independent_review' } } },
  { id: 'same-product-pending', tenantId: scope.tenantId, productId: choices.products[0].id, type: 'video',
    name: 'pending video', contentSha256: 'b'.repeat(64), provenance: { footageCandidate: { status: 'pending_independent_review' } } }]);
  const afterCandidate = await fetch(`${base}/product-footage?version=1`, { headers: auth });
  const pendingCard = (await afterCandidate.json() as { item: { status: string; candidateCount: number } }).item;
  assert.equal(pendingCard.candidateCount, 1, 'other products are not projected into this task card');
  assert.equal(pendingCard.status, 'material_intervention_required', 'candidate presence cannot clear the production gap');
  const contextResponse = await fetch(`${base}/sample-policy-candidates?version=1&publicationTaskId=pub`, { headers: auth });
  assert.equal(contextResponse.status, 200, await contextResponse.clone().text());
  const context = (await contextResponse.json()).item;
  const terms = { sampleFeeCny: 0, shippingFeePayer: 'buyer', customsDutyPayer: 'buyer', maximumFreeQuantity: 1,
    eligibleMarkets: ['CN'], eligibleCustomerTypes: ['business_buyer'],
    validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-12-31T23:59:59Z' };
  const pdfDataUrl = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\nPolicy\n%%EOF').toString('base64')}`;
  assert.equal((await post('sample-policy-candidates', { expectedPackageVersion: 1, publicationTaskId: 'pub',
    expectedContextHash: context.contextHash, terms, pdfDataUrl: `data:application/pdf;base64,${'A'.repeat(29 * 1024 * 1024)}` })).status, 413);
  process.env.OBJECT_STORAGE_DRIVER = 'cos';
  assert.equal((await post('sample-policy-candidates', { expectedPackageVersion: 1, publicationTaskId: 'pub',
    expectedContextHash: context.contextHash, terms, pdfDataUrl })).status, 503,
    'candidate cannot fall through to cloud storage');
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  const candidate = await post('sample-policy-candidates', { expectedPackageVersion: 1, publicationTaskId: 'pub',
    expectedContextHash: context.contextHash, terms, pdfDataUrl });
  assert.equal(candidate.status, 201, await candidate.clone().text());
  assert.equal((await candidate.json()).item.authorizesProduction, false);
  assert.equal((await f.store.list(WEEKLY_SAMPLE_POLICY_CANDIDATES)).totalItems, 1);
  assert.equal((await fetch(`${base}/execution-pipeline/start-independent`, { headers: auth })).status, 404);
  assert.equal((await f.store.list('social_content_jobs')).totalItems, 0);
  assert.equal((await f.store.list('social_local_weekly_consumers')).totalItems, 0);
  assert.equal(readdirSync(objects).length, 1);
  assert.equal(existsSync(defaultMaterialFile), defaultMaterialBytes !== null,
    'this isolated fixture must not create the repository default material library');
  if (defaultMaterialBytes) assert.deepEqual(readFileSync(defaultMaterialFile), defaultMaterialBytes,
    'this isolated fixture must not modify an existing material library');
});
