import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright-core';

const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Component from '/src/components/socialProgram/WeeklySamplePolicyCandidateIntervention.tsx';import '/src/index.css';createRoot(document.getElementById('root')).render(<main style={{maxWidth:720,margin:'24px auto',padding:16}}><Component scope={{programId:'isolated-program',packageId:'isolated-package',packageVersion:7}}/></main>);`;
const product = { productId: 'product-1', productName: '测试商品', productSku: null };
const choices = { item: { packageVersion: 7, contextHash: 'a'.repeat(64), selectionState: 'consistent', products: [{ id: 'product-1', name: product.productName, sku: null }], publications: [{ publicationTaskId: 'publication-1', motherContentId: 'mother-1', selectedProductId: product.productId, receiptId: 'receipt-1' }] } };
const candidates = { item: { contextHash: 'b'.repeat(64), selection: product, frozenCta: 'Contact us on WhatsApp to get your free sample.', candidates: [], policyStatus: 'candidate_only', authorizesProduction: false } };
let vite, browser;
try {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; await access(chrome);
  vite = await createServer({ configFile: false, logLevel: 'error', plugins: [react(), tailwind(), {
    name: 'weekly-sample-policy-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/weekly-sample-policy-ui') return next();
        const compiled = await transformWithEsbuild(entry, 'entry.tsx', { loader: 'tsx', jsx: 'automatic' });
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/weekly-sample-policy-ui', `<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`));
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen(); browser = await chromium.launch({ executablePath: chrome, headless: true });
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  await mkdir('work/weekly-sample-policy-ui', { recursive: true });
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [], blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('overseas_token', 'isolated-read-only-fixture'));
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) { blocked.push(`${request.method()} ${url.href}`); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname.endsWith('/product-selection')) return route.fulfill({ json: choices });
      if (url.pathname.endsWith('/sample-policy-candidates')) return route.fulfill({ json: candidates });
      return route.fulfill({ status: 404, json: { error: 'undeclared_fixture' } });
    });
    await page.goto(`${origin}/weekly-sample-policy-ui`);
    const card = page.getByRole('region', { name: '本任务免费样品政策候选资料' }); await card.waitFor();
    assert.match(await card.innerText(), /上传不等于通过/);
    await card.locator('.ant-select').first().click();
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
    await page.mouse.click(width - 4, 8);
    await page.waitForTimeout(300);
    await page.getByText('已签发商品：测试商品 · SKU 未登记').waitFor();
    assert.match(await card.innerText(), /仅对应发布任务 publication-1/);
    const dims = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }));
    assert(dims.scrollWidth <= dims.width + 1, `horizontal overflow ${width}: ${JSON.stringify(dims)}`);
    const button = page.getByRole('button', { name: '提交本任务政策候选' }); assert.equal(await button.isDisabled(), true);
    const buttonBox = await button.boundingBox(); assert(buttonBox && buttonBox.height >= 44, `button target too short at ${width}`);
    for (const select of await card.locator('.ant-select').all()) { const box = await select.boundingBox(); assert(box && box.height >= 44, `select target too short at ${width}`); }
    const numberBox = await card.locator('.ant-input-number').boundingBox(); assert(numberBox && numberBox.height >= 44, `quantity target too short at ${width}`);
    const fileInput = card.getByLabel('企业政策 PDF'); const fileBox = await fileInput.boundingBox(); assert(fileBox && fileBox.height >= 44, `PDF input too short at ${width}`);
    await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.activeElement !== document.body), `keyboard focus missing at ${width}`);
    await page.screenshot({ path: `work/weekly-sample-policy-ui/${width}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    await page.close();
  }
  console.log('PASS isolated sample-policy UI: 390/1280, no overflow, 44px controls, keyboard focus, zero mutations');
} finally { await browser?.close(); await vite?.close(); }
