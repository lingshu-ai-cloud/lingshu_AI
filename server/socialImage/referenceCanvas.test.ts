import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { conformSocialImageToCanvas, socialImageCanvasForAspectRatio, socialImageCanvasFromBenchmark } from './referenceCanvas.js';

test('benchmark pixel dimensions become the exact replication canvas', async () => {
  const benchmark = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#fff' } }).png().toBuffer();
  const canvas = await socialImageCanvasFromBenchmark(benchmark);
  assert.deepEqual(canvas, { width: 1080, height: 1350, aspectRatio: 0.8, providerRatio: '4:5' });
});

test('all product ratios map to exact target pixels and survive normalization', async () => {
  const cases = [
    ['1:1', 1200, 1200], ['4:5', 1200, 1500], ['9:16', 1080, 1920], ['16:9', 1920, 1080],
  ] as const;
  const source = await sharp({ create: { width: 333, height: 257, channels: 3, background: '#abcdef' } }).png().toBuffer();
  for (const [ratio, width, height] of cases) {
    const canvas = socialImageCanvasForAspectRatio(ratio);
    assert.equal(canvas.width, width); assert.equal(canvas.height, height);
    const output = await conformSocialImageToCanvas(source, canvas);
    const metadata = await sharp(output).metadata();
    assert.deepEqual({ width: metadata.width, height: metadata.height }, { width, height });
  }
});
test('generated output is normalized to the benchmark ratio and dimensions', async () => {
  const generated = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#000' } }).png().toBuffer();
  const output = await conformSocialImageToCanvas(generated, { width: 1080, height: 1350, aspectRatio: 0.8, providerRatio: '4:5' });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
});
