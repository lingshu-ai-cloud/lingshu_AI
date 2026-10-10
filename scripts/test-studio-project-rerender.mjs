import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { composite, ffmpegPath } = require('../desktop/render.cjs');
const projectId = process.argv[2] || 'studio_projects_bbf06a5780834938bf249b0a854aef56';
const projects = JSON.parse(fs.readFileSync('data/local-store/studio_projects.json', 'utf8'));
const materials = JSON.parse(fs.readFileSync('data/materials.json', 'utf8'));
const project = projects.find(item => item.id === projectId);
assert.ok(project, `local project ${projectId} is missing`);
const spec = project.spec || {}; const slots = spec.shootingSlots || []; const assignments = spec.storyboardAssignments || {};
assert.ok(slots.length > 0 && spec.voiceoverMode === 'none', 'this smoke requires a complete no-voiceover local project');
const byId = new Map(materials.map(item => [item.id, item]));
const tenantRoot = fs.realpathSync(path.resolve('data/media/tenants', project.tenant_id));
let cursor = 0;
const timeline = slots.map((slot, index) => {
  const materialId = assignments[slot.slotId]; const material = byId.get(materialId);
  assert.ok(material && material.type === 'video' && material.tenantId === project.tenant_id, `slot ${index + 1} lacks owned video`);
  const file = fs.realpathSync(path.join(tenantRoot, `${materialId}.mp4`));
  assert.ok(file.startsWith(`${tenantRoot}${path.sep}`) && fs.statSync(file).size > 0);
  const edit = spec.clipEdits?.[`${slot.slotId}:${materialId}`] || {};
  const duration = Number(edit.targetDuration || slot.duration);
  assert.ok(Number.isFinite(duration) && duration > 0);
  const production = spec.shotProductions?.[`${spec.activeAssemblyId}:${slot.id}`] || {};
  const item = { name: material.name || materialId, clipId: materialId, type: 'video', url: pathToFileURL(file).href,
    trimStart: Number(edit.trimStart || 0), trimEnd: Number(edit.trimEnd || duration), speed: Number(edit.speed || 1),
    targetStart: cursor, targetEnd: cursor + duration, targetDuration: duration,
    production: { source: production.source || 'material', sound: production.sound || 'silent', layout: production.layout || 'full' } };
  cursor += duration; return item;
});
const uniqueFiles = [...new Set(timeline.map(item => fileURLToPath(item.url)))];
const bytesNeeded = uniqueFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0) + 180 * 1024 * 1024;
const disk = fs.statfsSync(process.cwd());
assert.ok(disk.bavail * disk.bsize > bytesNeeded, `insufficient free space for isolated render: need ${Math.ceil(bytesNeeded / 1048576)} MiB`);
const manifest = { jobId: `smoke-${process.pid}`, requireVisualAssets: true,
  spec: { ratio: spec.ratio || '9:16', duration: cursor, platform: spec.platform || 'tiktok', language: spec.activeVoiceLang || 'zh', bgmVol: 0, voiceVol: 0 },
  script: spec.script || '', timeline, voiceover: { voice: null, url: null }, bgm: { id: null, url: null }, subtitles: { mode: 'off', cues: [] } };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-project-rerender-'));
let server; let browser;
try {
  const result = await composite(manifest, undefined, temp);
  assert.equal(result.ok, true, result.error || 'render failed');
  const outputPath = result.outputPath;
  assert.ok(outputPath && fs.statSync(outputPath).size > 1000);
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', outputPath, '-map', '0:v:0', '-map', '0:a:0?', '-f', 'null', '-'], { timeout: 180_000 });
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<video id="preview" controls autoplay muted playsinline></video>'); return; }
    if (req.url !== '/output.mp4') { res.writeHead(404).end(); return; }
    res.setHeader('content-type', 'video/mp4'); res.end(fs.readFileSync(outputPath));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage(); const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base); await page.locator('#preview').evaluate((video, url) => { video.src = url; video.load(); }, `${base}/output.mp4`);
  await page.waitForFunction(() => { const video = document.querySelector('#preview'); return video.readyState >= 2 && video.videoWidth > 0; });
  await page.locator('#preview').evaluate(video => video.play());
  await page.waitForFunction(() => document.querySelector('#preview').currentTime > 0.2);
  const media = await page.locator('#preview').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
  assert.ok(Math.abs(media.duration - cursor) < 0.2, `output duration ${media.duration} differs from ${cursor}`);
  await page.locator('#preview').evaluate((video, time) => { video.currentTime = time; }, media.duration * 0.75);
  await page.waitForFunction(time => { const video = document.querySelector('#preview'); return !video.seeking && video.currentTime >= time - 0.15; }, media.duration * 0.75);
  const report = { projectId, tenantId: project.tenant_id, shotCount: slots.length, timelineDuration: cursor,
    uniqueSourceCount: uniqueFiles.length, outputBytes: fs.statSync(outputPath).size,
    outputSha256: createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex'),
    browser: media, fullDecodePassed: true, browserPlaybackPassed: true, browserSeekPassed: true, temporaryOutputRemoved: true,
    checkedAt: new Date().toISOString() };
  const reportPath = path.resolve('data/qa-reports', `studio-rerender-${projectId}.json`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, ...report }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
