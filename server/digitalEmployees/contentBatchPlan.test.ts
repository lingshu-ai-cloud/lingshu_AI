import assert from 'node:assert/strict';
import { buildContentBatchPlan, enterpriseAssetStableId } from './contentBatchPlan.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { normalizeVideoPlan } from '../../shared/contracts/videoCreationPlan.js';

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
assert.equal(planned.orders.length, 5);
assert.deepEqual(planned.orders.map(order => order.route), ['clone', 'product', 'material', 'clone', 'product']);
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
assert.equal(publishing.status, 'planned', 'explicit product preparation must remain available without a publishing account');
assert.equal(publishing.orders.length, 5);
assert.ok(publishing.orders.every(order => order.route === 'product' && order.accountId === ''));

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
assert.equal(explicitUnanalyzedClone.status, 'blocked', 'enabling product/material must never replace an explicit clone with missing analysis');
assert.equal(explicitUnanalyzedClone.orders.length, 0);
console.log('content batch plan tests passed');
