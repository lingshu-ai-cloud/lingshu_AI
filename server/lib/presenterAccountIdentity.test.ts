import assert from 'node:assert/strict';
import type { PresenterAsset } from '../../src/lib/shotProduction.js';
import { normalizePresenterAccountIdentity } from './presenterAccountIdentity.js';

const presenter = (patch: Partial<PresenterAsset> = {}): PresenterAsset => ({
  id: 'presenter-1', name: '演示人物', avatarId: 'avatar-1', voiceId: 'voice-1',
  authorized: true, supportsAlpha: false, ...patch,
});

assert.deepEqual(normalizePresenterAccountIdentity(presenter()), {});
assert.deepEqual(normalizePresenterAccountIdentity(presenter({
  socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: 'v1',
  rightsEvidence: { authorizationRef: 'authorization-1', consentRef: 'consent-1', grantedAt: '2026-09-26T00:00:00.000Z',
    subjectAdultConfirmed: true, permittedProviders: ['heygen'], permittedUses: ['digital_presenter'] },
})), {
  socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: 'v1',
  presenterProfileStatus: 'published', commercialRightsStatus: 'cleared', consistencyKey: 'account-1:profile-1:v1',
});
assert.throws(() => normalizePresenterAccountIdentity(presenter({ socialAccountId: 'account-1' })), /同时绑定/);
assert.throws(() => normalizePresenterAccountIdentity(presenter({ socialAccountId: 'account-1', presenterProfileId: 'profile-1',
  presenterProfileVersion: 'v1', consistencyKey: 'account-1:profile-1:v2' })), /一致性标识/);
assert.throws(() => normalizePresenterAccountIdentity(presenter({ socialAccountId: 'account-1', presenterProfileId: 'profile-1',
  presenterProfileVersion: 'v1', commercialRightsStatus: 'cleared' })), /商业授权/);

console.log('presenter account identity tests passed');
