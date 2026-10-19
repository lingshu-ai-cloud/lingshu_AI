import assert from 'node:assert/strict';
import test from 'node:test';
import { socialReplicationIdentityGaps, socialReplicationScriptReviewHash } from './socialContentReplicationScriptReview.js';

const script = {
  version: '4', referenceAnalysisId: 'analysis-1', status: 'review_required',
  primaryHookId: 'hook-1', hookOptions: [{hookId:'hook-1'}, {hookId:'hook-2'}, {hookId:'hook-3'}],
  shots: [{shotId:'shot-1', visualInstruction:'展示真实包装'}],
  structureFidelitySummary: '结构已核对', originalityDifferenceSummary: '产品事实已替换',
  createdAt: '2026-10-16T00:00:00.000Z',
};

test('review hash binds immutable script content and survives confirmation receipt', () => {
  const hash = socialReplicationScriptReviewHash(script);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(socialReplicationScriptReviewHash({ ...script, status: 'confirmed', review: {
    schemaVersion: 'social-replication-script-review.v1', reviewedBy: 'owner', reviewedAt: 'later',
  } }), hash);
  assert.notEqual(socialReplicationScriptReviewHash({ ...script,
    shots: [{shotId:'shot-1', visualInstruction:'未经审核的变化'}] }), hash);
});

test('advanced review refuses inferred reference products until exact enterprise identity and fact are frozen', () => {
  const binding = { productId: 'coosto-spray', productName: 'COOSTO', productSku: null,
    enterpriseFactRef: 'enterprise_fact:fact-1@3', enterpriseFactId: 'fact-1', enterpriseFactRevision: 3,
    enterpriseFactContentHash: 'a'.repeat(64), confirmedAt: '2026-10-16T00:00:00.000Z' };
  const productScript = { ...script, shots: [{ ...script.shots[0], materialPlan: {
    shotId: 'shot-1', function: 'trust', requestedDescription: '展示参考包装', sourceStrategy: 'customer_real_asset',
    sourceRefs: [], fallbackSourceStrategy: null, productionInstruction: '仅使用真实商品素材',
    truthBoundary: { subject: 'none', syntheticVisualAllowed: false, customerEvidenceRequired: false,
      customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: false,
      prohibitedRepresentations: ['alter_locked_product_identity'] },
    functionalEquivalentReplacement: { required: false, preservesFunction: 'trust', replacesSubject: null, description: null, reason: null },
    feasibility: 'goal_degraded', feasibilityReason: '待商品身份', customerShootRequired: false,
    visualContract: { schemaVersion: 'social-scene-visual-contract.v1', subjects: [{ subjectId: 'p', kind: 'product', description: '商品', identityRef: null, confidence: null }],
      interaction: { kind: 'product_only', description: '展示', actorSubjectId: null, objectSubjectId: 'p', contactArea: null },
      environment: { kind: 'studio', description: '棚拍', details: [] }, productUsage: { kind: 'show', description: '展示', productId: null, productRef: '参考商品' },
      product: { policy: 'preferred', requestedProductId: null, requestedProductRef: '参考商品', source: 'agent_inferred' },
      action: { startState: '', path: '展示', peakState: '', endState: '', startSeconds: 0, peakSeconds: null, endSeconds: 1 },
      camera: { shotSize: '特写', angle: '平视', movement: '固定', composition: '居中' }, precision: 'standard',
      evidence: { sourceRange: { startSeconds: 0, endSeconds: 1 }, keyframeIds: [], confidence: 1 } },
  }}] } as any;
  assert.deepEqual(socialReplicationIdentityGaps(productScript, binding), [{ shotId: 'shot-1', code: 'product_identity_not_locked' }]);
  const locked = structuredClone(productScript);
  locked.shots[0].materialPlan.visualContract.product = { policy: 'locked', requestedProductId: binding.productId, requestedProductRef: binding.productName, source: 'user_explicit' };
  locked.shots[0].materialPlan.visualContract.productUsage.productId = binding.productId;
  assert.deepEqual(socialReplicationIdentityGaps(locked, binding), [{ shotId: 'shot-1', code: 'product_fact_not_bound' }]);
  locked.shots[0].materialPlan.truthBoundary.confirmedFactRefs = [binding.enterpriseFactRef];
  assert.deepEqual(socialReplicationIdentityGaps(locked, binding), []);
});
