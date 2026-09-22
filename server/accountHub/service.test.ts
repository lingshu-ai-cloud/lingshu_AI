import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getAccountPaths } from './paths.js';
import { AccountRegistry } from './registry.js';
import { AccountHubService, AccountHubServiceError } from './service.js';
import { MemberAccountStateStore } from './memberAccountState.js';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-account-hub-service-'));
try {
  const registry = new AccountRegistry({ dataDir: temporaryRoot });
  const service = new AccountHubService({
    registry,
    stateStore: new MemberAccountStateStore({ dataDir: temporaryRoot }),
  });

  for (const forbidden of ['createTask', 'runTask', 'checkAccount', 'getAccountUsage', 'startAuthorization', 'revokeAccount']) {
    assert.equal(forbidden in service, false, `${forbidden} must not be a server-side account capability`);
  }

  const first = await service.createAccount({
    provider: 'codex', memberId: 'member_one', label: 'Member One Codex',
  });
  const second = await service.createAccount({
    provider: 'codex', memberId: 'member_two', label: 'Member Two Codex',
  });
  assert.equal(first.localState, null);
  assert.equal(first.legacyManagedProfilePresent, false);

  const reported = await service.reportMemberAccountState('member_one', {
    provider: 'codex',
    deviceId: 'member-one-mac',
    deviceLabel: 'Member One Mac',
    state: 'authenticated',
    email: 'owner@example.test',
    plan: 'Pro',
    authMode: 'chatgpt',
    usage: {
      available: true,
      primary: { usedPercent: 25, remainingPercent: 75 },
      secondary: null,
      creditsRemaining: 10,
      checkedAt: '2026-09-22T08:00:00.000Z',
    },
  });
  assert.equal(reported.accepted, true);
  assert.equal(reported.localState.email, 'owner@example.test');
  assert.equal(reported.localState.usage?.primary?.remainingPercent, 75);
  assert.equal((await service.getAccount(first.id)).status, 'ready');
  await assert.rejects(
    service.reportMemberAccountState('member_one', {
      provider: 'codex', deviceId: 'member-one-mac', deviceLabel: 'Member One Mac',
      state: 'authenticated', email: 'different@example.test',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'provider_identity_changed',
  );

  await assert.rejects(
    service.reportMemberAccountState('member_two', {
      provider: 'codex', deviceId: 'member-two-mac', deviceLabel: 'Member Two Mac',
      state: 'authenticated', email: 'OWNER@example.test',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'provider_account_already_bound',
  );
  await service.reportMemberAccountState('member_two', {
    provider: 'codex', deviceId: 'member-two-mac', deviceLabel: 'Member Two Mac',
    state: 'authenticated', email: 'second@example.test',
  });

  await assert.rejects(
    service.reportMemberAccountState('member_three', {
      provider: 'codex', deviceId: 'member-three-mac', deviceLabel: 'Unknown Mac', state: 'authenticated',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_not_bound',
  );

  await assert.rejects(
    service.acquireAccount({
      accountId: first.id, memberId: 'member_two', deviceId: 'wrong-device', deviceLabel: 'Wrong device',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_member_mismatch',
  );
  await assert.rejects(
    service.acquireAccount({
      accountId: first.id, memberId: 'member_one', deviceId: 'unreported-device', deviceLabel: 'New device',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'reauthorization_required',
  );
  const acquired = await service.acquireAccount({
    accountId: first.id, memberId: 'member_one', deviceId: 'member-one-mac', deviceLabel: 'Member One Mac',
  });
  assert.equal(acquired.account.status, 'busy');
  assert.equal(acquired.account.leaseId, acquired.lease.leaseId);
  await assert.rejects(
    service.acquireAccount({
      accountId: first.id, memberId: 'member_one', deviceId: 'member-one-mac', deviceLabel: 'Copied config',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_lease_held',
  );
  const renewed = await service.acquireAccount({
    accountId: first.id,
    memberId: 'member_one',
    deviceId: 'member-one-mac',
    deviceLabel: 'Member One Mac',
    leaseId: acquired.lease.leaseId,
  });
  assert.equal(renewed.lease.leaseId, acquired.lease.leaseId);

  await assert.rejects(
    service.localReleaseAccount({ accountId: first.id, memberId: 'member_one', deviceId: 'member-one-mac' }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_lease_not_owned',
  );
  await assert.rejects(
    service.localReleaseAccount({
      accountId: first.id, memberId: 'member_one', deviceId: 'member-one-mac', leaseId: 'lease_stale',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_lease_not_owned',
  );
  const released = await service.localReleaseAccount({
    accountId: first.id,
    memberId: 'member_one',
    deviceId: 'member-one-mac',
    leaseId: acquired.lease.leaseId,
  });
  assert.equal(released.released, true);
  const afterRelease = await service.getAccount(first.id);
  assert.equal(afterRelease.status, 'ready');
  assert.equal(afterRelease.localState?.state, 'authenticated', 'release preserves member-local auth state');

  const profile = getAccountPaths(first.id, temporaryRoot).profileDir;
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(profile, 'auth.json'), '{"legacy":"credential-marker"}', { mode: 0o600 });
  const legacyBlocked = await service.getAccount(first.id);
  assert.equal(legacyBlocked.legacyManagedProfilePresent, true);
  assert.equal(legacyBlocked.status, 'unavailable');
  await assert.rejects(
    service.reportMemberAccountState('member_one', {
      provider: 'codex', deviceId: 'member-one-mac', deviceLabel: 'Member One Mac',
      state: 'authenticated', email: 'owner@example.test',
    }),
    (error: unknown) => error instanceof AccountHubServiceError
      && error.code === 'legacy_managed_profile_cleanup_required',
  );

  assert.equal((await service.setAccountEnabled(first.id, false)).enabled, false);
  assert.equal((await service.setAccountEnabled(first.id, true)).status, 'unavailable');

  assert.equal(second.memberId, 'member_two');

  let staleNow = Date.parse('2026-09-23T00:00:00.000Z');
  const staleRoot = path.join(temporaryRoot, 'stale-snapshot');
  const staleRegistry = new AccountRegistry({ dataDir: staleRoot, now: () => new Date(staleNow) });
  const staleService = new AccountHubService({
    registry: staleRegistry,
    stateStore: new MemberAccountStateStore({ dataDir: staleRoot, now: () => new Date(staleNow) }),
    now: () => new Date(staleNow),
  });
  const staleAccount = await staleService.createAccount({
    provider: 'codex', memberId: 'member_stale', label: 'Stale snapshot',
  });
  await staleService.reportMemberAccountState('member_stale', {
    provider: 'codex', deviceId: 'stale-mac', deviceLabel: 'Stale Mac',
    state: 'authenticated', email: 'stale@example.test',
  });
  staleNow += 6 * 60_000 + 1;
  await assert.rejects(
    staleService.acquireAccount({
      accountId: staleAccount.id, memberId: 'member_stale', deviceId: 'stale-mac', deviceLabel: 'Stale Mac',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'reauthorization_required',
  );
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log('account hub member-local service tests passed');
