import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioApi, type RenderSpec, type StudioRenderJob, type DesktopRenderBridge } from '../../lib/studioApi';
import { createStudioRenderActions, useStudioRenderSession, type StudioRenderRequest } from './studioRenderSession';

function fixture() {
  let initial!: ReturnType<typeof useStudioRenderSession>;
  function Probe() { initial = useStudioRenderSession(); return null; }
  renderToStaticMarkup(createElement(Probe));
  const state = { ...initial, renderToken: { current: 0 }, renderPreviewUrlsRef: { current: {} as Record<string, string> } };
  for (const key of Object.keys(initial).filter(key => key.startsWith('set'))) {
    const valueKey = key.slice(3, 4).toLowerCase() + key.slice(4);
    Object.assign(state, { [key]: (update: unknown) => {
      const target = state as unknown as Record<string, unknown>;
      target[valueKey] = typeof update === 'function' ? update(target[valueKey]) : update;
    } });
  }
  const notices: string[] = [], covers: Array<string | null> = [];
  const spec: RenderSpec = { materials: ['clip'], script: 'fixture', voice: 'fixture', bgm: '', bgmVol: 0,
    voiceVol: 100, coverId: '', coverTitle: '', ratio: '9:16', duration: 4, platform: 'tiktok', language: 'en' };
  const request: StudioRenderRequest = { freeThreeStep: true, productionSignature: 'production', cover: null,
    resolveProjectId: () => 'project', defaultOutputKey: language => 'plan-' + language,
    prepareSpec: () => ({ spec, outputLanguage: 'en' }), onCover: url => covers.push(url), onNotice: message => notices.push(message) };
  return { state, request, spec, notices, covers, actions: createStudioRenderActions(state) };
}
const job = (overrides: Partial<StudioRenderJob> = {}): StudioRenderJob => ({ id: 'job', projectId: 'project', outputKey: 'plan-en',
  attempts: 1, inputSignature: 'input', status: 'completed', progress: 100, outputPath: '/fixture.mp4', previewUrl: '/preview',
  createdAt: '2026-10-23T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z', ...overrides });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test.beforeEach(t => {
  if (!('mock' in t)) throw Error('Requires per-test context');
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected real network'); });
  t.after(() => assert.equal(fetch.mock.callCount(), 0));
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = new Map<number, () => void>();
  let timerId = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearInterval: (id: number) => timers.delete(id),
  } });
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); });
  Object.assign(t, { timers });
});
const timersFor = (t: unknown) => (t as { timers: Map<number, () => void> }).timers;

function desktop(bridge: Partial<DesktopRenderBridge> = {}) {
  window.desktopRender = { available: true, onProgress: () => () => {}, render: async () => ({ ok: true, outputPath: '/desktop.mp4' }), ...bridge };
}
function authorize(t: TestContext) {
  return t.mock.method(studioApi, 'render', async () => ({ manifest: {} as Awaited<ReturnType<typeof studioApi.render>>['manifest'], token: 'fixture-token' }));
}

test('initial owner state does not request a service or expose its token and preview cache', () => {
  let owner!: ReturnType<typeof useStudioRenderSession>;
  function Probe() { owner = useStudioRenderSession(); return null; }
  renderToStaticMarkup(createElement(Probe));
  assert.equal(owner.rendering, false); assert.equal(owner.renderPct, 0);
  assert.equal('renderToken' in owner, false); assert.equal('renderPreviewUrlsRef' in owner, false);
});

test('durable rendering submits the full spec once, skips short-lived authorization and records the exact signature', async t => {
  const f = fixture();
  const auth = t.mock.method(studioApi, 'render', async () => { throw Error('unexpected authorization'); });
  const create = t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: true, job: job() }));
  const path = await f.actions.render({ ...f.request, outputKey: 'chosen', inputSignature: 'frozen' });
  assert.equal(path, '/fixture.mp4'); assert.equal(auth.mock.callCount(), 0);
  assert.deepEqual(create.mock.calls[0]?.arguments[0], { projectId: 'project', outputKey: 'chosen', inputSignature: 'frozen', spec: f.spec });
  assert.equal(f.state.renderOutputPreviewUrl, '/preview'); assert.equal(f.state.renderPct, 100);
  assert.deepEqual(f.state.renderProductionSignatures, { '/fixture.mp4': 'frozen' });
});

test('durable polling retains progress, uses the project identity and completes the same request', async t => {
  const f = fixture();
  t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: true, job: job({ status: 'processing', progress: 24 }) }));
  const latest = t.mock.method(studioApi, 'latestRenderJob', async () => ({ ok: true, job: job() }));
  const pending = f.actions.render(f.request);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.state.renderPct, 24);
  [...timersFor(t).values()][0]!();
  assert.equal(await pending, '/fixture.mp4'); assert.deepEqual(latest.mock.calls[0]?.arguments, ['project']);
});

test('a newer render prevents an old cover response from submitting or overwriting the active result', async t => {
  const f = fixture(), cover = deferred<Awaited<ReturnType<typeof studioApi.cover>>>();
  t.mock.method(studioApi, 'cover', () => cover.promise);
  const create = t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: true, job: job() }));
  const first = f.actions.render({ ...f.request, cover: { title: '', ratio: '9:16', accent: '#16a34a' } });
  assert.equal(await f.actions.render(f.request), '/fixture.mp4');
  cover.resolve({ ok: true, url: '/old-cover' });
  assert.equal(await first, undefined); assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(f.covers, [null]); assert.equal(f.state.rendered, true);
});

test('desktop progress is capped and its subscription is disposed on success', async t => {
  const f = fixture(); let progress!: (pct: number) => void; let unsubscribed = 0;
  const out = deferred<Awaited<ReturnType<DesktopRenderBridge['render']>>>();
  desktop({ onProgress: callback => { progress = callback; return () => { unsubscribed++; }; }, render: () => out.promise });
  const auth = authorize(t);
  const pending = f.actions.render(f.request);
  await Promise.resolve(); await Promise.resolve();
  progress(120); assert.equal(f.state.renderPct, 99);
  out.resolve({ ok: true, outputPath: '/desktop.mp4' });
  assert.equal(await pending, '/desktop.mp4'); assert.equal(auth.mock.callCount(), 1);
  assert.equal(unsubscribed, 1); assert.equal(f.state.renderProductionSignatures['/desktop.mp4'], 'production');
});

test('desktop failure unsubscribes, retains the error and reports the failed render state', async t => {
  const f = fixture(); let unsubscribed = 0;
  desktop({ onProgress: () => () => { unsubscribed++; }, render: async () => { throw Error('fixture desktop failure'); } });
  authorize(t);
  await assert.rejects(f.actions.render(f.request), /fixture desktop failure/);
  assert.equal(unsubscribed, 1); assert.equal(f.state.rendering, false); assert.equal(f.state.rendered, false);
  assert.deepEqual(f.notices, ['成片渲染失败，请重试。']);
});

test('legacy local rendering keeps authorization, clears its progress timer and preserves the active preview for output-only renders', async t => {
  const f = fixture(); f.state.renderOutputPath = '/active'; f.state.renderOutputPreviewUrl = '/active-preview';
  authorize(t);
  const local = t.mock.method(studioApi, 'renderLocal', async () => ({ ok: true, outputPath: '/local.mp4', previewUrl: '/local-preview' }));
  assert.equal(await f.actions.render({ ...f.request, freeThreeStep: false, outputOnly: true }), '/local.mp4');
  assert.equal(local.mock.calls[0]?.arguments[1], 'fixture-token'); assert.equal(timersFor(t).size, 0);
  assert.equal(f.state.renderOutputPath, '/active'); assert.equal(f.state.renderOutputPreviewUrl, '/active-preview');
  assert.equal(f.state.renderPreviewUrlsRef.current['/local.mp4'], '/local-preview');
});

test('server preview override uses the durable route even with an available desktop bridge', async t => {
  const f = fixture(); let rendered = false;
  desktop({ render: async () => { rendered = true; throw Error('unexpected desktop'); } });
  authorize(t);
  t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: true, job: job() }));
  assert.equal(await f.actions.render({ ...f.request, serverPreviewRequired: true }), '/fixture.mp4');
  assert.equal(rendered, false);
});

test('missing saved project and failed submission do not synthesize a successful output', async t => {
  const f = fixture();
  const create = t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: false, error: 'fixture rejected' }));
  await assert.rejects(f.actions.render({ ...f.request, resolveProjectId: () => null }), /请先保存/);
  assert.equal(create.mock.callCount(), 0);
  await assert.rejects(f.actions.render(f.request), /fixture rejected/);
  assert.equal(f.state.rendered, false); assert.deepEqual(f.state.renderProductionSignatures, {});
});

test('version lifecycle records both successful and failed generations and always releases busy state', async t => {
  const f = fixture();
  t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: true, job: job() }));
  await f.actions.renderVersion({ key: 'version', inputSignature: 'frozen', onNotice: f.request.onNotice,
    render: () => f.actions.render(f.request) });
  assert.equal(f.state.languageRenderOutputs.version?.previewUrl, '/preview');
  assert.equal(f.state.languageRenderVersions.version?.[0]?.versionNumber, 1);
  await f.actions.renderVersion({ key: 'version', inputSignature: 'frozen', onNotice: f.request.onNotice,
    render: async () => null });
  assert.equal(f.state.languageRenderOutputs.version?.status, 'failed');
  assert.equal(f.state.languageRenderVersions.version?.[0]?.versionNumber, 2);
  assert.equal(f.state.languageRenderVersions.version?.[1]?.status, 'done');
  assert.equal(f.state.batchRenderingLangs, false);
});

test('project recovery polls queued jobs, restores completed outputs and signatures, and disposes scheduled polling', async t => {
  const f = fixture(); let calls = 0;
  t.mock.method(studioApi, 'latestRenderJob', async () => ({ ok: true, job: ++calls === 1 ? job({ status: 'queued', progress: 0 }) : job() }));
  const recovery = f.actions.recover({ projectId: 'project', onNotice: f.request.onNotice });
  await recovery.refresh(); assert.equal(f.state.renderPct, 15); assert.equal(f.state.rendering, true);
  await recovery.refresh(); assert.equal(f.state.renderOutputPath, '/fixture.mp4');
  assert.equal(f.state.renderProductionSignatures['/fixture.mp4'], 'input');
  assert.equal(f.state.languageRenderOutputs['plan-en']?.status, 'done');
  recovery.dispose(); assert.equal(timersFor(t).size, 0);
});

test('disposed recovery ignores late responses and failed recovery preserves the server error', async t => {
  const f = fixture(), pending = deferred<Awaited<ReturnType<typeof studioApi.latestRenderJob>>>();
  t.mock.method(studioApi, 'latestRenderJob', () => pending.promise);
  const recovery = f.actions.recover({ projectId: 'project', onNotice: f.request.onNotice });
  const refresh = recovery.refresh(); recovery.dispose(); pending.resolve({ ok: true, job: job() }); await refresh;
  assert.equal(f.state.renderOutputPath, null);
  const failed = f.actions.recover({ projectId: 'project', onNotice: f.request.onNotice });
  t.mock.method(studioApi, 'latestRenderJob', async () => ({ ok: true, job: job({ status: 'failed', error: 'fixture failed' }) }));
  await failed.refresh(); assert.equal(f.state.languageRenderOutputs['plan-en']?.error, 'fixture failed');
  assert.deepEqual(f.notices, ['成片渲染中断：fixture failed']);
});

test('an obsolete durable completion cannot replace the preview or signature of a newer render', async t => {
  const f = fixture(), old = deferred<Awaited<ReturnType<typeof studioApi.latestRenderJob>>>(); let creates = 0;
  t.mock.method(studioApi, 'createRenderJob', async () => ({ ok: true, job: ++creates === 1
    ? job({ status: 'processing' }) : job({ outputPath: '/new.mp4', inputSignature: 'new' }) }));
  t.mock.method(studioApi, 'latestRenderJob', () => old.promise);
  const first = f.actions.render({ ...f.request, inputSignature: 'old' });
  await Promise.resolve(); await Promise.resolve();
  [...timersFor(t).values()][0]!();
  await Promise.resolve();
  assert.equal(await f.actions.render({ ...f.request, inputSignature: 'new' }), '/new.mp4');
  old.resolve({ ok: true, job: job({ outputPath: '/old.mp4' }) });
  assert.equal(await first, null); assert.equal(f.state.renderOutputPath, '/new.mp4');
  assert.deepEqual(f.state.renderProductionSignatures, { '/new.mp4': 'new' });
});

test('cover completion precedes spec preparation and a rejected spec never starts authorization or rendering', async t => {
  const f = fixture(), order: string[] = [];
  t.mock.method(studioApi, 'cover', async () => { order.push('cover'); return { ok: true, url: '/cover' }; });
  const auth = t.mock.method(studioApi, 'render', async () => { throw Error('unexpected authorization'); });
  await assert.rejects(f.actions.render({ ...f.request, cover: { title: '', ratio: '9:16', accent: '#16a34a' },
    onCover: url => { assert.equal(url, '/cover'); order.push('write cover'); },
    prepareSpec: url => { assert.equal(url, '/cover'); order.push('prepare'); throw Error('fixture source alignment rejected'); },
  }), /fixture source alignment rejected/);
  assert.deepEqual(order, ['cover', 'write cover', 'prepare']); assert.equal(auth.mock.callCount(), 0);
  assert.equal(f.state.rendered, false); assert.equal(f.state.rendering, false);
});
