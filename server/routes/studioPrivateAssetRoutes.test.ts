import assert from 'node:assert/strict';
import test from 'node:test';
import { materialRecordObjectKey } from './studioPrivateAssetRoutes.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';

test('metadata-only inventory skips catalog byte projection and preserves tenant isolation', async () => {
  const result = await readMaterialLibrary('a', {
    local: () => [{ id: 'mine', tenantId: 'a', scope: 'own' }, { id: 'other', tenantId: 'b', scope: 'own' }],
    cloud: async () => ({ items: [], source: { source: 'database', state: 'ready', message: 'ok' } }),
    dataStore: { list: async () => { throw new Error('unexpected catalog read'); } } as never,
    includeEnterpriseProductImages: false,
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items.map(item => item.id), ['mine']);
});

test('existing material thumbnails resolve without full enterprise image projection', async () => {
  let calls = 0;
  const read = (async (tenant, options) => {
    calls++;
    assert.equal(tenant, 'a');
    assert.equal(options?.includeEnterpriseProductImages, false);
    return { items: [{ id: 'video', objectKey: 'video.mp4', posterObjectKey: 'poster.jpg' }] };
  }) as typeof readMaterialLibrary;
  assert.equal(await materialRecordObjectKey('a', 'video', 'poster', read), 'poster.jpg');
  assert.equal(await materialRecordObjectKey('a', 'video', 'media', read), 'video.mp4');
  assert.equal(calls, 2);
});

test('profile-only images retain the full validated inventory fallback', async () => {
  const calls: unknown[] = [];
  const read = (async (_tenant, options) => {
    calls.push(options);
    return { items: options ? [] : [{ id: 'product', objectKey: 'product.png' }] };
  }) as typeof readMaterialLibrary;
  assert.equal(await materialRecordObjectKey('a', 'product', 'media', read), 'product.png');
  assert.deepEqual(calls, [{ includeEnterpriseProductImages: false }, undefined]);
});

test('missing and ambiguous authorized records do not expose guessed object keys', async () => {
  const missing = (async () => ({ items: [] })) as unknown as typeof readMaterialLibrary;
  assert.equal(await materialRecordObjectKey('a', '../other-tenant', 'poster', missing), '');
  let calls = 0;
  const ambiguous = (async () => {
    calls++;
    return { items: [{ id: 'dup', objectKey: 'a' }, { id: 'dup', objectKey: 'b' }] };
  }) as typeof readMaterialLibrary;
  assert.equal(await materialRecordObjectKey('a', 'dup', 'media', ambiguous), '');
  assert.equal(calls, 1);
});
