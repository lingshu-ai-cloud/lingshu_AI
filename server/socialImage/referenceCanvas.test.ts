import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { conformSocialImageToCanvas, socialImageCanvasFromBenchmark } from './referenceCanvas.js';

test('benchmark pixel dimensions become the exact replication canvas', async () => {
  const benchmark = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#fff' } }).png().toBuffer();
  const canvas = await socialImageCanvasFromBenchmark(benchmark);
  assert.deepEqual(canvas, { width: 1080, height: 1350, aspectRatio: 0.8, providerRatio: '4:5' });
});
test('generated output is normalized to the benchmark ratio and dimensions', async () => {
  const generated = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#000' } }).png().toBuffer();
  const output = await conformSocialImageToCanvas(generated, { width: 1080, height: 1350, aspectRatio: 0.8, providerRatio: '4:5' });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
});
