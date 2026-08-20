/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { composite, ffmpegPath } = require('./render.cjs');

async function main() {
  assert.ok(ffmpegPath, 'ffmpeg-static is required');
  const audio = fs.readFileSync(path.join(__dirname, '../server/assets/bgm/tech-pulse.mp3'));
  const server = http.createServer((req, res) => {
    if (req.url === '/voice.mp3' || req.url === '/bgm.mp3') {
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.length });
      res.end(audio);
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
