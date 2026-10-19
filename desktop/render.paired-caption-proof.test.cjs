const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ffmpegPath } = require('./render.cjs');

function ffmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
}

test('same-graph paired H.264 encodes differ without any subtitle glyph', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'caption-paired-negative-'));
  try {
    const base = path.join(directory, 'base.mp4');
    const final = path.join(directory, 'final.mp4');
    // Both outputs receive exactly the same uncaptioned frames, split before
    // encoding in one FFmpeg invocation. Different legitimate H.264 settings
    // still create decoded pixel differences; a nonzero delta is not proof
    // that a subtitle was burned into the final output.
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=1',
      '-filter_complex', '[0:v]split=2[base][final]',
      '-map', '[base]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', base,
      '-map', '[final]', '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', final]);
    const basePixels = ffmpeg(['-i', base, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
    const finalPixels = ffmpeg(['-i', final, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1']);
    assert.equal(basePixels.length, 320 * 180 * 25);
    assert.equal(finalPixels.length, basePixels.length);
    let changed = 0;
    for (let index = 0; index < basePixels.length; index++) {
      if (basePixels[index] !== finalPixels[index]) changed++;
    }
    assert.ok(changed > 1000, `uncaptioned paired H.264 outputs unexpectedly match (${changed} changed pixels)`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
