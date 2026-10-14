import assert from 'node:assert/strict';
import { defaultMatrixPlan } from './weeklyMatrix';
import { buildPresetMatrixVideoPlans, weeklyTaskPackagePreset } from './weeklyTaskPackagePresets';
import { normalizeDigitalEmployeeConfig } from '../../server/digitalEmployees/domain';
import { scheduleWeeklyVideos, weeklyPipelineCards } from './weeklyGoalSchedule';
const config = normalizeDigitalEmployeeConfig({ focusProducts: '产品', socialOperatingProfile: 'starter_four_platform' });
const platforms = ['tiktok', 'facebook', 'instagram', 'youtube'] as const;
const rows = defaultMatrixPlan(config, [...platforms], '验证需求');
const plans = buildPresetMatrixVideoPlans({ preset: weeklyTaskPackagePreset('b2b_starting'), productName: '产品', platforms: [...platforms], matrixRows: rows });
assert.equal(plans.length, 16);
assert.deepEqual(rows.map(row => row.weeklyCount), [5, 5, 3, 3]);
const scheduled = scheduleWeeklyVideos(plans, '2026-10-12', '2026-10-18');
for (const platform of platforms) {
  const dates = scheduled.filter(plan => plan.platform === platform).map(plan => plan.plannedPublishDate);
  assert.equal(new Set(dates).size, dates.length, `${platform} must keep its own weekly cadence distributed`);
}
assert.ok(scheduled.every(plan => plan.plannedPublishAt?.endsWith('T18:00:00+08:00')), 'generated weekly slots must carry the 18:00 Beijing publish instant');
assert.equal(new Set(scheduled.map(plan => plan.plannedPublishDate)).size, 7, 'the complete weekly output must use the complete weekly cadence');
const multiple = scheduleWeeklyVideos([...plans, ...plans.filter(plan => plan.platform === 'tiktok').map(plan => ({ ...plan, matrix: { ...plan.matrix!, accountId: 'second-tk' } }))], '2026-10-12', '2026-10-18');
assert.equal(multiple.filter(plan => plan.matrix?.accountId === 'second-tk').length, 5);
assert.equal(new Set(multiple.filter(plan => plan.matrix?.accountId === 'second-tk').map(plan => plan.plannedPublishDate)).size, 5);
const twoSingletonAccounts = scheduleWeeklyVideos([
  { ...plans[0]!, plannedPublishDate: '', plannedPublishAt: '', matrix: { ...plans[0]!.matrix!, accountId: 'facebook-one' }, platform: 'facebook' },
  { ...plans[0]!, plannedPublishDate: '', plannedPublishAt: '', matrix: { ...plans[0]!.matrix!, accountId: 'tiktok-one' }, platform: 'tiktok' },
], '2026-10-13', '2026-10-19');
assert.deepEqual(twoSingletonAccounts.map(plan => plan.plannedPublishDate), ['2026-10-14', '2026-10-18'], 'two singleton accounts must not collapse onto the same middle day');
assert.ok(twoSingletonAccounts.every(plan => plan.plannedPublishAt?.includes('T18:00:00+08:00')));
const cards = weeklyPipelineCards('2026-10-12', '2026-10-18', 16);
assert.equal(cards.length, 8);
assert.deepEqual(cards.find(card => card.id === 'publishing')?.dependsOn, ['production', 'accounts']);
assert.deepEqual(cards.find(card => card.id === 'production')?.dependsOn, ['director']);
console.log('Weekly 16-video quotas, per-account cadence and pipeline dependencies passed');
