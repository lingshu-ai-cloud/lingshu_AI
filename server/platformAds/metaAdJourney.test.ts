import assert from 'node:assert/strict';
import test from 'node:test';
import { META_AD_GOALS } from '../../shared/metaAdObjectives.js';
import { META_AD_JOURNEYS, metaBusinessMissing, normalizeAdCountries } from '../../shared/metaAdJourney.js';
const base = { pageId: '1', videoId: '2', imageUrl: 'https://example.com/cover.jpg', message: '产品目录', countries: 'CA', dailyBudget: 10, linkUrl: '' };
test('five journeys require actual budget/geography/content without inventing defaults or unnecessary destinations', () => {
  for (const goal of META_AD_GOALS) {
    assert.ok(META_AD_JOURNEYS[goal].customer);
    const needsWebsite = ['提升网站访问', '获取独立站询盘'].includes(goal);
    assert.equal(metaBusinessMissing(goal, base, 100).length, needsWebsite ? 1 : 0);
    assert.deepEqual(metaBusinessMissing(goal, { ...base, linkUrl: 'https://example.com/quote' }, 100), []);
    const missing = metaBusinessMissing(goal, { ...base, countries: '', dailyBudget: 0 }, 100);
    assert.ok(missing.includes('投放国家或地区')); assert.ok(missing.includes('预算范围内的日预算'));
    assert.ok(!missing.some(s => /负责人|联系渠道|ID/.test(s)));
  }
  assert.deepEqual(normalizeAdCountries(undefined), []);
  assert.deepEqual(normalizeAdCountries(['CA','CA']), ['CA']);
  assert.throws(() => normalizeAdCountries('US'), /国家/);
  assert.throws(() => normalizeAdCountries(['US,CA']), /国家/);
});
