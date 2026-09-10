import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the component's real loader and effect with controlled network completion
// and timers, including responses from servers that ignore client cancellation.
const source = fs.readFileSync('src/components/publishing/CalendarPlanner.tsx', 'utf8');
const start = source.indexOf('  const load = async (silent = false) => {');
const end = source.indexOf('\n  const itemsByDay', start);
const script = ts.transpileModule(source.slice(start, end) + '\nglobalThis.load = load;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness() {
  const state = { error: '', items: [] as any[], loading: false, scores: {} };
  const requests: Array<{ url: string; signal: AbortSignal; resolve: (value: any) => void; reject: (error: Error) => void }> = [];
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  let serial = 0;
  let effect: () => () => void;
  const context: any = {
    AbortController, range: { from: new Date(), to: new Date() }, mode: 'week', refreshKey: 0,
    calendarRequestRef: { current: null }, selectedPlatform: 'tiktok', utcOffset: 0,
    iso: (date: Date) => date.toISOString(), calendarErrorMessage: (error: Error) => error.message,
    setError: (value: string) => { state.error = value; },
    setItems: (value: any[]) => { state.items = value; },
    setLoading: (value: boolean) => { state.loading = value; },
    setScores: (value: any) => { state.scores = value; }, setScoreSource: () => {},
    useEffect: (value: typeof effect) => { effect = value; },
    document: { visibilityState: 'visible' },
    window: {
      setTimeout: (fn: () => void) => { timers.set(++serial, fn); return serial; },
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: () => ++serial, clearInterval: () => {},
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    api: (url: string, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
      requests.push({ url, signal, resolve, reject });
    }),
  };
  vm.createContext(context); vm.runInContext(script, context);
  const complete = (batch: typeof requests, id = 'current') => batch.forEach(request => request.resolve(
    request.url.includes('/calendar?') ? { items: [{ id }] } : { weekday: 0, scores: [1] },
  ));
  const abort = (batch: typeof requests) => batch.forEach(request => request.reject(new DOMException('Cancelled', 'AbortError')));
  return { state, requests, timers, listeners, context, complete, abort, mount: () => effect!(), load: (silent = false) => context.load(silent) };
}
{
  const h = harness(); const old = h.load(); const first = h.requests.slice();
  const current = h.load(); h.abort(first); h.complete(h.requests.slice(8));
  await Promise.all([old, current]);
  assert.equal(h.state.error, '', 'superseded requests must not report timeouts');
  assert.equal(h.state.items[0].id, 'current');
}
{
  const h = harness(); const old = h.load(); const first = h.requests.slice();
  const current = h.load(); h.complete(h.requests.slice(8)); await current;
  h.complete(first, 'obsolete'); await old;
  assert.equal(h.state.items[0].id, 'current', 'late responses cannot overwrite the new period');
}
{
  const h = harness(); const request = h.load();
  for (const timer of h.timers.values()) timer(); h.abort(h.requests); await request;
  assert.equal(h.state.error, '日历读取超时，请稍后重试', 'a real deadline must still be reported');
  const retry = h.load(true); h.complete(h.requests.slice(8)); await retry;
  assert.equal(h.state.error, '', 'successful automatic recovery must clear the old error');
}
{
  const h = harness(); const request = h.load();
  h.requests[0].resolve({ items: [{ id: 'real-post' }] });
  h.requests.slice(1).forEach(row => row.reject(new Error('recommendations unavailable')));
  await request;
  assert.equal(h.state.items[0].id, 'real-post', 'optional recommendations cannot hide real posts');
  assert.equal(h.state.error, '');
}
{
  const h = harness(); const cleanup = h.mount(); const first = h.requests.slice();
  cleanup(); assert.equal(h.listeners.size, 0); assert.equal(first[0].signal.aborted, true);
  h.abort(first); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.error, '', 'unmount must not commit an error');
  const cleanupAgain = h.mount();
  h.listeners.get('lingshu:agent-business-refresh')!();
  assert.equal(h.requests.length, 24, 'monitor refresh must issue a fresh set of calendar requests');
  h.abort(h.requests.slice(8, 16)); h.complete(h.requests.slice(16));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.error, ''); cleanupAgain();
}
console.log('Calendar loading regression tests passed');
