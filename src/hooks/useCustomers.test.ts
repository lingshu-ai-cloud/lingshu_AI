import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function harness(respond: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>) {
  const cells: Array<{ value?: any; deps?: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0;
  const effects: Array<() => void> = [], intervals: Array<() => void> = [];
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useCustomers.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, module: { exports }, AbortController, fetch: respond,
    localStorage: { removeItem() {} }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {}, setInterval(fn: () => void) { intervals.push(fn); return intervals.length; }, clearInterval() {} },
    require(name: string) {
      if (name === 'react') return {
        useState(initial: unknown) { const at = cursor++; const cell = cells[at] ||= { value: typeof initial === 'function' ? (initial as () => unknown)() : initial }; return [cell.value, (value: unknown) => { cell.value = typeof value === 'function' ? (value as (old: unknown) => unknown)(cell.value) : value; }]; },
        useCallback(fn: unknown) { return fn; },
        useEffect(fn: () => (() => void) | undefined, deps: unknown[]) { const cell = cells[cursor++] ||= {}; if (!cell.deps || deps.some((v, i) => v !== cell.deps![i])) { cell.deps = deps; effects.push(() => { cell.cleanup?.(); cell.cleanup = fn(); }); } },
      };
      if (name.endsWith('/auth')) return { authHeader: () => ({ Authorization: 'Bearer isolated-test' }) };
      if (name.includes('foreignTradeOperations')) return { isLocalForeignTradeMockEnabled: () => false };
      if (name.includes('localCustomerProfile')) return { restoreLocalCustomerPatch: (value: unknown) => value };
      if (name.includes('localCustomerSimulation')) return { readLocalCustomerDrafts: async () => [] };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  return {
    render() { cursor = 0; const state = exports.useCustomers(); effects.splice(0).forEach(fn => fn()); return state; },
    poll() { intervals.at(-1)?.(); },
    dispose() { cells.forEach(cell => cell.cleanup?.()); },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const reply = (items: unknown, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => items });

test('HTTP rejection is an explicit customer read error, never a successful empty list', async () => {
  const h = harness(() => reply({}, 403)); h.render(); await flush();
  assert.match(h.render().error, /403/); assert.equal(h.render().loading, false); h.dispose();
});
test('malformed customer data is distinct from a verified empty list', async () => {
  const h = harness(() => reply({})); h.render(); await flush(); assert.match(h.render().error, /格式异常/); h.dispose();
  const empty = harness(() => reply({ items: [] })); empty.render(); await flush(); assert.equal(empty.render().error, ''); assert.equal(empty.render().customers.length, 0); empty.dispose();
});
test('a failed poll preserves the last confirmed customers and a successful retry clears the error', async () => {
  let status = 200;
  const customer = { id: 'real-customer', intentSignals: [], orders: [], tags: [], timeline: [] };
  const h = harness(() => reply({ items: [customer] }, status)); h.render(); await flush(); assert.equal(h.render().customers[0].id, customer.id);
  status = 503; h.poll(); await flush(); assert.equal(h.render().customers[0].id, customer.id); assert.match(h.render().error, /503/);
  status = 200; h.poll(); await flush(); assert.equal(h.render().error, ''); h.dispose();
});
