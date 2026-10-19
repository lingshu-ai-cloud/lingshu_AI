import assert from 'node:assert/strict';
import test from 'node:test';
import { productFootageCandidateEvidence } from './enterpriseProductFootageCandidate.js';
import { automaticSocialMaterialEligible } from '../starter198/socialContentProductionMaterials.js';

test('same-product video requires separately identifiable identity and rights evidence', () => {
  const base = { productId: 'product-1', mediaType: 'video/mp4',
    identityEvidenceRef: 'enterprise-review:product-1:frame-7',
    rightsEvidenceRef: 'license-document:enterprise:video-9' };
  assert.deepEqual(productFootageCandidateEvidence(base), {
    productId: 'product-1', identityEvidenceRef: base.identityEvidenceRef,
    rightsEvidenceRef: base.rightsEvidenceRef,
  });
  assert.equal(productFootageCandidateEvidence({ ...base, identityEvidenceRef: 'confirmed' }), null);
  assert.equal(productFootageCandidateEvidence({ ...base, rightsEvidenceRef: true }), null);
  assert.equal(productFootageCandidateEvidence({ ...base, rightsEvidenceRef: '' }), null);
  assert.equal(productFootageCandidateEvidence({ ...base, mediaType: 'image/png' }), null);
  assert.equal(productFootageCandidateEvidence({ ...base, productId: '' }), null);
});

test('pending footage cannot enter production through tenant ownership or editable legacy metadata', () => {
  const material = { id: 'candidate', tenantId: 'tenant-a', type: 'video', scope: 'own', usage: 'editable',
    rightsStatus: 'authorized', commercialUseApproved: true, derivativesApproved: true,
    rawLibraryUseApproved: true, mayUseInProduction: true,
    provenance: { footageCandidate: { status: 'pending_independent_review' } } };
  assert.equal(automaticSocialMaterialEligible(material, 'tenant-a'), false);
  assert.equal(automaticSocialMaterialEligible(material, 'tenant-b'), false);
});
