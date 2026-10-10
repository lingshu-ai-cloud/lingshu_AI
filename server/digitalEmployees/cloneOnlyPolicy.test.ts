import assert from 'node:assert/strict';
import { buildContentBatchPlan } from './contentBatchPlan.js';
import { buildWeeklyPlan, normalizeDigitalEmployeeConfig } from './domain.js';
import { normalizeVideoPlan } from '../../shared/contracts/videoCreationPlan.js';

const config = normalizeDigitalEmployeeConfig({
  companyName: '企业', focusProducts: '产品 A', socialCadence: '每周 2 条',
  enabledWorkflows: ['viral_clone'],
});
const goal = { title: '周计划', objective: '询盘', metric: 'approved_content_packages' as const, baseline: 0, target: 2, unit: '条', startsAt: '2026-10-08', endsAt: '2026-10-14', constraints: [], scope: '', businessLine: 'content_growth' as const, contentPlatforms: ['tiktok' as const] };
const versions = { configVersion: 1, policyVersion: '1', factsVersion: '1' };
const evidence = { products: [{ id: 'p1', name: '产品 A', materialIds: ['m1'] }], exactAnalysisIds: [], materialIds: ['m1'] };

const missingAnalysis = buildContentBatchPlan({ goalId: 'g1', goal, config, evidence, versions });
assert.equal(missingAnalysis.status, 'blocked');
assert.match(missingAnalysis.blocker, /精确分析/);
assert.equal(missingAnalysis.eligibleRoutes.includes('product'), false);
assert.equal(missingAnalysis.eligibleRoutes.includes('material'), false);

const manualRoute = normalizeVideoPlan({ route: 'product', productName: '产品 A', theme: '介绍', language: 'en', duration: 30, platform: 'tiktok' });
const rejected = buildContentBatchPlan({ goalId: 'g1', goal: { ...goal, videoPlans: [manualRoute] }, config, evidence, versions });
assert.equal(rejected.status, 'planned', 'one invalid route must remain an order-local blocker so unrelated workflow branches can start');
assert.match(rejected.orders[0]?.readinessBlockers?.join('；') || '', /指定内容路径/);

const plan = buildWeeklyPlan(goal, config);
const keys = plan.tasks.map(item => item.key);
assert.ok(keys.includes('viral_analysis'));
assert.deepEqual(plan.tasks.find(item => item.key === 'content_mode_routing')?.dependsOn, ['viral_analysis']);
console.log('digital employee clone-only policy tests passed');
