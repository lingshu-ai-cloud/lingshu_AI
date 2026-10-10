import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { AssistantSearchUnavailableError, createAssistantSearchProvider } from './searchProvider.js';

function videoStore(rowsByTenant: Record<string, Array<Record<string, unknown>>>): {
  store: DataStore;
  queries: ListQuery[];
} {
  const queries: ListQuery[] = [];
  return {
    queries,
    store: {
      async list<T = Record_>(_collection: string, query: ListQuery = {}) {
        queries.push(query);
        const tenantId = String(query.where?.tenantId || '');
        const items = rowsByTenant[tenantId] ?? [];
        return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: query.perPage ?? 100 };
      },
      async getById() { return null; },
      async create() { return null; },
      async update() { return false; },
      async delete() { return false; },
    },
  };
}

test('assistant video search is tenant-scoped, real, compact and read-only', async () => {
  const { store, queries } = videoStore({
    current: [
      { id: 'video-1', tenantId: 'current', title: '卸妆蜜开箱实测', platform: 'tiktok', status: 'analyzed', thumbnailUrl: '/one.jpg', tags: ['卸妆蜜'] },
      { id: 'video-2', tenantId: 'current', title: '卸妆蜜工厂实拍', platform: 'youtube', tags: ['卸妆蜜'] },
      { id: 'video-3', tenantId: 'current', title: '卸妆蜜成分解释', platform: 'instagram', tags: ['卸妆蜜'] },
      { id: 'video-4', tenantId: 'current', title: '卸妆蜜使用方法', platform: 'facebook', tags: ['卸妆蜜'] },
      { id: 'image-1', tenantId: 'current', contentFormat: 'image', title: '卸妆蜜图片', tags: ['卸妆蜜'] },
      { id: 'fixture-1', tenantId: 'current', title: '卸妆蜜测试视频', platform: 'tiktok', tags: ['卸妆蜜'], synthetic: true },
    ],
    other: [{ id: 'secret', tenantId: 'other', title: '卸妆蜜秘密视频', tags: ['卸妆蜜'] }],
  });
  let materialReads = 0;
  const provider = createAssistantSearchProvider({
    dataStore: store,
    readMaterials: async () => { materialReads += 1; return { items: [], status: 'ready' }; },
  });

  const result = await provider.search({ tenantId: 'current', query: '搜索 卸妆蜜 爆款视频', page: 'socialInspiration' });
  assert.equal(result.domain, 'inspiration');
  assert.equal(result.total, 4);
  assert.deepEqual(result.items.map(item => item.id), ['video-1', 'video-2', 'video-3']);
  assert.match(result.workspace.href, /page=socialInspiration/);
  assert.match(result.workspace.href, /search=/);
  assert.equal(materialReads, 0, 'video searches must not wake the material backend');
  assert.deepEqual(queries[0]?.where, { tenantId: 'current' });
  assert.ok(result.items.every(item => item.id !== 'secret'));
});

test('assistant material search returns accessible inventory only and reports a truthful empty result', async () => {
  const { store } = videoStore({ current: [] });
  const provider = createAssistantSearchProvider({
    dataStore: store,
    readMaterials: async tenantId => ({
      status: 'ready',
      items: tenantId === 'current' ? [
        { id: 'material-1', tenantId: 'current', name: '云朵泡沫卸妆蜜产品正面', type: 'image', scope: 'own', poster: '/material.jpg', productName: '云朵泡沫卸妆蜜' },
        { id: 'material-2', tenantId: 'current', name: '工厂灌装线', type: 'video', scope: 'own', productName: '云朵泡沫卸妆蜜' },
        { id: 'material-secret', tenantId: 'other', name: '卸妆蜜其他租户秘密素材', type: 'video', scope: 'own', productName: '云朵泡沫卸妆蜜' },
      ] : [],
    }),
  });

  const found = await provider.search({ tenantId: 'current', query: '查找 卸妆蜜 产品素材', page: 'smartAssets' });
  assert.equal(found.domain, 'materials');
  assert.equal(found.total, 2);
  assert.equal(found.items[0]?.title, '云朵泡沫卸妆蜜产品正面');
  assert.equal(found.items[0]?.accountLabel, '产品素材 · 云朵泡沫卸妆蜜');
  assert.match(found.workspace.href, /view=library/);

  const empty = await provider.search({ tenantId: 'current', query: '查找 不存在的 产品素材', page: 'smartAssets' });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
});

test('assistant material search distinguishes source outage from an empty library', async () => {
  const { store } = videoStore({ current: [] });
  const provider = createAssistantSearchProvider({
    dataStore: store,
    readMaterials: async () => ({ items: [], status: 'unavailable' }),
  });
  await assert.rejects(
    provider.search({ tenantId: 'current', query: '搜索 素材', page: 'smartAssets' }),
    (error: unknown) => error instanceof AssistantSearchUnavailableError && /没有返回未经核实的结果/.test(error.publicMessage),
  );
});
