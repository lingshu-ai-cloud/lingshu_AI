import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMaterialScriptAnalysis } from '../materialScriptAnalysis.js';
import { buildMaterialCapabilityManifest } from './materialCapabilityManifest.js';
import { normalizeMaterialAssetV2 } from './materialAssetV2.js';

test('delivers one production manifest joining analysis, identity, rights and edit boundaries', () => {
  const sourceRevision = 'a'.repeat(64);
  const scriptAnalysis = buildMaterialScriptAnalysis({
    materialId: 'material-1', name: '产品主图', sourceRevision, duration: 0,
    productId: 'sku-1', productRef: 'product:sku-1', productPolicy: 'locked',
    visualObservations: ['白底产品包装正面，标签清晰'], analyzedAt: '2026-10-19T00:00:00.000Z',
  });
  const materialV2 = normalizeMaterialAssetV2({
    assetRole: 'exact_product', contentRole: 'product_front', productIdentityLevel: 'exact',
    enterpriseCommon: false, subjectRefs: ['product:sku-1'], cleanPlate: true,
    labelReadability: 'high', templateEligible: false, reuseScore: .92, segmentCandidates: [],
  });
  const manifest = buildMaterialCapabilityManifest({
    id: 'material-1', type: 'image', name: '产品主图', productId: 'sku-1', productRef: 'product:sku-1',
    contentSha256: sourceRevision, scriptAnalysis, materialV2,
    rightsEvidenceRef: 'tenant-consent:1', commercialUseApproved: true,
    derivativesApproved: true, rawLibraryUseApproved: true,
  });
  assert.equal(manifest.schemaVersion, 'material-capability-manifest.v1');
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.identity.level, 'exact');
  assert.equal(manifest.quality.analysisCompleted, true);
  assert.ok(manifest.capabilities.includes('semantic_search'));
  assert.ok(manifest.capabilities.includes('exact_product_reference'));
  assert.ok(manifest.capabilities.includes('image_generation_reference'));
});

test('does not silently turn analyzed but unlicensed uploads into production inputs', () => {
  const manifest = buildMaterialCapabilityManifest({
    id: 'material-2', type: 'image', name: '待确认图片', segmentAnalysisStatus: 'completed',
    sourceRevision: 'v1', sourceType: 'tenant_upload',
  });
  assert.equal(manifest.status, 'review_required');
  assert.equal(manifest.capabilities.includes('image_generation_reference'), false);
  assert.ok(manifest.blockers.some(item => item.code === 'rights_evidence_missing'));
  assert.ok(manifest.blockers.some(item => item.code === 'model_input_not_approved'));
});

test('treats explicit enterprise product binding as exact identity without visual guesswork', () => {
  const manifest = buildMaterialCapabilityManifest({
    id: 'enterprise-1', type: 'image', name: '产品图', sourceType: 'enterprise_product_table',
    productId: 'sku-9', productName: '产品九', sourceRevision: 'catalog-v2',
    rightsEvidenceRef: 'enterprise-profile:sku-9', commercialUseApproved: true,
    derivativesApproved: true, rawLibraryUseApproved: true,
  });
  assert.equal(manifest.identity.level, 'exact');
  assert.equal(manifest.classification.assetRole, 'exact_product');
  assert.ok(manifest.capabilities.includes('exact_product_reference'));
  assert.ok(manifest.capabilities.includes('image_generation_reference'));
});

test('keeps generated images out of model input until a user review is recorded', () => {
  const sourceRevision = 'b'.repeat(64);
  const scriptAnalysis = buildMaterialScriptAnalysis({
    materialId: 'generated-1', name: 'AI 产品场景图', sourceRevision, duration: 0,
    visualObservations: ['AI 生成的产品场景图'], analyzedAt: '2026-10-19T00:00:00.000Z',
  });
  const supportingMetadata = normalizeMaterialAssetV2({
    assetRole: 'supporting', contentRole: 'product_front', productIdentityLevel: 'category',
    enterpriseCommon: false, subjectRefs: ['product:sku-1'], cleanPlate: true,
    labelReadability: 'medium', templateEligible: false, reuseScore: .72, segmentCandidates: [],
  });
  const readyImage = {
    id: 'generated-1', type: 'image', name: 'AI 产品场景图', contentSha256: sourceRevision,
    productId: 'sku-1', scriptAnalysis, rightsEvidenceRef: 'generated:model:hash',
    commercialUseApproved: true, derivativesApproved: true, rawLibraryUseApproved: true,
  };
  const pending = buildMaterialCapabilityManifest({
    ...readyImage,
    sourceType: 'ai_generated_marketing_image',
    provenance: { qualityStatus: 'needs_review', materialAssetV2: supportingMetadata },
  });
  assert.equal(pending.capabilities.includes('image_generation_reference'), false);
  assert.match(pending.blockers.map(item => item.message).join(' '), /人工外观与文字复核/);

  const accepted = buildMaterialCapabilityManifest({
    ...readyImage,
    sourceType: 'ai_generated_marketing_image',
    provenance: { qualityStatus: 'accepted', materialAssetV2: supportingMetadata },
  });
  assert.equal(accepted.capabilities.includes('image_generation_reference'), true);
});
