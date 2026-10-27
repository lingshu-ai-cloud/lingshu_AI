import assert from 'node:assert/strict';
import test from 'node:test';
import { beijingDay, customerOverview, observedMetric, todayOverview } from './businessOverviewPresentation';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import type { CustomerProfile, TimelineEvent } from '../types/customer';

const event = (actor: TimelineEvent['actor'], time: string, extra: Partial<TimelineEvent> = {}) =>
  ({ actor, time, type: 'whatsapp', ...extra }) as TimelineEvent;
const customer = (patch: Partial<CustomerProfile> = {}) => ({
  id: 'real-1', isReal: true, isMock: false, isHistorical: false, readOnly: false,
  stage: 'quoted', tags: ['美妆', '高意向', '美妆'], intentSignals: ['询价'], orders: [],
  timeline: [
    event('buyer', '2026-10-26T16:30:00.000Z'),
    event('ai', '2026-10-27T01:00:00.000Z', { sendStatus: 'sent' }),
    event('ai', '2026-10-27T02:00:00.000Z', { type: 'quote', sendStatus: 'delivered' }),
  ],
  ...patch,
}) as CustomerProfile;

test('Beijing day boundaries and unavailable metrics remain distinct from real zero', () => {
  assert.equal(beijingDay('2026-10-26T16:30:00.000Z'), '2026-10-27');
  assert.equal(observedMetric({ value: 0, status: 'available', source: 'fixture' }), 0);
  assert.equal(observedMetric({ value: 0, status: 'pending', source: 'fixture' }), null);
  assert.equal(observedMetric({ value: Number.NaN, status: 'available', source: 'fixture' }), null);
});

test('customer cards and funnel count only real, actionable customers and sent evidence', () => {
  const rows = [customer(), customer({ id: 'mock-1', isMock: true, stage: 'won' }), customer({ id: 'historical-1', isHistorical: true })];
  const result = customerOverview(rows, '2026-10-27');
  assert.equal(result.inbound, 1);
  assert.equal(result.quoted, 1);
  assert.equal(result.won, 0);
  assert.equal(result.todayInbound, 1);
  assert.equal(result.todayOutreach, 1);
  assert.deepEqual(result.funnel, [1, 1, 1, 1, 1]);
  assert.deepEqual(result.tags, [['高意向', 1], ['美妆', 1]]);
});

test('today cards use only the exact day of the server trend and task projection', () => {
  const overview = {
    businessSnapshot: {
      social: { dailyTrend: [{ date: '2026-10-26', views: 19, interactions: 4 }, { date: '2026-10-27', views: 0, interactions: 2 }] },
      completedToday: [{ id: 'done' }], needsDecision: [],
    },
  } as unknown as DigitalEmployeeOverview;
  const result = todayOverview(overview, [customer()], new Date('2026-10-27T03:00:00.000Z'));
  assert.equal(result.views, 0);
  assert.equal(result.interactions, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.pending, 0);
  assert.equal(result.inbound, 1);
});
