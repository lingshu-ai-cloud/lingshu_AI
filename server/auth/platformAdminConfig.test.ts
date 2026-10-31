import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredPlatformAdminEmails, isConfiguredPlatformAdminEmail } from './platformAdminConfig.js';

test('platform admin allowlist unifies preferred and legacy variables', () => {
  const env = {
    PLATFORM_ADMIN_EMAILS: 'Owner@Example.com, ops@example.com',
    ADMIN_DASHBOARD_EMAILS: 'ops@example.com;legacy@example.com',
    LOCAL_ADMIN_EMAIL: 'local@example.com',
    WORKBENCH_ADMIN_EMAIL: 'workbench@example.com',
  } as NodeJS.ProcessEnv;

  assert.deepEqual(configuredPlatformAdminEmails(env), [
    'owner@example.com',
    'ops@example.com',
    'legacy@example.com',
    'local@example.com',
    'workbench@example.com',
  ]);
  assert.equal(isConfiguredPlatformAdminEmail(' OWNER@example.com ', env), true);
  assert.equal(isConfiguredPlatformAdminEmail('customer@example.com', env), false);
});
