import assert from 'node:assert/strict';
import {
  buildSceneCapabilitySignature,
  inferMaterialRoles,
  normalizeSceneVisualContract,
  resolveProductCompatibility,
  scoreSceneVisualCompatibility,
} from './sceneVisualContract.js';

const faceApplication = normalizeSceneVisualContract({
  subjects: [
    { subjectId: 'person-1', kind: 'person', description: '人物面部' },
    { subjectId: 'product-1', kind: 'product', description: '精华瓶' },
  ],
  interaction: { kind: 'apply_product_to_face', description: '人物将精华涂到右侧脸颊', contactArea: '右侧脸颊' },
  environment: { kind: 'bathroom', description: '浴室洗手台' },
  productUsage: { kind: 'apply_to_face', description: '滴管精华上脸', productId: 'sku-serum-1', productRef: '积雪草精华' },
  product: { policy: 'locked', requestedProductId: 'sku-serum-1', requestedProductRef: '积雪草精华', source: 'user_explicit' },
  action: { startState: '手持滴管', path: '滴到脸颊并涂开', peakState: '接触脸颊', endState: '均匀涂开', startSeconds: 0.2, peakSeconds: 1.2, endSeconds: 2.6 },
  camera: { shotSize: '面部近景', angle: '平视', movement: '轻微推进', composition: '人物居中' },
  precision: 'hook_high',
});

assert.equal(faceApplication.interaction.kind, 'apply_product_to_face');
assert.deepEqual(inferMaterialRoles(faceApplication), ['product', 'person_usage', 'environment']);
assert.ok(scoreSceneVisualCompatibility(faceApplication, faceApplication) >= 0.99);

const factory = normalizeSceneVisualContract({ subjects: ['工厂工人', '灌装设备'], action: '工人操作灌装设备', environment: '工厂产线' });
assert.equal(factory.interaction.kind, 'person_factory_interaction');
assert.ok(inferMaterialRoles(factory).includes('factory'));
assert.ok(scoreSceneVisualCompatibility(faceApplication, factory) < 0.55);

assert.deepEqual(resolveProductCompatibility({
  policy: 'locked', requestedProductRef: '产品 A', candidateProductRef: '产品 B', candidateMaterialRoles: ['product'],
}), { compatible: false, score: 0, reason: 'different_product' });
assert.equal(resolveProductCompatibility({
  policy: 'locked', requestedProductId: 'sku-1', requestedProductRef: '同名产品',
  candidateProductId: 'sku-2', candidateProductRef: '同名产品', candidateMaterialRoles: ['product'],
}).compatible, false, 'stable product ids override ambiguous identical display names');
assert.equal(resolveProductCompatibility({
  policy: 'locked', requestedProductRef: '产品 A', candidateProductRef: null, candidateMaterialRoles: ['general'], enterpriseCommon: true,
}).compatible, true, 'locked tasks may still use generic material that does not show a conflicting product');
assert.equal(resolveProductCompatibility({
  policy: 'preferred', requestedProductRef: '产品 A', candidateProductRef: '产品 B', candidateMaterialRoles: ['product'],
}).compatible, true, 'preferred product mismatch lowers rank but never blocks production');
assert.equal(resolveProductCompatibility({
  policy: 'open', requestedProductRef: null, candidateProductRef: '任意产品', candidateMaterialRoles: ['product'],
}).score, 1);

const signature = buildSceneCapabilitySignature(faceApplication);
assert.equal(signature.requiresPerson, true);
assert.equal(signature.requiresProductIdentity, true);
assert.equal(signature.requiresPersonProductContact, true);
assert.ok(signature.requiredCapabilities.includes('face_contact_control'));

console.log('scene visual contract tests passed');
