import assert from 'node:assert/strict';
import test from 'node:test';
import { readAssistantProductCatalog, createAssistantCatalogProduct } from './assistantProductCatalog';

test('product picker reads tenant knowledge, preserves IDs and saves only versioned product patch', async () => {
  const original = globalThis.fetch;
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'tenant-token' } });
  let profile = { factVersion: { contentHash: 'version-1' }, products: { categories: '护肤', items: [{ id: 'sku-1', name: '面霜', highlights: '保湿' }] } };
  const calls: RequestInit[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/overseas/enterprise/profile'); calls.push(init!);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tenant-token');
      if (init?.method === 'PATCH') {
        assert.equal(new Headers(init.headers).get('if-match'), '"version-1"');
        const patch = JSON.parse(String(init.body)); assert.deepEqual(Object.keys(patch), ['products']);
        assert.equal(patch.products.categories, '护肤'); assert.equal(patch.products.items[0].id, 'sku-1');
        profile = { ...profile, products: patch.products };
      }
      return Response.json(init?.method === 'PATCH' ? { ok: true, profile } : profile);
    };
    assert.deepEqual(await readAssistantProductCatalog(), [{ id: 'sku-1', name: '面霜', highlights: '保湿' }]);
    const added = await createAssistantCatalogProduct(' 新精华 ', ' 新品说明 ');
    assert.equal(added.name, '新精华'); assert.equal(added.highlights, '新品说明'); assert.match(added.id, /^product-/);
    assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
    await assert.rejects(createAssistantCatalogProduct('面霜', ''), /已有同名/);
    globalThis.fetch = async () => Response.json({ message: '企业资料已更新' }, { status: 409 });
    await assert.rejects(createAssistantCatalogProduct('另一个', ''), /企业资料已更新/);
  } finally {
    globalThis.fetch = original;
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
