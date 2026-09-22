import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getAccountPaths } from './paths.js';
import { AccountRegistry } from './registry.js';

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
    assert.equal((await registry.getAccount('claude_leased'))?.status, 'pending_login');
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
