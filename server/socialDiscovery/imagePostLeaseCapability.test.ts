import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imagePostLeaseSchemaReady } from './imagePostLeaseCapability.js';

const fields = ['tenant_id', 'lease_scope', 'subject_id', 'lease_token', 'owner_id', 'acquired_at', 'expires_at']
  .map(name => ({ name, type: 'text', required: true }));
const ready = () => ({ name: 'durable_operation_leases', type: 'base',
  listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  fields, indexes: ['CREATE UNIQUE INDEX idx_durable_operation_lease_subject ON durable_operation_leases (tenant_id, lease_scope, subject_id)'] });

test('image analysis requires the live private collection and exact unique lease index', () => {
  assert.equal(imagePostLeaseSchemaReady(ready()), true);
  assert.equal(imagePostLeaseSchemaReady({ ...ready(), indexes: [] }), false);
  assert.equal(imagePostLeaseSchemaReady({ ...ready(), indexes: [
    'CREATE INDEX idx_durable_operation_lease_subject ON durable_operation_leases (tenant_id, lease_scope, subject_id)',
  ] }), false);
  assert.equal(imagePostLeaseSchemaReady({ ...ready(), indexes: [
    'CREATE UNIQUE INDEX idx_durable_operation_lease_subject ON durable_operation_leases (tenant_id, subject_id, lease_scope)',
  ] }), false);
  assert.equal(imagePostLeaseSchemaReady({ ...ready(), createRule: '' }), false);
  assert.equal(imagePostLeaseSchemaReady({ ...ready(), fields: fields.slice(1) }), false);
});
