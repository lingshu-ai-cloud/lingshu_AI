import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';

// Isolated browser fixture: no backend, credentials, or production data.
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-content-preview-test',
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
  plugins: [react(), {
    name: 'content-preview-fixture',
    configureServer(server) {
      server.middlewares.use('/preview-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml('/preview-test', `<div id="root"></div>
          <script type="module">
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import ContentLibrary from '/src/components/ContentLibrary.tsx';
            createRoot(document.getElementById('root')).render(React.createElement(ContentLibrary));
          </script>`));
      });
    },
  }],
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  let polls = 0;
  let file = '/demo/img2video.mp4';
  await page.route('**/api/overseas/studio/exports', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/overseas/studio/library', route => route.fulfill({ json: { items: [{
    id: 'fixture', title: 'Playback regression', language: 'en', platform: 'facebook',
    version: 1, current: true, available: true, metadataComplete: true,
    previewUrl: `${file}?assetToken=${++polls}`, reviewStatus: polls > 1 ? 'approved' : 'pending',
  }] } }));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/preview-test`);
  await page.locator('video').waitFor();
  const initial = await page.locator('video').evaluate(async video => {
    window.originalVideo = video;
    video.muted = true;
    video.playbackRate = 0.25;
    await video.play();
    return video.getAttribute('src');
  });
  await page.waitForTimeout(11000);
  assert.ok(polls >= 3, 'must cross two real 5-second library polls');
  assert.deepEqual(await page.locator('video').evaluate(video => ({
    same: video === window.originalVideo, src: video.getAttribute('src'),
    advanced: video.currentTime > 2, playing: !video.paused,
  })), { same: true, src: initial, advanced: true, playing: true });
  await page.getByText('已批准 · 未确认发布').waitFor();

  const pausedTime = await page.locator('video').evaluate(video => { video.pause(); return video.currentTime; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), pausedTime, 'paused progress survives refresh');

  // Simulate an expired media request after playback has started. The browser
  // must load the newly polled token and seek back to the saved position.
  await page.locator('video').evaluate(video => {
    Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code: 2 }) });
    video.dispatchEvent(new Event('error'));
    delete video.error;
  });
  await page.waitForFunction(old => document.querySelector('video').getAttribute('src') !== old && document.querySelector('video').readyState >= 1, initial);
  assert.ok(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - pausedTime) < 0.1, 'token retry restores position');

  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForTimeout(500);
  const beforeRetry = await page.locator('video').evaluate(async video => {
    await video.play();
    return video.getAttribute('src');
  });
  await page.locator('video').evaluate(video => {
    Object.defineProperty(video, 'error', { configurable: true, get: () => ({ code: 2 }) });
    video.dispatchEvent(new Event('error'));
    delete video.error;
  });
  await page.waitForFunction(({ src, time }) => {
    const video = document.querySelector('video');
    return video.getAttribute('src') !== src && !video.paused && video.currentTime > time;
  }, { src: beforeRetry, time: pausedTime + 0.1 });

  file = '/demo/replacement.mp4';
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video') !== window.originalVideo);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0, 'new file starts a new player');
  console.log('PASS: polling, live status updates, pause, token recovery, and file replacement');
} finally {
  await browser?.close();
  await server.close();
}
