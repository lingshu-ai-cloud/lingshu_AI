import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { enterpriseAssetObjectKey } from '../storage/enterpriseAssets.js';
import { objectStorageUpload } from '../storage/objectStorage.js';
import { createEnterpriseProductFootageImportRouter } from './enterpriseProductFootageImport.js';
import { readApprovedProductFootage, type FootageApproval, type FootageRevocation } from './enterpriseProductFootageReview.js';

test('authenticated signed import carries an independent finding without giving uploader approval authority', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-footage-import-'));
  const previous = { driver: process.env.OBJECT_STORAGE_DRIVER, root: process.env.LOCAL_OBJECT_STORAGE_ROOT,
    keys: process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON };
  process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.LOCAL_OBJECT_STORAGE_ROOT = root;
  const tables = new Map<string, Record_[]>();
  const store: DataStore = {
    async getById<T>(table: string, id: string) { return (tables.get(table) ?? []).find(row => row.id === id) as T ?? null; },
    async create<T>(table: string, data: Record<string, unknown>) {
      const rows = tables.get(table) ?? [];
      if (rows.some(row => row.id === data.id)) return null;
      const row = structuredClone(data) as Record_; tables.set(table, [...rows, row]); return row as T;
    },
    async update() { return false; }, async delete() { return false; },
    async list<T>(table: string, query: ListQuery = {}): Promise<ListResult<T>> {
      const all = (tables.get(table) ?? []).filter(row => Object.entries(query.where ?? {})
        .every(([key, value]) => row[key] === value));
      const page = query.page ?? 1, perPage = query.perPage ?? 30;
      return { items: all.slice((page - 1) * perPage, page * perPage) as T[], totalItems: all.length,
        totalPages: Math.max(1, Math.ceil(all.length / perPage)), page, perPage };
    },
  };
  let server: ReturnType<ReturnType<typeof express>['listen']> | undefined;
  try {
    const keys = generateKeyPairSync('ed25519');
    const authorities = [{ keyId: 'independent-key', issuerId: 'outside-reviewer',
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON = JSON.stringify(authorities);
    const tenantId = 'tenant-a', productId = 'product-a';
    const filename = '1792195200000-123e4567-e89b-12d3-a456-426614174000.mp4';
    const objectKey = enterpriseAssetObjectKey(tenantId, filename);
    const bytes = Buffer.from('independent-review-test-media');
    await objectStorageUpload({ key: objectKey, body: bytes, contentType: 'video/mp4' });
    const contentSha256 = createHash('sha256').update(bytes).digest('hex');
    const material = { id: 'candidate', tenantId, productId, type: 'video', contentSha256, objectKey,
      sourceUrl: `/api/overseas/enterprise/assets/${filename}`,
      provenance: { receivedAt: '2026-10-18T00:00:00.000Z', uploadedByUserId: 'uploader',
        footageCandidate: { status: 'pending_independent_review', productId,
          identityEvidenceRef: 'product-catalog:sku-22', rightsEvidenceRef: 'license:video-22' } } };
    const statement: FootageApproval = { kind: 'product-footage-approval.v1', keyId: 'independent-key',
      issuerId: 'outside-reviewer', tenantId, productId, materialId: material.id, contentSha256,
      objectKey, identityEvidenceRef: 'product-catalog:sku-22', rightsEvidenceRef: 'license:video-22',
      rightsEvidenceSha256: 'a'.repeat(64), observedProductId: productId,
      sceneFunctions: ['product_detail'], reviewedAt: '2026-10-18T01:00:00.000Z',
      expiresAt: '2030-10-20T00:00:00.000Z' };
    const signed = (value: FootageApproval | FootageRevocation) => ({ statement: value,
      signatureBase64url: sign(null, Buffer.from(JSON.stringify(value)), keys.privateKey).toString('base64url') });
    const app = express(); app.use(express.json({ limit: '32kb' }));
    app.use((req, res, next) => { if (req.headers.authorization !== 'Bearer independent-relay') {
      res.status(401).end(); return; } Object.assign(res.locals, { tenantId }); next(); });
    app.use('/product-footage', createEnterpriseProductFootageImportRouter(store,
      async () => ({ status: 'ready', items: [material] })));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/product-footage/signed-finding`;
    const post = (payload: unknown, bearer = true) => fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer independent-relay' } : {}) },
      body: JSON.stringify(payload) });
    assert.equal((await post({ signed: signed(statement) }, false)).status, 401);
    assert.equal((await post({ signed: signed({ ...statement, tenantId: 'other-tenant' }) })).status, 404);
    assert.equal((await post({ signed: signed({ ...statement, issuerId: 'uploader' }) })).status, 422);
    assert.equal((await post({ signed: { statement, signatureBase64url: 'x'.repeat(86) } })).status, 422);
    const admitted = await post({ signed: signed(statement) }); assert.equal(admitted.status, 201);
    const result = await admitted.json() as { receiptId: string };
    assert.match(result.receiptId, /^[a-f0-9]{15}$/);
    assert.equal((await post({ signed: signed(statement) })).status, 201);
    assert.equal((await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'product_detail', authorities }))?.approvalId, result.receiptId);
    const revocation: FootageRevocation = { kind: 'product-footage-revocation.v1',
      keyId: statement.keyId, issuerId: statement.issuerId, tenantId, productId,
      materialId: material.id, approvalId: result.receiptId,
      revokedAt: '2026-10-18T02:00:00.000Z', reason: 'Independent issuer withdrew rights approval' };
    assert.equal((await post({ signed: signed(revocation) })).status, 201);
    assert.equal(await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'product_detail', authorities }), null);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (previous.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previous.driver;
    if (previous.root === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previous.root;
    if (previous.keys === undefined) delete process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON;
    else process.env.PRODUCT_FOOTAGE_REVIEW_AUTHORITIES_JSON = previous.keys;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
