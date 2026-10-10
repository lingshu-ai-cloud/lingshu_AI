import assert from 'node:assert/strict';
import { createDefaultChannelRegistry } from '../socialChannels/registry.js';
import {
  buildPublicationEvidence,
  buildPublicationPackage,
  PublicationPackageError,
  resolvePublicationEvidence,
} from './publicationPackage.js';

const registry = createDefaultChannelRegistry();
const base = {
  tenantId: 'tenant-a',
  contentId: 'content-a',
  contentVersion: 'version-7',
  contentHash: 'a'.repeat(64),
  channelId: 'douyin_cn' as const,
  targetAccountId: 'douyin-account-a',
  copy: {
    title: '工厂采购指南',
    body: '三个已经核验的采购要点。',
    hashtags: ['#工厂', '工厂', '采购'],
    cta: '联系企业客服获取目录',
  },
  assets: [
    {
      kind: 'video' as const,
      fileName: 'approved-v7.mp4',
      downloadUrl: '/api/overseas/assets/approved-v7.mp4',
      contentHash: 'b'.repeat(64),
      mediaType: 'video/mp4',
    },
    {
      kind: 'cover' as const,
      fileName: 'cover-v7.jpg',
      downloadUrl: 'https://assets.example.test/cover-v7.jpg',
      contentHash: 'c'.repeat(64),
      mediaType: 'image/jpeg',
    },
  ],
  sourceTracking: { campaign: 'autumn-2026' },
  idempotencyKey: 'task-100:content-a:douyin:v7',
  registry,
};

const first = buildPublicationPackage({ ...base, now: new Date('2026-09-19T00:00:00.000Z') });
const repeated = buildPublicationPackage({ ...base, now: new Date('2026-09-20T00:00:00.000Z') });
assert.equal(first.packageId, repeated.packageId);
assert.equal(first.packageHash, repeated.packageHash, 'generatedAt/status must not alter the frozen business hash');
assert.equal(first.status, 'ready');
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.copy));
assert.ok(Object.isFrozen(first.assets));
assert.deepEqual(first.copy.hashtags, ['工厂', '采购']);
assert.match(first.publishingInstructions[0], /国内抖音/);

const legacyTikTok = buildPublicationPackage({
  ...base,
  channelId: 'tiktok',
  targetAccountId: 'tiktok-account-a',
  idempotencyKey: 'task-100:content-a:tiktok:v7',
});
assert.equal(legacyTikTok.channelId, 'tiktok_global');
assert.notEqual(legacyTikTok.packageHash, first.packageHash, 'Douyin and global TikTok must freeze as different targets');
assert.doesNotMatch(legacyTikTok.publishingInstructions[0], /国内抖音/);

const secondAccount = buildPublicationPackage({
  ...base,
  targetAccountId: 'douyin-account-b',
  idempotencyKey: 'task-100:content-a:douyin-b:v7',
});
assert.notEqual(secondAccount.packageHash, first.packageHash, 'target account belongs to the frozen publication subject');

assert.throws(
  () => buildPublicationPackage({
    ...base,
    assets: [{ ...base.assets[0], downloadUrl: 'file:///etc/passwd' }],
  }),
  (error: unknown) => error instanceof PublicationPackageError && error.code === 'publication_assets_invalid',
);

const pending = buildPublicationEvidence({
  package: first,
  method: 'manual_package',
  contentHash: first.contentHash,
  packageHash: first.packageHash,
  publicUrl: 'https://www.douyin.com/video/123456?share_token=secret#fragment',
  externalContentId: '123456',
  submittedBy: 'user-a',
  now: new Date('2026-09-19T01:00:00.000Z'),
});
assert.equal(pending.verificationStatus, 'pending');
assert.equal(pending.publicUrl, 'https://www.douyin.com/video/123456');

assert.throws(
  () => buildPublicationEvidence({
    package: first,
    method: 'manual_package',
    contentHash: first.contentHash,
    packageHash: first.packageHash,
    publicUrl: 'https://www.tiktok.com/@factory/video/123456',
    submittedBy: 'user-a',
  }),
  (error: unknown) => error instanceof PublicationPackageError && error.code === 'publication_evidence_url_invalid',
  'TikTok evidence must never verify a Douyin package',
);

const unresolved = resolvePublicationEvidence({
  package: first,
  evidence: pending,
  verifier: 'public_page',
  verifierIdentity: 'public-page-verifier-v1',
  sourceReceiptHash: 'd'.repeat(64),
  publiclyObservable: false,
  now: new Date('2026-09-19T01:05:00.000Z'),
});
assert.equal(unresolved.packageStatus, 'reconciliation_required');
assert.equal(unresolved.reconciliationRequired, true);

const verified = resolvePublicationEvidence({
  package: first,
  evidence: pending,
  verifier: 'public_page',
  verifierIdentity: 'public-page-verifier-v1',
  sourceReceiptHash: 'e'.repeat(64),
  publiclyObservable: true,
  observedContentHash: first.contentHash,
  now: new Date('2026-09-19T01:06:00.000Z'),
});
assert.equal(verified.packageStatus, 'published_verified');
assert.equal(verified.evidence.verificationStatus, 'verified');

console.log('publicationPackage.v2 tests passed');
