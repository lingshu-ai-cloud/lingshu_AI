import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateProductionOnboardingReadiness, normalizeProductionOnboardingPreferences } from './productionOnboarding.js';

test('normalization does not accept browser readiness claims and clears contact details when CTA is excluded', () => {
  assert.deepEqual(normalizeProductionOnboardingPreferences({
    contact: { kind: 'none', value: 'should-disappear', primaryCta: 'call us' },
    presenterPolicy: 'local_video_only', output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' },
    presenterReady: true, inventoryArchetypes: ['P2B_PRODUCT_SHELF'], includeOneRevision: true,
  }), {
    schemaVersion: 'fixed-yield.production-onboarding.v1',
    contact: { kind: 'none', value: '', primaryCta: '' },
    presenterPolicy: 'local_video_only',
    output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' },
    includeOneRevision: true, confirmedAt: '',
  });
});

test('preflight reports presenter, voice and local-material blockers without a creative budget gate', () => {
  const preferences = normalizeProductionOnboardingPreferences({
    contact: { kind: 'whatsapp', value: '', primaryCta: '' },
    presenterPolicy: 'digital_presenter', output: {}, includeOneRevision: true,
  })!;
  const result = evaluateProductionOnboardingReadiness({
    preferences,
    evidence: { companyReady: true, brandReady: true, productFactsReady: true, presenterReady: true,
      voiceReady: false, inventoryArchetypes: ['P2B_PRODUCT_SHELF'], budgetConfirmed: false },
    requiredArchetypes: ['P1C_SHELF_STAND_TALK', 'P2B_PRODUCT_SHELF', 'P3B_MACHINE_CLOSEUP'],
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers.map(item => [item.code, item.archetypeId ?? null]), [
    ['public_contact_missing', null], ['primary_cta_missing', null], ['voice_missing', null],
    ['local_material_missing', 'P3B_MACHINE_CLOSEUP'],
  ]);
});

test('preflight accepts a fully evidenced frozen input set', () => {
  const preferences = normalizeProductionOnboardingPreferences({
    contact: { kind: 'email', value: 'sales@example.com', primaryCta: '发送采购需求' },
    presenterPolicy: 'digital_presenter', output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' },
    includeOneRevision: true, confirmedAt: '2026-10-15T00:00:00.000Z',
  })!;
  const result = evaluateProductionOnboardingReadiness({
    preferences,
    evidence: { companyReady: true, brandReady: true, productFactsReady: true, presenterReady: true,
      voiceReady: true, inventoryArchetypes: ['P2C_PACKAGE_DETAIL'], budgetConfirmed: true },
    requiredArchetypes: ['P1B_FACTORY_STAND_TALK', 'P2C_PACKAGE_DETAIL'],
  });
  assert.deepEqual(result, { ready: true, blockers: [] });
});
