import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const nodes = (v: any): any[] => Array.isArray(v) ? v.flatMap(nodes) : v?.props ? [v, ...nodes(v.props.children)] : [];
function budgetHarness(options: { draft?: boolean; policy?: boolean; pending?: boolean; defer?: boolean; receiptFailure?: boolean; expectedVersion?: number; inline?: boolean } = {}) {
  let cursor = 0, tree: any, completed: (() => void) | null = null;
  const cells: any[] = [], effects: Array<() => void> = [], calls: Array<{ path: string; body: any }> = [];
  const task: any = { id: 'plan', version: 3, name: 'Plan', goal: '获取Meta表单线索', video: 'clip', market: 'CA', budget: 500, currency: 'CNY', channels: ['Facebook'], status: options.draft ? 'draft' : 'paused', creationSource: 'manual', managementMode: 'manual', configuration: { dailyBudget: 10, countries: ['CA'], adMessage: 'saved', landingPageUrl: '', startsAt: '', endsAt: '', audience: '', placements: '', accountConnectionId: 'saved-account', materialSource: { sha256: 'saved-sha' } } };
  const records: any[] = options.draft ? [] : [{ id: 'create', action: 'create', status: 'VERIFIED', resourceId: '123', connectionId: 'account-real', createdAt: '2026-10-01' }];
  if (options.pending) records.push({ id: 'unknown', action: 'adjust_budget', status: 'UNKNOWN' });
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = typeof initial === 'function' ? initial() : initial; return [c.value, (v: any) => { c.value = typeof v === 'function' ? v(c.value) : v; }]; },
    useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
    useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((v, i) => !Object.is(v, c.deps[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
  };
  const request = async (path: string, input?: RequestInit) => {
    if (input?.method === 'POST') { calls.push({ path, body: JSON.parse(String(input.body)) }); if (options.defer) await new Promise<void>(resolve => { completed = resolve; }); const execution = { id: 'budget', action: 'adjust_budget', status: 'UNKNOWN', expectedDailyBudget: 12, createdAt: '' }; records.push(execution); return { execution }; }
    if (path.endsWith('/executions')) { if (options.receiptFailure) throw Error('receipt read failed'); return { items: [...records] }; }
    if (path === '/connections') return { releasePolicy: { allowedActions: options.policy === false ? ['create', 'pause'] : ['adjust_budget'], executionProviders: ['meta'], reason: '仅开放暂停创建' } };
    if (path.endsWith('/metrics')) return { currency: 'CNY', spend: null, results: null, costPerResult: null, reportedAt: '', metricLabel: 'Meta表单线索' };
    if (path.endsWith('/meta-audit')) return { taskVersion: options.expectedVersion ?? 3, pendingCount: 0, truncated: false, entries: options.draft ? [] : [{ executionId: 'create', campaignId: '123', dailyBudget: 10, spendCap: 500, currency: 'CNY' }] };
    throw Error(`unexpected endpoint ${path}`);
  };
  const exports: any = {}; let updated: any = null, closed = 0, readbacks = 0;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AdPlanBudgetDialog.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, Error, Date, AbortController, JSON, crypto: { randomUUID: () => 'stable-request-id' },
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (name === 'antd') return Object.fromEntries(['Modal', 'Alert', 'Button', 'Descriptions', 'InputNumber', 'Select', 'Space', 'Table', 'Tag'].map(n => [n, n]));
      if (name === '../lib/platformAds') return { platformAdsRequest: request, platformAdsApi: { async updateTask(id: string, input: any) { calls.push({ path: `update:${id}`, body: input }); return { ...task, ...input, version: 4 }; } } };
      return { default: 'Receipts' };
    },
  });
  const props = { task, inline: options.inline, onReadback() { readbacks++; }, onClose() { closed++; }, onUpdate(value: any) { updated = value; } };
  const render = () => { cursor = 0; tree = exports.default(props); effects.splice(0).forEach(fn => fn()); return tree; };
  const submit = () => { nodes(tree).find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); return flush(); };
  const set = (label: string, value: number) => { nodes(tree).find(n => n.type === 'InputNumber' && n.props['aria-label'] === label).props.onChange(value); render(); };
  return { render, submit, set, calls, task, props, async ready() { render(); await flush(); render(); render(); }, resolve() { completed?.(); }, get updated() { return updated; }, get readbacks() { return readbacks; }, get closed() { return closed; } };
}
test('draft budget editing preserves complete configuration, identity and expectedVersion', async () => {
  const h = budgetHarness({ draft: true }); await h.ready(); h.set('计划总预算上限', 520); h.set('计划日预算', 12); await h.submit();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, 'update:plan'); assert.equal(h.calls[0].body.expectedVersion, 3);
  assert.equal(h.calls[0].body.configuration.materialSource.sha256, 'saved-sha'); assert.deepEqual(h.calls[0].body.configuration.countries, ['CA']); assert.equal(h.updated.version, 4); assert.equal(h.updated.budget, 520);
});
test('live budget requests use verified resource IDs automatically and stay single-flight', async () => {
  const h = budgetHarness({ defer: true }); await h.ready(); h.set('计划日预算', 12); const first = h.submit(), second = h.submit(); h.render().props.onCancel();
  assert.equal(h.closed, 0); assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].body, { expectedVersion: 3, connectionId: 'account-real', resourceId: '123', action: 'adjust_budget', dailyBudget: 12, requestId: 'stable-request-id' });
  h.resolve(); await Promise.all([first, second]); h.render(); await flush(); h.render(); await h.submit(); assert.equal(h.calls.length, 1, 'unknown result blocks another adjustment'); assert.equal(h.readbacks, 1, 'live adjustment refreshes the parent row even when result needs reconciliation');
});
for (const [name, options] of Object.entries({ 'release restriction': { policy: false }, 'unknown prior action': { pending: true }, 'missing execution history': { receiptFailure: true }, 'stale platform audit version': { expectedVersion: 2 } })) {
  test(`${name} cannot send a platform budget request`, async () => { const h = budgetHarness(options); await h.ready(); h.set('计划日预算', 12); await h.submit(); assert.equal(h.calls.length, 0); });
}
test('suggest, approval, managed and imported plans cannot silently use the manual budget path', async () => {
  for (const mode of ['suggest', 'approval', 'managed', 'import']) {
    const h = budgetHarness(); h.task.managementMode = mode === 'import' ? 'manual' : mode; h.task.creationSource = mode === 'import' ? 'platform_import' : 'manual'; await h.ready(); h.set('计划日预算', 12); await h.submit(); assert.equal(h.calls.length, 0);
  }
});

test('inline budget panel preserves the existing save contract without mounting a modal', async () => {
  const h = budgetHarness({ draft: true, inline: true }); await h.ready();
  const tree = h.render(); assert.equal(tree.type, 'section'); assert.equal(tree.props['aria-label'], `预算管理 · ${h.task.name}`);
  h.set('计划日预算', 15); await h.submit(); assert.equal(h.calls[0].path, 'update:plan'); assert.equal(h.calls[0].body.expectedVersion, 3); assert.equal(h.calls[0].body.configuration.dailyBudget, 15); assert.equal(h.readbacks, 1);
});
