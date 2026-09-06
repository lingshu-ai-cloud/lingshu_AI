import assert from 'node:assert/strict';
import { buildContentBatchPlan, enterpriseAssetStableId } from './contentBatchPlan.js';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '企业', industry: '制造', primaryBusiness: '产品', targetMarkets: '美国', customerProfile: '经销商', approvalOwner: '负责人',
  enabledWorkflows: ['viral_clone', 'product_content', 'material_content'], socialCadence: '每周 5 条', publishingTargets: [], constraints: ['禁止虚构'],
});
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
assert.equal(publishing.status, 'planned', 'publishing credentials must not block content production');
assert.ok(publishing.orders.every(order => order.accountId === '' && order.accountLabel.includes('待绑定')));
assert.deepEqual([...new Set(publishing.orders.map(order => order.platform))].sort(), [...goal.contentPlatforms].sort(), 'unbound target platforms must not be silently omitted');

const noEvidence = buildContentBatchPlan({
  goalId: 'goal-1', goal, config,
  evidence: { products: [], exactAnalysisIds: [], materialIds: [] },
  versions: { configVersion: 1, policyVersion: 'p', factsVersion: 'f' },
});
assert.equal(noEvidence.status, 'blocked');
assert.equal(noEvidence.orders.length, 0);
assert.equal(enterpriseAssetStableId(1, 1, '/api/overseas/enterprise/assets/b.png'), `enterprise-product-1-1-${Buffer.from('/api/overseas/enterprise/assets/b.png').toString('base64url').slice(0, 12)}`);
assert.notEqual(enterpriseAssetStableId(0, 0, '/api/overseas/enterprise/assets/a.png'), enterpriseAssetStableId(1, 1, '/api/overseas/enterprise/assets/b.png'), '第二产品/素材必须保留独立稳定 ID');

const feedbackRouted = buildContentBatchPlan({
  goalId: 'goal-2', goal, config,
  evidence: { products: [{ id: 'sku-1', name: '产品 A', materialIds: ['asset-a'] }], exactAnalysisIds: ['analysis-1'], materialIds: ['asset-a'] },
  versions: { configVersion: 8, policyVersion: 'p8', factsVersion: 'f8' },
  priorRoutingEvidence: { priorRouteDistribution: { clone: 8, product: 1, material: 1 }, approvalFeedback: [{ note: '开头更直接' }] },
});
assert.equal(feedbackRouted.orders[0]?.route, 'product', '下周分配必须考虑历史路径分布');
assert.ok(feedbackRouted.orders.every(order => order.constraints.includes('审批反馈：开头更直接')));

console.log('content batch plan tests passed');
