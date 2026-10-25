import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as capabilities from '../../shared/platformAdCapabilities';
import * as domain from '../lib/platformAdsDomain';
import * as journeys from '../../shared/metaAdJourney';
import * as targeting from '../../shared/metaTargeting';
import * as messageChoice from '../../shared/metaMessageChoice';

type Node = { type: any; props: any };
const nodes = (v: any): Node[] => Array.isArray(v) ? v.flatMap(nodes) : v?.props ? [v, ...nodes(v.props.children)] : [];
const text = (v: any): string => Array.isArray(v) ? v.map(text).join('') : v?.props ? text(v.props.children) : typeof v === 'string' ? v : '';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function workspace(page = 'adsPlans') {
  let cursor = 0, tree: any;
  const cells: any[] = [], effects: Array<() => void> = [], calls: Array<{ method: string; input: any; id?: string }> = [];
  const saved = new Map<string, any>();
  let fail = false, pending: ((task: any) => void) | null = null, defer = false;
  const nav: any = { identity: 'tenant-a', taskId: '', task: null, loading: false, error: '', select(id: string) { nav.taskId = id; nav.task = saved.get(id) || null; } };
  const list: any = { items: null, loading: false, error: '', retry() {} };
  const props = { page, onNavigate(p: string) { props.page = p; } };
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = typeof initial === 'function' ? initial() : initial; return [c.value, (v: any) => { c.value = typeof v === 'function' ? v(c.value) : v; }]; },
    useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
    useMemo(fn: () => any) { cell(); return fn(); },
    useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((v, i) => !Object.is(v, c.deps[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
  };
  const persist = async (method: string, input: any, id = 'new-plan') => {
    calls.push({ method, input, id });
    if (fail) throw Error('模拟服务不可用');
    const task = { ...input, id, budget: Number(input.budget), status: 'draft', version: method === 'update' ? 8 : 1, creationSource: method === 'ai' ? 'ai_assisted' : 'manual', managementMode: 'manual', createdAt: '2026-10-25T00:00:00Z' };
    if (defer) await new Promise<any>(resolve => { pending = resolve; });
    saved.set(id, task); return task;
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./PlatformAdsPage.tsx', import.meta.url), 'utf8') + '\nexports.Workspace = PlatformAdsWorkspace;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, console, Error, Date, Intl, Set, Map, URL, sessionStorage: { getItem() { return null; } }, window: { addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
      if (name === 'antd') return { ...Object.fromEntries(['Modal', 'Button', 'Select', 'Tabs', 'Collapse', 'Drawer', 'Alert'].map(n => [n, n])), Input: { Search: 'Search' } };
      if (name === '../../shared/platformAdCapabilities') return capabilities;
      if (name === '../../shared/metaAdJourney') return journeys;
      if (name === '../../shared/metaTargeting') return targeting;
      if (name === '../../shared/metaMessageChoice') return messageChoice;
      if (name === '../../shared/metaAdObjectives') return { META_LEAD_DESCRIPTIONS: {} };
      if (name === '../lib/platformAdsDomain') return domain;
      if (name === '../lib/useAdPlanNavigation') return { useAdPlanNavigation: () => nav, useAdPlanTasks: () => list };
      if (name === '../lib/platformAdsPreview') return { isPlatformAdsDemoEnabled: () => false };
      if (name === '../mocks/foreignTradeOperations') return { isForeignTradeMockId: () => false };
      if (name === '../lib/platformAds') return { platformAdsApi: { generatePlan: (input: any) => persist('ai', input), createTask: (input: any) => persist('manual', input), updateTask: (id: string, input: any) => persist('update', input, id) } };
      return new Proxy({}, { get: (_, key) => key === 'default' ? name.split('/').at(-1) : String(key) });
    },
  });
  const render = () => { cursor = 0; tree = exports.Workspace(props); effects.splice(0).forEach(fn => fn()); return tree; };
  const modal = () => nodes(tree).find(n => n.type === 'Modal')!;
  const button = (name: string) => nodes(modal()).find(n => ['Button', 'button'].includes(n.type) && text(n) === name)!;
  const field = (label: string) => {
    const parent = nodes(modal()).find(n => n.type === 'label' && text(n).startsWith(label));
    return nodes(parent).find(n => ['input', 'select', 'textarea'].includes(n.type))!;
  };
  const fill = (label: string, value: string) => { field(label).props.onChange({ target: { value } }); render(); };
  const submit = () => nodes(modal()).find(n => n.type === 'form')!.props.onSubmit({ preventDefault() {} });
  const open = () => { const header = nodes(tree).find(n => n.type === 'LsPageHeader')!; nodes(header.props.extra).find(n => text(n) === '智能创编')!.props.onClick(); render(); };
  render(); list.items = []; render();
  return { render, modal, button, field, fill, submit, open, calls, nav, saved, props,
    fail(v: boolean) { fail = v; }, defer() { defer = true; }, resolve() { pending?.({}); },
    configure(goal: string) { fill('投放视频', 'verified-video.mp4'); fill('推广目标', goal); const c = nodes(modal()).find(n => n.type === 'AdCountrySelect')!; c.props.onChange(['CA']); render(); },
    message(choice: messageChoice.MetaMessageChoice) { nodes(modal()).find(n => n.type === 'AdDraftMessageChannels')!.props.onChange(choice); render(); },
    target(value: targeting.MetaTargeting) { nodes(modal()).find(n => n.type === 'MetaTargetingFields')!.props.onChange(value); render(); },
    async review() { await submit(); render(); fill('计划总预算', '500'); fill('广告文案', 'Catalog request'); fill('日预算', '12'); await submit(); render(); },
    edit(task: any) { saved.set(task.id, task); nav.select(task.id); render(); render(); nodes(tree).find(n => n.type === 'button' && text(n) === '编辑方案')!.props.onClick(); render(); },
  };
}

for (const goal of ['提升网站访问', '提升有效视频观看', '获取消息会话', '获取Meta表单线索', '获取独立站询盘']) {
  test(`${goal}: default AI payload preserves business configuration and opens returned plan for execution`, async () => {
    const h = workspace('adsCreatives'); h.open(); assert.equal(h.modal().props.title, 'AI 创编投放计划');
    h.configure(goal); await h.review(); await h.submit(); h.render(); h.render();
    assert.equal(h.calls.length, 1); const { input } = h.calls[0];
    assert.equal(h.calls[0].method, 'ai'); assert.equal(input.entry, 'ai_assisted'); assert.equal(input.goal, goal);
    assert.equal(JSON.stringify(input.configuration.countries), '["CA"]'); assert.equal(input.configuration.dailyBudget, 12);
    assert.equal(input.configuration.adMessage, 'Catalog request'); assert.equal(input.budget, '500');
    assert.equal(input.configuration.metaTargeting.ageMin, 18); assert.equal(input.configuration.metaTargeting.placementMode, 'automatic');
    assert.equal(h.props.page, 'adsPlans'); assert.equal(h.nav.taskId, 'new-plan'); assert.equal(h.modal().props.open, false);
    assert.ok(nodes(h.render()).some(n => n.type === 'AdTaskControls' && n.props.task.id === 'new-plan'));
  });
}

test('platform selections survive AI planning payload and reopening the saved draft', async () => {
  const h = workspace(); h.open(); h.configure('获取消息会话'); await h.submit(); h.render();
  h.fill('计划总预算', '500'); h.fill('广告文案', 'Contact us'); h.fill('日预算', '20');
  const config = { ...targeting.emptyMetaTargeting, ageMin: 25, ageMax: 55, locales: [{ id: '6', name: 'English (US)' }], interests: [{ id: '6003', name: 'Manufacturing' }], placementMode: 'manual' as const, facebookPositions: ['feed'], instagramPositions: ['reels'] };
  h.target(config); await h.submit(); h.render(); await h.submit(); h.render(); h.render();
  assert.equal(JSON.stringify(h.calls[0].input.configuration.metaTargeting), JSON.stringify(config));
  h.edit(h.saved.get('new-plan'));
  assert.equal(h.modal().props.title, '编辑投放计划'); await h.submit(); h.render();
  assert.equal(JSON.stringify(h.calls[1].input.configuration.metaTargeting), JSON.stringify(config));
});

test('one country selection generates market summary and the chosen chat channel persists through creation', async () => {
  const h = workspace(); h.open(); h.configure('获取消息会话');
  assert.ok(!nodes(h.modal()).some(n => n.type === 'label' && text(n).trim() === '目标市场'));
  const choice: messageChoice.MetaMessageChoice = { pageId: '1', destination: 'WHATSAPP', recipientId: '+8613800138000' };
  h.message(choice); await h.review(); await h.submit(); h.render();
  assert.equal(h.calls[0].input.market, '加拿大');
  assert.equal(JSON.stringify(h.calls[0].input.configuration.metaMessage), JSON.stringify(choice));
});

test('AI failure stays in the modal, retains inputs, and lets the user explicitly save manually', async () => {
  const h = workspace(); h.open(); h.configure('提升有效视频观看'); await h.review(); h.fail(true); await h.submit(); h.render();
  assert.equal(h.modal().props.open, true); assert.ok(nodes(h.modal()).some(n => n.type === 'Alert' && n.props.title.includes('模拟服务不可用'))); assert.equal(h.nav.taskId, '');
  const recovery = nodes(h.modal()).find(n => n.type === 'Alert' && n.props.action);
  assert.ok(recovery);
  assert.equal(text(recovery.props.action), '保留内容，改为手动保存');
  h.fail(false); recovery.props.action.props.onClick(); h.render(); await h.submit(); h.render();
  assert.equal(h.calls[1].method, 'manual'); assert.equal(h.calls[1].input.configuration.adMessage, 'Catalog request');
  assert.equal(h.nav.taskId, 'new-plan');
});

test('saving is single-flight and prevents close or repeated create', async () => {
  const h = workspace(); h.open(); h.configure('提升有效视频观看'); await h.review(); h.defer();
  const first = h.submit(); const second = h.submit(); h.render(); h.modal().props.onCancel(); h.render();
  assert.equal(h.calls.length, 1); assert.equal(h.modal().props.open, true); assert.equal(h.modal().props.closable, false);
  h.resolve(); await Promise.all([first, second]); h.render(); assert.equal(h.nav.taskId, 'new-plan');
});

test('editing preserves plan identity and optimistic version without generating a second plan', async () => {
  const h = workspace(); h.edit({ id: 'existing', name: 'Original', video: 'clip', goal: '提升有效视频观看', market: 'CA', budget: 500, currency: 'CNY', channels: ['Facebook'], status: 'draft', creationSource: 'ai_assisted', managementMode: 'manual', version: 7, configuration: { ...domain.emptyAdPlanConfiguration, countries: ['CA'], adMessage: 'Saved copy', dailyBudget: 12 } });
  assert.equal(h.modal().props.title, '编辑投放计划'); await h.submit(); h.render();
  assert.equal(h.calls[0].method, 'update'); assert.equal(h.calls[0].id, 'existing'); assert.equal(h.calls[0].input.expectedVersion, 7);
  assert.equal(h.nav.taskId, 'existing'); assert.equal(h.saved.get('existing').version, 8);
});

test('a response from the previous identity cannot reopen a plan in a different tenant session', async () => {
  const h = workspace(); h.open(); h.configure('提升有效视频观看'); await h.review(); h.defer(); const save = h.submit();
  h.nav.identity = 'tenant-b'; h.nav.select(''); h.render(); h.resolve(); await save; h.render();
  assert.equal(h.nav.taskId, ''); assert.equal(h.modal().props.open, false);
});
