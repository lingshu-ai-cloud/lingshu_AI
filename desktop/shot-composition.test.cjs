const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { layoutFilters, tempoFilters, muteIntervals } = require('./shot-composition.cjs');
const { composite, ffmpegPath } = require('./render.cjs');
// Decode actual output pixels/audio, rather than accepting a successful FFmpeg exit alone.
function pixel(file, x, y, time = 0.5) {
  return [...execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
    '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])];
}
function rms(file, start, duration = 0.5) {
  const bytes = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', file,
    '-t', String(duration), '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
  assert.ok(bytes.length > 0, 'output must contain a decodable audio stream');
  let sum = 0; for (let i = 0; i < bytes.length; i += 4) sum += bytes.readFloatLE(i) ** 2;
  return Math.sqrt(sum / (bytes.length / 4));
}
test('layout and audio filters reject missing layers and mute only the correct intervals', () => {
  assert.throws(() => layoutFilters({ source: '[0:v]null', index: 0, width: 1080, height: 1080, target: 1, layout: 'split' }), /缺少产品/);
  assert.throws(() => layoutFilters({ source: '[0:v]null', index: 0, width: 1080, height: 1080, target: 1, backgroundIndex: 1 }), /透明/);
  assert.equal(tempoFilters(0.25), 'atempo=0.5,atempo=0.50000');
  const clips = [{ targetDuration: 1, production: { sound: 'source' } }, { targetDuration: 1, production: { sound: 'silent' } }];
  assert.match(muteIntervals(clips, 'voiceover'), /between\(t,0.000,1.000\).*between\(t,1.000,2.000\)/);
  assert.doesNotMatch(muteIntervals(clips, 'bgm'), /0.000,1.000/);
});
test('real FFmpeg exports full, split, pip and mixed source/voiceover audio locally', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lingshu-shot-test-'));
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x320:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'person.mp4')]);
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=320x320:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'product.mp4')]);
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red@0.5:s=320x320:r=30:d=1,format=yuva420p', '-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', path.join(dir, 'alpha.webm')]);
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=yellow:s=320x320', '-frames:v', '1', path.join(dir, 'product.png')]);
  const server = http.createServer((req, res) => { const file = ['/person.mp4', '/product.mp4', '/alpha.webm', '/product.png'].includes(req.url) ? req.url.slice(1) : 'product.mp4'; res.end(readFileSync(path.join(dir, file))); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const aligned = await composite({ jobId: 'aligned-no-stretch', spec: { ratio: '1:1', duration: 2 }, voiceover: { url: `${origin}/person.mp4` }, timeline: [
      { url: `${origin}/product.mp4`, targetDuration: 1, trimEnd: 1, targetStart: 0, production: { sound: 'silent' } },
      { url: `${origin}/product.mp4`, targetDuration: 1, trimEnd: 1, targetStart: 1, voiceStart: 0.2, voiceEnd: 0.6, voiceAligned: true, production: { sound: 'voiceover' } },
    ] }, undefined, dir);
    assert.equal(aligned.ok, true, aligned.error);
    assert.ok(rms(aligned.outputPath, 0.2, 0.2) < 0.001, 'silent shot must remain silent');
    assert.ok(rms(aligned.outputPath, 1.05, 0.2) > 0.02, 'mapped speech starts at its shot');
    assert.ok(rms(aligned.outputPath, 1.65, 0.2) < 0.001, 'short speech is not slowed down to fill the shot');
    for (const layout of ['full', 'split', 'pip']) {
      const timeline = [{ url: `${origin}/person.mp4`, trimStart: 0, trimEnd: 1, speed: 1, targetDuration: 1, targetStart: 0, targetEnd: 1,
        production: { layout, sound: 'source' }, ...(layout === 'full' ? {} : { productUrl: `${origin}/product.mp4`, productType: 'video' }) }];
      const out = await composite({ jobId: layout, spec: { ratio: '1:1', duration: 1 }, timeline }, undefined, dir);
      assert.equal(out.ok, true, out.error); assert.ok(readFileSync(out.outputPath).length > 1000);
      const left = pixel(out.outputPath, 250, 540);
      const right = pixel(out.outputPath, 800, 540);
      const inset = pixel(out.outputPath, 900, 900);
      if (layout === 'full') assert.ok(left[0] > 200 && left[2] < 35, `full frame should be red: ${left}`);
      if (layout === 'split') assert.ok(left[0] > 200 && right[2] > 200, `split should preserve left presenter/right product: ${left}/${right}`);
      if (layout === 'pip') assert.ok(left[2] > 200 && inset[0] > 200, `PIP should preserve product and bottom-right presenter: ${left}/${inset}`);
      assert.ok(rms(out.outputPath, 0.2) > 0.02, 'original speech track must not disappear');
    }
    const out = await composite({ jobId: 'mixed', spec: { ratio: '1:1', duration: 2 }, voiceover: { url: `${origin}/person.mp4` }, timeline: [
      { url: `${origin}/person.mp4`, targetDuration: 1, trimEnd: 1, targetStart: 0, production: { sound: 'source' } },
      { url: `${origin}/person.mp4`, targetDuration: 1, trimEnd: 1, targetStart: 1, voiceStart: 0, voiceEnd: 1, production: { sound: 'voiceover' } },
    ] }, undefined, dir);
    assert.equal(out.ok, true, out.error);
    const firstRms = rms(out.outputPath, 0.2), secondRms = rms(out.outputPath, 1.2);
    assert.ok(firstRms > 0.02 && secondRms > 0.02, 'both source and voiceover intervals must be audible');
    assert.ok(firstRms / secondRms > 0.75 && firstRms / secondRms < 1.3, `source interval should not double the same voiceover: ${firstRms}/${secondRms}`);
    for (const layout of ['full', 'split', 'pip']) {
      const alpha = await composite({ jobId: `alpha-${layout}`, spec: { ratio: '1:1', duration: 1 }, bgm: { url: `${origin}/person.mp4` }, voiceover: { url: `${origin}/person.mp4` }, timeline: [{
        url: `${origin}/alpha.webm`, targetDuration: 1, trimEnd: 1, targetStart: 0,
        production: { sound: 'silent', layout, transparent: true }, backgroundUrl: `${origin}/product.mp4`, backgroundType: 'video',
        ...(layout === 'full' ? {} : { productUrl: `${origin}/product.png`, productType: 'image' }),
      }] }, undefined, dir);
      assert.equal(alpha.ok, true, alpha.error);
      assert.ok(rms(alpha.outputPath, 0.2) < 0.0001, 'silent shot must mute both actual BGM and voiceover');
      const blended = pixel(alpha.outputPath, layout === 'pip' ? 900 : 250, layout === 'pip' ? 900 : 540);
      assert.ok(blended[0] > 75 && blended[0] < 180 && blended[2] > 75 && blended[2] < 180 && blended[1] < 35,
        `transparent red presenter should reveal blue background, not opaque red or black: ${blended}`);
      if (layout !== 'full') { const product = pixel(alpha.outputPath, layout === 'split' ? 800 : 250, 540); assert.ok(product[0] > 200 && product[1] > 200 && product[2] < 35, `image product layer should stay yellow: ${product}`); }
    }
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); }
});
