import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { auth } from '../storage/index.js';
import {
  buildDemoStatus,
  consumeDemoQuota,
  demoQuotaExemptTenantIds,
  isDemoQuotaExemptTenant,
  isDemoTokenExemptIdentity,
} from './demo.js';

const originalDemoMode = process.env.DEMO_MODE;
const originalExemptTenants = process.env.DEMO_QUOTA_EXEMPT_TENANT_IDS;
const originalTokenExemptTenants = process.env.DEMO_TOKEN_EXEMPT_TENANT_IDS;
const originalTokenExemptUsers = process.env.DEMO_TOKEN_EXEMPT_USER_IDS;
const originalVerifyToken = auth.verifyToken;

test('demo quota exemptions use exact normalized tenant-id set membership', () => {
  process.env.DEMO_QUOTA_EXEMPT_TENANT_IDS = ' tenant-a,tenant-b, tenant-a ';
  assert.deepEqual([...demoQuotaExemptTenantIds()], ['tenant-a', 'tenant-b']);
  assert.equal(isDemoQuotaExemptTenant('tenant-a'), true);
  assert.equal(isDemoQuotaExemptTenant('tenant'), false);
  assert.equal(isDemoQuotaExemptTenant('TENANT-A'), false);
  assert.equal(isDemoQuotaExemptTenant(undefined), false);
});
test('token-only exception never disables other quotas or matches a different tenant',()=>{
 process.env.DEMO_TOKEN_EXEMPT_TENANT_IDS=' beauty-tenant ';
 process.env.DEMO_TOKEN_EXEMPT_USER_IDS=' beauty-user ';
 assert.equal(isDemoTokenExemptIdentity('beauty-tenant','beauty-user'),true);
 assert.equal(isDemoTokenExemptIdentity('beauty','beauty-user'),false);
 assert.equal(isDemoTokenExemptIdentity('beauty-tenant','another-user'),false);
 assert.equal(isDemoQuotaExemptTenant('beauty-tenant'),false);
});

test('consume and status both bypass demo limits for an exempt authenticated tenant', async () => {
  process.env.DEMO_MODE = 'true';
  process.env.DEMO_QUOTA_EXEMPT_TENANT_IDS = 'tenant-unlimited';
  auth.verifyToken = async () => ({ userId: 'user-a', tenantId: 'tenant-unlimited' });

  const request = { headers: { authorization: 'Bearer test' }, body: {} } as Request;
  let responseStatus: number | undefined;
  const response = {
    locals: {},
    status(value: number) { responseStatus = value; return this; },
    json() { return this; },
  } as unknown as Response;

  assert.equal(await consumeDemoQuota(request, response, 'videoGeneration'), true);
  assert.equal(responseStatus, undefined, 'an exempt tenant must not receive a quota response');

  const status = await buildDemoStatus(
    request,
    'tenant-unlimited',
    '2000-01-01T00:00:00.000Z',
    'user-a',
  );
  assert.equal(status.enabled, false);
  assert.equal(status.expired, false);
  assert.equal(status.expiresAt, null);
  assert.equal(status.daysRemaining, null);
});

test.after(() => {
  if(originalTokenExemptUsers===undefined)delete process.env.DEMO_TOKEN_EXEMPT_USER_IDS;else process.env.DEMO_TOKEN_EXEMPT_USER_IDS=originalTokenExemptUsers;
  if(originalTokenExemptTenants===undefined)delete process.env.DEMO_TOKEN_EXEMPT_TENANT_IDS;else process.env.DEMO_TOKEN_EXEMPT_TENANT_IDS=originalTokenExemptTenants;
  auth.verifyToken = originalVerifyToken;
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
  if (originalExemptTenants === undefined) delete process.env.DEMO_QUOTA_EXEMPT_TENANT_IDS;
  else process.env.DEMO_QUOTA_EXEMPT_TENANT_IDS = originalExemptTenants;
});
