import assert from 'node:assert/strict';
import test from 'node:test';
import { Starter198RepositoryError } from './repository.js';
import { resolveServerProductProfile } from './productProfile.js';

test('classifies a provisioned workspace without reading workspace data', async () => {
  let calls = 0;
  const profile = await resolveServerProductProfile('tenant-a', {
    async access(tenantId) {
      calls += 1;
      assert.equal(tenantId, 'tenant-a');
      return {} as never;
    },
  });
  assert.equal(profile, 'starter_198');
  assert.equal(calls, 1);
});

test('treats only authoritative non-provisioning as a legacy profile', async () => {
  const profile = await resolveServerProductProfile('tenant-a', {
    async access() { throw new Starter198RepositoryError('starter_198_not_provisioned'); },
  });
  assert.equal(profile, 'advanced_customer');
});

test('fails closed when capability authority is unavailable or inconsistent', async () => {
  for (const code of ['starter_198_storage_unavailable', 'starter_198_access_integrity_violation']) {
    await assert.rejects(
      resolveServerProductProfile('tenant-a', {
        async access() { throw new Starter198RepositoryError(code); },
      }),
      (error: unknown) => error instanceof Starter198RepositoryError && error.code === code,
    );
  }
});
