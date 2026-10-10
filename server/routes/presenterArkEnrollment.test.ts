import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { materialAssetObjectKey } from '../storage/materialAssets.js';
import { objectStorageUpload } from '../storage/objectStorage.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import { createPresenterArkEnrollmentRouter } from './presenterArkEnrollment.js';
import type { VolcengineArkAssets } from '../lib/volcengineArkAssets.js';

function memoryStore(): DataStore {
  const rows = new Map<string, any>(); let sequence = 0;
  return {
    async getById<T>(collection: string, id: string) { return rows.get(`${collection}/${id}`) as T || null; },
    async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...value, id: `r${++sequence}` }; rows.set(`${collection}/${row.id}`, row); return row as T; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...patch }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query: ListQuery = {}) { const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(query.where || {}).every(([field, expected]) => value[field] === expected)).map(([, value]) => value as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
}

test('Ark enrollment keeps consent, liveness, image approval and tenant binding separate', async () => {
  const previousCwd = process.cwd(), previousBase = process.env.PUBLIC_BASE_URL, previousDriver = process.env.OBJECT_STORAGE_DRIVER;
  const root = mkdtempSync(path.join(os.tmpdir(), 'lingshu-ark-enrollment-'));
  process.chdir(root); process.env.PUBLIC_BASE_URL = 'https://app.example.test'; process.env.OBJECT_STORAGE_DRIVER = 'local';
  let createSessions = 0, createImages = 0, validated = false, assetActive = false, lostCreateResponse = false, recoveredAssetId = '';
  const ark = { configured: () => true,
    createValidationSession: async () => { createSessions++; return { BytedToken: 'token-1', H5Link: 'https://ark.example.test/validate' }; },
    validationResult: async () => ({ GroupId: validated ? 'group-person-1' : '' }),
    createImage: async () => { createImages++; if (lostCreateResponse) throw new Error('provider response lost'); return 'asset-image-1'; },
    getAsset: async () => ({ Id: recoveredAssetId || 'asset-image-1', GroupId: 'group-person-1', AssetType: 'Image', Status: assetActive ? 'Active' : 'Processing' }),
    findImageByName: async () => recoveredAssetId ? { Id: recoveredAssetId, GroupId: 'group-person-1', AssetType: 'Image' } : undefined,
  } as unknown as VolcengineArkAssets;
  const store = memoryStore(); const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.tenantId = String(req.headers['x-test-tenant'] || 'tenant-a'); next(); });
  app.use('/presenters', createPresenterArkEnrollmentRouter(store, async (_key, run) => run(), { ark, supplierReady: () => true, signedUrl: async () => 'https://assets.example.test/person.jpg' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/presenters`;
  try {
    const uploadedPhoto = await fetch(`${base}/ark-enrollments/materials?type=image&mime=image/png`, { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await sharp({ create: { width: 32, height: 32, channels: 3, background: '#777777' } }).png().toBuffer() });
    assert.equal(uploadedPhoto.status, 201);
    const uploaded = await uploadedPhoto.json();
    assert.equal(readLocalMaterials().find(item => item.id === uploaded.id)?.type, 'image');
    assert.match(readLocalMaterials().find(item => item.id === uploaded.id)?.objectKey || '', /\.jpg$/);
    const photoKey = materialAssetObjectKey('tenant-a', 'photo.jpg'), videoKey = materialAssetObjectKey('tenant-a', 'video.mp4');
    await objectStorageUpload({ key: photoKey, body: Buffer.from('photo'), contentType: 'image/jpeg' });
    await objectStorageUpload({ key: videoKey, body: Buffer.from('video'), contentType: 'video/mp4' });
    saveLocalMaterials([{ id: 'photo-1', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: photoKey },
      { id: 'video-1', tenantId: 'tenant-a', scope: 'own', type: 'video', objectKey: videoKey }]);
    await store.create('studio_production_defaults', { tenant_id: 'tenant-a', payload: { presenters: [{ id: 'person-1', name: '本人', authorized: true, avatarId: '', voiceId: '', supportsAlpha: false, referenceMaterialIds: ['photo-1', 'video-1'] }] } });
    const body = { requestId: 'request-1', presenterId: 'person-1', photoMaterialId: 'photo-1', videoMaterialId: 'video-1', subjectAdultConfirmed: true, arkProcessingAuthorized: true };
    const post = (value: unknown, tenant = 'tenant-a') => fetch(`${base}/ark-enrollments`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-tenant': tenant }, body: JSON.stringify(value) });
    assert.equal((await post({ ...body, arkProcessingAuthorized: false })).status, 400);
    assert.equal((await post(body, 'tenant-b')).status, 400);
    const started = await (await post(body)).json(); assert.equal(started.state, 'needs_verification'); assert.equal(createSessions, 1);
    const repeated = await (await post(body)).json(); assert.equal(repeated.id, started.id); assert.equal(createSessions, 1);
    const refresh = () => fetch(`${base}/ark-enrollments/${started.id}/refresh`, { method: 'POST' });
    assert.equal((await (await refresh()).json()).state, 'needs_verification'); assert.equal(createImages, 0);
    validated = true; assert.equal((await (await refresh()).json()).state, 'processing'); assert.equal(createImages, 1);
    assetActive = true; assert.equal((await (await refresh()).json()).state, 'ready');
    const defaults = (await store.list<any>('studio_production_defaults', { where: { tenant_id: 'tenant-a' } })).items[0].payload;
    assert.equal(defaults.presenters[0].arkCertification.assetUri, 'asset://asset-image-1');
    assert.equal(defaults.presenters[0].assetVersion, 3);
    assert.equal(readLocalMaterials().find(item => item.id === 'photo-1')?.seedanceTrustedAsset?.kind, 'image');
    assert.equal((await fetch(`${base}/ark-enrollments/${started.id}/refresh`, { method: 'POST', headers: { 'x-test-tenant': 'tenant-b' } })).status, 400);
    lostCreateResponse = true; recoveredAssetId = 'asset-image-2';
    const second = await (await post({ ...body, requestId: 'request-2' })).json();
    assert.equal(second.state, 'processing'); assert.equal(createSessions, 1, 'existing verified group is reused');
    assert.equal((await fetch(`${base}/ark-enrollments/${second.id}/refresh`, { method: 'POST' })).status, 400);
    const recovered = await (await fetch(`${base}/ark-enrollments/${second.id}/refresh`, { method: 'POST' })).json();
    assert.equal(recovered.state, 'ready', JSON.stringify(recovered));
    assert.equal(createImages, 2, 'an uncertain CreateAsset result is recovered without a second upload');
  } finally {
    server.close(); process.chdir(previousCwd); rmSync(root, { recursive: true, force: true });
    if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previousBase;
    if (previousDriver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previousDriver;
  }
});
