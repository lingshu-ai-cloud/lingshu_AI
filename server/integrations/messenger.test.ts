import assert from 'node:assert/strict';
import test from 'node:test';
import { sendMessengerText, subscribeMessengerPage } from './messenger.js';

test('Messenger send uses the Page messages endpoint and PSID recipient', async () => {
  const original = globalThis.fetch;
  let requestUrl = '';
  let requestBody = '';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = String(init?.body || '');
    return new Response(JSON.stringify({ message_id: 'mid.1', recipient_id: 'psid-1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const receipt = await sendMessengerText({ pageId: 'page-1', pageAccessToken: 'token', recipientId: 'psid-1', text: 'hello' });
    assert.match(requestUrl, /\/page-1\/messages/);
    assert.deepEqual(JSON.parse(requestBody), {
      recipient: { id: 'psid-1' }, messaging_type: 'RESPONSE', message: { text: 'hello' },
    });
    assert.equal(receipt.messageId, 'mid.1');
  } finally { globalThis.fetch = original; }
});

test('Messenger subscription requests inbound message webhook fields', async () => {
  const original = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body || '');
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  try {
    await subscribeMessengerPage({ pageId: 'page-1', pageAccessToken: 'token' });
    assert.match(requestBody, /messages/);
    assert.match(requestBody, /messaging_postbacks/);
    assert.match(requestBody, /message_deliveries/);
  } finally { globalThis.fetch = original; }
});
