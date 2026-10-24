import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdMetaConnectionGuide.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
type Cell = { value?: any; deps?: any[]; cleanup?: () => void };
function harness(configured = true) {
  let cursor = 0, timer: (() => Promise<void>) | undefined, result: any;
  const cells: Cell[] = [], effects: (() => void)[] = [], requests: { path: string; init: any }[] = [];
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const jsx = (type: any, props: any) => ({ type, props });
  const account = { id: 'act_1', name: 'Real account', currency: 'CNY', accountStatus: 1, timezoneName: 'Asia/Shanghai' };
  const exports: any = {};
  vm.runInNewContext(compiled, {
    exports, module: { exports }, URL, AbortController, Date, Map,
    clearInterval() { timer = undefined; },
    document: { hidden: false },
    window: { open: () => null, addEventListener() {}, removeEventListener() {}, setInterval: (fn: any) => { timer = fn; return 1; } },
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = initial; return [c.value, (v: any) => { c.value = typeof v === 'function' ? v(c.value) : v; }]; },
        useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
        useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((d, i) => !Object.is(d, c.deps?.[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      if (name === 'antd') return Object.fromEntries(['Alert', 'Button', 'Collapse', 'Descriptions', 'Empty', 'Select', 'Space', 'Steps'].map(n => [n, n]));
      if (name === '../lib/auth') return { authHeader: () => ({ Authorization: 'isolated-user-scope' }) };
      if (name === '../lib/platformAds') return { platformAdsRequest: async (path: string, init: any) => {
        requests.push({ path, init });
        if (path.endsWith('/start')) return { sessionId: 'session1', url: 'https://www.facebook.com/v26.0/dialog/oauth?state=test' };
        if (path.endsWith('/accounts')) return { status: 'ready', accounts: [account, { ...account, id: 'act_2', name: 'Restricted', accountStatus: 2 }] };
        if (path.includes('/pages?')) return { items: [{ id: '10', name: 'Real brand' }] };
        if (path.endsWith('/connect')) return { connection: { id: 'local-connection', defaultPage: { id: '10' } } };
        throw new Error(`Unexpected request ${path}`);
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const render = () => { cursor = 0; const tree = exports.default({ configured, missing: ['META_ADS_APP_SECRET'], onConnected: (c: any) => { result = c; } }); effects.splice(0).forEach(f => f()); return tree; };
  return { render, requests, poll: async () => timer?.(), get result() { return result; } };
}
function nodes(node: any): any[] { return Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : ''; }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const button = (tree: any, name: string) => nodes(tree).find(n => n.type === 'Button' && text(n) === name);
const blocked = harness(false);
const blockedTree = blocked.render();
assert.ok(nodes(blockedTree).some(n => n.type === 'Alert' && n.props.title.includes('官方登录暂未就绪')));
assert.equal(button(blockedTree, '前往 Meta 官方授权').props.disabled, true);
assert.equal(blocked.requests.length, 0);
assert.doesNotMatch(source, /type="password"|localStorage|sessionStorage/);
const h = harness();
let tree = h.render();
await button(tree, '前往 Meta 官方授权').props.onClick(); await flush(); tree = h.render();
assert.ok(nodes(tree).some(n => n.type === 'Button' && n.props.href?.startsWith('https://www.facebook.com/')));
await h.poll(); await flush(); tree = h.render();
let select = nodes(tree).find(n => n.type === 'Select');
assert.equal(select.props.options[1].disabled, true);
assert.equal(button(tree, '下一步：选择主页').props.disabled, true);
select.props.onChange('act_1'); tree = h.render(); await flush(); tree = h.render();
button(tree, '下一步：选择主页').props.onClick(); tree = h.render();
assert.equal(button(tree, '下一步：确认连接').props.disabled, true);
select = nodes(tree).find(n => n.type === 'Select');
assert.equal(select.props.options[0].label, 'Real brand · 10');
select.props.onChange('10'); tree = h.render();
button(tree, '下一步：确认连接').props.onClick(); tree = h.render();
await button(tree, '确认连接账户与主页').props.onClick(); await flush(); h.render();
assert.equal(h.result.defaultPage.id, '10');
assert.deepEqual(JSON.parse(h.requests.find(r => r.path.endsWith('/connect'))!.init.body), { accountId: 'act_1', pageId: '10' });
assert.ok(h.requests.every(r => /\/oauth\/meta\//.test(r.path)), 'guide cannot upload or create ads');
console.log('Meta beginner guide: blocked configuration, popup recovery, restricted account, page choice and confirmation passed');
