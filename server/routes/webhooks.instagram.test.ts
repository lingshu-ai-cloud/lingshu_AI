import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import express from 'express';
import { encryptSecret } from '../lib/tenantPlatformApps.js';
import { store } from '../storage/index.js';
import { selectInstagramWebhookEntries, webhookAppPlatform, webhookRouter } from './webhooks.js';

const accounts = [{ providerAccountId: 'ig-a', parentPageId: 'page-a' }];

test('Instagram webhook entries must belong to a connected account', () => {
  const result = selectInstagramWebhookEntries({ object: 'instagram', entry: [
    { id: 'ig-b', messaging: [{ message: { mid: 'wrong' } }] },
    { id: 'ig-a', messaging: [{ message: { mid: 'right' } }] },
  ] }, accounts);
  assert.deepEqual(result, [{ id: 'ig-a', messaging: [{ message: { mid: 'right' } }] }]);
});

test('Page-linked Instagram webhook rejects foreign nested events', () => {
  const result = selectInstagramWebhookEntries({ object: 'page', entry: [{ id: 'page-a', messaging: [
    { sender: { id: 'buyer' }, recipient: { id: 'ig-a' }, message: { mid: 'ig-message' } },
    { sender: { id: 'buyer' }, recipient: { id: 'page-a' }, message: { mid: 'facebook-message' } },
    { sender: { id: 'buyer' }, recipient: { id: 'ig-b' }, message: { mid: 'other-ig-message' } },
  ] }] }, accounts);
  assert.deepEqual(result, [{ id: 'ig-a', messaging: [
    { sender: { id: 'buyer' }, recipient: { id: 'ig-a' }, message: { mid: 'ig-message' } },
  ] }]);
});

test('Instagram payload rejects a valid signature from the tenant Facebook app', async () => {
  const originalList = store.list;
  (store as any).list = async (collection: string, query: any) => {
    if (collection === 'tenant_platform_apps') return { items: [{
      tenant_id: 'tenant-a', platform: query.where.platform,
      app_secret: encryptSecret(query.where.platform === 'instagram' ? 'ig-secret' : 'fb-secret'),
      webhook_verify_token: query.where.platform === 'instagram' ? 'ig-verify' : 'fb-verify',
    }] };
    return { items: [] };
  };
  const app = express();
  app.use(express.json({ verify(req, _res, buffer) { (req as any).rawBody = Buffer.from(buffer); } }));
  app.use('/webhooks', webhookRouter);
  const listener = app.listen(0);
  try {
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('test_server_address_missing');
    const raw = JSON.stringify({ object: 'instagram', entry: [{ id: 'ig-a', messaging: [] }] });
    const request = (secret: string) => fetch(`http://127.0.0.1:${address.port}/webhooks/meta/tenant-a`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}` }, body: raw,
    });
    assert.equal((await request('fb-secret')).status, 403);
    assert.equal((await request('ig-secret')).status, 200);
    const instagramCallback = `http://127.0.0.1:${address.port}/webhooks/instagram/tenant-a`;
    const challenge = '&hub.mode=subscribe&hub.challenge=challenge-1';
    assert.equal((await fetch(`${instagramCallback}?hub.verify_token=fb-verify${challenge}`)).status, 403);
    const verified = await fetch(`${instagramCallback}?hub.verify_token=ig-verify${challenge}`);
    assert.equal(verified.status, 200);
    assert.equal(await verified.text(), 'challenge-1');
    assert.equal(webhookAppPlatform('/instagram/tenant-a', 'page'), null);
  } finally {
    (store as any).list = originalList;
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
});
