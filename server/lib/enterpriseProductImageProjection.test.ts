import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { enterpriseRouter } from '../routes/enterprise.js';
import { auth, store } from '../storage/index.js';
import { bindDataAuthority, dataAuthorityRequestScope, runWithDataAuthority } from '../storage/dataAuthority.js';
import { mapBoundedInOrder, readLocalMaterials, readMaterialLibrary, saveLocalMaterials } from './materialLibrary.js';

let activeReads = 0;
let peakReads = 0;
const observed = await mapBoundedInOrder(Array.from({ length: 13 }, (_, index) => index), 4, async index => {
  activeReads++;
  peakReads = Math.max(peakReads, activeReads);
  await new Promise(resolve => setTimeout(resolve, 3));
  activeReads--;
  return index * 2;
});
assert.equal(peakReads, 4, 'remote reads are bounded but not serialized');
assert.deepEqual(observed, Array.from({ length: 13 }, (_, index) => index * 2), 'product order is stable');
await assert.rejects(mapBoundedInOrder([1, 2], 2, async index => { if (index === 2) throw Error('remote-read-failed'); return index; }), /remote-read-failed/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-product-projection-'));
const previousFile = process.env.MATERIAL_LIBRARY_FILE;
const previousObjectRoot = process.env.LOCAL_OBJECT_STORAGE_ROOT;
const previousDriver = process.env.OBJECT_STORAGE_DRIVER;
const original = { list: store.list, create: store.create, update: store.update, verify: auth.verifyToken, fetch: globalThis.fetch };
const profiles: Array<Record<string, unknown>> = [];
let server: ReturnType<express.Express['listen']> | undefined;
try {
  process.env.MATERIAL_LIBRARY_FILE = path.join(root, 'materials.json');
  process.env.LOCAL_OBJECT_STORAGE_ROOT = path.join(root, 'objects');
  process.env.OBJECT_STORAGE_DRIVER = 'local';
  store.list = (async (collection: string, query: { where?: Record<string, unknown> }) => {
    const items = collection === 'tenant_profiles' ? profiles.filter(row => row.tenant_id === query.where?.tenant_id) : [];
    return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 2 };
  }) as typeof store.list;
  store.create = (async (collection: string, value: Record<string, unknown>) => {
    if (collection !== 'tenant_profiles') throw Error('unexpected write');
    const row = { ...value, id: `profile-${profiles.length + 1}` }; profiles.push(row); return row;
  }) as typeof store.create;
  store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
    const row = collection === 'tenant_profiles' ? profiles.find(item => item.id === id) : undefined;
    if (!row) return false;
    Object.assign(row, patch); return true;
  }) as typeof store.update;
  auth.verifyToken = (async (token: string) => ({ userId: 'tester', tenantId: token === 'Bearer other' ? 'other-tenant' : 'product-tenant', dataAuthority: 'local' })) as typeof auth.verifyToken;
  // The route's background analysis must never reach a supplier in this test.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('http://127.0.0.1:')) throw Error('external network disabled in projection test');
    return original.fetch(input, init);
  }) as typeof fetch;
  const app = express(); app.use(dataAuthorityRequestScope); app.use((_req, _res, next) => { bindDataAuthority('local'); next(); });
  app.use(express.json({ limit: '2mb' })); app.use('/api/overseas/enterprise', enterpriseRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (route: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + route, { method, headers: { Authorization: 'Bearer self', 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const profileResponse = await request('/api/overseas/enterprise/profile');
  const profile = await profileResponse.json() as Record<string, any>;
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#4477aa' } }).png().toBuffer();
  const upload = await request('/api/overseas/enterprise/assets', 'POST', { name: 'lamp.png', type: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(upload.status, 200);
  const uploaded = await upload.json() as { url: string; material: { id: string; contentSha256: string } };
  assert.match(uploaded.url, /^\/api\/overseas\/enterprise\/assets\/[0-9]+-[0-9a-f-]+\.jpg$/);
  const changed = { ...profile, products: { ...profile.products, items: [{ id: 'lamp-1', name: '灯具', imageUrl: uploaded.url }] } };
  const stale = await request('/api/overseas/enterprise/profile', 'PATCH', changed, { 'If-Match': 'stale-version' });
  assert.equal(stale.status, 409, 'stale profile binding must fail CAS');
  const saved = await request('/api/overseas/enterprise/profile', 'PATCH', changed, { 'If-Match': String(profile.factVersion.contentHash) });
  assert.equal(saved.status, 200, 'the uploaded image is bound through the normal profile CAS');
  const catalog = () => readMaterialLibrary('product-tenant', {
    dataStore: store, local: readLocalMaterials, cloud: async () => ({ items: [], source: { source: 'database', state: 'ready', message: 'test' } }),
  });
  let projected = (await catalog()).items.filter(item => item.sourceType === 'enterprise_product_table');
  assert.equal(projected.length, 1);
  assert.equal(projected[0]!.productId, 'lamp-1');
  assert.equal(projected[0]!.contentSha256, uploaded.material.contentSha256);
  assert.equal(projected[0]!.objectKey, `enterprise-assets/tenants/${Buffer.from('product-tenant').toString('base64url')}/${uploaded.url.split('/').at(-1)}`);
  assert.equal(projected[0]!.commercialUseApproved, true);
  assert.equal((await runWithDataAuthority('local', () => readMaterialLibrary('product-tenant'))).items
    .filter(item => item.sourceType === 'enterprise_product_table').length, 1,
    'the ordinary production inventory must include the bound product without injected adapters');
  const boundProfile = profiles[0]!.profile;
  profiles[0]!.profile = { ...(boundProfile as object), products: { items: Array.from({ length: 13 }, (_, index) => ({
    id: `lamp-${index + 1}`, name: `灯具 ${index + 1}`, imageUrl: uploaded.url,
  })) } };
  assert.equal((await catalog()).items.filter(item => item.sourceType === 'enterprise_product_table').length, 13,
    'the full profile still projects every independently verified product binding');
  profiles[0]!.profile = boundProfile;

  const cloudBacked = await readMaterialLibrary('product-tenant', { dataStore: store, local: () => [],
    cloud: async () => ({ items: [{ ...uploaded.material, tenantId: 'product-tenant', scope: 'own', type: 'image',
      sourceType: 'enterprise_product_image_import', sourceUrl: 'https://supplier.test/original.jpg',
      provenance: { enterpriseAssetUrl: uploaded.url } }],
      source: { source: 'database', state: 'ready', message: 'test' } }) });
  assert.equal(cloudBacked.items.filter(item => item.sourceType === 'enterprise_product_table').length, 1,
    'cloud-owned imported assets use the same tenant and byte verification');

  const other = await readMaterialLibrary('other-tenant', { dataStore: store, local: readLocalMaterials,
    cloud: async () => ({ items: [], source: { source: 'database', state: 'ready', message: 'test' } }) });
  assert.equal(other.items.length, 0, 'cross-tenant upload and product binding stay private');
  const otherUpload = await request('/api/overseas/enterprise/assets', 'POST',
    { name: 'other-lamp.png', type: 'image/png', dataUrl: `data:image/png;base64,${png.toString('base64')}` },
    { Authorization: 'Bearer other' });
  assert.equal(otherUpload.status, 200);
  const otherUrl = (await otherUpload.json() as { url: string }).url;
  const owned = readLocalMaterials();
  const poisoned = [
    otherUrl,
    '/api/overseas/enterprise/assets/..%2Fsecret.jpg',
    '/api/overseas/enterprise/assets/%2e%2e%2Fsecret.jpg',
    '/api/overseas/enterprise/assets/other-tenant/secret.jpg',
    'https://example.test/product.jpg',
    '/api/overseas/enterprise/assets/not-uploaded.jpg',
  ];
  for (const url of poisoned) {
    profiles[0]!.profile = { ...(profiles[0]!.profile as object), products: { items: [{ id: 'lamp-1', name: '灯具', imageUrl: url }] } };
    projected = (await catalog()).items.filter(item => item.sourceType === 'enterprise_product_table');
    assert.equal(projected.length, 0, `unowned or unsafe URL must not project: ${url}`);
  }
  profiles[0]!.profile = { ...(profiles[0]!.profile as object), products: { items: [{ id: 'lamp-1', name: '灯具', imageUrl: uploaded.url }] } };
  saveLocalMaterials(owned.map(item => item.id === uploaded.material.id ? { ...item, contentSha256: '0'.repeat(64) } : item));
  assert.equal((await catalog()).items.filter(item => item.sourceType === 'enterprise_product_table').length, 0, 'changed registered hash fails closed');
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  store.list = original.list; store.create = original.create; store.update = original.update; auth.verifyToken = original.verify; globalThis.fetch = original.fetch;
  if (previousFile === undefined) delete process.env.MATERIAL_LIBRARY_FILE; else process.env.MATERIAL_LIBRARY_FILE = previousFile;
  if (previousObjectRoot === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previousObjectRoot;
  if (previousDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previousDriver;
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('enterprise upload, profile CAS, product projection and isolation passed');
