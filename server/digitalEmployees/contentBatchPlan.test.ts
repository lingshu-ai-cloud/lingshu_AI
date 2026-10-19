import assert from 'node:assert/strict';
import { buildContentBatchPlan, enterpriseAssetStableId } from './contentBatchPlan.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { normalizeVideoPlan } from '../../shared/contracts/videoCreationPlan.js';
import { referenceContentIdentity } from './referenceContentIdentity.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '企业', industry: '制造', primaryBusiness: '产品', targetMarkets: '美国', customerProfile: '经销商', approvalOwner: '负责人',
  enabledWorkflows: ['viral_clone', 'product_content', 'material_content'], socialCadence: '每周 5 条', publishingTargets: [], constraints: ['禁止虚构'],
});
assert.equal(config.smartOperationsEnabled, true, 'existing tenants default to Smart Operations enabled');
assert.equal(normalizeDigitalEmployeeConfig({ ...config, smartOperationsEnabled: false }).smartOperationsEnabled, false, 'the Smart Operations switch must persist an explicit off state');
const goal = normalizeWeeklyGoal({ objective: '获得询盘', contentPlatforms: ['youtube', 'tiktok'], constraints: ['禁止虚构认证'] }, config);
const planned = buildContentBatchPlan({
  goalId: 'goal-1', goal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }, { id: 'sku-2', name: '产品 B', materialIds: ['asset-b'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a', 'asset-b'] },
  versions: { configVersion: 7, policyVersion: 'p7', factsVersion: 'f7' },
});
assert.equal(planned.status, 'planned');
assert.equal(planned.orders.length, 1, 'automatic planning must not cycle one reference across five independent videos');
assert.deepEqual(planned.orders.map(order => order.route), ['clone'], 'new automatic fixed-yield plans must stay reference-led');
assert.equal(planned.coverage?.missing, 4, 'the existing coverage contract must expose reference-capacity under-coverage');
assert.ok(planned.orders.every(order => order.productionContractVersion === 'fixed-yield.v2-preflight'));
assert.ok(planned.orders.every(order => order.fixedYieldTimeline?.ready === false
  && order.readinessBlockers?.some(reason => reason.includes('完整精确分析事实尚未载入'))), 'an analysis id alone must not create an executable legacy order');
assert.ok(planned.orders.every(order => order.goalId === 'goal-1' && order.productId && order.theme.key && order.platform && order.cta));
assert.ok(planned.orders.every(order => order.evidenceRefs.filter(ref => ref.type === 'enterprise_material').every(ref => ref.id === (order.productId === 'sku-1' ? 'asset-a' : 'asset-b'))), 'A/B 产品不得串用素材');
assert.ok(planned.orders.every(order => order.accountId === '' && order.accountLabel.includes('不分发')));
assert.deepEqual(planned.orders[0]?.configurationSnapshot, { configVersion: 7, policyVersion: 'p7', factsVersion: 'f7' });

const publishing = buildContentBatchPlan({
  goalId: 'goal-1', goal,
  config: normalizeDigitalEmployeeConfig({ ...config, enabledWorkflows: ['product_content', 'content_publish'], publishingTargets: [] }),
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: [], materialIds: ['asset-a'] },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(publishing.status, 'blocked', 'automatic fixed-yield plans must not fall back to a standalone product route');
assert.equal(publishing.orders.length, 0);
assert.ok(publishing.blocker.includes('固定恒产计划'));

const noEvidence = buildContentBatchPlan({
  goalId: 'goal-1', goal, config,
  evidence: { products: [], exactAnalysisIds: [], materialIds: [] },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(noEvidence.status, 'blocked');
assert.equal(noEvidence.orders.length, 0);
assert.equal(enterpriseAssetStableId(1, 1, '/api/overseas/enterprise/assets/b.png'), `enterprise-product-1-1-${Buffer.from('/api/overseas/enterprise/assets/b.png').toString('base64url').slice(0, 12)}`);
assert.notEqual(enterpriseAssetStableId(0, 0, '/api/overseas/enterprise/assets/a.png'), enterpriseAssetStableId(1, 1, '/api/overseas/enterprise/assets/b.png'), '第二产品/素材必须保留独立稳定 ID');

const explicitMissingMaterialGoal = normalizeWeeklyGoal({
  ...goal,
  contentPlatforms: ['tiktok'],
  videoPlans: [normalizeVideoPlan({
    route: 'clone', productId: 'sku-1', productName: '产品 A', theme: '静态产品展示', language: 'en', duration: 30,
    platform: 'tiktok', presenter: 'material', referenceId: 'analysis-1', materialIds: [],
  })],
}, config);
const explicitMissingMaterial = buildContentBatchPlan({
  goalId: 'goal-missing-one', goal: explicitMissingMaterialGoal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: [] }], exactAnalysisIds: ['analysis-1'], materialIds: [] },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(explicitMissingMaterial.status, 'planned', 'missing visuals must remain a per-master readiness issue instead of dropping the whole weekly batch');
assert.equal(explicitMissingMaterial.orders.length, 1);
assert.equal(explicitMissingMaterial.orders[0]?.videoPlan?.productId, 'sku-1', 'the stable enterprise product ID must remain frozen on the production plan');

const feedbackRouted = buildContentBatchPlan({
  goalId: 'goal-2', goal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'] },
  versions: { configVersion: 8, policyVersion: 'p8', factsVersion: 'f8' },
  priorRoutingEvidence: {
    priorRouteDistribution: { clone: 8, product: 1, material: 1 },
    approvalFeedback: [{ note: '开头更直接' }],
    contentInheritance: { status: 'ready', title: '工厂透明度', hook: '采购商为什么不敢下单', framework: ['真人口播 · 钩子', '工厂生产 · 能力证明'] },
    tagAdaptation: { status: 'changed', newTags: ['smallbatch'], droppedTags: ['oldtag'], requiresConfirmation: true },
    industryTrends: { status: 'available', signals: [{ title: '小批量交付成为行业热点', sourceUrl: 'https://example.com/trend' }] },
  },
});
assert.equal(feedbackRouted.orders[0]?.route, 'clone', 'valid clone evidence remains an eligible route');
assert.ok(feedbackRouted.orders.every(order => order.constraints.includes('审批反馈：开头更直接')));
assert.ok(feedbackRouted.orders.every(order => order.constraints.some(item => item.includes('上轮优秀内容继承'))), '优秀内容的框架与钩子必须进入下一周制作约束');
assert.ok(feedbackRouted.orders.every(order => order.constraints.some(item => item.includes('#smallbatch'))), '热门 Tag 变化必须进入下一周验证约束');
assert.ok(feedbackRouted.orders.every(order => order.constraints.some(item => item.includes('采集范围变化需要人工确认'))), '采集范围不得被复盘静默扩大');
assert.ok(feedbackRouted.orders.every(order => order.constraints.some(item => item.includes('小批量交付成为行业热点'))), '可追溯行业信号必须进入下一周编导判断');

const explicitUnanalyzedClone = buildContentBatchPlan({
  goalId: 'no-clone-fallback', goal: explicitMissingMaterialGoal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: [], materialIds: ['asset-a'] },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(explicitUnanalyzedClone.status, 'planned', 'a missing clone analysis must block only that frozen master, not erase the weekly batch');
assert.equal(explicitUnanalyzedClone.orders.length, 1);
assert.ok(explicitUnanalyzedClone.orders[0]?.readinessBlockers?.some(issue => issue.includes('精确分析')));
assert.equal(explicitUnanalyzedClone.orders[0]?.productionContractVersion, 'fixed-yield.v2-preflight');
assert.equal(explicitUnanalyzedClone.orders[0]?.fixedYieldTimeline?.ready, false);

const referenceAdmissions = { 'analysis-1': { ready: false, blockers: ['第 8 镜：镜头类型未确认'],
  blockingShotIds: ['shot_8'], executableShotIds: ['shot_1', 'shot_2'], reviewShotIds: ['shot_8'] } };
const explicitReviewClone = buildContentBatchPlan({
  goalId: 'review-clone', goal: explicitMissingMaterialGoal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'], referenceAdmissions },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(explicitReviewClone.status, 'planned', 'do not erase or globally reject an explicit batch that contains partial evidence');
assert.equal(explicitReviewClone.orders[0].videoPlan?.referenceId, 'analysis-1');
assert.ok(explicitReviewClone.orders[0].readinessBlockers?.some(reason => reason.includes('第 8 镜')));
const automaticReviewClone = buildContentBatchPlan({
  goalId: 'auto-review-clone', goal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'], referenceAdmissions },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(automaticReviewClone.status, 'blocked', 'automatic new allocations must not fall back when the only reference still needs review');
assert.equal(automaticReviewClone.orders.length, 0);

const mixedReadinessGoal = normalizeWeeklyGoal({
  ...goal,
  contentPlatforms: ['tiktok'],
  videoPlans: [
    normalizeVideoPlan({ route: 'product', productId: 'sku-1', productName: '产品 A', theme: '真实产品展示', language: 'en', duration: 30, platform: 'tiktok', presenter: 'material' }),
    normalizeVideoPlan({ route: 'clone', productId: 'missing-product', productName: '产品 B', theme: '参考结构', language: 'en', duration: 30, platform: 'tiktok', presenter: 'material', referenceId: 'analysis-1' }),
  ],
}, config);
const mixedReadiness = buildContentBatchPlan({
  goalId: 'mixed-readiness', goal: mixedReadinessGoal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }, { id: 'sku-2', name: '产品 B', materialIds: ['asset-b'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a', 'asset-b'] },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(mixedReadiness.status, 'planned');
assert.equal(mixedReadiness.orders.length, 2, 'one invalid product must not remove its valid sibling order');
assert.ok(mixedReadiness.orders[0]?.readinessBlockers?.some(issue => issue.includes('不能作为新的独立生产路线')),
  'product/material routes are shot types inside a clone timeline, not new independent V2 plans');
assert.ok(mixedReadiness.orders[1]?.readinessBlockers?.some(issue => issue.includes('冻结产品')));
const exactAnalysis = {
  schemaVersion: 1 as const,
  source: { videoId: 'analysis-1', analysisRunId: 'run-1', evidenceRevision: 'revision-1', correctionVersion: 0, analyzedAt: '2026-10-15T00:00:00Z', analysisMode: 'exact' },
  status: 'ready' as const, gaps: [], hookShotId: 'shot_1', totalShots: 2, timelineComplete: true,
  shots: [
    { shotId: 'shot_1', index: 1, time: '0-2', start: 0, end: 2, materialType: 'talking_head' as const, narrativeRole: 'hook' as const,
      classificationSource: 'model' as const, classificationEvidence: '人物面对镜头讲解', visual: '人物在产品货架前稳定口播', dialogue: '介绍产品', onScreenText: '', purpose: '钩子', firstFrameRef: null, clipRef: null,
      needsReview: false, granularity: 'shot' as const, environment: '产品货架', framing: '中景', camera: '固定', audio: '人声', authenticity: '真实', effectivenessHypothesis: '', detailedAnalysis: {} },
    { shotId: 'shot_2', index: 2, time: '2-5', start: 2, end: 5, materialType: 'product' as const, narrativeRole: 'product_intro' as const,
      classificationSource: 'model' as const, classificationEvidence: '包装细节可见', visual: '产品包装标签微距特写', dialogue: '', onScreenText: '', purpose: '产品介绍', firstFrameRef: null, clipRef: null,
      needsReview: false, granularity: 'shot' as const, environment: '产品货架', framing: '特写', camera: '固定', audio: '', authenticity: '真实', effectivenessHypothesis: '', detailedAnalysis: {} },
  ],
  materialCounts: { talking_head: 1, factory: 0, product: 1, consumer_demo: 0, general: 0, unknown: 0 },
  structure: [
    { materialType: 'talking_head' as const, narrativeRole: 'hook' as const, shotIds: ['shot_1'] },
    { materialType: 'product' as const, narrativeRole: 'product_intro' as const, shotIds: ['shot_2'] },
  ], speechGroups: [],
};
const fixedYieldBatch = buildContentBatchPlan({
  goalId: 'fixed-yield', goal: explicitMissingMaterialGoal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'], referenceAnalyses: { 'analysis-1': exactAnalysis } },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(fixedYieldBatch.orders[0]?.fixedYieldTimeline?.ready, true);
assert.equal(fixedYieldBatch.orders[0]?.productionContractVersion, 'fixed-yield.v2-preflight');
assert.deepEqual(fixedYieldBatch.orders[0]?.fixedYieldTimeline?.shots.map(item => [item.pathId, item.targetOutputDurationMs]), [
  ['P1_PRESENTER', 2000], ['P2_PRODUCT_REAL', 3000],
]);
const automaticFixedYieldBatch = buildContentBatchPlan({
  goalId: 'fixed-yield-auto', goal, config,
  evidence: {
    products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }],
    exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'], referenceAnalyses: { 'analysis-1': exactAnalysis },
  },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(automaticFixedYieldBatch.orders.length, 1, 'one admitted reference can back at most one independent weekly video');
assert.ok(automaticFixedYieldBatch.orders.every(order => order.route === 'clone'
  && order.productionContractVersion === 'fixed-yield.v2-preflight'
  && order.fixedYieldTimeline?.ready === true
  && order.readinessBlockers?.length === 0), 'analysis completion must deterministically recompile every automatic order into an executable preflight');
assert.deepEqual(automaticFixedYieldBatch.eligibleRoutes, ['clone']);

const duplicateExplicitPlan = normalizeVideoPlan({
  ...explicitMissingMaterialGoal.videoPlans![0], contentId: 'duplicate-content', contentFamilyId: 'duplicate-family',
});
const explicitDuplicateBatch = buildContentBatchPlan({
  goalId: 'fixed-yield-explicit-duplicate',
  goal: { ...explicitMissingMaterialGoal, videoPlans: [explicitMissingMaterialGoal.videoPlans![0]!, duplicateExplicitPlan] },
  config,
  evidence: {
    products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }],
    exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'], referenceAnalyses: { 'analysis-1': exactAnalysis },
  },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(explicitDuplicateBatch.orders.length, 2, 'the invalid authored choice remains visible for correction');
assert.equal(explicitDuplicateBatch.orders[0]?.readinessBlockers?.length, 0);
assert.ok(explicitDuplicateBatch.orders[1]?.readinessBlockers?.some(reason => reason.includes('每条物理爆款视频最多只能用于 1 条')),
  'the second independent use of one reference must be rejected before production');

const duplicatePhysicalHash = 'a'.repeat(64);
const duplicatePhysicalIdentities = {
  'analysis-1': referenceContentIdentity({ id: 'analysis-1', sha256: duplicatePhysicalHash, duration: 5 }),
  'analysis-copy': referenceContentIdentity({ id: 'analysis-copy', sha256: duplicatePhysicalHash, duration: 5 }),
};
const duplicatePhysicalAnalysis = {
  ...exactAnalysis,
  source: { ...exactAnalysis.source, videoId: 'analysis-copy', analysisRunId: 'run-copy' },
};
const duplicatePhysicalPlan = normalizeVideoPlan({
  ...explicitMissingMaterialGoal.videoPlans![0],
  contentId: 'duplicate-physical-content', contentFamilyId: 'duplicate-physical-family', referenceId: 'analysis-copy',
});
const explicitPhysicalDuplicateBatch = buildContentBatchPlan({
  goalId: 'fixed-yield-explicit-physical-duplicate',
  goal: { ...explicitMissingMaterialGoal, videoPlans: [explicitMissingMaterialGoal.videoPlans![0]!, duplicatePhysicalPlan] },
  config,
  evidence: {
    products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }],
    exactAnalysisIds: ['analysis-1', 'analysis-copy'], materialIds: ['asset-a'],
    referenceAnalyses: { 'analysis-1': exactAnalysis, 'analysis-copy': duplicatePhysicalAnalysis },
    referenceIdentities: duplicatePhysicalIdentities,
  },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(explicitPhysicalDuplicateBatch.orders.length, 2, 'authored duplicate records remain visible for correction');
assert.equal(explicitPhysicalDuplicateBatch.orders[0]?.readinessBlockers?.length, 0);
assert.ok(explicitPhysicalDuplicateBatch.orders[1]?.readinessBlockers?.some(reason => reason.includes('是同一视频')),
  'different database ids for the same physical video must be rejected in one explicit weekly plan');

const automaticPhysicalDuplicateBatch = buildContentBatchPlan({
  goalId: 'fixed-yield-auto-physical-duplicate', goal, config,
  evidence: {
    products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }],
    exactAnalysisIds: ['analysis-1', 'analysis-copy'], materialIds: ['asset-a'],
    referenceAnalyses: { 'analysis-1': exactAnalysis, 'analysis-copy': duplicatePhysicalAnalysis },
    referenceIdentities: duplicatePhysicalIdentities,
  },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(automaticPhysicalDuplicateBatch.orders.length, 1,
  'automatic fallback without videoPlans must count physical videos, not record ids');
assert.equal(automaticPhysicalDuplicateBatch.coverage?.missing, 4);

for (const [week, referenceId, analysis] of [
  ['2026-W42', 'analysis-1', exactAnalysis],
  ['2026-W43', 'analysis-copy', duplicatePhysicalAnalysis],
] as const) {
  const weeklyGoal = {
    ...explicitMissingMaterialGoal,
    videoPlans: [normalizeVideoPlan({ ...explicitMissingMaterialGoal.videoPlans![0]!, referenceId })],
  };
  const weekly = buildContentBatchPlan({
    goalId: `cross-week-${week}`, goal: weeklyGoal, config,
    evidence: {
      products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }],
      exactAnalysisIds: [referenceId], materialIds: ['asset-a'],
      referenceAnalyses: { [referenceId]: analysis }, referenceIdentities: { [referenceId]: duplicatePhysicalIdentities[referenceId] },
    },
    versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
  });
  assert.equal(weekly.orders[0]?.readinessBlockers?.length, 0,
    'physical reference reuse is scoped to one compilation/week and remains allowed in a later week');
}
console.log('content batch plan tests passed');
