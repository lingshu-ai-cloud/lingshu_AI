import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canShowAssistantFeatureGuide } from './useAssistantFeatureGuides';

const now = 100_000;
const base = {
  id: 'strategy-dashboard', page: 'strategy' as const, seen: new Set<string>(),
  enterpriseGuideSeen: false, lastShownAt: 0, now,
};

test('known unseen guide is eligible after cooldown', () => {
  assert.equal(canShowAssistantFeatureGuide(base), true);
  assert.equal(canShowAssistantFeatureGuide({ ...base, lastShownAt: now - 44_999 }), false);
  assert.equal(canShowAssistantFeatureGuide({ ...base, lastShownAt: now - 45_000 }), true);
});

test('unknown or already shown guides do not reopen', () => {
  assert.equal(canShowAssistantFeatureGuide({ ...base, id: 'unknown-guide' }), false);
  assert.equal(canShowAssistantFeatureGuide({ ...base, seen: new Set([base.id]) }), false);
});

test('enterprise guide appears once across enterprise guide targets', () => {
  const enterprise = { ...base, id: 'enterprise-center', page: 'enterprise' as const };
  assert.equal(canShowAssistantFeatureGuide(enterprise), true);
  assert.equal(canShowAssistantFeatureGuide({ ...enterprise, enterpriseGuideSeen: true }), false);
  assert.equal(canShowAssistantFeatureGuide({ ...enterprise, seen: new Set(['__enterprise-guide-shown__']) }), false);
});
