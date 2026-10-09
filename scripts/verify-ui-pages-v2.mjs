// Full-application empty-state acceptance. No real session, writes, or API traffic.
// Run against a local Vite server with UI_QA_PLAYWRIGHT pointing at a Playwright module.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.UI_QA_PLAYWRIGHT || 'playwright-core');
const origin = process.env.UI_QA_ORIGIN || 'http://127.0.0.1:5177';
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, 'Only local development servers are allowed');
const output = path.resolve(process.env.UI_QA_OUTPUT || 'artifacts/ui-design-v2/pages');
await mkdir(output, { recursive: true });
const session = {
  user: { id: 'ui-pages-qa', name: '隔离验收', email: 'ui-pages@example.test', tenantId: 'ui-pages-qa', role: 'super_admin' },
  tenant: { id: 'ui-pages-qa', name: 'UI 空态验收（隔离数据）', subscriptionStatus: 'active', subscriptionPlan: null, subscriptionExpiresAt: null },
  platformAdmin: true,
};
const overview = { config: null, goals: [], goal: null, plan: null, run: null, tasks: [], events: [], approvals: [], handoffs: [], review: null, agents: [], businessSnapshot: null };
const collection = { items: [], records: [], tasks: [], runs: [], videos: [], materials: [], accounts: [], products: [], facts: [], rules: [], projects: [], batches: [], customers: [], tenants: [], total: 0, totalItems: 0, inventoryTotalItems: 0, count: 0, totalPages: 1, page: 1 };
const discoveryScope = {
  crawlStrategyId: 'ui-qa-empty', version: '1', businessGoal: '',
  keywordSet: {
    keywordSetId: 'ui-qa-empty', version: 1, name: '', status: 'draft', createdBy: 'user', createdAt: '2026-10-09T00:00:00Z',
    scope: { productRef: '', market: '', language: '', companyRole: 'brand', audienceRole: 'consumer', verifiedCompetitors: [] },
    graph: { discoverySeeds: [], sceneClusters: [], evidenceQueries: [], edges: [] },
  },
  discoveryBrief: {
    discoveryBriefId: 'ui-qa-empty', keywordSetId: 'ui-qa-empty', keywordSetVersion: 1,
    productRef: '', market: '', audience: '', discoverySeedIds: [], trackedSceneIds: [], competitorAccounts: [],
    discoveryModes: ['momentum', 'account', 'innovation'], platforms: ['tiktok', 'instagram', 'youtube', 'facebook'],
    lookbackDays: 7, resultLimit: 30, budgetLimitCny: null, productionGap: null, createdBy: 'user',
  },
  keywords: [], benchmarkAccounts: [], platformQuotas: [], refreshIntervalMinutes: 1440, stopConditions: [],
  market: null, language: null, cultureTags: [], seasonTags: [], regionalPlatformWeights: {}, createdBy: 'user',
};
function emptyResponse(url) {
  const pathname = url.pathname;
  if (pathname.endsWith('/auth/me')) return session;
  if (pathname.endsWith('/auth/employees')) return { employees: [] };
  if (pathname.endsWith('/digital-employees/overview')) return overview;
  if (pathname.endsWith('/digital-employees/agent-usage-costs')) return { roles: { business: null, director: null, content: null, customer: null } };
  if (pathname.endsWith('/enterprise/profile')) return {};
  if (pathname.endsWith('/enterprise/product-api/status')) return { count: 0, configured: false, connected: false };
  if (pathname.endsWith('/enterprise/faq/packs')) return { packs: [], recommendedIndustry: 'general' };
  if (pathname.endsWith('/social-discovery/scope')) return { scope: discoveryScope, persisted: false, needsConfirmation: true };
  if (pathname.endsWith('/social-discovery/summary')) return { summary: {
    keywordSetId: 'ui-qa-empty', keywordSetVersion: 1, runCount: 0, latestRunAt: null, nextRunAt: null,
    totals: { requested: 0, fetched: 0, deduplicated: 0, accepted: 0, momentumCandidates: 0, failed: 0, costCny: null, effectiveRate: null },
    byMode: {}, coverageGaps: ['momentum', 'account', 'innovation'], totalKnownCostCny: 0, costComplete: true, accountDecisionsPendingBusinessConfirmation: 0,
  } };
  if (pathname.endsWith('/platform-integrations/oauth-config')) return {
    callbacks: { youtube: '', instagram: '', facebook: '', messenger: '', tiktok: '' },
    metaWebhookUrl: '', apps: { google: null, meta: null, tiktok: null },
  };
  if (pathname.endsWith('/admin/oauth-config')) return {
    admin: session.user.id, updatedAt: null, disabledPlatforms: [],
    callbacks: { youtube: '', instagram: '', facebook: '', tiktok: '' },
    values: { youtubeOAuthClientId: '', youtubeOAuthClientSecret: '', metaSocialAppId: '', metaSocialAppSecret: '', tiktokClientKey: '', tiktokClientSecret: '', advancedManualConnectEnabled: false },
    secretSet: { youtubeOAuthClientSecret: false, metaSocialAppSecret: false, tiktokClientSecret: false },
  };
  if (/\/(scheduler|plugins)$/.test(pathname) || /\/studio\/(shooting-tasks|projects|variation-batches)$/.test(pathname)) return [];
  if (pathname.endsWith('/health')) return { ok: true, featureLocks: { seedanceVideo: true } };
  return collection;
}
const pages = [
  ['business', '智能经营', 'digitalEmployees'],
  ['inspiration', '灵感中心', 'socialInspiration'],
  ['creation', '内容制作', 'smartAssets'],
  ['publishing', '发布与渠道', 'traffic'],
  ['conversations', '会话与客户', 'conversion'],
  ['orders', '订单管理', 'orders'],
  ['enterprise', '企业知识库', 'enterprise'],
  ['organization', '组织权限', 'organizationPermissions'],
  ['memory', 'Agent 记忆', 'agentMemory'],
  ['scheduled', '定时任务', 'scheduled'],
  ['scripts', '脚本库', 'scriptLibrary'],
  ['integrations', '集成中心', 'plugins'],
  ['monitoring', '账号内容监控', 'socialMonitoring'],
  ['admin', '账号总控', 'admin'],
  ['delivery', '客户运维', 'adminDelivery'],
];
const selectedPages = process.env.UI_QA_PAGES ? pages.filter(item => process.env.UI_QA_PAGES.split(',').includes(item[0])) : pages;
const widths = process.env.UI_QA_WIDTHS ? process.env.UI_QA_WIDTHS.split(',').map(Number) : [1440, 390];
const browser = await chromium.launch({ headless: true, channel: process.env.UI_QA_BROWSER_CHANNEL || 'chrome' });
const results = [];
try {
  for (const width of widths) for (const [id, label, target, view] of selectedPages) {
    const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [], consoleErrors = [], requests = new Set(), mockedWrites = [], blockedExternal = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await context.addInitScript(() => {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('overseas_token', 'isolated-ui-fixture-not-a-real-token');
      localStorage.setItem('ow_page_scope', 'ui-pages-qa:ui-pages-qa');
      localStorage.setItem('lingshu:sidebar-collapsed', 'false');
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) {
        requests.add(`${request.method()} ${url.pathname}`);
        if (!['GET', 'HEAD'].includes(request.method())) {
          mockedWrites.push(`${request.method()} ${url.pathname}`);
          return route.fulfill({ status: 409, json: { error: 'isolated_ui_qa_write_blocked', message: '隔离 UI 验收不执行写入' } });
        }
        if (url.pathname.includes('/starter-198/') && !url.pathname.includes('/internal/work-packages')) return route.fulfill({ status: 403, json: { code: 'profile_not_enabled', error: 'profile_not_enabled' } });
        return route.fulfill({ status: 200, json: emptyResponse(url) });
      }
      if (url.origin !== origin && !['data:', 'blob:'].includes(url.protocol)) {
        blockedExternal.push(url.origin); return route.abort();
      }
      return route.continue();
    });
    const query = new URLSearchParams({ page: target, ...(view ? { view } : {}) });
    let navigationError;
    try {
      await page.goto(`${origin}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.locator('.app-shell').waitFor({ timeout: 25_000 });
      await page.waitForTimeout(1800);
      await page.waitForFunction(() => (document.querySelector('.app-shell main')?.textContent?.trim().length ?? 0) > 20, undefined, { timeout: 15_000 });
      // The local application intentionally seeds demo conversations and opens a
      // daily briefing. Dismiss only that local drawer to inspect the workspace.
      if (id === 'conversations') {
        const later = page.getByRole('button', { name: /^稍\s*后$/ });
        const briefingVisible = await later.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
        if (briefingVisible) {
          await page.screenshot({ path: path.join(output, `${id}-briefing-${width}.png`), fullPage: true });
          await later.first().click();
          await later.first().waitFor({ state: 'hidden', timeout: 5000 });
        }
      }
    } catch (error) { navigationError = error.message; }
    const body = await page.locator('body').innerText().catch(() => '');
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll('main, [data-app-content-stack]')].map(element => ({ tag: element.tagName, width: element.clientWidth, scroll: element.scrollWidth })) })).catch(() => null);
    const layoutIntegrity = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const rows = [...document.querySelectorAll('[data-layout-check="customer-row"]')].filter(visible);
      const rowRects = rows.map((element, index) => ({ index, ...element.getBoundingClientRect().toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      const rowOverlaps = rowRects.slice(0, -1).flatMap((rect, index) => {
        const next = rowRects[index + 1];
        return rect.bottom > next.top + .5 ? [{ first: rect.index, second: next.index, overlap: rect.bottom - next.top }] : [];
      });
      const rowOverflow = rowRects.filter(rect => rect.scrollWidth > rect.clientWidth + 1).map(rect => rect.index);
      const tabs = document.querySelector('.ls-customer-view-tabs .ant-tabs-nav-wrap');
      const sidebar = document.querySelector('.app-sidebar');
      return {
        rowCount: rows.length,
        rowOverlaps,
        rowOverflow,
        tabsOverflow: tabs ? tabs.scrollWidth > tabs.clientWidth + 1 : false,
        sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0,
      };
    }).catch(() => null);
    const mainText = await page.locator('.app-shell main').first().innerText().catch(() => '');
    const boundaryFailure = /页面加载异常|显示失败|应用暂时无法启动|当前模块暂时无法显示|Cannot read properties|is not a function/.test(body);
    const reactErrors = consoleErrors.filter(message => /The above error occurred|ErrorBoundary|IntegrationTabBoundary|Maximum update depth|Rendered fewer hooks|Rendered more hooks/.test(message));
    // Page shells must fit; an explicit table/calendar scroll container may
    // scroll internally without expanding its containing main/content stack.
    const internalOverflow = dimensions?.overflowing.filter(element => element.scroll > element.width + 2) ?? [];
    const demoContentDetected = /本地模拟|本地演示|模拟客户/.test(body);
    const currentPage = await page.evaluate(() => localStorage.getItem('ow_page')).catch(() => null);
    const layoutPassed = !layoutIntegrity || (!layoutIntegrity.rowOverlaps.length && !layoutIntegrity.rowOverflow.length && !layoutIntegrity.tabsOverflow && layoutIntegrity.sidebarWidth <= 208);
    const passed = !navigationError && !errors.length && !reactErrors.length && !boundaryFailure && mainText.length > 20 && currentPage === target && dimensions?.document <= width + 1 && !internalOverflow.length && layoutPassed;
    const screenshot = path.join(output, `${id}-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const result = { id, label, width, passed, currentPage, navigationError, boundaryFailure, errors, reactErrors, consoleErrors: consoleErrors.slice(0, 12), dimensions, internalOverflow, layoutIntegrity, layoutPassed, demoContentDetected, requests: [...requests], mockedWrites, blockedExternal: [...new Set(blockedExternal)], screenshot, visibleText: body.slice(-8000) };
    results.push(result);
    console.log(JSON.stringify({ id, width, passed, currentPage, errors, boundaryFailure, dimensions, layoutIntegrity, navigationError }));
    await context.close();
  }
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: results.filter(item => item.passed).length, total: results.length, report: path.join(output, 'report.json') }));
process.exitCode = results.every(item => item.passed) ? 0 : 1;
