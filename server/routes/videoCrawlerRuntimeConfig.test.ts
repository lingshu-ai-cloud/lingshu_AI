import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { browserCookiesLikelyAvailable, browserUserAgent, cookieBrowsers, cookieFiles,
  cookiesBrowser, crawlerExecutionEnv, crawlerProxyPool, crawlerProxyUrl, redactProxy, selectCrawlerProxy,
  usesServerCookiesForCrawl } from './videoCrawlerRuntimeConfig.js';

test('runtime proxy wins over configured pool and never mutates the inherited process environment', () => {
  const source: NodeJS.ProcessEnv = { CRAWLER_PROXY: 'http://configured',
    CRAWLER_PROXY_POOL: ' http://pool-a , http://pool-b ', NODE_USE_ENV_PROXY: '1' };
  assert.deepEqual(crawlerProxyPool(source), ['http://pool-a', 'http://pool-b']);
  assert.equal(crawlerProxyUrl('', source), 'http://configured');
  assert.equal(crawlerProxyUrl('http://runtime', source), 'http://runtime');
  const child = crawlerExecutionEnv('http://runtime', source);
  assert.equal(child.NODE_USE_ENV_PROXY, undefined);
  assert.equal(child.HTTPS_PROXY, 'http://runtime');
  assert.equal(child.http_proxy, 'http://runtime');
  assert.equal(source.NODE_USE_ENV_PROXY, '1');
  assert.equal(source.HTTPS_PROXY, undefined);
  assert.equal(crawlerProxyUrl('', { CRAWLER_PROXY_POOL: 'http://pool-a,http://pool-b' }), 'http://pool-a');
  assert.equal(selectCrawlerProxy(1, source), 'http://pool-a');
  assert.equal(selectCrawlerProxy(2, source), 'http://pool-b');
  assert.equal(selectCrawlerProxy(3, source), 'http://pool-a');
  assert.equal(selectCrawlerProxy(1, { CRAWLER_PROXY: 'http://fallback' }), 'http://fallback');
  assert.equal(redactProxy('https://user:secret@proxy.example:443'), 'https://***:***@proxy.example/');
  assert.equal(redactProxy('not-a-url://user:secret@proxy'), 'not-a-url://***:***@proxy');
});

test('cookie file and browser discovery respect configured files and platform scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crawler-config-'));
  try {
    const cookie = path.join(root, 'cookie.txt');
    fs.writeFileSync(cookie, 'test-only');
    const chrome = path.join(root, 'Library', 'Application Support', 'Google', 'Chrome', 'Default');
    fs.mkdirSync(path.join(chrome, 'Network'), { recursive: true });
    fs.writeFileSync(path.join(chrome, 'Network', 'Cookies'), 'test-only');
    const env: NodeJS.ProcessEnv = { HOME: root, YT_DLP_COOKIE_FILES: `${cookie},${root}/missing`,
      YT_DLP_COOKIES_BROWSER: 'chrome,safari', CRAWLER_USER_AGENT: 'crawler-test/1' };
    assert.deepEqual(cookieFiles(env), [cookie]);
    assert.equal(cookiesBrowser(env), 'chrome');
    assert.deepEqual(cookieBrowsers(env), ['chrome']);
    assert.equal(browserCookiesLikelyAvailable('safari', env), false);
    assert.equal(browserUserAgent(env), 'crawler-test/1');
    assert.equal(usesServerCookiesForCrawl('youtube'), true);
    assert.equal(usesServerCookiesForCrawl('tiktok'), true);
    assert.equal(usesServerCookiesForCrawl('instagram'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
