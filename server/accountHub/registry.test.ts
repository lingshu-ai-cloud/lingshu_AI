import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getAccountPaths } from './paths.js';
import {
  AccountBindingChangedError,
  AccountDisabledError,
  AccountLeaseConflictError,
  AccountNotReadyError,
  AccountReassignmentStateError,
  AccountRegistry,
} from './registry.js';

function temporaryDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'account-hub-test-'));
}

test('persists concurrent mutations atomically with private permissions', async () => {
  const dataDir = temporaryDataDir();
  try {
    const registry = new AccountRegistry({ dataDir });
    await Promise.all(Array.from({ length: 12 }, (_, index) => registry.createAccount({
      id: `codex_${index}`,
      provider: 'codex',
      memberId: `member_${index}`,
      label: `Codex ${index}`,
    })));

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8')) as {
      accounts: Record<string, unknown>;
    };
    assert.equal(Object.keys(persisted.accounts).length, 12);
    assert.equal(fs.statSync(path.join(dataDir, 'registry.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), []);

    const reopened = new AccountRegistry({ dataDir });
    assert.equal((await reopened.listAccounts()).length, 12);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects credential-shaped and unknown fields before writing JSON', async () => {
  const dataDir = temporaryDataDir();
  try {
    const registry = new AccountRegistry({ dataDir });
    await assert.rejects(
      registry.createAccount({ provider: 'claude', memberId: 'member_one', label: 'Claude', refreshToken: 'raw-secret' } as never),
      /Credential material is forbidden/i,
    );
    await assert.rejects(
      registry.createAccount({ provider: 'claude', memberId: 'member_one', label: 'Claude', notes: 'unexpected' } as never),
      /Unsupported account input field/i,
    );
    await assert.rejects(
      registry.createAccount({ provider: 'claude', memberId: 'member_one', label: 'cookie=session=abc' }),
      /Credential material is forbidden/i,
    );
    assert.equal(fs.existsSync(path.join(dataDir, 'registry.json')), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('resolves legacy profile locations without creating server credential directories', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = getAccountPaths('codex_one', dataDir);
    const second = getAccountPaths('claude_two', dataDir);
    assert.notEqual(first.accountRoot, second.accountRoot);
    assert.equal(fs.existsSync(first.profileDir), false);
    assert.throws(() => getAccountPaths('../escape', dataDir), /Invalid account id/);
    assert.throws(() => getAccountPaths('nested/account', dataDir), /Invalid account id/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('updates status and removes an account', async () => {
  const dataDir = temporaryDataDir();
  let tick = 0;
  const registry = new AccountRegistry({
    dataDir,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
  });
  try {
    await registry.createAccount({
      id: 'claude_primary',
      provider: 'claude',
      memberId: 'member_primary',
      label: 'Claude Primary',
    });
    const updated = await registry.updateAccountStatus('claude_primary', 'ready');
    assert.equal(updated.status, 'ready');
    assert.equal(updated.statusReason, undefined);
    assert.notEqual(updated.updatedAt, updated.createdAt);

    const metadata = await registry.updateAccountMetadata('claude_primary', {
      email: 'owner@example.com',
      plan: 'Max',
      lastCheckedAt: '2026-01-01T00:00:03.000Z',
    });
    assert.equal(metadata.email, 'owner@example.com');
    assert.equal(metadata.plan, 'Max');
    await assert.rejects(
      registry.updateAccountMetadata('claude_primary', { accessToken: 'secret' } as never),
      /Credential material is forbidden/i,
    );
    await assert.rejects(
      registry.updateAccountMetadata('claude_primary', { email: 'not-an-email' }),
      /Invalid email/,
    );
    await assert.rejects(
      registry.updateAccountMetadata('claude_primary', { plan: 'refresh_token=opaque-value' }),
      /Credential material is forbidden/i,
    );
    assert.doesNotMatch(fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8'), /opaque-value/);

    assert.equal(await registry.deleteAccount('claude_primary'), true);
    assert.equal(await registry.getAccount('claude_primary'), undefined);
    assert.equal(await registry.deleteAccount('claude_primary'), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('loads owner-less prototype accounts and requires explicit one-time assignment', async () => {
  const dataDir = temporaryDataDir();
  try {
    fs.writeFileSync(path.join(dataDir, 'registry.json'), JSON.stringify({
      schemaVersion: 1,
      accounts: {
        codex_legacy: {
          id: 'codex_legacy', provider: 'codex', label: 'Legacy Codex', status: 'ready',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      tasks: {},
    }));
    const registry = new AccountRegistry({ dataDir });
    assert.match((await registry.getAccount('codex_legacy'))?.memberId || '', /^legacy_unassigned:/);
    assert.equal(
      (await registry.assignLegacyAccountMember('codex_legacy', 'member_owner')).memberId,
      'member_owner',
    );
    await assert.rejects(
      registry.assignLegacyAccountMember('codex_legacy', 'member_other'),
      /owner is immutable/i,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('enforces one account per member and provider across concurrent registry instances', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    const attempts = await Promise.allSettled([
      first.createAccount({ id: 'codex_first', provider: 'codex', memberId: 'member_owner', label: 'First' }),
      second.createAccount({ id: 'codex_second', provider: 'codex', memberId: 'member_owner', label: 'Second' }),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await first.listAccounts()).length, 1);
    assert.equal((await first.getAccountForMember('member_owner', 'codex'))?.memberId, 'member_owner');

    await first.createAccount({
      id: 'claude_same_owner',
      provider: 'claude',
      memberId: 'member_owner',
      label: 'Claude',
    });
    assert.equal((await first.listAccounts()).length, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('atomically binds one immutable Provider identity under concurrent first reports', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    await first.createAccount({
      id: 'codex_identity', provider: 'codex', memberId: 'member_identity', label: 'Identity',
    });
    const attempts = await Promise.allSettled([
      first.bindProviderIdentity('codex_identity', 'first@example.test'),
      second.bindProviderIdentity('codex_identity', 'second@example.test'),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected').length, 1);
    const stored = await first.getAccount('codex_identity');
    assert.ok(['first@example.test', 'second@example.test'].includes(stored?.email || ''));

    await first.createAccount({
      id: 'codex_other_identity', provider: 'codex', memberId: 'member_other_identity', label: 'Other',
    });
    await assert.rejects(
      first.bindProviderIdentity('codex_other_identity', stored!.email!),
      /provider_account_already_bound/,
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('keeps hashed Provider identity ownership after reassignment and deletion', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    await first.createAccount({
      id: 'codex_claimed', provider: 'codex', memberId: 'member_claim_owner', label: 'Claimed',
    });
    await first.bindProviderIdentity('codex_claimed', 'historical-owner@example.test');
    await first.updateAccountStatus('codex_claimed', 'pending_login', 'login_required');
    const before = await first.getAccount('codex_claimed');
    await first.reassignAccountOwner({
      accountId: 'codex_claimed',
      targetMemberId: 'member_claim_target',
      expectedMemberId: 'member_claim_owner',
      expectedBindingGeneration: before!.bindingGeneration,
    });
    await assert.rejects(
      second.bindProviderIdentity('codex_claimed', 'HISTORICAL-OWNER@example.test'),
      /provider_account_already_bound/,
      'a slot transfer must not transfer the old member Provider identity',
    );
    await second.bindProviderIdentity('codex_claimed', 'target-owner@example.test');
    await second.updateAccountStatus('codex_claimed', 'pending_login', 'login_required');
    const targetBeforeReset = await second.getAccount('codex_claimed');
    await second.reassignAccountOwner({
      accountId: 'codex_claimed',
      targetMemberId: 'member_claim_target',
      expectedMemberId: 'member_claim_target',
      expectedBindingGeneration: targetBeforeReset!.bindingGeneration,
    });
    await second.bindProviderIdentity('codex_claimed', 'target-owner@example.test');
    assert.equal((await second.getAccount('codex_claimed'))?.email, 'target-owner@example.test');

    await second.deleteAccount('codex_claimed');
    await first.createAccount({
      id: 'codex_after_delete', provider: 'codex', memberId: 'member_after_delete', label: 'After delete',
    });
    await assert.rejects(
      first.bindProviderIdentity('codex_after_delete', 'target-owner@example.test'),
      /provider_account_already_bound/,
      'deleting the slot must not erase historical identity ownership',
    );

    await first.createAccount({
      id: 'codex_claim_race_one', provider: 'codex', memberId: 'member_claim_race_one', label: 'Race one',
    });
    await first.createAccount({
      id: 'codex_claim_race_two', provider: 'codex', memberId: 'member_claim_race_two', label: 'Race two',
    });
    const raced = await Promise.allSettled([
      first.bindProviderIdentity('codex_claim_race_one', 'race-identity@example.test'),
      second.bindProviderIdentity('codex_claim_race_two', 'RACE-IDENTITY@example.test'),
    ]);
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(raced.filter(result => result.status === 'rejected').length, 1);

    const persisted = fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8');
    const document = JSON.parse(persisted) as { identityClaims: Record<string, Record<string, unknown>> };
    assert.ok(Object.keys(document.identityClaims).every(key => /^[a-f0-9]{64}$/.test(key)));
    assert.doesNotMatch(persisted, /historical-owner@example\.test/i, 'released identity is stored only as a hash');
    assert.ok(Object.values(document.identityClaims).every(claim => !Object.hasOwn(claim, 'email')));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('upgrades schema-v1 email bindings into durable hashed claims', async () => {
  const dataDir = temporaryDataDir();
  try {
    fs.writeFileSync(path.join(dataDir, 'registry.json'), JSON.stringify({
      schemaVersion: 1,
      accounts: {
        codex_v1_claim: {
          id: 'codex_v1_claim', provider: 'codex', memberId: 'member_v1_owner', label: 'V1',
          status: 'pending_login', email: 'v1-owner@example.test',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      tasks: {}, leases: {},
    }), { mode: 0o600 });
    const registry = new AccountRegistry({ dataDir });
    await registry.deleteAccount('codex_v1_claim');
    await registry.createAccount({
      id: 'codex_v1_new_slot', provider: 'codex', memberId: 'member_v1_other', label: 'New slot',
    });
    await assert.rejects(
      registry.bindProviderIdentity('codex_v1_new_slot', 'V1-OWNER@example.test'),
      /provider_account_already_bound/,
    );
    const persisted = fs.readFileSync(path.join(dataDir, 'registry.json'), 'utf8');
    assert.doesNotMatch(persisted, /v1-owner@example\.test/i);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('reassigns only the hub slot and atomically clears all Provider identity metadata', async () => {
  const dataDir = temporaryDataDir();
  try {
    const registry = new AccountRegistry({ dataDir });
    await registry.createAccount({
      id: 'codex_reassign', provider: 'codex', memberId: 'member_old', label: 'Reassign',
    });
    await registry.bindProviderIdentity('codex_reassign', 'old-provider@example.test');
    await registry.updateAccountMetadata('codex_reassign', {
      plan: 'Pro',
      lastCheckedAt: '2026-09-23T00:00:00.000Z',
      lastAuthenticatedAt: '2026-09-23T00:00:00.000Z',
      lastUsedAt: '2026-09-23T00:00:00.000Z',
    });
    await registry.updateAccountStatus('codex_reassign', 'ready');
    // A fresh member-local unauthenticated report moves the slot back to
    // pending_login before the administrator may reset or transfer it.
    await registry.updateAccountStatus('codex_reassign', 'pending_login', 'login_required');
    const before = await registry.getAccount('codex_reassign');
    const reassigned = await registry.reassignAccountOwner({
      accountId: 'codex_reassign',
      targetMemberId: 'member_new',
      expectedMemberId: 'member_old',
      expectedBindingGeneration: before!.bindingGeneration,
    });
    assert.equal(reassigned.memberId, 'member_new');
    assert.equal(reassigned.bindingGeneration, before!.bindingGeneration + 1);
    assert.equal(reassigned.status, 'pending_login');
    assert.equal(reassigned.statusReason, 'login_required');
    for (const field of ['email', 'plan', 'lastCheckedAt', 'lastAuthenticatedAt', 'lastUsedAt'] as const) {
      assert.equal(reassigned[field], undefined, `${field} must not transfer to the new member`);
    }

    const sameOwnerReset = await registry.reassignAccountOwner({
      accountId: 'codex_reassign',
      targetMemberId: 'member_new',
      expectedMemberId: 'member_new',
      expectedBindingGeneration: reassigned.bindingGeneration,
    });
    assert.equal(sameOwnerReset.bindingGeneration, reassigned.bindingGeneration + 1);

    await registry.createAccount({
      id: 'codex_target_conflict', provider: 'codex', memberId: 'member_conflict', label: 'Conflict',
    });
    await assert.rejects(registry.reassignAccountOwner({
      accountId: 'codex_reassign',
      targetMemberId: 'member_conflict',
      expectedMemberId: 'member_new',
      expectedBindingGeneration: sameOwnerReset.bindingGeneration,
    }), /Member already has a codex account/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('owner reassignment and authenticated heartbeats serialize without reviving an old identity', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    await first.createAccount({
      id: 'codex_reassign_race', provider: 'codex', memberId: 'member_old_race', label: 'Race',
    });
    await first.bindProviderIdentity('codex_reassign_race', 'old-race@example.test');
    const before = await first.getAccount('codex_reassign_race');

    const race = await Promise.allSettled([
      first.reassignAccountOwner({
        accountId: 'codex_reassign_race',
        targetMemberId: 'member_new_race',
        expectedMemberId: 'member_old_race',
        expectedBindingGeneration: before!.bindingGeneration,
      }),
      second.applyConnectorState('codex_reassign_race', {
        expectedMemberId: 'member_old_race',
        expectedBindingGeneration: before!.bindingGeneration,
        status: 'ready',
        metadata: {
          email: 'old-race@example.test',
          plan: 'Old identity must not survive',
          lastCheckedAt: '2026-09-23T00:00:00.000Z',
        },
      }),
    ]);
    const final = await first.getAccount('codex_reassign_race');
    if (race[0]?.status === 'fulfilled') {
      assert.equal(race[1]?.status, 'rejected');
      assert.equal(race[1]?.status === 'rejected' && race[1].reason instanceof AccountBindingChangedError, true);
      assert.equal(final?.memberId, 'member_new_race');
      assert.equal(final?.status, 'pending_login');
      assert.equal(final?.email, undefined);
      assert.equal(final?.plan, undefined);
    } else {
      assert.equal(race[0]?.reason instanceof AccountReassignmentStateError, true);
      assert.equal(race[1]?.status, 'fulfilled');
      assert.equal(final?.memberId, 'member_old_race');
      assert.equal(final?.status, 'ready');
      assert.equal(final?.email, 'old-race@example.test');
      assert.equal(final?.plan, 'Old identity must not survive');
    }

    // Deterministic regression: even after the service observed a fresh local
    // logout, an authenticated heartbeat that commits first must close the
    // transfer window inside the registry's own lock.
    await first.createAccount({
      id: 'codex_auth_first', provider: 'codex', memberId: 'member_auth_first', label: 'Auth first',
    });
    await first.bindProviderIdentity('codex_auth_first', 'auth-first@example.test');
    const authFirstBefore = await first.getAccount('codex_auth_first');
    await second.applyConnectorState('codex_auth_first', {
      expectedMemberId: 'member_auth_first',
      expectedBindingGeneration: authFirstBefore!.bindingGeneration,
      status: 'ready',
      metadata: {
        email: 'auth-first@example.test',
        plan: 'Original provider identity',
        lastCheckedAt: '2026-09-23T00:01:00.000Z',
      },
    });
    await assert.rejects(first.reassignAccountOwner({
      accountId: 'codex_auth_first',
      targetMemberId: 'member_auth_target',
      expectedMemberId: 'member_auth_first',
      expectedBindingGeneration: authFirstBefore!.bindingGeneration,
    }), AccountReassignmentStateError);
    const authFirstFinal = await first.getAccount('codex_auth_first');
    assert.equal(authFirstFinal?.memberId, 'member_auth_first');
    assert.equal(authFirstFinal?.bindingGeneration, authFirstBefore?.bindingGeneration);
    assert.equal(authFirstFinal?.status, 'ready');
    assert.equal(authFirstFinal?.email, 'auth-first@example.test');
    assert.equal(authFirstFinal?.plan, 'Original provider identity');

    await first.createAccount({
      id: 'codex_reassign_leased', provider: 'codex', memberId: 'member_leased', label: 'Leased',
    });
    await first.updateAccountStatus('codex_reassign_leased', 'ready');
    const lease = await first.acquireLease({
      accountId: 'codex_reassign_leased',
      holderMemberId: 'member_leased',
      deviceId: 'member_leased_device',
      deviceLabel: 'Leased member device',
    });
    // A logout heartbeat may move the record to pending while work drains;
    // reassignment must still wait for the durable lease to be released.
    await first.updateAccountStatus('codex_reassign_leased', 'pending_login', 'login_required');
    const leasedBefore = await first.getAccount('codex_reassign_leased');
    await assert.rejects(first.reassignAccountOwner({
      accountId: 'codex_reassign_leased',
      targetMemberId: 'member_third',
      expectedMemberId: 'member_leased',
      expectedBindingGeneration: leasedBefore!.bindingGeneration,
    }), AccountLeaseConflictError);
    assert.equal((await first.getAccount('codex_reassign_leased'))?.memberId, 'member_leased');
    assert.equal((await first.listLeases())[0]?.leaseId, lease.leaseId);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('connector heartbeats cannot revive or mutate a disabled account', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    await first.createAccount({
      id: 'codex_disabled_heartbeat',
      provider: 'codex',
      memberId: 'member_disabled_heartbeat',
      label: 'Disabled heartbeat',
    });
    await first.updateAccountStatus('codex_disabled_heartbeat', 'ready');

    const race = await Promise.allSettled([
      first.applyConnectorState('codex_disabled_heartbeat', {
        expectedMemberId: 'member_disabled_heartbeat',
        expectedBindingGeneration: 0,
        status: 'ready',
        metadata: {
          email: 'heartbeat@example.test',
          plan: 'Before disable',
          lastCheckedAt: '2026-09-23T00:00:00.000Z',
        },
      }),
      second.setAccountEnabled('codex_disabled_heartbeat', false),
    ]);
    assert.equal(race[1]?.status, 'fulfilled', 'disable without a live lease must always commit');
    const disabled = await first.getAccount('codex_disabled_heartbeat');
    assert.equal(disabled?.status, 'disabled');
    assert.equal(disabled?.statusReason, 'operator_disabled');

    await assert.rejects(first.applyConnectorState('codex_disabled_heartbeat', {
      expectedMemberId: 'member_disabled_heartbeat',
      expectedBindingGeneration: 0,
      status: 'ready',
      metadata: {
        email: disabled?.email ?? 'after-disable@example.test',
        plan: 'Must not be stored',
        lastCheckedAt: '2026-09-23T00:01:00.000Z',
      },
    }), AccountDisabledError);
    await assert.rejects(
      first.updateAccountStatus('codex_disabled_heartbeat', 'ready'),
      AccountDisabledError,
    );
    assert.deepEqual(await first.getAccount('codex_disabled_heartbeat'), disabled);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('disable and lease acquisition are one atomic decision with no disabled-plus-lease outcome', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    await first.createAccount({
      id: 'codex_disable_race',
      provider: 'codex',
      memberId: 'member_disable_race',
      label: 'Disable race',
    });
    await first.updateAccountStatus('codex_disable_race', 'ready');

    const race = await Promise.allSettled([
      first.acquireLease({
        accountId: 'codex_disable_race',
        holderMemberId: 'member_disable_race',
        deviceId: 'race_device',
        deviceLabel: 'Race device',
      }),
      second.setAccountEnabled('codex_disable_race', false),
    ]);
    const racedAccount = await first.getAccount('codex_disable_race');
    const racedLeases = await first.listLeases();
    if (racedAccount?.status === 'disabled') {
      assert.equal(racedLeases.length, 0);
      assert.equal(race[0]?.status, 'rejected');
      assert.equal(race[1]?.status, 'fulfilled');
    } else {
      assert.equal(racedAccount?.status, 'ready');
      assert.equal(racedLeases.length, 1);
      assert.equal(race[0]?.status, 'fulfilled');
      assert.equal(race[1]?.status, 'rejected');
      assert.equal(race[1].status === 'rejected' && race[1].reason instanceof AccountLeaseConflictError, true);
    }

    await first.forceReleaseLease('codex_disable_race');
    if ((await first.getAccount('codex_disable_race'))?.status === 'disabled') {
      await first.setAccountEnabled('codex_disable_race', true);
      await first.updateAccountStatus('codex_disable_race', 'ready');
    }
    await first.acquireLease({
      accountId: 'codex_disable_race',
      holderMemberId: 'member_disable_race',
      deviceId: 'active_device',
      deviceLabel: 'Active device',
    });
    await assert.rejects(second.setAccountEnabled('codex_disable_race', false), AccountLeaseConflictError);
    assert.equal((await first.getAccount('codex_disable_race'))?.status, 'ready');
    assert.equal((await first.listLeases()).length, 1);

    await first.forceReleaseLease('codex_disable_race');
    await first.setAccountEnabled('codex_disable_race', false);
    await assert.rejects(first.acquireLease({
      accountId: 'codex_disable_race',
      holderMemberId: 'member_disable_race',
      deviceId: 'late_device',
      deviceLabel: 'Late device',
    }), AccountDisabledError);
    assert.equal((await first.getAccount('codex_disable_race'))?.status, 'disabled');
    assert.equal((await first.listLeases()).length, 0, 'a successful disable admits no later lease');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lease acquisition validates readiness again inside the registry transaction', async () => {
  const dataDir = temporaryDataDir();
  try {
    const registry = new AccountRegistry({ dataDir });
    await registry.createAccount({
      id: 'codex_not_ready',
      provider: 'codex',
      memberId: 'member_not_ready',
      label: 'Not ready',
    });
    await assert.rejects(registry.acquireLease({
      accountId: 'codex_not_ready',
      holderMemberId: 'member_not_ready',
      deviceId: 'not_ready_device',
      deviceLabel: 'Not ready device',
    }), AccountNotReadyError);
    await registry.updateAccountStatus('codex_not_ready', 'error', 'provider_unavailable');
    await assert.rejects(registry.acquireLease({
      accountId: 'codex_not_ready',
      holderMemberId: 'member_not_ready',
      deviceId: 'not_ready_device',
      deviceLabel: 'Not ready device',
    }), AccountNotReadyError);
    assert.equal((await registry.listLeases()).length, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('persists one exclusive lease and lets the same member/device renew it', async () => {
  const dataDir = temporaryDataDir();
  let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
  const now = () => new Date(nowMs);
  try {
    const first = new AccountRegistry({ dataDir, now });
    const second = new AccountRegistry({ dataDir, now });
    await first.createAccount({
      id: 'codex_leased',
      provider: 'codex',
      memberId: 'member_lease',
      label: 'Codex Leased',
    });
    await first.updateAccountStatus('codex_leased', 'ready');

    const lease = await first.acquireLease({
      accountId: 'codex_leased',
      holderMemberId: 'member_lease',
      deviceId: 'device_a',
      deviceLabel: 'Office Mac',
      ttlMs: 5_000,
    });
    nowMs += 1_000;
    const renewed = await second.acquireLease({
      accountId: 'codex_leased',
      holderMemberId: 'member_lease',
      deviceId: 'device_a',
      deviceLabel: 'Office Mac renamed',
      leaseId: lease.leaseId,
      ttlMs: 5_000,
    });
    assert.equal(renewed.leaseId, lease.leaseId);
    assert.equal(renewed.acquiredAt, lease.acquiredAt);
    assert.notEqual(renewed.renewedAt, lease.renewedAt);
    assert.equal(renewed.deviceLabel, 'Office Mac renamed');
    await assert.rejects(first.acquireLease({
      accountId: 'codex_leased',
      holderMemberId: 'member_lease',
      deviceId: 'device_a',
      deviceLabel: 'Copied config on another machine',
    }), /already in use/i);
    await assert.rejects(first.acquireLease({
      accountId: 'codex_leased',
      holderMemberId: 'member_lease',
      deviceId: 'device_b',
      deviceLabel: 'Laptop',
    }), /already in use/i);
    await assert.rejects(first.acquireLease({
      accountId: 'codex_leased',
      holderMemberId: 'another_member',
      deviceId: 'device_c',
      deviceLabel: 'Unknown',
    }), /Only the account owner/i);

    const reopened = new AccountRegistry({ dataDir, now });
    assert.equal((await reopened.listLeases())[0]?.leaseId, lease.leaseId);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('serializes simultaneous lease acquisition across registry instances', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new AccountRegistry({ dataDir });
    const second = new AccountRegistry({ dataDir });
    await first.createAccount({
      id: 'codex_contended',
      provider: 'codex',
      memberId: 'member_contended',
      label: 'Codex Contended',
    });
    await first.updateAccountStatus('codex_contended', 'ready');
    const results = await Promise.allSettled([
      first.acquireLease({
        accountId: 'codex_contended',
        holderMemberId: 'member_contended',
        deviceId: 'device_one',
        deviceLabel: 'Device one',
      }),
      second.acquireLease({
        accountId: 'codex_contended',
        holderMemberId: 'member_contended',
        deviceId: 'device_two',
        deviceLabel: 'Device two',
      }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.equal((await first.listLeases()).length, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('expires, reaps, and locally releases leases without creating server authorization directories', async () => {
  const dataDir = temporaryDataDir();
  let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
  const registry = new AccountRegistry({ dataDir, now: () => new Date(nowMs) });
  try {
    await registry.createAccount({
      id: 'claude_leased',
      provider: 'claude',
      memberId: 'member_claude',
      label: 'Claude Leased',
    });
    await registry.updateAccountStatus('claude_leased', 'ready');
    const paths = getAccountPaths('claude_leased', dataDir);
    const first = await registry.acquireLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_old',
      deviceLabel: 'Old device',
      ttlMs: 1_000,
    });
    nowMs += 1_001;
    const replacement = await registry.acquireLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_new',
      deviceLabel: 'New device',
      ttlMs: 1_000,
    });
    assert.notEqual(replacement.leaseId, first.leaseId);
    await assert.rejects(registry.releaseLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_new',
    } as never), /lease id/i, 'a missing capability cannot release a newly acquired lease');
    assert.equal((await registry.listLeases())[0]?.leaseId, replacement.leaseId);
    await assert.rejects(registry.releaseLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_old',
      leaseId: first.leaseId,
    }), /already in use/i);
    assert.equal(await registry.releaseLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_new',
      leaseId: replacement.leaseId,
    }), true);
    assert.equal((await registry.listLeases()).length, 0);
    await assert.rejects(registry.releaseLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_new',
    } as never), /lease id/i, 'a missing capability is rejected even when no lease exists');
    assert.equal((await registry.getAccount('claude_leased'))?.status, 'ready');
    assert.equal(fs.existsSync(paths.profileDir), false);

    await registry.acquireLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_new',
      deviceLabel: 'New device',
      ttlMs: 1_000,
    });
    nowMs += 1_001;
    assert.equal((await registry.listLeases()).length, 1);
    assert.equal((await registry.reapExpiredLeases()).length, 1);
    assert.equal((await registry.listLeases()).length, 0);

    await registry.acquireLease({
      accountId: 'claude_leased',
      holderMemberId: 'member_claude',
      deviceId: 'device_admin_released',
      deviceLabel: 'Admin release test',
    });
    assert.equal(await registry.forceReleaseLease('claude_leased'), true);
    assert.equal((await registry.listLeases()).length, 0);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
