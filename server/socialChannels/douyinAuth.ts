import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import {
  acquireDurableOperationLease,
  releaseDurableOperationLease,
} from '../runtime/durableLease.js';

export const DOUYIN_ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 24 * 60 * 60;
export const DOUYIN_REFRESH_TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const DOUYIN_OAUTH_STATE_TTL_MS = 10 * 60 * 1_000;

export class DouyinAuthError extends Error {
  constructor(readonly code: string, readonly status = 400, message = code) {
    super(message);
    this.name = 'DouyinAuthError';
  }
}

export interface DouyinOAuthStateRecord {
  stateId: string;
  tenantId: string;
  userId: string;
  stateDigest: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface DouyinOAuthStateGrant {
  state: string;
  record: DouyinOAuthStateRecord;
}

const text = (value: unknown): string => String(value ?? '').trim();
const validId = (value: unknown): boolean => /^[a-z0-9:_-]{1,200}$/i.test(text(value));
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function safeRedirectUri(value: unknown): string {
  let url: URL;
  try { url = new URL(text(value)); } catch { throw new DouyinAuthError('douyin_oauth_redirect_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new DouyinAuthError('douyin_oauth_redirect_invalid');
  }
  return url.toString();
}

export function issueDouyinOAuthState(input: {
  tenantId: string;
  userId: string;
  redirectUri: string;
  now?: Date;
}): DouyinOAuthStateGrant {
  if (!validId(input.tenantId) || !validId(input.userId)) {
    throw new DouyinAuthError('douyin_oauth_identity_invalid');
  }
  const now = input.now ?? new Date();
  const state = randomBytes(32).toString('base64url');
  const stateDigest = digest(state);
  return {
    state,
    record: {
      stateId: `dystate_${stateDigest.slice(0, 24)}`,
      tenantId: text(input.tenantId),
      userId: text(input.userId),
      stateDigest,
      redirectUri: safeRedirectUri(input.redirectUri),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + DOUYIN_OAUTH_STATE_TTL_MS).toISOString(),
    },
  };
}

/** Validates an authorization-code callback and consumes the state once. */
export function consumeDouyinOAuthState(input: {
  record: DouyinOAuthStateRecord;
  state: string;
  code: string;
  now?: Date;
}): DouyinOAuthStateRecord {
  if (!text(input.code)) throw new DouyinAuthError('douyin_oauth_authorization_code_required');
  if (input.record.consumedAt) throw new DouyinAuthError('douyin_oauth_state_already_used', 409);
  const now = input.now ?? new Date();
  if (new Date(input.record.expiresAt).getTime() <= now.getTime()) {
    throw new DouyinAuthError('douyin_oauth_state_expired', 410);
  }
  const expected = Buffer.from(input.record.stateDigest, 'hex');
  const received = Buffer.from(digest(text(input.state)), 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new DouyinAuthError('douyin_oauth_state_invalid', 403);
  }
  return { ...input.record, consumedAt: now.toISOString() };
}

export interface DouyinTokenMetadata {
  accountId: string;
  tokenType: 'user_access_token';
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  grantedScopes: string[];
}

/**
 * Validates only token metadata. Raw access/refresh tokens must be written to
 * the repository's encrypted secret store and are intentionally absent here.
 */
export function validateDouyinTokenMetadata(input: DouyinTokenMetadata, now = new Date()): DouyinTokenMetadata {
  if (!validId(input.accountId) || input.tokenType !== 'user_access_token') {
    throw new DouyinAuthError('douyin_token_metadata_invalid');
  }
  const accessMs = new Date(input.accessTokenExpiresAt).getTime();
  const refreshMs = new Date(input.refreshTokenExpiresAt).getTime();
  if (!Number.isFinite(accessMs) || !Number.isFinite(refreshMs)
    || accessMs <= now.getTime() || refreshMs <= accessMs
    || accessMs - now.getTime() > DOUYIN_ACCESS_TOKEN_LIFETIME_SECONDS * 1_000 + 60_000
    || refreshMs - now.getTime() > DOUYIN_REFRESH_TOKEN_LIFETIME_SECONDS * 1_000 + 60_000) {
    throw new DouyinAuthError('douyin_token_lifetime_invalid');
  }
  return {
    ...input,
    grantedScopes: [...new Set(input.grantedScopes.map(text).filter(Boolean))].sort(),
  };
}

/** Coalesces concurrent refreshes for exactly one tenant/account pair. */
export class DouyinAccountRefreshLock {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dataStore: DataStore = store,
    private readonly ownerId = `douyin-refresh:${process.pid}:${randomUUID()}`,
  ) {}

  run<T>(tenantId: string, accountId: string, refresh: () => Promise<T>): Promise<T> {
    if (!validId(tenantId) || !validId(accountId)) {
      return Promise.reject(new DouyinAuthError('douyin_refresh_identity_invalid'));
    }
    const key = `${text(tenantId)}\u0000${text(accountId)}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const running = Promise.resolve().then(async () => {
      const lease = await acquireDurableOperationLease({
        dataStore: this.dataStore,
        tenantId: text(tenantId),
        scope: 'douyin-token-refresh',
        subjectId: text(accountId),
        ownerId: this.ownerId,
        leaseDurationMs: 2 * 60_000,
      });
      if (!lease) throw new DouyinAuthError('douyin_token_refresh_in_progress', 409);
      try { return await refresh(); } finally {
        await releaseDurableOperationLease({ dataStore: this.dataStore, lease });
      }
    });
    this.inFlight.set(key, running);
    void running.finally(() => {
      if (this.inFlight.get(key) === running) this.inFlight.delete(key);
    }).catch(() => undefined);
    return running;
  }
}
