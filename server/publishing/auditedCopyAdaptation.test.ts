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
let calls = 0;
const dependencies = {
  loadEnterpriseContext: async () => enterpriseContext,
  loadProject: async () => project,
  generate: async (prompt: string) => {
    calls += 1;
    assert.match(prompt, /Confirmed enterprise facts/);
    assert.match(prompt, /Alignment Station/);
    return JSON.stringify({
      tiktok: { caption: 'See the visible alignment workflow.', hashtags: ['#alignment'] },
      facebook: { text: 'A closer look at the visible alignment workflow.' },
    });
  },
  now: () => new Date('2026-09-14T00:00:00.000Z'),
};

const success = await generateAuditedPlatformCopies({ ...base, targetPlatforms: [...base.targetPlatforms] }, dependencies);
assert.equal(success.status, 200);
assert.equal(success.body.ok, true);
assert.equal(success.body.source, 'ai');
assert.equal(success.body.qualityStatus, 'passed');
assert.equal(success.body.publishable, true);
assert.match(String((success.body.audit as Record<string, unknown>).enterpriseFactsHash), /^[a-f0-9]{64}$/);
assert.equal((success.body.audit as Record<string, unknown>).enterpriseFactVersion, 'enterprise-facts-v7-publishing');

const missingPlatform = await generateAuditedPlatformCopies({ ...base, targetPlatforms: [...base.targetPlatforms] }, {
  ...dependencies,
  generate: async () => JSON.stringify({ tiktok: { caption: 'Only one platform returned.' } }),
});
assert.equal(missingPlatform.status, 502);
assert.equal(missingPlatform.body.publishable, false);
assert.equal('copy' in missingPlatform.body, false, 'incomplete model output must not be filled with fallback copy');

const modelFailure = await generateAuditedPlatformCopies({ ...base, targetPlatforms: [...base.targetPlatforms] }, {
  ...dependencies,
  generate: async () => { throw new Error('network unavailable'); },
});
assert.equal(modelFailure.status, 502);
assert.equal(modelFailure.body.source, 'ai_failed');
assert.equal('copy' in modelFailure.body, false, 'model failure must preserve the caller copy instead of returning a fake success');

const inventedClaim = await generateAuditedPlatformCopies({ ...base, targetPlatforms: ['tiktok'] }, {
  ...dependencies,
  generate: async () => JSON.stringify({ tiktok: { caption: 'Low MOQ and fast turnaround.' } }),
});
assert.equal(inventedClaim.status, 422);
assert.equal(inventedClaim.body.source, 'ai_rejected');
assert.equal('copy' in inventedClaim.body, false);

const noFacts = await generateAuditedPlatformCopies({ ...base, targetPlatforms: ['tiktok'], projectId: undefined }, {
  ...dependencies,
  loadEnterpriseContext: async () => '',
  generate: async () => { throw new Error('must not be called'); },
});
assert.equal(noFacts.status, 422);
assert.equal(noFacts.body.error, 'enterprise_facts_required');
assert.equal(calls, 1);

console.log('audited publishing copy adaptation tests passed');
