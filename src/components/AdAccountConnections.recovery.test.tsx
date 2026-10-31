import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdAccountConnections.tsx', import.meta.url), 'utf8');
const exports: any = {}, cells: any[] = [], effects: (() => void)[] = [], requests: string[] = [];
let cursor = 0;
const listeners = new Map<string, () => void>(), responders = new Map<string, () => Promise<any>>();
const documentListeners = new Map<string, () => void>();
let liveBalance = 10;
const connection = { id: 'saved', accountId: 'act_1', provider: 'meta', name: 'Original', currency: 'CNY', timezoneName: 'UTC', updatedAt: new Date().toISOString(), status: 'connected', authorization: { status: 'healthy', reasonCode: 'VERIFIED', checkedAt: new Date().toISOString() } };
const jsx = (type: any, props: any) => ({ type, props });
const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports, module: { exports }, Error,
  document: { visibilityState: 'visible', addEventListener: (name: string, fn: () => void) => documentListeners.set(name, fn), removeEventListener: (name: string) => documentListeners.delete(name) },
  window: { setInterval: () => 1, clearInterval() {}, addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) },
  require(name: string) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useContext: () => null,
      useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
      useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = initial; return [c.value, (v: any) => { c.value = typeof v === 'function' ? v(c.value) : v; }]; },
      useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((d, i) => !Object.is(d, c.deps?.[i]))) { c.deps = deps; effects.push(fn); } },
    };
    if (name === '../lib/platformAds') return { platformAdsApi: { syncResources: () => responders.get('sync')!(), listResources: () => responders.get('resources')!() }, platformAdsRequest: async (path: string) => {
      requests.push(path);
      if (responders.has(path)) return responders.get(path)!();
      if (path === '/connections') return { items: [connection], capabilities: [{ provider: 'meta', oauthConfigured: true }, { provider: 'tiktok', configured: true }] };
      if (path.endsWith('/live-status')) return { accountStatus: 1, balance: { amount: liveBalance, currency: 'CNY' }, checkedAt: new Date().toISOString() };
      if (path.endsWith('/authorization/check')) throw new Error('服务暂时无法连接');
      throw new Error(`Unexpected endpoint: ${path}`);
    } };
    if (name === '../lib/auth') return { authHeader: () => ({ Authorization: 'user' }), AUTH_TOKEN_CHANGED_EVENT: 'auth-changed' };
    if (name === 'lucide-react') return { CheckCircle2: 'CheckCircle2', Link2: 'Link2' };
    if (name === 'antd') return { Button: 'Button', Select: 'Select' };
    if (name === './SocialPlatformIcon') return { SocialPlatformIcon: 'SocialPlatformIcon' };
    if (name === '../lib/adAccountDirectoryContext') return { AdAccountDirectoryContext: {} };
    if (name.endsWith('.css')) return {};
    if (name === './AdMetaConnectionGuide' || name === './AdAuthorizationHealth') return { default: name };
    throw new Error(`Unexpected dependency: ${name}`);
  },
});
const render = () => { cursor = 0; const tree = exports.default({}); effects.splice(0).forEach(fn => fn()); return tree; };
const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const content = (node: any): string => Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : typeof node === 'string' ? node : '';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let tree = render(); await flush(); tree = render();
assert.ok(nodes(tree).some(node => node.type === 'Select' && node.props['aria-label'] === '选择已保存广告账户'));
assert.ok(nodes(tree).some(node => node.type === 'Button' && content(node) === '绑定账户'));
assert.ok(!content(tree).includes('登录 Facebook 并授权'), 'binding flow stays collapsed by default');
assert.ok(!nodes(tree).some(node => node.type === 'input'), 'regular Meta customers never paste tokens');
await nodes(tree).find(node => node.type === 'button' && content(node) === '检查连接是否可用').props.onClick(); await flush(); tree = render();
assert.match(content(tree), /本次授权检查未完成，保留上次检查结果/);
assert.match(content(tree), /账户余额¥10\.00/);
assert.match(content(tree), /账户提醒正常/);
liveBalance = 0;
documentListeners.get('visibilitychange')!(); await flush(); tree = render();
assert.match(content(tree), /账户余额¥0\.00/);
assert.match(content(tree), /账户提醒余额不足/);
liveBalance = 10;
const priorChecks = requests.filter(path => path.endsWith('/live-status')).length;
documentListeners.get('visibilitychange')!(); await flush(); tree = render();
assert.equal(requests.filter(path => path.endsWith('/live-status')).length, priorChecks + 1, 'visible account dialog refreshes status immediately');
Object.assign(connection.authorization, { expiresAt: new Date(Date.now() + 86400_000).toISOString() });
documentListeners.get('visibilitychange')!(); await flush(); tree = render();
assert.match(content(tree), /账户提醒授权即将到期/, 'a long-open dialog updates an approaching expiration');
Object.assign(connection.authorization, { expiresAt: new Date(Date.now() - 1000).toISOString() });
documentListeners.get('visibilitychange')!(); await flush(); tree = render();
assert.match(content(tree), /账户提醒授权已到期/, 'an expired grant cannot keep its earlier healthy label');
delete (connection.authorization as any).expiresAt;
assert.ok(!content(tree).includes('广告账户已连接'), 'failed manual check does not show connection success');
nodes(tree).find(node => node.type === 'button' && content(node) === '重新登录 Meta').props.onClick(); tree = render();
assert.ok(content(tree).includes('收起绑定'));
const guide = nodes(tree).find(node => node.type === './AdMetaConnectionGuide');
assert.equal(guide.props.targetAccountId, 'act_1');
assert.ok(!requests.some(path => path.endsWith('/oauth/meta/start')), 'reauthorize opens the guide without starting OAuth or execution');
console.log('Ad account journey: no Meta token input, failed check preserves timestamp, renewal targets original account passed');

async function switchUser() { listeners.get('auth-changed')!(); tree = render(); await flush(); tree = render(); }
function deferred(path: string) {
  let resolve!: (value: any) => void;
  responders.set(path, () => new Promise(done => { resolve = done; }));
  return (value: any) => { resolve(value); responders.delete(path); };
}
const oldGuide = guide;
await switchUser();
oldGuide.props.onConnected({ ...connection, name: 'Late OAuth identity' }); tree = render();
assert.ok(!content(tree).includes('Late OAuth identity'));
for (const [label, path, reply] of [
  ['更新账户名称、币种和时区', '/connections/saved/verify', { connection: { ...connection, name: 'Late verified identity' } }],
  ['同步并查看平台计划', '/connections/saved/campaigns', { items: [{ id: 'late', name: 'Late campaign identity' }] }],
] as const) {
  const complete = deferred(path);
  nodes(tree).find(node => node.type === 'button' && content(node) === label).props.onClick();
  await switchUser(); complete(reply); await flush(); tree = render();
  assert.ok(!content(tree).includes('Late verified identity'));
  assert.ok(!content(tree).includes('Late campaign identity'));
}
const completeHealth = deferred('/connections/saved/authorization/check');
nodes(tree).find(node => node.type === 'button' && content(node) === '检查连接是否可用').props.onClick();
await switchUser(); completeHealth({ connection: { ...connection, name: 'Late health identity' } }); await flush(); tree = render();
assert.ok(!content(tree).includes('Late health identity'));
const completeSync = deferred('sync');
responders.set('/connections/saved/campaigns', async () => ({ items: [] }));
let resourceReads = 0;
responders.set('resources', async () => { resourceReads++; return { items: [], hasMore: false }; });
nodes(tree).find(node => node.type === 'button' && content(node) === '同步并查看平台计划').props.onClick(); await flush();
await switchUser(); completeSync({ counts: { campaign: 1, adset: 1, ad: 1 } }); await flush(); tree = render();
assert.equal(resourceReads, 0, 'late sync must not fetch old account resources as the new user');
assert.ok(!content(tree).includes('同步完成'));
responders.set('sync', async () => ({ counts: { campaign: 0, adset: 0, ad: 0 } }));
nodes(tree).find(node => node.type === 'button' && content(node) === '同步并查看平台计划').props.onClick(); await flush(); await flush(); await flush(); tree = render();
assert.equal(resourceReads, 1);
assert.ok(content(tree).includes('平台计划'), 'single action retains campaign list and import access');
assert.match(content(tree), /要在计划管理中查看已有计划的消耗/);
await flush(); tree = render();
const completeResources = deferred('resources');
nodes(tree).find(node => node.type === 'button' && content(node) === '广告组').props.onClick();
await switchUser(); completeResources({ items: [{ id: 'late', name: 'Late resource identity' }], hasMore: false }); await flush(); tree = render();
assert.ok(!content(tree).includes('Late resource identity'));
nodes(tree).find(node => node.type === 'Button' && content(node) === '绑定账户').props.onClick(); tree = render();
for (const name of ['TikTok', 'Google Ads']) {
  const platform = nodes(tree).find(node => node.type === 'button' && content(node).includes(name));
  assert.equal(platform.props.disabled, true);
  assert.match(content(platform), /未开放/);
}
console.log('Ad account isolation: late OAuth, verify, campaign, health, sync, resource and manual connection responses discarded passed');
