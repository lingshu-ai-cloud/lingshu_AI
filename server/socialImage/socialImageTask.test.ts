import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataStore, ListQuery, ListResult, Record_ } from '../storage/datastore.js';
import { createSocialImageTask, defaultSocialImageTask, readSocialImageTask, updateSocialImageTask } from './socialImageTask.js';

class MemoryStore implements DataStore {
  private sequence = 0;
  private records = new Map<string, Record_[]>();
  async getById<T = Record_>(collection: string, id: string): Promise<T | null> { return (this.records.get(collection) || []).find(item => item.id === id) as T || null; }
  async create<T = Record_>(collection: string, data: Record<string, unknown>): Promise<T | null> { const row = { id: `row-${++this.sequence}`, ...structuredClone(data) } as Record_; this.records.set(collection, [...(this.records.get(collection) || []), row]); return row as T; }
  async update(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> { const rows = this.records.get(collection) || []; const index = rows.findIndex(row => row.id === id); if (index < 0) return false; rows[index] = { ...rows[index], ...structuredClone(data) }; return true; }
  async delete(): Promise<boolean> { return false; }
  async list<T = Record_>(_collection: string, query: ListQuery = {}): Promise<ListResult<T>> { return { items: [], totalItems: 0, totalPages: 0, page: query.page || 1, perPage: query.perPage || 20 }; }
}

test('creates tenant-scoped image tasks with optimistic versions', async () => {
  const store = new MemoryStore();
  const created = await createSocialImageTask(store, 'tenant-a', { title: '新闻图', imageType: 'brand_news', creationPath: 'viral_replication' });
  assert.equal(created.contentMode, 'image');
  assert.equal(created.imageType, 'brand_news');
  assert.equal(created.version, 1);
  assert.equal(await readSocialImageTask(store, 'tenant-b', created.id), null);
  const updated = await updateSocialImageTask(store, 'tenant-a', created.id, 1, { title: '合作新闻图' });
  assert.equal(updated.kind, 'updated');
  if (updated.kind === 'updated') assert.equal(updated.task.version, 2);
  const conflict = await updateSocialImageTask(store, 'tenant-a', created.id, 1, { title: '过期写入' });
  assert.equal(conflict.kind, 'conflict');
});

test('approval is blocked until facts, products and quality pass', async () => {
  const store = new MemoryStore();
  const created = await createSocialImageTask(store, 'tenant-a', { title: '产品图', imageType: 'product_poster' });
  const result = await updateSocialImageTask(store, 'tenant-a', created.id, 1, { status: 'approved' });
  assert.equal(result.kind, 'invalid');
  if (result.kind === 'invalid') assert.match(result.issues.join('；'), /核心主张|企业产品/);
});

test('reference masks and layer order are sanitized into the replication recipe', () => {
  const task = defaultSocialImageTask({ creationPath: 'viral_replication', referenceLayerBlueprints: [{
    imageIndex: 1,
    layers: [
      { id: 'bg', role: 'background', zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: .99 },
      { id: 'copy-mask', role: 'mask', zIndex: 2, bounds: { x: -.2, y: .1, width: 1.4, height: .5 }, confidence: .9 },
      { id: 'product', role: 'product', zIndex: 3, bounds: { x: .4, y: .2, width: .5, height: .7 }, confidence: .9 },
    ],
    masks: [{ id: 'copy-mask', shape: 'rounded_rectangle', bounds: { x: -.2, y: .1, width: 1.4, height: .5 }, opacity: .63, color: '#112233', cornerRadius: .18, zIndex: 2, confidence: .9 }],
  }] });
  const blueprint = task.replicationRecipe?.referenceLayerBlueprints?.[0];
  assert.deepEqual(blueprint?.layers.map(layer => layer.role), ['background', 'mask', 'product']);
  assert.deepEqual(blueprint?.masks[0]?.bounds, { x: 0, y: .1, width: 1, height: .5 });
  assert.equal(blueprint?.masks[0]?.opacity, .63);
});

test('task updates re-sanitize client-supplied reference masks', async () => {
  const store = new MemoryStore();
  const created = await createSocialImageTask(store, 'tenant-a', { creationPath: 'viral_replication' });
  const recipe = structuredClone(created.replicationRecipe!);
  recipe.referenceLayerBlueprints = [{ imageIndex: 1, layers: [], masks: [{
    id: 'client-mask', shape: 'rectangle', bounds: { x: -.2, y: 0, width: 2, height: 1 },
    opacity: 3, color: 'red" onload="evil', zIndex: 2, confidence: 1,
  }] }];
  const result = await updateSocialImageTask(store, 'tenant-a', created.id, 1, { replicationRecipe: recipe });
  assert.equal(result.kind, 'updated');
  if (result.kind !== 'updated') return;
  const mask = result.task.replicationRecipe?.referenceLayerBlueprints?.[0]?.masks[0];
  assert.deepEqual(mask?.bounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(mask?.opacity, 1);
  assert.equal(mask?.color, undefined);
});
