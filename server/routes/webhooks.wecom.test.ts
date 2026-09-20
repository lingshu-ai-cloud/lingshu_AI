import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createWeComCallbackPostHandler } from './webhooks.js';
import { WeComCustomerServiceError } from '../wecom/customerService.js';

test('WeCom webhook ACKs after durable ingestion without waiting for sync_msg', async () => {
  const deferred: Array<() => void> = [];
  const calls: string[] = [];
  const service = {
    async ingestCallback(input: { tenantId: string }) {
      calls.push(`ingest:${input.tenantId}`);
      return { callbackId: 'callback-1', duplicate: false, status: 'queued' as const, shouldProcess: true };
    },
    async processCallback(input: { tenantId: string; callbackId: string }) {
      calls.push(`process:${input.tenantId}:${input.callbackId}`);
      return { callbackId: input.callbackId, status: 'processed' as const, pages: 1, messages: 0 };
    },
  };
  const app = express();
  app.post(
    '/wecom/:tenantId',
    express.text({ type: ['application/xml', 'text/xml', 'text/plain'] }),
    createWeComCallbackPostHandler({
      service: service as never,
      defer: work => { deferred.push(work); },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${origin}/wecom/tenant-a?msg_signature=sig&timestamp=1&nonce=nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: '<xml><Encrypt>cipher</Encrypt></xml>',
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'success');
    assert.deepEqual(calls, ['ingest:tenant-a']);
    assert.equal(deferred.length, 1, 'provider processing is scheduled only after durable ingestion');

    deferred[0]();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['ingest:tenant-a', 'process:tenant-a:callback-1']);
  } finally {
    server.close();
  }
});

test('WeCom webhook never ACKs when durable ingestion fails', async () => {
  let deferred = false;
  const app = express();
  app.post(
    '/wecom/:tenantId',
    express.text({ type: 'application/xml' }),
    createWeComCallbackPostHandler({
      service: {
        async ingestCallback() {
          throw new WeComCustomerServiceError('wecom_callback_persistence_failed', 503);
        },
        async processCallback() {
          throw new Error('must_not_run');
        },
      } as never,
      defer: () => { deferred = true; },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${origin}/wecom/tenant-a?msg_signature=sig&timestamp=1&nonce=nonce`, {
      method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: '<xml/>',
    });
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'wecom_callback_persistence_failed');
    assert.equal(deferred, false);
  } finally {
    server.close();
  }
});
