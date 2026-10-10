import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const output = process.env.BENCHMARK_UI_OUTPUT || 'data/qa-reports/benchmark-analysis-20261007';
await mkdir(output, { recursive: true });
let server; let browser;
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errors = []; const mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) mutations.push(request.url()); });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const open = async state => {
    await page.goto(`${origin}/benchmark-analysis-preview.html${state ? `?state=${state}` : ''}`);
    await page.getByRole('heading', { name: '全片内容结构', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && getComputedStyle(dialog).opacity === '1' && getComputedStyle(dialog.parentElement).opacity === '1';
    });
  };
  await open();
  let structure = page.locator('section[aria-label="全片内容结构"]');
  const structureText = await structure.innerText();
  for (const value of ['9 个镜头', '真人口播', '工厂实拍', '产品实拍', 'D2C', '其他通用素材']) assert.ok(structureText.includes(value), value);
  assert.equal(await structure.locator('ol > li').count(), 5, 'the structure overview must expose exactly five production categories');
  await page.screenshot({ path: `${output}/desktop.png` });
  await page.getByRole('tab', { name: '分镜与脚本', exact: true }).click();
  const benchmark = page.locator('[data-benchmark-analysis]');
  await benchmark.getByRole('heading', { name: '原片逐镜画面与脚本', exact: true }).waitFor();
  assert.equal(await benchmark.locator('article').count(), 9);
  assert.equal(await benchmark.locator('img').count(), 0, 'missing frames must not use a cover as evidence');
  assert.ok((await benchmark.innerText()).includes('已拆解 9 个镜头 · 3 个口播段'));
  await page.getByRole('button', { name: '按口播段查看', exact: true }).click();
  const speech = benchmark.locator('details').filter({ hasText: 'Masks, cream, foundation and more.' });
  await speech.locator('summary').first().click();
  assert.equal(await speech.locator('article').count(), 6);
  assert.equal(await speech.locator('article:visible').count(), 6);
  assert.ok((await speech.innerText()).includes('覆盖 6 个镜头'));
  await speech.locator('summary').first().click();
  assert.equal(await speech.locator('article:visible').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  const horizontalOverflow = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return document.documentElement.scrollWidth > innerWidth || dialog.scrollWidth > dialog.clientWidth;
  });
  assert.equal(horizontalOverflow, false);
  await benchmark.evaluate(element => element.parentElement.scrollTop = 0);
  await page.screenshot({ path: `${output}/mobile.png` });
  await open('pending');
  assert.ok(!(await page.getByRole('dialog').innerText()).includes('待补齐或复核'));
  assert.ok(!(await page.getByRole('dialog').innerText()).includes('分析字段齐全'));
  await open('failed');
  assert.ok(!(await page.getByRole('dialog').innerText()).includes('分析待复核'));
  await open('legacy');
  await page.getByRole('tab', { name: '分镜与脚本', exact: true }).click();
  assert.ok((await page.locator('[data-benchmark-analysis]').innerText()).includes('依据已有描述整理'));
  await page.getByRole('tab', { name: '内容结构和钩子', exact: true }).click();
  structure = page.locator('section[aria-label="全片内容结构"]');
  assert.ok((await structure.locator('ol > li').filter({ hasText: '真人口播' }).first().innerText()).includes('2 个镜头'));
  await open('lighting');
  structure = page.locator('section[aria-label="全片内容结构"]');
  for (const [label, count] of [['真人口播', 3], ['产品实拍', 1], ['工厂实拍', 2]]) {
    assert.ok((await structure.locator('ol > li').filter({ hasText: label }).first().innerText()).includes(`${count} 个镜头`), `${label} ${count}`);
  }
  const lighting = await structure.innerText();
  assert.ok(!lighting.includes('待判断')); assert.ok(!lighting.includes('作用待确认'));
  assert.ok(!lighting.includes('分析待复核')); assert.ok(!lighting.includes('待补齐或复核'));
  await page.getByRole('tab', { name: '分镜与脚本', exact: true }).click();
  assert.equal(await page.locator('[data-benchmark-analysis] article').count(), 6);
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.screenshot({ path: `${output}/lighting-desktop.png` });
  assert.deepEqual(errors, []); assert.deepEqual(mutations, [], 'expansion and display cannot start paid analysis');
  console.log('Benchmark UI acceptance passed: top section order, nine shots, six-shot speech expansion/collapse, missing-frame placeholders, 390px layout, pending/failed/legacy states; no runtime errors or mutation requests.');
} finally {
  await browser?.close(); await server?.close();
}
