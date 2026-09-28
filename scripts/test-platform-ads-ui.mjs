import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Isolated browser fixtures. No application backend or real advertising API is used.
const base = {
  id: 'fixture', name: '投放测试计划', video: 'fixture-video', market: 'US', budget: 100,
  currency: 'USD', channels: ['TikTok'], goal: '提升有效视频观看', managementMode: 'manual',
  creationSource: 'manual', status: 'draft', version: 1, createdAt: '', updatedAt: '',
  configuration: { startsAt: '', endsAt: '', dailyBudget: 10, audience: '', placements: '' },
};
const authorization = { accountIds: ['expired-meta', 'active-meta'], allowedActions: ['pause'], maxDailyBudget: 10, maxTotalBudget: 100, maxAdjustmentPercent: 10, expiresAt: '2099-01-01T00:00:00Z' };
const fixtures = {
  manualMeta: { ...base, channels: ['Facebook'], goal: '提升网站访问' },
  tiktok: base,
  legacy: { ...base, managementMode: 'managed', authorization },
  meta: { ...base, channels: ['Facebook'], goal: '提升网站访问', managementMode: 'managed', authorization },
  video: { ...base, channels: ['Facebook'] },
};
const source = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{AdTaskControls}from'/src/components/PlatformAdsOperations.tsx';import PlatformAdsPage from '/src/components/PlatformAdsPage.tsx';
const query=new URLSearchParams(location.search);const fixtures=${JSON.stringify(fixtures)};
function Fixture(){const[task,setTask]=useState(fixtures[query.get('case')]||fixtures.tiktok);return query.has('page')?<PlatformAdsPage page={query.get('page')} onNavigate={()=>{}}/>:<AdTaskControls task={task} onUpdate={setTask}/>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
let vite, browser;
try {
  vite = await createServer({ configFile: false, plugins: [react(), {
    name: 'platform-ads-ui-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/platform-ads-test')) return next();
        const compiled = await transformWithEsbuild(source, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' });
        const html = await server.transformIndexHtml('/platform-ads-test', `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body><div id="root"></div><script type="module">${compiled.code}</script></body></html>`);
        res.setHeader('Content-Type', 'text/html'); res.end(html);
      });
    },
  }], server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const executablePath = process.env.PLATFORM_ADS_TEST_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await access(executablePath);
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const errors = [], unexpected = [], writes = [], creativeWrites = [], preflightWrites = [];
  let activeTask = structuredClone(base), bindings = [], metricSyncs = 0;
  const creativeSource = { sourceTaskId: 'source-task', artifactId: 'artifact-video', name: 'P1测试成片.mp4', mimeType: 'video/mp4', size: 1024, sha256: 'a'.repeat(64) };
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.replace('/api/overseas/platform-ads', '');
    const respond = json => route.fulfill({ json });
    if (request.method() === 'POST' && path === '/tasks/fixture/management') {
      const body = request.postDataJSON(); writes.push(body);
      activeTask = { ...activeTask, managementMode: body.managementMode, authorization: body.authorization || null, version: activeTask.version + 1 };
      return respond({ task: activeTask });
    }
    if (request.method() === 'POST' && path === '/tasks/fixture/creatives') {
      const body = request.postDataJSON(); creativeWrites.push({ action: 'bind', body });
      assert.equal(body.expectedVersion, activeTask.version);
      assert.deepEqual({ sourceTaskId: body.sourceTaskId, artifactId: body.artifactId, connectionId: body.connectionId }, { sourceTaskId: 'source-task', artifactId: 'artifact-video', connectionId: 'active-meta' });
      activeTask = { ...activeTask, version: activeTask.version + 1 };
      bindings = [{ ...creativeSource, id: 'bound-creative', taskId: 'fixture', taskVersion: activeTask.version, connectionId: 'active-meta', provider: 'meta', status: 'pending', platformVideoId: '', createdAt: '', updatedAt: '' }];
      return respond({ creative: bindings[0], taskVersion: activeTask.version });
    }
    if (request.method() === 'POST' && /^\/tasks\/fixture\/creatives\/bound-creative\/(upload|reconcile)$/.test(path)) {
      const action = path.split('/').at(-1), body = request.postDataJSON();
      creativeWrites.push({ action, body }); assert.equal(body.expectedVersion, activeTask.version);
      assert.ok(body.requestId);
      bindings = [{ ...bindings[0], status: action === 'upload' ? 'processing' : 'ready', platformVideoId: '999111' }];
      return respond(bindings[0]);
    }
    if (request.method() === 'POST' && path === '/tasks/fixture/preflight') {
      const body = request.postDataJSON(); preflightWrites.push(body);
      assert.equal(body.creativeId, 'bound-creative'); assert.equal(body.expectedVersion, 2);
      assert.equal(body.connectionId, 'active-meta'); assert.equal(body.meta.videoId, '999111');
      assert.equal(body.action, 'create');
      return respond({ taskId: 'fixture', taskVersion: 2, connectionId: 'active-meta', action: 'create', scope: 'local', checkedAt: new Date().toISOString(), canSubmit: true, checks: [{ id: 'local_only', label: '预检范围', status: 'warning', message: '仅本地模拟检查，未连接广告平台。' }] });
    }
    if (path === '/tasks/fixture/metrics/sync' && request.method() === 'POST') { metricSyncs++; return respond({ savedRows: 1 }); }
    if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.abort(); }
    if (path === '/automation/status') return respond({ worker: { state: new URL(page.url()).searchParams.get('worker') || 'completed', configuredEnabled: true, explanation: '测试租户检查证据', lastStartedAt: new Date().toISOString(), lastCompletedAt: new Date().toISOString(), lastFailedAt: null, nextCheckAt: new Date(Date.now() + 300000).toISOString() } });
    if (path === '/tasks/fixture/metrics/history') return respond({ items: metricSyncs ? [{ id: 'day1', date: new Date().toISOString().slice(0, 10), provider: 'meta', accountId: 'account-fixture', campaignId: 'campaign-fixture', currency: 'USD', metricDefinition: 'meta:inline_link_clicks', metricLabel: '链接点击', reportTimezone: '', reportedAt: new Date().toISOString(), values: { spend: 12, impressions: 100, clicks: 5, results: null } }] : [], source: 'local_snapshots', dataNote: '本地测试快照', window: { since: url.searchParams.get('since'), until: url.searchParams.get('until') } });
    if (path === '/connections') return respond({ items: [
      { id: 'expired-meta', provider: 'meta', accountId: '1', name: '已失效账户', currency: 'USD', status: 'expired' },
      { id: 'active-meta', provider: 'meta', accountId: '2', name: '正常账户', currency: 'USD', status: 'connected' },
    ], capabilities: [], releasePolicy: new URL(page.url()).searchParams.get('case') === 'manualMeta' ? { mode: 'paused_only', allowedActions: ['create', 'pause'], executionProviders: ['meta'], reason: '仅浏览器模拟上传与预检' } : { mode: 'disabled', allowedActions: [], executionProviders: [], reason: '测试只读条件' } });
    if (path === '/creative-sources') return respond({ items: [creativeSource], page: 1, perPage: 20, totalPages: 1, totalItems: 1 });
    if (path === '/tasks/fixture/creatives') return respond({ items: bindings });
    if (path === '/tasks/fixture') return respond({ task: activeTask });
    if (path === '/tasks') return respond({ items: [base] });
    if (path === '/tasks/fixture/automation') return respond({ rules: [{ id: 'old-rule', resourceId: '123', enabled: false }], runs: [{ id: 'decision-run', status: 'FAILED', reason: '拟议调整测试', createdAt: new Date().toISOString(), decision: { schemaVersion: 1, planVersion: 2, ruleVersion: 'rule-version-fixture', action: 'adjust_budget', reason: '拟议调整测试', budgetBefore: 10, budgetAfter: 11, executionId: 'missing-execution', evidence: { availability: 'available', period: 'last_7d', fetchedAt: new Date().toISOString(), clicks: 20, spend: 4, currency: 'USD' } } }, { id: 'old-run', status: 'SKIPPED', reason: '历史观察证据', createdAt: '2026-09-01T00:00:00Z' }] });
    if (/^\/tasks\/fixture\/(executions|approvals|launch)$/.test(path)) return respond({ items: [] });
    if (path === '/tasks/fixture/metrics') return respond({ source: 'provider_snapshot', stale: true, currency: 'USD', spend: 3, clicks: 2, impressions: 30, reportedAt: '2026-09-01T00:00:00Z', daily: [{ date: new Date().toISOString().slice(0, 10), spend: 3, clicks: 2, impressions: 30 }] });
    unexpected.push(`${request.method()} ${path}`); return route.abort();
  });
  const open = query => {
    activeTask = structuredClone(fixtures[new URLSearchParams(query).get('case')] || base); bindings = [];
    return page.goto(`${origin}/platform-ads-test?${query}`);
  };
  await open('case=tiktok');
  const modes = page.getByLabel('后续管理方式');
  await modes.waitFor();
  assert.equal(await modes.locator('option[value="approval"]').evaluate(option => option.disabled), true);
  assert.equal(await modes.locator('option[value="managed"]').evaluate(option => option.disabled), true);
  assert.equal(await modes.locator('option[value="manual"]').evaluate(option => option.disabled), false);
  assert.equal(await modes.locator('option[value="suggest"]').evaluate(option => option.disabled), false);

  await open('case=legacy');
  const takeover = page.getByRole('button', { name: '人工接管并撤销托管授权' });
  await takeover.waitFor(); assert.equal(await takeover.isEnabled(), true);
  await takeover.click();
  await page.getByText('已交回人工管理。既有平台广告是否暂停，请查看实际平台状态。', { exact: true }).waitFor();
  assert.deepEqual(writes, [{ expectedVersion: 1, managementMode: 'manual' }]);

  await open('case=meta');
  const expired = page.getByRole('checkbox', { name: /已失效账户/ });
  await expired.waitFor(); assert.equal(await expired.isChecked(), true); assert.equal(await expired.isEnabled(), true);
  await expired.uncheck(); assert.equal(await expired.isDisabled(), true);
  await page.getByRole('button', { name: '保存管理方式', exact: true }).click();
  await page.getByText('管理方式与授权边界已保存。实际自动执行能力以服务状态为准。', { exact: true }).waitFor();
  assert.deepEqual(writes[1].authorization.accountIds, ['active-meta']);
  assert.equal(writes[1].managementMode, 'managed');

  await open('case=video');
  await page.getByText(/历史观察证据/).waitFor();
  assert.equal(await page.getByLabel('目标点击成本（USD）').count(), 0);
  assert.equal(await page.getByText('系列 123 · 规则停用', { exact: true }).count(), 1);

  await open('case=manualMeta');
  await page.getByRole('button', { name: '选择 / 管理成片', exact: true }).click();
  const sourceSelect = page.locator('.ads-creative-panel select').nth(0);
  await sourceSelect.locator('option').filter({ hasText: 'P1测试成片.mp4' }).waitFor({ state: 'attached' });
  await sourceSelect.selectOption(JSON.stringify(['source-task', 'artifact-video']));
  await page.locator('.ads-creative-panel select').nth(1).selectOption('active-meta');
  await page.getByRole('button', { name: '绑定此成片版本', exact: true }).click();
  await page.getByRole('heading', { name: 'P1测试成片.mp4 · 待上传 / 待验证', exact: true }).waitFor();
  assert.equal(activeTask.version, 2, 'binding updates the fixture task returned by GET');
  await page.getByRole('button', { name: '上传到 Meta', exact: true }).click();
  await page.getByRole('heading', { name: 'P1测试成片.mp4 · 平台处理中', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '上传到 Meta', exact: true }).isDisabled(), true, 'processing cannot upload again');
  assert.equal(await page.getByRole('button', { name: '用于本次人工创建', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '核对视频状态', exact: true }).click();
  await page.getByRole('heading', { name: 'P1测试成片.mp4 · 平台视频已就绪', exact: true }).waitFor();
  await page.getByRole('button', { name: '用于本次人工创建', exact: true }).click();
  const videoId = page.getByLabel('Meta 已上传视频 ID', { exact: true });
  assert.equal(await videoId.inputValue(), '999111');
  assert.equal(await videoId.evaluate(input => input.readOnly), true);
  assert.equal(await page.getByLabel('广告账户', { exact: true }).inputValue(), 'active-meta');
  await page.getByLabel('Facebook 主页 ID', { exact: true }).fill('123');
  await page.getByLabel('公开视频缩略图 HTTPS 地址', { exact: true }).fill('https://example.com/thumb.jpg');
  await page.getByLabel('落地页 HTTPS 地址', { exact: true }).fill('https://example.com/landing');
  await page.getByLabel('广告文案', { exact: true }).fill('本地模拟素材');
  await page.getByRole('button', { name: '检查当前配置', exact: true }).click();
  await page.getByText('本地检查通过，平台条件仍待核验', { exact: true }).waitFor();
  assert.deepEqual(creativeWrites.map(item => item.action), ['bind', 'upload', 'reconcile']);
  assert.equal(preflightWrites.length, 1);
  await page.getByLabel('Facebook 主页 ID', { exact: true }).fill('124');
  await page.getByText('配置已变化，请重新检查。', { exact: true }).waitFor();

  for (const [name, label] of [['adsOverview', '投放总览'], ['adsPlans', '投放计划'], ['adsManaged', 'AI 托管']]) {
    await open(`page=${name}`);
    await page.locator('.ads-page-purpose > strong').filter({ hasText: label }).waitFor();
    if (name === 'adsOverview') {
      await page.getByText('含历史快照 · 非实时', { exact: true }).waitFor();
      await page.getByText('所选周期暂无已保存指标。', { exact: true }).waitFor();
      assert.equal(metricSyncs, 0, 'history reads must not sync automatically');
      await page.getByRole('button', { name: '同步并保存近 7 天', exact: true }).click();
      await page.getByText('账户时区未知', { exact: true }).waitFor();
      assert.equal(metricSyncs, 1);
      assert.equal(await page.getByRole('region', { name: '投放绩效历史表' }).locator('tbody tr').count(), 1);
      if (process.env.PLATFORM_ADS_TEST_SCREENSHOT) await page.screenshot({ path: process.env.PLATFORM_ADS_TEST_SCREENSHOT, fullPage: true });
    }
    if (name === 'adsPlans') await page.getByText('投放测试计划', { exact: true }).waitFor();
    if (name === 'adsManaged') {
      await page.getByText('历史观察证据', { exact: true }).waitFor();
      await page.getByText('最近检查已完成', { exact: true }).waitFor();
      await page.getByText('日预算：观察 → 拟议', { exact: true }).waitFor();
      await page.getByText('missing-execution（当前返回记录中未找到）', { exact: true }).waitFor();
      await page.getByText('此记录未保存结构化决策证据，无法还原预算前后、规则版本和 CPC 样本。请查看下方原始记录。', { exact: true }).waitFor();
    }
  }
  for (const [worker, label] of [['stale', '运行证据已过期'], ['unknown', '运行状态未知']]) {
    await open(`page=adsManaged&worker=${worker}`);
    await page.getByText(label, { exact: true }).waitFor();
  }
  assert.equal(writes.length, 2, 'page reads must never submit platform mutations');
  assert.deepEqual(unexpected, [], 'all API and external network requests must be explicitly mocked');
  assert.deepEqual(errors, []);
  console.log('Platform ads UI passed: disabled TikTok modes, manual takeover, expired account removal, preserved rule history three live-page fixtures, Meta creative bind/upload/reconcile/use and local preflight without execution; P2 history explicit sync, worker completed/stale/unknown and decision evidence; all APIs mocked.');
} finally { await browser?.close(); await vite?.close(); }
