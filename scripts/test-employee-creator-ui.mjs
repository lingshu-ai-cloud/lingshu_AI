import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright-core';

// Isolated UI fixture: never starts application servers, queues, or provider work.
const root = fileURLToPath(new URL('../', import.meta.url));
const queueItem = index => ({
  id: `queue-${index}`, contentId: `content-${index}`, title: `测试视频 ${index}`, productName: '测试产品',
  origin: 'weekly_plan', lineage: { goalId: 'goal-fixture', planId: 'plan-fixture' },
  platform: 'tiktok', accountId: 'account-fixture', accountLabel: '测试账号', status: 'planned',
  stage: '等待制作', progress: 0, reason: '', projectIds: [], steps: [], languages: ['zh'],
  plannedPublishDate: '2026-10-26', taskId: `task-${index}`, socialContentTaskId: `social-${index}`,
});
const delivery = index => ({
  id: `delivery-${index}`, taskId: `task-${index}`, taskIds: [`task-${index}`], runId: 'run-fixture',
  title: `测试成片 ${index}`, subject: '本周测试目标', kind: '内容成片', column: 'done', stage: '已交付',
  artifacts: [{ id: `video-${index}`, label: '成片', kind: 'video', url: `/fixture-media/video-${index}.mp4` }],
  steps: [], metrics: [], updatedAt: '2026-10-24T10:00:00+08:00', deliveredAt: '2026-10-24T10:00:00+08:00',
});
const overview = {
  config: null, goals: [], goal: { id: 'goal-fixture', title: '本周测试目标', objective: '展示本周自动制作进展',
    startsAt: '2026-10-24', endsAt: '2026-10-30', target: 2, unit: '条视频', contentPlatforms: ['tiktok'] },
  plan: { id: 'plan-fixture', strategy: '围绕测试产品制作内容', tasks: [] },
  run: { id: 'run-fixture', goal_id: 'goal-fixture', plan_id: 'plan-fixture', status: 'succeeded' }, tasks: [], events: [], approvals: [], handoffs: [], agents: [],
  review: null, businessSnapshot: null,
  contentQueue: { sourceStatus: 'available', sourceNote: '', items: [queueItem(1), queueItem(2)] },
  deliveries: [delivery(1), delivery(2)],
};
const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ConfigProvider}from'antd';import ContentCreationHome from '/src/components/ContentCreationHome.tsx';
import{CreationModeContext,CreationModeControlContext}from'/src/lib/creationMode.tsx';
import '/src/index.css';import '/src/styles/creator-workspace.css';
function Fixture(){const[mode,setMode]=useState('employee');return <ConfigProvider><CreationModeContext.Provider value={mode}><CreationModeControlContext.Provider value={setMode}><ContentCreationHome onNavigate={page=>window.__navigations.push(page)}/></CreationModeControlContext.Provider></CreationModeContext.Provider></ConfigProvider>}
window.__navigations=[];createRoot(document.getElementById('root')).render(<Fixture/>);`;

let vite, browser;
try {
  vite = await createServer({ root, configFile: false, plugins: [react(), tailwindcss(), {
    name: 'employee-creator-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/employee-creator-fixture')) return next();
        const compiled = await transformWithEsbuild(source, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' });
        const html = await server.transformIndexHtml('/employee-creator-fixture', `<html data-lingshu-appearance="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const executablePath = process.env.EMPLOYEE_CREATOR_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(executablePath);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const unexpected = [], errors = [];
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
    if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${url.pathname}`); return route.abort(); }
    if (url.pathname.startsWith('/fixture-media/')) return route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.alloc(0) });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/overseas/digital-employees/overview') return route.fulfill({ json: overview });
    if (url.pathname === '/api/overseas/videos') return route.fulfill({ json: { items: [] } });
    unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
  });
  const page = await context.newPage();
  const screenshotDir = path.join(process.env.TMPDIR || '/tmp', 'lingshu-employee-creator-ui');
  await mkdir(screenshotDir, { recursive: true });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/employee-creator-fixture`);
  await page.getByRole('button', { name: '查看数字员工执行现场' }).click();
  await page.getByRole('region', { name: '数字员工执行现场', exact: true }).waitFor();
  await page.getByText('测试视频 1', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__navigations), [], 'execution must stay in the content creation page');
  await page.getByRole('button', { name: '返回目标与成片' }).click();
  await page.getByRole('button', { name: '查看数字员工执行现场' }).waitFor();
  await page.screenshot({ path: path.join(screenshotDir, 'employee-desktop.png'), fullPage: true, animations: 'disabled' });

  // Finished video/feed selectors are intentionally semantic, shared on desktop and mobile.
  await page.getByRole('button', { name: '阅览成片：测试成片 1' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /下一条/ }).click();
  await dialog.getByText('测试成片 2', { exact: true }).waitFor();
  const media = dialog.getByRole('region', { name: /成片播放区/ });
  await media.focus();
  await page.keyboard.press('ArrowUp');
  await dialog.getByText('测试成片 1', { exact: true }).waitFor();
  await media.dispatchEvent('wheel', { deltaY: 100, deltaX: 0 });
  await dialog.getByText('测试成片 2', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await page.getByText('自由创作', { exact: true }).click();
  await page.getByRole('heading', { name: '你好，今天想要创作什么？' }).waitFor();
  await page.getByText('当前租户暂无可展示的爆款视频。', { exact: true }).waitFor();
  await page.getByText('数字员工', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '查看数字员工执行现场' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile page must fit viewport');
  await page.getByRole('button', { name: '查看数字员工执行现场' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile execution must fit viewport');
  await page.getByRole('button', { name: '返回目标与成片' }).click();
  await page.getByRole('button', { name: '阅览成片：测试成片 1' }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: /下一条/ }).click();
  await dialog.getByText('测试成片 2', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile feed must fit viewport');
  await page.waitForFunction(() => {
    const modal = document.querySelector('[role="dialog"]');
    return modal && getComputedStyle(modal).opacity === '1' && !modal.className.includes('zoom-appear');
  });
  await page.screenshot({ path: path.join(screenshotDir, 'employee-mobile-feed.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const screenshot = path.join(screenshotDir, 'employee-mobile.png');
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
  assert.deepEqual(unexpected, [], 'fixture may only perform explicitly mocked reads');
  assert.deepEqual(errors, [], 'browser must not report runtime errors');
  console.log(`Employee creator UI checks passed. Screenshot: ${screenshot}`);
} finally {
  await browser?.close();
  await vite?.close();
}
