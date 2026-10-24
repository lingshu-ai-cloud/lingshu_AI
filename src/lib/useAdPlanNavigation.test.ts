import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
type Cell = { value?: any; deps?: any[]; cleanup?: () => void };
function harness(initialUrl: string, getTask: (id: string) => Promise<any>, listTasks = async (): Promise<any[]> => []) {
  const cells: Cell[] = [], effects: (() => void)[] = [], listeners = new Map<string, () => void>();
  let cursor = 0, identity = 'current-user';
  const location = { href: initialUrl }, exports: any = {};
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useAdPlanNavigation.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, module: { exports }, URL, Error,
    window: { location, history: { state: { productionPage: 'adsPlans' }, replaceState(_state: any, _title: string, url: URL) { location.href = String(url); } }, addEventListener: (key: string, fn: () => void) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key) },
    require(name: string) {
      if (name === './auth') return { AUTH_TOKEN_CHANGED_EVENT: 'auth-changed', authHeader: () => ({ Authorization: identity }) };
      if (name === './platformAds') return { platformAdsApi: { getTask, listTasks } };
      if (name === 'react') return {
        useState(initial: any) { const c = cell(); if (!('value' in c)) c.value = initial; return [c.value, (value: any) => { c.value = typeof value === 'function' ? value(c.value) : value; }]; },
        useRef(initial: any) { const c = cell(); return c.value ?? (c.value = { current: initial }); },
        useEffect(fn: any, deps: any[]) { const c = cell(); if (!c.deps || deps.some((value, i) => !Object.is(value, c.deps?.[i]))) { c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = fn(); }); } },
      };
      throw Error(`Unexpected dependency ${name}`);
    },
  });
  return {
    render(list = false, currentIdentity = identity) { cursor = 0; const result = list ? exports.useAdPlanTasks(currentIdentity) : exports.useAdPlanNavigation(); effects.splice(0).forEach(fn => fn()); return result; },
    switchUser() { identity = 'new-user'; listeners.get('auth-changed')?.(); },
    pop(url: string) { location.href = url; listeners.get('popstate')?.(); },
    get url() { return location.href; },
  };
}
const flush = async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); };
test('the actual shared App navigation preserves explicit adsTaskId across all three workspaces', () => {
  const location = { href: 'http://localhost/?page=adsPlans&adsTaskId=selected-plan' };
  const exports: any = {}, history = { state: {} as any, pushState(state: any, _title: string, url: URL) { history.state = state; location.href = String(url); } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./productionNavigation.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, module: { exports }, URL, window: { location, history }, require: () => ({ getToken: () => 'test-identity' }),
  });
  for (const page of ['adsOverview', 'adsCreatives', 'adsPlans']) {
    exports.pushProductionLocation(page);
    assert.equal(new URL(location.href).searchParams.get('page'), page);
    assert.equal(new URL(location.href).searchParams.get('adsTaskId'), 'selected-plan');
  }
});
test('explicit plan URL restores under current auth after refresh and survives workspace navigation', async () => {
  const calls: string[] = [];
  const h = harness('http://localhost/?page=adsPlans&adsTaskId=old-plan', async id => { calls.push(id); return { id, name: 'Verified' }; });
  let state = h.render(); await flush(); state = h.render();
  assert.equal(state.task.id, 'old-plan'); assert.deepEqual(calls, ['old-plan']);
  state.select('selected-plan'); h.render(); await flush(); state = h.render();
  assert.equal(new URL(h.url).searchParams.get('adsTaskId'), 'selected-plan');
  const nextUrl = new URL(h.url); nextUrl.searchParams.set('page', 'adsOverview');
  const refreshed = harness(nextUrl.href, async id => ({ id })); refreshed.render(); await flush();
  assert.equal(refreshed.render().task.id, 'selected-plan');
  h.pop('http://localhost/?page=adsPlans'); h.render(); await flush();
  assert.equal(h.render().task, null, 'browser back to unselected history clears newer plan');
});
test('missing or unauthorized plan remains an explicit error, with retry retaining the requested ID', async () => {
  let failed = true;
  const h = harness('http://localhost/?page=adsOverview&adsTaskId=protected', async id => { if (failed) throw Error('计划不存在或无权访问'); return { id }; });
  h.render(); await flush(); let state = h.render();
  assert.equal(state.task, null); assert.equal(state.taskId, 'protected'); assert.match(state.error, /无权访问/);
  failed = false; state.retry(); h.render(); await flush(); state = h.render();
  assert.equal(state.task.id, 'protected'); assert.equal(state.error, '');
});
test('account change clears URL and rejects a late successful plan read', async () => {
  let resolve!: (value: any) => void;
  const h = harness('http://localhost/?page=adsPlans&adsTaskId=old-owner', () => new Promise(done => { resolve = done; }));
  h.render(); h.switchUser(); h.render(); resolve({ id: 'old-owner' }); await flush();
  const state = h.render(); assert.equal(state.task, null); assert.equal(state.taskId, '');
  assert.ok(!new URL(h.url).searchParams.has('adsTaskId'));
});
test('task list failure retains verified snapshot and never manufactures an empty successful list', async () => {
  let failed = false;
  const h = harness('http://localhost/', async id => ({ id }), async () => { if (failed) throw Error('offline'); return [{ id: 'saved' }]; });
  h.render(true); await flush(); let state = h.render(true); assert.equal(state.items[0].id, 'saved');
  failed = true; state.retry(); h.render(true); await flush(); state = h.render(true);
  assert.equal(state.items[0].id, 'saved'); assert.match(state.error, /读取失败/); assert.equal(state.loading, false);
  const cold = harness('http://localhost/', async () => null, async () => { throw Error('offline'); });
  cold.render(true); await flush(); const coldState = cold.render(true);
  assert.equal(coldState.items, null); assert.match(coldState.error, /不能据此判断没有计划/);
});
test('list success from a previous identity cannot overwrite the new identity snapshot', async () => {
  let resolve!: (value: any[]) => void;
  const h = harness('http://localhost/', async () => null, () => new Promise(done => { resolve = done; }));
  h.render(true, 'current-user'); h.switchUser(); resolve([{ id: 'old-owner' }]); await flush();
  assert.equal(h.render(true, 'new-user').items, null);
});
