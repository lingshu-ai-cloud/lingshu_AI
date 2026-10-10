import assert from 'node:assert/strict';
import { createEnterpriseHomepageDemo, isEnterpriseHomepageDemoAccount } from './enterpriseHomepageDemo.js';

assert.equal(isEnterpriseHomepageDemoAccount(' LINGSHU-ADMIN@LOCAL.TEST '), true);
assert.equal(isEnterpriseHomepageDemoAccount('other@local.test'), false);

const demo = createEnterpriseHomepageDemo({
  company: { name: '事实企业', industry: '智能设备', mainMarkets: '德国、阿联酋', primaryLanguages: '英语' },
  products: { categories: '检测设备', items: [{ name: '视觉检测机' }, { name: '包装工作站' }] },
  strategy: { focusMarkets: '德国、阿联酋', focusProducts: '视觉检测机' },
  customers: { targetProfiles: '海外工厂采购负责人' },
});

assert.equal(demo.synthetic, true);
assert.equal(demo.companyName, '事实企业');
assert.deepEqual(demo.products.slice(0, 2), ['视觉检测机', '包装工作站']);
assert.deepEqual(demo.markets, ['德国', '阿联酋']);
assert.equal(demo.customers.length, 6);
assert.ok(demo.customers.every(customer => customer.isMock && !customer.isReal));
assert.ok(demo.customers.every(customer => /视觉检测机|包装工作站|检测设备/.test(customer.product)));
assert.ok(demo.customers.every(customer => /演示/.test(customer.tags.join(''))));
assert.ok(demo.accounts.every(account => account.status === 'demo'));
assert.equal(demo.warnings.length, 0);
assert.match(demo.notice, /不代表真实经营结果/);

const conflicted = createEnterpriseHomepageDemo({
  company: { name: '资料冲突企业', industry: '玩具' },
  products: { categories: '玩具', items: [{ name: '百褶裙', category: '美妆个护' }] },
});
assert.match(conflicted.warnings[0], /百褶裙.*美妆个护.*玩具/);

console.log('enterprise homepage demo tests passed');
