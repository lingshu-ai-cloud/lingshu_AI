import assert from 'node:assert/strict';
import { store } from '../storage/index.js';
import type { ListResult } from '../storage/datastore.js';
import {
  buildPublicationEvidenceSubmission,
  buildStarterPublicationPackage,
  createStarterPublicationPackage,
  readStarterPublicationPackage,
  resolvePublicationEvidence,
  StarterPublicationPackageError,
  submitStarterPublicationEvidence,
  verifyStarterPublicationEvidence,
  type BuildStarterPublicationPackageInput,
} from './starterPublicationPackage.js';

const baseInput: BuildStarterPublicationPackageInput = {
  tenantId: 'tenant-a',
  contentId: 'content-1',
  contentVersion: 'v4',
  contentHash: 'a'.repeat(64),
  platform: 'tiktok',
  copy: {
    title: 'Buyer guide',
    body: 'Three verified purchasing points.',
    hashtags: ['#B2B', 'B2B', 'Factory'],
    firstComment: 'Request the verified catalogue.',
    altText: 'Verified product demonstration.',
  },
  assets: [{
    kind: 'video',
    fileName: 'approved-v4.mp4',
    downloadUrl: '/api/overseas/assets/approved-v4.mp4',
    contentHash: 'b'.repeat(64),
  }],
  inquiryUrl: 'https://example.test/inquiry/V1000',
  idempotencyKey: 'run-1:content-1:tiktok:v4',
  now: new Date('2026-09-12T00:00:00.000Z'),
};

const manifest = buildStarterPublicationPackage(baseInput);
const repeatedManifest = buildStarterPublicationPackage({
  ...baseInput,
  now: new Date('2026-09-13T00:00:00.000Z'),
});
assert.equal(manifest.packageId, repeatedManifest.packageId);
assert.equal(manifest.packageHash, repeatedManifest.packageHash, 'business-identical packages must have a stable hash');
assert.equal(manifest.status, 'awaiting_user_publish');
assert.equal(manifest.workflowBinding, undefined, 'ordinary package commands cannot invent workflow lineage');
assert.deepEqual(manifest.copy.hashtags, ['B2B', 'Factory']);
assert.equal('accountId' in manifest, false, 'the default package path must not require a connected account');
assert.match(manifest.publishingSteps.at(-1) ?? '', /灵小枢发布卡/);

assert.throws(
  () => buildStarterPublicationPackage({
    ...baseInput,
    assets: [{ ...baseInput.assets[0], downloadUrl: 'file:///etc/passwd' }],
  }),
  (error: unknown) => error instanceof StarterPublicationPackageError && error.code === 'publication_assets_invalid',
);
await assert.rejects(
  readStarterPublicationPackage('tenant-a', manifest.packageId, {
    async list<T>() {
      return {
        items: [{ id: 'foreign-package', tenant_id: 'tenant-b', package_id: manifest.packageId }],
        totalItems: 1, totalPages: 1, page: 1, perPage: 2,
      } as unknown as ListResult<T>;
    },
    async getById() { return null; },
    async create() { return null; },
    async update() { return false; },
    async delete() { return false; },
  }),
  (error: unknown) => error instanceof StarterPublicationPackageError
    && error.code === 'publication_package_integrity_violation',
  'a storage adapter that ignores tenant filters must fail closed',
);
assert.throws(
  () => buildPublicationEvidenceSubmission({
    package: manifest,
    contentHash: manifest.contentHash,
    publicUrl: 'https://example.test/fake-post',
    submittedBy: 'user-a',
  }),
  (error: unknown) => error instanceof StarterPublicationPackageError && error.code === 'publication_evidence_invalid',
);
assert.throws(
  () => buildPublicationEvidenceSubmission({
    package: manifest,
    contentHash: 'c'.repeat(64),
    platformPostId: 'post-123',
    submittedBy: 'user-a',
  }),
  (error: unknown) => error instanceof StarterPublicationPackageError && error.code === 'publication_evidence_content_changed',
);

const pendingEvidence = buildPublicationEvidenceSubmission({
  package: manifest,
  contentHash: manifest.contentHash,
  publicUrl: 'https://www.tiktok.com/@factory/video/123456',
  platformPostId: '123456',
  submittedBy: 'user-a',
  now: new Date('2026-09-12T01:00:00.000Z'),
});
assert.equal(pendingEvidence.verificationStatus, 'pending', 'user evidence must not mark a package published');
const normalizedPendingEvidence = buildPublicationEvidenceSubmission({
  package: manifest, contentHash: manifest.contentHash,
  publicUrl: 'https://www.tiktok.com/@factory/video/123456?share_token=private#fragment',
  submittedBy: 'user-a', now: new Date('2026-09-12T01:00:00.000Z'),
});
assert.equal(normalizedPendingEvidence.publicUrl, 'https://www.tiktok.com/@factory/video/123456',
  'query credentials and fragments are never retained as evidence');
const rejected = resolvePublicationEvidence({
  package: manifest,
  evidence: pendingEvidence,
  verifier: 'platform_receipt',
  publiclyObservable: true,
  observedContentHash: 'd'.repeat(64),
  sourceReceiptHash: 'e'.repeat(64),
  verifierIdentity: 'trusted-platform-verifier-v1',
  now: new Date('2026-09-12T01:01:00.000Z'),
});
assert.equal(rejected.status, 'evidence_rejected');
const verified = resolvePublicationEvidence({
  package: manifest,
  evidence: pendingEvidence,
  verifier: 'platform_receipt',
  publiclyObservable: true,
  observedContentHash: manifest.contentHash,
  sourceReceiptHash: 'f'.repeat(64),
  verifierIdentity: 'trusted-platform-verifier-v1',
  now: new Date('2026-09-12T01:02:00.000Z'),
});
assert.equal(verified.status, 'published');

type Stored = Record<string, unknown> & { id: string };
const records: Stored[] = [];
const leases: Stored[] = [];
const originalStore = {
  getById: store.getById,
  list: store.list,
  create: store.create,
  update: store.update,
  delete: store.delete,
};
let creates = 0;
store.list = (async (collection: string, query: { where?: Record<string, unknown>; page?: number; perPage?: number } = {}) => {
  const source = collection === 'starter_publication_packages' ? records
    : collection === 'durable_operation_leases' ? leases : [];
  const items = source.filter(record => Object.entries(query.where ?? {}).every(([key, value]) => record[key] === value));
  return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: query.perPage ?? 20 };
}) as typeof store.list;
store.create = (async (collection: string, data: Record<string, unknown>) => {
  if (collection === 'durable_operation_leases') {
    if (leases.some(row => row.tenant_id === data.tenant_id
      && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
    const lease = { id: `lease-${leases.length + 1}`, ...data };
    leases.push(lease);
    return lease;
  }
  if (collection !== 'starter_publication_packages') return null;
  creates += 1;
  await new Promise(resolve => setTimeout(resolve, 10));
  const record = { id: `package-${records.length + 1}`, ...data };
  records.push(record);
  return record;
}) as typeof store.create;
store.update = (async (collection: string, id: string, data: Record<string, unknown>) => {
  const source = collection === 'starter_publication_packages' ? records
    : collection === 'durable_operation_leases' ? leases : [];
  const index = source.findIndex(record => record.id === id);
  if (index < 0) return false;
  source[index] = { ...source[index], ...data };
  return true;
}) as typeof store.update;
store.getById = (async (collection: string, id: string) => {
  const source = collection === 'starter_publication_packages' ? records
    : collection === 'durable_operation_leases' ? leases : [];
  return source.find(record => record.id === id) ?? null;
}) as typeof store.getById;
store.delete = (async (collection: string, id: string) => {
  const source = collection === 'starter_publication_packages' ? records
    : collection === 'durable_operation_leases' ? leases : [];
  const index = source.findIndex(record => record.id === id);
  if (index < 0) return false;
  source.splice(index, 1);
  return true;
}) as typeof store.delete;

try {
  const concurrent = await Promise.all([
    createStarterPublicationPackage(baseInput),
    createStarterPublicationPackage(baseInput),
  ]);
  assert.deepEqual(concurrent.map(item => item.created).sort(), [false, true]);
  assert.equal(creates, 1, 'same-process duplicate commands must serialize');
  assert.equal(records.length, 1);

  const originalManifest = structuredClone(records[0].manifest);
  (records[0].manifest as Record<string, unknown>).publishingSteps = ['执行未审批的外部动作'];
  await assert.rejects(
    readStarterPublicationPackage(baseInput.tenantId, manifest.packageId),
    (error: unknown) => error instanceof StarterPublicationPackageError
      && error.code === 'publication_package_integrity_violation',
    'publishing instructions are server-derived and integrity checked',
  );
  records[0].manifest = originalManifest;

  await assert.rejects(
    createStarterPublicationPackage({ ...baseInput, copy: { ...baseInput.copy, body: 'Changed body' } }),
    (error: unknown) => error instanceof StarterPublicationPackageError && error.code === 'publication_idempotency_conflict',
  );

  leases.push({
    id: 'foreign-evidence-lease', tenant_id: baseInput.tenantId,
    lease_scope: 'starter-publication-evidence', subject_id: manifest.packageId,
    lease_token: 'foreign-token', owner_id: 'foreign-owner',
    acquired_at: '2026-09-12T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z',
  });
  await assert.rejects(
    submitStarterPublicationEvidence({
      tenantId: baseInput.tenantId, packageId: manifest.packageId,
      contentHash: manifest.contentHash, platformPostId: '123456', submittedBy: 'user-a',
    }),
    (error: unknown) => error instanceof StarterPublicationPackageError
      && error.code === 'publication_evidence_mutation_conflict',
    'a durable evidence mutation lease prevents cross-process lost updates',
  );
  leases.length = 0;

  const submitted = await submitStarterPublicationEvidence({
    tenantId: baseInput.tenantId,
    packageId: manifest.packageId,
    contentHash: manifest.contentHash,
    publicUrl: 'https://www.tiktok.com/@factory/video/123456',
    platformPostId: '123456',
    submittedBy: 'user-a',
    now: new Date('2026-09-12T02:00:00.000Z'),
  });
  assert.equal(submitted.package.status, 'evidence_submitted');
  assert.equal(submitted.repeated, false);
  const originalEvidence = structuredClone(records[0].evidence);
  (records[0].evidence as Record<string, unknown>).submittedBy = 'substituted-actor';
  await assert.rejects(
    readStarterPublicationPackage(baseInput.tenantId, manifest.packageId),
    (error: unknown) => error instanceof StarterPublicationPackageError
      && error.code === 'publication_evidence_integrity_violation',
    'audit actor and submission time are covered by the evidence hash',
  );
  records[0].evidence = originalEvidence;
  const repeated = await submitStarterPublicationEvidence({
    tenantId: baseInput.tenantId,
    packageId: manifest.packageId,
    contentHash: manifest.contentHash,
    publicUrl: 'https://www.tiktok.com/@factory/video/123456',
    platformPostId: '123456',
    submittedBy: 'user-a',
    now: new Date('2026-09-12T02:10:00.000Z'),
  });
  assert.equal(repeated.repeated, true);

  await assert.rejects(
    submitStarterPublicationEvidence({
      tenantId: baseInput.tenantId,
      packageId: manifest.packageId,
      contentHash: manifest.contentHash,
      platformPostId: 'different-post',
      submittedBy: 'user-a',
    }),
    (error: unknown) => error instanceof StarterPublicationPackageError && error.code === 'publication_evidence_conflict',
  );

  const storedVerification = await verifyStarterPublicationEvidence({
    tenantId: baseInput.tenantId,
    packageId: manifest.packageId,
    verifier: 'platform_receipt',
    publiclyObservable: true,
    observedContentHash: manifest.contentHash,
    sourceReceiptHash: '1'.repeat(64),
    verifierIdentity: 'trusted-platform-verifier-v1',
    now: new Date('2026-09-12T03:00:00.000Z'),
  });
  assert.equal(storedVerification.package.status, 'published');
  assert.equal(storedVerification.evidence.verificationStatus, 'verified');

  await assert.rejects(
    submitStarterPublicationEvidence({
      tenantId: 'tenant-b',
      packageId: manifest.packageId,
      contentHash: manifest.contentHash,
      platformPostId: '123456',
      submittedBy: 'user-b',
    }),
    (error: unknown) => error instanceof StarterPublicationPackageError && error.code === 'publication_package_not_found',
  );
  assert.doesNotMatch(JSON.stringify(records), /password|cookie|sessionToken/i);
} finally {
  Object.assign(store, originalStore);
}

console.log('starter publication package and evidence tests passed');
