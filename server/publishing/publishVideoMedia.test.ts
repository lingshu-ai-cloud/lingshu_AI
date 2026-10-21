import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateLocalVideo } from './publishVideoMedia.js';

test('publishing media validation keeps file, extension and size boundaries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-video-media-'));
  try {
    const file = path.join(directory, 'clip.mp4');
    fs.writeFileSync(file, Buffer.alloc(1024));
    assert.equal(validateLocalVideo(file, ['.mp4'], 1), file);
    assert.throws(() => validateLocalVideo(file, ['.mov'], 1), /视频格式不受目标平台支持/);
    assert.throws(() => validateLocalVideo(file, ['.mp4'], 0), /视频超过 0MB/);
    assert.throws(() => validateLocalVideo(path.join(directory, 'missing.mp4'), ['.mp4'], 1), /待发布视频文件不存在/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
