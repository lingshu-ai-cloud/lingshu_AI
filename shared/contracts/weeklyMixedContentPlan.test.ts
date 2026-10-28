import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateWeeklyMixedProduction, recommendWeeklyMixedContent } from './weeklyMixedContentPlan';

test('mixed recommendation preserves the 10 originals and five linked platform adaptations', () => {
  const slots = recommendWeeklyMixedContent({ facebookAccountIds: ['fb-a', 'fb-b'], linkedinAccountId: 'li' });
  assert.equal(slots.length, 15);
  assert.equal(new Set(slots.map(slot => slot.slotId)).size, 15);
  for (const accountId of ['fb-a', 'fb-b']) {
    const account = slots.filter(slot => slot.accountId === accountId);
    assert.equal(account.filter(slot => slot.kind === 'video').length, 3);
    assert.equal(account.filter(slot => slot.kind === 'image').length, 2);
    assert.ok(account.every(slot => slot.productionRole === 'original'));
  }
  const originals = slots.filter(slot => slot.productionRole === 'original');
  const adaptations = slots.filter(slot => slot.productionRole === 'adaptation');
  assert.equal(originals.length, 10);
  assert.equal(adaptations.length, 5);
  assert.equal(slots.filter(slot => slot.kind === 'video').length, 7);
  assert.equal(slots.filter(slot => slot.kind === 'image').length, 8);
  assert.equal(adaptations.filter(slot => slot.presentation === 'image').length, 4);
  assert.equal(new Set(adaptations.map(slot => slot.originalSlotId)).size, 5);
  assert.ok(adaptations.every(slot => slot.platform === 'linkedin' && originals.some(original => original.slotId === slot.originalSlotId && original.kind === slot.kind)));
});

test('mixed recommendation requires three distinct actual account identities', () => {
  assert.throws(() => recommendWeeklyMixedContent({ facebookAccountIds: ['fb-a', 'fb-a'], linkedinAccountId: 'li' }), /distinct_accounts/);
  assert.throws(() => recommendWeeklyMixedContent({ facebookAccountIds: ['fb-a', ' '], linkedinAccountId: 'li' }), /distinct_accounts/);
});

test('quote counts only original production and published model rates, not adaptations', () => {
  const slots = recommendWeeklyMixedContent({ facebookAccountIds: ['fb-a', 'fb-b'], linkedinAccountId: 'li' });
  const quote = estimateWeeklyMixedProduction(slots);
  assert.equal(quote.publicationCount, 15);
  assert.equal(quote.videoOriginals, 6);
  assert.equal(quote.imageOriginals, 4);
  assert.ok(quote.minCny > 25 && quote.maxCny > 100);
  assert.equal(quote.basis.usdToCny, 7.2, 'exchange conversion is an explicit assumption, not a live rate');
  const adaptations = estimateWeeklyMixedProduction(slots.filter(slot => slot.productionRole === 'adaptation'));
  assert.equal(adaptations.minCny, 0);
  assert.equal(adaptations.maxCny, 0);
});
