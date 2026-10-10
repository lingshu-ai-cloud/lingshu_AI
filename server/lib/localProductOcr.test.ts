import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { LOCAL_PRODUCT_OCR_LIMITS, localProductOcrReadiness, recognizeProductImageLocally } from './localProductOcr.js';

test('local OCR readiness finds project-bundled Simplified Chinese and English data', () => {
  const ready = localProductOcrReadiness();
  assert.equal(ready.ready, true); assert.equal(ready.code, 'local_ocr_ready');
  assert.deepEqual(ready.languages.sort(), ['chi_sim', 'eng']);
});

test('local OCR normalizes an image and extracts bilingual labeled fields without a model key', async () => {
  const image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#fff' } }).png().toBuffer();
  let normalized = false;
  const text = await recognizeProductImageLocally({ bytes: image, mimeType: 'image/png' }, { recognize: async bytes => {
    const metadata = await sharp(bytes).metadata(); normalized = metadata.format === 'png';
    return '产品名称：轻盈面霜\nProduct Name: Light Cream\nSKU：CR-01';
  } });
  assert.match(text, /轻盈面霜/); assert.match(text, /Light Cream/);
  assert.equal(normalized, true);
});

test('local OCR rejects oversized encoded images before invoking the executable', async () => {
  let called = false;
  await assert.rejects(recognizeProductImageLocally({ bytes: Buffer.alloc(LOCAL_PRODUCT_OCR_LIMITS.maxEncodedBytes + 1), mimeType: 'image/png' }, {
    recognize: async () => { called = true; return ''; },
  }), /OCR_IMAGE_SIZE_LIMIT/);
  assert.equal(called, false);
});

test('bundled OCR worker recognizes a real page without an external executable or API key', async () => {
  const page = await sharp(Buffer.from('<svg width="1200" height="420" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="40" y="150" font-family="Arial" font-size="72" fill="black">Product Name: LIGHT CREAM</text><text x="40" y="280" font-family="Arial" font-size="72" fill="black">SKU: CR-01</text></svg>')).png().toBuffer();
  const text = await recognizeProductImageLocally({ bytes: page, mimeType: 'image/png' });
  assert.match(text, /Product Name/i); assert.match(text, /CR-01/i);
});
