import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdAccountStatusBanner.tsx', import.meta.url), 'utf8');
const exports: any = {}, cells: any[] = [], effects: (() => void)[] = [];
let cursor = 0, scope = 'user-one', onChange: (() => void) | undefined;
let onVisible: (() => void) | undefined, statusCalls = 0;
let resolveStatus!: (v: any) => void;
let response = Promise.resolve({ accountStatus: 9 });
const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
const jsx = (type: any, props: any) => ({ type, props });
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
 exports, AbortController, document: { visibilityState: 'visible', addEventListener(_n: string, fn: () => void) { onVisible = fn; }, removeEventListener() {} },
 window: { addEventListener(_n: string, fn: () => void) { onChange = fn; }, removeEventListener() {}, setInterval: () => 1, clearInterval() {} },
 require(name: string) {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react') return {
   useState(v: any) { const c = cell(); if (!('value' in c)) c.value = v; return [c.value, (next: any) => { c.value = typeof next === 'function' ? next(c.value) : next; }]; },
   useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((v, i) => !Object.is(v, c.deps[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
  };
  if (name === 'antd') return { Alert: 'Alert' };
  if (name === '../lib/auth') return { authHeader: () => ({ Authorization: scope }), AUTH_TOKEN_CHANGED_EVENT: 'auth-change' };
  if (name === '../lib/platformAds') return { platformAdsRequest: (path: string) => { if (path === '/connections') return Promise.resolve({ items: [] }); statusCalls++; return response; } };
  throw Error(name);
 }
});
const account = { provider: 'meta', localConnectionId: 'conn', accountId: '123', name: '测试账户' };
const render = () => { cursor = 0; const tree = exports.default({ accounts: [account] }); effects.splice(0).forEach(fn => fn()); return tree; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
assert.equal(render(), null); await flush(); let tree = render();
assert.equal(tree.props.title, '测试账户：账户或授权需要处理，广告可能无法投放');
assert.equal(tree.props.action, undefined, 'the banner does not duplicate the page-level account entry');
const beforeVisibility = statusCalls; onVisible!(); await flush(); tree = render();
assert.equal(statusCalls, beforeVisibility + 1, 'returning to the page refreshes status immediately');
assert.equal(tree.props.title, '测试账户：账户或授权需要处理，广告可能无法投放');
response = new Promise(resolve => { resolveStatus = resolve; });
scope = 'user-two'; onChange!(); tree = render(); assert.equal(tree, null);
const resolveOld = resolveStatus; response = new Promise(() => {});
scope = 'user-three'; onChange!(); tree = render(); resolveOld({ accountStatus: 9 }); await flush(); tree = render();
assert.equal(tree, null, 'old user status cannot appear for a new identity');
console.log('Account status banner shows restrictions and isolates late responses');
