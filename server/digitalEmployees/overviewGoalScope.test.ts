import assert from 'node:assert/strict';
import test from 'node:test';
import { currentOperatingWeek, scopeOverviewQueue, selectOverviewGoal } from './overviewGoalScope.js';
import type { ContentQueueItem, ContentQueueProjection } from '../../src/lib/digitalEmployees.js';

const range = { startsAt: '2026-10-26', endsAt: '2026-11-01' };
const old = { id: 'old', starts_at: '2026-09-27', ends_at: '2026-10-03', status: 'active' };
const current = { id: 'current', starts_at: range.startsAt, ends_at: range.endsAt, status: 'draft' };

test('default overview selects the Shanghai current week, never an old active goal', () => {
  assert.deepEqual(currentOperatingWeek(Date.parse('2026-10-30T04:00:00Z')), range);
  assert.equal(selectOverviewGoal([old, current], '', range)?.id, 'current');
  assert.equal(selectOverviewGoal([old], '', range), null);
  assert.equal(selectOverviewGoal([old], 'old', range)?.id, 'old', 'explicit history remains accessible');
});

test('week rollover uses Shanghai time across month and year boundaries', () => {
  assert.deepEqual(currentOperatingWeek(Date.parse('2026-11-01T15:59:59Z')), range);
  assert.deepEqual(currentOperatingWeek(Date.parse('2026-11-01T16:00:00Z')), { startsAt: '2026-11-02', endsAt: '2026-11-08' });
  assert.deepEqual(currentOperatingWeek(Date.parse('2027-01-01T00:00:00Z')), { startsAt: '2026-12-28', endsAt: '2027-01-03' });
});

test('default queue excludes other goals and historical manual tasks without relabeling them', () => {
  const item = (id: string, goalId: string, date: string) => ({ id, lineage: { goalId }, plannedPublishDate: date, updatedAt: date }) as ContentQueueItem;
  const queue: ContentQueueProjection = { generatedAt: '', sourceStatus: 'available', sourceNote: '', items: [item('old-plan', 'old', '2026-10-30'), item('current-plan', 'current', ''), item('manual-old', '', '2026-10-03'), item('manual-current', '', '2026-10-30')] };
  assert.deepEqual(scopeOverviewQueue(queue, range, 'current').items.map(item => item.id), ['current-plan', 'manual-current']);
  assert.deepEqual(scopeOverviewQueue(queue, range).items.map(item => item.id), ['manual-current']);
  assert.equal(queue.items.length, 4, 'projection does not modify saved history');
});
