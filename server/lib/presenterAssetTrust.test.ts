import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHeyGenPresenterRecord, validatePresenterRightsEvidence } from './presenterAssetTrust.js';

const now = new Date('2026-09-25T12:00:00Z');
const rights = {
  authorizationRef: 'rights://tenant-a/person-a/contract-v1',
  consentRef: 'consent://tenant-a/person-a/recording-v1',
  grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true,
  permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'],
};

test('accepts a presenter only with provider- and use-scoped consent evidence', () => {
  const result = validateHeyGenPresenterRecord({ id: 'person-a', authorized: true, assetVersion: 2,
    toolMappings: { heygen: { avatarId: 'avatar-a', voiceId: 'voice-a' } }, rightsEvidence: rights }, now);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual({ id: result.presenterAssetId, avatar: result.avatarId, voice: result.voiceId, version: result.assetVersion },
    { id: 'person-a', avatar: 'avatar-a', voice: 'voice-a', version: 2 });
});

test('DashScope quality inspection requires its own provider and use scope', () => {
  const denied = validatePresenterRightsEvidence({ ...rights, permittedProviders: ['volcengine_ark', 'dashscope'], permittedUses: ['digital_presenter', 'person_replacement', 'quality_inspection'] },
    { provider: 'dashscope', uses: ['quality_inspection'] }, now);
  assert.deepEqual(denied.ok ? [] : denied.reasons, ['provider_not_authorized', 'use_not_authorized']);
  const accepted = validatePresenterRightsEvidence({ ...rights, permittedProviders: ['volcengine_ark', 'dashscope'], permittedUses: ['digital_presenter', 'person_replacement', 'quality_inspection'], providerScopes: [{provider:'dashscope',uses:['quality_inspection']}] },
    { provider: 'dashscope', uses: ['quality_inspection'] }, now);
  assert.equal(accepted.ok, true);
  const qualityOnlyCannotGenerate = validatePresenterRightsEvidence({ ...rights, providerScopes: [{ provider: 'dashscope', uses: ['quality_inspection'] }] },
    { provider: 'dashscope', uses: ['person_replacement'] }, now);
  assert.deepEqual(qualityOnlyCannotGenerate.ok ? [] : qualityOnlyCannotGenerate.reasons, ['use_not_authorized']);
  const generationAccepted = validatePresenterRightsEvidence({ ...rights, providerScopes: [{ provider: 'dashscope', uses: ['person_replacement'] }] },
    { provider: 'dashscope', uses: ['person_replacement'] }, now);
  assert.equal(generationAccepted.ok, true);
});

test('fails closed for a bare consent flag, expired rights, revocation, or unapproved provider', () => {
  assert.equal(validateHeyGenPresenterRecord({ id: 'person-a', authorized: true, avatarId: 'a', voiceId: 'v' }, now).ok, false);
  const expired = validatePresenterRightsEvidence({ ...rights, expiresAt: '2026-09-20T00:00:00Z' },
    { provider: 'heygen', uses: ['digital_presenter'] }, now);
  assert.deepEqual(expired.ok ? [] : expired.reasons, ['rights_expired']);
  const revoked = validatePresenterRightsEvidence({ ...rights, revokedAt: '2026-09-20T00:00:00Z' },
    { provider: 'heygen', uses: ['digital_presenter'] }, now);
  assert.deepEqual(revoked.ok ? [] : revoked.reasons, ['rights_revoked']);
  const wrongProvider = validatePresenterRightsEvidence(rights,
    { provider: 'volcengine_ark', uses: ['person_replacement'] }, now);
  assert.deepEqual(wrongProvider.ok ? [] : wrongProvider.reasons, ['provider_not_authorized', 'use_not_authorized']);
});

test('rejects opaque text in place of retained evidence references', () => {
  const result = validatePresenterRightsEvidence({ ...rights, consentRef: 'user checked a box' },
    { provider: 'heygen', uses: ['digital_presenter', 'voice_synthesis'] }, now);
  assert.deepEqual(result.ok ? [] : result.reasons, ['subject_consent_ref_invalid']);
});

test('fails closed when grant timestamps or provider/use lists are malformed', () => {
  const future = validatePresenterRightsEvidence({ ...rights, grantedAt: '2026-10-01T00:00:00Z' },
    { provider: 'heygen', uses: ['digital_presenter'] }, now);
  assert.deepEqual(future.ok ? [] : future.reasons, ['rights_granted_at_invalid']);
  const unknownProvider = validatePresenterRightsEvidence({ ...rights, permittedProviders: ['heygen', 'unknown'] },
    { provider: 'heygen', uses: ['digital_presenter'] }, now);
  assert.deepEqual(unknownProvider.ok ? [] : unknownProvider.reasons, ['provider_not_authorized']);
  const emptyUses = validatePresenterRightsEvidence({ ...rights, permittedUses: [] },
    { provider: 'heygen', uses: ['digital_presenter'] }, now);
  assert.deepEqual(emptyUses.ok ? [] : emptyUses.reasons, ['use_not_authorized']);
});
