import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildVideoDownloaderArgs, platformReferer } from './videoDownloaderArgs.js';

const context = { userAgent: 'agent/1', proxy: '', cookiesBrowser: 'safari',
  nodeExecutable: '/node', youtubeEjsEnabled: true };

test('search pseudo URLs use the platform origin and preserve the keyword as one argument', () => {
  const url = 'ytsearch5:中文 防晒';
  const args = buildVideoDownloaderArgs(['--dump-json'], url, false, context);
  assert.equal(platformReferer(url), 'https://www.youtube.com/');
  assert.deepEqual(args, ['-m', 'yt_dlp', '--ignore-config', '--no-warnings',
    '--user-agent', 'agent/1', '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--referer', 'https://www.youtube.com/', '--dump-json',
    '--js-runtimes', 'node:/node', '--remote-components', 'ejs:github', url]);
});

test('proxy, cookies and EJS choices are explicit and ordered', () => {
  const url = 'https://www.tiktok.com/@brand/video/123';
  const args = buildVideoDownloaderArgs(['--skip-download'], url, true, {
    ...context, proxy: 'http://127.0.0.1:8080', youtubeEjsEnabled: false,
  });
  assert.deepEqual(args.slice(-6), ['--skip-download', '--proxy', 'http://127.0.0.1:8080',
    '--cookies-from-browser', 'safari', url]);
  assert.equal(args.includes('--js-runtimes'), false);
  assert.equal(platformReferer(url), 'https://www.tiktok.com/');
});

test('invalid URLs do not invent a referer', () => {
  assert.equal(platformReferer('not a url'), '');
  const args = buildVideoDownloaderArgs([], 'not a url', false, context);
  assert.equal(args.includes('--referer'), false);
});
