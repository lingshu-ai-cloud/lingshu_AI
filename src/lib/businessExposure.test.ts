import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessExposure, type OrganicExposure } from './businessExposure';
const organic: OrganicExposure = { impressions: 200, accountId: 'a', since: '2026-10-01', until: '2026-10-07', timezone: 'Asia/Shanghai', excludesPaid: true };
const paid = { ...organic, impressions: 300 };
test('adds only disjoint impression counts from the identical report scope', () => {
  assert.equal(businessExposure(organic, paid).total, 500);
  assert.equal(businessExposure({ ...organic, impressions: 0 }, { ...paid, impressions: 0 }).total, 0);
  for (const change of [{ accountId: 'b' }, { since: '2026-10-02' }, { until: '2026-10-08' }, { timezone: 'UTC' }]) assert.equal(businessExposure(organic, { ...paid, ...change }).total, null);
});
test('does not use missing, negative or nonfinite counts as zero or add views to impressions', () => {
  for (const impressions of [null, -1, NaN, Infinity]) assert.equal(businessExposure({ ...organic, impressions }, paid).total, null);
  assert.equal(businessExposure(undefined, paid).total, null);
  assert.equal(businessExposure(organic, undefined).total, null);
  assert.equal(businessExposure({ ...organic, excludesPaid: false } as unknown as OrganicExposure, paid).total, null);
});
