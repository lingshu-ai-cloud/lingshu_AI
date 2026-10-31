import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSocialImagePosterPlatePrompt } from './socialImagePosterPlatePrompt.js';
import { socialImageBuyerProductStage } from './socialImageBuyerOverlay.js';

test('imitable style drives measured scene and placement without a forced advertising layout', () => {
  const prompt = buildSocialImagePosterPlatePrompt({ ratio: '1:1', styleStrategy: 'reference_emulation.v1',
    transferableStyle: ['soft_light', 'asymmetric'], referencePalette: ['#c4ab90'],
    sceneDirection: 'soft fabric and natural shadow with layered depth',
    recipe: { contentArchetype: 'reference', imageCopyRelation: 'image_contextualizes_copy',
      preserve: [], replace: [], palette: ['#c4ab90'], productPresentation: 'single', protectedSubjects: [], overlayZones: [],
      layoutRegions: [{ id: 'product-stage', role: 'product', x: .1, y: .3, width: .4, height: .5 },
        { id: 'headline-zone', role: 'text', x: .6, y: .1, width: .3, height: .2 }] } });
  assert.match(prompt, /reference-inspired editorial or lifestyle/);
  assert.match(prompt, /10% left, 30% top, 40% wide and 50% tall/);
  assert.match(prompt, /60% left, 10% top, 30% wide and 20% tall/);
  assert.match(prompt, /soft diffuse light, asymmetric composition/);
  assert.match(prompt, /#c4ab90/);
  assert.doesNotMatch(prompt, /left 40% for dark buyer copy|badge and the bottom 16%/);
});

test('advertising variants reserve the same product stage used by local composition', () => {
  const poster = { headline: 'Product', originBadge: 'Brand', sellingPoints: ['SKU: 1'],
    bottomBar: ['50 ml'], cta: 'Ask us' };
  const first = socialImageBuyerProductStage(poster, 0);
  const second = socialImageBuyerProductStage(poster, 2);
  assert.notDeepEqual(first, second);
  for (let variant = 0; variant < 4; variant += 1) {
    const stage = socialImageBuyerProductStage(poster, variant);
    assert.ok(stage.centerY - stage.maxHeight / 2 >= .24);
    assert.ok(stage.centerY + stage.maxHeight / 2 <= .84);
  }
  const prompt = buildSocialImagePosterPlatePrompt({ ratio: '1:1', buyerPoster: poster,
    styleStrategy: 'advertising.v1', sceneVariant: 2 });
  assert.match(prompt, new RegExp(`${Math.round(second.centerX * 100)}% width empty.*${Math.round(second.centerY * 100)}% height`));
  assert.match(prompt, /product-photography BACKGROUND PLATE ONLY/);
});
