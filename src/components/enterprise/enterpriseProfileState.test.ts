import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT, hydrateEnterpriseProfile, profileSnapshot } from './enterpriseProfileState';

test('server profile hydration preserves legacy business facts and safe defaults', () => {
  const hydrated = hydrateEnterpriseProfile({
    company: { ...DEFAULT.company, name: '示例企业' },
    products: { ...DEFAULT.products, priceRange: '$5 - $500', moq: '50 件' },
    notifications: { ...DEFAULT.notifications!, receivers: [], nightMode: { enabled: true, autoCategories: 'approved' } },
    salesStyleProfile: { learnedFromCount: 2, sample_pairs: [] },
  });
  assert.equal(hydrated.company.name, '示例企业');
  assert.equal(hydrated.bizRules?.priceRange, '$5 - $500');
  assert.equal(hydrated.bizRules?.moq, '50 件');
  assert.equal(hydrated.bizRules?.quoteMode, 'human_only');
  assert.equal(hydrated.notifications?.nightMode.enabled, true);
  assert.deepEqual(hydrated.salesStyleProfile?.sample_pairs, []);
  assert.equal(profileSnapshot(hydrated), profileSnapshot({ ...hydrated, socialStrategy: {
    ...hydrated.socialStrategy!, enabledRoutes: [], routeStrategies: { oem_odm: { targetBuyerRoles: ['采购'], primaryCta: '联系 WhatsApp' } },
  } }));
});

test('profile lifecycle stays mounted and preserves bounded load, poll and autosave gates', () => {
  const page = readFileSync(new URL('../EnterprisePage.tsx', import.meta.url), 'utf8');
  const lifecycle = readFileSync(new URL('./useEnterpriseProfileLifecycle.ts', import.meta.url), 'utf8');
  assert.match(page, /useEnterpriseProfileLifecycle\(\{/);
  assert.ok(page.indexOf('useEnterpriseProfileLifecycle(') < page.indexOf('if (loading) {'));
  assert.match(lifecycle, /fetch\('\/api\/overseas\/enterprise\/profile'/);
  assert.match(lifecycle, /controller\.abort\(\), 15_000/);
  assert.match(lifecycle, /controller\.abort\(\), 12_000/);
  assert.match(lifecycle, /if \(!autoSave \|\| loading \|\| saving \|\| !hasUnsavedChanges \|\| saveError\) return/);
  assert.match(lifecycle, /saveEnterpriseProfileAndVerify\(profile\)/);
  assert.match(lifecycle, /persistedProfileRef\.current = profileSnapshot\(confirmedProfile\)/);
});
