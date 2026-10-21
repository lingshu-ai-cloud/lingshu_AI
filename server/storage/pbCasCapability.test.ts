import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithDataAuthority } from './dataAuthority.js';
import { pbStore } from './pbStore.js';
import { pocketBaseCasClaimSchemaReady, pocketBaseCasClaimSchemaVerified } from './pbCasCapability.js';

const fields = ['target_key', 'expected_fingerprint', 'operation_fingerprint', 'owner_token', 'created_at', 'lease_expires_at']
  .map(name => ({ name, type: 'text', required: true }));
const valid = () => ({
  name: 'datastore_cas_claims', type: 'base',
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields,
  indexes: ['CREATE UNIQUE INDEX idx_datastore_cas_claim_target ON datastore_cas_claims (target_key)'],
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

test('only image task CAS capability turns on after a live read-only PocketBase schema check', async () => {
  const previous = {
    fetch: globalThis.fetch, url: process.env.PB_URL,
    email: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD,
  };
  process.env.PB_URL = 'http://pocketbase-cas-capability.test';
  process.env.PB_ADMIN_EMAIL = 'capability-test@example.invalid';
  process.env.PB_ADMIN_PASSWORD = 'capability-test-secret';
  let metadata: unknown = valid();
  let schemaReads = 0;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith('/api/collections/_superusers/auth-with-password')) return Response.json({ token: 'test-admin-token' });
    if (url.endsWith('/api/collections/datastore_cas_claims')) {
      schemaReads += 1;
      return Response.json(metadata);
    }
    return new Response(null, { status: 404 });
  };
  try {
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwap?.()), false);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('studio_projects')), true);
    assert.equal(await runWithDataAuthority('pocketbase', () => pbStore.supportsAtomicCompareAndSwapFor?.('workflow_runs')), false);
    assert.equal(schemaReads, 1);
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
