import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright-core';
import { defaultSocialImageTask } from '../server/socialImage/socialImageTask.ts';

const brief = { headline: 'Fixture product', subheadline: 'Stable caption', originBadge: '', trustBadges: [],
  sellingPoints: [], process: [], categories: [], bottomBar: [], cta: 'Contact' };
const planned = defaultSocialImageTask({ title: 'Isolated GIF', imageType: 'gif_poster',
  productRefs: ['product-a'], productNames: ['Fixture product'], coreClaim: 'Known product' });
Object.assign(planned, { id: 'fixture-gif', version: 5, step: 'generate', status: 'planned', renderBrief: brief });
const delivered = structuredClone(planned);
const gif = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const units = [0, 1, 2, 3].map(index => ({ jobId: `job-${index}`, index, count: 4,
  label: `GIF 画面 ${index + 1}`, role: 'gif_plate', poster: brief,
  idempotencyKey: `key-${index}`, plannedInputHash: `hash-${index}` }));
delivered.step = 'review';
delivered.status = 'review_required';
delivered.renderPlan = { version: 1, sourceHash: 'fixture-source', createdAt: '2026-10-22T00:00:00Z', units };
delivered.generationJobs = units.map(unit => ({ id: unit.jobId, idempotencyKey: unit.idempotencyKey,
  status: 'completed', outputNodeIds: [`plate-${unit.index}`], attempt: 1,
  createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' }));
delivered.gifDelivery = { planVersion: 1, sourceHash: 'fixture-source',
  frameOutputIds: units.map(unit => `frame-${unit.index}`), finalOutputId: 'final-gif' };
delivered.outputs = [...units.map(unit => ({ id: `frame-${unit.index}`, role: 'gif_frame',
  label: unit.label, state: 'quality_checking', mediaUrl: gif, materialId: `material-${unit.index}`,
  sourceJobId: unit.jobId, version: 1, qualityChecks: [] })),
{ id: 'final-gif', role: 'gif_output', label: 'GIF 成片', state: 'quality_checking',
  mediaUrl: gif, materialId: 'material-final', version: 1, qualityChecks: [] }];

const entry = `import React from 'react';import{createRoot}from'react-dom/client';
import SocialImageWorkbench from '/src/components/socialContent/SocialImageWorkbench.tsx';
import '/src/index.css';
const mode=new URLSearchParams(location.search).get('mode');
const task=mode==='generate'?${JSON.stringify(planned)}:mode==='review'?${JSON.stringify(delivered)}:undefined;
createRoot(document.getElementById('root')).render(<SocialImageWorkbench creationPath="material_processing" initialTask={task} onShowCreations={()=>{}}/>);`;

let vite;
let browser;
try {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(chrome);
  vite = await createServer({ configFile: false, logLevel: 'error', plugins: [react(), tailwind(), {
    name: 'isolated-gif-workbench', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/gif-workbench') return next();
        const compiled = await transformWithEsbuild(entry, 'gif-fixture.tsx', { loader: 'tsx', jsx: 'automatic' });
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/gif-workbench', `<html><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`));
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/overseas/enterprise/profile') return route.fulfill({ json: {
      profile: { products: { items: [{ id: 'product-a', name: 'Fixture product' }] } },
    } });
    if (url.pathname === '/api/overseas/studio/materials') return route.fulfill({ json: {
      items: [], status: 'ready', sources: [],
    } });
    return route.fulfill({ status: 404, json: { error: 'undeclared_fixture' } });
  });

  await page.goto(`${origin}/gif-workbench`);
  await page.locator('label').filter({ hasText: '内容类型' }).locator('.ant-select').click();
  await page.getByText('GIF 动态海报', { exact: true }).last().click();
  assert.match(await page.locator('label').filter({ hasText: '内容类型' }).innerHTML(), /GIF 动态海报/);

  await page.goto(`${origin}/gif-workbench?mode=generate`);
  await page.getByRole('button', { name: '继续未完成单元或收口成片' }).click();
  await page.getByText('确认生成 GIF 的 4 张背景底图？').last().waitFor();
  await page.getByText(/最多提交 4 个独立的 GPT Image 2 付费请求/).waitFor();
  await page.getByRole('button', { name: '暂不生成' }).click();
  assert.equal(writes.length, 0, 'cancelling GIF approval must not send any write request');

  await page.goto(`${origin}/gif-workbench?mode=review`);
  await page.getByRole('link', { name: '下载GIF 成片' }).waitFor();
  await page.getByRole('link', { name: '查看GIF 画面 1合成帧' }).waitFor();
  await page.reload();
  await page.getByRole('link', { name: '下载GIF 成片' }).waitFor();
  assert.equal(await page.locator('img[alt="GIF 成片预览"]').count(), 1);
  assert.equal(writes.length, 0);
  assert.deepEqual(errors, []);
  console.log('Isolated GIF browser workflow passed: selectable, paid approval cancellation, restored final GIF and frames; zero writes.');
} finally {
  await browser?.close();
  await vite?.close();
}
