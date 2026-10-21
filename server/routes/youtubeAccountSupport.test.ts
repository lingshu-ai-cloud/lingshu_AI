import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';
import { callbackHtml, getYouTubeRedirectUri, normalizeReturnTo } from './youtubeAccountSupport.js';

test('YouTube OAuth callback return path stays same-origin', () => {
  assert.equal(normalizeReturnTo('/accounts?tab=youtube'), '/accounts?tab=youtube');
  assert.equal(normalizeReturnTo('https://elsewhere.example/path'), '/');
  assert.equal(normalizeReturnTo('//elsewhere.example/path'), '/');
  assert.equal(normalizeReturnTo({ path: '/accounts' }), '/');
});

test('YouTube OAuth callback escapes displayed values and preserves the redirect route', () => {
  const html = callbackHtml({
    ok: false,
    title: '<script>alert(1)</script>',
    message: '</script><img src=x onerror=alert(1)>',
    returnTo: '/accounts?tab=youtube',
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;\/script&gt;&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /youtube_oauth=error/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.doesNotMatch(html, /<\/script><img/);
});

test('YouTube OAuth redirect uses the request origin when no public origin is configured', () => {
  const previous = process.env.PUBLIC_BASE_URL;
  delete process.env.PUBLIC_BASE_URL;
  try {
    const req = {
      headers: { 'x-forwarded-proto': 'https' },
      protocol: 'http',
      get: (name: string) => name === 'host' ? 'example.test' : undefined,
    } as unknown as Request;
    assert.equal(getYouTubeRedirectUri(req), 'https://example.test/api/overseas/youtube/oauth/callback');
  } finally {
    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
  }
});
