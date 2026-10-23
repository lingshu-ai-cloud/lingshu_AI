import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { studioApi, type Material } from '../../lib/studioApi';
import { createStudioMaterialInventoryActions, useStudioMaterialInventory, type StudioMaterialInventoryInput } from './studioMaterialInventory';
import type { Clip } from './studioSourceMaterial';

const record = (id: string, overrides: Partial<Material> = {}): Material => ({
  id, name: id, folder: 'product', type: 'video', duration: 4, size: '1 MB', file: id + '.mp4', url: '/fixture/' + id,
  createdAt: '2026-10-23T00:00:00Z', ...overrides,
});
const clip = (id: string, overrides: Partial<Clip> = {}): Clip => ({ ...record(id), ...overrides });

function fixture(overrides: Partial<StudioMaterialInventoryInput> = {}, rights = false) {
  let materials: Clip[] = [];
  const busy: boolean[] = [];
  const notices: string[] = [];
  const appended: string[][] = [];
  const folders: string[] = [];
  const input: StudioMaterialInventoryInput = {
    contentMode: 'video', activeFolder: 'all', selectedProductIds: [], storyboardAssignments: {}, storyboardSourcePlans: {},
    onAppendUploaded: ids => appended.push(ids), onChooseFolder: folder => folders.push(folder), onNotice: notice => notices.push(notice), ...overrides,
  };
  const state: Parameters<typeof createStudioMaterialInventoryActions>[1] = {
    materialRightsConfirmed: rights,
    setMaterials: update => { materials = typeof update === 'function' ? update(materials) : update; },
    setUploading: update => { busy.push(typeof update === 'function' ? update(busy.at(-1) || false) : update); },
    materialSourceRefreshesRef: { current: new Set<string>() },
  };
  return { input, state, actions: createStudioMaterialInventoryActions(input, state), busy, notices, appended, folders,
    read: () => materials };
}

test.beforeEach(t => {
  if (!('mock' in t)) throw Error('Requires per-test context');
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('unexpected real network'); });
  t.after(() => assert.equal(network.mock.callCount(), 0));
});

test('inventory refresh preserves bound and restored project materials while replacing stale unbound inventory', async t => {
  const f = fixture({ storyboardAssignments: { shot: 'bound' }, storyboardSourcePlans: {
    other: { mode: 'ai', confirmed: false, critical: false, generatedClipId: 'generated' },
  } });
  f.state.setMaterials([clip('bound'), clip('generated'), clip('snapshot', { sourceType: 'project-snapshot' }),
    clip('kickoff', { sourceType: 'historical-kickoff' }), clip('stale')]);
  t.mock.method(studioApi, 'listMaterials', async () => [record('fresh')]);
  assert.deepEqual((await f.actions.refreshMaterials()).map(item => item.id), ['fresh']);
  assert.deepEqual(f.read().map(item => item.id), ['bound', 'generated', 'snapshot', 'kickoff', 'fresh']);
});

test('a failed inventory refresh retains the last readable inventory', async t => {
  const f = fixture();
  const prior = [clip('retained')];
  f.state.setMaterials(prior);
  t.mock.method(studioApi, 'listMaterials', async () => { throw Error('fixture unavailable'); });
  assert.deepEqual(await f.actions.refreshMaterials(), []);
  assert.equal(f.read(), prior);
});

test('source recovery coalesces concurrent reads and updates only URLs, preserving evidence and timing', async t => {
  const f = fixture();
  f.state.setMaterials([clip('recover', { duration: 9, transcript: 'retained evidence', url: '/expired', poster: '/old-poster' })]);
  let finish!: (materials: Material[]) => void;
  const list = t.mock.method(studioApi, 'listMaterials', () => new Promise<Material[]>(resolve => { finish = resolve; }));
  const first = f.actions.refreshMaterialSource('recover');
  assert.equal(await f.actions.refreshMaterialSource('recover'), undefined);
  assert.equal(list.mock.callCount(), 1);
  finish([record('recover', { duration: 2, url: '/renewed', poster: '/new-poster' })]);
  assert.equal((await first)?.url, '/renewed');
  assert.equal(f.read()[0]?.duration, 9);
  assert.equal(f.read()[0]?.transcript, 'retained evidence');
  assert.equal(f.read()[0]?.poster, '/new-poster');
  assert.equal(f.state.materialSourceRefreshesRef.current.size, 0);
});

test('failed source recovery releases its gate so an explicit retry can succeed', async t => {
  const f = fixture();
  let attempts = 0;
  t.mock.method(studioApi, 'listMaterials', async () => {
    if (++attempts === 1) throw Error('fixture expired');
    return [record('recover')];
  });
  assert.equal(await f.actions.refreshMaterialSource('recover'), undefined);
  assert.equal((await f.actions.refreshMaterialSource('recover'))?.id, 'recover');
  assert.equal(attempts, 2);
});

test('poster upload requires rights before any probing, busy state or request', async t => {
  const f = fixture({ contentMode: 'poster' });
  const upload = t.mock.method(studioApi, 'uploadMaterialFile', async () => { throw Error('unexpected upload'); });
  await f.actions.handleUpload([new File(['x'], 'one.png', { type: 'image/png' })] as unknown as FileList);
  assert.equal(upload.mock.callCount(), 0);
  assert.deepEqual(f.busy, []);
  assert.match(f.notices[0]!, /商业使用/);
});

test('authorized image upload retains partial success, metadata and product binding, then refreshes and reports the failure', async t => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  class FixtureImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 640;
    naturalHeight = 480;
    private source = '';
    set src(value: string) { this.source = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this.source; }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FixtureImage });
  t.after(() => { if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage); else Reflect.deleteProperty(globalThis, 'Image'); });
  const f = fixture({ contentMode: 'poster', activeFolder: 'product', selectedProductIds: ['product-1'] }, true);
  const calls: Parameters<typeof studioApi.uploadMaterialFile>[] = [];
  t.mock.method(studioApi, 'uploadMaterialFile', async (...args: Parameters<typeof studioApi.uploadMaterialFile>) => {
    calls.push(args);
    if (args[0].name === 'bad.png') return { ok: false, error: 'fixture rejected' };
    return { ok: true, material: record('uploaded', { type: 'image' }) };
  });
  const list = t.mock.method(studioApi, 'listMaterials', async () => [record('uploaded', { type: 'image' })]);
  await f.actions.handleUpload(['good.png', 'bad.png'].map(name => new File(['x'], name, { type: 'image/png' })) as unknown as FileList);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.[1], { folder: 'product', type: 'image', duration: 0, width: 640, height: 480, rightsConfirmed: true, productId: 'product-1' });
  assert.equal(list.mock.callCount(), 1);
  assert.deepEqual(f.appended, [['uploaded']]);
  assert.deepEqual(f.folders, ['product']);
  assert.deepEqual(f.busy, [true, false]);
  assert.match(f.notices[0]!, /fixture rejected/);
});

test('the owning Hook initializes one inventory without making requests during render', () => {
  const f = fixture();
  const captured: { value?: ReturnType<typeof useStudioMaterialInventory> } = {};
  function Probe() { captured.value = useStudioMaterialInventory(f.input); return null; }
  renderToStaticMarkup(createElement(Probe));
  assert.ok(captured.value);
  assert.deepEqual(captured.value.materials, []);
  assert.equal(captured.value.materialRightsConfirmed, false);
  assert.equal(captured.value.uploading, false);
  assert.equal(captured.value.fileInputRef.current, null);
});
