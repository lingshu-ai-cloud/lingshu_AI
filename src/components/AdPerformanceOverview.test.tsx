import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { metaPerformanceSummary, metaDateRange, metaAccountDate, type MetaPerformanceReport } from '../../shared/metaPerformance';
test('account history is default and payment is a read-only official handoff, not an app charge', () => {
  const overview = readFileSync(new URL('./AdPerformanceOverview.tsx', import.meta.url), 'utf8');
  const history = readFileSync(new URL('./AdAccountHistory.tsx', import.meta.url), 'utf8');
  assert.match(overview, /props.initialTaskId \? 'local' : 'history'/);
  assert.match(history, /platformAdsRequest<MetaAccountHistory>/);
  assert.match(history, /useAdAccountDirectory/);
  assert.match(history, /connection.connectionId/);
  assert.doesNotMatch(history, /1368550458638225|120248796256110142/);
  assert.match(history, /未返回的指标显示“暂无数据”/);
  assert.match(history, /不生成充值订单/);
  assert.doesNotMatch(history, /method:\s*['"]POST|mockFunnel|localStorage/);
});
test('three workspaces share grants and native creatives without manufacturing local plans or source matches', () => {
  const page = readFileSync(new URL('./PlatformAdsPage.tsx', import.meta.url), 'utf8');
  const directory = readFileSync(new URL('./AdAccountDirectory.tsx', import.meta.url), 'utf8');
  const picker = readFileSync(new URL('./AdPlanAccountPicker.tsx', import.meta.url), 'utf8');
  const assets = readFileSync(new URL('./AdPlatformCreatives.tsx', import.meta.url), 'utf8');
  assert.match(page, /AdAccountDirectoryProvider/); assert.match(page, /<AdPerformanceOverview initialTaskId=/); assert.match(page, /<AdPlanAccountPicker/);
  assert.match(directory, /'\/account-directory'/); assert.match(directory, /loadedScope === scope/);
  assert.match(picker, /use-granted-account/); assert.match(picker, /onChange\(result.connection.id\)/);
  assert.match(assets, /catalog\?\.base === base/);
  assert.match(assets, /\/ads\/\$\{row.adId\}\/creative/);
  assert.doesNotMatch(assets, /method:\s*['"]POST|120248796256110142|1368550458638225/);
  assert.match(assets, /不自动挂接任何历史素材/);
});
test('real data page sends date/scope queries and uses unified Ant and Chart.js components', () => {
  const source = readFileSync(new URL('./AdPerformanceOverview.tsx', import.meta.url), 'utf8');
  for (const pattern of [/LsMetricStrip/, /LsDataChart/, /DatePicker.RangePicker/, /<Table</, /\/performance\/\$\{id\}\?\$\{query\}/, /useUnifiedAttributionSetting|action_report_time=impression/, /空报告/, /采集时间/, /URL.revokeObjectURL/]) assert.match(source, pattern);
  assert.doesNotMatch(source, /recharts|mockFunnel|foreignTradeMockAdReport|日期筛选按 UTC|Date\.now\(\).*86400000/);
});
test('account dates and invalid/custom periods are explicit', () => {
  assert.equal(metaAccountDate('America/Los_Angeles', new Date('2026-10-22T02:00:00Z')), '2026-10-21');
  assert.equal(metaAccountDate('Asia/Shanghai', new Date('2026-10-22T02:00:00Z')), '2026-10-22');
  assert.equal(metaDateRange('2026-02-30', '2026-03-01').length, 0);
  assert.equal(metaDateRange('2026-01-01', '2026-06-01').length, 0);
  assert.equal(metaDateRange('2026-10-16', '2026-10-22').length, 7);
});
test('directory pages and invalid report ranges cannot display another scope as current', () => {
  const data = readFileSync(new URL('./AdPerformanceOverview.tsx', import.meta.url), 'utf8');
  const library = readFileSync(new URL('./AdCreativeLibrary.tsx', import.meta.url), 'utf8');
  for (const source of [data, library]) {
    assert.match(source, /catalog\?\.page === page(?: && catalog\.requestTaskId === initialTaskId)? \? catalog : null/);
    assert.match(source, /total=\{catalog.totalItems\}/);
    assert.match(source, /当前页目录未返回，可刷新或返回其他页/);
  }
  assert.match(data, /valid && scope === reportScope/);
  assert.match(data, /setTaskFilter\(v\); setAccount\(''\)/);
  assert.match(data, /不改变上方小计/);
  assert.match(library, /采用广告组归因设置/);
  assert.match(library, /r\.attributionSpec/);
  for (const source of [data, library]) { assert.match(source, /metaAccountDate/); assert.match(source, /addEventListener\('focus', check\)/); assert.match(source, /clearInterval/); }
});
test('summary de-duplicates resources and refuses missing, mixed account/currency/timezone/window data', () => {
  const r = { accountId: '1', resourceId: '101', level: 'campaign', currency: 'CNY', reportTimezone: 'Asia/Shanghai', window: { since: '2026-10-16', until: '2026-10-22' }, totals: { spend: 12, impressions: 100, clicks: 10, linkClicks: 5 } } as MetaPerformanceReport;
  assert.equal(metaPerformanceSummary([r, r], 1).spend, 12);
  assert.equal(metaPerformanceSummary([r], 2).spend, null);
  assert.equal(metaPerformanceSummary([{ ...r, totals: null }], 1).spend, null);
  assert.equal(metaPerformanceSummary([{ ...r, totals: { ...r.totals!, spend: 0 } }], 1).spend, 0);
  for (const patch of [{ currency: 'USD' }, { accountId: '2' }, { reportTimezone: 'UTC' }, { window: { since: '2026-10-01', until: '2026-10-22' } }]) assert.equal(metaPerformanceSummary([r, { ...r, resourceId: '102', ...patch }], 2).spend, null);
});

test('material table summaries preserve incomplete reports and separate incompatible reporting groups', async () => {
  const vm = await import('node:vm'), ts = await import('typescript');
  const { materialReportGroups } = await import('../../shared/adMaterialDirectory');
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AdMaterialPerformance.tsx', import.meta.url), 'utf8') + '\nexports.summary = MaterialSummary;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (name === '../../shared/adMaterialDirectory') return { materialReportGroups };
      return {};
    },
  });
  const text = (v: any): string => Array.isArray(v) ? v.map(text).join('') : v?.props ? text(v.props.children) : v == null ? '' : String(v);
  const item = { ads: [{ executionId: 'one', market: '美国' }, { executionId: 'two', market: '美国' }] };
  const report = { accountId: 'account', adId: '1', currency: 'CNY', reportTimezone: 'UTC', window: { since: '2026-10-01', until: '2026-10-07' }, attributionSpec: [], metricLabel: '消息会话', spend: 10, results: 2, reportedAt: '2026-10-08' };
  const summary = (reports: any, errors = {}) => text(exports.summary({ item, reports, errors }));
  assert.match(summary({ one: report }), /报告已返回 1\/2/);
  assert.match(summary({ one: report }, { two: 'failure' }), /部分报告读取失败/);
  assert.match(summary({ one: report, two: { ...report, adId: '2', currency: 'USD' } }), /2 组投放结果/);
  assert.match(summary({ one: report, two: { ...report, adId: '2', metricLabel: '视频观看' } }), /2 组投放结果/);
  assert.match(summary({ one: report, two: { ...report, adId: '2' } }), /CNY 20 消耗 · 消息会话 4/);
});
