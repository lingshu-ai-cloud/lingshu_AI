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
  assert.deepEqual(Object.keys(acquired), ['lease'], 'connector acquire returns only its own lease capability');
  assert.equal((await service.getAccount(first.id)).status, 'busy');
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
    service.localReleaseAccount({
      accountId: first.id, memberId: 'member_one', deviceId: 'member-one-mac',
    } as never),
    /lease id/i,
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
  await assert.rejects(
    service.localReleaseAccount({
      accountId: first.id, memberId: 'member_one', deviceId: 'member-one-mac',
    } as never),
    /lease id/i,
  );
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
  await assert.rejects(
    staleService.reassignAccountOwner(staleAccount.id, 'member_stale_target'),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'fresh_local_logout_required',
  );

  const emptySlotRoot = path.join(temporaryRoot, 'empty-slot-state-race');
  const emptySlotRegistry = new AccountRegistry({ dataDir: emptySlotRoot });
  const emptySlotState = new MemberAccountStateStore({ dataDir: emptySlotRoot });
  const emptySlotService = new AccountHubService({ registry: emptySlotRegistry, stateStore: emptySlotState });
  const emptySlot = await emptySlotService.createAccount({
    provider: 'codex', memberId: 'member_empty_slot', label: 'Empty slot',
  });
  await emptySlotState.report('member_empty_slot', {
    provider: 'codex', deviceId: 'empty-slot-mac', deviceLabel: 'Empty Slot Mac',
    state: 'authenticated', email: 'uncommitted-state@example.test',
  });
  assert.equal((await emptySlotRegistry.getAccount(emptySlot.id))?.email, undefined);
  assert.equal((await emptySlotRegistry.getAccount(emptySlot.id))?.status, 'pending_login');
  assert.equal((await emptySlotService.getAccount(emptySlot.id)).transferBlockedReason, 'local_logout_required');
  await assert.rejects(
    emptySlotService.reassignAccountOwner(emptySlot.id, 'member_empty_slot_target'),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'local_logout_required',
  );

  const transferRoot = path.join(temporaryRoot, 'owner-transfer');
  const transferRegistry = new AccountRegistry({ dataDir: transferRoot });
  const transferState = new MemberAccountStateStore({ dataDir: transferRoot });
  const transferService = new AccountHubService({ registry: transferRegistry, stateStore: transferState });
  const transferAccount = await transferService.createAccount({
    provider: 'codex', memberId: 'member_transfer_old', label: 'Transfer slot',
  });
  await transferService.reportMemberAccountState('member_transfer_old', {
    provider: 'codex', deviceId: 'transfer-old-mac', deviceLabel: 'Old member Mac',
    state: 'authenticated', email: 'transfer-old@example.test', plan: 'Pro', authMode: 'chatgpt',
  });
  const authenticatedTransfer = await transferService.getAccount(transferAccount.id);
  assert.equal(authenticatedTransfer.transferEligible, false);
  assert.equal(authenticatedTransfer.transferBlockedReason, 'local_logout_required');
  await assert.rejects(
    transferService.reassignAccountOwner(transferAccount.id, 'member_transfer_new'),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'local_logout_required',
  );

  const transferLease = await transferService.acquireAccount({
    accountId: transferAccount.id,
    memberId: 'member_transfer_old',
    deviceId: 'transfer-old-mac',
    deviceLabel: 'Old member Mac',
  });
  await transferService.reportMemberAccountState('member_transfer_old', {
    provider: 'codex', deviceId: 'transfer-old-mac', deviceLabel: 'Old member Mac',
    state: 'unauthenticated',
  });
  const loggedOutButLeased = await transferService.getAccount(transferAccount.id);
  assert.equal(loggedOutButLeased.transferBlockedReason, 'account_in_use');
  await assert.rejects(
    transferService.reassignAccountOwner(transferAccount.id, 'member_transfer_new'),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_in_use',
  );
  await transferService.localReleaseAccount({
    accountId: transferAccount.id,
    memberId: 'member_transfer_old',
    deviceId: 'transfer-old-mac',
    leaseId: transferLease.lease.leaseId,
  });

  await transferService.createAccount({
    provider: 'codex', memberId: 'member_transfer_conflict', label: 'Target conflict',
  });
  await assert.rejects(
    transferService.reassignAccountOwner(transferAccount.id, 'member_transfer_conflict'),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'member_provider_account_exists',
  );
  const moved = await transferService.reassignAccountOwner(transferAccount.id, 'member_transfer_new');
  assert.equal(moved.memberId, 'member_transfer_new');
  assert.equal(moved.status, 'pending');
  assert.equal(moved.plan, null);
  assert.equal(moved.localState, null);
  assert.equal(moved.transferEligible, false);
  assert.equal(moved.transferBlockedReason, 'fresh_local_logout_required');
  const movedRecord = await transferRegistry.getAccount(transferAccount.id);
  assert.equal(movedRecord?.email, undefined);
  assert.equal(movedRecord?.plan, undefined);
  assert.equal(movedRecord?.lastAuthenticatedAt, undefined);
  assert.equal(movedRecord?.lastUsedAt, undefined);
  assert.equal(movedRecord?.lastCheckedAt, undefined);
  await assert.rejects(
    transferService.reportMemberAccountState('member_transfer_old', {
      provider: 'codex', deviceId: 'transfer-old-mac', deviceLabel: 'Old member Mac',
      state: 'authenticated', email: 'transfer-old@example.test',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_not_bound',
  );
  await assert.rejects(
    transferService.reportMemberAccountState('member_transfer_new', {
      provider: 'codex', deviceId: 'transfer-new-mac', deviceLabel: 'New member Mac',
      state: 'authenticated', email: 'TRANSFER-OLD@example.test', plan: 'Must be rejected',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'provider_account_already_bound',
  );
  assert.equal(
    await transferState.get('member_transfer_new', 'codex'),
    undefined,
    'historically owned email is rejected before it can poison the new member snapshot',
  );
  await transferService.reportMemberAccountState('member_transfer_new', {
    provider: 'codex', deviceId: 'transfer-new-mac', deviceLabel: 'New member Mac',
    state: 'authenticated', email: 'transfer-new@example.test', plan: 'Business',
  });
  await transferService.reportMemberAccountState('member_transfer_new', {
    provider: 'codex', deviceId: 'transfer-new-mac', deviceLabel: 'New member Mac',
    state: 'unauthenticated',
  });
  const sameOwnerReset = await transferService.reassignAccountOwner(transferAccount.id, 'member_transfer_new');
  assert.equal(sameOwnerReset.memberId, 'member_transfer_new');
  assert.equal((await transferRegistry.getAccount(transferAccount.id))?.email, undefined);
  await transferService.reportMemberAccountState('member_transfer_new', {
    provider: 'codex', deviceId: 'transfer-new-mac', deviceLabel: 'New member Mac',
    state: 'authenticated', email: 'transfer-new@example.test', plan: 'Business',
  });
  assert.equal((await transferRegistry.getAccount(transferAccount.id))?.email, 'transfer-new@example.test');

  // Deterministic TOCTOU regression: the service observes a fresh logout, but
  // an authenticated report commits before the registry transfer transaction.
  // The transaction itself must reject and preserve the old owner/identity.
  const raceRoot = path.join(temporaryRoot, 'owner-transfer-race');
  const raceRegistry = new AccountRegistry({ dataDir: raceRoot });
  const raceState = new MemberAccountStateStore({ dataDir: raceRoot });
  const raceService = new AccountHubService({ registry: raceRegistry, stateStore: raceState });
  const raceAccount = await raceService.createAccount({
    provider: 'codex', memberId: 'member_race_old', label: 'Transfer race',
  });
  const raceAuthenticatedReport = {
    provider: 'codex' as const,
    deviceId: 'race-old-mac',
    deviceLabel: 'Race Old Mac',
    state: 'authenticated' as const,
    email: 'race-old@example.test',
    plan: 'Original plan',
  };
  await raceService.reportMemberAccountState('member_race_old', raceAuthenticatedReport);
  await raceService.reportMemberAccountState('member_race_old', {
    provider: 'codex', deviceId: 'race-old-mac', deviceLabel: 'Race Old Mac', state: 'unauthenticated',
  });

  let allowReassign!: () => void;
  const reassignGate = new Promise<void>(resolve => { allowReassign = resolve; });
  let reassignReachedRegistry!: () => void;
  const reassignAtRegistry = new Promise<void>(resolve => { reassignReachedRegistry = resolve; });
  const originalReassign = raceRegistry.reassignAccountOwner.bind(raceRegistry);
  raceRegistry.reassignAccountOwner = async input => {
    reassignReachedRegistry();
    await reassignGate;
    return originalReassign(input);
  };
  const transferAfterPrecheck = raceService.reassignAccountOwner(raceAccount.id, 'member_race_new');
  await reassignAtRegistry;
  await raceService.reportMemberAccountState('member_race_old', raceAuthenticatedReport);
  allowReassign();
  await assert.rejects(
    transferAfterPrecheck,
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'local_logout_required',
  );
  raceRegistry.reassignAccountOwner = originalReassign;
  const authWonRecord = await raceRegistry.getAccount(raceAccount.id);
  assert.equal(authWonRecord?.memberId, 'member_race_old');
  assert.equal(authWonRecord?.status, 'ready');
  assert.equal(authWonRecord?.email, 'race-old@example.test');
  assert.equal(authWonRecord?.plan, 'Original plan');

  // If reassignment commits first, a delayed old-owner connector report may
  // update only that old member's local snapshot; its registry CAS must fail.
  await raceService.reportMemberAccountState('member_race_old', {
    provider: 'codex', deviceId: 'race-old-mac', deviceLabel: 'Race Old Mac', state: 'unauthenticated',
  });
  let allowOldStateWrite!: () => void;
  const oldStateGate = new Promise<void>(resolve => { allowOldStateWrite = resolve; });
  let oldReportReachedStore!: () => void;
  const oldReportAtStore = new Promise<void>(resolve => { oldReportReachedStore = resolve; });
  const originalRaceStateReport = raceState.report.bind(raceState);
  raceState.report = async (memberId, report) => {
    oldReportReachedStore();
    await oldStateGate;
    return originalRaceStateReport(memberId, report);
  };
  const delayedOldHeartbeat = raceService.reportMemberAccountState('member_race_old', raceAuthenticatedReport);
  await oldReportAtStore;
  const raceMoved = await raceService.reassignAccountOwner(raceAccount.id, 'member_race_new');
  assert.equal(raceMoved.memberId, 'member_race_new');
  allowOldStateWrite();
  await assert.rejects(
    delayedOldHeartbeat,
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_not_bound',
  );
  const transferWonRecord = await raceRegistry.getAccount(raceAccount.id);
  assert.equal(transferWonRecord?.memberId, 'member_race_new');
  assert.equal(transferWonRecord?.status, 'pending_login');
  assert.equal(transferWonRecord?.email, undefined);

  const disableRaceRoot = path.join(temporaryRoot, 'disable-race');
  const disableRaceRegistry = new AccountRegistry({ dataDir: disableRaceRoot });
  const disableRaceState = new MemberAccountStateStore({ dataDir: disableRaceRoot });
  const disableRaceService = new AccountHubService({
    registry: disableRaceRegistry,
    stateStore: disableRaceState,
  });
  const disableRaceAccount = await disableRaceService.createAccount({
    provider: 'codex', memberId: 'member_disable_race', label: 'Disable race',
  });
  const baseReport = {
    provider: 'codex' as const,
    deviceId: 'disable-race-mac',
    deviceLabel: 'Disable Race Mac',
    state: 'authenticated' as const,
    email: 'disable-race@example.test',
    plan: 'Initial plan',
  };
  await disableRaceService.reportMemberAccountState('member_disable_race', baseReport);

  let allowStateWrite!: () => void;
  const stateWriteGate = new Promise<void>(resolve => { allowStateWrite = resolve; });
  let reportReachedStore!: () => void;
  const reportAtStore = new Promise<void>(resolve => { reportReachedStore = resolve; });
  const originalStateReport = disableRaceState.report.bind(disableRaceState);
  disableRaceState.report = async (memberId, report) => {
    reportReachedStore();
    await stateWriteGate;
    return originalStateReport(memberId, report);
  };
  const racingHeartbeat = disableRaceService.reportMemberAccountState('member_disable_race', {
    ...baseReport,
    plan: 'Must not reach disabled registry metadata',
  });
  await reportAtStore;
  const disabledResult = await disableRaceService.setAccountEnabled(disableRaceAccount.id, false);
  assert.equal(disabledResult.status, 'disabled');
  allowStateWrite();
  await assert.rejects(
    racingHeartbeat,
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_disabled',
  );
  const disabledRegistryRecord = await disableRaceRegistry.getAccount(disableRaceAccount.id);
  assert.equal(disabledRegistryRecord?.status, 'disabled');
  assert.equal(disabledRegistryRecord?.plan, 'Initial plan', 'late heartbeat metadata must not cross the disable boundary');
  assert.equal((await disableRaceRegistry.listLeases()).length, 0);

  disableRaceState.report = originalStateReport;
  await disableRaceService.setAccountEnabled(disableRaceAccount.id, true);
  await disableRaceService.reportMemberAccountState('member_disable_race', baseReport);
  const liveLease = await disableRaceService.acquireAccount({
    accountId: disableRaceAccount.id,
    memberId: 'member_disable_race',
    deviceId: 'disable-race-mac',
    deviceLabel: 'Disable Race Mac',
  });
  await assert.rejects(
    disableRaceService.setAccountEnabled(disableRaceAccount.id, false),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_in_use',
  );
  assert.equal((await disableRaceRegistry.getAccount(disableRaceAccount.id))?.status, 'ready');
  await disableRaceService.localReleaseAccount({
    accountId: disableRaceAccount.id,
    memberId: 'member_disable_race',
    deviceId: 'disable-race-mac',
    leaseId: liveLease.lease.leaseId,
  });
  await disableRaceService.setAccountEnabled(disableRaceAccount.id, false);
  await assert.rejects(
    disableRaceService.acquireAccount({
      accountId: disableRaceAccount.id,
      memberId: 'member_disable_race',
      deviceId: 'disable-race-mac',
      deviceLabel: 'Disable Race Mac',
    }),
    (error: unknown) => error instanceof AccountHubServiceError && error.code === 'account_disabled',
  );
  assert.equal((await disableRaceRegistry.listLeases()).length, 0);
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log('account hub member-local service tests passed');
