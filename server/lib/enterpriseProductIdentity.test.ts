import assert from 'node:assert/strict';
import { enterpriseProductIdentity, mergeEnterpriseProductIdentity } from './enterpriseProductIdentity.js';

assert.equal(
  enterpriseProductIdentity({ id: 'product-stable-id', sku: 'SKU-1', name: '精华液' }, 0),
  'product-stable-id',
  '已持久化的产品 ID 必须优先于 SKU 和展示名',
);
assert.equal(
  enterpriseProductIdentity({ productId: 'legacy-product-id', sku: 'SKU-1', name: '精华液' }, 0),
  'legacy-product-id',
  '历史 productId 在迁移期间仍是稳定身份',
);
assert.equal(
  enterpriseProductIdentity({ id: '  ', productId: 'legacy-product-id', sku: 'SKU-1', name: '精华液' }, 0),
  'legacy-product-id',
  '空白 id 不得遮蔽已持久化的 productId',
);
assert.equal(enterpriseProductIdentity({ sku: 'SKU-1', name: '精华液' }, 0), 'SKU-1');
const generated = enterpriseProductIdentity({ name: '无 SKU 精华液' }, 3);
assert.match(generated, /^product-[a-f0-9]{16}$/);
assert.equal(generated, enterpriseProductIdentity({ name: '无 SKU 精华液' }, 3), '无 SKU 产品也必须得到可重复的稳定 ID');
assert.equal(generated, enterpriseProductIdentity({ name: '无 SKU 精华液' }, 99), '调整产品表顺序不得改变历史产品身份');
assert.notEqual(generated, enterpriseProductIdentity({ name: '另一个产品' }, 3));
assert.equal(
  enterpriseProductIdentity({ id: generated, name: '改名后的无 SKU 精华液' }, 3),
  generated,
  '一旦回填稳定 ID，后续改名不得改变产品身份',
);
assert.deepEqual(
  mergeEnterpriseProductIdentity(
    { id: 'product-stable-id', sku: 'SKU-1', name: '旧名称' },
    { id: 'new-import-id', sku: 'SKU-1', name: '新名称' },
    0,
  ),
  { id: 'product-stable-id', sku: 'SKU-1', name: '新名称' },
  '重复导入只更新展示信息，不得替换已持久化的产品 ID',
);

console.log('enterprise product identity tests passed');
