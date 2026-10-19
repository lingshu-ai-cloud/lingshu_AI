import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_SCENE_DEFINITIONS,
  PRODUCT_SCENE_KINDS,
  PRODUCT_SCENE_PREPARATION_SCHEMA_VERSION,
  buildProductScenePreparationReadModels,
  ensureProductScenePreparationPlan,
  normalizeProductScenePreparationPlan,
  stableProductScenePreparationSlotId,
  type ProductScenePreparationMaterialBinding,
} from './productScenePreparation.js';

test('defines three neutral preparation slots with non-binding generation duration guidance', () => {
  assert.deepEqual(PRODUCT_SCENE_KINDS, ['shelf_display', 'conveyor_release', 'floor_stack']);
  assert.deepEqual(PRODUCT_SCENE_DEFINITIONS.map(item => ({
    kind: item.kind,
    label: item.label,
    duration: item.targetDurationSeconds,
  })), [
    { kind: 'shelf_display', label: '预制场景 1', duration: { min: 2, max: 3 } },
    { kind: 'conveyor_release', label: '预制场景 2', duration: { min: 2, max: 3 } },
    { kind: 'floor_stack', label: '预制场景 3', duration: { min: 2, max: 3 } },
  ]);
  assert.ok(PRODUCT_SCENE_DEFINITIONS.every(item => item.description === ''));
});

test('slot identities are stable and unambiguous for persisted product identities', () => {
  const first = stableProductScenePreparationSlotId('SKU / 中文:1', 'shelf_display');
  assert.equal(first, stableProductScenePreparationSlotId(' SKU / 中文:1 ', 'shelf_display'));
  assert.notEqual(first, stableProductScenePreparationSlotId('SKU / 中文:1', 'floor_stack'));
  assert.notEqual(first, stableProductScenePreparationSlotId('SKU / 中文:2', 'shelf_display'));
  assert.match(first, /^product-scene-preparation\.v1:/);
});

test('plan normalization is canonical, complete and idempotent without timestamps or execution claims', () => {
  const malformed = {
    schemaVersion: 'old',
    slots: [
      { slotId: 'browser-invented', kind: 'shelf_display', status: 'ready', progress: 100 },
      { slotId: 'duplicate', kind: 'shelf_display' },
    ],
    generatedAt: new Date().toISOString(),
  };
  const normalized = normalizeProductScenePreparationPlan('product-1', malformed);
  assert.equal(normalized.schemaVersion, PRODUCT_SCENE_PREPARATION_SCHEMA_VERSION);
  assert.deepEqual(normalized.slots.map(slot => slot.kind), PRODUCT_SCENE_KINDS);
  assert.equal(new Set(normalized.slots.map(slot => slot.slotId)).size, 3);
  assert.deepEqual(ensureProductScenePreparationPlan('product-1', normalized), normalized);
  assert.equal(JSON.stringify(normalized).includes('At'), false);
  assert.equal(JSON.stringify(normalized).includes('status'), false);
  assert.equal(JSON.stringify(normalized).includes('progress'), false);
});

test('read models distinguish missing source, queued preparation and a verified real material', () => {
  const productId = 'product-1';
  const plan = ensureProductScenePreparationPlan(productId);
  const waiting = buildProductScenePreparationReadModels({ productId, plan });
  assert.deepEqual(waiting.map(slot => slot.status), ['waiting_source', 'waiting_source', 'waiting_source']);
  assert.ok(waiting.every(slot => slot.sourceImageAvailable === false && !slot.materialId));

  const queued = buildProductScenePreparationReadModels({
    productId,
    plan,
    sourceImageUrl: '/media/product-1.png',
  });
  assert.deepEqual(queued.map(slot => slot.status), ['queued', 'queued', 'queued']);

  const target = plan.slots[0]!;
  const validBinding: ProductScenePreparationMaterialBinding = {
    slotId: target.slotId,
    productId,
    kind: target.kind,
    materialId: 'material-real-video',
    materialUrl: '/media/product-1-shelf.mp4',
    posterUrl: '/media/product-1-shelf.jpg',
    materialName: '产品货架陈列',
    mediaType: 'video',
    actualDurationSeconds: 2.6,
    productionEligible: true,
    synthetic: false,
  };
  const ready = buildProductScenePreparationReadModels({
    productId,
    plan,
    sourceImageUrl: '/media/product-1.png',
    materialBindings: [validBinding],
  });
  assert.equal(ready[0]?.status, 'ready');
  assert.equal(ready[0]?.materialId, 'material-real-video');
  assert.equal(ready[0]?.actualDurationSeconds, 2.6);
  assert.deepEqual(ready.slice(1).map(slot => slot.status), ['queued', 'queued']);

  const longUpload = buildProductScenePreparationReadModels({
    productId,
    plan,
    materialBindings: [{ ...validBinding, actualDurationSeconds: 18.4 }],
  });
  assert.equal(longUpload[0]?.status, 'ready');
  assert.equal(longUpload[0]?.actualDurationSeconds, 18.4);

  const readyWithoutSourceImage = buildProductScenePreparationReadModels({
    productId,
    plan,
    materialBindings: [validBinding],
  });
  assert.equal(readyWithoutSourceImage[0]?.status, 'ready');
  assert.equal(readyWithoutSourceImage[0]?.sourceImageAvailable, false);
});

test('browser status and incomplete or synthetic bindings cannot manufacture readiness', () => {
  const productId = 'product-1';
  const plan = ensureProductScenePreparationPlan(productId);
  const target = plan.slots[0]!;
  const base: ProductScenePreparationMaterialBinding = {
    slotId: target.slotId,
    productId,
    kind: target.kind,
    materialId: 'material-1',
    materialUrl: '/media/material-1.mp4',
    mediaType: 'video',
    actualDurationSeconds: 2.5,
    productionEligible: true,
    synthetic: false,
  };
  for (const binding of [
    { ...base, synthetic: true },
    { ...base, productionEligible: false },
    { ...base, actualDurationSeconds: 0 },
    { ...base, productId: 'another-product' },
    { ...base, materialUrl: '' },
  ]) {
    const [slot] = buildProductScenePreparationReadModels({
      productId,
      sourceImageUrl: '/media/product-1.png',
      statusBySlotId: { [target.slotId]: 'ready' },
      materialBindings: [binding],
    });
    assert.equal(slot?.status, 'queued');
    assert.equal(slot?.materialId, undefined);
  }

  const [stale] = buildProductScenePreparationReadModels({
    productId,
    sourceImageUrl: '/media/product-1-new.png',
    statusBySlotId: { [target.slotId]: 'needs_replacement' },
    materialBindings: [base],
  });
  assert.equal(stale?.status, 'ready');
  assert.equal(stale?.materialId, 'material-1');
});
