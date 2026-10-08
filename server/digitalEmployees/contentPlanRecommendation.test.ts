import assert from 'node:assert/strict';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { recommendPackage } from './weeklyPackage.js';
import { bindDefaultProductsToPackage, enrichPackageWithContentSignals, publishDateForAccountSlot, rankContentReferences } from './contentPlanRecommendation.js';
import { buildContentBatchPlan } from './contentBatchPlan.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '海拓装备', industry: '智能制造', primaryBusiness: '工业检测设备', targetMarkets: '德国', customerProfile: '工厂采购负责人',
  primaryGoal: 'leads', focusProducts: '工业检测设备', approvalOwner: '负责人', socialCadence: '每周 3 条',
  enabledWorkflows: ['scheduled_social', 'viral_clone', 'product_content'],
  publishingTargets: [{ platform: 'tiktok', accountId: 'tt-1', accountLabel: '德国采购号' }],
});
const goal = normalizeWeeklyGoal({ startsAt: '2026-09-28', endsAt: '2026-10-04', contentPlatforms: ['tiktok'], objective: '获得德国采购询盘' }, config);
const video = (id: string, title: string, hook: string, views: string) => ({
  id, platform: 'tiktok', title, views, thumbnailUrl: `https://cdn.example.com/${id}.jpg`, sourceUrl: `https://tiktok.com/@benchmark/video/${id}`,
  duration: 6, updatedAt: '2026-10-08T00:00:00.000Z',
  aiAnalysis: {
    analysisMode: 'exact', analysisQuality: 'video', sourceAccount: 'https://tiktok.com/@benchmark', sourceAccountName: 'Benchmark Factory', relativeViewMultiple: 4.2,
    candidateEvidence: { relevance: { level: 'high' }, momentum: { level: 'high_performance' }, transferability: { level: 'high' } },
    gemini: { theme: title, hooks: [hook], sellingPoints: ['验机流程与检测证据'], scriptDetails15s: [
      { time: '0-3s', materialType: 'talking_head', narrativeRole: 'hook', classificationEvidence: '可见人物正对镜头口播', visual: '采购顾问正对镜头提出问题', purpose: '开头钩子', materialEvidence: { firstFrameRef: `/api/overseas/videos/${id}/shot/1/first-frame` } },
      { time: '3-6s', materialType: 'product', narrativeRole: 'product_intro', classificationEvidence: '可见设备细节', visual: '设备检测部位特写', purpose: '产品介绍', materialEvidence: { firstFrameRef: `/api/overseas/videos/${id}/shot/2/first-frame` } },
    ] },
  },
});
const videos = [
  video('viral-1', '采购验机三步法', '设备到厂前，采购最容易漏掉哪一步？', '1.2M'),
  video('viral-2', '出厂检测清单', '一台设备出厂前要核对什么？', '980K'),
  video('viral-3', '工厂采购避坑', '采购经理如何识别关键风险？', '860K'),
  video('viral-4', '产品精度怎么验证', '不要只看参数表，现场这样验证精度', '720K'),
  video('viral-5', '供应商交付能力判断', '交付前先看这三个工厂证据', '650K'),
];
const benchmarks = [{ id: 'benchmark-1', platform: 'tiktok', accountUrl: 'https://tiktok.com/@benchmark', accountName: 'Benchmark Factory', handle: '@benchmark' }];

const ranked = rankContentReferences({ videos, benchmarks, platform: 'tiktok', productName: '工业检测设备', audience: '工厂采购负责人', direction: '采购教育' });
assert.equal(ranked[0]?.id, 'viral-1');
assert.equal(ranked[0]?.benchmarkAccount, 'Benchmark Factory');
assert.ok((ranked[0]?.score || 0) >= 80, 'exact benchmark evidence with strong relative performance should rank highly');

const enriched = enrichPackageWithContentSignals({ pack: recommendPackage(goal, config), goal, config, videos, benchmarks });
const plans = enriched.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
assert.equal(plans.length, enriched.matrixPlan?.[0]?.weeklyCount, 'matrix weekly quota must define the number of independent content plans');
assert.ok(plans.every(plan => plan.planningEvidence?.requiredCount === plans.length));
assert.equal(plans[0]?.route, 'clone');
assert.equal(plans[0]?.referenceId, 'viral-1');
assert.equal(plans[0]?.planningEvidence?.generatedFrom, 'matrix_benchmark_viral');
assert.equal(plans.filter(plan => plan.referenceId === 'viral-1').length, 1, 'one analyzed reference must not be looped across the full weekly quota');
assert.equal(new Set(plans.map(plan => plan.referenceId)).size, plans.length, 'weekly output must select exactly one unique viral video per planned video');
assert.ok(plans.every(plan => plan.route === 'clone' && plan.referenceId), 'weekly plan is composed only from executable viral-video mutations');
assert.match(plans[0]?.planningEvidence?.referenceThumbnailUrl || '', /viral-1\.jpg/);
assert.deepEqual(plans[0]?.benchmarkAnalysis?.structure.map(step => step.materialType), ['talking_head', 'product'], 'normalized benchmark structure must be frozen into the weekly plan');
assert.match(plans[0]?.benchmarkAnalysis?.shots[0]?.firstFrameRef || '', /shot\/1\/first-frame/, 'weekly preview must retain the normalized first-frame route');
assert.ok(plans.every(plan => plan.publication?.title && plan.publication.caption && plan.publication.tags.length), 'each planned video must carry future title, caption and tags into production');
assert.ok(plans.every(plan => Number(plan.estimatedCost) > 0), 'each video must carry the production stack highest-tier estimate');
assert.equal(enriched.directorPlan?.productionBudget, plans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0), 'weekly budget must equal the sum of per-video estimates');
assert.equal(enriched.operatingContext?.budget.productionCny, enriched.directorPlan?.productionBudget, 'weekly goal and account allocation must read the same production budget');
assert.ok(plans[0]?.buyerProblem);
assert.ok(plans[0]?.plannedPublishDate);
assert.deepEqual(
  Array.from({ length: 5 }, (_, index) => publishDateForAccountSlot('2026-09-28', '2026-10-04', index, 5)),
  ['2026-09-28', '2026-09-30', '2026-10-01', '2026-10-03', '2026-10-04'],
  'one account must distribute its weekly posts across the full week',
);

const shortage = enrichPackageWithContentSignals({ pack: recommendPackage(goal, config), goal, config, videos: videos.slice(0, 1), benchmarks });
const shortagePlans = shortage.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
assert.equal(shortagePlans.filter(plan => !plan.referenceId).length, shortagePlans.length - 1, 'viral shortages must remain explicit blockers rather than falling back to another route');

const blankProductPack = recommendPackage(goal, normalizeDigitalEmployeeConfig({ ...config, focusProducts: '' }));
const productBound = bindDefaultProductsToPackage(blankProductPack, [{ id: 'product-1', name: '默认检测设备', materialIds: ['asset-1'] }]);
const productBoundPlans = productBound.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
assert.ok(productBoundPlans.length && productBoundPlans.every(plan => plan.productId === 'product-1' && plan.productName === '默认检测设备' && plan.materialIds[0] === 'asset-1'), 'backend must freeze the first confirmed product ID instead of silently blocking a blank selector');

const fourPlatformConfig = normalizeDigitalEmployeeConfig({
  ...config,
  socialCadence: '每周生成 5 条原创母版',
  publishingTargets: [
    { platform: 'youtube', accountId: 'yt-1', accountLabel: '海拓装备 YouTube' },
    { platform: 'tiktok', accountId: 'tt-1', accountLabel: '海拓装备 TikTok' },
    { platform: 'instagram', accountId: 'ig-1', accountLabel: '海拓装备 Instagram' },
    { platform: 'facebook', accountId: 'fb-1', accountLabel: '海拓装备 Facebook' },
  ],
});
const fourPlatformGoal = normalizeWeeklyGoal({
  startsAt: '2026-09-28', endsAt: '2026-10-04',
  contentPlatforms: ['youtube', 'tiktok', 'instagram', 'facebook'],
  objective: '用四个平台验证五个内容方向',
}, fourPlatformConfig);
const fourPlatformPlans = enrichPackageWithContentSignals({
  pack: recommendPackage(fourPlatformGoal, fourPlatformConfig),
  goal: fourPlatformGoal,
  config: fourPlatformConfig,
  videos,
  benchmarks,
}).tasks.find(task => task.templateId === 'production')?.videoPlans || [];
const fourPlatformMasters = fourPlatformPlans.filter(plan => plan.productionRole === 'master');
assert.equal(fourPlatformPlans.length, 18, 'four accounts keep 18 distinct publish versions');
assert.equal(fourPlatformMasters.length, 5, '18 publish versions must collapse into five paid original masters');
assert.deepEqual(Object.fromEntries(['youtube', 'tiktok', 'instagram', 'facebook'].map(platform => [platform, fourPlatformPlans.filter(plan => plan.platform === platform).length])), { youtube: 3, tiktok: 5, instagram: 5, facebook: 5 });
for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
  const platformPlans = fourPlatformPlans.filter(plan => plan.platform === platform);
  assert.equal(new Set(platformPlans.map(plan => plan.contentFamilyId)).size, platformPlans.length, `${platform} must not publish the same master twice`);
  assert.equal(new Set(platformPlans.map(plan => plan.plannedPublishDate)).size, platformPlans.length, `${platform} must not publish its whole weekly quota on one day`);
}
assert.equal(
  new Set(fourPlatformPlans.filter(plan => plan.plannedPublishDate === fourPlatformGoal.startsAt).map(plan => plan.matrix?.accountId)).size,
  4,
  'all four accounts must begin operating in parallel on the same weekly axis',
);
assert.equal(new Set(fourPlatformMasters.map(plan => plan.referenceId)).size, 5, 'the five originals use five distinct viral references');
for (const master of fourPlatformMasters) {
  const family = fourPlatformPlans.filter(plan => plan.contentFamilyId === master.contentFamilyId);
  assert.ok(family.every(plan => plan.referenceId === master.referenceId), 'cross-platform variants inherit the same benchmark and normalized structure');
}
assert.equal(fourPlatformPlans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0), 62.5);
assert.equal(fourPlatformPlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || 0), 0), 50);
assert.equal(fourPlatformPlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || 0), 0), 75);
const fourPlatformBatch = buildContentBatchPlan({
  goalId: 'four-platform-goal',
  goal: { ...fourPlatformGoal, videoPlans: fourPlatformPlans },
  config: fourPlatformConfig,
  evidence: { products: [{ id: 'product-1', name: '工业检测设备', materialIds: ['asset-1'] }], exactAnalysisIds: videos.map(item => item.id), materialIds: ['asset-1'] },
  versions: { configVersion: 1, policyVersion: '1', factsVersion: '1' },
});
assert.equal(fourPlatformBatch.status, 'planned', fourPlatformBatch.blocker);
assert.equal(fourPlatformBatch.orders.length, 5, 'production receives five orders instead of resubmitting all 18 versions');
assert.equal(fourPlatformBatch.orders.flatMap(order => order.deliveryVariants || []).length, 18, 'five production orders retain every platform delivery destination');

console.log('content plan recommendation tests passed');

// Merging the new schedule must not rewrite explicit historic production routes.
const historicPack = recommendPackage(goal, config);
historicPack.tasks = historicPack.tasks.map(task => task.templateId === 'production'
  ? { ...task, videoPlans: (task.videoPlans || []).map(plan => ({ ...plan, route: 'product' as const, buyerProblem: '已确认的历史任务', referenceId: 'historic-reference' })) }
  : task);
const historicResult = enrichPackageWithContentSignals({ pack: historicPack, goal, config, videos: [], benchmarks });
const historicPlans = historicResult.tasks.find(task => task.templateId === 'production')?.videoPlans || [];
assert.ok(historicPlans.length > 0);
assert.ok(historicPlans.every(plan => plan.route === 'product' && plan.referenceId === 'historic-reference'), 'explicit historic routes and references must survive enrichment when no replacement evidence exists');
