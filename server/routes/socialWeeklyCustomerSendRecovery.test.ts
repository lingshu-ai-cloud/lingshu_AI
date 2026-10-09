import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSocialWeeklyCustomerSendRecoveryRouter, type WeeklyCustomerSendRecoveryPort } from './socialWeeklyCustomerSendRecovery.js';

test('HTTP recovery binds server identity and rejects caller supplied send proof', async () => {
  const calls: unknown[][] = [];
  const port: WeeklyCustomerSendRecoveryPort = {
    async list(...args) { calls.push(args); return []; },
    async sources(...args) { calls.push(args); return []; },
    async get(...args) { calls.push(args); return {}; },
    async create(...args) { calls.push(args); return {}; },
    async resolve(...args) { calls.push(args); return { messagesSent: 0 }; },
  };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-auth'] !== 'missing') Object.assign(res.locals, { tenantId: 'actual-tenant', userId: 'actual-user' }); next(); });
  app.use('/programs/:programId/weeks/:packageId/send-recoveries', createSocialWeeklyCustomerSendRecoveryRouter(port));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}/programs/program/weeks/week/send-recoveries`;
    const post = (path: string, data: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await fetch(base + '?version=1', { headers: { 'x-test-auth': 'missing' } })).status, 401);
    assert.equal((await post('/request/resolve', { packageVersion: 1, expectedVersion: 1, verifiedSignature: true, providerMessageId: 'forged' })).status, 400);
    assert.equal((await post('/request/resolve', { packageVersion: 1, expectedVersion: 0 })).status, 400);
    assert.equal((await post('', { packageVersion: 1, runId: 'run', itemId: 'item', ownerUserId: 'owner', deadlineAt: '2026-10-10T12:00:00', reason: '核对' })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await post('/request/resolve', { packageVersion: 2, expectedVersion: 3 })).status, 200);
    assert.deepEqual(calls, [[{ tenantId: 'actual-tenant', programId: 'program', packageId: 'week', packageVersion: 2 }, 'request', 'actual-user', { expectedVersion: 3 }]]);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
