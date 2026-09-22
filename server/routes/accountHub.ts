import { Router, type Request, type Response } from 'express';
import { accountAuditLog } from '../accountHub/audit.js';
import { accountHubService, AccountHubServiceError } from '../accountHub/service.js';
import { teamUsageStore, type UsageRange } from '../accountHub/teamUsage.js';
import {
  parseAccountEnabledBody,
  parseAssignOwnerBody,
  parseCreateAccountBody,
} from '../accountHub/validation.js';
import type { MemberAccountStateReport } from '../accountHub/types.js';
import { requireInternalAdmin } from '../lib/demoAccounts.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';

export const accountHubRouter = Router();

export function accountHubEnabled(): boolean {
  const configured = String(process.env.ACCOUNT_HUB_ENABLED || '').trim().toLowerCase();
  if (configured === 'false' || configured === '0') return false;
  if (process.env.NODE_ENV === 'production') return configured === 'true' || configured === '1';
  return true;
}

function bearerToken(value: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(value || '');
  return match?.[1]?.trim() || '';
}

function memberName(value: unknown): string {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (Object.keys(body).some(key => key !== 'name')) throw new Error('unsupported_field');
  if (typeof body.name !== 'string') throw new Error('invalid_member_name');
  return body.name;
}

function memberEnabled(value: unknown): boolean {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (Object.keys(body).some(key => key !== 'enabled') || typeof body.enabled !== 'boolean') throw new Error('invalid_enabled');
  return body.enabled;
}

function usageRange(value: unknown): UsageRange {
  return value === '1d' || value === '7d' || value === '30d' ? value : '7d';
}

function connectorObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_request_body');
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (/(password|passwd|cookie|token|secret|credential|authorization|api[_-]?key)/i.test(key)) {
      throw new Error('credential_material_not_accepted');
    }
    if (!allowed.includes(key)) throw new Error(`unsupported_field:${key}`);
  }
  return body;
}

function connectorId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(value)) {
    throw new Error(`invalid_${field}`);
  }
  return value;
}

function connectorLabel(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_device_label');
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || normalized.includes('\0')) throw new Error('invalid_device_label');
  return normalized;
}

function connectorAcquireBody(value: unknown): { deviceId: string; deviceLabel: string; leaseId?: string } {
  const body = connectorObject(value, ['deviceId', 'deviceLabel', 'leaseId']);
  return {
    deviceId: connectorId(body.deviceId, 'device_id'),
    deviceLabel: connectorLabel(body.deviceLabel),
    ...(body.leaseId === undefined ? {} : { leaseId: connectorId(body.leaseId, 'lease_id') }),
  };
}

function connectorReleaseBody(value: unknown): { deviceId: string; leaseId?: string } {
  const body = connectorObject(value, ['deviceId', 'leaseId']);
  return {
    deviceId: connectorId(body.deviceId, 'device_id'),
    ...(body.leaseId === undefined ? {} : { leaseId: connectorId(body.leaseId, 'lease_id') }),
  };
}

async function authenticateConnector(request: Request): Promise<string> {
  const token = bearerToken(request.get('authorization'));
  if (!token) throw new Error('invalid_ingest_token');
  return (await teamUsageStore().authenticateConnectorToken(token)).id;
}

function loopbackAddress(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase().replace(/^::ffff:/, '').replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function loopbackHost(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function loopbackOrigin(value: string | undefined): boolean {
  if (!value) return true;
  try {
    return loopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function requireMember(memberId: string, enabled: boolean): Promise<void> {
  const member = (await teamUsageStore().listMembers()).find(candidate => candidate.id === memberId);
  if (!member) throw new Error('member_not_found');
  if (enabled && !member.enabled) throw new Error('member_disabled');
}

function renderError(response: Response, error: unknown): void {
  if (error instanceof AccountHubServiceError) {
    response.status(error.status).json({ error: error.code });
    return;
  }
  const message = error instanceof Error ? error.message : 'account_hub_error';
  if (message === 'member_not_found') {
    response.status(404).json({ error: message });
    return;
  }
  if (message === 'member_name_exists' || message === 'member_disabled') {
    response.status(409).json({ error: message });
    return;
  }
  const invalid = /^(invalid_|unsupported_(?:[a-z_]+_)?field:?|credential_material_not_accepted)/.test(message);
  if (invalid) {
    response.status(400).json({ error: message.split(':')[0] });
    return;
  }
  console.error('[account-hub]', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  response.status(500).json({ error: 'account_hub_unavailable' });
}

// Codex sends OTLP logs directly from each member's own device. This route is
// authenticated with a member-specific ingest credential, not dashboard auth.
accountHubRouter.post('/telemetry/v1/logs', async (request, response) => {
  if (!accountHubEnabled()) {
    response.status(503).json({ error: 'account_hub_disabled' });
    return;
  }
  try {
    const token = bearerToken(request.get('authorization'));
    if (!token) {
      response.status(401).json({ error: 'invalid_ingest_token' });
      return;
    }
    const result = await teamUsageStore().ingest(token, request.body);
    response.setHeader('Cache-Control', 'no-store');
    response.json({ partialSuccess: {}, accepted: result.accepted });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_ingest_token') {
      response.status(401).json({ error: 'invalid_ingest_token' });
      return;
    }
    renderError(response, error);
  }
});

function connectorEnabled(response: Response): boolean {
  response.setHeader('Cache-Control', 'no-store');
  if (!accountHubEnabled()) {
    response.status(503).json({ error: 'account_hub_disabled' });
    return false;
  }
  return true;
}

function renderConnectorError(response: Response, error: unknown): void {
  if (error instanceof Error && error.message === 'invalid_ingest_token') {
    response.status(401).json({ error: 'invalid_ingest_token' });
    return;
  }
  renderError(response, error);
}

accountHubRouter.post('/telemetry/v1/account-state', async (request, response) => {
  if (!connectorEnabled(response)) return;
  try {
    const memberId = await authenticateConnector(request);
    response.json(await accountHubService().reportMemberAccountState(
      memberId,
      request.body as MemberAccountStateReport,
    ));
  } catch (error) { renderConnectorError(response, error); }
});

accountHubRouter.post('/telemetry/v1/accounts/:accountId/acquire', async (request, response) => {
  if (!connectorEnabled(response)) return;
  try {
    const memberId = await authenticateConnector(request);
    const input = connectorAcquireBody(request.body);
    response.json(await accountHubService().acquireAccount({
      accountId: request.params.accountId,
      memberId,
      ...input,
    }));
  } catch (error) { renderConnectorError(response, error); }
});

accountHubRouter.post('/telemetry/v1/accounts/:accountId/local-release', async (request, response) => {
  if (!connectorEnabled(response)) return;
  try {
    const memberId = await authenticateConnector(request);
    const input = connectorReleaseBody(request.body);
    response.json(await accountHubService().localReleaseAccount({
      accountId: request.params.accountId,
      memberId,
      ...input,
    }));
  } catch (error) { renderConnectorError(response, error); }
});

// Credential-bearing account operations are deliberately local-only. Team
// devices may reach only the token-authenticated telemetry route above.
accountHubRouter.use((request, response, next) => {
  if (
    !loopbackAddress(request.socket.remoteAddress)
    || !loopbackHost(request.hostname)
    || !loopbackOrigin(request.get('origin'))
  ) {
    response.status(403).json({ error: 'account_hub_local_only' });
    return;
  }
  next();
});

accountHubRouter.use(requireAuth);
accountHubRouter.use(requireInternalAdmin);
accountHubRouter.use((request, response, next) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const actorId = (response.locals as AuthLocals).userId || 'unknown-admin';
    response.once('finish', () => {
      void accountAuditLog().record({
        actorId,
        action: request.method,
        target: request.path,
        status: response.statusCode,
      }).catch(error => console.error('[account-hub-audit]', { errorType: error instanceof Error ? error.name : 'UnknownError' }));
    });
  }
  next();
});
accountHubRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  if (!accountHubEnabled()) {
    response.status(503).json({ error: 'account_hub_disabled' });
    return;
  }
  next();
});

accountHubRouter.get('/team/members', async (_request, response) => {
  try { response.json({ members: await teamUsageStore().listMembers() }); }
  catch (error) { renderError(response, error); }
});

accountHubRouter.post('/team/members', async (request, response) => {
  try {
    const created = await teamUsageStore().createMember(memberName(request.body));
    response.status(201).json(created);
  } catch (error) { renderError(response, error); }
});

accountHubRouter.patch('/team/members/:memberId', async (request, response) => {
  try {
    const member = await teamUsageStore().setMemberEnabled(request.params.memberId, memberEnabled(request.body));
    response.json({ member });
  } catch (error) { renderError(response, error); }
});

accountHubRouter.post('/team/members/:memberId/rotate-token', async (request, response) => {
  try { response.json(await teamUsageStore().rotateToken(request.params.memberId)); }
  catch (error) { renderError(response, error); }
});

accountHubRouter.get('/team/usage', async (request, response) => {
  try { response.json({ summary: await teamUsageStore().summary(usageRange(request.query.range)) }); }
  catch (error) { renderError(response, error); }
});

accountHubRouter.get('/accounts', async (_request, response) => {
  try { response.json({ accounts: await accountHubService().listAccounts() }); }
  catch (error) { renderError(response, error); }
});

accountHubRouter.post('/accounts', async (request, response) => {
  try {
    const input = parseCreateAccountBody(request.body);
    await requireMember(input.memberId, true);
    const account = await accountHubService().createAccount(input);
    response.status(201).json({ account });
  } catch (error) { renderError(response, error); }
});

accountHubRouter.post('/accounts/:accountId/assign-owner', async (request, response) => {
  try {
    const { memberId } = parseAssignOwnerBody(request.body);
    await requireMember(memberId, true);
    response.json({ account: await accountHubService().assignLegacyAccountOwner(request.params.accountId, memberId) });
  } catch (error) { renderError(response, error); }
});

accountHubRouter.patch('/accounts/:accountId', async (request, response) => {
  try {
    const { enabled } = parseAccountEnabledBody(request.body);
    response.json({ account: await accountHubService().setAccountEnabled(request.params.accountId, enabled) });
  } catch (error) { renderError(response, error); }
});

// Deliberately no web routes for provider authorization, status probing,
// usage reads, provider logout, or task dispatch. Those operations stay on
// each member's own machine; unknown management paths fall through as 404.
