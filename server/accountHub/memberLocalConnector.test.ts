import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireMemberLocalLease,
  parseMemberLocalConnectorConfig,
  readMemberLocalConnectorConfig,
  reconcileMemberLocalLease,
  releaseMemberLocalLease,
  stopMemberLocalLeaseSession,
  submitMemberLocalAccountState,
} from './memberLocalConnector.js';

const validConfig = {
  endpoint: 'https://hub.example.test/api/overseas/account-hub/telemetry/v1/account-state',
  connectorToken: `cdc_${'a'.repeat(43)}`,
  provider: 'codex' as const,
  accountId: 'acct_codex_one',
  deviceId: 'member_macbook',
  deviceLabel: '成员 MacBook',
  intervalSeconds: 60,
};

test('connector config requires a safe endpoint and private token file', async () => {
  assert.equal(parseMemberLocalConnectorConfig(validConfig).provider, 'codex');
  assert.equal(parseMemberLocalConnectorConfig({ ...validConfig, endpoint: 'http://127.0.0.1:8790/api/overseas/account-hub/telemetry/v1/account-state' }).endpoint.startsWith('http:'), true);
  assert.throws(() => parseMemberLocalConnectorConfig({ ...validConfig, endpoint: 'http://hub.example.test/telemetry/v1/account-state' }), /invalid_connector_endpoint/);
  assert.throws(() => parseMemberLocalConnectorConfig({ ...validConfig, endpoint: 'https://evil.example.test/upload' }), /invalid_connector_endpoint/);
  assert.throws(() => parseMemberLocalConnectorConfig({ ...validConfig, refreshToken: 'never' }), /unsupported_connector_config_field/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-hub-connector-'));
  const file = path.join(root, 'connector.json');
  try {
    fs.writeFileSync(file, JSON.stringify(validConfig), { mode: 0o600 });
    assert.equal((await readMemberLocalConnectorConfig(file)).deviceId, 'member_macbook');
    if (process.platform !== 'win32') {
      fs.chmodSync(file, 0o644);
      await assert.rejects(readMemberLocalConnectorConfig(file), /permissions_too_open/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lease calls are member-token authenticated and local release includes the current lease id', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      String(input).endsWith('/acquire') ? JSON.stringify({ lease: { leaseId: 'lease_safe_1' } }) : '{}',
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const leaseId = await acquireMemberLocalLease(validConfig, undefined, fetchImpl);
  assert.equal(await acquireMemberLocalLease(validConfig, leaseId, fetchImpl), leaseId);
  await releaseMemberLocalLease(validConfig, leaseId, fetchImpl);
  assert.equal(leaseId, 'lease_safe_1');
  assert.match(requests[0]!.url, /\/accounts\/acct_codex_one\/acquire$/);
  assert.match(requests[1]!.url, /\/accounts\/acct_codex_one\/acquire$/);
  assert.match(requests[2]!.url, /\/accounts\/acct_codex_one\/local-release$/);
  assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), {
    deviceId: validConfig.deviceId,
    deviceLabel: validConfig.deviceLabel,
  });
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), {
    deviceId: validConfig.deviceId,
    deviceLabel: validConfig.deviceLabel,
    leaseId: 'lease_safe_1',
  });
  assert.deepEqual(JSON.parse(String(requests[2]!.init?.body)), {
    deviceId: validConfig.deviceId,
    leaseId: 'lease_safe_1',
  });
});

test('lease reconciliation releases on local logout and reacquires after login returns', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let acquireCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    if (url.endsWith('/acquire')) {
      acquireCount += 1;
      return Response.json({ lease: { leaseId: `lease_local_${acquireCount}` } });
    }
    return Response.json({ released: true });
  };

  let leaseId: string | undefined;
  let result = await reconcileMemberLocalLease(validConfig, { state: 'authenticated' }, leaseId, fetchImpl);
  assert.deepEqual(result, { action: 'acquired', leaseId: 'lease_local_1' });
  leaseId = result.leaseId;

  result = await reconcileMemberLocalLease(validConfig, { state: 'unauthenticated' }, leaseId, fetchImpl);
  assert.deepEqual(result, { action: 'released' });
  leaseId = result.leaseId;

  result = await reconcileMemberLocalLease(validConfig, { state: 'unknown' }, leaseId, fetchImpl);
  assert.deepEqual(result, { action: 'idle' });
  assert.equal(requests.length, 2, 'no lease means a non-authenticated heartbeat stays idle');

  result = await reconcileMemberLocalLease(validConfig, { state: 'authenticated' }, leaseId, fetchImpl);
  assert.deepEqual(result, { action: 'acquired', leaseId: 'lease_local_2' });
  leaseId = result.leaseId;

  result = await reconcileMemberLocalLease(validConfig, { state: 'authenticated' }, leaseId, fetchImpl);
  assert.deepEqual(result, { action: 'renewed', leaseId: 'lease_local_3' });

  assert.match(requests[0]!.url, /\/acquire$/);
  assert.deepEqual(requests[0]!.body, {
    deviceId: validConfig.deviceId,
    deviceLabel: validConfig.deviceLabel,
  });
  assert.match(requests[1]!.url, /\/local-release$/);
  assert.deepEqual(requests[1]!.body, {
    deviceId: validConfig.deviceId,
    leaseId: 'lease_local_1',
  });
  assert.match(requests[2]!.url, /\/acquire$/);
  assert.deepEqual(requests[2]!.body, {
    deviceId: validConfig.deviceId,
    deviceLabel: validConfig.deviceLabel,
  }, 'a new login must not reuse the released lease capability');
  assert.deepEqual(requests[3]!.body, {
    deviceId: validConfig.deviceId,
    deviceLabel: validConfig.deviceLabel,
    leaseId: 'lease_local_2',
  });
});

test('error and unknown states retain a lease without network calls', async () => {
  let calls = 0;
  for (const state of ['error', 'unknown'] as const) {
    const reconciled = await reconcileMemberLocalLease(
      validConfig,
      { state },
      `lease_${state}_state`,
      async () => {
        calls += 1;
        return Response.json({ released: true });
      },
    );
    assert.deepEqual(reconciled, {
      action: 'idle',
      leaseId: `lease_${state}_state`,
    });
  }
  assert.equal(calls, 0, 'an inconclusive probe must fail closed and not release');
});

test('SIGINT or SIGTERM preserves leases after authenticated, error, or unknown states', async () => {
  const requestedUrls: string[] = [];
  for (const state of ['authenticated', 'error', 'unknown'] as const) {
    const currentLeaseId = `lease_before_stop_${state}`;
    const reconciled = await reconcileMemberLocalLease(
      validConfig,
      { state },
      currentLeaseId,
      async (input) => {
        requestedUrls.push(String(input));
        return Response.json({ lease: { leaseId: currentLeaseId } });
      },
    );
    assert.deepEqual(stopMemberLocalLeaseSession(reconciled.leaseId), {
      action: 'retained',
      leaseId: currentLeaseId,
    });
  }
  assert.equal(requestedUrls.length, 1, 'only authenticated renews before shutdown');
  assert.match(requestedUrls[0]!, /\/acquire$/);
  assert.equal(requestedUrls.some(url => url.endsWith('/local-release')), false);
  assert.deepEqual(stopMemberLocalLeaseSession(), { action: 'idle' });
});

test('a release network failure preserves the lease capability for retry', async () => {
  let retainedLeaseId: string | undefined = 'lease_retry_capability';
  await assert.rejects(async () => {
    const next = await reconcileMemberLocalLease(
      validConfig,
      { state: 'unauthenticated' },
      retainedLeaseId,
      async () => new Response('{}', { status: 503 }),
    );
    retainedLeaseId = next.leaseId;
  }, /connector_lease_rejected:503/);
  assert.equal(retainedLeaseId, 'lease_retry_capability');
});

test('state submission sends only the report and refuses redirects', async () => {
  let observed: { url?: string; init?: RequestInit } = {};
  await submitMemberLocalAccountState(validConfig, {
    provider: 'codex',
    deviceId: 'member_macbook',
    deviceLabel: '成员 MacBook',
    state: 'authenticated',
    email: 'owner@example.test',
    plan: 'pro',
    authMode: 'chatgpt',
    usage: null,
  }, async (input, init) => {
    observed = { url: String(input), init };
    return new Response('{}', { status: 200 });
  });
  assert.equal(observed.url, validConfig.endpoint);
  assert.equal(observed.init?.redirect, 'error');
  assert.equal((observed.init?.headers as Record<string, string>).authorization, `Bearer ${validConfig.connectorToken}`);
  assert.doesNotMatch(String(observed.init?.body), /connectorToken|cdc_/);
  assert.match(String(observed.init?.body), /owner@example\.test/);
});
