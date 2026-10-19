import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMaterialAssetV2 } from '../../shared/contracts/materialAssetV2.js';
import {
  autoFulfillProductionInputRequestsForMaterial,
  createOrReuseProductionInputRequest,
  fulfillProductionInputRequest,
  listProductionInputRequests,
  ProductionInputRequestError,
  waiveProductionInputRequest,
} from './productionInputRequests.js';
import { createProductionTestStore } from './testStore.js';

const frontMetadata = normalizeMaterialAssetV2({
  assetRole: 'exact_product', contentRole: 'product_front', productIdentityLevel: 'exact',
  enterpriseCommon: false, templateEligible: true, reuseScore: 0.85,
});

test('production inputs: product subtype deduplicates across shots and promotes urgency', async () => {
  const store = createProductionTestStore();
  const first = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a',
    request: {
      kind: 'product_front_image', title: '补充产品正面图', productId: 'sku-a', productName: '精华 A',
      bindings: [{ taskId: 'task-1', shotId: 'shot-1' }], specification: { minWidth: 1600 },
    },
  });
  const reused = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a',
    request: {
      kind: 'product_front_image', title: '另一个镜头也需要正面图', productId: 'sku-a', productName: '精华 A',
      bindings: [{ taskId: 'task-2', shotId: 'shot-7' }], specification: { minWidth: 1600 }, blocking: true,
    },
  });
  assert.equal(first.created, true);
  assert.equal(reused.created, false);
  assert.equal(reused.request.id, first.request.id);
  assert.equal(reused.request.blocking, true);
  assert.deepEqual(reused.request.bindings.map(item => item.taskId), ['task-1', 'task-2']);
  const otherTenant = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-b', userId: 'user-b', request: {
      kind: 'product_front_image', title: '同 SKU 也必须租户隔离', productId: 'sku-a', specification: { minWidth: 1600 },
    },
  });
  assert.notEqual(otherTenant.request.id, first.request.id);
  assert.equal((await listProductionInputRequests({ store, tenantId: 'tenant-a' })).length, 1);
});

test('production inputs: general requests do not require product and product requests do', async () => {
  const store = createProductionTestStore();
  const scene = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'scene_plate', title: '仓库环境底板', subjectRef: 'scene:warehouse', bindings: [{ taskId: 'task-1' }],
    },
  });
  assert.equal(scene.request.category, 'scene_plate');
  assert.equal(scene.request.productId, null);
  const unrelated = await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: {
      id: 'scene-showroom', type: 'video', provenance: { materialAssetV2: normalizeMaterialAssetV2({
        assetRole: 'generic_scene_plate', contentRole: 'scene_plate', productIdentityLevel: 'none',
        enterpriseCommon: true, subjectRefs: ['scene:showroom'], reuseScore: 0.8,
      }) },
    },
  });
  assert.deepEqual(unrelated, [], 'a broad scene role must not satisfy a different scene subject');
  const matched = await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: {
      id: 'scene-warehouse', type: 'video', provenance: { materialAssetV2: normalizeMaterialAssetV2({
        assetRole: 'generic_scene_plate', contentRole: 'scene_plate', productIdentityLevel: 'none',
        enterpriseCommon: true, subjectRefs: ['scene:warehouse'], reuseScore: 0.8,
      }) },
    },
  });
  assert.equal(matched[0]?.id, scene.request.id);
  await assert.rejects(
    createOrReuseProductionInputRequest({
      store, tenantId: 'tenant-a', userId: 'user-a', request: { kind: 'product_transparent_png', title: '透明图' },
    }),
    (error: unknown) => error instanceof ProductionInputRequestError && error.code === 'production_input_product_id_required',
  );
});

test('production inputs: account authorization and production decisions are first-class inputs', async () => {
  const store = createProductionTestStore();
  const account = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'account_authorization', title: '连接发布账号', subjectRef: 'account:douyin-primary',
      bindings: [{ taskId: 'task-1' }],
    },
  });
  assert.equal(account.request.category, 'account_authorization');
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: account.request.id,
    fulfillment: {
      type: 'authorization', sourceId: 'oauth-grant-1',
      data: { accountId: 'douyin-primary' },
    },
  }), /production_input_account_authorization_required/);
  const accountFulfilled = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: account.request.id,
    fulfillment: {
      type: 'authorization', sourceId: 'oauth-grant-1',
      data: { accountId: 'douyin-primary', authorizationRef: 'oauth-grant:1' },
    },
  });
  assert.equal(accountFulfilled.request.status, 'fulfilled');

  await assert.rejects(createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'production_choice', title: '缺少可选项', subjectRef: 'decision:invalid',
      bindings: [{ taskId: 'task-1' }],
    },
  }), /production_input_choice_options_required/);

  const choice = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'production_choice', title: '选择镜头降级路线', subjectRef: 'decision:shot-4-fallback',
      bindings: [{ taskId: 'task-1', shotId: 'shot-4' }],
      specification: { options: ['material_edit', 'motion_graphics'] },
    },
  });
  const clarification = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'content_clarification', title: '确认核心卖点', subjectRef: 'clarification:claim-1',
      bindings: [{ taskId: 'task-1' }],
    },
  });
  assert.equal(choice.request.category, 'production_choice');
  assert.equal(clarification.request.category, 'production_choice');
  const genericMaterial = {
    id: 'generic-input-material', type: 'image', provenance: { materialAssetV2: normalizeMaterialAssetV2({
      assetRole: 'supporting', contentRole: 'other', productIdentityLevel: 'none',
      subjectRefs: ['account:douyin-primary', 'decision:shot-4-fallback', 'clarification:claim-1'],
    }) },
  };
  assert.deepEqual(await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: genericMaterial,
  }), [], 'generic material must never satisfy authorization, choices or clarifications');
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: choice.request.id,
    fulfillment: { type: 'structured_data', sourceId: 'decision-1', data: { answer: 'material_edit' } },
  }), /production_input_structured_answer_required/);
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: choice.request.id,
    fulfillment: { type: 'structured_data', sourceId: 'decision-1', data: { choice: 'user_capture' } },
  }), /production_input_choice_not_allowed/);
  const choiceFulfilled = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: choice.request.id,
    fulfillment: { type: 'structured_data', sourceId: 'decision-1', data: { choice: 'material_edit' } },
  });
  const clarificationFulfilled = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: clarification.request.id,
    fulfillment: { type: 'structured_data', sourceId: 'answer-1', data: { answer: '强调无香配方' } },
  });
  assert.equal(choiceFulfilled.request.status, 'fulfilled');
  assert.equal(clarificationFulfilled.request.status, 'fulfilled');
});

test('production inputs: person authorization requires explicit evidence and never material auto-fulfillment', async () => {
  const store = createProductionTestStore();
  const person = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'person_authorization', title: '人物出镜授权', subjectRef: 'presenter:alice',
      bindings: [{ taskId: 'task-1', shotId: 'shot-2' }],
    },
  });
  const material = {
    id: 'person-consent-file', type: 'image', provenance: { materialAssetV2: normalizeMaterialAssetV2({
      assetRole: 'person_authorization', contentRole: 'person_authorization', productIdentityLevel: 'none',
      subjectRefs: ['presenter:alice'],
    }) },
  };
  assert.deepEqual(await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material,
  }), [], 'a declared material role alone is not auditable authorization evidence');
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: person.request.id,
    fulfillment: { type: 'document', sourceId: 'consent-1', data: { authorizationRef: 'contract:1' } },
  }), /production_input_authorization_evidence_required/);
  const fulfilled = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: person.request.id,
    fulfillment: {
      type: 'document', sourceId: 'consent-1',
      data: { authorizationRef: 'contract:1', consentRef: 'consent:alice:1' },
    },
  });
  assert.equal(fulfilled.request.status, 'fulfilled');
});

test('production inputs: classified material auto-fulfills only exact matching product', async () => {
  const store = createProductionTestStore();
  const created = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'product_front_image', title: '正面图', productId: 'sku-a', bindings: [{ taskId: 'task-1', shotId: 'shot-1' }],
    },
  });
  const wrong = await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: {
      id: 'material-b', type: 'image', productId: 'sku-b', provenance: { materialAssetV2: frontMetadata },
    },
  });
  assert.deepEqual(wrong, []);
  const matched = await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: {
      id: 'material-a', type: 'image', productId: 'sku-a', provenance: { materialAssetV2: frontMetadata },
    },
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0]?.id, created.request.id);
  assert.equal(matched[0]?.status, 'fulfilled');
  assert.equal(matched[0]?.fulfillments[0]?.materialId, 'material-a');
  assert.deepEqual(await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: {
      id: 'material-a', type: 'image', productId: 'sku-a', provenance: { materialAssetV2: frontMetadata },
    },
  }), [], 'resolved requests are not re-added');

  const dieline = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'product_packaging_dieline_pdf', title: '包装刀模', productId: 'sku-a',
    },
  });
  const dielineMatches = await autoFulfillProductionInputRequestsForMaterial({
    store, tenantId: 'tenant-a', material: {
      id: 'material-dieline', type: 'document', productId: 'sku-a', provenance: { materialAssetV2: normalizeMaterialAssetV2({
        assetRole: 'exact_product', contentRole: 'packaging_dieline', productIdentityLevel: 'exact',
      }) },
    },
  });
  assert.equal(dielineMatches[0]?.id, dieline.request.id);
});

test('production inputs: minimum items, dimensions, documents and waiver are explicit', async () => {
  const store = createProductionTestStore();
  const cutout = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'product_transparent_png', title: '两张透明底图', productId: 'sku-a', minimumItems: 2,
    },
  });
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: cutout.request.id,
    fulfillment: { type: 'document', sourceId: 'opaque-upload', mimeType: 'image/png', fileName: 'opaque.png' },
  }), /production_input_transparency_confirmation_required/);
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: cutout.request.id,
    fulfillment: {
      type: 'document', sourceId: 'untyped-upload', fileName: 'front.png',
      data: { transparentBackgroundConfirmed: true },
    },
  }), /production_input_fulfillment_mime_required/);
  const partial = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: cutout.request.id,
    fulfillment: { type: 'document', sourceId: 'upload-1', mimeType: 'image/png', fileName: 'front.png', data: { transparentBackgroundConfirmed: true } },
  });
  assert.equal(partial.request.status, 'partial');
  const replayedPartial = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: cutout.request.id,
    fulfillment: {
      type: 'document', sourceId: 'upload-1', mimeType: 'image/png', fileName: 'front.png',
      data: { transparentBackgroundConfirmed: true },
    },
  });
  assert.equal(replayedPartial.changed, false);
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: cutout.request.id,
    fulfillment: {
      type: 'document', sourceId: 'upload-1', mimeType: 'image/png', fileName: 'different.png',
      data: { transparentBackgroundConfirmed: true },
    },
  }), /production_input_fulfillment_idempotency_conflict/);
  const fulfilled = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: cutout.request.id,
    fulfillment: { type: 'document', sourceId: 'upload-2', mimeType: 'image/png', fileName: 'back.png', data: { transparentBackgroundConfirmed: true } },
  });
  assert.equal(fulfilled.request.status, 'fulfilled');

  const dimensions = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: { kind: 'product_dimensions', title: '尺寸', productId: 'sku-a' },
  });
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: dimensions.request.id,
    fulfillment: { type: 'structured_data', sourceId: 'dimension-v1', data: { width: 0, height: 20, unit: 'mm' } },
  }), /production_input_dimensions_invalid/);
  const dimensionResult = await fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: dimensions.request.id,
    fulfillment: { type: 'structured_data', sourceId: 'dimension-v2', data: { width: 10, height: 20, depth: 5, unit: 'mm' } },
  });
  assert.equal(dimensionResult.request.status, 'fulfilled');

  const evidence = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'fact_evidence', title: '认证依据', subjectRef: 'claim:certification', acceptedMimeTypes: ['application/pdf'],
    },
  });
  await assert.rejects(fulfillProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: evidence.request.id,
    fulfillment: { type: 'document', sourceId: 'doc-1', mimeType: 'image/png' },
  }), /production_input_fulfillment_mime_not_accepted/);
  const waived = await waiveProductionInputRequest({
    store, tenantId: 'tenant-a', requestId: evidence.request.id, reason: '本条文案已删除，不再需要证明材料',
  });
  assert.equal(waived.status, 'waived');
  const reopened = await createOrReuseProductionInputRequest({
    store, tenantId: 'tenant-a', userId: 'user-a', request: {
      kind: 'fact_evidence', title: '认证依据再次需要', subjectRef: 'claim:certification',
      acceptedMimeTypes: ['application/pdf'], bindings: [{ taskId: 'task-new', shotId: 'proof-1' }],
    },
  });
  assert.equal(reopened.created, false);
  assert.equal(reopened.request.status, 'open', 'a new binding must not inherit an old shot waiver');
});

test('material v2 rejects impossible reuse scores and exposes enterprise-common scene plates', () => {
  assert.throws(() => normalizeMaterialAssetV2({ reuseScore: 2 }), /material_v2_reuse_score_invalid/);
  assert.throws(() => normalizeMaterialAssetV2({
    assetRole: 'exact_product', contentRole: 'product_front', productIdentityLevel: 'none',
  }), /material_v2_exact_product_identity_mismatch/);
  assert.throws(() => normalizeMaterialAssetV2({
    assetRole: 'supporting', contentRole: 'other', productIdentityLevel: 'exact', enterpriseCommon: true,
  }), /material_v2_exact_product_identity_mismatch/);
  assert.throws(() => normalizeMaterialAssetV2({
    assetRole: 'exact_product', contentRole: 'product_front', productIdentityLevel: 'exact', enterpriseCommon: true,
  }), /material_v2_enterprise_common_exact_product_conflict/);
  const common = normalizeMaterialAssetV2({
    assetRole: 'generic_scene_plate', contentRole: 'scene_plate', productIdentityLevel: 'none',
    enterpriseCommon: false, templateEligible: true, reuseScore: 0.95,
  });
  assert.equal(common.enterpriseCommon, true, 'generic scene plates are canonical product-unbound enterprise assets');
  assert.equal(common.productIdentityLevel, 'none');
});
