import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore, ListQuery, ListResult } from '../storage/datastore.js';
import { buildPublicationPackage } from '../publishing/publicationPackage.js';
import { createDefaultChannelRegistry } from './registry.js';
import { SOCIAL_CHANNEL_COLLECTIONS, SocialChannelRepository } from './repository.js';
import { createSocialChannelsRouter } from './router.js';
import { auth } from '../storage/index.js';

type Row = { id: string } & Record<string, unknown>;

class MemoryStore implements DataStore {
  private readonly rows = new Map<string, Row[]>();

  async getById<T = Row>(collection: string, id: string): Promise<T | null> {
    return (this.rows.get(collection)?.find(row => row.id === id) as T | undefined) ?? null;
  }

  async create<T = Row>(collection: string, data: Record<string, unknown>): Promise<T | null> {
    const rows = this.rows.get(collection) ?? [];
    const uniqueKeys: Partial<Record<string, string[]>> = {
      [SOCIAL_CHANNEL_COLLECTIONS.publicationPackages]: ['tenant_id', 'idempotency_key'],
      durable_operation_leases: ['tenant_id', 'lease_scope', 'subject_id'],
    };
    const keys = uniqueKeys[collection];
    if (keys && rows.some(row => keys.every(key => row[key] === data[key]))) return null;
    const row = { id: `${collection}-${rows.length + 1}`, ...structuredClone(data) } as Row;
    rows.push(row);
    this.rows.set(collection, rows);
    return row as T;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    rows[index] = { ...rows[index], ...structuredClone(data) };
    return true;
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const rows = this.rows.get(collection) ?? [];
    const index = rows.findIndex(row => row.id === id);
    if (index < 0) return false;
    rows.splice(index, 1);
    return true;
  }

  async list<T = Row>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
    const rows = (this.rows.get(collection) ?? [])
      .filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
    return {
      items: rows as T[],
      totalItems: rows.length,
      totalPages: rows.length ? 1 : 0,
      page: query.page ?? 1,
      perPage: query.perPage ?? 20,
    };
  }
}

const repository = new SocialChannelRepository(new MemoryStore());
const registry = createDefaultChannelRegistry();
const publicationPackage = buildPublicationPackage({
  tenantId: 'tenant-a',
  contentId: 'content-a',
  contentVersion: 'v1',
  contentHash: 'a'.repeat(64),
  channelId: 'douyin_cn',
  copy: { title: '采购指南', body: '只包含已确认的产品事实', hashtags: ['采购'] },
  assets: [{
    kind: 'video',
    fileName: 'approved.mp4',
    downloadUrl: '/api/overseas/assets/approved.mp4',
    contentHash: 'b'.repeat(64),
  }],
  idempotencyKey: 'route-evidence-package-100',
  registry,
  now: new Date('2026-09-19T00:00:00.000Z'),
});
await repository.createPublicationPackage({
  package: publicationPackage,
  idempotencyKey: 'route-evidence-package-100',
  createdBy: 'tenant-user',
});

const originalVerifyToken = auth.verifyToken;
auth.verifyToken = async authorization => {
  if (authorization === 'Bearer internal') return { userId: 'internal-reviewer', tenantId: 'internal-tenant' };
  if (authorization === 'Bearer tenant') return { userId: 'tenant-user', tenantId: 'tenant-a' };
  return null;
};

const app = express();
app.use(express.json());
// The admin-prefixed mount keeps this isolated test outside the starter-product
// legacy boundary; the router's own tenant and internal-verifier gates remain active.
app.use('/api/overseas/admin/social-channels', createSocialChannelsRouter({
  registry,
  repository,
  resolveRole: async () => 'social_operator',
  authorizeEvidenceVerifier: async request => request.headers.authorization === 'Bearer internal'
    ? { userId: 'internal-reviewer', tenantId: 'internal-tenant', email: 'reviewer@example.test' }
    : null,
}));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/overseas/admin/social-channels`;

async function request(path: string, authorization: string, body?: Record<string, unknown>) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: authorization, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, data: await response.json() as Record<string, any> };
}

try {
  const first = await request(`/publication-packages/${publicationPackage.packageId}/evidence`, 'Bearer tenant', {
    method: 'manual_package',
    contentHash: publicationPackage.contentHash,
    packageHash: publicationPackage.packageHash,
    publicUrl: 'https://www.douyin.com/video/100',
  });
  assert.equal(first.response.status, 202);
  assert.equal(first.data.evidence.verificationStatus, 'pending');
  assert.equal(first.data.evidenceHistory.length, 1);

  const correctionWithoutCompareAndSet = await request(
    `/publication-packages/${publicationPackage.packageId}/evidence`,
    'Bearer tenant',
    {
      method: 'manual_package',
      contentHash: publicationPackage.contentHash,
      packageHash: publicationPackage.packageHash,
      publicUrl: 'https://www.douyin.com/video/200',
    },
  );
  assert.equal(correctionWithoutCompareAndSet.response.status, 409);
  assert.equal(correctionWithoutCompareAndSet.data.error, 'social_publication_evidence_correction_invalid');

  const corrected = await request(`/publication-packages/${publicationPackage.packageId}/evidence`, 'Bearer tenant', {
    method: 'manual_package',
    contentHash: publicationPackage.contentHash,
    packageHash: publicationPackage.packageHash,
    publicUrl: 'https://www.douyin.com/video/200',
    correctsEvidenceId: first.data.evidence.evidenceId,
  });
  assert.equal(corrected.response.status, 202);
  assert.equal(corrected.data.correctionAccepted, true);
  assert.equal(corrected.data.evidenceHistory.length, 2);
  assert.equal(corrected.data.evidenceHistory[1].supersedesEvidenceId, first.data.evidence.evidenceId);

  const forbiddenVerification = await request(
    `/internal/tenants/tenant-a/publication-packages/${publicationPackage.packageId}/evidence/verify`,
    'Bearer tenant',
    {
      evidenceId: corrected.data.evidence.evidenceId,
      decision: 'verified',
      reviewNote: '普通租户不能执行内部核验。',
      contentMatchesFrozenVersion: true,
      verificationRequestId: 'tenant-review-100',
    },
  );
  assert.equal(forbiddenVerification.response.status, 403);
  assert.equal(forbiddenVerification.data.error, 'internal_evidence_verifier_required');

  const verified = await request(
    `/internal/tenants/tenant-a/publication-packages/${publicationPackage.packageId}/evidence/verify`,
    'Bearer internal',
    {
      evidenceId: corrected.data.evidence.evidenceId,
      decision: 'verified',
      reviewNote: '人工打开公开作品并比对冻结视频、标题和链接，确认一致。',
      contentMatchesFrozenVersion: true,
      verificationRequestId: 'internal-review-100',
    },
  );
  assert.equal(verified.response.status, 200);
  assert.equal(verified.data.currentEvidence.verificationStatus, 'verified');
  assert.equal(verified.data.currentEvidence.verifier, 'human_review');
  assert.match(verified.data.currentEvidence.verifierIdentity, /^internal_admin:[a-f0-9]{24}$/);
  assert.equal(verified.data.currentEvidence.verifierIdentity.includes('internal-reviewer'), false);
  assert.match(verified.data.currentEvidence.sourceReceiptHash, /^[a-f0-9]{64}$/);
  assert.equal(verified.data.evidenceHistory.length, 3);

  const tenantView = await request(`/publication-packages/${publicationPackage.packageId}`, 'Bearer tenant');
  assert.equal(tenantView.response.status, 200);
  assert.equal(tenantView.data.currentEvidence.verificationStatus, 'verified');
  assert.equal(tenantView.data.evidenceHistory.length, 3);

  const overwriteVerified = await request(`/publication-packages/${publicationPackage.packageId}/evidence`, 'Bearer tenant', {
    method: 'manual_package',
    contentHash: publicationPackage.contentHash,
    packageHash: publicationPackage.packageHash,
    publicUrl: 'https://www.douyin.com/video/300',
    correctsEvidenceId: corrected.data.evidence.evidenceId,
  });
  assert.equal(overwriteVerified.response.status, 409);
  assert.equal(overwriteVerified.data.error, 'social_publication_evidence_correction_invalid');
} finally {
  auth.verifyToken = originalVerifyToken;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

console.log('social channel evidence route tests passed');
