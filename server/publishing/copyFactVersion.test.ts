import assert from 'node:assert/strict';
import {
  assertPublishingCopyFactVersion,
  normalizePublishingCopyAudit,
  PublishingCopyFactVersionError,
} from './copyFactVersion.js';

const audit = {
  enterpriseFactVersion: 'enterprise-facts-v9',
  enterpriseFactsHash: 'a'.repeat(64),
  sourceHash: 'b'.repeat(64),
  outputHash: 'c'.repeat(64),
  checkedAt: '2026-10-09T00:00:00.000Z',
  projectId: 'project-a',
  targetPlatforms: ['youtube', 'youtube', 'invalid'],
};
assert.deepEqual(normalizePublishingCopyAudit(audit)?.targetPlatforms, ['youtube']);
assert.equal(normalizePublishingCopyAudit({ ...audit, enterpriseFactVersion: '' }), null);

let reads = 0;
const load = async () => {
  reads += 1;
  return { version: { id: 'enterprise-facts-v9', revision: 9, contentHash: 'canonical-hash' }, profile: {} as never, context: '' };
};
assert.equal(await assertPublishingCopyFactVersion('tenant-a', {}, load), null);
assert.equal(reads, 0, 'manual copy without an AI audit does not need an enterprise-fact read');
assert.equal((await assertPublishingCopyFactVersion('tenant-a', { enterpriseFactVersion: audit.enterpriseFactVersion, copyAudit: audit, projectId: 'project-a', platform: 'youtube' }, load))?.enterpriseFactVersion, audit.enterpriseFactVersion);
assert.equal(reads, 1);
await assert.rejects(
  assertPublishingCopyFactVersion('tenant-a', { enterpriseFactVersion: 'enterprise-facts-v8', copyAudit: audit }, load),
  (error: unknown) => error instanceof PublishingCopyFactVersionError && error.code === 'publishing_copy_audit_invalid',
);
await assert.rejects(
  assertPublishingCopyFactVersion('tenant-a', { enterpriseFactVersion: audit.enterpriseFactVersion, copyAudit: audit, projectId: 'project-b' }, load),
  (error: unknown) => error instanceof PublishingCopyFactVersionError && error.code === 'publishing_copy_audit_invalid',
);
await assert.rejects(
  assertPublishingCopyFactVersion('tenant-a', { enterpriseFactVersion: audit.enterpriseFactVersion, copyAudit: audit, platform: 'tiktok' }, load),
  (error: unknown) => error instanceof PublishingCopyFactVersionError && error.code === 'publishing_copy_audit_invalid',
);
await assert.rejects(
  assertPublishingCopyFactVersion('tenant-a', { enterpriseFactVersion: audit.enterpriseFactVersion, copyAudit: audit }, async () => ({ version: { id: 'enterprise-facts-v10', revision: 10, contentHash: 'new' }, profile: {} as never, context: '' })),
  (error: unknown) => error instanceof PublishingCopyFactVersionError && error.code === 'enterprise_fact_version_conflict',
);

console.log('publishing copy fact-version tests passed');
