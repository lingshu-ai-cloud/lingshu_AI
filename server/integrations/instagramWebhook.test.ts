import assert from 'node:assert/strict';
import test from 'node:test';
import { subscribeInstagramAccount } from './instagramWebhook.js';

test('Instagram webhook subscription uses the IG Graph account and required message fields', async () => {
  const original = globalThis.fetch;
  let url = '';
  let body = '';
  let authorization = '';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    body = String(init?.body);
    authorization = new Headers(init?.headers).get('Authorization') || '';
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  try {
    await subscribeInstagramAccount({ accountId: 'ig-1', accessToken: 'test-token' });
    assert.match(url, /^https:\/\/graph\.instagram\.com\/v\d+\.\d+\/ig-1\/subscribed_apps$/);
    assert.equal(authorization, 'Bearer test-token');
    assert.equal(url.includes('test-token'), false);
    const fields = new URLSearchParams(body).get('subscribed_fields') || '';
    for (const field of ['messages', 'messaging_postbacks', 'message_reactions', 'messaging_seen']) assert.ok(fields.split(',').includes(field));
  } finally { globalThis.fetch = original; }
});

test('Instagram webhook subscription fails when provider declines', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(subscribeInstagramAccount({ accountId: 'ig-1', accessToken: 'token' }), /subscription failed/);
  } finally { globalThis.fetch = original; }
});
