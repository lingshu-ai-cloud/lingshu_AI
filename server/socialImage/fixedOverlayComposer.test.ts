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

test('single poster frame preserves the source product label pixels instead of cutting out white packaging', async () => {
  const background = await sharp({ create: { width: 320, height: 400, channels: 3, background: '#742447' } }).png().toBuffer();
  const product = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#ffffff' } })
    .composite([{ input: Buffer.from('<svg width="80" height="80"><text x="8" y="44" font-size="20" fill="#000">LABEL</text></svg>') }]).png().toBuffer();
  const result = await composeFixedSocialLayers({ background, products: [product], poster: {},
    width: 320, height: 400, productTreatment: 'framed_source' });
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  const center = (Math.floor(info.height * .61) * info.width + Math.floor(info.width * .5)) * info.channels;
  assert.ok(data[center]! > 220 && data[center + 1]! > 220 && data[center + 2]! > 220,
    'the authoritative white package/card pixels remain visible');
  const edge = (Math.floor(info.height * .61) * info.width + 60) * info.channels;
  assert.ok(data[edge]! < data[center]! - 70,
    'a framed source photo fades into the scene instead of retaining a hard rectangular edge');
});

test('reference-left poster wraps a long headline and keeps the original square product photo inside its slot', async () => {
  const background = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#071017' } }).png().toBuffer();
  const product = await sharp({ create: { width: 180, height: 180, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const result = await composeFixedSocialLayers({ background, products: [product], width: 600, height: 600,
    poster: { headline: 'CLOUD FOAM CLEANSING HONEY', subheadline: 'Gentle.\nFoam-rich.\nSkin-barrier friendly.', cta: 'Inquire' },
    productTreatment: 'framed_source', referenceTextRegion: 'top_left' });
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.ok(pixel(370, 340).every(value => value > 240), 'the original white source photo remains intact in the product slot');
  assert.ok(pixel(570, 80).every(value => value < 40), 'the wrapped headline never reaches the far right edge');
  const brightCopyPixels = Array.from({ length: 180 }, (_, y) => Array.from({ length: 250 }, (_, x) => pixel(x, y))
    .filter(rgb => rgb.every(value => value > 200)).length).reduce((sum, value) => sum + value, 0);
  assert.ok(brightCopyPixels > 500, 'headline stays visible in the reference top-left region');
});

test('one local typography repair adds contrast without changing the product source pixels', async () => {
  const background = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#f4f4f4' } }).png().toBuffer();
  const product = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const base = { background, products: [product], width: 600, height: 600,
    poster: { headline: 'Visible headline', subheadline: 'Support', cta: 'Contact' },
    productTreatment: 'framed_source' as const, referenceTextRegion: 'top_left' as const };
  const first = await composeFixedSocialLayers(base);
  const repaired = await composeFixedSocialLayers({ ...base, repairContrast: true });
  const firstRaw = await sharp(first).raw().toBuffer({ resolveWithObject: true });
  const nextRaw = await sharp(repaired).raw().toBuffer({ resolveWithObject: true });
  const pixel = (data: Buffer, channels: number, x: number, y: number) => [...data.subarray((y * 600 + x) * channels, (y * 600 + x) * channels + 3)];
  assert.ok(pixel(firstRaw.data, firstRaw.info.channels, 265, 20)[0]! > 220);
  assert.ok(pixel(nextRaw.data, nextRaw.info.channels, 265, 20)[0]! < 70);
  assert.deepEqual(pixel(nextRaw.data, nextRaw.info.channels, 410, 365), pixel(firstRaw.data, firstRaw.info.channels, 410, 365));
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
