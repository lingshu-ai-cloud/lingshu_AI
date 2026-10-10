import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { compositeProductIdentityLayer } from './productIdentityLayer.js';

const size = 100;
const background = await sharp({ create: { width: size, height: size, channels: 4, background: '#cccccc' } }).png().toBuffer();
const product = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00000000' } })
  .composite([{ input: Buffer.from('<svg width="20" height="20"><rect x="2" y="2" width="16" height="16" fill="#e60012"/></svg>') }]).png().toBuffer();

async function pixel(bytes: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
}

test('tabletop cutout keeps product color and trims transparent padding to contact surface', async () => {
  const result = await compositeProductIdentityLayer({ background, productCutout: product, scene: 'tabletop', placement: { x: .4, y: .3, width: .2, height: .2, surfaceY: .5 } });
  assert.deepEqual(await pixel(result.bytes, 50, 40), [230, 0, 18, 255]);
  assert.deepEqual(await pixel(result.bytes, 39, 30), [204, 204, 204, 255]);
  assert.deepEqual(await pixel(result.bytes, 40, 49), [230, 0, 18, 255]);
  assert.equal(result.productBox.left, 40);
  await assert.rejects(compositeProductIdentityLayer({ background, productCutout: product, scene: 'conveyor', placement: { x: .4, y: .3, width: .2, height: .2, surfaceY: .8 } }), /surface_contact_mismatch/);
});

test('hand foreground correctly occludes product but excessive covering is rejected', async () => {
  const fingers = await sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } })
    .composite([{ input: Buffer.from('<svg width="100" height="100"><rect x="40" y="39" width="7" height="5" fill="#ffcc99"/></svg>') }]).png().toBuffer();
  const result = await compositeProductIdentityLayer({ background, productCutout: product, scene: 'handheld', placement: { x: .4, y: .3, width: .2, height: .2 }, foregroundOccluder: fingers });
  assert.deepEqual(await pixel(result.bytes, 43, 41), [255, 204, 153, 255]);
  assert.deepEqual(await pixel(result.bytes, 50, 41), [230, 0, 18, 255]);
  assert(result.occludedProductFraction > .005 && result.occludedProductFraction < .4);
  await assert.rejects(compositeProductIdentityLayer({ background, productCutout: product, scene: 'handheld', placement: { x: .4, y: .3, width: .2, height: .2 } }), /hand_occluder_required/);
  const fullOccluder = await sharp({ create: { width: size, height: size, channels: 4, background: '#ffcc99' } }).png().toBuffer();
  await assert.rejects(compositeProductIdentityLayer({ background, productCutout: product, scene: 'handheld', placement: { x: .4, y: .3, width: .2, height: .2 }, foregroundOccluder: fullOccluder }), /excessive_occlusion/);
});

test('opaque photographs are not pasted as product cutouts', async () => {
  const opaque = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ff0000' } }).png().toBuffer();
  await assert.rejects(compositeProductIdentityLayer({ background, productCutout: opaque, scene: 'tabletop', placement: { x: .4, y: .3, width: .2, height: .2, surfaceY: .5 } }), /cutout_required/);
  const empty = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00000000' } }).png().toBuffer();
  await assert.rejects(compositeProductIdentityLayer({ background, productCutout: empty, scene: 'tabletop', placement: { x: .4, y: .3, width: .2, height: .2, surfaceY: .5 } }), /empty_cutout/);
});
