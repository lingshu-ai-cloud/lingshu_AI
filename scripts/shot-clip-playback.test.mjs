import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

test('opening a shot loads and plays only its video; closing releases it', async () => {
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/scripts/fixtures/shot-clip/index.html`);
    assert.equal(await page.locator('video').count(), 0);
    const shot = page.getByRole('article', { name: '第 3 镜' });
    await shot.getByText('核对原片切片').click();
    const video = shot.locator('video');
    await video.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    assert.equal(await page.locator('video').count(), 1);
    const box = await video.boundingBox();
    assert.ok(box);
    await video.click({ position: { x: 24, y: box.height - 24 } });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0.1);
    await shot.getByText('核对原片切片').click();
    await page.waitForFunction(() => !document.querySelector('video'));
  } finally {
    await browser.close();
    await server.close();
  }
});
