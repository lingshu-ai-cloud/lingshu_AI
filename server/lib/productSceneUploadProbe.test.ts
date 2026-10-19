import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import {
  ProductSceneUploadProbeError,
  probeProductSceneUploadVideo,
} from './productSceneUploadProbe.js';

const run = promisify(execFile);

async function makeVideo(root: string, name: string, seconds: number): Promise<string> {
  assert.ok(ffmpegStatic, 'ffmpeg-static is required for product scene upload probe tests');
  const output = path.join(root, name);
  await run(String(ffmpegStatic), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25',
    '-t', String(seconds), '-an', '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p',
    '-f', 'mp4',
    output,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  return output;
}

test('product scene probe fully decodes bytes and returns authoritative media metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'product-scene-probe-'));
  try {
    // A misleading extension must not matter: the uploaded bytes are the authority.
    const video = await makeVideo(root, 'scene.bin', 1.2);
    const result = await probeProductSceneUploadVideo(video);
    assert.ok(result.durationSeconds >= 1.15 && result.durationSeconds <= 1.3, `unexpected duration ${result.durationSeconds}`);
    assert.equal(result.width, 320);
    assert.equal(result.height, 180);
    assert.ok(result.decodedFrameCount >= 29);
    assert.equal(result.verificationMethod, 'ffmpeg_full_decode');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('product scene probe accepts any positive duration after complete decode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'product-scene-probe-duration-'));
  try {
    const video = await makeVideo(root, 'long-scene.mp4', 7.4);
    const result = await probeProductSceneUploadVideo(video);
    assert.ok(result.durationSeconds >= 7.3, `unexpected duration ${result.durationSeconds}`);
    assert.ok(result.decodedFrameCount >= 180);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('product scene probe rejects non-video and corrupt bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'product-scene-probe-invalid-'));
  try {
    const corrupt = path.join(root, 'pretend-video.mp4');
    await fs.writeFile(corrupt, 'not a decodable video');
    await assert.rejects(
      probeProductSceneUploadVideo(corrupt),
      (error: unknown) => error instanceof ProductSceneUploadProbeError
        && error.code === 'product_scene_media_invalid',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
