import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow';
import { buildSocialContentWeeklyPlan } from './socialContentWeeklyPlan';

const task = {
  brief: {
    requestedOutputCount: 60,
    weeklyBudgetCny: 2_000,
    shootingWindowMinutes: 30,
    productRef: '新品 A',
  },
  status: 'asset_review',
  readiness: { complete: true, missing: [] },
  sources: [
    { status: 'active', kind: 'material' },
    { status: 'active', kind: 'reference_link' },
  ],
  artifacts: [
    { status: 'approved' },
    { status: 'review_required' },
    { status: 'superseded' },
  ],
} as unknown as SocialContentTaskDetail;

test('weekly plan reports real batch counts without treating references as material', () => {
  const plan = buildSocialContentWeeklyPlan(task);
  assert.equal(plan.targetCount, 60);
  assert.equal(plan.completedCount, 1);
  assert.equal(plan.reviewCount, 1);
  assert.equal(plan.materialCount, 1);
  assert.equal(plan.referenceCount, 1);
  assert.equal(plan.needUserAction, '验收 1 项内容');
  assert.equal(plan.budgetLabel, '¥2,000 上限');
  assert.equal(plan.managedSupplyActive, false);
});

test('weekly plan routes missing material to managed supply and exposes scene-level feasibility', () => {
  const plan = buildSocialContentWeeklyPlan({
    ...task,
    status: 'producing',
    sources: task.sources.filter(source => source.kind !== 'material'),
    artifacts: [],
  });
  assert.equal(plan.managedSupplyActive, true);
  assert.equal(plan.needUserAction, '当前无需处理');
  assert.match(plan.assetSupplyLabel, /逐镜判断/);
  assert.equal(plan.productionLanes[0]?.status, '零素材托管，逐镜判断可行性');
});
