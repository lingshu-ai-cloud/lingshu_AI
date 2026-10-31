import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('./AdAccountSpendSummary.tsx', import.meta.url), 'utf8');
const exports: any = {}, cells: any[] = [], effects: (() => void)[] = [];
let cursor = 0, resolveOld!: (v: any) => void, identity = 'scope', changed: () => void = () => {};
const pending = new Promise(resolve => { resolveOld = resolve; });
const jsx = (type: any, props: any) => ({ type, props });
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
 exports, AbortController, window: { addEventListener(_name: string, fn: () => void) { changed = fn; }, removeEventListener() {} },
 require(name: string) {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react') return {
   useState(v: any) { const c = cells[cursor++] ?? (cells[cursor - 1] = {}); if (!('value' in c)) c.value = v; return [c.value, (next: any) => { c.value = next; }]; },
   useEffect(fn: any, deps: any[]) { const c = cells[cursor++] ?? (cells[cursor - 1] = {}); if (!c.deps || deps.some((v, i) => !Object.is(v, c.deps[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
  };
  if (name === '../lib/auth') return { authHeader: () => ({ Authorization: identity }), AUTH_TOKEN_CHANGED_EVENT: 'auth-change' };
  if (name.includes('adReportPeriod')) return { adReportPeriodQuery: (period: number | string) => typeof period === 'string' ? `date=${period}` : `days=${period}` };
  if (name === '../lib/platformAds') return { platformAdsRequest: (path: string) => path.includes('/one/') ? pending : Promise.resolve({ accountId: 'two', currency: 'CNY', timezone: 'Asia/Shanghai', reportedAt: '2026-10-30T04:00:00Z', totals: { spend: 10 }, window: { since: '2026-10-24', until: '2026-10-30' } }) };
  throw Error(name);
 }
});
const render = (id: string) => { cursor = 0; const tree = exports.default({ account: { connectionId: id, accountId: id, name: id, currency: 'CNY', provider: 'meta' }, refresh: 0 }); effects.splice(0).forEach(fn => fn()); return tree; };
const text = (v: any): string => Array.isArray(v) ? v.map(text).join('') : v?.props ? text(v.props.children) : v == null ? '' : String(v);
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
render('one'); render('two'); await flush();
assert.match(text(render('two')), /CNY 10/);
assert.match(text(render('two')), /账户时区 Asia\/Shanghai/);
assert.match(text(render('two')), /读取于/);
resolveOld({ accountId: 'one', currency: 'CNY', totals: { spend: 999 }, window: { since: '2026-10-24', until: '2026-10-30' } }); await flush();
assert.doesNotMatch(text(render('two')), /999/, 'late result cannot leak into another account');
identity = ''; changed();
assert.doesNotMatch(text(render('two')), /CNY 10/, 'logout clears the previous identity’s account spend');
console.log('Account summary shows provider account totals and isolates account changes');
