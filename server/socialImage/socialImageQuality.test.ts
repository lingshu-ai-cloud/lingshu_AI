import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSocialImageTask } from './socialImageTask.js';
import { socialImageDeterministicChecks } from './socialImageQuality.js';

test('deterministic preflight passes only evidence it can prove', () => {
  const task = defaultSocialImageTask({
    title: '产品图', coreClaim: '已确认主张', productRefs: ['product-1'], productNames: ['产品一'],
    enterpriseAssets: [{ assetId: 'product-1', role: 'product', name: '产品一', source: 'enterprise_knowledge_base' }],
  });
  task.imageTextContract.headline = '产品标题';
  task.imageTextContract.requiredFacts = ['已确认主张'];
  const checks = socialImageDeterministicChecks(task);
  assert.equal(checks.find(item => item.key === 'product_identity')?.verdict, 'pass');
  assert.equal(checks.find(item => item.key === 'fact_consistency')?.verdict, 'pass');
  assert.equal(checks.find(item => item.key === 'packaging_visibility')?.verdict, 'uncertain');
  assert.equal(checks.find(item => item.key === 'subject_visibility')?.verdict, 'uncertain');
});

test('viral replication without a benchmark image cannot pass reference preflight', () => {
  const task = defaultSocialImageTask({ creationPath: 'viral_replication', productRefs: ['product-1'] });
  const checks = socialImageDeterministicChecks(task);
  assert.equal(checks.find(item => item.key === 'reference_structure_similarity')?.verdict, 'fail');
});
