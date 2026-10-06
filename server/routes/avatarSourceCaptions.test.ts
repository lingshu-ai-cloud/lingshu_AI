import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import { parseHeygenSubtitles } from '../integrations/heygen.js';
import { createProductionRouter } from './production.js';
import { legacyAvatarSourceObjectKey } from '../lib/avatarSourceCaptions.js';

test('legacy source URL resolves only to the authenticated tenant object namespace', () => {
  const url = '/api/overseas/studio/private-assets/materials/avatar-test-001.mp4?assetToken=expired';
  assert.equal(legacyAvatarSourceObjectKey(url, 'avatar-test', 'tenant-a'),
    `materials/tenants/${Buffer.from('tenant-a').toString('base64url')}/avatar-test-001.mp4`);
  assert.notEqual(legacyAvatarSourceObjectKey(url, 'avatar-test', 'tenant-a'),
    legacyAvatarSourceObjectKey(url, 'avatar-test', 'tenant-b'));
  assert.throws(() => legacyAvatarSourceObjectKey('/media/avatar-test-001.mp4', 'avatar-test', 'tenant-a'));
  assert.throws(() => legacyAvatarSourceObjectKey('/api/overseas/studio/private-assets/materials/other-001.mp4', 'avatar-test', 'tenant-a'));
});

test('legacy avatar snapshot restores measured provider SRT for its own tenant and persists source cues', async () => {
  const rows = new Map<string, any>();
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>() { return null as T | null; },
    async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...structuredClone(patch) }); return true; },
    async delete() { return false; },
    async list<T>(collection: string, query = {}) { const where = (query as { where?: Record<string, unknown> }).where || {}; const items = [...rows.entries()]
      .filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected))
      .map(([, value]) => structuredClone(value) as T);
      return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const materialId = 'avatar-test';
  const snapshot = { id: materialId, type: 'video', duration: 2, sourceType: 'heygen',
    url: `/api/overseas/studio/private-assets/materials/${materialId}-001.mp4?assetToken=expired` };
  const shot = { source: 'avatar', sound: 'source', candidates: [{ id: 'candidate-1', source: 'avatar', materialId }], adoptedId: 'candidate-1' };
  rows.set('studio_projects/project-1', { id: 'project-1', tenant_id: 'tenant-a', status: 'draft', spec: {
    activeAssemblyId: 'assembly-1', storyboardAssignments: { 'slot-1': materialId },
    materialSnapshots: [snapshot], shotProductions: { 'assembly-1:shot-1': shot },
  } });
  rows.set('studio_avatar_jobs/job-1', { id: 'job-1', tenant_id: 'tenant-a', project_id: 'project-1',
    payload: { status: 'completed', materialId, assemblyId: 'assembly-1', shotId: 'shot-1', remoteId: 'remote-1' },
    input: { script: 'Hello world.' } });
  let supplierCalls = 0;
  let failCaption = false;
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant']; next(); });
  app.use(createProductionRouter(store, async () => 'unused', {
    recoverAvatarSourceCaptions: async (remoteId, duration, script) => {
      supplierCalls++;
      assert.equal(remoteId, 'remote-1');
      return parseHeygenSubtitles('1\n00:00:00,100 --> 00:00:01,900\nHello world.\n', duration,
        failCaption ? 'Different words.' : script);
    },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (tenant: string, body: Record<string, string>) => fetch(`${url}/avatar-source-captions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, body: JSON.stringify(body),
  });
  const body = { projectId: 'project-1', assemblyId: 'assembly-1', shotId: 'shot-1', slotId: 'slot-1', materialId };
  try {
    assert.equal((await post('tenant-b', body)).status, 422);
    assert.equal(supplierCalls, 0);
    const saved = await post('tenant-a', body);
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).cues, [{ text: 'Hello world.', start: 0.1, end: 1.9 }]);
    assert.deepEqual(rows.get('studio_projects/project-1').spec.materialSnapshots[0].transcriptCues,
      [{ text: 'Hello world.', start: 0.1, end: 1.9 }]);
    assert.equal((await post('tenant-a', body)).status, 200);
    assert.equal(supplierCalls, 1, 'persisted cues should avoid another supplier request');
    rows.get('studio_projects/project-1').spec.materialSnapshots[0].transcriptCues = undefined;
    rows.delete('studio_avatar_jobs/job-1');
    assert.equal((await post('tenant-a', body)).status, 422, 'a forged snapshot alone is not source evidence');
    rows.set('studio_avatar_jobs/job-1', { id: 'job-1', tenant_id: 'tenant-a', project_id: 'project-1',
      payload: { status: 'completed', materialId, assemblyId: 'assembly-1', shotId: 'shot-1', remoteId: 'remote-1' }, input: { script: 'Hello world.' } });
    failCaption = true;
    assert.equal((await post('tenant-a', body)).status, 422, 'mismatched provider SRT cannot become source captions');
    assert.equal(rows.get('studio_projects/project-1').spec.materialSnapshots[0].transcriptCues, undefined);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
