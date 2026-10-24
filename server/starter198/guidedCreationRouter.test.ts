import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createGuidedCreationRouter, guidedReferenceSource } from './guidedCreationRouter.js';
import { guidedCreationFixture } from '../../scripts/fixtures/guidedCreation.js';
import type { Starter198Repository } from './repository.js';

test('local final confirmation refuses paid dispatch and repository writes; forged snapshots and missing evidence fail closed', async () => {
  const f = guidedCreationFixture();
  let plan = await f.run('guided_products', { ...f.initial, productIds: ['fixture-product'], guided: { ...f.initial.guided!, languages: ['en'] } });
  plan = await f.run('guided_structure', { ...plan.selection, guided: { ...plan.selection.guided!, structureId: 'reference:fixture-video' } });
  plan = await f.run('guided_production', { ...plan.selection, guided: { ...plan.selection.guided!, productionMode: 'manual', presenterMode: 'none', assignments: plan.guided!.nodes.map(node => ({ nodeId: node.id, intent: 'generate' })) } });
  assert.deepEqual(plan.guided!.blockers, []);
  let writes = 0, dispatched = 0;
  const repository = new Proxy({}, { get() { writes++; throw new Error('repository must remain untouched in local acceptance'); } }) as Starter198Repository;
  const app = express(); app.use(express.json());
  app.use(createGuidedCreationRouter({ repository, evidence: f.ports, localPreview: () => true,
    now: () => new Date('2026-10-24T00:00:00Z'), authorize: async () => ({ tenantId: 'fixture', userId: 'tester' }),
    orchestratorQueue: { enqueue: async () => { dispatched++; throw new Error('must not dispatch'); } },
    asyncRoute: handler => (req, res) => { void handler(req, res).catch(error => res.status(error.status || 500).json({ code: error.code || 'failed', message: error.message })); },
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const post = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/guided-creation/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const rejected = await post({ selection: plan.selection, fingerprint: '0'.repeat(64) });
    assert.equal(rejected.status, 409); assert.equal((await rejected.json()).code, 'creation_evidence_stale');
    const local = await post({ selection: plan.selection, fingerprint: plan.guided!.fingerprint });
    assert.equal(local.status, 409); assert.equal((await local.json()).code, 'creation_local_preview_no_paid_generation');
    assert.equal(writes, 0); assert.equal(dispatched, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('native reference handoff uses the exact recorded URL and bounded label, rejecting invented source protocols', () => {
  const narration = { sourceReferenceId: 'history-1', sourceTitle: 'real title '.repeat(40) };
  const value = guidedReferenceSource({ sourceUrl: 'https://www.tiktok.com/@factory/video/123' }, narration);
  assert.equal(value.sourceRef, 'https://www.tiktok.com/@factory/video/123');
  assert.equal(value.cachedReferenceRecordId, 'history-1'); assert.equal(value.label.length, 160);
  assert.throws(() => guidedReferenceSource({ sourceUrl: 'trendvideo:history-1' }, narration), /social_content_source_ref_invalid/);
});
