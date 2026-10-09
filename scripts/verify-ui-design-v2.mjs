// Isolated browser acceptance. All API traffic is intercepted; no real jobs, data or credentials are used.
// UI_QA_PLAYWRIGHT can point to an existing Playwright module when it is not installed in this repo.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.UI_QA_PLAYWRIGHT || 'playwright-core');
const origin = process.env.UI_QA_ORIGIN || 'http://127.0.0.1:5177';
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, 'UI acceptance must only use a local preview');
const output = path.resolve(process.env.UI_QA_OUTPUT || 'artifacts/ui-design-v2');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.UI_QA_BROWSER_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
const networkErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') networkErrors.push(message.text()); });
page.on('requestfailed', request => networkErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
await context.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const session = { user: { id: 'ui-design-fixture', name: '设计验收', email: 'design@example.test', tenantId: 'ui-design-fixture', role: 'super_admin' }, tenant: { id: 'ui-design-fixture', name: '灵枢设计验收（隔离数据）', subscriptionStatus: 'active', subscriptionPlan: null, subscriptionExpiresAt: null }, platformAdmin: true };
  let data = { items: [], records: [], tasks: [], runs: [], videos: [], materials: [], accounts: [], products: [], facts: [], rules: [], total: 0, totalPages: 0, page: 1 };
  if (url.pathname.endsWith('/auth/me')) data = session;
  if (url.pathname.endsWith('/auth/employees')) data = { employees: [{ ...session.user, isCurrent: true, created: '2026-10-09' }] };
  if (url.pathname.includes('/starter-198/')) return route.fulfill({ status: 403, json: { code: 'profile_not_enabled', error: 'profile_not_enabled' } });
  return route.fulfill({ status: 200, json: data });
});
await context.route(`${origin}/__design-system-qa`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script type="module">
import { injectIntoGlobalHook } from '/@react-refresh';
injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
</script><script type="module" src="/scripts/fixtures/ui-design-v2.tsx">
</script></body></html>` }));
try {
  await page.goto(`${origin}/__design-system-qa`);
  await page.getByRole('heading', { name: '数字员工工作排期' }).waitFor();
  await page.getByText('已加载 1 项排期', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('canvas').length === 2);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(output, 'desktop-calendar-charts.png'), fullPage: true });
  await page.getByText('新品生产流程｜质量追踪与交付', { exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: path.join(output, 'calendar-detail.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '排期详情' }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '账号设置', exact: true }).click();
  await page.getByRole('dialog', { name: '账号设置' }).waitFor();
  await page.getByRole('button', { name: '确认修改' }).click();
  await page.getByText('请输入当前密码', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'account-form-validation.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '账号设置' }).waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'shared components must not overflow the mobile viewport');
  await page.screenshot({ path: path.join(output, 'mobile-calendar-charts.png'), fullPage: true });
  assert.deepEqual(errors, [], 'shared components must not crash');
  console.log(JSON.stringify({ passed: ['calendar render', 'Chart.js render', 'event detail', 'Escape dismissal', 'password form inline validation', 'mobile overflow'], screenshots: output }));
} catch (error) {
  console.error(JSON.stringify({ browserErrors: errors, networkErrors: networkErrors.slice(0, 10), visibleText: (await page.locator('body').innerText()).slice(0, 3000) }));
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
