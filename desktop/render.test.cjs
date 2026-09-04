/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  aiDisclosureFontSize,
  composite,
  cuesToAss,
  subtitlePages,
  normalizeSubtitleCues,
  downloadTo,
  ffmpegPath,
  resolveAiDisclosure,
  sanitizeMetadataValue,
} = require('./render.cjs');

function readContainerMetadata(file) {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-map_metadata', '0',
    '-f', 'ffmetadata',
    '-',
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function extractTopRight(file, atSeconds) {
  const result = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(atSeconds),
    '-i', file,
    '-vf', 'crop=420:180:660:0,format=gray',
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-',
  ], { maxBuffer: 420 * 180 * 4 });
  assert.equal(result.status, 0, String(result.stderr));
  assert.equal(result.stdout.length, 420 * 180, 'top-right crop should contain one grayscale frame');
  return result.stdout;
}

function changedPixelCount(a, b) {
  assert.equal(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) >= 8) changed++;
  }
  return changed;
}

async function main() {
  assert.ok(ffmpegPath, 'ffmpeg-static is required');
  const longSubtitle = '工业激光清洁设备适用于金属表面处理，可用于多种生产场景，具体规格、工艺方案和合作条件请联系确认。';
  const pages = subtitlePages(longSubtitle);
  assert.ok(pages.length >= 2, 'long subtitles must be split into multiple timed pages');
  assert.ok(pages.every(page => page.length <= 2), 'every subtitle page must contain no more than two lines');
  assert.ok(pages.flat().every(line => Array.from(line).length <= 16), 'Chinese subtitle lines must remain inside the mobile safe width');
  const normalizedCues = normalizeSubtitleCues([{ start: 0, end: 4, text: longSubtitle }]);
  assert.equal(normalizedCues[0].start, 0);
  assert.equal(normalizedCues.at(-1).end, 4);
  assert.ok(normalizedCues.every(cue => (cue.text.match(/\\N/g) || []).length <= 1));
  const ass = cuesToAss([{ start: 0, end: 4, text: longSubtitle }], 1080, 1920);
  assert.match(ass, /\\N/, 'ASS output must contain an explicit safe line break');
  assert.match(ass, /WrapStyle: 0/, 'ASS output must permit renderer wrapping as a final safety net');
  assert.ok(aiDisclosureFontSize(1080, 1920) >= 1080 * 0.05, 'AI label must be at least 5% of the short edge');
  assert.ok(resolveAiDisclosure({
    jobId: 'explicit',
    aiDisclosure: { required: true, containsDigitalHuman: true },
    timeline: [],
  }), 'explicit disclosure should be honored');
  for (const provenance of [
    { digitalHumanGenerated: true },
    { sourceType: 'digital-human' },
    { assetRole: 'generated_clip' },
  ]) {
    assert.ok(resolveAiDisclosure({ jobId: 'inferred', timeline: [provenance] }), `timeline provenance should require disclosure: ${JSON.stringify(provenance)}`);
  }
  assert.equal(resolveAiDisclosure({
    jobId: 'ordinary',
    aiDisclosure: { required: true, containsDigitalHuman: false },
    timeline: [{ sourceType: 'uploaded' }],
  }), null, 'ordinary footage must not be labeled');
  assert.equal(sanitizeMetadataValue('content\r\n\u0000id', 'fallback'), 'content id');
  const disclosureAss = cuesToAss(
    [{ start: 0, end: 1.2, text: '底部字幕' }],
    1080,
    1920,
    { required: true, containsDigitalHuman: true },
    1.2,
  );
  assert.match(disclosureAss, /Style: AIGenerated,Arial Unicode MS,54,/);
  assert.match(disclosureAss, /Dialogue: 10,0:00:00\.00,0:00:01\.20,AIGenerated[^\n]*AI生成/);

  const audio = fs.readFileSync(path.join(__dirname, '../server/assets/bgm/tech-pulse.mp3'));
  let sameOriginAuthorization = '';
  let blockedOriginHits = 0;
  const blockedServer = http.createServer((_req, res) => {
    blockedOriginHits += 1;
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end('should-not-be-requested');
  });
  await new Promise(resolve => blockedServer.listen(0, '127.0.0.1', resolve));
  const blockedAddress = blockedServer.address();
  const blockedOrigin = `http://127.0.0.1:${blockedAddress.port}`;
  const server = http.createServer((req, res) => {
    if (req.url === '/voice.mp3' || req.url === '/bgm.mp3') {
      sameOriginAuthorization = String(req.headers.authorization || '');
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': audio.length });
      res.end(audio);
      return;
    }
    if (req.url === '/oversized.bin') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': 100 });
      res.end(Buffer.alloc(100));
      return;
    }
    if (req.url === '/invalid.mp4') {
      const invalid = Buffer.from('not-a-decodable-video');
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': invalid.length });
      res.end(invalid);
      return;
    }
    if (req.url === '/redirect-cross-origin') {
      res.writeHead(302, { location: `${blockedOrigin}/secret` });
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
      assetOrigin: origin,
      allowedAssetOrigins: [origin],
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

    const credentialDest = path.join(outDir, 'credential-check.mp3');
    await downloadTo(`${origin}/voice.mp3`, credentialDest, {
      assetOrigin: origin,
      allowedAssetOrigins: [origin],
      assetHeaders: { authorization: 'Bearer exact-origin-only' },
      maxBytes: audio.length + 1,
    });
    assert.equal(sameOriginAuthorization, 'Bearer exact-origin-only', 'credentials may be sent to the exact asset origin');
    await assert.rejects(
      downloadTo(`${origin}/redirect-cross-origin`, path.join(outDir, 'blocked.bin'), {
        assetOrigin: origin,
        allowedAssetOrigins: [origin],
        assetHeaders: { authorization: 'Bearer must-not-leak' },
        maxBytes: 1024,
      }),
      /origin is not authorized/,
    );
    assert.equal(blockedOriginHits, 0, 'cross-origin redirect must be rejected before sending a request or credential');
    const oversizedDest = path.join(outDir, 'oversized.bin');
    await assert.rejects(
      downloadTo(`${origin}/oversized.bin`, oversizedDest, { assetOrigin: origin, allowedAssetOrigins: [origin], maxBytes: 10 }),
      /exceeds 10 byte limit/,
    );
    assert.equal(fs.existsSync(oversizedDest), false, 'oversized partial asset must not remain on disk');

    const ordinaryMetadata = readContainerMetadata(result.outputPath);
    assert.doesNotMatch(ordinaryMetadata, /^ai_generated=/mi, 'ordinary render must not contain AI metadata');
    assert.doesNotMatch(ordinaryMetadata, /^contains_digital_human=/mi, 'ordinary render must not contain digital-human metadata');
    assert.doesNotMatch(ordinaryMetadata, /^content_id=/mi, 'ordinary render must not contain an AI content id');
    assert.doesNotMatch(ordinaryMetadata, /^provider=/mi, 'ordinary render must not contain an AI provider');

    const disclosed = await composite({
      jobId: 'ai-disclosure-regression',
      spec: { ratio: '1:1', duration: 1.2, bgmVol: 0, voiceVol: 100 },
      timeline: [],
      aiDisclosure: {
        required: true,
        containsDigitalHuman: true,
        label: 'untrusted-label',
        contentId: 'content-id\r\n',
        provider: 'local-gpu-worker\u0000',
      },
      bgm: { url: null },
      voiceover: { url: null },
      subtitles: { mode: 'on', cues: [{ start: 0, end: 1.2, text: '底部测试字幕' }] },
    }, () => {}, outDir);
    assert.equal(disclosed.ok, true, disclosed.error || 'digital-human render should succeed');
    assert.ok(disclosed.outputPath && fs.existsSync(disclosed.outputPath), 'labeled MP4 should exist');

    const disclosedMetadata = readContainerMetadata(disclosed.outputPath);
    assert.match(disclosedMetadata, /^ai_generated=true$/mi);
    assert.match(disclosedMetadata, /^contains_digital_human=true$/mi);
    assert.match(disclosedMetadata, /^content_id=content-id$/mi);
    assert.match(disclosedMetadata, /^provider=local-gpu-worker$/mi);
    assert.match(disclosedMetadata, /^comment=AI-generated content.*content_id.*content-id.*provider.*local-gpu-worker$/mi);
    assert.doesNotMatch(disclosedMetadata, /untrusted-label/, 'visible/metadata label must remain the fixed disclosure text');

    for (const at of [0.1, 1.0]) {
      const ordinaryCorner = extractTopRight(result.outputPath, at);
      const disclosedCorner = extractTopRight(disclosed.outputPath, at);
      const changed = changedPixelCount(ordinaryCorner, disclosedCorner);
      assert.ok(changed > 800, `AI disclosure should remain visibly burned in at ${at}s (changed pixels=${changed})`);
    }

    const failed = await composite({
      jobId: 'missing-voiceover-regression',
      assetOrigin: origin,
      allowedAssetOrigins: [origin],
      spec: { ratio: '1:1', duration: 1 },
      timeline: [],
      bgm: { url: null },
      voiceover: { url: `${origin}/missing.mp3` },
    }, () => {}, outDir);
    assert.equal(failed.ok, false, 'missing requested voiceover must fail instead of exporting a silent video');
    assert.match(String(failed.error), /口播配音读取失败/);

    const missingClip = await composite({
      jobId: 'missing-required-clip-regression',
      assetOrigin: origin,
      allowedAssetOrigins: [origin],
      spec: { ratio: '1:1', duration: 1 },
      timeline: [{ name: 'required clip', type: 'video', url: `${origin}/missing.mp4`, targetDuration: 1 }],
      bgm: { url: null },
      voiceover: { url: null },
    }, () => {}, outDir);
    assert.equal(missingClip.ok, false, 'missing required visual must fail instead of falling back to a color frame');
    assert.match(String(missingClip.error), /download .*missing\.mp4 -> 404/);

    const invalidClip = await composite({
      jobId: 'invalid-required-clip-regression',
      assetOrigin: origin,
      allowedAssetOrigins: [origin],
      spec: { ratio: '1:1', duration: 1 },
      timeline: [{ name: 'invalid clip', type: 'video', url: `${origin}/invalid.mp4`, targetDuration: 1 }],
      bgm: { url: null },
      voiceover: { url: null },
    }, () => {}, outDir);
    assert.equal(invalidClip.ok, false, 'undecodable required visual must fail closed');
    assert.match(String(invalidClip.error), /ffmpeg exited/);
    assert.equal(fs.existsSync(path.join(outDir, 'studio-invalid-required-clip-regression.mp4')), false, 'failed decode must not leave a partial MP4');
  } finally {
    server.close();
    blockedServer.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  console.log('desktop voiceover and AI-disclosure render regressions passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
