import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { composeFixedSocialLayers } from './fixedOverlayComposer.js';
import { socialImageBuyerLayout, socialImageBuyerOverlaySvg } from './socialImageBuyerOverlay.js';
import { buildSocialImagePosterPlatePrompt } from './socialImagePosterPlatePrompt.js';

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

test('cutout treatment refuses an opaque source instead of silently feathering it', async () => {
  const background = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#376b9f' } }).png().toBuffer();
  const opaque = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(composeFixedSocialLayers({ background, products: [opaque], poster: { headline: 'PRODUCT' },
    width: 320, height: 320, productTreatment: 'cutout' }), /social_image_reviewed_product_cutout_required/);
});

test('cutout treatment preserves transparent product silhouette and original center pixel', async () => {
  const background = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#376b9f' } }).png().toBuffer();
  const cutout = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#00000000' } })
    .composite([{ input: Buffer.from('<svg width="80" height="80"><rect x="20" y="8" width="40" height="64" fill="#d23838"/></svg>') }]).png().toBuffer();
  const result = await composeFixedSocialLayers({ background, products: [cutout], poster: { headline: 'PRODUCT' },
    width: 320, height: 320, productTreatment: 'cutout' });
  const product = await sharp(result).extract({ left: 160, top: 196, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...product], [210, 56, 56]);
});

test('integrated scene receives copy without pasting a second product photo', async () => {
  const scene = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#416db7' } }).png().toBuffer();
  const unrelatedProduct = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#ff0000' } }).png().toBuffer();
  const result = await composeFixedSocialLayers({ background: scene, products: [unrelatedProduct],
    poster: { headline: 'CREAM' }, width: 320, height: 320, productTreatment: 'integrated_scene' });
  const rgb = await sharp(result).extract({ left: 160, top: 190, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...rgb.subarray(0, 3)], [65, 109, 183], 'scene pixels remain intact; no rectangular source overlay');
});

test('approved B2B fallback draws verified buyer information over the existing scene', async () => {
  const scene = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#d9eaf3' } }).png().toBuffer();
  const poster = { originBadge: 'GUIANFA', headline: 'Sorbet Cream', subheadline: 'Cool-touch sorbet texture',
    sellingPoints: ['Face cream', 'Cool-touch sorbet texture', 'SKU: GUIANFA-RS-005'],
    bottomBar: ['50g', 'B2B SOURCING', 'Ask about order size, packaging & timing'],
    cta: 'Message us for catalog and quote' };
  const result = await composeFixedSocialLayers({ background: scene, products: [], poster,
    width: 1200, height: 1200, productTreatment: 'integrated_scene' });
  assert.deepEqual((await sharp(result).metadata()).width, 1200);
  const center = await sharp(result).extract({ left: 600, top: 600, width: 1, height: 1 }).raw().toBuffer();
  const original = await sharp(scene).extract({ left: 600, top: 600, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...center.subarray(0, 3)], [...original.subarray(0, 3)], 'the real product stage is not obscured by a synthetic box');
  const sceneAbove = await sharp(result).extract({ left: 600, top: 120, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...sceneAbove.subarray(0, 3)], [...original.subarray(0, 3)],
    'the scene above the product stays unchanged outside the compact copy card');
  const seal = await sharp(result).extract({ left: 1040, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(seal[0]! < 80 && seal[1]! < 150, 'the top-right buyer facts sit inside a visible dark product seal');
  const heroEdge = await sharp(result).extract({ left: 920, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(heroEdge[0]! > 170 && heroEdge[1]! > 190,
    'the outer-corner seal leaves the inner edge of the right-hand product hero unobscured');
  const footer = await sharp(result).extract({ left: 600, top: 1150, width: 1, height: 1 }).raw().toBuffer();
  assert.notDeepEqual([...footer.subarray(0, 3)], [...original.subarray(0, 3)], 'the buyer footer is present');
  const footerCorner = await sharp(result).extract({ left: 10, top: 1090, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const footerFarCorner = await sharp(result).extract({ left: 1190, top: 1090, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...footerCorner], [...footerFarCorner], 'CTA is a solid full-width rectangular block');
  assert.ok(footerCorner[0]! < 50 && footerCorner[1]! < 100, 'the cool-blue CTA block is distinctly darker than the scene');
});

test('identity-locked buyer poster keeps real product pixels and omits the white card on a quiet light scene', async () => {
  const background = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#f4e9e8' } }).png().toBuffer();
  const product = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fafafa' } })
    .composite([{ input: Buffer.from('<svg width="300" height="300"><rect x="95" y="95" width="110" height="110" fill="#bd3462"/></svg>') }]).png().toBuffer();
  const poster = { originBadge: 'GUIANFA', headline: 'PEACH ICE FROST',
    sellingPoints: ['Face cream', 'SKU: GUIANFA-RS-006'], bottomBar: ['50 g', 'OEM / ODM', 'Ask about packaging'],
    cta: 'Message us for catalog and quote' };
  const output = await composeFixedSocialLayers({ background, products: [product], poster,
    width: 1200, height: 1200, productTreatment: 'framed_source' });
  const pixel = async (bytes: Buffer, left: number, top: number) => [...(await sharp(bytes)
    .extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()).subarray(0, 3)];
  assert.deepEqual(await pixel(output, 200, 430), await pixel(background, 200, 430),
    'a pale quiet scene needs no white card behind the buyer copy');
  assert.deepEqual(await pixel(output, 770, 636), [189, 52, 98],
    'the product center comes from the source photograph rather than a model redraw');
  assert.deepEqual(await pixel(output, 1151, 400), await pixel(background, 1151, 400),
    'the source photo edge reaches zero opacity instead of leaving a rectangular border');
  assert.deepEqual(await pixel(output, 600, 120), await pixel(background, 600, 120),
    'the scene outside text and product keeps its details');
});

test('identity-locked buyer poster derives a readable backing from a dark scene instead of pasting white', async () => {
  const background = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#3f2939' } }).png().toBuffer();
  const product = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  const output = await composeFixedSocialLayers({ background, products: [product], width: 1200, height: 1200,
    poster: { originBadge: 'GUIANFA', headline: 'PEACH ICE FROST', sellingPoints: ['Face cream'],
      bottomBar: ['50 g', 'OEM / ODM', 'Ask about packaging'], cta: 'Message us' },
    productTreatment: 'framed_source' });
  const card = await sharp(output).extract({ left: 200, top: 430, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(card[0]! > 63 && card[1]! > 41 && card[2]! > 57, 'the derived color lifts the dark copy zone');
  assert.ok(card[0]! > card[2]! && card[2]! > card[1]!, 'the backing retains the source burgundy hue');
  assert.ok(Math.max(...card) < 230, 'the card is tinted rather than white');
});

test('contrast repair preserves a warm background color family under the copy', async () => {
  const background = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#dfb9a4' } }).png().toBuffer();
  const product = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
  const output = await composeFixedSocialLayers({ background, products: [product], width: 1200, height: 1200,
    poster: { originBadge: 'GUIANFA', headline: 'FACE CREAM', sellingPoints: ['Face cream'],
      bottomBar: ['50 g', 'OEM / ODM', 'Ask about packaging'], cta: 'Message us' },
    productTreatment: 'framed_source', repairContrast: true });
  const card = await sharp(output).extract({ left: 200, top: 430, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(card[0]! > card[1]! && card[1]! > card[2]!, 'the repair backing follows the warm source hue');
  assert.ok(Math.max(...card) < 250, 'repair does not introduce a white sticker');
});

test('contrast repair uses one translucent copy panel and repeats verified net content in readable copy', () => {
  const svg = socialImageBuyerOverlaySvg(1200, 1200, {
    originBadge: 'GUIANFA', headline: 'FACE CREAM', sellingPoints: ['Face cream', 'SKU: GUIANFA-RS-016'],
    bottomBar: ['50 g', 'B2B SOURCING', 'Ask about packaging'], cta: 'Message us',
  }, true, 'warm', 'local').toString();
  assert.equal((svg.match(/fill-opacity="\.88"/g) || []).length, 1);
  assert.match(svg, /SKU: GUIANFA-RS-016 · 50 g/);
});

test('mist poster reserves a readable upper-left OEM/ODM block without covering the product center', async () => {
  const product = readFileSync(new URL('../../fixtures/beauty-showcase/media/tenants/local_tenant_customer_aurelia_beauty/rongshang-product-03.png', import.meta.url));
  const poster = { originBadge: 'GUIANFA', headline: 'DEEP SEA MIST',
    sellingPoints: ['Facial mist', 'Request OEM/ODM info', 'SKU: GUIANFA-RS-003'],
    bottomBar: ['180 ml', 'OEM / ODM', 'Order size · Packaging · Timing?'],
    cta: 'Message us for catalog and quote' };
  const svg = socialImageBuyerOverlaySvg(1200, 1200, poster).toString();
  assert.match(svg, /<text[^>]+font-size="54"[^>]*>OEM \/ ODM<\/text>/);
  assert.match(svg, /<text[^>]+font-size="54"[^>]*>DEEP SEA<\/text>/);
  assert.match(svg, /<text[^>]+font-size="54"[^>]*>MIST<\/text>/);
  assert.match(svg, /<rect x="50" y="38" width="438"/);
  assert.doesNotMatch(svg, /topWash|height="528" fill="url/);
  const result = await composeFixedSocialLayers({ background: product, products: [product], poster,
    width: 1200, height: 1200, productTreatment: 'integrated_scene' });
  const center = await sharp(result).extract({ left: 600, top: 700, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const source = await sharp(product).resize(1200, 1200, { fit: 'cover', position: 'attention' })
    .extract({ left: 600, top: 700, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...center], [...source]);
});

test('buyer headline stays inside the single copy card for short and product-specific English names', async () => {
  const base = { originBadge: 'GUIANFA', sellingPoints: ['Face cream', 'SKU: GUIANFA-RS-006'],
    bottomBar: ['50 g', 'OEM / ODM', 'Ask about packaging'], cta: 'Message us for quote' };
  const generic = socialImageBuyerOverlaySvg(1200, 1200, { ...base, headline: 'FACE CREAM' }).toString();
  assert.doesNotMatch(generic, />FACE CREAM<\/text>/, 'a wide one-line title must wrap inside the card');
  assert.match(generic, />FACE<\/text>/);
  assert.match(generic, />CREAM<\/text>/);
  const specific = socialImageBuyerOverlaySvg(1200, 1200, { ...base, headline: 'PEACH ICE FROST' }).toString();
  assert.match(specific, />PEACH ICE<\/text>/);
  assert.match(specific, />FROST<\/text>/);
});

test('buyer copy density changes both the reserved text zone and the product placement request', () => {
  const compact = { originBadge: 'GUIANFA', headline: 'DEEP SEA MIST',
    sellingPoints: ['Facial mist', 'Request OEM/ODM info'], bottomBar: ['180 ml', 'OEM / ODM', 'Ask us'],
    cta: 'Message us' };
  const dense = { ...compact, sellingPoints: ['Verified custom packaging consultation available'] };
  const compactLayout = socialImageBuyerLayout(compact);
  const denseLayout = socialImageBuyerLayout(dense);
  assert.ok(denseLayout.copyRight > compactLayout.copyRight);
  assert.ok(denseLayout.heroCenter > compactLayout.heroCenter);
  assert.ok(compactLayout.heroCenter + .12 < compactLayout.sealLeft,
    'a typical single bottle has a gap before the top-right badge');
  const compactPrompt = buildSocialImagePosterPlatePrompt({ ratio: '1:1', buyerPoster: compact });
  const densePrompt = buildSocialImagePosterPlatePrompt({ ratio: '1:1', buyerPoster: dense });
  assert.match(compactPrompt, /left 40%/);
  assert.match(densePrompt, /left 44%/);
  assert.match(compactPrompt, /stage near 64% width empty for our real product photo/);
  assert.match(densePrompt, /stage near 66% width empty for our real product photo/);
});

test('a different peach product changes the buyer poster color family', async () => {
  const product = readFileSync(new URL('../../fixtures/beauty-showcase/media/tenants/local_tenant_customer_aurelia_beauty/rongshang-product-06.png', import.meta.url));
  const poster = { originBadge: 'GUIANFA', headline: 'PEACH ICE FROST',
    sellingPoints: ['Face cream', 'SKU: GUIANFA-RS-006'],
    bottomBar: ['50 g', 'B2B SOURCING', 'Order size · Packaging · Timing?'],
    cta: 'Message us for catalog and quote' };
  const result = await composeFixedSocialLayers({ background: product, products: [product], poster,
    width: 1200, height: 1200, productTreatment: 'integrated_scene' });
  const footer = await sharp(result).extract({ left: 10, top: 1090, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(footer[0]! > footer[1]!, 'peach packaging selects a warm CTA, rather than the previous cream’s blue');
  const copyBacking = await sharp(result).extract({ left: 200, top: 420, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const originalBacking = await sharp(product).resize(1200, 1200, { fit: 'cover', position: 'attention' })
    .extract({ left: 200, top: 420, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(copyBacking[1]! > originalBacking[1]! + 80,
    'the fact card lifts copy off the dark package without changing the source file');
  const center = await sharp(result).extract({ left: 600, top: 750, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const source = await sharp(product).resize(1200, 1200, { fit: 'cover', position: 'attention' })
    .extract({ left: 600, top: 750, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...center], [...source], 'the actual product is not repainted');
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

test('a source with real transparency retains edge pixels instead of receiving a rectangular feather', async () => {
  const background = await sharp({ create: { width: 320, height: 400, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const product = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="100" height="100"><rect x="0" y="20" width="30" height="60" fill="#ff0000"/></svg>') }]).png().toBuffer();
  const result = await composeFixedSocialLayers({ background, products: [product], poster: {}, width: 320, height: 400, productTreatment: 'framed_source' });
  const rgb = await sharp(result).extract({ left: 62, top: 244, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(rgb[0]! > 245 && rgb[2]! < 10, 'an opaque source edge is not faded merely because it is near the image boundary');
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
