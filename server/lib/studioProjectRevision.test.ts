import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAndSwapStudioProject, studioProjectRevisionConflict } from './studioProjectRevision.js';

const current = '2026-09-28T22:24:13.295Z';
assert.equal(studioProjectRevisionConflict(current, current), false);
assert.equal(studioProjectRevisionConflict('2026-09-28T22:20:00.000Z', current), true);
assert.equal(studioProjectRevisionConflict('', current), true);
assert.equal(studioProjectRevisionConflict(undefined, current), true);

test('production writes advance the client-visible Studio project revision', async () => {
  let row: any = {
    id: 'project', tenant_id: 'tenant', title: 'draft', status: 'draft', thumb_seed: '',
    spec: { script: 'v1' }, updated_at: '2026-10-16T10:00:00.000Z', updated: '2026-10-16T10:00:00.000Z',
  };
  const store: any = {
    compareAndSwap: async (_collection: string, id: string, expected: Record<string, unknown>, patch: Record<string, unknown>) => {
      if (id !== row.id) return false;
      for (const [key, value] of Object.entries(expected)) {
        try { assert.deepEqual(row[key], value); } catch { return false; }
      }
      row = { ...row, ...structuredClone(patch) };
      return true;
    },
  };
  const saved = await compareAndSwapStudioProject(store, structuredClone(row), { spec: { script: 'v1', render: 'done' } }, '2026-10-16T10:00:00.000Z');
  assert.equal(saved.ok, true);
  assert.equal(row.updated_at, '2026-10-16T10:00:00.001Z');
  assert.equal(row.spec.render, 'done');
});

test('two competing Studio writes atomically allow one winner and one conflict', async () => {
  let row: any = {
    id: 'project', tenant_id: 'tenant', title: 'draft', status: 'draft', thumb_seed: '',
    spec: { script: 'v1' }, updated_at: '2026-10-16T10:00:00.000Z', updated: '2026-10-16T10:00:00.000Z',
  };
  const store: any = {
    compareAndSwap: async (_collection: string, id: string, expected: Record<string, unknown>, patch: Record<string, unknown>) => {
      if (id !== row.id) return false;
      for (const [key, value] of Object.entries(expected)) {
        try { assert.deepEqual(row[key], value); } catch { return false; }
      }
      row = { ...row, ...structuredClone(patch) };
      return true;
    },
  };
  const editorBase = structuredClone(row);
  const [production, staleEditor] = await Promise.all([
    compareAndSwapStudioProject(store, structuredClone(row), {
      spec: { script: 'v1', production: { materialId: 'finished-clip' } },
    }, '2026-10-16T10:00:01.000Z'),
    compareAndSwapStudioProject(store, editorBase, { spec: { script: 'locally edited' } }, '2026-10-16T10:00:02.000Z'),
  ]);
  assert.equal(production.ok, true);
  assert.equal(staleEditor.ok, false);
  assert.deepEqual(row.spec, { script: 'v1', production: { materialId: 'finished-clip' } });
  assert.equal(row.updated_at, production.updatedAt);
});

test('Studio project writes fail closed when atomic storage is unavailable', async () => {
  let unsafeUpdates = 0;
  const store: any = { update: async () => { unsafeUpdates += 1; return true; } };
  await assert.rejects(compareAndSwapStudioProject(store, {
    id: 'project', tenant_id: 'tenant', spec: {}, updated_at: '2026-10-16T10:00:00.000Z',
  }, { spec: { unsafe: true } }), /STUDIO_PROJECT_ATOMIC_STORE_REQUIRED/);
  assert.equal(unsafeUpdates, 0, 'the CAS helper must never fall back to an unconditional update');
});
