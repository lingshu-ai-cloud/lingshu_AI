import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { sendInstagramText } from './send.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('Instagram Login sends to the IG account and requires provider message ID', async () => {
  let calledUrl = '';
  let calledInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    calledInit = init;
    return new Response(JSON.stringify({ message_id: 'ig-mid-1', recipient_id: 'ig-scoped-user' }), { status: 200 });
  };
  const receipt = await sendInstagramText({ instagramAccountId: 'ig-business', instagramUserId: 'ig-scoped-user', accessToken: 'secret', oauthProvider: 'instagram_login', text: 'Hello' });
  assert.equal(receipt.messageId, 'ig-mid-1');
  assert.match(calledUrl, /^https:\/\/graph\.instagram\.com\/v\d+\.\d+\/ig-business\/messages$/);
  assert.equal((calledInit?.headers as Record<string, string>).Authorization, 'Bearer secret');
  assert.deepEqual(JSON.parse(String(calledInit?.body)), { recipient: { id: 'ig-scoped-user' }, message: { text: 'Hello' } });
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  await assert.rejects(sendInstagramText({ instagramAccountId: 'ig-business', instagramUserId: 'ig-scoped-user', accessToken: 'secret', oauthProvider: 'instagram_login', text: 'Hello' }), /instagram_provider_message_id_missing/);
});

test('Facebook Login uses the linked Page and propagates provider failure', async () => {
  let calledUrl = '';
  globalThis.fetch = async (input) => {
    calledUrl = String(input);
    return new Response(JSON.stringify({ error: { message: 'permission denied' } }), { status: 403 });
  };
  await assert.rejects(sendInstagramText({ instagramAccountId: 'ig-business', instagramUserId: 'ig-scoped-user', accessToken: 'page-secret', oauthProvider: 'facebook_login', parentPageId: 'page-1', text: 'Hello' }), /permission denied/);
  assert.match(calledUrl, /graph\.facebook\.com\/v\d+\.\d+\/page-1\/messages$/);
  await assert.rejects(sendInstagramText({ instagramAccountId: 'ig-business', instagramUserId: 'ig-scoped-user', accessToken: 'page-secret', oauthProvider: 'facebook_login', text: 'Hello' }), /instagram_messaging_page_required/);
});
