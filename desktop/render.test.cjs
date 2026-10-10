/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { composite, ffmpegPath, extensionForAsset, isImageAsset, subtitlePages, groupSpokenCues, normalizeSubtitleCues, cuesToAss } = require('./render.cjs');

async function main() {
  assert.ok(ffmpegPath, 'ffmpeg-static is required');
  const longSubtitle = '工业激光清洁设备适用于金属表面处理，可用于多种生产场景，具体规格、工艺方案和合作条件请联系确认。';
  const pages = subtitlePages(longSubtitle);
  assert.ok(pages.length >= 2, 'long subtitles must be split into multiple timed pages');
  assert.ok(pages.every(page => page.length <= 2), 'every subtitle page must contain no more than two lines');
  assert.ok(pages.flat().every(line => Array.from(line).length <= 16), 'Chinese subtitle lines must remain inside the mobile safe width');
  assert.equal(subtitlePages('为日常通勤设计，轻巧便携。', 12.45)[0][0], '为日常通勤设计，', 'prefer punctuation over breaking a Chinese phrase');
  const normalizedCues = normalizeSubtitleCues([{ start: 0, end: 4, text: longSubtitle }]);
  assert.equal(normalizedCues[0].start, 0);
  assert.equal(normalizedCues.at(-1).end, 4);
  assert.ok(normalizedCues.every(cue => (cue.text.match(/\\N/g) || []).length <= 1));
  const ass = cuesToAss([{ start: 0, end: 4, text: longSubtitle }], 1080, 1920);
  assert.match(ass, /\\N/, 'ASS output must contain an explicit safe line break');
  assert.match(ass, /WrapStyle: 0/, 'ASS output must permit renderer wrapping as a final safety net');
  const spokenCues = [
    { start: 0.2, end: 1.2, text: 'Then check the product' },
    { start: 1.26, end: 2.1, text: 'specifications' },
    { start: 2.16, end: 2.8, text: 'separately.' },
    { start: 3.4, end: 4.2, text: 'Next question.' },
  ];
  const phrases = groupSpokenCues(spokenCues);
  assert.equal(phrases.length, 2, 'short fragments merge but sentence pauses remain');
  const mobileCues = normalizeSubtitleCues(spokenCues, { maxUnitsPerLine: 12.45 });
  assert.equal(mobileCues[0].start, 0.2);
  assert.equal(mobileCues.filter(cue => cue.start < 3).at(-1).end, 2.8);
  assert.equal(mobileCues.find(cue => cue.start >= 3)?.start, 3.4, 'do not fill the audible pause');
  assert.equal(mobileCues.map(cue => cue.text.replace(/\\N/g, ' ')).join(' '), spokenCues.map(cue => cue.text).join(' '));
  assert.ok(subtitlePages('product specifications separately', 12.45).flat().join(' ').includes('specifications'), 'English words are never split');
  assert.equal(subtitlePages('한국어 문장을 유지합니다', 12.45).flat().join(' '), '한국어 문장을 유지합니다', 'Korean word spacing survives layout');
  assert.match(ass, /Style: Default,Source Han Sans SC,72,/, 'default subtitle size stays readable on a 1080px short edge');
  assert.match(ass, /,92,92,461,1/, 'captions sit at the 76% reading line above bottom UI');
  const emphasisOnlyAss = cuesToAss([], 1080, 1920, '', 3, {}, {
    profile: 'talking_head',
    events: [{ type: 'hook', text: '核心卖点', startMs: 0, endMs: 1200, strength: 'strong', anchor: { x: .5, y: .18 } }],
  });
  assert.match(emphasisOnlyAss, /核心卖点/, 'emphasis renders even when the segment has no spoken subtitle');
  const audio = fs.readFileSync(path.join(__dirname, '../server/assets/bgm/tech-pulse.mp3'));
  let servedImage;
  let ownedImageRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/media-url') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: '/owned.png' }));
      return;
    }
    if (req.url === '/owned.png' && servedImage) {
      ownedImageRequests++;
      assert.equal(req.headers.authorization, 'Bearer local-test');
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(servedImage);
      return;
    }
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
    const bgmTone = path.join(outDir, 'bgm-tone.wav');
    const voiceWithPauses = path.join(outDir, 'voice-with-pauses.wav');
    const bgmBuild = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.2', '-y', bgmTone], { encoding: 'utf8' });
    const voiceBuild = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.5*sin(2*PI*880*t)*between(t\\,0.4\\,0.8):s=44100:d=1.2', '-y', voiceWithPauses], { encoding: 'utf8' });
    assert.equal(bgmBuild.status, 0, bgmBuild.stderr);
    assert.equal(voiceBuild.status, 0, voiceBuild.stderr);
    const bgmDataUrl = `data:audio/wav;base64,${fs.readFileSync(bgmTone).toString('base64')}`;
    const voiceDataUrl = `data:audio/wav;base64,${fs.readFileSync(voiceWithPauses).toString('base64')}`;
    const productImage = path.join(outDir, 'owned-product.png');
    const imageBuild = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x320:r=1', '-frames:v', '1', '-y', productImage], { encoding: 'utf8' });
    assert.equal(imageBuild.status, 0, imageBuild.stderr);
    servedImage = fs.readFileSync(productImage);
    const relativeVisual = await composite({
      jobId: 'relative-media-url-regression', requireVisualAssets: true,
      assetOrigin: origin, assetHeaders: { authorization: 'Bearer local-test' },
      spec: { ratio: '1:1', duration: 1, bgmVol: 0, voiceVol: 0 },
      timeline: [{ type: 'image', url: '/media-url', start: 0, duration: 1 }],
      subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(relativeVisual.ok, true, relativeVisual.error);
    const beforeRepeated = ownedImageRequests;
    const repeatedVisual = await composite({
      jobId: 'reused-visual-download', requireVisualAssets: true,
      assetOrigin: origin, assetHeaders: { authorization: 'Bearer local-test' },
      spec: { ratio: '1:1', duration: 2, bgmVol: 0, voiceVol: 0 },
      timeline: [
        { type: 'image', url: '/owned.png', targetDuration: 1 },
        { type: 'image', url: '/owned.png', targetDuration: 1 },
      ],
      subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(repeatedVisual.ok, true, repeatedVisual.error);
    assert.equal(ownedImageRequests - beforeRepeated, 1, 'the same read-only source must be downloaded once per render');
    const productDataUrl = `data:image/png;base64,${fs.readFileSync(productImage).toString('base64')}`;
    assert.equal(extensionForAsset(productDataUrl, 'image'), 'png', 'data URL extension must come from MIME instead of the base64 payload');
    assert.equal(isImageAsset(productDataUrl), true, 'image data URL must be bound as a still-image timeline input');
    const visual = await composite({
      jobId: 'owned-data-url-regression',
      requireVisualAssets: true,
      spec: { ratio: '1:1', duration: 1, bgmVol: 0, voiceVol: 0 },
      timeline: [{ name: '真实产品图', type: 'image', url: productDataUrl, targetDuration: 1 }],
      bgm: { url: null }, voiceover: { url: null }, subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(visual.ok, true, visual.error || 'owned data URL render should succeed');
    const visualFrame = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', visual.outputPath, '-frames:v', '1', '-vf', 'scale=64:64,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
    assert.equal(visualFrame.status, 0, String(visualFrame.stderr));
    const pixels = visualFrame.stdout;
    const visualMean = [...pixels].reduce((sum, value) => sum + value, 0) / pixels.length;
    const visualDeviation = Math.sqrt([...pixels].reduce((sum, value) => sum + (value - visualMean) ** 2, 0) / pixels.length);
    assert.ok(visualDeviation > 10, `owned image must appear in output instead of a solid fallback (deviation=${visualDeviation})`);

    const manyScenes = await composite({
      jobId: 'bounded-many-scene-render', requireVisualAssets: true,
      spec: { ratio: '9:16', resolution: '720p', duration: 2.04, bgmVol: 0, voiceVol: 0 },
      timeline: Array.from({ length: 17 }, (_, index) => ({
        sceneId: `scene-${index + 1}`, name: `镜头 ${index + 1}`, type: 'image',
        url: productDataUrl, targetStart: index * .12, targetDuration: .12,
      })),
      bgm: { url: null }, voiceover: { url: null }, subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(manyScenes.ok, true, manyScenes.error || 'large timelines must use bounded visual decoding');
    assert.ok(fs.statSync(manyScenes.outputPath).size > 0);

    const result = await composite({
      jobId: 'voiceover-regression',
      spec: { ratio: '1:1', duration: 1.2, bgmVol: 20, voiceVol: 100 },
      timeline: [],
      bgm: { url: bgmDataUrl },
      voiceover: { url: voiceDataUrl },
      subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(result.ok, true, result.error || 'render should succeed');
    assert.ok(result.outputPath && fs.existsSync(result.outputPath), 'rendered MP4 should exist');
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', result.outputPath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const mean = Number((probe.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1]);
    assert.ok(Number.isFinite(mean) && mean > -70, `voiceover mix should not be silent (mean=${mean})`);
    const quietProbe = spawnSync(ffmpegPath, ['-hide_banner', '-ss', '0.1', '-t', '0.2', '-i', result.outputPath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const quietMean = Number((quietProbe.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1]);
    assert.ok(Number.isFinite(quietMean) && quietMean >= -34, `20% BGM must remain audible at its displayed final-mix level during voice pauses (mean=${quietMean})`);

    const failed = await composite({
      jobId: 'missing-voiceover-regression',
      spec: { ratio: '1:1', duration: 1 },
      timeline: [],
      bgm: { url: null },
      voiceover: { url: `${origin}/missing.mp3` },
    }, () => {}, outDir);
    assert.equal(failed.ok, false, 'missing requested voiceover must fail instead of exporting a silent video');
    assert.match(String(failed.error), /口播配音读取失败/);

    const missingVisual = await composite({
      jobId: 'missing-owned-visual-regression', requireVisualAssets: true,
      spec: { ratio: '1:1', duration: 1 },
      timeline: [{ name: '已绑定但丢失的产品图', type: 'image', url: path.join(outDir, 'missing-product.png'), targetDuration: 1 }],
      bgm: { url: null }, voiceover: { url: null }, subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(missingVisual.ok, false, 'a declared owned timeline must not silently render the blue fallback');
    assert.match(String(missingVisual.error), /时间线素材全部读取失败/);
    const partialVisual = await composite({
      jobId: 'partial-owned-visual-regression', requireVisualAssets: true,
      spec: { ratio: '1:1', duration: 2 },
      timeline: [
        { name: '已绑定产品图', type: 'image', url: productDataUrl, targetDuration: 1 },
        { name: '丢失的第二镜', type: 'image', url: path.join(outDir, 'missing-second-shot.png'), targetDuration: 1 },
      ],
      bgm: { url: null }, voiceover: { url: null }, subtitles: { mode: 'off', cues: [] },
    }, () => {}, outDir);
    assert.equal(partialVisual.ok, false, 'one playable shot must not hide a missing second shot');
    assert.match(String(partialVisual.error), /时间线素材不完整.*片段 2/);
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
