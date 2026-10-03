import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptPresenterPortraitReference, acceptSeedancePortrait } from './presenterAssetAcceptance.js';

const rightsEvidence = { authorizationRef: 'rights://tenant-a/person-a/v1', consentRef: 'consent://tenant-a/person-a/v1',
  grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true,
  permittedProviders: ['volcengine_ark'], permittedUses: ['digital_presenter', 'person_replacement'] };
const presenter = { id: 'person-a', authorized: true, rightsEvidence,
  toolMappings: { seedance: { referenceMaterialIds: ['portrait-a'] } } };
const material: any = { id: 'portrait-a', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'materials/tenants/dGVuYW50LWE/a.jpg',
  seedanceTrustedAsset: { uri: 'asset://asset-portrait-a', kind: 'image', status: 'active', provider: 'volcengine_ark' } };

test('accepts a provider asset only when it is bound to owned source media and scoped consent', () => {
  assert.deepEqual(acceptSeedancePortrait({ tenantId: 'tenant-a', presenter, material, now: new Date('2026-09-25') }), {
    presenterAssetId: 'person-a', materialId: 'portrait-a', trustedAssetUri: 'asset://asset-portrait-a',
    authorizationRef: rightsEvidence.authorizationRef, consentRef: rightsEvidence.consentRef,
  });
});

test('accepts the persisted sd mapping alias used by production defaults', () => {
  const sdPresenter = { ...presenter, toolMappings: { sd: { referenceMaterialIds: ['portrait-a'] } } };
  assert.equal(acceptSeedancePortrait({ tenantId: 'tenant-a', presenter: sdPresenter, material, now: new Date('2026-09-25') }).trustedAssetUri,
    'asset://asset-portrait-a');
});

test('accepts a runway mapping when that is the only persisted portrait binding', () => {
  const runwayPresenter = { ...presenter, toolMappings: { runway: { referenceMaterialIds: ['portrait-a'] } } };
  assert.equal(acceptSeedancePortrait({ tenantId: 'tenant-a', presenter: runwayPresenter, material, now: new Date('2026-09-25') }).trustedAssetUri,
    'asset://asset-portrait-a');
});

test('rejects cross-tenant, inactive, unbound, or unconsented portraits', () => {
  assert.throws(() => acceptSeedancePortrait({ tenantId: 'tenant-b', presenter, material, now: new Date('2026-09-25') }), /portrait_not_owned_by_tenant/);
  assert.throws(() => acceptSeedancePortrait({ tenantId: 'tenant-a', presenter: { ...presenter, toolMappings: { seedance: { referenceMaterialIds: [] } } }, material, now: new Date('2026-09-25') }), /portrait_not_bound_to_presenter/);
  assert.throws(() => acceptSeedancePortrait({ tenantId: 'tenant-a', presenter: { ...presenter, rightsEvidence: { ...rightsEvidence, revokedAt: '2026-09-20' } }, material, now: new Date('2026-09-25') }), /rights_revoked/);
  assert.throws(() => acceptSeedancePortrait({ tenantId: 'tenant-a', presenter, material: { ...material,
    seedanceTrustedAsset: { ...material.seedanceTrustedAsset, status: 'pending' } }, now: new Date('2026-09-25') }), /seedance_trusted_asset_missing_or_inactive/);
  assert.throws(() => acceptSeedancePortrait({ tenantId: 'tenant-a', presenter, material: { ...material,
    objectKey: 'materials/tenants/dGVuYW50LWI/a.jpg' }, now: new Date('2026-09-25') }), /portrait_object_storage_not_tenant_scoped/);
});

test('photo talking accepts an owned still as a Seedream reference without Ark image certification', () => {
  const localPortrait = { ...material, seedanceTrustedAsset: undefined };
  const bound = { ...presenter, referenceMaterialIds: ['portrait-a'] };
  assert.doesNotThrow(() => acceptPresenterPortraitReference({ tenantId: 'tenant-a', presenter: bound, material: localPortrait,
    provider: 'volcengine_ark', uses: ['person_replacement'], now: new Date('2026-09-25') }));
  assert.throws(() => acceptSeedancePortrait({ tenantId: 'tenant-a', presenter: bound, material: localPortrait,
    now: new Date('2026-09-25') }), /seedance_trusted_asset_missing_or_inactive/);
  assert.throws(() => acceptPresenterPortraitReference({ tenantId: 'tenant-b', presenter: bound, material: localPortrait,
    provider: 'volcengine_ark', uses: ['person_replacement'], now: new Date('2026-09-25') }), /portrait_not_owned_by_tenant/);
});
