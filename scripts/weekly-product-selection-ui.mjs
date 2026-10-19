import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright-core';

const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Component from '/src/components/socialProgram/WeeklyProductSelectionIntervention.tsx';import '/src/index.css';createRoot(document.getElementById('root')).render(<main style={{maxWidth:720,margin:'24px auto',padding:16}}><Component scope={{programId:'isolated-program',packageId:'isolated-package',packageVersion:7}}/></main>);`;
const publications = Array.from({ length: 16 }, (_, index) => ({ publicationTaskId: `publication-${index + 1}`, motherContentId: `mother-${Math.floor(index * 5 / 16) + 1}`, selectedProductId: null, receiptId: null }));
const products = Array.from({ length: 21 }, (_, index) => ({ id: `product-${index + 1}`, name: `测试商品 ${index + 1}`, sku: null }));
const fixture = { item: { packageVersion: 7, contextHash: 'a'.repeat(64), selectionState: 'consistent', publications, products } };
let vite, browser;
try {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(chrome);
  vite = await createServer({ configFile: false, logLevel: 'error', plugins: [react(), tailwind(), {
    name: 'weekly-product-selection-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/weekly-product-selection-ui') return next();
        const compiled = await transformWithEsbuild(entry, 'entry.tsx', { loader: 'tsx', jsx: 'automatic' });
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/weekly-product-selection-ui', `<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`));
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await mkdir('work/weekly-product-selection-ui', { recursive: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [], blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('overseas_token', 'isolated-read-only-fixture'));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) { blocked.push(`${request.method()} ${url.href}`); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      return route.fulfill(url.pathname.endsWith('/product-selection') ? { json: fixture } : { status: 404, json: { error: 'undeclared_fixture' } });
    });
    await page.goto(`${origin}/weekly-product-selection-ui`);
    const card = page.getByRole('region', { name: '本周发布选品待干预' });
    await card.waitFor();
    await page.getByText('16 / 16 条待选择').waitFor();
    assert.match(await card.innerText(), /5 个母版组|母版组 5/);
    await card.locator('.ant-select').last().click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
    await page.keyboard.press('Escape');
    assert.match(await card.innerText(), /SKU 未登记/);
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    assert(dimensions.scrollWidth <= dimensions.innerWidth + 1, `horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
    const button = page.getByRole('button', { name: '确认本次发布选品' });
    assert.equal(await button.isDisabled(), false);
    const box = await button.boundingBox(); assert(box && box.height >= 44, `touch target too short at ${width}`);
    const selectBox = await card.locator('.ant-select').last().boundingBox(); assert(selectBox && selectBox.height >= 44, `select touch target too short at ${width}`);
    for (const radio of await card.locator('.ant-radio-wrapper').all()) { const radioBox = await radio.boundingBox(); assert(radioBox && radioBox.height >= 44, `radio touch target too short at ${width}`); }
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement !== document.body), `keyboard focus missing at ${width}`);
    await page.screenshot({ path: `work/weekly-product-selection-ui/${width}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    await page.close();
  }
  console.log('PASS isolated product-selection UI: 390/1280, no horizontal overflow, 44px primary target, keyboard focus, zero mutations');
} finally { await browser?.close(); await vite?.close(); }
