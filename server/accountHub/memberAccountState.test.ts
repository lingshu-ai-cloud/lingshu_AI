import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MemberAccountEmailConflictError,
  MemberAccountStateStore,
} from './memberAccountState.js';

function temporaryDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'member-account-state-test-'));
}

const codexReport = {
  provider: 'codex' as const,
  deviceId: 'macbook_pro',
  deviceLabel: 'Jiejie MacBook',
  state: 'authenticated' as const,
  email: 'Owner@Example.com',
  plan: 'Pro',
  authMode: 'chatgpt',
  usage: {
    available: true,
    primary: {
      usedPercent: 28,
      remainingPercent: 72,
      resetsAt: '2026-09-23T00:00:00.000Z',
      windowDurationMins: 300,
    },
    secondary: null,
    creditsRemaining: 120,
    checkedAt: '2026-09-22T08:00:00.000Z',
  },
};

test('reports, normalizes, persists, and lists credential-free account snapshots', async () => {
  const dataDir = temporaryDataDir();
  let nowMs = Date.parse('2026-09-22T08:01:00.000Z');
  try {
    const store = new MemberAccountStateStore({ dataDir, now: () => new Date(nowMs) });
    const snapshot = await store.report('member_one', codexReport);
    assert.equal(snapshot.reportedAt, '2026-09-22T08:01:00.000Z');
    assert.equal(snapshot.usage?.primary?.remainingPercent, 72);
    assert.equal(snapshot.usage?.reason, null);
    assert.equal(snapshot.usage?.secondary, null);

    nowMs += 60_000;
    const updated = await store.report('member_one', {
      ...codexReport,
      deviceId: 'macbook_air',
      deviceLabel: 'Travel Mac',
      state: 'unknown',
      usage: null,
    });
    assert.equal(updated.deviceId, 'macbook_air');
    assert.equal(updated.reportedAt, '2026-09-22T08:02:00.000Z');
    assert.equal(updated.usage, null);

    const reopened = new MemberAccountStateStore({ dataDir });
    assert.deepEqual(await reopened.get('member_one', 'codex'), updated);
    assert.equal((await reopened.list('member_one')).length, 1);
    assert.equal(fs.statSync(path.join(dataDir, 'member-account-state.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), []);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('rejects credential fields and recognizable raw credential values before persistence', async () => {
  const dataDir = temporaryDataDir();
  try {
    const store = new MemberAccountStateStore({ dataDir });
    await assert.rejects(
      store.report('member_one', { ...codexReport, refreshToken: 'opaque' } as never),
      /credential_material_not_accepted/,
    );
    await assert.rejects(
      store.report('member_one', {
        ...codexReport,
        usage: { ...codexReport.usage, cookie: 'session=value' },
      } as never),
      /credential_material_not_accepted/,
    );
    await assert.rejects(
      store.report('member_one', { ...codexReport, deviceLabel: 'sk-ant-api03_abcdefghijklmnop' }),
      /credential_material_not_accepted/,
    );
    for (const report of [
      { ...codexReport, plan: 'cookie=session=abc' },
      { ...codexReport, authMode: 'refresh_token=opaque-value' },
      { ...codexReport, deviceLabel: '{"access_token":"short-secret"}' },
      { ...codexReport, usage: { ...codexReport.usage, reason: 'session=hidden-value' } },
    ]) {
      await assert.rejects(
        store.report('member_one', report),
        /credential_material_not_accepted/,
      );
    }
    await assert.rejects(
      store.report('member_one', { ...codexReport, plan: 'Pro<script>' }),
      /invalid_plan/,
    );
    assert.equal(fs.existsSync(path.join(dataDir, 'member-account-state.json')), false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('enforces case-insensitive provider-scoped email uniqueness atomically', async () => {
  const dataDir = temporaryDataDir();
  try {
    const first = new MemberAccountStateStore({ dataDir });
    const second = new MemberAccountStateStore({ dataDir });
    const results = await Promise.allSettled([
      first.report('member_one', codexReport),
      second.report('member_two', { ...codexReport, email: 'owner@example.COM', deviceId: 'device_two' }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejection = results.find(result => result.status === 'rejected');
    assert.equal(rejection?.status === 'rejected' && rejection.reason instanceof MemberAccountEmailConflictError, true);
    assert.equal((await first.list()).length, 1);

    await first.report('member_claude', {
      provider: 'claude',
      deviceId: 'claude_device',
      deviceLabel: 'Claude Mac',
      state: 'authenticated',
      email: 'owner@example.com',
      plan: 'Max',
      authMode: 'claude_ai',
    });
    assert.equal((await first.list()).length, 2);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('robustly reads legacy records, skips unsafe entries, and rewrites only normalized fields', async () => {
  const dataDir = temporaryDataDir();
  const stateFile = path.join(dataDir, 'member-account-state.json');
  try {
    fs.writeFileSync(stateFile, JSON.stringify({
      snapshots: [
        {
          memberId: 'legacy_member',
          provider: 'claude',
          email: 'legacy@example.com',
          plan: 'Max',
          authMode: 'browser',
          deviceId: 'legacy_device',
          deviceLabel: 'Legacy Mac',
          reportedAt: '2026-09-20T00:00:00.000Z',
        },
        {
          memberId: 'unsafe_member',
          provider: 'codex',
          deviceId: 'unsafe_device',
          deviceLabel: 'Unsafe',
          reportedAt: '2026-09-20T00:00:00.000Z',
          authJson: { accessToken: 'must-not-survive' },
        },
        { memberId: '../invalid', provider: 'codex' },
      ],
    }), { mode: 0o600 });

    const store = new MemberAccountStateStore({ dataDir });
    const legacy = await store.get('legacy_member', 'claude');
    assert.equal(legacy?.state, 'unknown');
    assert.equal((await store.list()).length, 1);

    await store.report('new_member', { ...codexReport, email: 'new@example.com' });
    const rewritten = fs.readFileSync(stateFile, 'utf8');
    assert.doesNotMatch(rewritten, /must-not-survive|authJson|accessToken/);
    assert.equal(JSON.parse(rewritten).schemaVersion, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('validates state, usage bounds, timestamps, and heartbeat identity', async () => {
  const dataDir = temporaryDataDir();
  try {
    const store = new MemberAccountStateStore({ dataDir });
    await assert.rejects(store.report('member_one', {
      ...codexReport,
      state: 'ready',
    } as never), /invalid_connection_state/);
    await assert.rejects(store.report('member_one', {
      ...codexReport,
      state: 'authenticated',
      email: null,
    }), /verified_provider_identity_required/);
    await assert.rejects(store.report('member_one', {
      ...codexReport,
      usage: {
        ...codexReport.usage,
        primary: { ...codexReport.usage.primary, remainingPercent: 101 },
      },
    }), /invalid_primary_remaining_percent/);
    await assert.rejects(store.report('member_one', {
      ...codexReport,
      usage: { ...codexReport.usage, checkedAt: 'not-a-date' },
    }), /invalid_usage_checked_at/);
    await assert.rejects(store.report('member_one', {
      ...codexReport,
      deviceId: '../escape',
    }), /invalid_device_id/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
