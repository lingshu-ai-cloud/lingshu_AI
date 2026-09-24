import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  LOCAL_ADMIN_EMAIL: process.env.LOCAL_ADMIN_EMAIL,
  WORKBENCH_ADMIN_EMAIL: process.env.WORKBENCH_ADMIN_EMAIL,
  ADMIN_DASHBOARD_EMAILS: process.env.ADMIN_DASHBOARD_EMAILS,
  ACCOUNT_HUB_DATA_DIR: process.env.ACCOUNT_HUB_DATA_DIR,
  ACCOUNT_HUB_ENABLED: process.env.ACCOUNT_HUB_ENABLED,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-account-hub-route-'));

process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.LOCAL_ADMIN_EMAIL = 'account-hub-admin@example.test';
process.env.WORKBENCH_ADMIN_EMAIL = '';
process.env.ADMIN_DASHBOARD_EMAILS = '';
process.env.ACCOUNT_HUB_DATA_DIR = temporaryDirectory;
process.env.ACCOUNT_HUB_ENABLED = 'true';

const [{ accountHubRouter, accountHubEnabled }, { issueLocalIdentityTokenForTest }, { getAccountPaths }] = await Promise.all([
  import('./accountHub.js'),
  import('../auth/localIdentity.js'),
  import('../accountHub/paths.js'),
]);

const app = express();
app.use(express.json());
app.use('/account-hub', accountHubRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('account hub test server did not bind');
const origin = `http://127.0.0.1:${address.port}/account-hub`;

function token(input: { userId: string; tenantId: string; email: string; accountType: string; role?: string }) {
  return issueLocalIdentityTokenForTest(input);
}

const tenantToken = token({
  userId: 'account-hub-tenant-user',
  tenantId: 'account-hub-tenant',
  email: 'member@example.test',
  accountType: 'customer',
  role: 'admin',
});
const adminToken = token({
  userId: 'local_user_admin_account_hub_admin_example_test',
  tenantId: 'local_tenant_admin_account_hub_admin_example_test',
  email: 'account-hub-admin@example.test',
  accountType: 'admin',
  role: 'super_admin',
});

async function request(pathname: string, authToken = '', init: RequestInit = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { /* Express 404 HTML */ }
  return { status: response.status, text, body };
}

try {
  const nonLocalManagement = await request('/accounts', adminToken, { headers: { Origin: 'https://accounts.example.test' } });
  assert.equal(nonLocalManagement.status, 403, 'credential-bearing management routes must be loopback-only');
  assert.equal(nonLocalManagement.body.error, 'account_hub_local_only');
  assert.equal((await request('/accounts')).status, 401, 'anonymous access must be rejected');
  const denied = await request('/accounts', tenantToken);
  assert.equal(denied.status, 403, 'tenant administrators must not manage host-level AI accounts');
  assert.equal(denied.body.error, 'admin_required');

  const initial = await request('/accounts', adminToken);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.accounts, []);
  assert.equal(initial.body.accounts && JSON.stringify(initial.body.accounts).includes('token'), false);

  assert.equal((await request('/team/members')).status, 401, 'team usage dashboard must require an administrator');
  const teamMember = await request('/team/members', adminToken, {
    method: 'POST',
    body: JSON.stringify({ name: 'Member One' }),
  });
  assert.equal(teamMember.status, 201);
  const memberId = String((teamMember.body.member as Record<string, unknown>).id || '');
  const ingestToken = String(teamMember.body.ingestToken || '');
  const connectorToken = String(teamMember.body.connectorToken || '');
  assert.match(memberId, /^member_/);
  assert.match(ingestToken, /^cdu_/);
  assert.match(connectorToken, /^cdc_/);

  const otherTeamMember = await request('/team/members', adminToken, {
    method: 'POST',
    body: JSON.stringify({ name: 'Member Two' }),
  });
  const otherIngestToken = String(otherTeamMember.body.ingestToken || '');
  const otherConnectorToken = String(otherTeamMember.body.connectorToken || '');
  assert.match(otherIngestToken, /^cdu_/);
  assert.match(otherConnectorToken, /^cdc_/);

  const thirdTeamMember = await request('/team/members', adminToken, {
    method: 'POST',
    body: JSON.stringify({ name: 'Member Three' }),
  });
  const thirdMemberId = String((thirdTeamMember.body.member as Record<string, unknown>).id || '');
  const thirdConnectorToken = String(thirdTeamMember.body.connectorToken || '');
  assert.match(thirdMemberId, /^member_/);
  assert.match(thirdConnectorToken, /^cdc_/);

  const secret = 'must-not-be-written-or-echoed';
  const rejected = await request('/accounts', adminToken, {
    method: 'POST',
    body: JSON.stringify({ provider: 'codex', label: 'Unsafe', memberId, password: secret }),
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'credential_material_not_accepted');
  assert.doesNotMatch(rejected.text, new RegExp(secret));

  const created = await request('/accounts', adminToken, {
    method: 'POST',
    body: JSON.stringify({ provider: 'codex', label: 'Development Codex', memberId }),
  });
  assert.equal(created.status, 201);
  const createdAccount = created.body.account as Record<string, unknown>;
  const accountId = String(createdAccount.id);
  assert.equal(createdAccount.status, 'pending');
  assert.equal(createdAccount.memberId, memberId);
  assert.doesNotMatch(created.text, /password|cookie|access[_-]?token|refresh[_-]?token/i);

  const duplicateMemberProvider = await request('/accounts', adminToken, {
    method: 'POST',
    body: JSON.stringify({ provider: 'codex', label: 'Duplicate Codex', memberId }),
  });
  assert.equal(duplicateMemberProvider.status, 409, 'one member may bind only one account for a provider');
  assert.equal(duplicateMemberProvider.body.error, 'member_provider_account_exists');

  const otherCreated = await request('/accounts', adminToken, {
    method: 'POST',
    body: JSON.stringify({ provider: 'codex', label: 'Member Two Codex', memberId: String((otherTeamMember.body.member as Record<string, unknown>).id || '') }),
  });
  assert.equal(otherCreated.status, 201);
  const otherAccountId = String((otherCreated.body.account as Record<string, unknown>).id || '');

  const missingMember = await request('/accounts', adminToken, {
    method: 'POST',
    body: JSON.stringify({ provider: 'claude', label: 'Missing owner', memberId: 'member_missing' }),
  });
  assert.equal(missingMember.status, 404);
  assert.equal(missingMember.body.error, 'member_not_found');

  const nonLocalReassignment = await request(`/accounts/${otherAccountId}/reassign-owner`, adminToken, {
    method: 'POST',
    headers: { Origin: 'https://accounts.example.test' },
    body: JSON.stringify({ memberId: thirdMemberId }),
  });
  assert.equal(nonLocalReassignment.status, 403, 'owner reassignment must be local-administrator only');
  assert.equal(nonLocalReassignment.body.error, 'account_hub_local_only');
  const unsafeReassignment = await request(`/accounts/${otherAccountId}/reassign-owner`, adminToken, {
    method: 'POST',
    body: JSON.stringify({ memberId: thirdMemberId, refreshToken: 'must-not-cross-the-boundary' }),
  });
  assert.equal(unsafeReassignment.status, 400);
  assert.equal(unsafeReassignment.body.error, 'credential_material_not_accepted');
  const missingReassignmentTarget = await request(`/accounts/${otherAccountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId: 'member_missing' }),
  });
  assert.equal(missingReassignmentTarget.status, 404);
  assert.equal(missingReassignmentTarget.body.error, 'member_not_found');

  const disabledTeamMember = await request('/team/members', adminToken, {
    method: 'POST', body: JSON.stringify({ name: 'Disabled Transfer Target' }),
  });
  const disabledMemberId = String((disabledTeamMember.body.member as Record<string, unknown>).id || '');
  assert.equal((await request(`/team/members/${disabledMemberId}`, adminToken, {
    method: 'PATCH', body: JSON.stringify({ enabled: false }),
  })).status, 200);
  const disabledReassignmentTarget = await request(`/accounts/${otherAccountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId: disabledMemberId }),
  });
  assert.equal(disabledReassignmentTarget.status, 409);
  assert.equal(disabledReassignmentTarget.body.error, 'member_disabled');

  const emptySlotLogout = await request('/telemetry/v1/account-state', otherConnectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_two', deviceLabel: 'Other Mac', state: 'unauthenticated',
    }),
  });
  assert.equal(emptySlotLogout.status, 200, 'even an unbound slot requires an explicit fresh local logout before transfer');

  const occupiedReassignmentTarget = await request(`/accounts/${otherAccountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId }),
  });
  assert.equal(occupiedReassignmentTarget.status, 409);
  assert.equal(occupiedReassignmentTarget.body.error, 'member_provider_account_exists');

  for (const [pathname, method] of [
    [`/accounts/${accountId}/check`, 'POST'],
    [`/accounts/${accountId}/usage`, 'GET'],
    [`/accounts/${accountId}/authorize`, 'POST'],
    [`/accounts/${accountId}/logout`, 'POST'],
    [`/accounts/${accountId}/revoke`, 'POST'],
    [`/accounts/${accountId}/acquire`, 'POST'],
    [`/accounts/${accountId}/local-release`, 'POST'],
    ['/authorizations/auth_old', 'GET'],
  ] as const) {
    assert.equal((await request(pathname, adminToken, { method })).status, 404, `${pathname} must not be web reachable`);
  }

  assert.equal((await request('/telemetry/v1/account-state', '', {
    method: 'POST',
    body: JSON.stringify({ provider: 'codex', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'authenticated' }),
  })).status, 401, 'connector state requires a member ingest token');
  assert.equal((await request('/telemetry/v1/account-state', ingestToken, {
    method: 'POST',
    body: JSON.stringify({ provider: 'codex', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'authenticated' }),
  })).status, 401, 'the telemetry-only token must not control account state or leases');

  const spoofedState = await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST',
    body: JSON.stringify({
      memberId: 'member_spoofed', provider: 'codex', deviceId: 'device_one',
      deviceLabel: 'Member Mac', state: 'authenticated',
    }),
  });
  assert.equal(spoofedState.status, 400, 'member identity must never come from the connector body');

  const stateReport = await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST',
    headers: { Origin: 'https://member-device.example.test' },
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'authenticated',
      email: 'member@example.test', plan: 'Pro', authMode: 'chatgpt',
      usage: {
        available: true,
        primary: { usedPercent: 20, remainingPercent: 80 },
        checkedAt: '2026-09-22T08:00:00.000Z',
      },
    }),
  });
  assert.equal(stateReport.status, 200, 'member connector endpoints are token-authenticated, not loopback-only');
  assert.equal(stateReport.body.accepted, true);
  assert.equal(Object.hasOwn(stateReport.body, 'account'), false, 'state reports must not expose account lease capabilities');
  const hiddenConnectorCredential = 'refresh_token=opaque-connector-secret';
  const maliciousStateReport = await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'authenticated',
      email: 'member@example.test', authMode: hiddenConnectorCredential,
    }),
  });
  assert.equal(maliciousStateReport.status, 400);
  assert.equal(maliciousStateReport.body.error, 'invalid_connector_report');
  assert.doesNotMatch(maliciousStateReport.text, /opaque-connector-secret/);

  const duplicateProviderIdentity = await request('/telemetry/v1/account-state', otherConnectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_two', deviceLabel: 'Other Mac', state: 'authenticated',
      email: 'MEMBER@example.test', plan: 'Pro', authMode: 'chatgpt',
    }),
  });
  assert.equal(duplicateProviderIdentity.status, 409, 'the same provider identity cannot be shared by members');
  assert.equal(duplicateProviderIdentity.body.error, 'provider_account_already_bound');
  assert.doesNotMatch(duplicateProviderIdentity.text, /member@example\.test/i, 'identity conflict responses must not echo the email');

  const directReassignment = await request(`/accounts/${otherAccountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId: thirdMemberId }),
  });
  assert.equal(directReassignment.status, 200, 'a never-bound slot transfers only after an explicit local logout');
  const directlyReassignedAccount = directReassignment.body.account as Record<string, unknown>;
  assert.equal(directlyReassignedAccount.memberId, thirdMemberId);
  assert.equal(directlyReassignedAccount.status, 'pending');
  assert.equal(directlyReassignedAccount.plan, null);
  assert.equal(directlyReassignedAccount.localState, null);
  assert.equal(directlyReassignedAccount.transferEligible, false);
  assert.equal(directlyReassignedAccount.transferBlockedReason, 'fresh_local_logout_required');
  const oldOwnerReportAfterTransfer = await request('/telemetry/v1/account-state', otherConnectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_two', deviceLabel: 'Other Mac', state: 'authenticated',
      email: 'old-owner-after-transfer@example.test',
    }),
  });
  assert.equal(oldOwnerReportAfterTransfer.status, 404);
  assert.equal(oldOwnerReportAfterTransfer.body.error, 'account_not_bound');
  const newOwnerReportAfterTransfer = await request('/telemetry/v1/account-state', thirdConnectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_three', deviceLabel: 'Third Mac', state: 'authenticated',
      email: 'third-provider-account@example.test', plan: 'New owner plan',
    }),
  });
  assert.equal(newOwnerReportAfterTransfer.status, 200, 'new owner must authenticate with their own Provider account');

  const claudeCreated = await request('/accounts', adminToken, {
    method: 'POST', body: JSON.stringify({ provider: 'claude', label: 'Transfer tombstone', memberId }),
  });
  assert.equal(claudeCreated.status, 201);
  const claudeAccountId = String((claudeCreated.body.account as Record<string, unknown>).id || '');
  const originalClaudeEmail = 'original-claude-owner@example.test';
  assert.equal((await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST', body: JSON.stringify({
      provider: 'claude', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'authenticated',
      email: originalClaudeEmail, plan: 'Max', authMode: 'claude_ai',
    }),
  })).status, 200);
  assert.equal((await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST', body: JSON.stringify({
      provider: 'claude', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'unauthenticated',
    }),
  })).status, 200);
  const claudeTransfer = await request(`/accounts/${claudeAccountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId: String((otherTeamMember.body.member as Record<string, unknown>).id || '') }),
  });
  assert.equal(claudeTransfer.status, 200);
  const reusedHistoricalIdentity = await request('/telemetry/v1/account-state', otherConnectorToken, {
    method: 'POST', body: JSON.stringify({
      provider: 'claude', deviceId: 'device_two', deviceLabel: 'Other Mac', state: 'authenticated',
      email: originalClaudeEmail, plan: 'Max', authMode: 'claude_ai',
    }),
  });
  assert.equal(reusedHistoricalIdentity.status, 409, 'a transferred slot cannot transfer the old Provider identity');
  assert.equal(reusedHistoricalIdentity.body.error, 'provider_account_already_bound');
  assert.doesNotMatch(reusedHistoricalIdentity.text, /original-claude-owner/i);
  assert.equal((await request('/telemetry/v1/account-state', otherConnectorToken, {
    method: 'POST', body: JSON.stringify({
      provider: 'claude', deviceId: 'device_two', deviceLabel: 'Other Mac', state: 'authenticated',
      email: 'new-claude-owner@example.test', plan: 'Max', authMode: 'claude_ai',
    }),
  })).status, 200, 'the new member may bind a different Provider identity');

  const spoofedAcquire = await request(`/telemetry/v1/accounts/${accountId}/acquire`, connectorToken, {
    method: 'POST',
    body: JSON.stringify({ memberId: 'member_spoofed', deviceId: 'device_one', deviceLabel: 'Member Mac' }),
  });
  assert.equal(spoofedAcquire.status, 400, 'acquire must reject body-supplied member identity');

  const wrongMemberAcquire = await request(`/telemetry/v1/accounts/${accountId}/acquire`, otherConnectorToken, {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'device_two', deviceLabel: 'Other Mac' }),
  });
  assert.equal(wrongMemberAcquire.status, 403);
  assert.equal(wrongMemberAcquire.body.error, 'account_member_mismatch');

  const acquired = await request(`/telemetry/v1/accounts/${accountId}/acquire`, connectorToken, {
    method: 'POST',
    body: JSON.stringify({ deviceId: 'device_one', deviceLabel: 'Member Mac' }),
  });
  assert.equal(acquired.status, 200);
  assert.equal(Object.hasOwn(acquired.body, 'account'), false, 'acquire must not expose team account metadata');
  const leaseId = String((acquired.body.lease as Record<string, unknown>).leaseId || '');
  assert.match(leaseId, /^[a-f0-9-]{36}$/i);
  const heartbeatWhileLeased = await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_one', deviceLabel: 'Copied config',
      state: 'authenticated', email: 'member@example.test',
    }),
  });
  assert.equal(heartbeatWhileLeased.status, 200);
  assert.doesNotMatch(heartbeatWhileLeased.text, new RegExp(leaseId), 'heartbeat response must not leak the renewal capability');
  assert.equal(Object.hasOwn(heartbeatWhileLeased.body, 'account'), false);
  const copiedDeviceRenewal = await request(`/telemetry/v1/accounts/${accountId}/acquire`, connectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_one', deviceLabel: 'Copied config' }),
  });
  assert.equal(copiedDeviceRenewal.status, 409, 'a copied deviceId cannot renew without the active lease capability');
  const renewed = await request(`/telemetry/v1/accounts/${accountId}/acquire`, connectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_one', deviceLabel: 'Member Mac', leaseId }),
  });
  assert.equal(renewed.status, 200);
  assert.equal(String((renewed.body.lease as Record<string, unknown>).leaseId || ''), leaseId);

  const loggedOutWhileLeased = await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'unauthenticated',
    }),
  });
  assert.equal(loggedOutWhileLeased.status, 200);
  const leasedReassignment = await request(`/accounts/${accountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId }),
  });
  assert.equal(leasedReassignment.status, 409);
  assert.equal(leasedReassignment.body.error, 'account_in_use');

  const staleRelease = await request(`/telemetry/v1/accounts/${accountId}/local-release`, connectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_one' }),
  });
  assert.equal(staleRelease.status, 400);
  assert.equal(staleRelease.body.error, 'invalid_lease_id');
  assert.equal((await request(`/telemetry/v1/accounts/${accountId}/local-release`, otherConnectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_two', leaseId }),
  })).status, 403);
  const released = await request(`/telemetry/v1/accounts/${accountId}/local-release`, connectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_one', leaseId }),
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.released, true);
  assert.equal(Object.hasOwn(released.body, 'account'), false, 'release response must not expose a later lease capability');
  assert.doesNotMatch(released.text, /leaseId/);
  const missingAfterRelease = await request(`/telemetry/v1/accounts/${accountId}/local-release`, connectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_one' }),
  });
  assert.equal(missingAfterRelease.status, 400, 'leaseId stays mandatory even when no lease exists');
  assert.deepEqual(missingAfterRelease.body, { error: 'invalid_lease_id' });

  const sameOwnerReset = await request(`/accounts/${accountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId }),
  });
  assert.equal(sameOwnerReset.status, 200);
  const resetAccount = sameOwnerReset.body.account as Record<string, unknown>;
  assert.equal(resetAccount.memberId, memberId);
  assert.equal(resetAccount.status, 'pending');
  assert.equal(resetAccount.plan, null);
  assert.equal(resetAccount.transferEligible, true);

  const legacyProfile = getAccountPaths(accountId, temporaryDirectory).profileDir;
  fs.mkdirSync(legacyProfile, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(legacyProfile, 'auth.json'), '{"legacy":"credential-marker"}', { mode: 0o600 });
  const legacyHeartbeat = await request('/telemetry/v1/account-state', connectorToken, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'codex', deviceId: 'device_one', deviceLabel: 'Member Mac', state: 'authenticated',
      email: 'member@example.test',
    }),
  });
  assert.equal(legacyHeartbeat.status, 409, 'any legacy server profile must fail closed before accepting heartbeats');
  assert.equal(legacyHeartbeat.body.error, 'legacy_managed_profile_cleanup_required');
  const legacyAcquire = await request(`/telemetry/v1/accounts/${accountId}/acquire`, connectorToken, {
    method: 'POST', body: JSON.stringify({ deviceId: 'device_one', deviceLabel: 'Member Mac' }),
  });
  assert.equal(legacyAcquire.status, 409, 'legacy server credentials must block lease acquisition');
  assert.equal(legacyAcquire.body.error, 'legacy_managed_profile_cleanup_required');
  const legacyReassignment = await request(`/accounts/${accountId}/reassign-owner`, adminToken, {
    method: 'POST', body: JSON.stringify({ memberId }),
  });
  assert.equal(legacyReassignment.status, 409, 'legacy server credentials must block slot reassignment');
  assert.equal(legacyReassignment.body.error, 'legacy_managed_profile_cleanup_required');
  const legacyAccounts = await request('/accounts', adminToken);
  const legacyAccount = (legacyAccounts.body.accounts as Array<Record<string, unknown>>)
    .find(account => account.id === accountId);
  assert.equal(legacyAccount?.legacyManagedProfilePresent, true);
  assert.equal(legacyAccount?.status, 'unavailable');

  assert.equal((await request('/tasks', adminToken)).status, 404, 'task collection route must not exist');
  assert.equal((await request('/tasks/legacy', adminToken)).status, 404, 'task detail route must not exist');
  assert.equal((await request('/tasks', adminToken, {
    method: 'POST',
    body: JSON.stringify({ accountId, prompt: 'must never run' }),
  })).status, 404, 'web task dispatch must not exist');

  assert.equal((await request('/telemetry/v1/logs')).status, 401, 'telemetry ingestion must require a member token');
  assert.equal((await request('/telemetry/v1/logs', connectorToken, {
    method: 'POST', body: JSON.stringify({ resourceLogs: [] }),
  })).status, 401, 'the connector token must not submit OTLP logs');
  const hiddenOtlpCredential = 'cookie=session=opaque-otlp-secret';
  const maliciousTelemetry = await request('/telemetry/v1/logs', ingestToken, {
    method: 'POST',
    body: JSON.stringify({
      resourceLogs: [{ scopeLogs: [{ logRecords: [{
        timeUnixNano: '1790063999000000000',
        attributes: [
          { key: 'model', value: { stringValue: hiddenOtlpCredential } },
          { key: 'gen_ai.usage.input_tokens', value: { intValue: '1' } },
          { key: 'gen_ai.usage.output_tokens', value: { intValue: '1' } },
        ],
      }] }] }],
    }),
  });
  assert.equal(maliciousTelemetry.status, 400);
  assert.equal(maliciousTelemetry.body.error, 'credential_material_not_accepted');
  assert.doesNotMatch(maliciousTelemetry.text, /opaque-otlp-secret/);
  const telemetry = await request('/telemetry/v1/logs', ingestToken, {
    method: 'POST',
    body: JSON.stringify({
      resourceLogs: [{ scopeLogs: [{ logRecords: [{
        timeUnixNano: '1790064000000000000',
        attributes: [
          { key: 'gen_ai.usage.input_tokens', value: { intValue: '100' } },
          { key: 'gen_ai.usage.output_tokens', value: { intValue: '20' } },
          { key: 'codex.usage.total_tokens', value: { intValue: '120' } },
        ],
      }] }] }],
    }),
  });
  assert.equal(telemetry.status, 200);
  assert.equal(telemetry.body.accepted, 1);
  const usage = await request('/team/usage?range=7d', adminToken);
  assert.equal(usage.status, 200);
  assert.equal(((usage.body.summary as Record<string, unknown>).totals as Record<string, unknown>).totalTokens, 120);
  assert.doesNotMatch(usage.text, /opaque-otlp-secret/);

  process.env.NODE_ENV = 'production';
  delete process.env.ACCOUNT_HUB_ENABLED;
  assert.equal(accountHubEnabled(), false, 'production must be opt-in');
  process.env.NODE_ENV = 'test';
  process.env.ACCOUNT_HUB_ENABLED = 'false';
  assert.equal((await request('/accounts', adminToken)).status, 503, 'the route must honor the feature flag');
  process.env.ACCOUNT_HUB_ENABLED = 'true';
  assert.equal((await request('/accounts', adminToken)).status, 200, 'explicit opt-in must enable the route');

  console.log('account hub route access tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
