import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { sendRecoveryFixture } from '../socialPrograms/weeklyCustomerSendRecovery.fixture.js';
import { bindWeeklyCustomerRun } from '../runtime/socialWeeklyCustomerBridge.js';
import { createSocialWeeklyCustomerChannelScopeRouter } from './socialWeeklyCustomerChannelScope.js';

test('actual bound weekly scope returns channel gaps and rejects caller identity and foreign run', async () => {
  const f = sendRecoveryFixture();
  await bindWeeklyCustomerRun(f.store, { tenantId: 'tenant', programId: 'program', packageId: 'week', packageVersion: 1 }, 'run', 'owner');
  const app = express(); app.use(express.json());
  app.use((_req, res, next) => { Object.assign(res.locals, { tenantId: 'tenant', userId: 'owner' }); next(); });
  app.use('/programs/:programId/weeks/:packageId/channel', createSocialWeeklyCustomerChannelScopeRouter(f.store));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/programs/program/weeks/week/channel`;
    const response = await fetch(base + '?version=1&runId=run'); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.item.scope.tenantId, 'tenant');
    assert.equal(data.item.scope.runId, 'run'); assert.equal(data.item.scope.packageVersion, 1);
    assert.deepEqual(data.item.selections, []);
    assert.deepEqual(data.item.gaps.map((g: { channel: string }) => g.channel), ['whatsapp', 'messenger', 'instagram']);
    assert.equal((await fetch(base + '?version=1&runId=foreign')).status, 409);
    assert.equal((await fetch(base + '?version=1&runId=run&tenantId=foreign')).status, 400);
    const post = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      packageVersion: 1, runId: 'run', channel: 'messenger', accountId: 'fake', customerId: 'fake', inboundMessageId: 'fake',
      classification: 'new_inquiry', reason: '文本不能充当真实证据', actorUserId: 'forged',
    }) });
    assert.equal(post.status, 400);
    assert.equal((f.data.social_weekly_customer_channel_selections ?? []).length, 0);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
