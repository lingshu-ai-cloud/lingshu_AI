import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createAssistantWeeklyActionsRouter } from './assistantWeeklyActions.js';
import { prepareWeeklyQualityRecoveryFixture } from '../socialPrograms/weeklyContentQualityRecovery.fixture.js';

test('weekly assistant HTTP entry isolates identity and offers only actual bound artifacts', async t => {
  const f = await prepareWeeklyQualityRecoveryFixture();
  t.after(f.cleanup);
  f.pkg.status = 'active';
  const source = f.tables.starter_social_content_tasks![0]!, artifact = f.tables.starter_social_content_artifacts![0]!;
  source.weekly_plan_id = 'week1'; artifact.status = 'review_required'; artifact.version = '1';
  const app = express(); app.use(express.json());
  app.use('/actions', createAssistantWeeklyActionsRouter(f.store, (req, res, next) => {
    if (!req.headers['x-test-user']) { res.sendStatus(401); return; }
    res.locals.tenantId = req.headers['x-test-tenant'] || 't'; res.locals.userId = 'owner'; next();
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/actions`;
  assert.equal((await fetch(`${base}/context`)).status, 401);
  const headers = { 'x-test-user': 'owner', 'Content-Type': 'application/json' };
  const response = await fetch(`${base}/context`, { headers }); assert.equal(response.status, 200);
  const { item } = await response.json();
  assert.ok(item.packages.some((p: { packageId: string }) => p.packageId === 'week1')); assert.equal(item.revisionTargets.length, 1); assert.equal(item.publishTargets.length, 0);
  assert.equal(item.revisionTargets[0].taskId, source.task_id); assert.equal(item.revisionTargets[0].expectedArtifactVersion, '1');
  const other = await fetch(`${base}/context`, { headers: { ...headers, 'x-test-tenant': 'other' } }).then(r => r.json());
  assert.equal(other.item.packages.length, 0); assert.equal(other.item.revisionTargets.length, 0);
  const spoof = await fetch(`${base}/revise`, { method: 'POST', headers, body: JSON.stringify({ tenantId: 'victim' }) });
  assert.equal(spoof.status, 400);
  const stale = await fetch(`${base}/publish`, { method: 'POST', headers, body: JSON.stringify({ ...item.revisionTargets[0], packageVersion: 999 }) });
  assert.equal(stale.status, 409);
});
