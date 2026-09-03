import assert from 'node:assert/strict';
import { upsertMaterialIndex } from './materialIndex.js';

const original = [
  { id: 'a', tenantId: 'tenant-a', file: 'tenants/tenant-a/a.mp4', objectKey: 'materials/tenant-a/a.mp4', url: '' },
  { id: 'b', tenantId: 'tenant-a', file: 'tenants/tenant-a/b.mp4', objectKey: 'materials/tenant-a/b.mp4', url: '' },
  { id: 'c', tenantId: 'tenant-b', file: 'tenants/tenant-b/a.mp4', objectKey: 'materials/tenant-b/a.mp4', url: '' },
];

const inserted = upsertMaterialIndex(original, {
  id: 'd', tenantId: 'tenant-a', file: 'tenants/tenant-a/d.mp4', objectKey: 'materials/tenant-a/d.mp4', url: '',
});
assert.deepEqual(inserted.map(item => item.id), ['a', 'b', 'c', 'd'], 'empty R2 URLs must not collapse unrelated materials');

const retried = upsertMaterialIndex(inserted, {
  id: 'd-retry', tenantId: 'tenant-a', file: 'tenants/tenant-a/d.mp4', objectKey: 'materials/tenant-a/d.mp4', url: '',
});
assert.deepEqual(retried.map(item => item.id), ['a', 'b', 'c', 'd-retry'], 'same tenant + storage identity is idempotently replaced');

const crossTenant = upsertMaterialIndex(retried, {
  id: 'e', tenantId: 'tenant-b', file: 'tenants/tenant-a/d.mp4', objectKey: 'materials/tenant-a/d.mp4', url: '',
});
assert.deepEqual(crossTenant.map(item => item.id), ['a', 'b', 'c', 'd-retry', 'e'], 'storage identity must not cross tenant boundaries');

const sameId = upsertMaterialIndex(crossTenant, {
  id: 'a', tenantId: 'tenant-a', file: 'tenants/tenant-a/a-v2.mp4', objectKey: 'materials/tenant-a/a-v2.mp4', url: '',
});
assert.equal(sameId.filter(item => item.id === 'a').length, 1);
assert.equal(sameId.at(-1)?.file, 'tenants/tenant-a/a-v2.mp4');

console.log('material index tests passed');
