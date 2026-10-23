import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { studioApi, type Material } from '../../lib/studioApi';
import type { StateSetter } from './inspirationDashboardContracts';
import { useInspirationAnalysis } from './useInspirationAnalysis';
import { useInspirationMaterials } from './useInspirationMaterials';

function capture<T>(hook: () => T): T {
  let result: T;
  renderToStaticMarkup(createElement(() => { result = hook(); return null; }));
  return result!;
}

function cell<T>(initial: T) {
  let current = initial;
  const set: StateSetter<T> = next => { current = typeof next === 'function' ? (next as (value: T) => T)(current) : next; };
  return { set, read: () => current };
}

const video = (id = 'one'): TrendVideo => ({
  id: `crawl-${id}`, recordId: id, title: id, platform: 'tiktok', thumbnail: '',
  duration: 30, tags: [], views: '100', trend: 'stable', status: 'analyzed',
  crawledAt: '2026-10-23', contentFormat: 'video', sourceUrl: `https://example.test/${id}`,
  aiAnalysis: { analysisMode: 'strategy', caption: 'keep this evidence', requestedAnalysisMode: 'exact' },
});

function browser(t: TestContext) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const events: string[] = [];
  const schedule = () => 0 as unknown as ReturnType<typeof setTimeout>;
  t.mock.method(globalThis, 'setTimeout', schedule);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { search: '', href: 'https://example.test/?view=library' }, history: { state: {} },
    setTimeout: schedule, dispatchEvent: (event: Event) => { events.push(event.type); return true; },
  } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  return events;
}

function analysis(initial = video()) {
  const rows = cell([initial, video('other')]);
  const selected = cell<TrendVideo | null>(initial);
  const watch = cell<TrendVideo | null>(initial);
  const message = cell('');
  const refreshes: unknown[][] = [];
  const actions = capture(() => useInspirationAnalysis({
    setCrawledVideos: rows.set, setSelectedVideo: selected.set, setWatchVideo: watch.set,
    setMaterialMessage: message.set, videoPage: 3,
    refreshVideos: async (...args) => { refreshes.push(args); },
  }));
  return { actions, rows, selected, watch, message, refreshes };
}

test('exact completion updates the shared selected record while retaining evidence and other records', async t => {
  browser(t);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ status: 'analyzed', reused: true }));
  });
  const state = analysis();
  await state.actions.requestExactFullAnalysis(video(), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/overseas/videos/one/reanalyze');
  assert.equal(requests[0].init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { analysisMode: 'exact', force: true });
  assert.equal(state.rows.read()[0].aiAnalysis?.analysisMode, 'exact');
  assert.equal(state.selected.read()?.aiAnalysis?.caption, 'keep this evidence');
  assert.equal(state.selected.read()?.aiAnalysis?.requestedAnalysisMode, undefined);
  assert.equal(state.rows.read()[1].recordId, 'other');
  assert.deepEqual(state.refreshes, []);
});

test('failed exact submission retains existing analysis and does not resubmit', async t => {
  browser(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: 'budget denied' }), { status: 403 }); });
  const initial = video();
  initial.aiAnalysis = { ...initial.aiAnalysis, gemini: {} as NonNullable<TrendVideo['aiAnalysis']>['gemini'] };
  const state = analysis(initial);
  await state.actions.requestExactFullAnalysis(initial);
  assert.equal(calls, 1);
  assert.equal(state.selected.read()?.status, 'analyzed');
  assert.equal(state.selected.read()?.aiAnalysis?.caption, 'keep this evidence');
  assert.equal(state.selected.read()?.aiAnalysis?.analysisError, 'budget denied');
  assert.deepEqual(state.refreshes, []);
});

test('missing record and material identity cannot submit exact analysis', async t => {
  browser(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected request'); });
  const initial = { ...video(), id: 'unpersisted', recordId: undefined };
  const state = analysis(initial);
  await state.actions.requestExactFullAnalysis(initial);
  assert.match(state.message.read(), /缺少/);
});

test('pause invokes only the original pause endpoint and preserves prior analysis', async t => {
  browser(t);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => { requests.push(String(input)); return new Response('{}'); });
  const initial = video();
  const state = analysis(initial);
  await state.actions.cancelExactFullAnalysis(initial);
  assert.deepEqual(requests, ['/api/overseas/videos/one/analysis-pause']);
  assert.equal(state.selected.read()?.aiAnalysis?.geminiStatus, 'paused');
  assert.equal(state.selected.read()?.aiAnalysis?.requestedAnalysisMode, undefined);
  assert.equal(state.selected.read()?.aiAnalysis?.caption, 'keep this evidence');
  assert.deepEqual(state.refreshes, []);
});

test('image evidence reanalysis updates list, selected detail and preview consistently', async t => {
  browser(t);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => { requests.push(String(input)); return new Response(JSON.stringify({ analysis: { status: 'analyzed', summary: 'verified' } })); });
  const initial = { ...video(), contentFormat: 'image' as const };
  const state = analysis(initial);
  await state.actions.reanalyzeImagePost(initial);
  assert.deepEqual(requests, ['/api/overseas/videos/one/reanalyze-image']);
  for (const item of [state.rows.read()[0], state.selected.read(), state.watch.read()]) {
    assert.equal(item?.aiAnalysis?.imageEvidence?.status, 'analyzed');
    assert.equal(item?.aiAnalysis?.caption, 'keep this evidence');
  }
  assert.deepEqual(state.refreshes, [[3, true]]);
});

test('rejected image reanalysis cannot manufacture success or retry provider work', async t => {
  browser(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ error: 'not approved' }), { status: 409 }); });
  const state = analysis();
  await state.actions.reanalyzeImagePost(video());
  assert.equal(calls, 1);
  assert.equal(state.selected.read()?.aiAnalysis?.imageEvidence, undefined);
  assert.equal(state.message.read(), 'not approved');
  assert.deepEqual(state.refreshes, [[3, true]]);
});

test('material upload preserves product ownership before inventory refresh and notifies consumers once', async t => {
  const events = browser(t);
  const order: string[] = [];
  const saved = { id: 'material-1', name: 'product.png', type: 'image', tags: '' } as Material;
  t.mock.method(studioApi, 'uploadMaterialFile', async () => { order.push('upload'); return { ok: true, material: saved }; });
  t.mock.method(studioApi, 'updateMaterial', async (_id: string, patch: Parameters<typeof studioApi.updateMaterial>[1]) => {
    order.push('ownership');
    assert.equal(patch.productId, 'product-1');
    assert.equal(patch.enterpriseCommon, false);
    return { ok: true, material: saved };
  });
  t.mock.method(studioApi, 'listMaterialLibrary', async () => {
    order.push('inventory');
    return { status: 'ready', sources: [], items: [saved], total: 1 };
  });
  const state = capture(() => useInspirationMaterials({
    materialEntry: { openLibrary: true, productId: 'product-1', productRef: 'Product' }, innerView: 'library',
    setInnerView: () => undefined, favoritingMaterialIds: [], setFavoritingMaterialIds: () => undefined, setMaterialMessage: () => undefined,
  }));
  await state.handleUploadMaterials([new File(['image'], 'product.png', { type: 'image/png' })] as unknown as FileList);
  assert.deepEqual(order, ['upload', 'ownership', 'inventory']);
  assert.deepEqual(events, ['lingshu:materials-updated']);
});
