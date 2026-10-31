import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdMetaConnectionGuide.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
type Cell = { value?: any; deps?: any[]; cleanup?: () => void };
function harness(configured = true, recovery: any = null, targetAccountId?: string, singlePage = false) {
  let scope = 'isolated-user-scope';
  let pollResponse: Promise<any> | undefined;
  const listeners = new Map<string, () => void>();
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
    window: { open: () => null, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name), setInterval: (fn: any) => { timer = fn; return 1; } },
    require(name: string) {
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'react') return {
        useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = initial; return [c.value, (v: any) => { c.value = typeof v === 'function' ? v(c.value) : v; }]; },
        useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
        useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((d, i) => !Object.is(d, c.deps?.[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      if (name === 'antd') return Object.fromEntries(['Alert', 'Button', 'Collapse', 'Descriptions', 'Empty', 'Select', 'Space', 'Steps'].map(n => [n, n]));
      if (name === '../lib/auth') return { AUTH_TOKEN_CHANGED_EVENT: 'auth-changed', authHeader: () => ({ Authorization: scope }) };
      if (name === '../lib/platformAds') return { platformAdsRequest: async (path: string, init: any) => {
        requests.push({ path, init });
        if (path.endsWith('/current')) return { session: recovery };
        if (path.endsWith('/cancel')) return { cancelled: true };
        if (path.endsWith('/start')) return { sessionId: 'session1', url: 'https://www.facebook.com/v26.0/dialog/oauth?state=test' };
        if (path.endsWith('/accounts') && pollResponse) return pollResponse;
        if (path.endsWith('/accounts')) return { status: 'ready', accounts: [account, { ...account, id: 'act_2', name: 'Restricted', accountStatus: 2 }, { ...account, id: 'act_3', name: 'Other account' }] };
        if (path.includes('/pages?')) return { items: singlePage ? [{ id: '10', name: 'Real brand' }] : [{ id: '10', name: 'Real brand' }, { id: '11', name: 'Other brand' }] };
        if (path.endsWith('/connect')) return { connection: { id: 'local-connection', defaultPage: { id: '10' } } };
        throw new Error(`Unexpected request ${path}`);
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  const render = () => { cursor = 0; const tree = exports.default({ configured, targetAccountId, missing: ['META_ADS_APP_SECRET'], onConnected: (c: any) => { result = c; } }); effects.splice(0).forEach(f => f()); return tree; };
  return { render, requests, deferPoll(value: Promise<any>) { pollResponse = value; }, switchUser() { scope = 'second-user'; recovery = null; listeners.get('auth-changed')?.(); }, poll: async () => timer?.(), get result() { return result; } };
}
function nodes(node: any): any[] { return Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []; }
function text(node: any): string { return Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : typeof node === 'string' ? node : ''; }
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const button = (tree: any, name: string) => nodes(tree).find(n => n.type === 'Button' && text(n) === name);
const blocked = harness(false);
const blockedTree = blocked.render();
assert.ok(!nodes(blockedTree).some(n => n.type === 'Alert' && n.props.title.includes('官方登录暂未就绪')));
assert.ok(!text(blockedTree).includes('个人账号负责授权'));
assert.ok(!text(blockedTree).includes('密码和验证码只在 Meta'));
assert.ok(!text(blockedTree).includes('绑定帮助与管理员检查'));
assert.match(text(blockedTree), /官方授权暂不可用/);
assert.ok(button(blockedTree, '登录 Facebook 并授权').props.title.includes('未配置'));
assert.equal(button(blockedTree, '登录 Facebook 并授权').props.disabled, true);
assert.equal(blocked.requests.length, 0);
assert.doesNotMatch(source, /type="password"|localStorage|sessionStorage/);
const h = harness();
let tree = h.render(); await flush(); tree = h.render();
await button(tree, '登录 Facebook 并授权').props.onClick(); await flush(); tree = h.render();
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

const ready = harness(true, { sessionId: 'restored-ready', status: 'ready', accounts: [{ id: 'act_1', name: 'Saved Meta identity', currency: 'USD', accountStatus: 1, timezoneName: 'UTC' }], expiresAt: new Date(Date.now() + 60_000).toISOString() });
let restored = ready.render(); await flush(); restored = ready.render();
await flush(); restored = ready.render();
assert.ok(text(restored).includes('选择广告展示的 Facebook 主页'), 'single eligible account is selected automatically');
assert.ok(ready.requests.some(r => r.path.includes('accountId=act_1')));
assert.ok(!ready.requests.some(r => r.path.endsWith('/start')), 'refresh reads existing server session without starting OAuth');
ready.switchUser(); restored = ready.render(); await flush(); restored = ready.render();
assert.ok(!nodes(restored).some(n => n.type === 'Select'), 'changing the signed-in user clears prior accounts');
assert.equal(ready.requests.filter(r => r.path.endsWith('/current')).length, 2);
const pending = harness(true, { sessionId: 'restored-pending', status: 'pending', accounts: [] });
let pendingTree = pending.render(); await flush(); pendingTree = pending.render();
assert.ok(!nodes(pendingTree).some(n => n.props.href), 'restored progress never persists or exposes OAuth state URL');
assert.ok(button(pendingTree, '重新开始授权'));
await pending.poll(); await flush(); pendingTree = pending.render();
assert.ok(text(pendingTree).includes('选择要连接的广告账户'));
await button(pendingTree, '取消本次连接').props.onClick(); await flush(); pendingTree = pending.render();
assert.ok(button(pendingTree, '登录 Facebook 并授权'));
assert.ok(pending.requests.some(r => r.path === '/oauth/meta/restored-pending/cancel' && r.init.method === 'POST'));
assert.ok(!pending.result, 'cancel does not save a connection');
console.log('Meta recovery: server ready/pending refresh, no persisted state URL, account isolation and cancellation passed');

const race = harness(true, { sessionId: 'cancel-race', status: 'pending', accounts: [] });
let raceTree = race.render(); await flush(); raceTree = race.render();
let resolvePoll!: (value: any) => void;
race.deferPoll(new Promise(resolve => { resolvePoll = resolve; }));
const outstanding = race.poll();
await button(raceTree, '取消本次连接').props.onClick(); await flush(); raceTree = race.render();
resolvePoll({ status: 'ready', accounts: [{ id: 'old-account' }] }); await outstanding; await flush(); raceTree = race.render();
assert.ok(button(raceTree, '登录 Facebook 并授权'), 'late successful poll cannot revive a cancelled authorization');
assert.ok(!nodes(raceTree).some(n => n.type === 'Select'));
console.log('Meta recovery: late poll cannot revive cancelled session passed');

assert.match(text(blockedTree), /官方授权暂不可用，请联系管理员恢复配置/);
assert.ok(nodes(blockedTree).some(n => n.props.role === 'status' && text(n).includes('管理员')));
const originalAccounts = [{ id: 'act_1', name: 'Original', currency: 'USD', accountStatus: 1, timezoneName: 'UTC' }, { id: 'act_2', name: 'Other', currency: 'USD', accountStatus: 1, timezoneName: 'UTC' }];
const renew = harness(true, { sessionId: 'renew-original', status: 'ready', accounts: originalAccounts }, '1');
let renewTree = renew.render(); await flush(); renewTree = renew.render(); await flush(); renewTree = renew.render();
assert.ok(renew.requests.some(r => r.path.includes('accountId=act_1')), 'reauthorization targets the original account including act_ normalization');
const absent = harness(true, { sessionId: 'renew-missing', status: 'ready', accounts: originalAccounts }, '999');
let absentTree = absent.render(); await flush(); absentTree = absent.render();
assert.match(nodes(absentTree).find(n => n.type === 'Empty').props.description, /未返回原广告账户/);
assert.equal(button(absentTree, '下一步：选择主页').props.disabled, true);
console.log('Meta journey: accessible configuration next step, correct renewal account and absent target guard passed');

const automatic = harness(true, { sessionId: 'single', status: 'ready', accounts: [{ id: 'act_1', name: 'Only account', currency: 'USD', accountStatus: 1, timezoneName: 'UTC' }] }, undefined, true);
let autoTree = automatic.render(); await flush(); autoTree = automatic.render(); await flush(); autoTree = automatic.render(); await flush(); autoTree = automatic.render();
assert.ok(text(autoTree).includes('确认要连接的账户'));
assert.ok(!automatic.requests.some(r => r.path.endsWith('/connect')), 'automatic selection does not save without confirmation');
await button(autoTree, '确认连接账户与主页').props.onClick(); await flush();
assert.deepEqual(JSON.parse(automatic.requests.find(r => r.path.endsWith('/connect'))!.init.body), { accountId: 'act_1', pageId: '10' });
