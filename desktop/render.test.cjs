/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { composite, downloadTo, ffmpegPath, safeJobId } = require('./render.cjs');

async function main() {
  assert.ok(ffmpegPath, 'ffmpeg-static is required');
  const audio = fs.readFileSync(path.join(__dirname, '../server/assets/bgm/tech-pulse.mp3'));
  const server = http.createServer((req, res) => {
    if (req.url === '/voice.mp3' || req.url === '/bgm.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.length });
      res.end(audio);
      return;
    }
    if (req.url === '/slow-image.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.flushHeaders();
      res.write(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://${req.headers.host}/voice.mp3` });
      res.end();
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-render-test-'));
  try {
    const result = await composite({
      jobId: 'voiceover-regression',
      spec: { ratio: '1:1', duration: 1.2, bgmVol: 20, voiceVol: 100 },
      timeline: [],
      bgm: { url: `${origin}/bgm.mp3` },
      voiceover: { url: `${origin}/voice.mp3` },
      subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(result.ok, true, result.error || 'render should succeed');
    assert.ok(result.outputPath && fs.existsSync(result.outputPath), 'rendered MP4 should exist');
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', result.outputPath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const mean = Number((probe.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1]);
    assert.ok(Number.isFinite(mean) && mean > -70, `voiceover mix should not be silent (mean=${mean})`);

    const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const imageResult = await composite({
      jobId: '../../data-uri-image-regression',
      requireTimelineAssets: true,
      spec: { ratio: '1:1', duration: 1, bgmVol: 0 },
      timeline: [{ type: 'image', url: onePixelPng, targetDuration: 1 }],
      bgm: { url: null },
      voiceover: { url: null },
      subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(imageResult.ok, true, imageResult.error || 'data URI image should render');
    assert.ok(imageResult.outputPath && fs.existsSync(imageResult.outputPath), 'data URI render should produce an MP4');
    assert.equal(path.dirname(imageResult.outputPath), outDir, 'untrusted job id must not escape the output directory');
    assert.doesNotMatch(safeJobId('../../escape'), /[\\/]/, 'safe job id must not contain path separators');

    const directDest = path.join(outDir, 'cancelled-download.png');
    const downloadController = new AbortController();
    const signal = downloadController.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);
    let addedAbortListeners = 0;
    let removedAbortListeners = 0;
    signal.addEventListener = (type, listener, options) => {
      if (type === 'abort') addedAbortListeners += 1;
      return originalAdd(type, listener, options);
    };
    signal.removeEventListener = (type, listener, options) => {
      if (type === 'abort') removedAbortListeners += 1;
      return originalRemove(type, listener, options);
    };
    const cancelledDownload = downloadTo(`${origin}/slow-image.png`, directDest, { signal, timeoutMs: 5_000 });
    setTimeout(() => downloadController.abort(new Error('test cancellation')), 50);
    await assert.rejects(cancelledDownload, /test cancellation|abort/i);
    assert.equal(fs.existsSync(directDest), false, 'cancelled download must not leave a partial destination file');
    assert.equal(addedAbortListeners, removedAbortListeners, 'parent abort listener must be removed after body cancellation');
    const timedOutDest = path.join(outDir, 'timed-out-download.png');
    await assert.rejects(
      downloadTo(`${origin}/slow-image.png`, timedOutDest, { timeoutMs: 50 }),
      /timed out/i,
      'download timeout must remain active while the response body is streaming',
    );
    assert.equal(fs.existsSync(timedOutDest), false, 'timed-out download must remove its partial destination file');
    await assert.rejects(
      downloadTo(`${origin}/redirect`, path.join(outDir, 'redirected-download.mp3')),
      /redirect|fetch failed/i,
      'asset downloads must not follow redirects to an unvalidated destination',
    );

    const tempBefore = new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('studio-')));
    const renderController = new AbortController();
    const cancelledRender = composite({
      jobId: 'cancelled-render',
      spec: { ratio: '1:1', duration: 1 },
      timeline: [{ type: 'image', url: `${origin}/slow-image.png`, targetDuration: 1 }],
      requireTimelineAssets: true,
    }, () => {}, outDir, { signal: renderController.signal, downloadTimeoutMs: 5_000 });
    setTimeout(() => renderController.abort(new Error('render cancellation')), 50);
    const cancelledResult = await cancelledRender;
    assert.equal(cancelledResult.ok, false, 'cancelled render must fail');
    assert.match(String(cancelledResult.error), /render cancellation|abort/i);
    const leakedTempDirs = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('studio-') && !tempBefore.has(name));
    assert.deepEqual(leakedTempDirs, [], 'cancelled render must clean its temporary directory');

    const failed = await composite({
      jobId: 'missing-voiceover-regression',
      spec: { ratio: '1:1', duration: 1 },
      timeline: [],
      bgm: { url: null },
      voiceover: { url: `${origin}/missing.mp3` },
    }, () => {}, outDir);
    assert.equal(failed.ok, false, 'missing requested voiceover must fail instead of exporting a silent video');
    assert.match(String(failed.error), /口播配音读取失败/);
  } finally {
    server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  console.log('desktop voiceover render regression passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
