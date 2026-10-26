import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright-core';
import { defaultSocialImageTask } from '../server/socialImage/socialImageTask.ts';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../shared/contracts/socialImageCreation.ts';

// Isolated browser contract: API writes are intercepted; no database or supplier is contacted.
const source = `import React,{useState,useEffect,StrictMode} from 'react';import{createRoot}from'react-dom/client';import LingshuProvider from '/src/components/ui/LingshuProvider.tsx';import ContentCreationHome from '/src/components/ContentCreationHome.tsx';
import SocialContentPlanningPage from '/src/components/socialContent/SocialContentPlanningPage.tsx';import '/src/index.css';import '/src/styles/design-system.css';import '/src/styles/creator-workspace.css';
const chat=new URLSearchParams(location.search).has('chat');
const request={requestId:1,themeId:'product_value',mode:'instant',creationPath:'viral_replication',prefill:{platforms:['instagram']},sourceContext:{originLabel:chat?'来自灵小枢对话':'来自灵感中心',referenceContentType:'image',referenceTitle:'参考图文',...(chat?{referenceMaterialId:'reference-1'}:{referenceMediaUrl:'/api/overseas/videos/ref-1/image/0',referenceCaption:'原始参考配文'})}};
function Fixture(){const[selected,setSelected]=useState(new URLSearchParams(location.search).has('home')?null:request);useEffect(()=>{const handler=e=>setSelected(e.detail.contentCreationRequest);window.addEventListener('lingshu:navigate',handler);return()=>window.removeEventListener('lingshu:navigate',handler)},[]);return selected?<SocialContentPlanningPage initialCreateRequest={selected} onNavigate={()=>{}} onNavigateWithTask={()=>{}} onLaunchStudio={()=>{}}/>:<ContentCreationHome/>;}
createRoot(document.getElementById('root')).render(<StrictMode><LingshuProvider><div style={{height:'100dvh'}}><Fixture/></div></LingshuProvider></StrictMode>);`;
const evidenceDir = process.env.IMAGE_REPLICATION_EVIDENCE_DIR;
let vite, browser;
const cacheDir = await mkdtemp(path.join(tmpdir(), 'lingshu-image-replication-vite-'));
try {
  vite = await createServer({ configFile: false, cacheDir, plugins: [react(), tailwind(), {
    name: 'isolated-image-replication-test', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/image-replication-test')) return next();
        const compiled = await transformWithEsbuild(source, 'image-fixture.tsx', { loader: 'tsx', jsx: 'automatic' });
        const html = await server.transformIndexHtml('/image-replication-test', `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false }, optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'antd', 'antd/locale/zh_CN', 'lucide-react'] } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.IMAGE_REPLICATION_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  for (const mode of ['inspiration', 'chat', 'home', 'blocked']) {
    const mobile = mode === 'chat';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(dark => {
      localStorage.setItem('overseas_token', 'isolated-test-session');
      localStorage.setItem('lingshu:appearance', dark ? 'dark' : 'light');
    }, mobile);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [], unexpected = [], writes = [];
    let content, run, failedOnce = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname;
      if (request.method() === 'GET' && /\/image\/0$|\/reference\.png$/.test(path)) return route.fulfill({ body: png, contentType: 'image/png' });
      if (path === '/api/overseas/enterprise/profile') return route.fulfill({ json: { profile: { products: { items: [{ id: 'product-1', name: '企业测试产品', highlights: '已核验的产品特点' }] } } } });
      if (path === '/api/overseas/studio/materials') return route.fulfill({ json: { items: [{ id: 'reference-1', type: 'image', name: '对话参考图', scope: 'own', url: '/api/overseas/studio/private-assets/materials/reference.png' }], status: 'ready' } });
      if (request.method() !== 'GET') writes.push({ path, body: request.postDataJSON(), key: request.headers()['idempotency-key'] });
      if (path.endsWith('/social-content/tasks') && request.method() === 'POST') {
        const brief = request.postDataJSON();
        content ||= { taskId: 'content-1', version: 'v1', status: 'draft', brief: { ...brief, markets: [], dueAt: null },
          readiness: { complete: true, missing: [] }, packageSelection: [], sourceCount: 0, artifactCount: 0, approvedArtifactCount: 0,
          deliveryPackageCount: 0, publicationCount: 0, metricSubmissionCount: 0, createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z',
          sources: [], artifacts: [], deliveryPackages: [], publications: [], metricSubmissions: [] };
        return route.fulfill({ json: { task: content } });
      }
      if (path.endsWith('/content-tasks/content-1/runs')) {
        run ||= { ...defaultSocialImageTask({ creationPath: 'viral_replication', productRefs: ['product-1'], productNames: ['企业测试产品'], coreClaim: content.brief.objective }),
          id: 'image-1', schemaVersion: 'social-image-creation.v3', deliverySpec: { platform: 'instagram', aspectRatio: '4:5', language: 'en', format: 'jpg', outputCount: 1 },
          productionRuntime: { binding: { contentTaskId: 'content-1', contentTaskVersion: 'v1' }, currentNode: 'business_context', nodes: [], events: [], nodeOutputs: [] } };
        return route.fulfill({ json: { ok: true, task: run, resumed: false } });
      }
      if (path === '/api/overseas/social-images/tasks/image-1') {
        const { expectedVersion, patch } = request.postDataJSON();
        assert.equal(expectedVersion, run.version);
        run = { ...run, ...patch, version: run.version + 1 };
        if (!failedOnce) { failedOnce = true; return route.fulfill({ status: 503, json: { error: '连接中断，请恢复本次复刻任务' } }); }
        return route.fulfill({ json: { ok: true, task: run } });
      }
      if (request.method() === 'GET' && path.endsWith('/social-content/tasks/content-1')) return route.fulfill({ json: { task: content } });
      if (path.endsWith('/tasks/image-1/evidence/prepare')) {
        assert.equal(run.contentBrief.productRefs[0], 'product-1'); assert.ok(run.referenceSnapshot.imageUrls[0]);
        if (mode === 'blocked') return route.fulfill({ status: 422, json: { ok: false, error: '企业产品图片缺少可核验授权，请补充后继续' } });
        run.version++; return route.fulfill({ json: { ok: true, task: run } });
      }
      if (path === '/api/overseas/studio/fb-poster') {
        assert.equal(request.postDataJSON().imageTaskId, 'image-1');
        run = { ...run, version: run.version + 1, status: 'planned', imageTextContract: { ...run.imageTextContract, headline: '企业产品主视觉', caption: '已核验的企业产品配文' },
          productionRuntime: { ...run.productionRuntime, nodes: [{ nodeId: 'director_brief', status: 'completed' }] } };
        return route.fulfill({ json: { ok: true, source: 'ai', imageTask: run, poster: { headline: '企业产品主视觉', subheadline: '已核验的产品特点', cta: '咨询产品详情' }, caption: '已核验的企业产品配文', hashtags: ['product'], fieldsToConfirm: [] } });
      }
      if (path.endsWith('/tasks/image-1/compile-layered')) { run.version++; return route.fulfill({ json: { ok: true, task: run } }); }
      if (path.endsWith('/tasks/image-1/render-layered')) {
        run = { ...run, version: run.version + 1, status: 'review_required', step: 'review', outputs: [{ id: 'candidate-1', role: 'single', label: '图片首版', state: 'quality_checking', version: 1,
          mediaUrl: '/api/overseas/studio/private-assets/materials/reference.png', contentHash: 'a'.repeat(64), qualityChecks: [] }] };
        return route.fulfill({ json: { ok: true, task: run, url: run.outputs[0].mediaUrl } });
      }
      if (path.endsWith('/tasks/image-1/quality/preflight')) {
        run.version++; run.outputs[0].qualityChecks = SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'pass', severity: 'hard', note: 'isolated test' }));
        return route.fulfill({ json: { ok: true, task: run } });
      }
      unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 500, json: { error: 'unexpected test request' } });
    });
    await page.goto(`${origin}/image-replication-test${mode === 'home' ? '?home=1' : mobile ? '?chat=1' : ''}`);
    if (mode === 'home') {
      await page.getByRole('button', { name: '点击开始创作', exact: true }).click();
      const cards = page.locator('#creator-home-prompt-cards > button');
      assert.equal(await cards.count(), 5); assert.match(await cards.nth(4).textContent(), /图文爆款复刻/);
      await page.waitForFunction(() => { const element = document.querySelector('.creator-home__canvas-stage'); return element && element.getBoundingClientRect().height > 100 && Number(getComputedStyle(element).opacity) > .99; });
      if (evidenceDir) { await mkdir(evidenceDir, { recursive: true }); await page.screenshot({ path: `${evidenceDir}/five-creation-scenarios.png`, fullPage: true }); }
      await cards.nth(4).click();
      await page.getByRole('combobox', { name: '参考图', exact: true }).click();
      await page.getByText('对话参考图', { exact: true }).click();
    }
    await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    await page.getByRole('combobox', { name: '企业产品', exact: true }).click();
    await page.getByText('企业测试产品', { exact: true }).click();
    await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    await page.getByRole('textbox', { name: '核心卖点', exact: true }).fill('突出已核验的产品特点');
    await page.getByRole('textbox', { name: '目标受众', exact: true }).fill('海外品牌采购');
    await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    await page.getByRole('textbox', { name: '客户行动', exact: true }).fill('咨询产品详情');
    await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    assert.equal(writes.length, 0, 'answers do not create a task or call any supplier');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    if (evidenceDir) { await mkdir(evidenceDir, { recursive: true }); await page.screenshot({ path: `${evidenceDir}/${mobile ? 'mobile' : 'desktop'}-confirmation.png`, fullPage: true }); }
    await page.getByRole('button', { name: '确认并生成首版', exact: true }).click();
    await page.getByText('连接中断，请恢复本次复刻任务', { exact: true }).waitFor();
    await page.getByRole('button', { name: /恢复本次复刻任务/ }).click();
    if (mode === 'blocked') {
      await page.getByText('企业产品图片缺少可核验授权，请补充后继续', { exact: true }).waitFor();
      assert.equal(writes.filter(item => item.path.endsWith('/fb-poster') || item.path.endsWith('/render-layered')).length, 0);
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      console.log('blocked: missing product authorization stops before planning or rendering');
      await context.close(); continue;
    }
    await page.getByText('首版已完成分层渲染和确定性预检。', { exact: true }).waitFor();
    assert.equal(content.brief.formats[0], 'social_image'); assert.equal(content.brief.productId, 'product-1');
    assert.equal(content.brief.callToAction, '咨询产品详情');
    assert.equal(run.referenceSnapshot.imageUrls[0], mode !== 'inspiration' ? '/api/overseas/studio/private-assets/materials/reference.png' : '/api/overseas/videos/ref-1/image/0');
    assert.equal(writes.filter(item => item.path === '/api/overseas/social-images/tasks/image-1' && item.body.patch.referenceSnapshot).length, 1, 'lost response resumes persisted reference without resetting it');
    for (const suffix of ['/evidence/prepare', '/fb-poster', '/compile-layered', '/render-layered', '/quality/preflight']) assert.equal(writes.filter(item => item.path.endsWith(suffix)).length, 1, 'confirmation starts each production step once even in StrictMode');
    assert.equal(writes.filter(item => /\/decision$|\/delivery-packages$/.test(item.path)).length, 0, 'a candidate is never automatically accepted as final delivery');
    assert.equal(run.outputs.length, 1); assert.equal(run.publishable, false);
    const taskWrites = writes.filter(item => item.path.endsWith('/social-content/tasks'));
    assert.equal(taskWrites.length, 2); assert.equal(taskWrites[0].key, taskWrites[1].key, 'retry retains idempotency identity');
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`${mode}: fifth-card navigation, task binding, retry recovery and automatic first-draft production passed with isolated APIs`);
    await context.close();
  }
} finally { await browser?.close(); await vite?.close(); await rm(cacheDir, { recursive: true, force: true }); }
