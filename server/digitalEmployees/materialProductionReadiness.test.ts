import assert from 'node:assert/strict';
import type { BenchmarkAnalysis } from '../../shared/benchmarkAnalysis.js';
import type { AssetCandidate } from './contentProductionContracts.js';
import { assessStoryboardMaterialReadiness, resolveMaterialProductAssociation } from './materialProductionReadiness.js';

const products = [
  { id: 'product-serum', name: '积雪草修护精华', sku: 'SERUM-01' },
  { id: 'product-cleanser', name: '云朵泡沫卸妆蜜', sku: 'CLEAN-01' },
];

assert.deepEqual(resolveMaterialProductAssociation({ productId: 'product-cleanser' }, products), {
  productId: 'product-cleanser', productName: '云朵泡沫卸妆蜜', source: 'product_id',
});
assert.deepEqual(resolveMaterialProductAssociation({ productName: '云朵泡沫卸妆蜜' }, products), {
  productId: 'product-cleanser', productName: '云朵泡沫卸妆蜜', source: 'product_name',
});
assert.equal(resolveMaterialProductAssociation({ name: '云朵泡沫卸妆蜜产品正面.jpg' }, products)?.productId, 'product-cleanser');
assert.equal(resolveMaterialProductAssociation({ scope: 'shared', name: '云朵泡沫卸妆蜜产品正面.jpg' }, products), null, 'shared cloud material must not be reclassified as tenant product material');
assert.equal(resolveMaterialProductAssociation({ productId: 'stale-product', name: '云朵泡沫卸妆蜜.jpg' }, products), null, 'stale explicit IDs must not be silently rebound');

const analysis: BenchmarkAnalysis = {
  schemaVersion: 1,
  source: { videoId: 'video', analysisRunId: 'run', evidenceRevision: 'v1', correctionVersion: 0, analyzedAt: '2026-10-08', analysisMode: 'exact' },
  status: 'ready', gaps: [], hookShotId: 'shot-1', totalShots: 3, timelineComplete: true,
  materialCounts: { talking_head: 0, factory: 1, product: 1, consumer_demo: 1, general: 0, unknown: 0 },
  shots: [
    { shotId: 'shot-1', index: 1, time: '0-3', start: 0, end: 3, materialType: 'product', narrativeRole: 'product_intro', classificationSource: 'model', classificationEvidence: '产品静态展示', visual: '产品瓶身正面静态特写', dialogue: '', onScreenText: '', purpose: '产品介绍', firstFrameRef: null, clipRef: null, needsReview: false, granularity: 'shot', environment: '', framing: '', camera: '固定镜头', audio: '', authenticity: '', effectivenessHypothesis: '', detailedAnalysis: {} },
    { shotId: 'shot-2', index: 2, time: '3-6', start: 3, end: 6, materialType: 'consumer_demo', narrativeRole: 'effect_proof', classificationSource: 'model', classificationEvidence: '涂抹演示', visual: '真人将卸妆蜜涂抹并揉搓起泡', dialogue: '', onScreenText: '', purpose: '使用效果证明', firstFrameRef: null, clipRef: null, needsReview: false, granularity: 'shot', environment: '', framing: '', camera: '', audio: '', authenticity: '', effectivenessHypothesis: '', detailedAnalysis: {} },
    { shotId: 'shot-3', index: 3, time: '6-9', start: 6, end: 9, materialType: 'factory', narrativeRole: 'capability_proof', classificationSource: 'model', classificationEvidence: '工厂灌装', visual: '灌装线运行', dialogue: '', onScreenText: '', purpose: '能力证明', firstFrameRef: null, clipRef: null, needsReview: false, granularity: 'shot', environment: '工厂', framing: '', camera: '', audio: '', authenticity: '', effectivenessHypothesis: '', detailedAnalysis: {} },
  ],
  structure: [
    { materialType: 'product', narrativeRole: 'product_intro', shotIds: ['shot-1'] },
    { materialType: 'consumer_demo', narrativeRole: 'effect_proof', shotIds: ['shot-2'] },
    { materialType: 'factory', narrativeRole: 'capability_proof', shotIds: ['shot-3'] },
  ],
  speechGroups: [],
};

const asset = (value: Partial<AssetCandidate> & Pick<AssetCandidate, 'id' | 'name' | 'type'>): AssetCandidate => ({
  duration: value.type === 'video' ? 8 : 0, observations: [], visualObservations: [], tags: [],
  authorization: { status: 'owned', scope: 'tenant', evidence: 'test' }, synthetic: false, source: 'tenant_material',
  ...value,
});

const imageOnly = assessStoryboardMaterialReadiness({ analysis, presenter: 'material', assets: [asset({ id: 'image', name: '产品正面', type: 'image', productId: 'product-cleanser', productName: '云朵泡沫卸妆蜜' })] });
assert.equal(imageOnly.decisions[0]?.assetId, 'image', 'a static product shot can start from a product image');
assert.equal(imageOnly.blockers.length, 2, 'unwired system fallback plans must remain explicit production inputs');
assert.equal(imageOnly.decisions[1]?.assetId, 'image', 'the exact identity image remains visible while the user chooses an executable route');
assert.equal(imageOnly.decisions[1]?.resolution, 'needs_input');
assert.equal(imageOnly.decisions[1]?.productionRoute, 'confirm_identity_motion_route_or_bind_dynamic_asset');
assert.match(imageOnly.decisions[1]?.blocker || '', /不会默认创建实拍任务/);
assert.equal(imageOnly.decisions[2]?.assetId, '', 'a static image must not satisfy a factory process shot');
assert.equal(imageOnly.decisions[2]?.resolution, 'needs_input');
assert.equal(imageOnly.decisions[2]?.productionRoute, 'confirm_factory_rewrite_or_bind_authorized_asset');
assert.match(imageOnly.decisions[2]?.blocker || '', /事实卡片|流程说明/);

const noIdentityAsset = assessStoryboardMaterialReadiness({ analysis, presenter: 'material', assets: [] });
assert.equal(noIdentityAsset.decisions[1]?.resolution, 'needs_input');
assert.match(noIdentityAsset.blockers.join('；'), /清晰正面图/);
assert.doesNotMatch(noIdentityAsset.blockers.join('；'), /真实动态产品视频|真实工厂/);
assert.match(noIdentityAsset.blockers.join('；'), /不会默认创建实拍任务/);
assert.equal(noIdentityAsset.decisions[2]?.resolution, 'needs_input', 'an unconsumed factory fallback must not be advertised as executable');
assert.match(noIdentityAsset.decisions[2]?.blocker || '', /不会默认创建实拍任务/);

const genericVideoOnly = assessStoryboardMaterialReadiness({ analysis, presenter: 'material', assets: [asset({
  id: 'generic-demo', name: '通用人物动作', type: 'video', tags: ['动作'],
})] });
assert.equal(genericVideoOnly.decisions[0]?.resolution, 'needs_input', 'a generic image/video must not be mistaken for exact product identity');
assert.equal(genericVideoOnly.decisions[1]?.resolution, 'needs_input', 'a generic action video must not satisfy a product demo identity requirement');
assert.match(genericVideoOnly.blockers.join('；'), /清晰正面图|主体身份/);

const licensedFactory = assessStoryboardMaterialReadiness({ analysis, presenter: 'material', assets: [asset({
  id: 'licensed-factory', name: '共享工厂灌装线', type: 'video', tags: ['工厂'], source: 'licensed_shared_material',
  authorization: { status: 'licensed', scope: 'shared', evidence: 'licensed stock' },
})] });
assert.equal(licensedFactory.decisions[2]?.resolution, 'needs_input', 'shared factory footage may explain a process but cannot silently become customer factory evidence');
assert.match(licensedFactory.decisions[2]?.productionNote || '', /流程说明|已授权工厂素材/);

const ready = assessStoryboardMaterialReadiness({ analysis, presenter: 'material', assets: [
  asset({ id: 'image', name: '产品正面', type: 'image', productId: 'product-cleanser', productName: '云朵泡沫卸妆蜜' }),
  asset({ id: 'demo', name: '产品使用演示', type: 'video', productId: 'product-cleanser', productName: '云朵泡沫卸妆蜜' }),
  asset({ id: 'factory', name: '工厂灌装线', type: 'video', tags: ['工厂', '灌装'] }),
] });
assert.deepEqual(ready.blockers, []);
assert.deepEqual(assessStoryboardMaterialReadiness({ analysis, presenter: 'avatar', assets: [] }).blockers, [], 'pure avatar production must not be blocked by product footage');

const generalAnalysis: BenchmarkAnalysis = {
  ...analysis,
  materialCounts: { talking_head: 0, factory: 0, product: 0, consumer_demo: 0, general: 1, unknown: 0 },
  shots: [{ ...analysis.shots[0]!, materialType: 'general', narrativeRole: 'transition', visual: '办公室环境与图形转场' }],
  structure: [{ materialType: 'general', narrativeRole: 'transition', shotIds: ['shot-1'] }],
};
assert.deepEqual(assessStoryboardMaterialReadiness({ analysis: generalAnalysis, presenter: 'material', assets: [] }).blockers, [], 'general footage is a real optional production category');
const unknownAnalysis: BenchmarkAnalysis = {
  ...generalAnalysis,
  materialCounts: { talking_head: 0, factory: 0, product: 0, consumer_demo: 0, general: 0, unknown: 1 },
  shots: [{ ...generalAnalysis.shots[0]!, materialType: 'unknown', classificationEvidence: '', needsReview: true }],
  structure: [{ materialType: 'unknown', narrativeRole: 'transition', shotIds: ['shot-1'] }],
};
for (const presenter of ['material', 'avatar'] as const) {
  const unresolved = assessStoryboardMaterialReadiness({ analysis: unknownAnalysis, presenter, assets: [asset({ id: 'fallback', name: '任意素材', type: 'video' })] });
  assert.equal(unresolved.decisions[0]?.requirement, 'unresolved');
  assert.equal(unresolved.decisions[0]?.assetId, '');
  assert.match(unresolved.blockers.join('；'), /素材类型待判断/);
}

console.log('material product association and per-storyboard readiness tests passed');
