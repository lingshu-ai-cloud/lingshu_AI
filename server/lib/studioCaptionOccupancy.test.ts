import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { analyzeStudioCaptionOccupancy, consolidateCaptionOccupancy } from './studioCaptionOccupancy.js';

const box = { x: .15, y: .72, width: .7, height: .08 };

test('requires confidence 55 and the same position in two consecutive frames', () => {
  const result = consolidateCaptionOccupancy([
    { frameId: '1', timeMs: 0, ocrTokens: [{ text: '独立包装', confidence: 80, box }, { text: 'low', confidence: 54, box: { ...box, y: .5 } }], visualBoxes: [] },
    { frameId: '2', timeMs: 500, ocrTokens: [{ text: '独立包装', confidence: 76, box: { ...box, x: .16 } }, { text: 'low', confidence: 90, box: { ...box, y: .5 } }], visualBoxes: [] },
  ]);
  assert.equal(result.source, 'ocr');
  assert.deepEqual(result.texts, ['独立包装']);
  assert.equal(result.captionBoxes.length, 1);
});

test('OCR failure retains repeated visual occupancy without blocking', () => {
  const result = consolidateCaptionOccupancy([
    { frameId: '1', timeMs: 0, ocrTokens: [], visualBoxes: [box], ocrFailed: true },
    { frameId: '2', timeMs: 500, ocrTokens: [], visualBoxes: [{ ...box, x: .16 }], ocrFailed: true },
  ]);
  assert.equal(result.source, 'visual');
  assert.equal(result.captionBoxes.length, 1);
  assert.deepEqual(result.texts, []);
  assert.equal(result.ocrFailed, true);
});

test('does not merge matching boxes across a physical shot cut', () => {
  const result = consolidateCaptionOccupancy([
    { frameId: '1', shotId: 'shot-1', timeMs: 0, ocrTokens: [{ text: '相同位置', confidence: 90, box }], visualBoxes: [box] },
    { frameId: '2', shotId: 'shot-2', timeMs: 500, ocrTokens: [{ text: '另一镜头', confidence: 90, box }], visualBoxes: [box] },
  ]);
  assert.equal(result.source, 'none');
  assert.deepEqual(result.captionBoxes, []);
});

test('crops OCR to the middle 35% through bottom 92% and uses injected worker', async () => {
  const frame = await sharp({ create: { width: 200, height: 400, channels: 3, background: '#fff' } }).png().toBuffer();
  const cropHeights: number[] = [];
  const result = await analyzeStudioCaptionOccupancy({
    frames: [{ frameId: '1', timeMs: 0, bytes: frame }, { frameId: '2', timeMs: 500, bytes: frame }],
    recognize: async bytes => { cropHeights.push((await sharp(bytes).metadata()).height || 0); return [{ text: 'Caption', confidence: 90, box }]; },
    detectVisual: async () => [],
  });
  assert.deepEqual(cropHeights, [228, 228]);
  assert.equal(result.source, 'ocr');
  assert.deepEqual(result.texts, ['Caption']);
});
