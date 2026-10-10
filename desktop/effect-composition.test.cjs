/* eslint-disable */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { composite, ffmpegPath } = require('./render.cjs');
const { normalizeEffectPlan, sceneEffectFilters, joinSceneFilters, audioEventFilters } = require('./effect-composition.cjs');

test('desktop EffectPlan normalizer never forwards arbitrary FFmpeg', () => {
  const plan = normalizeEffectPlan({
    intensity: 2,
    scenes: [{ sceneId: 'a', motion: 'movie=/etc/passwd', color: 'evil', transitionOut: { type: 'filter_complex', duration: 5 }, overlays: [{ presetId: 'not_allowed', start: 0, end: 2 }] }],
    audioEvents: [{ presetId: 'amovie', at: 0, volume: 1 }],
  }, [{ sceneId: 'a', targetDuration: 2 }]);
  assert.equal(plan.scenes[0].motion, 'none');
  assert.equal(plan.scenes[0].color, 'original');
  assert.equal(plan.scenes[0].transitionOut.type, 'cut');
  assert.deepEqual(plan.scenes[0].overlays, []);
  assert.deepEqual(plan.audioEvents, []);
  assert.doesNotMatch(JSON.stringify(plan), /movie|filter_complex|\/etc/);
});

test('filter builders provide motion, particles, transitions and synthetic sound', () => {
  const sceneFilters = sceneEffectFilters({
    source: '[v0]', output: 've0', width: 320, height: 320, target: 1,
    intensity: 3,
    scene: { enabled: true, motion: 'push_in', color: 'warm', transitionOut: { type: 'dissolve', duration: .25 }, overlays: [{ presetId: 'petal_bloom', layer: 'around_subject', start: 0, end: 1, anchor: { x: .5, y: .5 }, scale: 1, opacity: .8 }] },
  });
  assert.match(sceneFilters.join(';'), /zoompan/);
  assert.match(sceneFilters.join(';'), /drawtext/);
  const joined = joinSceneFilters({ labels: ['[ve0]', '[ve1]'], scenes: [{ enabled: true, transitionOut: { type: 'dissolve', duration: .25 } }, { enabled: true, transitionOut: { type: 'cut', duration: 0 } }], targets: [1, 1] });
  assert.match(joined.filters.join(';'), /xfade=transition=dissolve/);
  const audio = audioEventFilters([{ presetId: 'whoosh', at: .2, volume: .4 }]);
  assert.match(audio.filters.join(';'), /anoisesrc/);
  assert.match(audio.filters.join(';'), /adelay=200\|200/);
});

test('real FFmpeg joins mixed moving and static scenes without changing approved duration', { timeout: 60_000 }, async () => {
  assert.ok(ffmpegPath, 'ffmpeg-static is required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-effect-test-'));
  try {
    const red = path.join(dir, 'red.mp4');
    const blue = path.join(dir, 'blue.mp4');
    for (const [file, color] of [[red, 'red'], [blue, 'blue']]) {
      const build = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=${color}:s=320x320:r=30:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file], { encoding: 'utf8' });
      assert.equal(build.status, 0, build.stderr);
    }
    const result = await composite({
      jobId: 'effects-real-render',
      requireVisualAssets: true,
      spec: { ratio: '1:1', resolution: '720p', duration: 2, bgmVol: 0, voiceVol: 0 },
      timeline: [
        { sceneId: 'hook', name: 'hook', type: 'video', url: red, trimStart: 0, trimEnd: 1, targetDuration: 1 },
        { sceneId: 'proof', name: 'proof', type: 'video', url: blue, trimStart: 0, trimEnd: 1, targetDuration: 1 },
      ],
      effectPlan: {
        schemaVersion: 1, presetId: 'dynamic', intensity: 3, beatSync: false, seed: 198,
        scenes: [
          { sceneId: 'hook', enabled: true, motion: 'push_in', color: 'warm', transitionOut: { type: 'dissolve', duration: .25 }, overlays: [{ presetId: 'sparkle', layer: 'around_subject', start: .05, end: .9, anchor: { x: .5, y: .5 }, scale: 1, opacity: .8 }] },
          { sceneId: 'proof', enabled: true, motion: 'none', color: 'cool', transitionOut: { type: 'cut', duration: 0 }, overlays: [] },
        ],
        audioEvents: [{ presetId: 'impact', at: .15, volume: .7 }],
      },
      bgm: { url: null }, voiceover: { url: null }, subtitles: { mode: 'off', cues: [] },
    }, () => {}, dir);
    assert.equal(result.ok, true, result.error);
    assert.ok(fs.existsSync(result.outputPath));
    const durationProbe = spawnSync(ffmpegPath, ['-hide_banner', '-i', result.outputPath, '-f', 'null', '-'], { encoding: 'utf8' });
    const match = durationProbe.stderr.match(/Duration:\s*00:00:([\d.]+)/);
    assert.ok(match, durationProbe.stderr);
    assert.ok(Math.abs(Number(match[1]) - 2) < .15, `output duration must remain 2s, got ${match[1]}`);
    // File existence and total duration do not detect a frozen first scene.
    const secondFrame = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', '1.6', '-i', result.outputPath, '-vf', 'scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(secondFrame.status, 0, String(secondFrame.stderr));
    assert.equal(secondFrame.stdout.length, 3);
    assert.ok(secondFrame.stdout[2] > secondFrame.stdout[0] + 60, 'the second scene must be blue, not a repeated first red frame');
    const audioProbe = spawnSync(ffmpegPath, ['-hide_banner', '-i', result.outputPath, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const mean = Number((audioProbe.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1]);
    assert.ok(Number.isFinite(mean) && mean > -70, `synthetic effect event must be audible, mean=${mean}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
