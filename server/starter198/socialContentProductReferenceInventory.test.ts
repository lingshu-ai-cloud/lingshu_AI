import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedProductReferenceImageIds } from './socialContentProductReferenceInventory.js';
const image = {id: 'actual-KB-image', tenantId: 'tenant', type: 'image', productId: 'SKU',
  contentSha256: 'a'.repeat(64), sourceType: 'social_task_upload'};
const ids = (record = image) => ownedProductReferenceImageIds({records: [record], tenantId: 'tenant', productId: 'SKU', productRef: null});
test('same-product image reference is admitted without unrelated clip-action analysis', () => {
  assert.deepEqual(ids(), ['actual-KB-image']);
});
test('selected enterprise product image URL binds its hashed material when legacy material identity fields are absent', () => {
  const legacy = {...image, productId: undefined, sourceUrl: '/api/overseas/enterprise/assets/rs001.png'};
  assert.deepEqual(ownedProductReferenceImageIds({records: [legacy], tenantId: 'tenant', productId: 'GUIANFA-RS-001',
    productRef: 'product:GUIANFA-RS-001', enterpriseProductImageUrls: ['/api/overseas/enterprise/assets/rs001.png']}), ['actual-KB-image']);
});
test('wrong identity, shared ownership, generated package and missing byte hash cannot become actual KB references', () => {
  for (const change of [{productId: 'OTHER'}, {tenantId: 'other'}, {scope: 'shared'}, {type: 'video'},
    {sourceType: 'ai-generated'}, {synthetic: true}, {contentSha256: ''}]) assert.deepEqual(ids({...image, ...change}), []);
});
