import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as metrics from '../../shared/metaPerformance';
import * as objectives from '../../shared/metaAdObjectives';
import * as receiptStates from '../../shared/adReceiptState';
import * as journeys from '../../shared/metaAdJourney';

type Node = { type: any; props: any };
const nodes = (value: any): Node[] => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : [];
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : typeof value === 'string' ? value : '';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(file: string, request: (path: string, options?: RequestInit) => Promise<any>, mocks: Record<string, unknown> = {}) {
  let cursor = 0;
  const focusHandlers = new Set<() => void>();
  const cells: any[] = [], effects: Array<() => void> = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = typeof initial === 'function' ? initial() : initial; return [c.value, (v: any) => { c.value = typeof v === 'function' ? v(c.value) : v; }]; },
    useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
    useMemo(fn: () => any) { cell(); return fn(); },
    useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((v, i) => !Object.is(v, c.deps[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
  };
  const exports: any = {};
  const source = readFileSync(new URL(file, import.meta.url), 'utf8') + (file === './PlatformAdsOperations.tsx' ? '\nexports.default = AdExecutionControls;' : file === './useMetaDestinationAssets.ts' ? '\nexports.default = p => useMetaDestinationAssets(p.connectionId, p.pageId, p.kind);' : '');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, module: { exports }, URLSearchParams, AbortController, Date, Map, Set, console,
    window: { setInterval: () => 1, clearInterval() {}, addEventListener(type: string, fn: () => void) { if (type === 'focus') focusHandlers.add(fn); }, removeEventListener(type: string, fn: () => void) { if (type === 'focus') focusHandlers.delete(fn); } },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    require(name: string) {
      if (name in mocks) return mocks[name];
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: 'Fragment' };
      if (name === 'antd') return { ...Object.fromEntries(['Alert', 'Button', 'Collapse', 'Drawer', 'Pagination', 'Select', 'Space', 'Table', 'Tabs', 'Tag', 'Tooltip'].map(n => [n, n])), Input: { Search: 'Input.Search' }, DatePicker: { RangePicker: 'DatePicker.RangePicker' } };
      if (name === './AdAccountDirectory') return { useAdAccountDirectory: () => ({ adId: 'old-platform-ad' }) };
      if (name === './AdExecutionReceipts') return { default: 'AdExecutionReceipts' };
      if (name === '../lib/platformAds') return { platformAdsRequest: request };
      if (name === '../../shared/metaPerformance') return metrics;
      if (name === '../../shared/metaAdObjectives') return objectives;
      if (name === '../../shared/metaAdJourney') return journeys;
      if (name === '../../shared/adReceiptState') return receiptStates;
      return new Proxy({}, { get: (_, property) => String(property) });
    },
  });
  return {
    component: exports.default,
    focus() { focusHandlers.forEach(fn => fn()); },
    reset() { cells.length = 0; effects.length = 0; cursor = 0; },
    render(props: any, component = exports.default) { cursor = 0; const tree = component(props); effects.splice(0).forEach(fn => fn()); return tree; },
    unmount() { cells.forEach(c => c.cleanup?.()); },
  };
}

test('plan deep links open local receipts, refresh context, and retain intentional account-history navigation', () => {
  const h = harness('./AdPerformanceOverview.tsx', async () => { throw Error('no network expected'); });
  const props = { tasks: [], loading: false, onOpen() {} };
  let tree = h.render(props);
  assert.equal(tree.props.activeKey, 'history');
  tree = h.render({ ...props, initialTaskId: 'old-plan' });
  tree = h.render({ ...props, initialTaskId: 'old-plan' });
  assert.equal(tree.props.activeKey, 'local');
  tree.props.onChange('history');
  assert.equal(h.render({ ...props, initialTaskId: 'old-plan' }).props.activeKey, 'history');
  h.render({ ...props, initialTaskId: 'other-plan' });
  assert.equal(h.render({ ...props, initialTaskId: 'other-plan' }).props.activeKey, 'local');
});

test('report requests target the plan instead of searching page one, and switching plans clears the old account', async () => {
  const requests: string[] = [];
  const h = harness('./AdPerformanceOverview.tsx', async path => {
    requests.push(path);
    const taskId = new URLSearchParams(path.split('?')[1]).get('taskId');
    return { items: [{ task: { id: taskId, name: 'Plan' }, connection: { id: `${taskId}-account`, name: 'Account', provider: 'meta', currency: 'CNY' }, binding: {}, execution: null }], page: 1, totalItems: 1, totalPages: 1 };
  });
  const props = { tasks: [{ id: 'old-plan', name: 'Old' }, { id: 'new-plan', name: 'New' }], loading: false, onOpen() {}, initialTaskId: 'old-plan' };
  const root = h.render(props);
  const child = nodes(root.props.items.find((item: any) => item.key === 'local').children).find(n => typeof n.type === 'function')!;
  // Mount the child with its own hook cells, then keep them across navigation.
  h.reset();
  let tree = h.render(props, child.type); await flush(); tree = h.render(props, child.type);
  assert.ok(requests.some(path => new URLSearchParams(path.split('?')[1]).get('taskId') === 'old-plan'));
  const accountSelect = nodes(tree).find(n => n.type === 'Select' && n.props['aria-label'] === '广告账户');
  accountSelect!.props.onChange('old-plan-account');
  h.render({ ...props, initialTaskId: 'new-plan' }, child.type);
  h.render({ ...props, initialTaskId: 'new-plan' }, child.type); await flush();
  tree = h.render({ ...props, initialTaskId: 'new-plan' }, child.type);
  assert.ok(requests.some(path => new URLSearchParams(path.split('?')[1]).get('taskId') === 'new-plan'));
  assert.equal(nodes(tree).find(n => n.type === 'Select' && n.props['aria-label'] === '计划范围')!.props.value, 'new-plan');
  assert.equal(nodes(tree).find(n => n.type === 'Select' && n.props['aria-label'] === '广告账户')!.props.value, 'new-plan-account');
});

test('manual recovery calls only the exact receipt reconcile endpoint, refreshes, and blocks double submission', async () => {
  const requests: string[] = []; let resolve!: (value: any) => void, refreshed = 0;
  const h = harness('./AdExecutionReceipts.tsx', path => { requests.push(path); return new Promise(done => { resolve = done; }); });
  const props = { taskId: 'task-a', records: [{ id: 'receipt-a', status: 'UNKNOWN' }, { id: 'verified', status: 'VERIFIED' }, { id: 'failed', status: 'FAILED' }], onRefresh: async () => { refreshed++; } };
  let tree = h.render(props);
  const buttons = nodes(tree).filter(n => n.type === 'button' && text(n) === '核对这条回执');
  assert.equal(buttons.length, 1);
  buttons[0].props.onClick(); buttons[0].props.onClick();
  assert.deepEqual(requests, ['/tasks/task-a/executions/receipt-a/reconcile']);
  assert.ok(nodes(h.render(props)).filter(n => n.type === 'button').every(n => n.props.disabled));
  resolve({ execution: { status: 'VERIFIED' } }); await flush(); tree = h.render(props);
  assert.equal(refreshed, 1); assert.ok(text(tree).includes('原回执已更新'));
  assert.ok(requests.every(path => !path.endsWith('/execute')));
});

test('partial-resource errors retain the unknown receipt and never create or mark success', async () => {
  let refreshed = 0;
  const h = harness('./AdExecutionReceipts.tsx', async () => { throw new Error('仅创建了部分资源，需平台人工核对'); });
  const props = { taskId: 't', records: [{ id: 'r', status: 'UNKNOWN' }], onRefresh: async () => { refreshed++; } };
  nodes(h.render(props)).find(n => n.type === 'button' && text(n) === '核对这条回执')!.props.onClick(); await flush();
  const tree = h.render(props);
  assert.ok(text(tree).includes('需平台人工核对')); assert.ok(!text(tree).includes('原回执已更新')); assert.equal(refreshed, 0);
  assert.equal(props.records[0].status, 'UNKNOWN');
});

test('a late response after leaving the plan does not refresh another plan or display success', async () => {
  let resolve!: (value: any) => void, refreshed = 0;
  const h = harness('./AdExecutionReceipts.tsx', () => new Promise(done => { resolve = done; }));
  const props = { taskId: 'a', records: [{ id: 'r', status: 'EXECUTING' }], onRefresh: async () => { refreshed++; } };
  nodes(h.render(props)).find(n => n.type === 'button' && text(n) === '核对这条回执')!.props.onClick();
  h.unmount(); resolve({ execution: { status: 'VERIFIED' } }); await flush(); assert.equal(refreshed, 0);
});

test('material deep links fetch the selected old plan directly and reset pagination/account across plans', async () => {
  const requests: string[] = [];
  const h = harness('./AdCreativeLibrary.tsx', async path => {
    requests.push(path); return { page: Number(new URLSearchParams(path.split('?')[1]).get('page')), items: [], totalItems: 1 };
  });
  const props = { initialTaskId: 'old-plan-beyond-page-one', initialTaskName: 'Old', onOpenTask() {} };
  let tree = h.render(props); await flush(); tree = h.render(props);
  assert.equal(nodes(tree).find(n => n.type === 'Tabs')!.props.activeKey, 'ads', 'plan link takes priority over stale platform ad selection');
  assert.ok(requests.some(path => new URLSearchParams(path.split('?')[1]).get('taskId') === props.initialTaskId));
  nodes(tree).find(n => n.type === 'Pagination')!.props.onChange(3); h.render(props); await flush(); tree = h.render(props);
  nodes(tree).find(n => n.type === 'Select')!.props.onChange('old-account');
  const next = { ...props, initialTaskId: 'new-plan' };
  h.render(next); h.render(next); await flush(); tree = h.render(next);
  assert.ok(requests.some(path => { const p = new URLSearchParams(path.split('?')[1]); return p.get('taskId') === 'new-plan' && p.get('page') === '1'; }));
  assert.equal(nodes(tree).find(n => n.type === 'Select')!.props.value, 'all');
});

const executionProps = {
  task: { id: 'task', version: 1, currency: 'USD', status: 'draft', managementMode: 'manual', goal: '提升网站访问', channels: ['Facebook'], budget: 100, configuration: { accountConnectionId: 'account', dailyBudget: 10 } },
  connections: [{ id: 'account', provider: 'meta', currency: 'USD', status: 'connected' }],
  onUpdate() {}, releasePolicy: { mode: 'paused_only', allowedActions: ['create'], executionProviders: ['meta'] },
};
test('all five Meta goals require business inputs and automatic assets without a business handoff gate', async () => {
  for (const goal of objectives.META_AD_GOALS) {
    const h = harness('./PlatformAdsOperations.tsx', async path => path.endsWith('/platform-preview') ? { thumbnailUrl: 'https://example.com/cover.jpg' } : ({ items: [] }));
    const props = { ...executionProps, task: { ...executionProps.task, goal, configuration: { ...executionProps.task.configuration, countries: ['US'], adMessage: 'Request our product catalog', landingPageUrl: 'https://example.com/quote' } } };
    h.render(props); await flush(); let tree = h.render(props);
    assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === '创建真实广告并保持暂停')?.props.disabled, true, 'wait for automatic assets');
    nodes(tree).find(n => typeof n.props.onAvailability === 'function')!.props.onAvailability(true);
    nodes(tree).find(n => n.props.connectionId === 'account' && 'value' in n.props && typeof n.props.value === 'string' && typeof n.props.onChange === 'function')!.props.onChange('1');
    nodes(tree).find(n => typeof n.props.onUse === 'function')!.props.onUse({ id: 'creative', name: 'Video', platformVideoId: '2', connectionId: 'account' });
    await flush(); tree = h.render(props);
    assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === '创建真实广告并保持暂停')?.props.disabled, false, goal);
    assert.doesNotMatch(text(tree), /跟进负责人|线索接收入口|回访账号|再次确认以上接收/);
  }
});
test('receipt read is independent of failed or stalled approval/launch history', async () => {
  const h = harness('./PlatformAdsOperations.tsx', async path => {
    if (path.endsWith('/executions')) return { items: [{ id: 'unknown-receipt', action: 'create', status: 'UNKNOWN' }] };
    if (path.endsWith('/approvals')) throw Error('approval history unavailable');
    if (path.endsWith('/launch')) return new Promise(() => {});
    throw Error('Unexpected endpoint');
  });
  h.render(executionProps); await flush(); const tree = h.render(executionProps);
  const receipts = nodes(tree).find(n => n.type === 'AdExecutionReceipts');
  assert.equal(receipts?.props.records[0].id, 'unknown-receipt', 'manual reconciliation stays reachable');
  assert.ok(nodes(tree).some(n => n.type === 'Alert' && n.props.title.startsWith('审批记录读取失败')));
});

test('failed execution history never looks empty and creation stays blocked until a successful read', async () => {
  let fail = true;
  const h = harness('./PlatformAdsOperations.tsx', async path => {
    if (path.endsWith('/executions') && fail) throw Error('receipt history unavailable');
    return { items: [] };
  });
  let tree = h.render(executionProps);
  assert.ok(nodes(tree).find(n => n.type === 'button' && text(n) === '创建真实广告并保持暂停')?.props.disabled);
  await flush(); tree = h.render(executionProps);
  assert.ok(!nodes(tree).some(n => n.type === 'AdExecutionReceipts'), 'unknown history must not render an empty receipt widget');
  assert.ok(nodes(tree).some(n => n.type === 'Alert' && n.props.title.startsWith('执行回执读取失败')));
  assert.ok(nodes(tree).find(n => n.type === 'button' && text(n) === '创建真实广告并保持暂停')?.props.disabled);
  fail = false;
  nodes(tree).find(n => n.type === 'button' && text(n) === '重新读取执行回执')!.props.onClick(); await flush(); tree = h.render(executionProps);
  assert.ok(nodes(tree).some(n => n.type === 'AdExecutionReceipts'));
  assert.equal(nodes(tree).find(n => n.type === 'button' && text(n) === '创建真实广告并保持暂停')?.props.disabled, true, 'history recovery cannot silently fill missing business decisions');
  assert.ok(!nodes(tree).some(n => n.type === 'Alert' && n.props.title.startsWith('执行回执读取失败')));
});


test('saved selected material stays visible without inventing a binding or platform result', async () => {
  const requests: string[] = [], opened: string[] = [];
  const h = harness('./AdCreativeLibrary.tsx', async path => { requests.push(path); return { items: [], page: 1, totalItems: 1 }; });
  const selection = { origin: 'social', sourceTaskId: 'source', artifactId: 'artifact', name: 'Chosen original.mp4', sha256: 'frozen-sha', sourceTenantId: 'tenant', sourceTenantName: 'Current enterprise', contentStatus: 'draft' };
  const props = { initialTaskId: 'selected-plan', selectedMaterial: { taskId: 'selected-plan', selection }, onOpenTask: (id: string) => opened.push(id) };
  h.render(props); await flush(); let tree = h.render(props);
  const gallery = nodes(tree).find(n => n.type === 'LsMasonryGallery')!;
  assert.equal(gallery.props.items.length, 1);
  const card = gallery.props.items[0].content;
  assert.match(text(card), /Chosen original.mp4/); assert.match(text(card), /已选素材 · 尚未绑定\/上传/);
  nodes(card).find(n => n.type === 'Button' && text(n) === '预览已选源视频')!.props.onClick(); tree = h.render(props);
  const drawer = nodes(tree).find(n => n.type === 'Drawer' && n.props.title === '已选源视频 · 尚未绑定/上传')!;
  assert.equal(drawer.props.open, true); assert.equal(drawer.props.children.props.source.sha256, 'frozen-sha');
  nodes(card).find(n => n.type === 'Button' && text(n) === '返回此计划继续绑定')!.props.onClick(); assert.deepEqual(opened, ['selected-plan']);
  const next = { ...props, initialTaskId: 'another-plan' };
  tree = h.render(next); await flush(); tree = h.render(next);
  assert.equal(nodes(tree).find(n => n.type === 'LsMasonryGallery')!.props.items.length, 0, 'old selected source is removed when the plan changes');
  assert.equal(nodes(tree).find(n => n.type === 'Drawer' && n.props.title === '已选源视频 · 尚未绑定/上传')!.props.open, false);
  assert.ok(requests.every(path => path.startsWith('/creative-library?')), 'displaying a selection cannot upload, bind or query invented reports');
  const empty = { ...next, selectedMaterial: undefined };
  tree = h.render(empty);
  assert.match(nodes(tree).find(n => n.type === 'LsMasonryGallery')!.props.emptyText, /请先在计划中绑定/);
});

test('lead assets auto-associate a unique form, preserve business choice, and clear stale or unavailable assets', () => {
  const empty = { messageDestination: 'WHATSAPP', whatsappPhoneNumber: '', instagramActorId: '', instagramUsername: '', leadFormId: '', pixelId: '' };
  let data: any = { kind: 'forms', forms: [{ id: '1', name: '报价', locale: 'en_US', questions: ['工作邮箱'] }], termsAccepted: true, pixels: [] };
  const h = harness('./MetaLeadFields.tsx', async () => { throw Error('unexpected'); }, { './useMetaDestinationAssets': { useMetaDestinationAssets: () => ({ data, loading: false, error: '', refresh() {} }) } });
  let value = { ...empty };
  const props = () => ({ goal: '获取Meta表单线索', value, onChange: (next: typeof value) => { value = next; }, connectionId: 'a', pageId: 'p' });
  h.render(props()); let tree = h.render(props());
  assert.equal(value.leadFormId, '1'); assert.match(text(tree), /已自动关联/);
  assert.equal(nodes(tree).some(n => n.type === 'input'), false);
  data = { ...data, forms: [...data.forms, { id: '2', name: '产品目录', locale: 'en_US', questions: ['姓名'] }] };
  tree = h.render(props()); assert.equal(value.leadFormId, '1', 'preserve a valid business choice');
  nodes(tree).find(n => n.type === 'Select')!.props.onChange('2'); h.render(props());
  assert.equal(value.leadFormId, '2');
  data = { ...data, forms: [] }; h.render(props()); assert.equal(value.leadFormId, '', 'archived or wrong-page form cannot linger');
  data = undefined; h.render(props()); assert.equal(value.leadFormId, '', 'switching pages or a failed read cannot reuse the old form');
  data = { kind: 'messages', forms: [], whatsappPhoneNumber: '+8613800138000', instagram: { id: '7', username: 'factory' } };
  h.render({ ...props(), goal: '获取消息会话' }); assert.equal(value.whatsappPhoneNumber, '+8613800138000'); assert.equal(value.instagramActorId, '7');
  data = { kind: 'pixels', forms: [], pixels: [{ id: '9', name: '官网' }] };
  h.render({ ...props(), goal: '获取独立站询盘' }); assert.equal(value.pixelId, '9'); assert.equal(value.instagramActorId, '');
});

test('a late directory response never associates assets from a previous Page', async () => {
  const pending = new Map<string, (value: unknown) => void>();
  const h = harness('./useMetaDestinationAssets.ts', path => new Promise(resolve => { pending.set(new URLSearchParams(path.split('?')[1]).get('pageId')!, resolve); }));
  const props = { connectionId: 'account', pageId: 'old', kind: 'forms' };
  h.render(props); h.render({ ...props, pageId: 'new' });
  pending.get('old')!({ pageId: 'old', forms: [{ id: 'wrong' }] }); await flush();
  assert.equal(h.render({ ...props, pageId: 'new' }).data, undefined);
  pending.get('new')!({ pageId: 'new', forms: [{ id: 'right' }] }); await flush();
  assert.equal(h.render({ ...props, pageId: 'new' }).data.forms[0].id, 'right');
  assert.equal(h.render({ ...props, connectionId: 'another-account', pageId: 'new' }).data, undefined);
});

test('returning from Meta refreshes the current channel directory and unmount removes the listener', async () => {
  let reads = 0;
  const h = harness('./useMetaDestinationAssets.ts', async () => { reads++; return { pageId: '1', kind: 'messages', whatsappPhoneNumber: reads === 1 ? '' : '+8613800138000' }; });
  const props = { connectionId: 'account', pageId: '1', kind: 'messages' };
  h.render(props); await flush(); assert.equal(h.render(props).data.whatsappPhoneNumber, '');
  h.focus(); h.render(props); await flush(); assert.equal(h.render(props).data.whatsappPhoneNumber, '+8613800138000'); assert.equal(reads, 2);
  h.unmount(); h.focus(); h.render(props); assert.equal(reads, 2);
});

test('execution reuses saved business inputs and clears them when switching to an unconfirmed plan', async () => {
  const h = harness('./PlatformAdsOperations.tsx', async () => ({ items: [] }));
  const saved = { ...executionProps, task: { ...executionProps.task, configuration: { ...executionProps.task.configuration, countries: ['CA'], adMessage: 'Saved business copy', landingPageUrl: 'https://example.com/catalog', dailyBudget: 12 } } };
  h.render(saved); await flush(); let tree = h.render(saved);
  assert.equal(nodes(tree).find(n => n.type === 'textarea')?.props.value, 'Saved business copy');
  assert.equal(nodes(tree).find(n => Array.isArray(n.props.value) && n.props.value.includes('CA'))?.props.value.join(','), 'CA');
  const unconfirmed = { ...executionProps, task: { ...executionProps.task, id: 'another', configuration: { accountConnectionId: 'account', dailyBudget: null } } };
  h.render(unconfirmed); await flush(); tree = h.render(unconfirmed);
  assert.equal(nodes(tree).find(n => n.type === 'textarea')?.props.value, '');
  assert.equal(nodes(tree).find(n => n.type === 'input' && n.props.type === 'number')?.props.value, '');
  assert.ok(nodes(tree).some(n => Array.isArray(n.props.value) && n.props.value.length === 0), 'no implicit US targeting');
  assert.ok(nodes(tree).find(n => n.type === 'button' && text(n) === '创建真实广告并保持暂停')?.props.disabled);
});

test('created active ads show management actions and select original resource without recreating', async () => {
  const writes: string[] = [];
  const h = harness('./PlatformAdsOperations.tsx', async (path, init) => {
    if (init?.method === 'POST') writes.push(path);
    return { items: path.endsWith('/executions') ? [
      { id: 'create', action: 'create', status: 'VERIFIED', connectionId: 'account', resourceId: '123', createdAt: '2026-10-25T01:00:00Z' },
      { id: 'activate', action: 'activate', status: 'VERIFIED', connectionId: 'account', resourceId: '123', createdAt: '2026-10-25T02:00:00Z' },
    ] : [] };
  });
  const props = { ...executionProps, task: { ...executionProps.task, status: 'active' } };
  h.render(props); await flush(); h.render(props); const tree = h.render(props);
  assert.equal(nodes(tree).find(n => n.props['aria-label'] === '操作')!.props.value, 'pause');
  assert.equal(nodes(tree).find(n => n.props['aria-label'] === '已核验广告系列')!.props.value, '123');
  assert.ok(!nodes(tree).some(n => n.type === 'option' && n.props.value === 'create'));
  assert.ok(text(tree).includes('最近已核验投放开关：已启用'));
  assert.equal(writes.length, 0, 'selecting a suitable default must not execute it');
});
