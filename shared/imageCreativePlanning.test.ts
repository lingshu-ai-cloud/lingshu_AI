import assert from 'node:assert/strict';
import test from 'node:test';
import { inferMaterialAssetV2, planImageProduction, planImageReferences } from './imageCreativePlanning.js';

test('Director only marks a product-bound image as exact product identity', () => {
  const exact = inferMaterialAssetV2({
    type: 'image',
    name: 'Vitamin bottle front white background.png',
    productId: 'sku-1',
    productName: 'Vitamin Bottle',
    visualObservations: ['clear front label on white background'],
  });
  assert.equal(exact.assetRole, 'exact_product');
  assert.equal(exact.productIdentityLevel, 'exact');
  assert.equal(exact.contentRole, 'product_front');

  const publicReference = inferMaterialAssetV2({
    type: 'image',
    name: 'competitor product poster.jpg',
    visualObservations: ['a bottle with a clear label'],
  });
  assert.notEqual(publicReference.assetRole, 'exact_product');
  assert.equal(publicReference.productIdentityLevel, 'none');
});

test('Director never promotes an AI-generated derivative to exact product identity', () => {
  const generated = inferMaterialAssetV2({
    type: 'image', name: 'generated product scene.png', productId: 'sku-1', identityAuthority: 'derived',
  });
  assert.equal(generated.productIdentityLevel, 'category');
  assert.notEqual(generated.assetRole, 'exact_product');
});

test('Director recognizes reusable enterprise scenes and evidence', () => {
  const factory = inferMaterialAssetV2({ type: 'image', name: 'factory production line clean plate.jpg', enterpriseCommon: true });
  assert.equal(factory.assetRole, 'generic_scene_plate');
  assert.equal(factory.sceneType, 'factory');
  assert.equal(factory.templateEligible, true);

  const certificate = inferMaterialAssetV2({ type: 'image', name: 'ISO certificate.pdf.jpg', productId: 'sku-1' });
  assert.equal(certificate.assetRole, 'fact_evidence');
  assert.equal(certificate.contentRole, 'fact_evidence');
  assert.equal(certificate.productIdentityLevel, 'category');
});

test('image reference plan prioritizes the target product and isolates style references', () => {
  const product = inferMaterialAssetV2({ type: 'image', name: 'front.png', productId: 'sku-1' });
  const otherProduct = inferMaterialAssetV2({ type: 'image', name: 'front.png', productId: 'sku-2' });
  const scene = inferMaterialAssetV2({ type: 'image', name: 'factory production line.jpg', enterpriseCommon: true });
  const plan = planImageReferences([
    { id: 'target', type: 'image', folder: 'product', productId: 'sku-1', materialV2: product, segmentAnalysisStatus: 'completed' },
    { id: 'wrong', type: 'image', folder: 'product', productId: 'sku-2', materialV2: otherProduct, segmentAnalysisStatus: 'completed' },
    { id: 'scene', type: 'image', folder: 'factory', materialV2: scene, segmentAnalysisStatus: 'completed' },
    { id: 'style', type: 'image', folder: 'hot', usage: 'reference_only' },
  ], { productIds: ['sku-1'], includeStyleReference: true });
  assert.deepEqual(plan.selectedIds, ['target', 'scene', 'style']);
  assert.deepEqual(plan.exactProductIds, ['target']);
  assert.deepEqual(plan.styleReferenceIds, ['style']);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.selectedIds.includes('wrong'), false);
});

test('image reference plan blocks product generation without an exact product image', () => {
  const plan = planImageReferences([
    { id: 'style', type: 'image', folder: 'hot', usage: 'reference_only' },
  ], { productIds: ['sku-1'], includeStyleReference: true });
  assert.match(plan.blockers.join(' '), /精准产品图/);
});

test('image production selects a method from the deliverable and material roles', () => {
  const exact = inferMaterialAssetV2({ type: 'image', name: 'SKU 正面产品图', productId: 'sku-1' });
  const plan = planImageProduction([
    { id: 'product', type: 'image', folder: 'product', productId: 'sku-1', materialV2: exact },
    { id: 'style', type: 'image', folder: 'hot', usage: 'reference_only' },
  ], { deliverable: 'social_poster', productIds: ['sku-1'], includeStyleReference: true });
  assert.equal(plan.strategy, 'reference_generate');
  assert.deepEqual(plan.inputRoles, [
    { materialId: 'product', role: 'exact_product' },
    { materialId: 'style', role: 'style' },
  ]);
  assert.deepEqual(plan.blockers, []);
});
