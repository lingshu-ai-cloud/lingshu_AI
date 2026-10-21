import assert from 'node:assert/strict';
import { generateAuditedPlatformCopies } from './auditedCopyAdaptation.js';

const enterpriseContext = [
  '企业事实版本：enterprise-facts-v7-publishing',
  '公司名称：Acme Industrial',
  '主营产品：Alignment equipment',
  '产品1：Alignment Station；卖点：visible alignment workflow',
].join('\n');
const project = {
  tenant_id: 'tenant-a',
  spec: {
    productInfo: '产品名称：Alignment Station\n产品卖点：visible alignment workflow',
  },
};
const base = {
  tenantId: 'tenant-a',
  title: 'Alignment Station',
  description: 'See the visible alignment workflow.',
  language: 'English',
  targetPlatforms: ['tiktok', 'facebook'] as const,
  currentCopy: {},
  requireAlternative: false,
  projectId: 'project-a',
};
const dependencies = {
  loadEnterpriseContext: async () => enterpriseContext,
  loadProject: async () => project,
  now: () => new Date('2026-09-14T00:00:00.000Z'),
};

const success = await generateAuditedPlatformCopies({ ...base, targetPlatforms: [...base.targetPlatforms] }, dependencies);
assert.equal(success.status, 200);
assert.equal(success.body.ok, true);
assert.equal(success.body.source, 'canonical_copy');
assert.equal(success.body.provenance, 'user_confirmed');
assert.equal(success.body.qualityStatus, 'passed');
assert.equal(success.body.publishable, true);
assert.match(String((success.body.audit as Record<string, unknown>).enterpriseFactsHash), /^[a-f0-9]{64}$/);
assert.equal((success.body.audit as Record<string, unknown>).enterpriseFactVersion, 'enterprise-facts-v7-publishing');
const copy = success.body.copy as Record<string, { caption?: string; text?: string; hashtags?: string[] }>;
assert.equal(copy.tiktok?.caption, base.description);
assert.equal(copy.facebook?.text, base.description);
assert.deepEqual(copy.tiktok?.hashtags, copy.facebook?.hashtags);

const inventedClaim = await generateAuditedPlatformCopies({ ...base, description: 'Low MOQ and fast turnaround.', targetPlatforms: ['tiktok'] }, dependencies);
assert.equal(inventedClaim.status, 422);
assert.equal(inventedClaim.body.source, 'ai_rejected');
assert.equal('copy' in inventedClaim.body, false);

const regenerate = await generateAuditedPlatformCopies({ ...base, targetPlatforms: [...base.targetPlatforms], requireAlternative: true }, dependencies);
assert.equal(regenerate.status, 422);
assert.equal(regenerate.body.error, 'platform_copy_rewrite_disabled');

const noFacts = await generateAuditedPlatformCopies({ ...base, targetPlatforms: ['tiktok'], projectId: undefined }, {
  ...dependencies,
  loadEnterpriseContext: async () => '',
});
assert.equal(noFacts.status, 422);
assert.equal(noFacts.body.error, 'enterprise_facts_required');

console.log('audited canonical publishing copy tests passed');
