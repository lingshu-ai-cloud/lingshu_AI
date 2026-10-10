import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessMetric, BusinessSnapshot, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { availableMetric, buildBusinessHealthModel, businessHealthStatus, meanKnownScores, summarizeHealthCriteria, type BusinessHealthSources } from './businessHealthModel';

const metric = (value: number | null, status: BusinessMetric['status'] = 'available'): BusinessMetric => ({ value, status, source: 'confirmed-receipt' });
const sources: BusinessHealthSources = { performance: null, channelsLoaded: false, whatsappConnected: false, messengerPages: [] };
const overview = (snapshot: Partial<BusinessSnapshot> = {}): DigitalEmployeeOverview => ({
  config: null, goal: null, plan: null,
  businessSnapshot: { generatedAt: '2026-10-10T00:00:00Z', range: { startsAt: '2026-10-04', endsAt: '2026-10-10', timeZone: 'Asia/Shanghai' }, ...snapshot },
} as DigitalEmployeeOverview);

test('missing or unavailable values never turn into low scores', () => {
  assert.equal(availableMetric(metric(0, 'unavailable')), null);
  assert.equal(availableMetric(metric(0)), 0);
  assert.equal(meanKnownScores([null, 80, null]), 80);
  const result = buildBusinessHealthModel(overview(), sources);
  assert.equal(result.totalScore, null);
  assert.equal(result.scoreCoverage, 0);
  assert.ok(result.dimensions.every(item => item.score === null));
});

test('a selected snapshot range overrides the goal range and preserves Beijing calendar days', () => {
  const data = overview();
  data.goal = { startsAt: '2026-09-27', endsAt: '2026-10-03' } as DigitalEmployeeOverview['goal'];
  data.businessSnapshot!.range = {
    startsAt: '2026-10-03T16:00:00.000Z',
    endsAt: '2026-10-10T15:59:59.000Z',
    timeZone: 'Asia/Shanghai',
  };
  const result = buildBusinessHealthModel(data, sources);
  assert.equal(result.startsAt, '2026-10-04');
  assert.equal(result.endsAt, '2026-10-10');
});

test('customer attribution has an explicit denominator and partial coverage', () => {
  const data = overview({ customer: { total: metric(10), attributed: metric(6) } as BusinessSnapshot['customer'] });
  const result = buildBusinessHealthModel(data, sources);
  assert.equal(result.dimensions.find(item => item.key === 'inquiries')?.score, 60);
  assert.equal(result.totalScore, 60);
  assert.equal(result.scoreCoverage, 1);
  assert.equal(result.dimensions[1].criteria.filter(item => item.score !== null).length, 1);
  data.businessSnapshot!.customer.total = metric(0);
  data.businessSnapshot!.customer.attributed = metric(0);
  assert.equal(buildBusinessHealthModel(data, sources).dimensions[1].score, null);
});

test('content score uses confirmed project and publish outcomes, not planned items', () => {
  const data = overview({ content: {
    production: { status: 'available', note: '', projects: [
      { id: 'a', completed: true, approved: true }, { id: 'b', completed: true, approved: false }, { id: 'c', completed: false, approved: false }, { id: 'd', completed: false, approved: false },
    ] }, publishedPosts: metric(3), failedPosts: metric(1),
  } as BusinessSnapshot['content'] });
  const result = buildBusinessHealthModel(data, sources);
  assert.deepEqual(result.dimensions[2].criteria.map(item => item.score), [50, 50, 75]);
  assert.equal(result.dimensions[2].score, 58);
  assert.equal(buildBusinessHealthModel(data, sources, 'a').dimensions[2].score, null, 'global project totals must not become selected-account outcomes');
});

test('spend without conversion goals does not create an advertising performance score', () => {
  const result = buildBusinessHealthModel(overview({ ads: { status: 'available', source: 'receipt', note: '', latestReportedAt: null, spendByCurrency: [{ currency: 'USD', amount: 500, rows: 2 }, { currency: 'CNY', amount: 100, rows: 1 }] } }), sources);
  assert.equal(result.dimensions[3].score, null);
  assert.match(result.dimensions[3].criteria[1].current, /USD 500 · CNY 100/);
});

test('a configured publishing target is not treated as a connected account', () => {
  const data = overview();
  data.config = { publishingTargets: [{ accountId: 'local-plan', accountLabel: 'Plan only', platform: 'tiktok' }], customerProfile: '采购商', focusProducts: '面霜' } as DigitalEmployeeOverview['config'];
  data.plan = { businessPackage: { matrixPlan: [{ accountId: 'local-plan', platform: 'tiktok', weeklyCount: 2, connected: true, audience: '采购商', productName: '面霜', contentDirection: '工厂实拍', formats: ['short'], cta: '私信' }] } } as DigitalEmployeeOverview['plan'];
  const pending = buildBusinessHealthModel(data, sources);
  assert.equal(pending.accountHealth[0].dimensions.find(item => item.key === 'profile')?.currentScore, null);
  const result = buildBusinessHealthModel(data, { ...sources, performance: { accounts: [], contents: [], unavailable: [], loadedAt: '2026-10-10' } });
  assert.equal(result.accountHealth[0].dimensions.find(item => item.key === 'profile')?.currentScore, 83);
  assert.equal(result.dimensions[0].criteria.length, result.accountHealth[0].dimensions.length);
  assert.equal(result.dimensions[0].criteria.length, 5);
  assert.equal(result.dimensions[0].criteria.filter(item => item.score !== null).length, 1);
  assert.equal(businessHealthStatus(result.dimensions[0].score, 1, result.dimensions[0].criteria.length), '局部评分');
  assert.ok(result.accountHealth[0].userActions.some(action => action.includes('账号连接')));
});

test('a high score is not a full health judgement when evidence coverage is partial', () => {
  assert.equal(businessHealthStatus(100, 1, 5), '局部评分');
  assert.equal(businessHealthStatus(83, 5, 5), '基础稳健');
  assert.equal(businessHealthStatus(null, 0, 5), '待补数据');
});

test('coverage visualization counts status without turning missing or inapplicable criteria into zero scores', () => {
  const coverage = summarizeHealthCriteria([
    { label: '有证据', score: 75, current: '3 / 4 条', basis: '真实回执' },
    { label: '待数据', score: null, current: '待接入', basis: '缺少回执' },
    { label: '不适用', score: null, current: '当前范围不适用', basis: '已核验范围', coverageStatus: 'not_applicable' },
  ]);
  assert.deepEqual(coverage, { scored: 1, pending: 1, notApplicable: 1, applicable: 2, total: 3, coveragePercent: 50 });
});
