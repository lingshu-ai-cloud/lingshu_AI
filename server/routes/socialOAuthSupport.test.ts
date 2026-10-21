import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callbackHtml, normalizeReturnTo } from './socialOAuthSupport.js';

test('social OAuth return target stays on an application path', () => {
  assert.equal(normalizeReturnTo('/channels?tab=meta'), '/channels?tab=meta');
  assert.equal(normalizeReturnTo('https://elsewhere.example'), '/');
  assert.equal(normalizeReturnTo('//elsewhere.example'), '/');
  assert.equal(normalizeReturnTo(null), '/');
});

test('social OAuth callback cannot inject closing script tags through provider text', () => {
  const html = callbackHtml({
    ok: false,
    title: '<script>alert(1)</script>',
    message: '</script><img src=x onerror=alert(1)>',
    returnTo: '/channels?tab=meta',
    platform: 'facebook',
  });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /facebook_oauth=error/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.doesNotMatch(html, /<img src=x onerror/);
});
