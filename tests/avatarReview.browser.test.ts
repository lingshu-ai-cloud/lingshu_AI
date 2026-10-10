import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

// Start the local Vite server first. PLAYWRIGHT_MODULE may point to a separately installed package.
// No API traffic is allowed, including loopback API routes.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.STUDIO_BROWSER_BASE_URL || 'http://127.0.0.1:5189');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Browser regression must use a local development server');

test('review failure blocks adoption; successful manual refresh does not silently adopt', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.setDefaultTimeout(8000);
    const blocked: string[] = [];
    await page.route('**/*', (route: any) => {
      const url = new URL(route.request().url());
      if (url.origin !== base.origin || url.pathname.includes('/api/')) { blocked.push(url.pathname); return route.abort(); }
      return route.continue();
    });
    await page.goto(new URL('/tests/avatar-review-workbench.html', base).href);
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('button', { name: '采用 / 恢复', exact: true }).isDisabled(), true);
    assert.equal(await page.getByText('已暂停自动重查。处理问题后可手动刷新原任务，不会重新付费生成。', { exact: true }).count(), 1);
    await page.getByRole('button', { name: '刷新原任务', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '正在核验…', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '刷新原任务', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '采用 / 恢复', exact: true }).isEnabled(), true);
    assert.equal(await page.getByLabel('测试状态').innerText(), '模拟刷新次数：1；采用：无');
    await page.getByRole('button', { name: '采用 / 恢复', exact: true }).click();
    assert.equal(await page.getByLabel('测试状态').innerText(), '模拟刷新次数：1；采用：c1');
    await page.getByLabel('用一句话编辑当前镜头').fill('台词改为新的设备介绍');
    await page.getByRole('button', { name: '应用指令', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '当前采用', exact: true }).isDisabled(), true);
    assert.deepEqual(blocked, []);
  } finally { await browser.close(); }
});
