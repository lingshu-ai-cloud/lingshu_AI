import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { chromium } from 'playwright-core';
import { studioRenderMediaRouter } from '../server/lib/studioRenderMedia.ts';

const root = path.resolve('data/publishing-uploads');
const tenant = process.argv[2] || 'local_tenant_free_studio_smoke_20260929';
const files = fs.readdirSync(path.join(root, tenant)).filter(file => /^studio-[\w-]+\.mp4$/.test(file)).sort();
assert.ok(files.length > 0, 'expected at least one local tenant export');
const app = express();
app.use((req, res, next) => { res.locals.tenantId = req.headers['x-test-tenant'] || tenant; next(); });
app.use('/media', studioRenderMediaRouter(root));
app.get('/', (_req, res) => res.type('html').send('<!doctype html><title>Studio render smoke</title><video id="preview" controls playsinline preload="auto"></video>'));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  for (const file of files) {
    const url = `${base}/media/${file}`;
    const ranged = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    assert.equal(ranged.status, 206); assert.match(ranged.headers.get('content-type') || '', /video\/mp4/);
    assert.equal((await ranged.arrayBuffer()).byteLength, 1024);
    const full = await fetch(url); assert.equal(full.status, 200);
    const actual = createHash('sha256').update(Buffer.from(await full.arrayBuffer())).digest('hex');
    const expected = createHash('sha256').update(fs.readFileSync(path.join(root, tenant, file))).digest('hex');
    assert.equal(actual, expected, `${file}: served bytes differ from the local export`);
    await page.locator('#preview').evaluate((video, source) => { video.pause(); video.src = source; video.load(); }, url);
    await page.waitForFunction(() => { const video = document.querySelector('#preview'); return video.readyState >= 2 && video.videoWidth > 0 && Number.isFinite(video.duration) && video.duration > 0; });
    const metadata = await page.locator('#preview').evaluate(video => ({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }));
    await page.locator('#preview').evaluate(async video => { await video.play(); });
    await page.waitForFunction(() => document.querySelector('#preview').currentTime > 0.2);
    const seekTo = Math.max(0.1, metadata.duration * 0.75);
    await page.locator('#preview').evaluate((video, time) => { video.currentTime = time; }, seekTo);
    await page.waitForFunction(time => { const video = document.querySelector('#preview'); return !video.seeking && video.readyState >= 2 && video.currentTime >= time - 0.15; }, seekTo);
    console.log(`${file}: ${metadata.width}x${metadata.height}, ${metadata.duration.toFixed(2)}s, playback and seek passed`);
  }
  const denied = await fetch(`${base}/media/${files[0]}`, { headers: { 'x-test-tenant': 'another-tenant' } });
  assert.equal(denied.status, 404);
  assert.deepEqual(errors, []);
  console.log(`Studio render browser smoke passed: ${files.length} exports play, seek and match disk SHA-256; cross-tenant request denied.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
