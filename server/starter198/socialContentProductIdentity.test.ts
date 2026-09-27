import assert from 'node:assert/strict';
import { defaultBrief } from './socialContentTaskSupport.js';
import { parseCreateSocialTask, parseCreateSocialWeeklyPlan } from './socialContentValidation.js';

const selected = parseCreateSocialTask({
  title: '爆款裂变',
  objective: '由系统制定',
  productId: 'product-stable-001',
  productRef: '积雪草屏障修护精华',
  mode: 'instant',
  themeId: 'product_value',
});
const brief = defaultBrief(selected);
assert.equal(brief.productId, 'product-stable-001');
assert.equal(brief.productRef, '积雪草屏障修护精华');
assert.notEqual(brief.productId, brief.productRef, '稳定身份与展示名不得混用');

const automatic = defaultBrief(parseCreateSocialTask({
  title: '自动选品制作',
  objective: '由系统制定',
  productId: null,
  productRef: null,
  mode: 'instant',
  themeId: 'product_value',
}));
assert.equal(automatic.productId, null);
assert.equal(automatic.productRef, null, 'auto 模式必须保持空产品身份，不得伪造自由文本产品');

const weekly = parseCreateSocialWeeklyPlan({
  title: '下周内容',
  objective: '验证产品表现',
  productId: 'product-stable-001',
  productRef: '积雪草屏障修护精华',
  items: [{ title: '卖点内容', objective: '展示产品', themeId: 'product_value' }],
});
assert.equal(weekly.productId, 'product-stable-001');
assert.equal(weekly.productRef, '积雪草屏障修护精华');

console.log('social content product identity tests passed');
