import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eligibleStudioEmphasisSource, localStudioMediaPath } from './studioRenderEmphasisPrepass.js';

test('resolves only existing video files below the media root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-emphasis-media-'));
  const video = path.join(root, 'tenants', 'demo', 'clip.mp4');
  fs.mkdirSync(path.dirname(video), { recursive: true });
  fs.writeFileSync(video, 'video');
  assert.equal(localStudioMediaPath('http://127.0.0.1:5179/media/tenants/demo/clip.mp4?token=x', root), video);
  assert.equal(localStudioMediaPath('/media/%2e%2e/secret.mp4', root), null);
  assert.equal(localStudioMediaPath('/covers/clip.mp4', root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('enables automatic preanalysis only for a single 1:1 video timeline', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-emphasis-media-'));
  const video = path.join(root, 'clip.mp4');
  fs.writeFileSync(video, 'video');
  const clip = { url: '/media/clip.mp4', type: 'video' };
  assert.equal(eligibleStudioEmphasisSource({ timeline: [clip], durationSeconds: 10, mediaRoot: root }), video);
  assert.equal(eligibleStudioEmphasisSource({ timeline: [clip, clip], durationSeconds: 10, mediaRoot: root }), null);
  assert.equal(eligibleStudioEmphasisSource({ timeline: [{ ...clip, trimStart: 2 }], durationSeconds: 10, mediaRoot: root }), null);
  assert.equal(eligibleStudioEmphasisSource({ timeline: [{ ...clip, targetDuration: 8 }], durationSeconds: 10, mediaRoot: root }), null);
  fs.rmSync(root, { recursive: true, force: true });
});
