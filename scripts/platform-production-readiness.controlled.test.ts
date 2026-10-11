import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import type { Request } from 'express';
import { effectiveOAuthConfig, oauthCallbackUrls } from '../server/lib/oauthConfig.js';
import { instagramLoginOAuthScopes, metaOAuthScopes, tikTokOAuthScopes } from '../server/lib/socialOAuthScopes.js';

test('controlled runner blocks all provider transports before connection', async () => {
 await import('./platform-production-readiness.network-guard.mjs');
 const deny = /platform_readiness_network_forbidden/;
 assert.throws(() => http.get('http://provider.invalid'), deny);
 assert.throws(() => https.request('https://provider.invalid'), deny);
 assert.throws(() => net.connect(443, 'provider.invalid'), deny);
 assert.throws(() => tls.connect(443, 'provider.invalid'), deny);
 assert.throws(() => dns.lookup('provider.invalid', () => {}), deny);
 assert.throws(() => fetch('https://provider.invalid'), deny);
});

test('exact callback and scope contracts use dummy configuration only', () => {
 const original = process.env.PUBLIC_BASE_URL;
 process.env.PUBLIC_BASE_URL = 'https://readiness.example.invalid';
 try {
  const request = { headers: {}, protocol: 'http', get: () => 'unexpected.invalid' } as Request;
  assert.deepEqual(oauthCallbackUrls(request), {
   youtube: 'https://readiness.example.invalid/api/overseas/youtube/oauth/callback',
   instagram: 'https://readiness.example.invalid/api/overseas/social/oauth/instagram/callback',
   facebook: 'https://readiness.example.invalid/api/overseas/social/oauth/facebook/callback',
   tiktok: 'https://readiness.example.invalid/api/overseas/social/oauth/tiktok/callback',
  });
  const isolated = effectiveOAuthConfig({ disabledPlatforms: ['youtube', 'meta', 'instagram', 'tiktok'] });
  for (const key of ['metaSocialAppId', 'metaSocialAppSecret', 'instagramAppId', 'instagramAppSecret', 'tiktokClientKey', 'tiktokClientSecret'] as const) assert.equal(isolated[key], '');
  assert.deepEqual(tikTokOAuthScopes({}), ['user.info.basic']);
  assert.deepEqual(tikTokOAuthScopes({ TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved' }), ['user.info.basic', 'video.publish']);
  assert.deepEqual(instagramLoginOAuthScopes({ INSTAGRAM_CONTENT_PUBLISH_ENABLED: 'true' }), ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_content_publish']);
  assert.deepEqual(metaOAuthScopes('messenger', {}), ['pages_show_list', 'pages_read_engagement', 'pages_messaging', 'pages_manage_metadata']);
 } finally { if (original === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = original; }
});

test('readiness templates are parseable non-production evidence with only public references', () => {
 for (const file of ['meta-instagram', 'tiktok', 'messaging']) {
  const raw = fs.readFileSync(`fixtures/platform-production-readiness/${file}.json`, 'utf8');
  const manifest: unknown = JSON.parse(raw);
  assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest));
  // Templates must never carry access tokens, app secrets or signed receipt URLs.
  assert.doesNotMatch(raw, /EA[A-Za-z0-9]{30,}|Bearer\s+[A-Za-z0-9._-]{16,}|[?&](access_token|appsecret_proof|signature)=/);
  const gates = manifest as Record<string, unknown>;
  assert.ok(gates.productionApproved === false || gates.productionReady === false || gates.ready === false, 'template must retain an explicit closed production gate');
 }
});
