import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { CONNECTION_LABELS, CONNECTION_PLATFORMS } from '../../../shared/assistantAccountConnection';
// Exercise the actual component handlers with an inert OAuth transport; no provider is contacted.
const exports: any = {}, cells: any[] = [], effects: Array<() => void> = [], listeners = new Map<string, (event?: any) => void>();
let cursor = 0, token = 'tenant-a', starts = 0, navigated = '', accounts: any[] = [];
let configured = true;
const popup = { closed: false }, jsx = (type: any, props: any) => ({ type, props });
const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./AssistantAccountConnection.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, module: { exports }, AbortController, Error, Promise,
  window: { location: { origin: 'http://local', pathname: '/', search: '?page=strategy' },
    addEventListener: (key: string, fn: any) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key), setInterval: () => 1, clearInterval: () => {} },
  fetch: async (url: string, init?: any) => {
    if (url.endsWith('/start')) { starts++; assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'tenant-a'); assert.deepEqual(JSON.parse(init.body), {returnTo:'/?page=strategy'}); return { url: 'https://official.test/authorize' }; }
    return { ok: true, json: async () => url.endsWith('/status') ? { configured } : { items: accounts } };
  },
  require(name: string) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = typeof initial === 'function' ? initial() : initial; return [c.value, (value: any) => { c.value = typeof value === 'function' ? value(c.value) : value; }]; },
      useRef(initial: any) { const c = cell(); return c.value ?? (c.value = {current:initial}); },
      useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((d, i) => !Object.is(d, c.deps[i]))) { c.cleanup?.(); c.deps = deps; effects.push(() => {c.cleanup = fn();}); } },
    };
    if (name === 'antd') return { Button: 'button', Select: 'select' };
    if (name.includes('assistantAccountConnection')) return { CONNECTION_LABELS, CONNECTION_PLATFORMS };
    if (name.includes('/auth')) return { authHeader: () => ({Authorization:token}), getToken: () => token, AUTH_TOKEN_CHANGED_EVENT:'auth' };
    if (name.includes('oauthPopup')) return { prepareOAuthPopup: () => popup, closeOAuthPopup: () => {}, readOAuthStartResponse: async (r: any) => r, navigateOAuthPopup: (_p: any, url: string) => {navigated=url;} };
    throw Error(name);
  },
});
const render = () => { cursor=0; const tree=exports.default({platform:'tiktok'}); effects.splice(0).forEach(fn => fn()); return tree; };
const nodes = (n: any): any[] => Array.isArray(n) ? n.flatMap(nodes) : n?.props ? [n,...nodes(n.props.children)] : [];
const text = (n: any): string => Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : typeof n === 'string' ? n : '';
const settle = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
let tree=render(); await settle(); tree=render();
assert.equal(starts,0,'rendering never starts OAuth');
const connect = () => nodes(tree).find(n=>n.type==='button'&&text(n).includes('连接并授权'));
assert.equal(connect().props.disabled,false);
await connect().props.onClick(); await settle(); tree=render();
assert.equal(starts,1); assert.equal(navigated,'https://official.test/authorize');
listeners.get('message')?.({origin:'http://evil',source:popup,data:{source:'overseas-workbench',type:'social-oauth',platform:'tiktok',status:'success'}});
assert.equal(text(render()).includes('已连接'),false,'message is never evidence');
accounts=[{id:'verified',title:'Verified account',status:'connected'}];
listeners.get('message')?.({origin:'http://local',source:popup,data:{source:'overseas-workbench',type:'social-oauth',platform:'tiktok',status:'success'}});
tree=render(); await settle(); tree=render();
assert.match(text(tree),/Verified account · 已连接/,'only server records confirm identity');
token='tenant-b'; listeners.get('auth')?.(); tree=render();
assert.match(text(tree),/会话已变更/); assert.ok(!text(tree).includes('Verified account'));
console.log('Conversational OAuth: explicit start, verified callback refresh, origin and tenant isolation passed');
