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

test('fixed compositor applies extracted mask opacity in the extracted layer order', async () => {
  const background = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const result = await composeFixedSocialLayers({ background, products: [], poster: {}, width: 100, height: 100, recipe: {
    contentArchetype: 'poster', imageCopyRelation: 'image_contextualizes_copy', preserve: [], replace: [], palette: [], layoutRegions: [],
    protectedSubjects: [], overlayZones: [], referenceLayerBlueprints: [{ imageIndex: 1,
      layers: [{ id: 'bg', role: 'background', zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1 }, { id: 'mask', role: 'mask', zIndex: 2, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1 }],
      masks: [{ id: 'red', shape: 'rectangle', bounds: { x: 0, y: 0, width: 1, height: 1 }, opacity: .5, color: '#ff0000', zIndex: 2, confidence: 1 }] }],
  } });
  const { data } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0]! > 100 && data[2]! > 100, 'half-opacity red mask must blend over blue background');
});

test('fixed compositor rejects a foreground mask that obscures the product stage', async () => {
  const background = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#0000ff' } }).png().toBuffer();
  await assert.rejects(composeFixedSocialLayers({ background, products: [], poster: {}, width: 100, height: 100, recipe: {
    contentArchetype: 'poster', imageCopyRelation: 'image_contextualizes_copy', preserve: [], replace: [], palette: [], layoutRegions: [],
    protectedSubjects: [], overlayZones: [], referenceLayerBlueprints: [{ imageIndex: 1,
      layers: [{ id: 'product', role: 'product', zIndex: 3, bounds: { x: .08, y: .36, width: .84, height: .5 }, confidence: 1 }],
      masks: [{ id: 'cover', shape: 'rectangle', bounds: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, color: '#ff0000', zIndex: 4, confidence: 1 }] }],
  } }), /超过 12%/);
});
