import assert from 'node:assert/strict';
import fs from 'node:fs';
import { availableProductPage, PLATFORM_ADS_PAGE_IDS, PLATFORM_ADS_SURFACE_ENABLED } from './config/productSurfaceFlags.js';
import {
  PAGE_IDS,
  PAGE_REGISTRY,
  isPageInNavigationBranch,
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
  strategy: 'hi，灵小枢',
  socialInspiration: '内容创作',
  digitalEmployees: '经营总览',
  adsOverview: '智能投流',
  conversion: '智能客服',
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
]);
assert.deepEqual(PRIMARY_SOCIAL_NAV_PAGES.map(page => PAGE_REGISTRY[page].navLabel), [
  '内容创作',
  '内容制作',
  '发布与渠道',
]);
assert.deepEqual(SOCIAL_PROGRAM_NAV_PAGES, []);
assert.equal(resolvePage('socialWorkspace'), 'smartAssets');
assert.equal(resolvePage('socialSetup'), 'smartAssets');
assert.equal(resolvePage('socialPlanning'), 'smartAssets');
assert.equal(resolvePage('socialAccounts'), 'digitalEmployees');
assert.equal(resolvePage('wecomCustomerService'), 'conversion');

assert.equal(resolvePage('retention'), 'conversion', 'the old retention deep link stays compatible');
assert.equal(resolvePage('accountManagement'), 'socialMonitoring', 'the removed account settings surface forwards to account monitoring');
assert.equal(resolvePage('agentMemory'), 'strategy', 'removed memory page forwards to content creation');
assert.equal(resolvePage('organizationPermissions'), 'strategy', 'removed organization page forwards to content creation');
assert.equal(resolveNavigationPage('agentMemory'), 'strategy');
assert.equal(resolveNavigationPage('organizationPermissions'), 'strategy');
assert.equal(resolveNavigationPage('traffic', 'materials'), 'socialInspiration');
assert.equal(resolveNavigationPage('traffic', 'create'), 'smartAssets');
assert.equal(resolveNavigationPage('traffic', 'publish'), 'traffic');
assert.equal(resolveNavigationPage('traffic', 'accounts'), 'socialMonitoring');
assert.equal(resolveNavigationPage('not-a-page', 'create'), null);
assert.equal(PAGE_REGISTRY.scriptLibrary.navParent, 'smartAssets');
assert.equal(PAGE_REGISTRY.channels.navParent, 'plugins');
assert.equal(PAGE_REGISTRY.accountManagement.navParent, 'socialMonitoring');
assert.equal(PLATFORM_ADS_SURFACE_ENABLED, true, 'the 投流 product entry must be visible');
assert.deepEqual(PLATFORM_ADS_PAGE_IDS, ['adsOverview', 'adsPlans', 'adsCreatives', 'adsManaged']);
assert.deepEqual(['adsOverview', 'adsPlans', 'adsCreatives'].map(page => PAGE_REGISTRY[page as 'adsPlans' | 'adsOverview' | 'adsCreatives'].navLabel), ['智能投流', '计划创编', '素材管理']);
assert.equal(PAGE_REGISTRY.adsPlans.navParent, 'adsOverview');
assert.equal(PAGE_REGISTRY.adsCreatives.navParent, 'adsOverview');
assert.equal(PAGE_REGISTRY.adsManaged.navParent, 'adsPlans', 'legacy AI managed links must resolve under the plan workspace');
assert.equal(isPageInNavigationBranch('adsPlans', 'adsOverview'), true);
assert.equal(isPageInNavigationBranch('adsCreatives', 'adsOverview'), true);
assert.equal(isPageInNavigationBranch('adsManaged', 'adsOverview'), true);
assert.equal(isPageInNavigationBranch('adsManaged', 'conversion'), false);
assert.equal(availableProductPage('adsOverview'), 'adsOverview');

console.log('Page registry tests passed');

for (const retired of ['orders', 'scheduled'] as const) {
  assert.equal(resolvePage(retired), 'digitalEmployees');
  assert.equal(resolveNavigationPage(retired), 'digitalEmployees');
  assert.equal(availableProductPage(retired), 'digitalEmployees');
  const layout = fs.readFileSync(new URL('./components/Layout.tsx', import.meta.url), 'utf8');
  assert.ok(!layout.includes(`navItem('${retired}'`), `${retired} must not appear in navigation`);
}
const app = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(app, /OrderManagementPage|ScheduledPage/, 'retired pages must not be loaded or rendered');

for (const page of ['adsPlans', 'adsCreatives'] as const) {
  assert.equal(PAGE_REGISTRY[page].navParent, 'adsOverview', '投流子页仍应归属平台投流主导航');
}
