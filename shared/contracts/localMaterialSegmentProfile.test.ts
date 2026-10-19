import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneVisualContract } from '../sceneVisualContract.js';
import {
  buildLocalMaterialSegmentProfile,
  evaluateLocalMaterialSegmentProfile,
  normalizeLocalMaterialSegmentProfile,
} from './localMaterialSegmentProfile.js';

const shelf = normalizeSceneVisualContract({
  subjects: ['product'],
  interaction: { kind: 'product_only_display', description: '同款产品在货架整齐陈列' },
  environment: { kind: 'retail', description: '企业样品间货架' },
  productRef: 'product:SKU-1',
  productPolicy: 'locked',
  camera: { shotSize: '中景', movement: '固定', composition: '产品居中' },
});

function profile(overrides: Partial<Parameters<typeof buildLocalMaterialSegmentProfile>[0]> = {}) {
  return buildLocalMaterialSegmentProfile({
    tenantId: 'tenant-a', sourceTenantId: 'tenant-a', origin: 'my_materials',
    assetId: 'asset-a', segmentId: 'segment-a', sourceRevision: 'sha256-a', currentSourceRevision: 'sha256-a',
    mediaType: 'video', synthetic: false, startSeconds: 1, endSeconds: 5,
    materialType: 'product', materialRoles: ['product'], productId: 'SKU-1', productRef: 'product:SKU-1',
    visualContract: shelf, observedActionTags: ['产品陈列'], framingTags: ['中景'], cameraMovementTags: ['固定'],
    entityAndTextTags: ['SKU-1'], rightsEvidenceRefs: ['rights://tenant-a/asset-a'], commercialUseApproved: true,
    commercialUseApprovalEvidenceRefs: ['approval://tenant-a/asset-a'],
    modelInputAllowed: false, derivativeUseAllowed: true, confidence: 0.94, needsReview: false,
    cleanEntry: true, cleanExit: true, ...overrides,
  });
}

test('eligible local video segment produces a normalized versioned profile', () => {
  const built = profile();
  assert.ok(built.profile);
  assert.equal(built.profile.productionEligible, true);
  assert.deepEqual(built.profile.rejectionReasons, []);
  assert.deepEqual(built.profile.archetypeCandidates, ['P2B_PRODUCT_SHELF']);
  assert.equal(built.profile.commercialUseApproved, true);
  assert.deepEqual(built.profile.commercialUseApprovalEvidenceRefs, ['approval://tenant-a/asset-a']);
  assert.deepEqual([built.profile.startMs, built.profile.endMs], [1000, 5000]);
  assert.deepEqual(normalizeLocalMaterialSegmentProfile({...built.profile, productionEligible: false}), built.profile,
    'normalization recomputes eligibility instead of trusting a stored flag');
});

test('rights, source revision and edit-boundary gaps fail closed with precise reasons', () => {
  const built = profile({ currentSourceRevision: 'sha256-new', rightsEvidenceRefs: ['tenant_upload_unverified'],
    commercialUseApproved: false, derivativeUseAllowed: false, cleanExit: false });
  assert.ok(built.profile);
  assert.equal(built.profile.productionEligible, false);
  assert.deepEqual(new Set(built.rejectionReasons), new Set([
    'source_revision_mismatch', 'rights_evidence_missing', 'commercial_use_not_allowed',
    'commercial_use_evidence_missing', 'derivative_use_not_allowed', 'edit_boundary_unverified',
  ]));
});

test('normalization preserves commercial approval receipts and rejects legacy or tampered eligibility flags', () => {
  const built = profile();
  assert.ok(built.profile);
  const normalized = normalizeLocalMaterialSegmentProfile({ ...built.profile,
    commercialUseApprovalEvidenceRefs: [' approval://tenant-a/asset-a ', 'pending'],
  });
  assert.ok(normalized);
  assert.equal(normalized.commercialUseApproved, true);
  assert.deepEqual(normalized.commercialUseApprovalEvidenceRefs, ['approval://tenant-a/asset-a']);
  const legacy = { ...built.profile } as Record<string, unknown>;
  delete legacy.commercialUseApproved;
  delete legacy.commercialUseApprovalEvidenceRefs;
  legacy.productionEligible = true;
  legacy.rejectionReasons = [];
  const rejected = normalizeLocalMaterialSegmentProfile(legacy);
  assert.ok(rejected);
  assert.equal(rejected.productionEligible, false);
  assert.ok(rejected.rejectionReasons.includes('commercial_use_not_allowed'));
  assert.ok(rejected.rejectionReasons.includes('commercial_use_evidence_missing'));
});

test('commercial approval without usable approval evidence fails closed', () => {
  const built = profile({ commercialUseApprovalEvidenceRefs: ['pending'] });
  assert.ok(built.profile);
  assert.equal(built.profile.productionEligible, false);
  assert.ok(built.rejectionReasons.includes('commercial_use_evidence_missing'));
});

test('target admission also enforces frozen archetype, SKU, duration and weekly non-reuse', () => {
  const built = profile();
  assert.ok(built.profile);
  const accepted = evaluateLocalMaterialSegmentProfile({ profile: built.profile, tenantId: 'tenant-a',
    assetId: 'asset-a', segmentId: 'segment-a', targetMaterialType: 'product',
    targetArchetypeId: 'P2B_PRODUCT_SHELF', requestedProductRef: 'SKU-1', requiredDurationSeconds: 3 });
  assert.deepEqual(accepted, []);
  const rejected = evaluateLocalMaterialSegmentProfile({ profile: built.profile, tenantId: 'tenant-a',
    assetId: 'asset-a', segmentId: 'segment-a', targetMaterialType: 'product',
    targetArchetypeId: 'P2C_PACKAGE_DETAIL', requestedProductRef: 'SKU-2', requiredDurationSeconds: 6,
    alreadyUsed: true });
  assert.deepEqual(new Set(rejected), new Set([
    'archetype_mismatch', 'product_identity_mismatch', 'duration_insufficient', 'segment_already_used_in_plan',
  ]));
});

test('persisted archetype labels cannot override missing or forbidden material roles', () => {
  const built = profile();
  assert.ok(built.profile);
  const tampered = { ...built.profile, materialRoles: ['factory' as const],
    archetypeCandidates: ['P2B_PRODUCT_SHELF' as const] };
  const rejected = evaluateLocalMaterialSegmentProfile({ profile: tampered, tenantId: 'tenant-a',
    assetId: 'asset-a', segmentId: 'segment-a', targetMaterialType: 'product',
    targetArchetypeId: 'P2B_PRODUCT_SHELF', requestedProductRef: null, requiredDurationSeconds: 3 });
  assert.ok(rejected.includes('required_material_role_missing'));
  assert.ok(rejected.includes('forbidden_material_role_present'));
  assert.ok(rejected.includes('product_identity_mismatch'));
});

test('shared, synthetic or non-video rows can be indexed but never become production eligible', () => {
  const built = profile({ sourceTenantId: 'shared', origin: 'shared_library', mediaType: 'image', synthetic: true });
  assert.ok(built.profile);
  assert.equal(built.profile.productionEligible, false);
  assert.ok(built.rejectionReasons.includes('tenant_mismatch'));
  assert.ok(built.rejectionReasons.includes('local_ownership_missing'));
  assert.ok(built.rejectionReasons.includes('non_video_source'));
  assert.ok(built.rejectionReasons.includes('synthetic_source'));
});
