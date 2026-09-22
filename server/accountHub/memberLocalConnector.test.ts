import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireMemberLocalLease,
  parseMemberLocalConnectorConfig,
  readMemberLocalConnectorConfig,
  releaseMemberLocalLease,
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
