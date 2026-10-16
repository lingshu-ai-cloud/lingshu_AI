import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStudioProductScenePreparationSlots,
  filterMaterialsByProductAssociation,
  productSceneUploadReuseMetadata,
  productSceneMaterialBindingChanges,
  productSceneMaterialProductAssociationChanges,
  productSceneMaterialProvenanceOf,
  scopeProductSceneProjection,
} from './studio.js';
import { stableProductScenePreparationSlotId } from '../../shared/contracts/productScenePreparation.js';

const product = {
  id: 'product-1',
  name: '测试产品',
  imageUrl: '/media/product-1.png',
};

const contentSha256 = 'a'.repeat(64);
const verification = {
  durationSeconds: 2.5,
  width: 1080,
  height: 1920,
  decodedFrameCount: 60,
  verificationMethod: 'ffmpeg_full_decode' as const,
  contentSha256,
};

function boundMaterial(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const changes = productSceneMaterialBindingChanges({
    material: { provenance: { retainedAudit: 'keep-me' }, tags: '原标签', shotFunction: '原功能' },
    productId: product.id,
    productName: product.name,
    kind: 'shelf_display',
    verification,
    boundAt: '2026-10-16T08:00:00.000Z',
  });
  return {
    id: 'material-1',
    name: '货架陈列成品',
    type: 'video',
    duration: 2.5,
    sha256: contentSha256,
    url: '/media/material-1.mp4',
    poster: '/media/material-1.jpg',
    scope: 'own',
    usage: 'editable',
    sourceType: 'licensed_upload',
    createdAt: '2026-10-16T08:00:00.000Z',
    ...changes,
    ...overrides,
  };
}

test('素材库读取只派生三类空槽位，不伪造素材记录', () => {
  const sourceProducts = [structuredClone(product)];
  const slots = buildStudioProductScenePreparationSlots({ products: sourceProducts, materials: [] });
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map(slot => slot.kind), ['shelf_display', 'conveyor_release', 'floor_stack']);
  assert.ok(slots.every(slot => slot.status === 'queued' && !slot.materialId && !slot.materialUrl));
  assert.deepEqual(sourceProducts, [product], 'read projection must not mutate or persist product/material input');

  const waiting = buildStudioProductScenePreparationSlots({
    products: [{ id: 'product-without-image', name: '尚无图片' }],
    materials: [],
  });
  assert.ok(waiting.every(slot => slot.status === 'waiting_source'));

  const readyWithoutSourceImage = buildStudioProductScenePreparationSlots({
    products: [{ id: product.id, name: product.name }],
    materials: [boundMaterial()],
  });
  assert.equal(readyWithoutSourceImage.find(slot => slot.kind === 'shelf_display')?.status, 'ready');

  const preparedFromLibraryImage = buildStudioProductScenePreparationSlots({
    products: [{ id: 'product-without-image', name: '已上传素材图' }],
    materials: [{
      id: 'product-image-1', productId: 'product-without-image', name: '产品正面图',
      type: 'image', url: '/media/product-image-1.png', scope: 'own',
    }],
  });
  assert.ok(preparedFromLibraryImage.every(slot => slot.status === 'queued'));
  assert.ok(preparedFromLibraryImage.every(slot => slot.sourceImageUrl === '/media/product-image-1.png'));
});

test('只有真实、可制作且时长大于零的视频会使槽位 ready', () => {
  const ready = buildStudioProductScenePreparationSlots({ products: [product], materials: [boundMaterial()] });
  assert.equal(ready.find(slot => slot.kind === 'shelf_display')?.status, 'ready');
  assert.equal(ready.find(slot => slot.kind === 'shelf_display')?.materialId, 'material-1');
  assert.equal(ready.find(slot => slot.kind === 'shelf_display')?.actualDurationSeconds, 2.5);
  assert.ok(ready.filter(slot => slot.kind !== 'shelf_display').every(slot => slot.status === 'queued'));

  const longVerification = { ...verification, durationSeconds: 18.4, decodedFrameCount: 442 };
  const longChanges = productSceneMaterialBindingChanges({
    material: { provenance: {}, tags: '', shotFunction: '' },
    productId: product.id,
    productName: product.name,
    kind: 'shelf_display',
    verification: longVerification,
  });
  const longUpload = buildStudioProductScenePreparationSlots({
    products: [product],
    materials: [{ ...boundMaterial(), ...longChanges, duration: 18.4 }],
  });
  assert.equal(longUpload.find(slot => slot.kind === 'shelf_display')?.status, 'ready');
  assert.equal(longUpload.find(slot => slot.kind === 'shelf_display')?.actualDurationSeconds, 18.4);

  for (const invalid of [
    boundMaterial({ duration: 0 }),
    boundMaterial({ type: 'image', duration: 0 }),
    boundMaterial({ synthetic: true }),
    boundMaterial({ usage: 'reference_only' }),
    boundMaterial({ url: '' }),
    boundMaterial({ productId: 'another-product' }),
  ]) {
    const slots = buildStudioProductScenePreparationSlots({ products: [product], materials: [invalid] });
    const shelf = slots.find(slot => slot.kind === 'shelf_display');
    assert.equal(shelf?.status, 'needs_replacement');
    assert.equal(shelf?.materialId, undefined);
  }
});

test('绑定合并 provenance，并补齐 Content Agent 可检索标签', () => {
  const changes = productSceneMaterialBindingChanges({
    material: {
      provenance: { providerReceipt: 'receipt-1', sourceAnalysis: { state: 'completed' } },
      tags: '原标签',
      shotFunction: '产品展示',
    },
    productId: product.id,
    productName: product.name,
    kind: 'conveyor_release',
    verification,
    boundAt: '2026-10-16T09:00:00.000Z',
  });
  const provenance = changes.provenance as Record<string, unknown>;
  assert.equal(provenance.providerReceipt, 'receipt-1');
  assert.deepEqual(provenance.sourceAnalysis, { state: 'completed' });
  assert.match(String(changes.tags), /产品预制素材/);
  assert.match(String(changes.tags), /原标签/);
  assert.match(String(changes.shotFunction), /产品展示/);

  const binding = productSceneMaterialProvenanceOf({ provenance });
  assert.equal(binding?.productId, product.id);
  assert.equal(binding?.kind, 'conveyor_release');
  assert.equal(binding?.slotId, stableProductScenePreparationSlotId(product.id, 'conveyor_release'));
});

test('篡改或未知绑定不会被投影为 ready', () => {
  const tampered = boundMaterial();
  const provenance = tampered.provenance as Record<string, unknown>;
  provenance.productScenePreparation = {
    ...(provenance.productScenePreparation as Record<string, unknown>),
    slotId: 'forged-slot',
  };
  assert.equal(productSceneMaterialProvenanceOf(tampered), undefined);
  const slots = buildStudioProductScenePreparationSlots({ products: [product], materials: [tampered] });
  assert.ok(slots.every(slot => slot.status === 'queued' && !slot.materialId));
});

test('只有带服务端视频校验的产品场景上传才获得复用授权', () => {
  assert.deepEqual(productSceneUploadReuseMetadata(), {});
  assert.deepEqual(productSceneUploadReuseMetadata({
    productId: product.id,
    productName: product.name,
    kind: 'shelf_display',
    ...verification,
    verificationMethod: 'ffmpeg_full_decode',
    decodedFrameCount: 0,
  }), {});
  const metadata = productSceneUploadReuseMetadata({
    productId: product.id,
    productName: product.name,
    kind: 'shelf_display',
    ...verification,
  });
  assert.equal(metadata.licenseEvidence, 'tenant_product_scene_upload');
  assert.equal(metadata.commercialUseApproved, true);
  assert.equal(metadata.derivativesApproved, true);
  assert.equal(metadata.rawLibraryUseApproved, true);
  assert.ok(metadata.authorizationScopes?.includes('content_reuse'));
  assert.ok(metadata.authorizationScopes?.includes('model_input'));
  assert.equal(productSceneUploadReuseMetadata({
    productId: product.id,
    productName: product.name,
    kind: 'shelf_display',
    ...verification,
    durationSeconds: 42,
    decodedFrameCount: 1_008,
  }).commercialUseApproved, true);
});

test('更换产品时重建稳定绑定，清空产品时移除旧场景凭证', () => {
  const source = boundMaterial();
  const moved = productSceneMaterialProductAssociationChanges({
    material: source,
    productId: 'product-2',
    productName: '产品二',
  });
  const movedBinding = productSceneMaterialProvenanceOf({ ...source, ...moved });
  assert.equal(movedBinding?.productId, 'product-2');
  assert.equal(movedBinding?.kind, 'shelf_display');
  assert.equal(movedBinding?.contentSha256, contentSha256);
  assert.equal(movedBinding?.slotId, stableProductScenePreparationSlotId('product-2', 'shelf_display'));

  const cleared = productSceneMaterialProductAssociationChanges({
    material: { ...source, ...moved },
    productId: '',
    productName: '',
  });
  assert.equal(cleared.productId, '');
  assert.equal(productSceneMaterialProvenanceOf({ ...source, ...moved, ...cleared }), undefined);
  assert.equal((cleared.provenance as Record<string, unknown>).productScenePreparation, undefined);
});

test('素材列表可精确读取单产品或仅未关联产品的素材', () => {
  const materials = [
    { id: 'a', productId: 'product-1' },
    { id: 'b', productId: 'product-2' },
    { id: 'c', productId: '' },
    { id: 'd' },
  ];
  assert.deepEqual(
    filterMaterialsByProductAssociation(materials, { productId: 'product-1' }).map(item => item.id),
    ['a'],
  );
  assert.deepEqual(
    filterMaterialsByProductAssociation(materials, { excludeProductAssociated: true }).map(item => item.id),
    ['c', 'd'],
  );
  assert.throws(
    () => filterMaterialsByProductAssociation(materials, { productId: 'product-1', excludeProductAssociated: true }),
    /material_product_filter_conflict/,
  );
});

test('产品详情查询仅投影当前产品，通用素材查询仍保留全部产品投影', () => {
  const products = [
    { id: 'product-1', name: '产品一' },
    { id: 'product-2', name: '产品二' },
  ];
  const materials = [
    { id: 'product-1-image', productId: 'product-1', type: 'image' },
    { id: 'product-1-scene', productId: 'product-1', type: 'video' },
    { id: 'product-2-image', productId: 'product-2', type: 'image' },
    { id: 'unassociated', productId: '', type: 'image' },
  ];

  const productDetail = scopeProductSceneProjection({
    products,
    materials,
    productId: 'product-1',
  });
  assert.deepEqual(productDetail.products.map(item => item.id), ['product-1']);
  assert.deepEqual(productDetail.materials.map(item => item.id), ['product-1-image', 'product-1-scene']);

  const unassociatedLibrary = filterMaterialsByProductAssociation(materials, { excludeProductAssociated: true });
  assert.deepEqual(unassociatedLibrary.map(item => item.id), ['unassociated']);
  const allProductProjection = scopeProductSceneProjection({ products, materials });
  assert.deepEqual(allProductProjection.products.map(item => item.id), ['product-1', 'product-2']);
  assert.deepEqual(allProductProjection.materials.map(item => item.id), [
    'product-1-image',
    'product-1-scene',
    'product-2-image',
    'unassociated',
  ]);
});
