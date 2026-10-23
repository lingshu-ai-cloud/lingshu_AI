import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createSocialImageGif } from './gifEncoder.js';
import { socialImageGifAnimationCheck } from './socialImageQuality.js';

test('GIF delivery contains every requested background state on the exact canvas', async () => {
  const frames = await Promise.all(['#1769aa', '#39a96b', '#f29f05', '#9b51e0'].map(background =>
    sharp({ create: { width: 120, height: 150, channels: 4, background } }).png().toBuffer()));
  const output = await createSocialImageGif(frames, 120, 150, 4000);
  const metadata = await sharp(output, { animated: true }).metadata();
  assert.equal(metadata.format, 'gif');
  assert.equal(metadata.width, 120);
  assert.equal(metadata.pageHeight, 150);
  assert.equal(metadata.pages, 4);
  assert.ok(output.length > 100);
});

test('GIF quality decodes every delivered frame and compares it with the reviewed composition', async () => {
  const frames = await Promise.all(['#1769aa', '#39a96b', '#f29f05', '#9b51e0'].map(background =>
    sharp({ create: { width: 1200, height: 1500, channels: 4, background } }).png().toBuffer()));
  const bytes = await createSocialImageGif(frames, 1200, 1500, 4000);
  const input = { bytes, aspectRatio: '4:5' as const, expectedFrames: 4, expectedFrameBytes: frames };
  assert.equal((await socialImageGifAnimationCheck(input)).verdict, 'pass');
  assert.equal((await socialImageGifAnimationCheck({ ...input, expectedFrameBytes: [...frames].reverse() })).verdict, 'fail');
  assert.equal((await socialImageGifAnimationCheck({ ...input, expectedFrameBytes: frames.slice(0, 3) })).verdict, 'fail');
  assert.equal((await socialImageGifAnimationCheck({ ...input, expectedFrames: 5 })).verdict, 'fail');
  assert.equal((await socialImageGifAnimationCheck({ ...input, bytes: frames[0]! })).verdict, 'fail');
  const still = await createSocialImageGif([frames[0]!, frames[0]!, frames[0]!, frames[0]!], 1200, 1500, 4000);
  assert.equal((await socialImageGifAnimationCheck({ ...input, bytes: still,
    expectedFrameBytes: Array(4).fill(frames[0]!) as Buffer[] })).verdict, 'fail');
});
