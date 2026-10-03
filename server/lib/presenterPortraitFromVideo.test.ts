import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { selectPresenterPortraitFrame } from './presenterPortraitFromVideo.js';

const run = promisify(execFile);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presenter-portrait-test-'));
try {
  const file = path.join(dir, 'sample.mp4');
  await run(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=15',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', file]);
  const result = await selectPresenterPortraitFrame(await fs.readFile(file));
  assert.ok(result.bytes.length > 1000);
  assert.ok(result.atSeconds >= 0 && result.atSeconds < 2);
  assert.ok(result.sharpness > 0);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
