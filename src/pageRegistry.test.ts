import assert from 'node:assert/strict';
import {
  PAGE_IDS,
  PAGE_REGISTRY,
  PRIMARY_SOCIAL_NAV_PAGES,
  SOCIAL_PROGRAM_NAV_PAGES,
  resolveNavigationPage,
  resolvePage,
} from './pageRegistry.js';

assert.equal(new Set(PAGE_IDS).size, PAGE_IDS.length, 'page IDs must be unique');
for (const page of PAGE_IDS) {
  assert.ok(PAGE_REGISTRY[page].navLabel.trim(), `${page} must have a nav label`);
  assert.ok(PAGE_REGISTRY[page].canonicalTitle.trim(), `${page} must have a canonical title`);
}

for (const [page, title] of Object.entries({
  strategy: '首页',
  digitalEmployees: '智能经营',
  conversion: '我的会话',
  orders: '订单',
  enterprise: '企业知识库',
  scheduled: '定时任务',
})) {
  const definition = PAGE_REGISTRY[page as keyof typeof PAGE_REGISTRY];
  assert.equal(definition.navLabel, title);
  assert.equal(definition.canonicalTitle, title);
}

assert.deepEqual(PRIMARY_SOCIAL_NAV_PAGES, [
  'socialInspiration',
  'smartAssets',
  'traffic',
  'socialMonitoring',
]);
assert.deepEqual(PRIMARY_SOCIAL_NAV_PAGES.map(page => PAGE_REGISTRY[page].navLabel), [
  '灵感中心',
  '内容制作',
  '发布与渠道',
  '内容监控',
]);
assert.deepEqual(SOCIAL_PROGRAM_NAV_PAGES, [
  'socialWorkspace',
  'socialSetup',
  'socialAccounts',
  'socialPlanning',
]);
assert.deepEqual(SOCIAL_PROGRAM_NAV_PAGES.map(page => PAGE_REGISTRY[page].navLabel), [
  '经营工作台',
  '项目搭建',
  '账号矩阵',
  '月周计划',
]);

assert.equal(resolvePage('retention'), 'conversion', 'the old retention deep link stays compatible');
assert.equal(resolvePage('accountManagement'), 'traffic', 'the removed account settings surface forwards to publishing');
assert.equal(resolveNavigationPage('traffic', 'materials'), 'socialInspiration');
assert.equal(resolveNavigationPage('traffic', 'create'), 'smartAssets');
assert.equal(resolveNavigationPage('traffic', 'publish'), 'traffic');
assert.equal(resolveNavigationPage('traffic', 'accounts'), 'traffic');
assert.equal(resolveNavigationPage('not-a-page', 'create'), null);
assert.equal(PAGE_REGISTRY.scriptLibrary.navParent, 'smartAssets');
assert.equal(PAGE_REGISTRY.channels.navParent, 'plugins');
assert.equal(PAGE_REGISTRY.accountManagement.navParent, 'traffic');

console.log('Page registry tests passed');
