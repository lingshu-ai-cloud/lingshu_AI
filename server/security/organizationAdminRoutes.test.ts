import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { organizationAdminAccessDecision } from '../routes/organizationAdminAccess.js';
import { requiredRolesForApiWrite } from '../middleware/apiAccessPolicy.js';

assert.equal(organizationAdminAccessDecision({ supportAccess: false, role: 'super_admin' }), 'allow');
assert.equal(organizationAdminAccessDecision({ supportAccess: false, role: 'admin' }), 'allow');
assert.equal(organizationAdminAccessDecision({ supportAccess: false, role: 'social_operator' }), 'organization_admin_forbidden');
assert.equal(organizationAdminAccessDecision({ supportAccess: false, role: 'customer_service' }), 'organization_admin_forbidden');
assert.equal(organizationAdminAccessDecision({ supportAccess: true, role: 'super_admin' }), 'support_read_only');
assert.equal(organizationAdminAccessDecision({ supportAccess: false, role: null }), 'organization_admin_forbidden');

assert.deepEqual(requiredRolesForApiWrite('/api/oauth/whatsapp/exchange'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/support-access/settings'), ['super_admin', 'admin']);
assert.deepEqual(requiredRolesForApiWrite('/api/overseas/enterprise/product-api/rotate'), ['super_admin', 'admin']);

const source = (relativePath: string) => fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
const enterprise = source('../routes/enterprise.ts');
const whatsapp = source('../routes/whatsappOAuth.ts');
const support = source('../routes/supportAccess.ts');
const hook = source('../../pb_hooks/atomic.pb.js');
const migration = source('../../pb_migrations/1788307203_harden_tenant_product_api_keys.js');

assert.match(enterprise, /enterpriseRouter\.get\('\/product-api', requireOrganizationAdmin,/,
  'product API creation/status read must be organization-admin guarded');
assert.match(enterprise, /enterpriseRouter\.post\('\/product-api\/rotate', requireOrganizationAdmin,/,
  'product API rotation must be organization-admin guarded');
assert.match(enterprise, /enterpriseRouter\.get\('\/product-api\/status', requireOrganizationAdmin,/,
  'product API ingestion/key status must be organization-admin guarded');
assert.doesNotMatch(enterprise, /where:\s*\{\s*api_key:/,
  'product API authentication must never query a raw api_key');
assert.match(whatsapp, /post\('\/exchange', requireAuth, requireOrganizationAdmin,/,
  'WhatsApp token exchange must have route-level admin defense');
assert.match(support, /put\('\/settings', requireOrganizationAdmin,/,
  'support authorization settings mutation must have route-level admin defense');
assert.equal((hook.match(/tenant_api_keys:\s*true/g) || []).length, 2,
  'both atomic primitives must allow the hardened tenant key collection');
assert.match(migration, /fields\.removeById\(collection\.fields\.getByName\("api_key"\)\.id\)/,
  'migration must irreversibly scrub the legacy plaintext field');
assert.match(migration, /CREATE UNIQUE INDEX idx_tenant_api_keys_tenant/);
assert.match(migration, /CREATE UNIQUE INDEX idx_tenant_api_keys_hash/);

console.log('organization-admin secret, WhatsApp OAuth, support settings, and migration contracts passed');
