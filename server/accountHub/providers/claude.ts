import type { SafeProcessResult } from './safeProcess.js';
import type { AccountProviderStatus } from './types.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function nestedRecord(source: UnknownRecord | undefined, ...keys: string[]): UnknownRecord | undefined {
  for (const key of keys) {
    const found = record(source?.[key]);
    if (found) return found;
  }
  return undefined;
}

function stringField(source: UnknownRecord | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function booleanField(source: UnknownRecord | undefined, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof source?.[key] === 'boolean') return source[key] as boolean;
  }
  return undefined;
}

function parseJsonOutput(output: string): UnknownRecord | undefined {
  const candidates = [output.trim(), ...output.trim().split(/\r?\n/).reverse()];
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      const value = record(JSON.parse(candidate));
      if (value) return value;
    } catch { /* fall back to conservative text parsing */ }
  }
  return undefined;
}

/** Selects credential-free identity metadata from `claude auth status`. */
export function parseClaudeAuthStatus(result: Pick<SafeProcessResult, 'code' | 'stdout' | 'stderr'>): AccountProviderStatus {
  const output = `${result.stdout}\n${result.stderr}`.trim();
  const json = parseJsonOutput(result.stdout) ?? parseJsonOutput(result.stderr);
  const value = nestedRecord(json, 'account', 'data') ?? json;
  const explicit = booleanField(value, 'loggedIn', 'logged_in', 'authenticated', 'isAuthenticated');
  const statusValue = stringField(value, 'status', 'state')?.toLowerCase();
  const authenticated = explicit
    ?? (statusValue ? ['logged_in', 'authenticated', 'active', 'success'].includes(statusValue) : undefined);

  if (authenticated === true || (authenticated === undefined && result.code === 0 && Boolean(json))) {
    return {
      provider: 'claude',
      state: 'authenticated',
      cliAvailable: true,
      account: {
        email: stringField(value, 'email', 'userEmail'),
        plan: stringField(value, 'subscriptionType', 'subscription', 'planType', 'plan'),
        authMode: stringField(value, 'authMethod', 'authMode', 'apiProvider', 'provider'),
      },
    };
  }
  if (
    authenticated === false
    || /\b(not logged in|not authenticated|logged out|authentication required)\b/i.test(output)
    || result.code === 1
  ) return { provider: 'claude', state: 'unauthenticated', cliAvailable: true };

  if (/\b(logged in|authenticated as|authentication: active)\b/i.test(output)) {
    const email = output.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0];
    return {
      provider: 'claude', state: 'authenticated', cliAvailable: true,
      ...(email ? { account: { email } } : {}),
    };
  }
  return { provider: 'claude', state: 'unknown', cliAvailable: true, reason: 'status_unrecognized' };
}
