import assert from 'node:assert/strict';
import test from 'node:test';
import { businessOverviewSample, isBusinessOverviewSampleEnabled } from './businessOverviewSample';
import type { DigitalEmployeeOverview } from '../lib/digitalEmployees';

test('filled overview is limited to explicit local development preview', () => {
  const search = '?page=digitalEmployees&overviewSample=1';
  assert.equal(isBusinessOverviewSampleEnabled({ dev: true, hostname: '127.0.0.1', search }), true);
  assert.equal(isBusinessOverviewSampleEnabled({ dev: false, hostname: '127.0.0.1', search }), false);
  assert.equal(isBusinessOverviewSampleEnabled({ dev: true, hostname: 'example.com', search }), false);
  assert.equal(isBusinessOverviewSampleEnabled({ dev: true, hostname: '127.0.0.1', search: '?page=digitalEmployees' }), false);
});

test('preview values are complete and leave the fetched overview untouched', () => {
  const source = { agents: [], businessSnapshot: null, config: { companyName: '', publishingTargets: [] }, goal: null, plan: null, contentQueue: null } as unknown as DigitalEmployeeOverview;
  const sample = businessOverviewSample(source, new Date('2026-10-27T06:00:00.000Z'));
  assert.equal(source.businessSnapshot, null);
  assert.equal(sample.displayData.businessSnapshot?.social.dailyTrend.length, 7);
  assert.equal(sample.displayData.businessSnapshot?.social.dailyTrend.at(-1)?.date, '2026-10-27');
  assert.equal(sample.today.views, 34_500);
  assert.equal(sample.customer.quoted, 43);
  assert.equal(sample.score.criteria.length, 5);
  assert.equal(sample.adPlans.tasks.length, 2);
  assert.equal(sample.weekly.plannedVideos, 32);
});
