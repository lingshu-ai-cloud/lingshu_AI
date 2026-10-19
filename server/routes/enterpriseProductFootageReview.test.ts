import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { enterpriseAssetObjectKey } from '../storage/enterpriseAssets.js';
import { objectStorageUpload } from '../storage/objectStorage.js';
import { readProductionProductFootageAdmission } from '../starter198/socialProductFootageAdmission.js';
import { taskProductionAssets } from '../starter198/socialContentProductionSupport.js';
import {
  PRODUCT_FOOTAGE_REVOCATIONS, PRODUCT_FOOTAGE_REVIEWS, readApprovedProductFootage,
  recordProductFootageApproval, recordProductFootageRevocation,
  type FootageApproval, type FootageAuthority, type FootageRevocation,
} from './enterpriseProductFootageReview.js';

function memory(): DataStore {
  const tables = new Map<string, Record_[]>();
  return {
    async getById<T>(name: string, id: string) { return structuredClone(tables.get(name)?.find(item => item.id === id) ?? null) as T | null; },
    async create<T>(name: string, data: Record<string, unknown>) {
      const rows = tables.get(name) ?? [];
      if (rows.some(item => item.id === data.id)
        || name === PRODUCT_FOOTAGE_REVOCATIONS && rows.some(item => item.approval_id === data.approval_id)) return null;
      const item = structuredClone(data) as Record_; tables.set(name, [...rows, item]);
      return structuredClone(item) as T;
    },
    async update() { return false; }, async delete() { return false; },
    async list<T>(name: string, query: ListQuery = {}): Promise<ListResult<T>> {
      const items = (tables.get(name) ?? []).filter(item =>
        Object.entries(query.where ?? {}).every(([field, value]) => item[field] === value));
      const page = query.page ?? 1, perPage = query.perPage ?? 30;
      return { items: structuredClone(items.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: items.length, totalPages: Math.max(1, Math.ceil(items.length / perPage)), page, perPage };
    },
  };
}

test('external signed review is byte-, product-, purpose- and revocation-bound', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'product-footage-review-'));
  const previous = { driver: process.env.OBJECT_STORAGE_DRIVER, root: process.env.LOCAL_OBJECT_STORAGE_ROOT };
  process.env.OBJECT_STORAGE_DRIVER = 'local'; process.env.LOCAL_OBJECT_STORAGE_ROOT = root;
  try {
    const store = memory(), tenantId = 'tenant-a', productId = 'product-a';
    const filename = '1792195200000-123e4567-e89b-12d3-a456-426614174000.mp4';
    const objectKey = enterpriseAssetObjectKey(tenantId, filename);
    const bytes = Buffer.from('isolated-video-object');
    await objectStorageUpload({ key: objectKey, body: bytes, contentType: 'video/mp4' });
    const sha = createHash('sha256').update(bytes).digest('hex');
    const material = { id: 'candidate-a', tenantId, productId, type: 'video',
      contentSha256: sha, objectKey, sourceUrl: `/api/overseas/enterprise/assets/${filename}`,
      provenance: { receivedAt: '2026-10-18T00:00:00.000Z', uploadedByUserId: 'uploader',
        footageCandidate: { status: 'pending_independent_review', productId,
          identityEvidenceRef: 'product-catalog:sku-22', rightsEvidenceRef: 'license:video-22' } } };
    const keys = generateKeyPairSync('ed25519');
    const authorities: FootageAuthority[] = [{ keyId: 'review-key-1', issuerId: 'independent-reviewer',
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }];
    const approval: FootageApproval = {
      kind: 'product-footage-approval.v1', keyId: 'review-key-1', issuerId: 'independent-reviewer',
      tenantId, productId, materialId: material.id, contentSha256: sha, objectKey,
      identityEvidenceRef: 'product-catalog:sku-22', rightsEvidenceRef: 'license:video-22',
      rightsEvidenceSha256: 'a'.repeat(64), observedProductId: productId,
      sceneFunctions: ['product_detail'], reviewedAt: '2026-10-18T01:00:00.000Z',
      expiresAt: '2026-10-20T00:00:00.000Z',
    };
    const signed = <T extends FootageApproval | FootageRevocation>(statement: T) => ({
      statement, signatureBase64url: sign(null, Buffer.from(JSON.stringify(statement)), keys.privateKey).toString('base64url'),
    });
    const now = new Date('2026-10-18T02:00:00.000Z');
    assert.equal(await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'product_detail', authorities, now }), null);
    await assert.rejects(recordProductFootageApproval({ store, material,
      signed: signed({ ...approval, issuerId: 'uploader' }) as never, authorities, now }), /approval_invalid/);
    await assert.rejects(recordProductFootageApproval({ store, material,
      signed: { statement: approval, signatureBase64url: 'x'.repeat(86) }, authorities, now }), /approval_invalid/);
    const approvalId = await recordProductFootageApproval({ store, material, signed: signed(approval), authorities, now });
    const readMaterials = async () => ({ status: 'ready' as const, items: [material] });
    const admission = { store, readMaterials, tenantId, productId, materialId: material.id,
      sceneFunction: 'product_detail', expectedContentSha256: sha, expectedApprovalId: approvalId, authorities, now };
    await assert.rejects(taskProductionAssets({ tenantId, sources: [], productRef: productId,
      themeId: null, productionMode: 'auto' as never, outputDirectory: root,
      requiredMaterialIds: [material.id], materialLibrary: async () => ({ status: 'available', items: [material] }) as never }),
    /product_footage_shot_review_required/);
    assert.equal((await readProductionProductFootageAdmission(admission))?.approvalId, approvalId);
    assert.equal(await readProductionProductFootageAdmission({ ...admission,
      readMaterials: async () => ({ status: 'partial', items: [material] }) }), null);
    assert.equal(await readProductionProductFootageAdmission({ ...admission,
      readMaterials: async () => ({ status: 'ready', items: [{ ...material, productId: 'other-product' }] }) }), null);
    assert.equal(await readProductionProductFootageAdmission({ ...admission,
      readMaterials: async () => ({ status: 'ready', items: [material, material] }) }), null);
    assert.equal(await readProductionProductFootageAdmission({ ...admission,
      expectedContentSha256: 'b'.repeat(64) }), null);
    assert.equal(await readProductionProductFootageAdmission({ ...admission,
      expectedApprovalId: 'wrong-approval' }), null);
    assert.equal(await readProductionProductFootageAdmission({ ...admission,
      sceneFunction: 'factory_process' }), null);
    assert.equal((await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'product_detail', authorities, now }))?.approvalId, approvalId);
    assert.equal(await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'factory_process', authorities, now }), null);
    await assert.rejects(readApprovedProductFootage({ store, material: { ...material, productId: 'product-b' },
      tenantId, productId: 'product-b', sceneFunction: 'product_detail', authorities, now }), /approval_ledger_invalid/);
    const revocation: FootageRevocation = {
      kind: 'product-footage-revocation.v1', keyId: approval.keyId, issuerId: approval.issuerId,
      tenantId, productId, materialId: material.id, approvalId,
      revokedAt: '2026-10-18T01:30:00.000Z', reason: 'license withdrawn',
    };
    await recordProductFootageRevocation({ store, signed: signed(revocation), authorities, now });
    assert.equal(await readProductionProductFootageAdmission(admission), null);
    assert.equal(await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'product_detail', authorities, now }), null);
    assert.equal((await store.list(PRODUCT_FOOTAGE_REVIEWS)).totalItems, 1);
    assert.equal((await store.list(PRODUCT_FOOTAGE_REVOCATIONS)).totalItems, 1);
    await objectStorageUpload({ key: objectKey, body: Buffer.from('drifted'), contentType: 'video/mp4' });
    assert.equal(await readApprovedProductFootage({ store, material, tenantId, productId,
      sceneFunction: 'product_detail', authorities, now }), null);
  } finally {
    if (previous.driver === undefined) delete process.env.OBJECT_STORAGE_DRIVER; else process.env.OBJECT_STORAGE_DRIVER = previous.driver;
    if (previous.root === undefined) delete process.env.LOCAL_OBJECT_STORAGE_ROOT; else process.env.LOCAL_OBJECT_STORAGE_ROOT = previous.root;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
