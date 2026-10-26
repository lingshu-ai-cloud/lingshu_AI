import test from 'node:test';
import assert from 'node:assert/strict';
import { newsSourceCacheKey, recallNewsSources, rememberNewsSources, sameNewsOriginals } from './newsSourceCache.js';

test('news reuse is exact-scope, expires, and requires unchanged freshly fetched cited originals', () => {
  const source = { title: 'Official news', uri: 'https://www.basf.com/release' };
  const original = { id: 'S1', source, text: 'Public original', published: ['2026-10-21'] };
  const key = newsSourceCacheKey('https://provider.invalid', 'global cosmetics', { searchFreshnessDays: 30 });
  rememberNewsSources(key, { text: 'Verified answer', sources: [source] }, [original], 100);
  const recalled = recallNewsSources(key, 101)!;
  assert.ok(sameNewsOriginals(recalled, [original]));
  assert.equal(sameNewsOriginals(recalled, []), false);
  assert.equal(sameNewsOriginals(recalled, [{ ...original, text: 'Changed body' }]), false);
  assert.equal(sameNewsOriginals(recalled, [{ ...original, published: ['2026-10-22'] }]), false);
  assert.notEqual(key, newsSourceCacheKey('https://provider.invalid', 'China cosmetics', { searchFreshnessDays: 30 }));
  assert.notEqual(key, newsSourceCacheKey('https://provider.invalid', 'global cosmetics', { searchFreshnessDays: 7 }));
  recalled.answer.text = 'mutated';
  assert.equal(recallNewsSources(key, 102)?.answer.text, 'Verified answer');
  assert.equal(recallNewsSources(key, 600_100), undefined);
});
