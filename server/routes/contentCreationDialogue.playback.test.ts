import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { registerContentCreationDialogue } from './contentCreationDialogue.js';
import { creationDialogueFixture } from '../../scripts/fixtures/contentCreationDialogue.js';
import { verifyAssetToken } from '../lib/assetAccess.js';
import { runWithDataAuthority } from '../storage/dataAuthority.js';

test('creation replies sign browser playback for the authenticated tenant without changing evidence identity', async () => {
  const fixture = creationDialogueFixture();
  const analysis = JSON.parse(String(fixture.reference.aiAnalysis));
  analysis.gemini.scriptDetails15s[0].materialEvidence = { clipRef: '/api/overseas/videos/fixture-video/shot/1/clip', extractionStatus: 'ready' };
  fixture.reference.aiAnalysis = JSON.stringify(analysis);
  const materials = fixture.materials.map((row, index) => ({ ...row, id: `acceptance-${index}`, url: `/studio-media/acceptance-${index}/media.mp4` }));
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.tenantId = 'fixture'; runWithDataAuthority('local', next); });
  registerContentCreationDialogue(app, { ...fixture.ports, materials: async () => ({ items: materials, status: 'ready' }) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/creation-dialogue`;
  try {
    async function products() {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'products', instruction: '选择产品', selection: { referenceId: 'fixture-video', productIds: ['fixture-product'], shotIds: [] } }) });
      assert.equal(response.status, 200);
      return response.json();
    }
    const first = await products();
    assert.equal(first.shots.length, 4);
    const hookUrl = new URL(first.shots[0].previewUrl, 'http://localhost');
    assert.equal(hookUrl.pathname, '/api/overseas/videos/fixture-video/shot/1/clip');
    assert.deepEqual(verifyAssetToken(hookUrl.searchParams.get('assetToken'), hookUrl.pathname), { tenantId: 'fixture', dataAuthority: 'local' });
    for (const shot of first.shots.filter((row: { previewUrl?: string }) => row.previewUrl?.startsWith('/studio-media/'))) {
      const match = shot.previewUrl.match(/^\/studio-media\/([^/]+)\/signed\/([^/]+)\/media\.mp4$/);
      assert.ok(match);
      const originalPath = `/studio-media/${match[1]}/media.mp4`;
      assert.deepEqual(verifyAssetToken(match[2], originalPath), { tenantId: 'fixture', dataAuthority: 'local' });
      assert.equal(verifyAssetToken(match[2], '/studio-media/another/media.mp4'), null);
    }
    const second = await products();
    assert.equal(first.selection.evidenceVersion, second.selection.evidenceVersion);
    assert.deepEqual(first.selection.shotIds, second.selection.shotIds);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
