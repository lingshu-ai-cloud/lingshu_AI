import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { composeFixedSocialLayers } from './fixedOverlayComposer.js';

test('fixed GIF compositor preserves exact canvas and produces a visible product overlay', async () => {
  const background = await sharp({ create: { width: 320, height: 400, channels: 3, background: '#376b9f' } }).png().toBuffer();
  const product = await sharp({ create: { width: 80, height: 160, channels: 4, background: { r: 245, g: 245, b: 245, alpha: 1 } } })
    .composite([{ input: Buffer.from('<svg width="80" height="160"><rect x="22" y="8" width="36" height="144" rx="12" fill="#d23838"/></svg>') }]).png().toBuffer();
  const result = await composeFixedSocialLayers({ background, products: [product], poster: { headline: 'NEWS', subheadline: 'Stable frame', cta: 'Contact us' }, width: 320, height: 400 });
  const metadata = await sharp(result).metadata();
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 400);
  assert.ok(result.length > background.length);
});
