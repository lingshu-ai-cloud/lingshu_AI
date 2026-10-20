import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createSocialImageGif } from '../routes/studio.js';

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
