import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithDataAuthority } from './dataAuthority.js';
import { pbStore } from './pbStore.js';
import { pocketBaseCasClaimSchemaReady, pocketBaseCasClaimSchemaVerified, pocketBaseUniqueOwnerSchemaReady } from './pbCasCapability.js';

const fields = ['target_key', 'expected_fingerprint', 'operation_fingerprint', 'owner_token', 'created_at', 'lease_expires_at']
  .map(name => ({ name, type: 'text', required: true }));
const valid = () => ({
  name: 'datastore_cas_claims', type: 'base',
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields,
  indexes: ['CREATE UNIQUE INDEX idx_datastore_cas_claim_target ON datastore_cas_claims (target_key)'],
});
const ownerSchema = (name: 'tenant_profiles' | 'enterprise_onboarding_drafts' | 'digital_employee_configs' | 'digital_employee_config_versions') => ({
  name, type: 'base',
  fields: (name === 'enterprise_onboarding_drafts' ? ['tenant_id', 'user_id']
    : name === 'digital_employee_config_versions' ? ['tenant_id', 'config_version'] : ['tenant_id'])
    .map(field => ({ name: field, type: field === 'config_version' ? 'number' : 'text', required: true })),
  indexes: [name === 'tenant_profiles'
    ? 'CREATE UNIQUE INDEX idx_tenant_profile_owner ON tenant_profiles (tenant_id)'
    : name === 'digital_employee_configs'
      ? 'CREATE UNIQUE INDEX idx_digital_employee_config_tenant ON digital_employee_configs (tenant_id)'
    : name === 'digital_employee_config_versions'
      ? 'CREATE UNIQUE INDEX idx_de_config_versions_tenant_version ON digital_employee_config_versions (tenant_id, config_version)'
    : 'CREATE UNIQUE INDEX idx_enterprise_onboarding_draft_owner ON enterprise_onboarding_drafts (tenant_id, user_id)'],
});

test('first-create owner schema proof requires exact unique index and required owner fields', () => {
  assert.equal(pocketBaseUniqueOwnerSchemaReady('tenant_profiles', ownerSchema('tenant_profiles')), true);
  assert.equal(pocketBaseUniqueOwnerSchemaReady('enterprise_onboarding_drafts', ownerSchema('enterprise_onboarding_drafts')), true);
  assert.equal(pocketBaseUniqueOwnerSchemaReady('digital_employee_configs', ownerSchema('digital_employee_configs')), true);
  assert.equal(pocketBaseUniqueOwnerSchemaReady('digital_employee_config_versions', ownerSchema('digital_employee_config_versions')), true);
  assert.equal(pocketBaseUniqueOwnerSchemaReady('tenant_profiles', { ...ownerSchema('tenant_profiles'), indexes: [] }), false);
  assert.equal(pocketBaseUniqueOwnerSchemaReady('enterprise_onboarding_drafts', {
    ...ownerSchema('enterprise_onboarding_drafts'),
    indexes: ['CREATE UNIQUE INDEX idx_enterprise_onboarding_draft_owner ON enterprise_onboarding_drafts (tenant_id)'],
  }), false);
});

test('claim schema proof requires the exact unique target index and private fields', () => {
  assert.equal(pocketBaseCasClaimSchemaReady(valid()), true);
  assert.equal(pocketBaseCasClaimSchemaReady({ ...valid(), indexes: ['CREATE INDEX idx_datastore_cas_claim_target ON datastore_cas_claims (target_key)'] }), false);
  assert.equal(pocketBaseCasClaimSchemaReady({ ...valid(), indexes: ['CREATE UNIQUE INDEX idx_datastore_cas_claim_target ON datastore_cas_claims (owner_token)'] }), false);
  assert.equal(pocketBaseCasClaimSchemaReady({ ...valid(), indexes: ['CREATE UNIQUE INDEX idx_datastore_cas_claim_target ON other_claims (target_key)'] }), false);
  assert.equal(pocketBaseCasClaimSchemaReady({ ...valid(), createRule: '' }), false);
  assert.equal(pocketBaseCasClaimSchemaReady({ ...valid(), fields: fields.filter(field => field.name !== 'owner_token') }), false);
  assert.equal(pocketBaseCasClaimSchemaReady({ ...valid(), fields: fields.map(field => field.name === 'target_key' ? { ...field, required: false } : field) }), false);
});

test('approved CAS domains turn on only after a live read-only PocketBase schema check', async () => {
  const previous = {
    fetch: globalThis.fetch, url: process.env.PB_URL,
    email: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD,
  };
  process.env.PB_URL = 'http://pocketbase-cas-capability.test';
  process.env.PB_ADMIN_EMAIL = 'capability-test@example.invalid';
  process.env.PB_ADMIN_PASSWORD = 'capability-test-secret';
  let metadata: unknown = valid();
  let schemaReads = 0;
  let ownersReady = true;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/api/collections/_superusers/auth-with-password')) return Response.json({ token: 'test-admin-token' });
    if (url.endsWith('/api/collections/datastore_cas_claims')) {
      schemaReads += 1;
      return Response.json(metadata);
    }
    if (url.endsWith('/api/collections/tenant_profiles')) return Response.json(ownersReady ? ownerSchema('tenant_profiles') : { ...ownerSchema('tenant_profiles'), indexes: [] });
    if (url.endsWith('/api/collections/digital_employee_configs')) return Response.json(ownersReady ? ownerSchema('digital_employee_configs') : { ...ownerSchema('digital_employee_configs'), indexes: [] });
    if (url.endsWith('/api/collections/digital_employee_config_versions')) return Response.json(ownersReady ? ownerSchema('digital_employee_config_versions') : { ...ownerSchema('digital_employee_config_versions'), indexes: [] });
    if (url.endsWith('/api/collections/enterprise_onboarding_drafts')) return Response.json(ownersReady ? ownerSchema('enterprise_onboarding_drafts') : { ...ownerSchema('enterprise_onboarding_drafts'), indexes: [] });
    return new Response(null, { status: 404 });
  };
  try {
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwap?.()), false);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('studio_projects')), true);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('enterprise_onboarding_drafts')), true);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('tenant_profiles')), true);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('digital_employee_configs')), true);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('digital_employee_config_versions')), true);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('workflow_runs')), false);
    assert.equal(schemaReads, 5);
    ownersReady = false;
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('tenant_profiles')), false);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('enterprise_onboarding_drafts')), false);
    metadata = { ...valid(), indexes: [] };
    assert.equal(await runWithDataAuthority('pocketbase', () => pocketBaseCasClaimSchemaVerified()), false);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('studio_projects')), false);
    delete process.env.PB_ADMIN_PASSWORD;
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('studio_projects')), false);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.PB_URL; else process.env.PB_URL = previous.url;
    if (previous.email === undefined) delete process.env.PB_ADMIN_EMAIL; else process.env.PB_ADMIN_EMAIL = previous.email;
    if (previous.password === undefined) delete process.env.PB_ADMIN_PASSWORD; else process.env.PB_ADMIN_PASSWORD = previous.password;
  }
});
