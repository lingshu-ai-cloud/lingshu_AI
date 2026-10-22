import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildSocialImageFirstDraftPrompt, buildSocialImageGifPlatePrompt, socialImageUnitPoster } from './socialImageFirstDraft.js';
import { buildStudioSocialImagePaidPrompt, verifyFrozenGifProductAssets } from './socialImagePaidRenderAdmission.js';
import { defaultSocialImageTask } from './socialImageTask.js';

test('server first-draft contract locks benchmark structure and protects packaging anchors', () => {
  const prompt = buildSocialImageFirstDraftPrompt({
    imagePrompt: 'Use a verified product launch story.',
    poster: { headline: 'Launch update', cta: '' },
    ratio: '4:5', imageType: 'brand_news', hasBenchmark: true, ownedReferenceCount: 2,
  });
  assert.match(prompt, /locked structural blueprint/);
  assert.match(prompt, /normalized bounding boxes, z-order, relative scale/);
  assert.match(prompt, /open sky or another quiet upper-right area/);
  assert.match(prompt, /complete cap or top closure, brand name, core label/);
  assert.match(prompt, /tenant-owned enterprise assets/);
  assert.match(prompt, /"headline": "Launch update"/);
});

test('first draft without owned assets may not invent or borrow identity', () => {
  const prompt = buildSocialImageFirstDraftPrompt({
    imagePrompt: 'Neutral product context.', poster: { headline: 'Overview' }, ratio: '1:1',
    hasBenchmark: false, ownedReferenceCount: 0,
  });
  assert.doesNotMatch(prompt, /locked structural blueprint/);
  assert.match(prompt, /Keep product and logo regions empty/);
  assert.match(prompt, /sole authority for visible wording/);
});

test('first draft carries measured masks and back-to-front layer order into production', () => {
  const prompt = buildSocialImageFirstDraftPrompt({ imagePrompt: 'Rebuild.', poster: { headline: 'New copy' }, ratio: '4:5', hasBenchmark: true, ownedReferenceCount: 1,
    replicationRecipe: { contentArchetype: 'poster', imageCopyRelation: 'image_contextualizes_copy', preserve: [], replace: [], palette: [], layoutRegions: [], protectedSubjects: [], overlayZones: [],
      referenceLayerBlueprints: [{ imageIndex: 1, layers: [
        { id: 'background', role: 'background', zIndex: 0, bounds: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1 },
        { id: 'glass', role: 'mask', zIndex: 2, bounds: { x: .05, y: .1, width: .4, height: .5 }, confidence: .9 },
        { id: 'copy', role: 'text', zIndex: 4, bounds: { x: .08, y: .12, width: .3, height: .3 }, confidence: .9 },
      ], masks: [{ id: 'glass', shape: 'rounded_rectangle', bounds: { x: .05, y: .1, width: .4, height: .5 }, opacity: .62, zIndex: 2, confidence: .9 }] }],
    },
  });
  assert.match(prompt, /Measured back-to-front layer order: background:background@z0 > mask:glass@z2 > text:copy@z4/);
  assert.match(prompt, /rounded_rectangle\/box=\[0.05,0.1,0.4,0.5\]\/opacity=0.62\/z=2/);
});

test('carousel units have stable cover, value, proof, and conversion roles', () => {
  const poster = { headline: 'Hero', subheadline: 'Support', sellingPoints: ['Value one', 'Value two'], trustBadges: ['Proof one'], process: ['Step one'], cta: 'Contact us', bottomBar: ['MOQ confirmed'] };
  assert.equal(socialImageUnitPoster(poster, 'carousel', 0, 4).pageRole, 'cover');
  assert.deepEqual(socialImageUnitPoster(poster, 'carousel', 1, 4), { ...poster, pageRole: 'value', headline: 'Value one', subheadline: 'Value two', carouselPage: 2, carouselPageCount: 4 });
  assert.equal(socialImageUnitPoster(poster, 'carousel', 2, 4).pageRole, 'proof');
  assert.equal(socialImageUnitPoster(poster, 'carousel', 3, 4).pageRole, 'conversion');
});

test('GIF with owned products requests a background-only plate for fixed composition', () => {
  const prompt = buildSocialImageGifPlatePrompt({ sceneIntent: 'Industrial laboratory', ratio: '4:5',
    index: 1, count: 4, hasBenchmark: true });
  assert.match(prompt, /BACKGROUND ONLY/);
  assert.match(prompt, /frame 2 of 4/);
  assert.match(prompt, /Do not draw any product, package, bottle, cap, logo/);
  assert.match(prompt, /fixed identity and text layers are added deterministically/);
  assert.doesNotMatch(prompt, /"headline"/);
  const routed = buildStudioSocialImagePaidPrompt({ sceneIntent: 'Quiet scene', ratio: '4:5',
    poster: { headline: 'Must stay off plate' }, deliverableType: 'social_poster', productionStrategy: 'reference_generate',
    referenceRoleText: '', benchmarkCount: 1, ownedReferenceCount: 0, gifUnit: { index: 1, count: 4 } });
  assert.match(routed, /BACKGROUND ONLY/);
  assert.doesNotMatch(routed, /Must stay off plate/);
});

test('paid GIF admission verifies frozen enterprise product bytes before provider submission', async () => {
  const bytes = Buffer.from('fixture-product');
  const expectedHash = createHash('sha256').update(bytes).digest('hex');
  const task = defaultSocialImageTask({ imageType: 'gif_poster', productRefs: ['product-a'],
    enterpriseAssets: [{ assetId: 'product-a', role: 'product', name: 'Product A',
      source: 'enterprise_knowledge_base', required: true, contentHash: expectedHash }] });
  task.renderPlan = { version: 1, sourceHash: 'frozen', createdAt: '2026-10-22T00:00:00Z', units: [] };
  const products = [{ id: 'product-a', name: 'Product A', imageUrl: '/tenant/product-a.png' }];
  const verify = (loaded: Buffer | null) => verifyFrozenGifProductAssets(task, products,
    product => product.id || '', async () => loaded);
  await verify(bytes);
  await assert.rejects(verify(Buffer.from('changed')), /social_image_gif_product_identity_changed/);
  await assert.rejects(verify(null), /social_image_gif_product_identity_changed/);
});
