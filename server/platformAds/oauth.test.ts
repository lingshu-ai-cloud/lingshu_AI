import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-oauth-'));
process.env.LOCAL_STORE_DIR = dir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.META_ADS_API_VERSION = 'v25.0';
process.env.META_ADS_APP_ID = 'app';
process.env.META_ADS_APP_SECRET = 'private';
process.env.META_ADS_REDIRECT_URI = 'https://example.com/api/overseas/platform-ads/oauth/meta/callback';
const originalFetch = globalThis.fetch;
try {
  const { beginMetaOAuth, finishMetaOAuth, oauthAccounts } = await import('./oauth.js');
  const first = await beginMetaOAuth('t1', 'u1');
  const url = new URL(first.url);
  assert.equal(url.searchParams.get('scope'), 'ads_read,ads_management');
  assert.ok(!first.url.includes('private'));
  await assert.rejects(oauthAccounts('t2', 'u1', first.sessionId), /无效/);
  let exchanges = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    if (!String(url).startsWith('https://graph.facebook.com/')) return originalFetch(url, init);
    if (String(url).includes('oauth/access_token')) { exchanges++; return Response.json({ access_token: 'top-secret' }); }
    return Response.json({ data: [{ id: 'act_1', name: 'Account', currency: 'USD' }] });
  }) as typeof fetch;
  const state = url.searchParams.get('state')!;
  await finishMetaOAuth(state, 'code');
  await assert.rejects(finishMetaOAuth(state, 'code'), /使用或过期/);
  assert.equal(exchanges, 1);
  const accounts = await oauthAccounts('t1', 'u1', first.sessionId);
  assert.equal(accounts.status, 'ready');
  assert.equal(accounts.accounts[0].id, 'act_1');
  assert.ok(!JSON.stringify(accounts).includes('top-secret'));
  console.log('ad OAuth tests passed');
} finally { globalThis.fetch = originalFetch; fs.rmSync(dir, { recursive: true, force: true }); }
