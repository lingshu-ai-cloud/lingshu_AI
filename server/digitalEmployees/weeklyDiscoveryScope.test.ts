import assert from 'node:assert/strict';
import { buildConfirmedWeeklyDiscoveryScope, buildConfirmedWeeklyDiscoveryScopeWithKeywords } from './weeklyDiscoveryScope.js';

const scope = buildConfirmedWeeklyDiscoveryScope({
  businessGoal: '完成本周 16 条内容生产', products: ['产品 A'], market: '美国', language: 'en',
  audience: '品牌采购负责人', platforms: ['TikTok', 'Facebook'], lookbackDays: 7, resultLimit: 30,
  approvedBy: 'owner-1', workflowRunId: 'run-1', workflowTaskId: 'task-1',
}, 3, new Date('2026-10-11T01:00:00.000Z'))!;
assert.equal(scope.keywordSet.version, 3);
assert.equal(scope.discoveryBrief.keywordSetVersion, 3);
assert.deepEqual(scope.discoveryBrief.platforms.sort(), ['facebook', 'tiktok']);
assert.equal(scope.discoveryBrief.modePolicies?.momentum?.enabled, true);
assert.equal(scope.approval?.status, 'approved');
assert.equal(scope.approval?.approvedBy, 'user');
assert.equal((scope as any).authorizationSource.approvedBy, 'owner-1');
assert.equal((scope as any).authorizationSource.type, 'confirmed_weekly_plan');
assert.equal(buildConfirmedWeeklyDiscoveryScope({
  businessGoal: '', products: [], market: '', language: '', audience: '', platforms: [], lookbackDays: 7,
  resultLimit: 30, approvedBy: '', workflowRunId: 'run', workflowTaskId: 'task',
}, 1), null);

const generated = await buildConfirmedWeeklyDiscoveryScopeWithKeywords({
  businessGoal: '完成本周 16 条内容生产', products: ['GUIANFA-RS-001 云朵泡沫卸妆蜜'], market: '美国', language: 'en',
  audience: '品牌采购负责人', platforms: ['TikTok'], lookbackDays: 7, resultLimit: 30,
  approvedBy: 'owner-1', workflowRunId: 'run-2', workflowTaskId: 'task-2',
}, 4, {
  companyType: 'supplier', enabledRoutes: ['wholesale_distribution'],
  products: [
    { name: 'GUIANFA-RS-001 云朵泡沫卸妆蜜', category: '卸妆产品' },
    { name: 'GUIANFA-RS-002 紫苏控油去黑头泥膜2.0', category: '面膜' },
    { name: 'GUIANFA-RS-003 深海冰川舒缓喷雾', category: '面部喷雾' },
  ],
}, new Date('2026-10-11T02:00:00.000Z'), async input => ({
  broadTerms: [
    { term: 'Skincare Supplier', sourceQuote: 'GUIANFA-RS-001 云朵泡沫卸妆蜜', reason: '覆盖护肤品类' },
    { term: 'Face Mask Supplier', sourceQuote: 'GUIANFA-RS-002 紫苏控油去黑头泥膜2.0', reason: '覆盖面膜品类' },
  ],
  mediumTerms: [
    { term: 'cleansing balm', sourceQuote: 'GUIANFA-RS-001 云朵泡沫卸妆蜜', reason: '对应卸妆产品' },
    { term: 'clay mask', sourceQuote: 'GUIANFA-RS-002 紫苏控油去黑头泥膜2.0', reason: '对应泥膜' },
    { term: 'facial mist', sourceQuote: 'GUIANFA-RS-003 深海冰川舒缓喷雾', reason: '对应喷雾' },
  ],
  perspective: input.perspective,
  sourceName: input.sourceName,
}));
assert.deepEqual(generated.keywordSet.graph.discoverySeeds[0].queryVariants, ['Skincare Supplier', 'Face Mask Supplier']);
assert.deepEqual(generated.keywordSet.graph.sceneClusters.map(item => item.queryVariants[0]), ['cleansing balm', 'clay mask', 'facial mist']);
assert.equal(generated.keywordRecommendation?.mediumTerms.length, 3);
assert.ok(!generated.keywordSet.graph.discoverySeeds.flatMap(item => item.queryVariants).some(item => item.includes('GUIANFA')));

await assert.rejects(
  buildConfirmedWeeklyDiscoveryScopeWithKeywords({
    businessGoal: '目标', products: ['产品 A'], market: '美国', language: 'en', audience: '采购', platforms: ['tiktok'],
    lookbackDays: 7, resultLimit: 30, approvedBy: 'owner', workflowRunId: 'run', workflowTaskId: 'task',
  }, 1, { products: [{ name: '产品 A', category: '护肤产品资料' }] }, new Date(), async () => { throw new Error('模型暂不可用'); }),
  /编导关键词生成受阻：模型暂不可用/,
);

console.log('weekly discovery scope tests passed');
