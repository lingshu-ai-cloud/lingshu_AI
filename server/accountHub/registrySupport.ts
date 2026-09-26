import { createHash } from 'node:crypto';
import { assertValidAccountId } from './paths.js';
import { containsCredentialLikeText, isStrictSafeLabel } from './safeText.js';
import type { AccountLease, AccountProvider, AccountRecord, AccountStatus, AccountStatusReason, ProviderIdentityClaim } from './types.js';

export interface LegacyTaskSummary { id: string; accountId: string; provider: AccountProvider; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; createdAt: string; updatedAt: string; startedAt?: string; finishedAt?: string }
export interface RegistryDocument { schemaVersion: 1; accounts: Record<string, AccountRecord>; tasks: Record<string, LegacyTaskSummary>; leases: Record<string, AccountLease>; identityClaims: Record<string, ProviderIdentityClaim> }
export interface AccountRegistryOptions { dataDir?: string; now?: () => Date }
export const ACCOUNT_STATUSES = new Set<AccountStatus>(['pending_login', 'ready', 'busy', 'cooldown', 'reauthorization_required', 'disabled', 'error']);
export const ACCOUNT_STATUS_REASONS = new Set<AccountStatusReason>(['login_required', 'authorization_expired', 'rate_limited', 'subscription_inactive', 'provider_unavailable', 'operator_disabled', 'unknown']);
export const PROVIDERS = new Set<AccountProvider>(['codex', 'claude']);
export const LEGACY_TASK_STATUSES = new Set<LegacyTaskSummary['status']>(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const MEMBER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/; export const DEVICE_ID_PATTERN = MEMBER_ID_PATTERN;
const SENSITIVE_KEY = /(password|passwd|passphrase|cookie|token|secret|credential|api[_-]?key|authorization|auth[_-]?json|private[_-]?key|session[_-]?key)/i;

export const emptyDocument = (): RegistryDocument => ({ schemaVersion: 1, accounts: {}, tasks: {}, leases: {}, identityClaims: {} });
export function assertPlainObject(value: unknown, context: string): asserts value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} must be a plain object`); }
export function assertNoCredentialMaterial(value: unknown): void {
  const visited = new WeakSet<object>(); const visit = (current: unknown): void => {
    if (typeof current === 'string') { if (containsCredentialLikeText(current)) throw new Error('Credential material is forbidden in account registry string value'); return; }
    if (!current || typeof current !== 'object' || visited.has(current)) return; visited.add(current);
    for (const [key, child] of Object.entries(current)) { if (SENSITIVE_KEY.test(key)) throw new Error(`Credential material is forbidden in account registry field: ${key}`); visit(child); }
  }; visit(value);
}
export function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void { const allowedSet = new Set(allowed); const unexpected = Object.keys(value).find(key => !allowedSet.has(key)); if (unexpected) throw new Error(`Unsupported ${context} field: ${unexpected}`); }
export function requiredString(value: unknown, field: string, maxLength = 200): string { if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`Invalid ${field}`); return value; }
export function strictSafeLabel(value: unknown, field: string, maxLength: number): string { const normalized = requiredString(value, field, maxLength).trim(); if (!isStrictSafeLabel(normalized)) throw new Error(`Invalid ${field}`); return normalized; }
export function requiredIdentifier(value: unknown, field: string, pattern: RegExp): string { const identifier = requiredString(value, field, 128); if (!pattern.test(identifier)) throw new Error(`Invalid ${field}`); return identifier; }
export function requiredNonNegativeInteger(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid ${field}`); return value as number; }
export function optionalIsoDate(value: unknown, field: string): string | undefined { if (value === undefined) return undefined; if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${field}`); return value; }
export function requiredIsoDate(value: unknown, field: string): string { const parsed = optionalIsoDate(value, field); if (!parsed) throw new Error(`Invalid ${field}`); return parsed; }
export const hasOwn = (index: object, key: string): boolean => Object.prototype.hasOwnProperty.call(index, key);
export function parseEmail(value: unknown): string { const email = requiredString(value, 'email', 254).trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email'); return email; }
export const providerIdentityHash = (provider: AccountProvider, email: string): string => createHash('sha256').update(`${provider}\0${email.trim().toLowerCase()}`).digest('hex');
export const isLeaseExpired = (lease: AccountLease, now: Date): boolean => Date.parse(lease.expiresAt) <= now.getTime();
export const delay = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
export const clone = <T>(value: T): T => structuredClone(value);
export class AccountLeaseConflictError extends Error { constructor(readonly lease: AccountLease) { super('Account is already in use by another device'); this.name = 'AccountLeaseConflictError'; } }
export class AccountDisabledError extends Error { constructor(readonly accountId: string) { super('Account is disabled'); this.name = 'AccountDisabledError'; } }
export class AccountNotReadyError extends Error { constructor(readonly accountId: string, readonly status: AccountStatus) { super('Account is not ready for lease acquisition'); this.name = 'AccountNotReadyError'; } }
export class AccountBindingChangedError extends Error { constructor(readonly accountId: string, readonly actualMemberId: string, readonly actualBindingGeneration: number) { super('Account owner or binding generation changed'); this.name = 'AccountBindingChangedError'; } }
export class AccountReassignmentStateError extends Error { constructor(readonly accountId: string, readonly status: AccountStatus) { super('Account is not in a logged-out state for reassignment'); this.name = 'AccountReassignmentStateError'; } }
