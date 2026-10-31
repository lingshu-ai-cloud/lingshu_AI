import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { metricQueryError, planMetricView } from '../lib/adPlanMetricState';
import { planStatusText } from '../lib/adPlanRow';
test('operating reads keep partial failures explicit and discard late responses after switching rows', async () => {
  const cells: any[] = [], effects: any[] = [], calls: string[] = []; let cursor = 0; const oldReplies: Array<(value: any) => void> = [];
  const exports: any = {};
  const source = readFileSync(new URL('./useAdPlanOperatingData.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, AbortController, Promise, window: { addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name.includes('adPlanMetricState')) return { metricQueryError };
      if (name === '../lib/auth') return { authHeader: () => ({ Authorization: 'fixture' }), AUTH_TOKEN_CHANGED_EVENT: 'auth-change' };
      if (name === 'react') return {
        useState(v: any) { const i = cursor++; if (!(i in cells)) cells[i] = { value: v }; return [cells[i].value, (next: any) => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
        useEffect(fn: any, deps: any[]) { const i = cursor++; const c = cells[i] || (cells[i] = {}); if (!c.deps || deps.some((d, n) => d !== c.deps[n])) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      const request = async (path: string, options: any) => {
        assert.ok(!options.method, 'refresh only reads'); calls.push(path);
        if (path.includes('/old/')) return new Promise(done => { oldReplies.push(done); });
        if (path.endsWith('/meta-audit') || path.endsWith('/created-delivery')) throw Error('platform unavailable');
        return path.endsWith('/metrics') ? { spend: 9 } : { runs: [] };
      }; return { platformAdsRequest: request, readAdPlanMetrics: (id: string, signal: AbortSignal) => request('/tasks/'+encodeURIComponent(id)+'/metrics', { signal }) };
    },
  });
  const render = (id: string) => { cursor = 0; const result = exports.useAdPlanOperatingData([{ id, version: 1, channels: ['Facebook'] }], 0, false); effects.splice(0).forEach(fn => fn()); return result; };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  render('old'); render('new'); await flush();
  let result = render('new'); assert.equal(result.items.new.metrics.spend, 9); assert.ok(result.items.new.errors.includes('平台状态与预算读取失败'));
  oldReplies.forEach(done => done({ spend: 100, runs: [] })); await flush(); result = render('new');
  assert.equal(result.items.old, undefined); assert.equal(result.items.new.metrics.spend, 9); assert.equal(result.loading, false);
  assert.equal(calls.length, 7);
});

test('refresh retains last success, row retry only reads metrics, and version change clears cached results', async () => {
  const cells: any[] = [], effects: any[] = [], calls: string[] = []; let cursor = 0, phase = 'success';
  let release: (v: any) => void = () => {};
  const exports: any = {};
  const source = readFileSync(new URL('./useAdPlanOperatingData.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, AbortController, Promise, window: { addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name.includes('adPlanMetricState')) return { metricQueryError };
      if (name === '../lib/auth') return { authHeader: () => ({ Authorization: 'fixture' }), AUTH_TOKEN_CHANGED_EVENT: 'auth-change' };
      if (name === 'react') return {
        useState(v: any) { const i = cursor++; if (!(i in cells)) cells[i] = { value: v }; return [cells[i].value, (next: any) => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
        useEffect(fn: any, deps: any[]) { const i = cursor++; const c = cells[i] || (cells[i] = {}); if (!c.deps || deps.some((d, n) => d !== c.deps[n])) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      const request = async (path: string, options: any) => {
        assert.ok(!options.method); calls.push(path);
        if (!path.endsWith('/metrics')) return path.endsWith('/automation') ? { runs: [] } : { entries: [] };
        if (phase === 'failure') throw Object.assign(new Error('service timeout'), { code: 'UPSTREAM_TIMEOUT', status: 503 });
        if (phase === 'pending') return new Promise(done => { release = done; });
        return { spend: phase === 'recovery' ? 12 : 9 };
      }; return { platformAdsRequest: request, readAdPlanMetrics: (id: string, signal: AbortSignal) => request('/tasks/'+encodeURIComponent(id)+'/metrics', { signal }) };
    },
  });
  const render = (refresh = 0, version = 1) => { cursor = 0; const result = exports.useAdPlanOperatingData([{ id: 'a', version, channels: ['Facebook'] }], refresh, false); effects.splice(0).forEach(fn => fn()); return result; };
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  render(); await flush(); let result = render(); const stamp = result.items.a.metricsReceivedAt;
  phase = 'pending'; render(1); result = render(1);
  assert.equal(result.items.a.metrics.spend, 9); assert.equal(result.items.a.metricsLoading, true);
  release({ spend: 10 }); await flush(); render(1);
  phase = 'failure'; render(2); await flush(); result = render(2);
  assert.equal(result.items.a.metrics.spend, 10); assert.equal(result.items.a.metricsError.message, 'service timeout');
  assert.equal(result.items.a.metricsError.code, 'UPSTREAM_TIMEOUT'); assert.ok(result.items.a.metricsReceivedAt >= stamp);
  const count = calls.length; phase = 'recovery'; result.retryMetrics('a'); render(2); await flush(); result = render(2);
  assert.equal(calls.length, count + 1); assert.equal(calls.at(-1), '/tasks/a/metrics');
  assert.equal(result.items.a.metrics.spend, 12); assert.equal(result.items.a.metricsError, undefined);
  phase = 'pending'; result = render(2, 2); assert.equal(result.items.a, undefined);
  result = render(2, 2); assert.equal(result.items.a.metrics, undefined);
  release({ spend: 13 }); await flush();
});

test('account changes discard old plan metrics even when task ids match', async () => {
  const cells: any[] = [], effects: any[] = []; let cursor = 0, identity = 'first', changed: () => void = () => {};
  let release: (value: any) => void = () => {};
  const pending = new Promise(resolve => { release = resolve; });
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useAdPlanOperatingData.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, AbortController, Promise, window: { addEventListener(_name: string, fn: () => void) { changed = fn; }, removeEventListener() {} },
    require(name: string) {
      if (name === '../lib/auth') return { authHeader: () => ({ Authorization: identity }), AUTH_TOKEN_CHANGED_EVENT: 'auth-change' };
      if (name.includes('adPlanMetricState')) return { metricQueryError };
      if (name === 'react') return {
        useState(v: any) { const i = cursor++; if (!(i in cells)) cells[i] = { value: v }; return [cells[i].value, (next: any) => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
        useEffect(fn: any, deps: any[]) { const i = cursor++; const c = cells[i] || (cells[i] = {}); if (!c.deps || deps.some((d, n) => d !== c.deps[n])) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      return { platformAdsRequest: async () => ({ runs: [] }), readAdPlanMetrics: () => identity === 'first' ? pending : Promise.resolve({ spend: 22 }) };
    },
  });
  const render = () => { cursor = 0; const result = exports.useAdPlanOperatingData([{ id: 'same', version: 1, channels: [] }], 0, false); effects.splice(0).forEach(fn => fn()); return result; };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  render(); identity = 'second'; changed(); assert.equal(render().items.same, undefined);
  release({ spend: 999 }); await flush();
  assert.equal(render().items.same.metrics.spend, 22);
  identity = ''; changed(); assert.equal(render().items.same, undefined);
});

test('imported delivery and spend have independent read failures and recovery', async () => {
  const cells: any[] = [], effects: any[] = [], calls: string[] = []; let cursor = 0, phase = 'metrics-failed';
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useAdPlanOperatingData.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, AbortController, Promise, window: { addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name === '../lib/auth') return { authHeader: () => ({ Authorization: 'fixture' }), AUTH_TOKEN_CHANGED_EVENT: 'auth-change' };
      if (name.includes('adPlanMetricState')) return { metricQueryError };
      if (name === 'react') return {
        useState(v: any) { const i = cursor++; if (!(i in cells)) cells[i] = { value: v }; return [cells[i].value, (next: any) => { cells[i].value = typeof next === 'function' ? next(cells[i].value) : next; }]; },
        useEffect(fn: any, deps: any[]) { const i = cursor++; const c = cells[i] || (cells[i] = {}); if (!c.deps || deps.some((d, n) => d !== c.deps[n])) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      const request = async (path: string) => {
        calls.push(path);
        if (path.endsWith('/meta-audit')) throw Error('creative unavailable');
        if (path.endsWith('/created-delivery')) {
          if (phase === 'pending-delivery') throw Object.assign(new Error('存在待核对的投放操作'), { code: 'RECONCILIATION_REQUIRED' });
          return { effectiveStatus: 'ACTIVE', accountStatus: 1, adIssues: true, issueMessages: ['付款异常'] };
        }
        if (path.endsWith('/imported-delivery')) {
          if (phase === 'delivery-failed') throw Error('delivery unavailable');
          return { effectiveStatus: 'ACTIVE', accountStatus: 1, adIssues: true, issueMessages: ['付款异常'] };
        }
        if (path.endsWith('/metrics')) {
          if (phase === 'metrics-failed') throw Error('report unavailable');
          return { spend: 6.77 };
        }
        return { runs: [] };
      };
      return { platformAdsRequest: request, readAdPlanMetrics: (id: string) => request(`/tasks/${id}/metrics`) };
    },
  });
  const task = { id: 'imported', version: 1, channels: ['Facebook'], creationSource: 'platform_import', status: 'active' } as any;
  const render = (refresh: number) => { cursor = 0; const result = exports.useAdPlanOperatingData([task], refresh, false); effects.splice(0).forEach(fn => fn()); return result; };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  render(0); await flush(); let result = render(0);
  assert.equal(planStatusText(task, result.items.imported), '投放异常');
  assert.equal(result.items.imported.delivery.issueMessages[0], '付款异常');
  assert.ok(result.items.imported.metricsError);
  assert.ok(!calls.some(path => path.endsWith('/meta-audit')));
  phase = 'delivery-failed'; render(1); await flush(); result = render(1);
  assert.equal(result.items.imported.metrics.spend, 6.77);
  assert.equal(planStatusText(task, result.items.imported), '平台状态读取失败');
  phase = 'ok'; render(2); await flush(); result = render(2);
  assert.equal(planStatusText(task, result.items.imported), '投放异常');
  assert.equal(result.items.imported.metrics.spend, 6.77);
  task.creationSource = 'manual'; task.version = 2;
  render(3); await flush(); result = render(3);
  assert.equal(planStatusText(task, result.items.imported), '投放异常', 'status-only read survives a failed creative audit');
  assert.ok(calls.some(path => path.endsWith('/created-delivery')));
  phase = 'pending-delivery'; render(4); await flush(); result = render(4);
  assert.equal(planStatusText(task, result.items.imported), '执行结果待核对');
  assert.equal(result.items.imported.delivery, undefined);
  phase = 'ok'; render(5); await flush(); result = render(5);
  assert.equal(planStatusText(task, result.items.imported), '投放异常');
});

test('failure cell exposes cause and retry without expanding the plan or changing ads', () => {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AdPlanMetricsCell.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Date,
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: 'Fragment' };
      if (name === 'antd') return { Button: 'Button', Popover: 'Popover' };
      if (name.includes('adPlanMetricState')) return { planMetricView };
      throw Error(name);
    },
  });
  const nodes = (v: any): any[] => Array.isArray(v) ? v.flatMap(nodes) : v?.props ? [v, ...nodes(v.props.children)] : [];
  const text = (v: any): string => Array.isArray(v) ? v.map(text).join('') : v?.props ? text(v.props.children) : typeof v === 'string' ? v : '';
  let retries = 0, stopped = false;
  const tree = exports.default({ task: { id: 'a', name: '计划 A' }, data: { errors: [], metricsError: metricQueryError(Object.assign(new Error('upstream timeout evidence'), { code: 'TIMEOUT', status: 503 })) }, onRetry: () => retries++ });
  assert.equal(tree.props['data-state'], 'error'); tree.props.onClick({ stopPropagation() { stopped = true; } }); assert.ok(stopped);
  const popover = nodes(tree).find(n => n.type === 'Popover');
  assert.match(text(popover.props.content), /upstream timeout evidence/); assert.match(text(popover.props.content), /不代表广告执行失败/);
  const retry = nodes(tree).find(n => n.props['aria-label'] === '重试成效查询：计划 A'); retry.props.onClick(); assert.equal(retries, 1);
});

test('minute refresh cannot cancel a slow in-flight read or an unfinished budget save', () => {
  for (const [busy, saving, expected] of [[true, false, 0], [false, true, 0], [false, false, 1]] as const) {
    const exports: any = {}; let interval: () => void = () => {}; let index = 0, changes = 0;
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AdPlanManagement.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, window: { setInterval(fn: () => void) { interval = fn; }, clearInterval() {} }, document: { visibilityState: 'visible' },
      require(name: string) {
        if (name === 'react') return { useState(v: any) { return [index++ === 1 ? saving : v, () => { changes++; }]; }, useEffect(fn: any) { fn(); } };
        if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
        if (name === 'antd') return { Input: { Search: 'Search' }, Button: 'Button', Table: 'Table', Space: 'Space' };
        if (name.includes('useAdPlanOperatingData')) return { useAdPlanOperatingData: () => ({ items: {}, loading: busy }) };
        if (name.includes('AdAccountDirectory')) return { useAdAccountDirectory: () => ({ items: [] }) };
        return {};
      },
    });
    exports.default({ tasks: [], loading: false }); interval(); assert.equal(changes, expected, `busy=${busy} saving=${saving}`);
  }
});
