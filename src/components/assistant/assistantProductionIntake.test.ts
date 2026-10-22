import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantProductionIntent, resolveAssistantEnterpriseProduct } from './assistantProductionIntake';

test('production intent only routes explicit artifact requests with bounded media details', () => {
  assert.equal(assistantProductionIntent('怎么制作一条短视频？'), null);
  assert.equal(assistantProductionIntent('分析这条视频'), null);
  const intent = assistantProductionIntent('请制作一条 20 秒 TikTok 竖版短视频，推广「青柠精华」');
  assert.ok(intent);
  assert.equal(intent.productQuery, '青柠精华');
  assert.deepEqual(intent.platforms, ['tiktok']);
  assert.deepEqual(intent.formats, ['短视频']);
  assert.equal(intent.aspectRatio, '9:16');
  assert.equal(intent.targetDurationSeconds, 20);
  assert.equal(assistantProductionIntent('请制作一条 90 秒视频')?.targetDurationSeconds, null);
});

test('enterprise product resolution reads authenticated profile and never invents a missing product', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'test-token' } });
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls += 1;
      assert.equal(url, '/api/overseas/enterprise/profile');
      assert.equal(init?.credentials, 'same-origin');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
      return Response.json({ profile: { products: { items: [{ id: 'product-1', name: '青柠精华', sku: 'LIME-1', highlights: '温和' }] } } });
    };
    await assert.rejects(resolveAssistantEnterpriseProduct(''), /请在产品名称外/);
    assert.equal(calls, 0, 'missing product must fail before a network read');
    const product = await resolveAssistantEnterpriseProduct('青柠精华');
    assert.equal(product.id, 'product-1');
    assert.equal(product.label, '青柠精华');
    assert.match(product.info, /产品SKU：LIME-1/);
    await assert.rejects(resolveAssistantEnterpriseProduct('不存在的产品'), /企业中心没有找到已确认产品/);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
