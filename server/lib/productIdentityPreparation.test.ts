import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { compileStoryboardShotSpec, type StoryboardShotAsset } from '../../shared/storyboardShotSpec.js';
import { prepareProductIdentityLayer } from './productIdentityPreparation.js';

const background = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#cccccc' } }).png().toBuffer();
const cutoutBytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00000000' } })
  .composite([{ input: Buffer.from('<svg width="20" height="20"><rect x="2" y="2" width="16" height="16" fill="red"/></svg>') }]).png().toBuffer();
const foreground = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#00000000' } }).png().toBuffer();
const product = { role: 'product' as const, id: 'sku-1', version: 'original-hash', source: 'knowledge_base' as const };
const cutout = { role: 'product_cutout' as const, id: 'cutout-1', version: 'cutout-hash', source: 'enterprise_asset' as const,
  derivedFromAssetId: 'sku-1', derivedFromVersion: 'original-hash', view: 'front' };
const hand = { role: 'foreground_occluder' as const, id: 'hand-1', version: 'hand-hash', source: 'generated' as const };
function spec(scene: 'tabletop' | 'handheld' | 'conveyor', assets: StoryboardShotAsset[] = [product, cutout]) {
  return compileStoryboardShotSpec({ shotId: 'shot-1', mode: 'free_creation', scene: 'product', description: `${scene} product`, ratio: '9:16', assets,
    layout: { productBox: { x: .4, y: .3, width: .2, height: .2 }, contactSurfaceY: .5, contactScene: scene, productView: 'front' } });
}
const assetBytes = new Map([['cutout-1', cutoutBytes], ['hand-1', foreground]]);

test('tabletop and conveyor prepare exact layer with source product provenance', async () => {
  for (const scene of ['tabletop', 'conveyor'] as const) {
    const result = await prepareProductIdentityLayer({ spec: spec(scene), cleanPlate: true, background, assetBytes });
    assert.equal(result.status, 'eligible');
    if (result.status === 'eligible') {
      assert.equal(result.composite.scene, scene);
      assert.equal(result.composite.placement.surfaceY, .5);
      assert.equal(result.provenance.productAssetVersion, 'original-hash');
    }
  }
});

test('handheld requires aligned foreground and correct product view', async () => {
  const missing = await prepareProductIdentityLayer({ spec: spec('handheld'), cleanPlate: true, background, assetBytes });
  assert.deepEqual(missing, { status: 'generative_fallback', reason: 'hand_foreground_missing' });
  const ready = await prepareProductIdentityLayer({ spec: spec('handheld', [product, cutout, hand]), cleanPlate: true, background, assetBytes });
  assert.equal(ready.status, 'eligible');
  const wrongView = await prepareProductIdentityLayer({ spec: spec('handheld', [product, { ...cutout, view: 'back' }, hand]), cleanPlate: true, background, assetBytes });
  assert.deepEqual(wrongView, { status: 'generative_fallback', reason: 'matching_product_cutout_missing' });
});

test('cannot paste identity layer onto finished model image or stale source cutout', async () => {
  const finished = await prepareProductIdentityLayer({ spec: spec('tabletop'), cleanPlate: false, background, assetBytes });
  assert.deepEqual(finished, { status: 'generative_fallback', reason: 'background_not_clean_plate' });
  const stale = await prepareProductIdentityLayer({ spec: spec('tabletop', [product, { ...cutout, derivedFromVersion: 'old-hash' }]), cleanPlate: true, background, assetBytes });
  assert.deepEqual(stale, { status: 'generative_fallback', reason: 'matching_product_cutout_missing' });
});
