import assert from 'node:assert/strict';
import { defaultMatrixPlan } from './weeklyMatrix';
import { buildPresetMatrixVideoPlans, weeklyTaskPackagePreset } from './weeklyTaskPackagePresets';
import { normalizeDigitalEmployeeConfig } from '../../server/digitalEmployees/domain';
import { scheduleWeeklyVideos, weeklyPipelineCards } from './weeklyGoalSchedule';
import { DEFAULT_VIDEO_PUBLISH_TIMES, balancedWeeklyPublishSlots, nextDefaultVideoPublishTime } from '../../shared/contracts/weeklyPublishSchedule';
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
for (const date of new Set(scheduled.map(plan => plan.plannedPublishDate))) {
  const times = scheduled.filter(plan => plan.plannedPublishDate === date).map(plan => plan.plannedPublishAt?.slice(11,16)).sort();
  assert.deepEqual(times, DEFAULT_VIDEO_PUBLISH_TIMES.slice(0,times.length), `${date} uses 09:00, 16:00, 18:00 in order`);
}
assert.equal(new Set(scheduled.map(plan => plan.plannedPublishDate)).size, 7, 'the complete weekly output must use the complete weekly cadence');
const multiple = scheduleWeeklyVideos([...plans, ...plans.filter(plan => plan.platform === 'tiktok').map(plan => ({ ...plan, matrix: { ...plan.matrix!, accountId: 'second-tk' } }))], '2026-10-12', '2026-10-18');
assert.equal(multiple.filter(plan => plan.matrix?.accountId === 'second-tk').length, 5);
assert.equal(new Set(multiple.filter(plan => plan.matrix?.accountId === 'second-tk').map(plan => plan.plannedPublishDate)).size, 5);
const twoSingletonAccounts = scheduleWeeklyVideos([
  { ...plans[0]!, plannedPublishDate: '', plannedPublishAt: '', matrix: { ...plans[0]!.matrix!, accountId: 'facebook-one' }, platform: 'facebook' },
  { ...plans[0]!, plannedPublishDate: '', plannedPublishAt: '', matrix: { ...plans[0]!.matrix!, accountId: 'tiktok-one' }, platform: 'tiktok' },
], '2026-10-13', '2026-10-19');
assert.deepEqual(twoSingletonAccounts.map(plan => plan.plannedPublishDate), ['2026-10-14', '2026-10-18'], 'two singleton accounts must not collapse onto the same middle day');
assert.ok(twoSingletonAccounts.every(plan => plan.plannedPublishAt?.includes('T09:00:00+08:00')));
assert.equal(nextDefaultVideoPublishTime(new Date('2026-10-26T00:30:00Z'), []), '2026-10-26T09:00');
assert.equal(nextDefaultVideoPublishTime(new Date('2026-10-26T00:30:00Z'), ['2026-10-26T09:00:00+08:00']), '2026-10-26T16:00');
assert.equal(nextDefaultVideoPublishTime(new Date('2026-10-26T00:30:00Z'), DEFAULT_VIDEO_PUBLISH_TIMES.map(time=>`2026-10-26T${time}:00+08:00`)), '2026-10-27T09:00');
assert.equal(nextDefaultVideoPublishTime(new Date('2026-10-26T10:30:00Z'), ['2026-10-26T18:00:00+08:00']), '2026-10-27T09:00');
const retained = scheduleWeeklyVideos([
  { ...plans[0]!, plannedPublishDate: '2026-10-13', plannedPublishAt: '2026-10-13T16:00:00+08:00' },
  { ...plans[1]!, plannedPublishDate: '', plannedPublishAt: '' },
], '2026-10-12', '2026-10-18');
assert.equal(retained[0]?.plannedPublishAt, '2026-10-13T16:00:00+08:00', 'a confirmed time is never rescheduled');
assert.notEqual(retained[1]?.plannedPublishAt, retained[0]?.plannedPublishAt, 'a new default avoids the confirmed slot');
const dateOnly = scheduleWeeklyVideos([{ ...plans[0]!, plannedPublishDate:'2026-10-13', plannedPublishAt:'' }, { ...plans[1]!, plannedPublishDate:'', plannedPublishAt:'' }], '2026-10-12', '2026-10-18');
assert.equal(dateOnly[0]?.plannedPublishDate, '2026-10-13');
assert.equal(dateOnly[0]?.plannedPublishAt, '', 'date-only plans remain time-undecided');
assert.deepEqual(balancedWeeklyPublishSlots('2026-10-26','2026-10-26',['a','b','c','d']).map(slot=>slot.scheduledAt),
  ['2026-10-26T09:00:00+08:00','2026-10-26T16:00:00+08:00','2026-10-26T18:00:00+08:00',''],
  'a weekly range never invents a fourth default time on a full day');
const cards = weeklyPipelineCards('2026-10-12', '2026-10-18', 16);
assert.equal(cards.length, 8);
assert.deepEqual(cards.find(card => card.id === 'publishing')?.dependsOn, ['production', 'accounts']);
assert.deepEqual(cards.find(card => card.id === 'production')?.dependsOn, ['director']);
assert.equal(cards.find(card => card.id === 'production')?.title, '批量制作成片');
assert.match(cards.find(card => card.id === 'production')?.output || '', /16 条.*待验收成片/);
assert.equal(cards.find(card => card.id === 'publishing')?.title, '按平台排期分发');
assert.match(cards.find(card => card.id === 'publishing')?.output || '', /下方.*平台.*账号.*时间/);
console.log('Weekly 16-video quotas, per-account cadence and pipeline dependencies passed');
