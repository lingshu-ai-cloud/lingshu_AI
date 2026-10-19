import assert from 'node:assert/strict';
import test from 'node:test';
import { hasInternalBudgetExemptTenants, isInternalBudgetExemptTenant } from './tenantBudgetExemption.js';

test('budget exemption matches only the complete configured tenant id', () => {
  assert.equal(isInternalBudgetExemptTenant('tenant-exact', 'tenant-exact'), true);
  assert.equal(isInternalBudgetExemptTenant('tenant', 'tenant-exact'), false);
  assert.equal(isInternalBudgetExemptTenant('tenant-exact-child', 'tenant-exact'), false);
  assert.equal(isInternalBudgetExemptTenant('TENANT-EXACT', 'tenant-exact'), false);
  assert.equal(isInternalBudgetExemptTenant('tenant-exact', 'TENANT-EXACT'), false);
});

test('budget exemption accepts comma-separated ids and trims configured whitespace only', () => {
  const configured = ' tenant-one,\n tenant-two\t, ,tenant-three ';
  assert.equal(isInternalBudgetExemptTenant('tenant-one', configured), true);
  assert.equal(isInternalBudgetExemptTenant('tenant-two', configured), true);
  assert.equal(isInternalBudgetExemptTenant('tenant-three', configured), true);
  assert.equal(isInternalBudgetExemptTenant(' tenant-one', configured), false,
    'request tenant ids are identities and must not be normalized into a match');
  assert.equal(hasInternalBudgetExemptTenants(configured), true);
});

test('wildcard never enables a global budget exemption', () => {
  assert.equal(isInternalBudgetExemptTenant('any-tenant', '*'), false);
  assert.equal(isInternalBudgetExemptTenant('*', '*'), false);
  assert.equal(hasInternalBudgetExemptTenants('*'), false);
  assert.equal(isInternalBudgetExemptTenant('tenant-exact', '*, tenant-exact'), true);
  assert.equal(isInternalBudgetExemptTenant('unlisted', '*, tenant-exact'), false);
  assert.equal(hasInternalBudgetExemptTenants(' *, tenant-exact '), true);
});
