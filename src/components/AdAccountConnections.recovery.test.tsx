import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdAccountConnections.tsx', import.meta.url), 'utf8');
const exports: any = {}, cells: any[] = [], effects: (() => void)[] = [], requests: string[] = [];
let cursor = 0;
const listeners = new Map<string, () => void>(), responders = new Map<string, () => Promise<any>>();
const connection = { id: 'saved', accountId: 'act_1', provider: 'meta', name: 'Original', currency: 'USD', timezoneName: 'UTC', status: 'connected', authorization: { status: 'healthy', reasonCode: 'VERIFIED', checkedAt: '2026-10-24T01:00:00.000Z' } };
const jsx = (type: any, props: any) => ({ type, props });
const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports, module: { exports }, Error,
  window: { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) },
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
      if (path.endsWith('/authorization/check')) throw new Error('服务暂时无法连接');
      throw new Error(`Unexpected endpoint: ${path}`);
    } };
    if (name === '../lib/auth') return { authHeader: () => ({ Authorization: 'user' }), AUTH_TOKEN_CHANGED_EVENT: 'auth-changed' };
    if (name === 'lucide-react') return { CheckCircle2: 'CheckCircle2', Link2: 'Link2' };
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
assert.ok(!nodes(tree).some(node => node.type === 'input'), 'regular Meta customers never paste tokens');
await nodes(tree).find(node => node.type === 'button' && content(node) === '检查授权').props.onClick(); await flush(); tree = render();
assert.match(content(tree), /本次授权检查未完成，保留上次检查结果/);
assert.equal(nodes(tree).find(node => node.type === './AdAuthorizationHealth').props.authorization.checkedAt, connection.authorization.checkedAt);
assert.ok(!content(tree).includes('广告账户已连接'), 'failed manual check does not show connection success');
nodes(tree).find(node => node.type === 'button' && content(node) === '重新授权').props.onClick(); tree = render();
const guide = nodes(tree).find(node => node.type === './AdMetaConnectionGuide');
assert.equal(guide.props.targetAccountId, 'act_1');
assert.equal(requests.length, 2, 'reauthorize opens the guide without starting OAuth or execution');
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
  ['重新验证', '/connections/saved/verify', { connection: { ...connection, name: 'Late verified identity' } }],
  ['实时查看计划', '/connections/saved/campaigns', { items: [{ id: 'late', name: 'Late campaign identity' }] }],
] as const) {
  const complete = deferred(path);
  nodes(tree).find(node => node.type === 'button' && content(node) === label).props.onClick();
  await switchUser(); complete(reply); await flush(); tree = render();
  assert.ok(!content(tree).includes('Late verified identity'));
  assert.ok(!content(tree).includes('Late campaign identity'));
}
const completeHealth = deferred('/connections/saved/authorization/check');
nodes(tree).find(node => node.type === 'button' && content(node) === '检查授权').props.onClick();
await switchUser(); completeHealth({ connection: { ...connection, name: 'Late health identity' } }); await flush(); tree = render();
assert.ok(!content(tree).includes('Late health identity'));
const completeSync = deferred('sync');
let resourceReads = 0;
responders.set('resources', async () => { resourceReads++; return { items: [], hasMore: false }; });
nodes(tree).find(node => node.type === 'button' && content(node) === '同步账户结构').props.onClick();
await switchUser(); completeSync({ counts: { campaign: 1, adset: 1, ad: 1 } }); await flush(); tree = render();
assert.equal(resourceReads, 0, 'late sync must not fetch old account resources as the new user');
assert.ok(!content(tree).includes('同步完成'));
responders.set('sync', async () => ({ counts: { campaign: 0, adset: 0, ad: 0 } }));
nodes(tree).find(node => node.type === 'button' && content(node) === '同步账户结构').props.onClick(); await flush(); await flush(); tree = render();
assert.equal(resourceReads, 1);
const completeResources = deferred('resources');
nodes(tree).find(node => node.type === 'button' && content(node) === '广告组').props.onClick();
await switchUser(); completeResources({ items: [{ id: 'late', name: 'Late resource identity' }], hasMore: false }); await flush(); tree = render();
assert.ok(!content(tree).includes('Late resource identity'));
// Manual token entry is isolated to the existing non-Meta adapter; a late success must also be discarded.
nodes(tree).find(node => node.type === 'button' && content(node).includes('TikTok')).props.onClick(); tree = render();
for (const input of nodes(tree).filter(node => node.type === 'input')) input.props.onChange({ target: { value: input.props.type === 'password' ? 'test-token' : '1234' } });
tree = render();
const completeConnect = deferred('/connections');
nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
responders.delete('/connections'); await switchUser();
completeConnect({ connection: { ...connection, provider: 'tiktok', name: 'Late manual identity' } }); await flush(); tree = render();
assert.ok(!content(tree).includes('Late manual identity'));
console.log('Ad account isolation: late OAuth, verify, campaign, health, sync, resource and manual connection responses discarded passed');
