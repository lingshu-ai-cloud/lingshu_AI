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
import { neutralSocialImageCopy } from '../server/socialImage/socialImageLanguageCopy.ts';

// Isolated browser contract: API writes are intercepted; no database or supplier is contacted.
const source = `import React,{useState,useEffect,StrictMode} from 'react';import{createRoot}from'react-dom/client';import LingshuProvider from '/src/components/ui/LingshuProvider.tsx';import ContentCreationHome from '/src/components/ContentCreationHome.tsx';import AssistantCreationPortalCard from '/src/components/assistant/AssistantCreationPortalCard.tsx';import{useAssistantStore}from'/src/stores/assistantStore.ts';
import SocialContentPlanningPage from '/src/components/socialContent/SocialContentPlanningPage.tsx';import ImageCreationTaskExecution from '/src/components/socialContent/ImageCreationTaskExecution.tsx';import '/src/index.css';import '/src/styles/design-system.css';import '/src/styles/creator-workspace.css';
const chat=new URLSearchParams(location.search).has('chat');
const request={requestId:1,themeId:'product_value',mode:'instant',creationPath:'viral_replication',prefill:{platforms:['instagram']},sourceContext:{originLabel:chat?'来自灵小枢对话':'来自灵感中心',referenceContentType:'image',referenceTitle:'参考图文',...(chat?{referenceSourceRecordId:'reference-1'}:{referenceMediaUrl:'/api/overseas/videos/ref-1/image/0',referenceCaption:'原始参考配文'})}};
function Fixture(){const[epoch,setEpoch]=useState(0);const messages=useAssistantStore(state=>state.threads.business.messages);const query=new URLSearchParams(location.search);const[selected,setSelected]=useState(query.has('imageTaskId')?null:query.has('home')?null:request);const[target,setTarget]=useState(query.has('imageTaskId')?'content-1':null);useEffect(()=>{const handler=e=>{if(e.detail.imageTaskId){setTarget(e.detail.socialContentTaskId);setSelected(null)}else if(e.detail.contentCreationRequest){setSelected(e.detail.contentCreationRequest);setTarget(null)}};window.addEventListener('lingshu:navigate',handler);return()=>window.removeEventListener('lingshu:navigate',handler)},[]);return target?<ImageCreationTaskExecution contentTaskId={target}/>:selected?<SocialContentPlanningPage initialCreateRequest={selected} onNavigate={()=>{}} onNavigateWithTask={()=>{}} onLaunchStudio={()=>{}}/>:<><ContentCreationHome sessionScope="image-ui-test"/><button onClick={()=>setEpoch(value=>value+1)}>重新打开当前对话</button>{messages.map((msg,index)=>msg.creationPortal?<AssistantCreationPortalCard key={msg.creationPortal.id+epoch} portal={msg.creationPortal}/>:null)}</>;}
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
  for (const mode of ['inspiration', 'chat', 'home', 'blocked', 'missing_facts', 'empty_sources']) {
    const mobile = mode === 'chat';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(dark => {
      localStorage.setItem('overseas_token', 'isolated-test-session');
      localStorage.setItem('lingshu:appearance', dark ? 'dark' : 'light');
    }, mobile);
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [], unexpected = [], writes = [];
    let execution; let content, run, failedOnce = false, brokenImageReads = 0, materialReads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname;
      if (path === '/api/overseas/digital-employees/overview') return route.fulfill({ json: { config: {} } });
      if (path === '/api/overseas/videos/reference-extra-1/image/0') { brokenImageReads++; return route.fulfill({ status: 404 }); }
      if (request.method() === 'GET' && /\/image\/0$|\/reference\.png$/.test(path)) return route.fulfill({ body: png, contentType: 'image/png' });
      if (path === '/api/overseas/enterprise/profile') return route.fulfill({ json: { profile: { products: { items: [{ id: 'product-1', name: '企业测试产品', highlights: mode === 'missing_facts' ? '' : '已核验的产品特点' }] } } } });
      if (path === '/api/overseas/videos') return route.fulfill({ json: { items: mode === 'empty_sources' ? [] : Array.from({ length: 12 }, (_, index) => { const id = index ? 'reference-extra-' + index : 'reference-1'; return { id, title: index ? '备选参考图 ' + index : '对话参考图', platform: 'instagram', sourceUrl: 'https://www.instagram.com/p/' + id + '/', crawledAt: '2026-10-26T00:00:00Z', aiAnalysis: JSON.stringify({ contentFormat: 'image', source: 'apify-image', caption: '真实原帖配文', imageUrls: ['/api/overseas/videos/' + id + '/image/0'] }) }; }) } });
      if (path === '/api/overseas/studio/materials') { materialReads++; return route.fulfill({ json: { items: Array.from({ length: 12 }, (_, index) => ({ id: index ? 'reference-extra-' + index : 'reference-1', type: 'image', name: index ? '备选参考图 ' + index : '对话参考图', scope: 'own', url: '/api/overseas/studio/private-assets/materials/' + (index === 1 ? 'broken-reference.png' : 'reference.png') })), status: 'ready' } }); }
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
          id: 'image-1', schemaVersion: 'social-image-creation.v3', deliverySpec: { platform: 'instagram', aspectRatio: '4:5', language: content.brief.languages[0], format: 'jpg', outputCount: 1 },
          productionRuntime: { binding: { contentTaskId: 'content-1', contentTaskVersion: 'v1' }, currentNode: 'business_context', nodes: [], events: [], nodeOutputs: [] } };
        return route.fulfill({ json: { ok: true, task: run, resumed: false } });
      }
      if(path==='/api/overseas/social-images/tasks/image-1/execution') {
        execution ||= {jobId:'queue-image-1',status:mode==='blocked'?'blocked':'queued',attempt:mode==='blocked'?1:0,lastError:mode==='blocked'?'social_image_required_asset_rights_unverified':null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        return route.fulfill({status:202,json:{ok:true,task:run,execution}});
      }
      if(path==='/api/overseas/social-images/content-tasks/content-1/execution')return route.fulfill({json:{ok:true,task:run,execution}});
      if (path === '/api/overseas/social-images/tasks/image-1' && request.method() === 'GET') return route.fulfill({ json: { ok: true, task: run } });
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
        const localized = neutralSocialImageCopy(content.brief.languages[0]);
        run = { ...run, version: run.version + 1, status: 'planned', imageTextContract: { ...run.imageTextContract, headline: localized.headline, caption: localized.caption },
          productionRuntime: { ...run.productionRuntime, nodes: [{ nodeId: 'director_brief', status: 'completed' }] } };
        return route.fulfill({ json: { ok: true, source: 'ai', imageTask: run, poster: localized, caption: localized.caption, hashtags: ['product'], fieldsToConfirm: [] } });
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
    await page.goto(`${origin}/image-replication-test${(mode === 'home' || mode === 'empty_sources') ? '?home=1' : mobile ? '?chat=1' : ''}`);
    if (mode === 'home' || mode === 'empty_sources') {
      await page.locator('.creator-home__suggestions').getByRole('button', { name: '内容创作', exact: true }).click();
      const cards = page.locator('#creator-home-prompt-cards > button');
      assert.equal(await cards.count(), 5); assert.match(await cards.nth(4).textContent(), /借鉴一个爆款图文/);
      await page.waitForFunction(() => { const element = document.querySelector('.creator-home__canvas-stage'); return element && element.getBoundingClientRect().height > 100 && Number(getComputedStyle(element).opacity) > .99; });
      if (evidenceDir) { await mkdir(evidenceDir, { recursive: true }); await page.screenshot({ path: `${evidenceDir}/five-creation-scenarios.png`, fullPage: true }); }
      await cards.nth(4).click();
      if (mode === 'empty_sources') {
        await page.getByText('暂无已采集的对标图文，请先在灵感中心采集，或上传参考图', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: /^选择参考图片：/ }).count(), 0);
        assert.equal(writes.length, 0); assert.equal(materialReads, 0, 'generated asset library is never a benchmark fallback'); assert.deepEqual(unexpected, []);
        await context.close(); console.log('empty_sources: no generated material fallback, no task or supplier writes'); continue;
      }
      const confirmReference = page.getByRole('button', { name: '选择该参考图', exact: true });
      assert.equal(await confirmReference.isDisabled(), true);
      const original = page.getByRole('button', { name: '选择参考图片：对话参考图', exact: true });
      await page.waitForFunction(() => !document.querySelector('[aria-label="选择参考图片：对话参考图"]')?.disabled);
      const unavailable = page.getByRole('button', { name: '选择参考图片：备选参考图 1', exact: true });
      await page.getByText('部分图片暂不可用，请选择其他图片或上传参考图。', { exact: true }).waitFor();
      assert.equal(await unavailable.isDisabled(), true);
      const readsBefore = brokenImageReads;
      await page.getByRole('button', { name: '重新加载图片', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="选择参考图片：备选参考图 1"]')?.disabled);
      await page.getByText('部分图片暂不可用，请选择其他图片或上传参考图。', { exact: true }).waitFor();
      assert.ok(brokenImageReads > readsBefore);
      await original.focus(); await original.press('Enter');
      await page.getByText('已选：对话参考图', { exact: true }).waitFor();
      assert.equal(await original.getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: '预览大图', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: '关闭预览', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '换一批', exact: true }).click();
      assert.equal(await confirmReference.isDisabled(), true, 'changing a batch clears the old selection');
      for (let batch = 0; batch < 12 && !await original.count(); batch++) await page.getByRole('button', { name: '换一批', exact: true }).click();
      await original.click();
      assert.equal(materialReads, 0);
      assert.equal(writes.length, 0, 'card selection and batch changes never create tasks');
      if (evidenceDir) await page.screenshot({ path: `${evidenceDir}/reference-card-selection.png`, fullPage: true });
    }
    if (mode === 'home') assert.match(page.url(), /image-replication-test\?home=1$/, 'fifth card stays in the existing conversation');
    await page.getByRole('button', { name: '选择该参考图', exact: true }).click();
    await page.getByRole('combobox', { name: '企业产品', exact: true }).click();
    await page.getByText('企业测试产品', { exact: true }).click();
    const selectedLanguage = mode === 'home' ? ['西班牙语', 'es'] : mode === 'chat' ? ['阿拉伯语', 'ar'] : ['日语', 'ja'];
    await page.getByRole('combobox', { name: '图文语言', exact: true }).click();
    await page.getByRole('combobox', { name: '图文语言', exact: true }).fill(selectedLanguage[0]);
    await page.getByText(selectedLanguage[0], { exact: true }).click();
    if (mode === 'missing_facts') {
      await page.getByRole('button', { name: '确认并继续', exact: true }).click();
      await page.getByText('请填写1～1000字的核心卖点或创作目标。', { exact: true }).waitFor();
      assert.equal(writes.length, 0);
      await page.getByRole('textbox', { name: '核心卖点', exact: true }).fill('突出已核验的产品特点');
    }
    if (mode !== 'home') {
      await page.getByText('补充创作要求（可选）', { exact: true }).click();
      await page.getByRole('textbox', { name: '核心卖点', exact: true }).fill('突出已核验的产品特点');
      await page.getByRole('textbox', { name: '目标受众', exact: true }).fill('海外品牌采购');
      await page.getByRole('textbox', { name: '客户行动', exact: true }).fill('咨询产品详情');
    }
    await page.getByRole('button', { name: '确认并继续', exact: true }).click();
    if (mode === 'home') {
      await page.getByText('已核验的产品特点', { exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: '目标受众', exact: true }).count(), 0, 'known info advances without mandatory audience form');
    }
    assert.equal(writes.length, 0, 'answers do not create a task or call any supplier');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow');
    if (evidenceDir) { await mkdir(evidenceDir, { recursive: true }); await page.screenshot({ path: `${evidenceDir}/${mobile ? 'mobile' : 'desktop'}-confirmation.png`, fullPage: true }); }
    await page.getByRole('button', { name: '确认并生成首版', exact: true }).click();
    await page.getByText('连接中断，请恢复本次复刻任务', { exact: true }).waitFor();
    await page.getByRole('button', { name: /恢复本次复刻任务/ }).click();
    if (mode === 'blocked') {
      await page.getByText('企业产品图片缺少可核验授权，请补充后继续。', { exact: true }).waitFor();
      assert.equal(writes.filter(item => item.path.endsWith('/fb-poster') || item.path.endsWith('/render-layered')).length, 0);
      assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      console.log('blocked: missing product authorization stops before planning or rendering');
      await context.close(); continue;
    }
    await page.getByText('已入队，等待调度领取', { exact: true }).first().waitFor();
    assert.equal(content.brief.languages[0], selectedLanguage[1]);
    assert.equal(run.deliverySpec.language, selectedLanguage[1]);

    assert.equal(content.brief.formats[0], 'social_image'); assert.equal(content.brief.productId, 'product-1');
    assert.equal(content.brief.callToAction, '咨询产品详情');
    assert.equal(run.referenceSnapshot.imageUrls[0], (mode === 'home' || mode === 'chat') ? '/api/overseas/videos/reference-1/image/0' : '/api/overseas/videos/ref-1/image/0');
    assert.equal(writes.filter(item => item.path === '/api/overseas/social-images/tasks/image-1' && item.body.patch.referenceSnapshot).length, 1, 'lost response resumes persisted reference without resetting it');
    assert.equal(writes.filter(item=>item.path.endsWith('/execution')).length,1,'confirmation submits the durable admission once');
    for(const suffix of ['/evidence/prepare','/fb-poster','/render-layered'])assert.equal(writes.filter(item=>item.path.endsWith(suffix)).length,0,'browser does not execute the server-owned pipeline');
    assert.equal(writes.filter(item => /\/decision$|\/delivery-packages$/.test(item.path)).length, 0, 'a candidate is never automatically accepted as final delivery');
    assert.equal(run.outputs.length, 0); assert.equal(run.publishable, false);
    const taskWrites = writes.filter(item => item.path.endsWith('/social-content/tasks'));
    assert.equal(taskWrites.length, 2); assert.equal(taskWrites[0].key, taskWrites[1].key, 'retry retains idempotency identity');
    if (mode === 'home') {
      const before = writes.length;
      await page.reload();
      await page.getByText('已入队，等待调度领取', { exact: true }).first().waitFor();
      assert.equal(writes.length, before, 'restoring saved task pointer never restarts generation');
    }
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`${mode}: fifth-card navigation, task binding, retry recovery and durable admission and read-only restoration passed with isolated APIs`);
    await context.close();
  }
} finally { await browser?.close(); await vite?.close(); await rm(cacheDir, { recursive: true, force: true }); }
