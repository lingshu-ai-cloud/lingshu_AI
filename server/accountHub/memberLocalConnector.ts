import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonRpcProcessClient } from './providers/jsonRpcClient.js';
import { parseClaudeAuthStatus } from './providers/claude.js';
import { normalizeCodexUsage, publicStatusFromAccount } from './providers/codex.js';
import { SafeProcessRunner, type SafeProcessRunnerLike } from './providers/safeProcess.js';
import type {
  AccountProvider,
  MemberAccountStateReport,
  MemberAccountUsageWindowReport,
} from './types.js';

const CONNECT_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONFIG_BYTES = 64 * 1024;
const CONNECTOR_PATH_SUFFIX = '/telemetry/v1/account-state';

type UnknownRecord = Record<string, unknown>;

export interface MemberLocalConnectorConfig {
  endpoint: string;
  connectorToken: string;
  provider: AccountProvider;
  accountId?: string;
  deviceId: string;
  deviceLabel: string;
  intervalSeconds: number;
}

export interface LocalProbeOptions {
  codexBinary?: string;
  claudeBinary?: string;
  codexRunner?: SafeProcessRunnerLike;
  claudeRunner?: SafeProcessRunnerLike;
  now?: () => Date;
}

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`invalid_connector_${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\0')) {
    throw new Error(`invalid_connector_${field}`);
  }
  return normalized;
}

function connectorEndpoint(value: unknown): string {
  const source = requiredText(value, 'endpoint', 2_048);
  let url: URL;
  try { url = new URL(source); } catch { throw new Error('invalid_connector_endpoint'); }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname.toLowerCase());
  if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('invalid_connector_endpoint');
  }
  if (!url.pathname.endsWith(CONNECTOR_PATH_SUFFIX) || url.search || url.hash) {
    throw new Error('invalid_connector_endpoint');
  }
  return url.toString();
}

export function parseMemberLocalConnectorConfig(value: unknown): MemberLocalConnectorConfig {
  const source = object(value);
  if (!source) throw new Error('invalid_connector_config');
  const allowed = new Set(['endpoint', 'connectorToken', 'provider', 'accountId', 'deviceId', 'deviceLabel', 'intervalSeconds']);
  if (Object.keys(source).some(key => !allowed.has(key))) throw new Error('unsupported_connector_config_field');
  if (source.provider !== 'codex' && source.provider !== 'claude') throw new Error('invalid_connector_provider');
  const connectorToken = requiredText(source.connectorToken, 'connector_token', 256);
  if (!/^cdc_[A-Za-z0-9_-]{32,}$/.test(connectorToken)) throw new Error('invalid_connector_token');
  const deviceId = requiredText(source.deviceId, 'device_id', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/.test(deviceId)) throw new Error('invalid_connector_device_id');
  const interval = source.intervalSeconds ?? 60;
  if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 30 || interval > 300) {
    throw new Error('invalid_connector_interval');
  }
  return {
    endpoint: connectorEndpoint(source.endpoint),
    connectorToken,
    provider: source.provider,
    ...(source.accountId === undefined
      ? {}
      : { accountId: connectorIdentifier(source.accountId, 'account_id') }),
    deviceId,
    deviceLabel: requiredText(source.deviceLabel, 'device_label', 100),
    intervalSeconds: interval,
  };
}

function connectorIdentifier(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/.test(normalized)) {
    throw new Error(`invalid_connector_${field}`);
  }
  return normalized;
}

/**
 * The connector token is not a Provider credential, but it can submit team
 * telemetry. Refuse symlinks and group/world-readable files on POSIX hosts.
 */
export async function readMemberLocalConnectorConfig(fileValue: string): Promise<MemberLocalConnectorConfig> {
  const file = path.resolve(fileValue);
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error('unsafe_connector_config_file');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('connector_config_permissions_too_open');
  }
  return parseMemberLocalConnectorConfig(JSON.parse(await fs.readFile(file, 'utf8')) as unknown);
}

function windowReport(value: {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
  windowDurationMins: number | null;
} | null): MemberAccountUsageWindowReport | null {
  if (!value) return null;
  return {
    usedPercent: value.usedPercent,
    remainingPercent: value.remainingPercent,
    resetsAt: value.resetsAt,
    windowDurationMins: value.windowDurationMins,
  };
}

async function probeCodex(options: LocalProbeOptions): Promise<Omit<MemberAccountStateReport, 'provider' | 'deviceId' | 'deviceLabel'>> {
  const binary = options.codexBinary?.trim() || process.env.ACCOUNT_HUB_CODEX_BIN?.trim() || 'codex';
  const runner = options.codexRunner ?? new SafeProcessRunner({ allowedExecutables: [binary] });
  let client: JsonRpcProcessClient | undefined;
  try {
    // Deliberately omit CODEX_HOME: the probe reads the member's existing local
    // login through the official app-server and never copies auth.json.
    client = await JsonRpcProcessClient.connect({
      runner,
      command: binary,
      args: ['app-server', '--stdio'],
      env: {},
      lifetimeMs: CONNECT_TIMEOUT_MS,
      initializeTimeoutMs: 10_000,
      clientName: 'lingshu_member_local_connector',
    });
    const status = publicStatusFromAccount(await client.request(
      'account/read',
      { refreshToken: false },
      REQUEST_TIMEOUT_MS,
    ));
    if (status.state !== 'authenticated') {
      return { state: status.state === 'unauthenticated' ? 'unauthenticated' : 'unknown', usage: null };
    }
    const [rateLimits, tokenUsage] = await Promise.allSettled([
      client.request('account/rateLimits/read', {}, REQUEST_TIMEOUT_MS),
      client.request('account/usage/read', {}, REQUEST_TIMEOUT_MS),
    ]);
    const usage = normalizeCodexUsage(
      rateLimits.status === 'fulfilled' ? rateLimits.value : undefined,
      tokenUsage.status === 'fulfilled' ? tokenUsage.value : undefined,
    );
    const firstLimit = usage.limits[0];
    return {
      state: 'authenticated',
      email: status.account?.email ?? null,
      plan: status.account?.plan ?? firstLimit?.planType ?? null,
      authMode: status.account?.authMode ?? null,
      usage: {
        available: usage.available,
        primary: windowReport(firstLimit?.primary ?? null),
        secondary: windowReport(firstLimit?.secondary ?? null),
        creditsRemaining: usage.creditsRemaining,
        checkedAt: usage.fetchedAt,
        reason: usage.reason ?? null,
      },
    };
  } catch {
    return {
      state: 'error',
      usage: {
        available: false,
        primary: null,
        secondary: null,
        creditsRemaining: null,
        checkedAt: (options.now ?? (() => new Date()))().toISOString(),
        reason: 'local_probe_failed',
      },
    };
  } finally {
    client?.close();
  }
}

async function probeClaude(options: LocalProbeOptions): Promise<Omit<MemberAccountStateReport, 'provider' | 'deviceId' | 'deviceLabel'>> {
  const binary = options.claudeBinary?.trim() || process.env.ACCOUNT_HUB_CLAUDE_BIN?.trim() || 'claude';
  const runner = options.claudeRunner ?? new SafeProcessRunner({ allowedExecutables: [binary] });
  try {
    // No CLAUDE_CONFIG_DIR override: query the member's existing local login.
    const result = await runner.run({
      command: binary,
      args: ['auth', 'status'],
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxOutputBytes: 64_000,
    });
    if (result.reason !== 'exited') return { state: 'error', usage: null };
    const status = parseClaudeAuthStatus(result);
    return {
      state: status.state === 'authenticated'
        ? 'authenticated'
        : status.state === 'unauthenticated'
          ? 'unauthenticated'
          : status.state === 'unknown'
            ? 'unknown'
            : 'error',
      email: status.account?.email ?? null,
      plan: status.account?.plan ?? null,
      authMode: status.account?.authMode ?? null,
      usage: null,
    };
  } catch {
    return { state: 'error', usage: null };
  }
}

export async function probeMemberLocalAccount(
  config: Pick<MemberLocalConnectorConfig, 'provider' | 'deviceId' | 'deviceLabel'>,
  options: LocalProbeOptions = {},
): Promise<MemberAccountStateReport> {
  const state = config.provider === 'codex' ? await probeCodex(options) : await probeClaude(options);
  return {
    provider: config.provider,
    deviceId: config.deviceId,
    deviceLabel: config.deviceLabel,
    ...state,
  };
}

export async function submitMemberLocalAccountState(
  config: MemberLocalConnectorConfig,
  report: MemberAccountStateReport,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(config.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.connectorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(report),
    });
    if (!response.ok) throw new Error(`connector_report_rejected:${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

function accountEndpoint(config: MemberLocalConnectorConfig, action: 'acquire' | 'local-release'): string {
  if (!config.accountId) throw new Error('connector_account_id_required');
  const url = new URL(config.endpoint);
  url.pathname = url.pathname.slice(0, -'account-state'.length)
    + `accounts/${encodeURIComponent(config.accountId)}/${action}`;
  return url.toString();
}

async function postConnectorJson(
  config: MemberLocalConnectorConfig,
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.connectorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`connector_lease_rejected:${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Acquire or renew this device's 15-minute coordination lease. */
export async function acquireMemberLocalLease(
  config: MemberLocalConnectorConfig,
  currentLeaseId?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = object(await postConnectorJson(config, accountEndpoint(config, 'acquire'), {
    deviceId: config.deviceId,
    deviceLabel: config.deviceLabel,
    ...(currentLeaseId ? { leaseId: connectorIdentifier(currentLeaseId, 'lease_id') } : {}),
  }, fetchImpl));
  const lease = object(result?.lease);
  return connectorIdentifier(lease?.leaseId, 'lease_id');
}

/** Release only the coordination lease; this endpoint cannot log out Codex/Claude. */
export async function releaseMemberLocalLease(
  config: MemberLocalConnectorConfig,
  leaseId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await postConnectorJson(config, accountEndpoint(config, 'local-release'), {
    deviceId: config.deviceId,
    leaseId: connectorIdentifier(leaseId, 'lease_id'),
  }, fetchImpl);
}
