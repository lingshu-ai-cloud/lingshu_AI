import assert from 'node:assert/strict';
import { normalizeDigitalEmployeeConfig, normalizeWeeklyGoal } from './domain.js';
import { recommendPackage } from './weeklyPackage.js';
import { enrichPackageWithContentSignals, rankContentReferences } from './contentPlanRecommendation.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '海拓装备', industry: '智能制造', primaryBusiness: '工业检测设备', targetMarkets: '德国', customerProfile: '工厂采购负责人',
  primaryGoal: 'leads', focusProducts: '工业检测设备', approvalOwner: '负责人', socialCadence: '每周 3 条',
  enabledWorkflows: ['scheduled_social', 'viral_clone', 'product_content'],
  publishingTargets: [{ platform: 'tiktok', accountId: 'tt-1', accountLabel: '德国采购号' }],
});
const goal = normalizeWeeklyGoal({ startsAt: '2026-09-28', endsAt: '2026-10-04', contentPlatforms: ['tiktok'], objective: '获得德国采购询盘' }, config);
const videos = [{
  id: 'viral-1', platform: 'tiktok', title: 'How buyers inspect a machine', views: '1.2M',
  aiAnalysis: {
    analysisMode: 'exact', analysisQuality: 'video', sourceAccount: 'https://tiktok.com/@benchmark', sourceAccountName: 'Benchmark Factory', relativeViewMultiple: 4.2,
    candidateEvidence: { relevance: { level: 'high' }, momentum: { level: 'high_performance' }, transferability: { level: 'high' } },
    gemini: { theme: '采购验机三步法', hooks: ['设备到厂前，采购最容易漏掉哪一步？'], sellingPoints: ['验机流程与检测证据'] },
  },
}];
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
assert.ok(plans[0]?.buyerProblem);
assert.ok(plans[0]?.plannedPublishDate);

const authored = structuredClone(enriched);
const first = authored.tasks.find(task => task.templateId === 'production')!.videoPlans![0]!;
first.route = 'product'; first.referenceId = ''; first.theme = '用户明确指定的产品演示'; first.buyerProblem = '如何确认检测精度？';
const preserved = enrichPackageWithContentSignals({ pack: authored, goal, config, videos, benchmarks }).tasks.find(task => task.templateId === 'production')!.videoPlans![0]!;
assert.equal(preserved.route, 'product', 'evidence enrichment must not override an explicit user-authored route');
assert.equal(preserved.theme, '用户明确指定的产品演示');

console.log('content plan recommendation tests passed');
