import crypto from 'node:crypto';
import { store as defaultStore, type DataStore, type Where } from '../storage/index.js';
import type { TenantPlatform } from './tenantPlatformApps.js';
import { writeAuditLog } from './auditLog.js';

export type AssistLinkPlatform = Exclude<TenantPlatform, 'wecom'>;
export type AssistLinkStatus = 'pending' | 'claimed' | 'consumed' | 'revoked';

export interface AssistLinkRecord {
  [key: string]: unknown;
  id: string;
  /** Legacy plaintext field. Hardened records must always leave it empty. */
  token?: string;
  token_hash?: string;
  token_prefix?: string;
  token_last4?: string;
  tenant_id: string;
  platform: AssistLinkPlatform;
  status?: AssistLinkStatus;
  expires_at: string;
  claimed_at?: string;
  claim_expires_at?: string;
  claim_nonce_hash?: string;
  used_at?: string;
  revoked_at?: string;
  created_by?: string;
  revision?: number;
  connected_account_id?: string;
  connected_account_count?: number;
}

export interface AssistOAuthClaim {
  linkId: string;
  claimNonce: string;
  revision: number;
  platform: AssistLinkPlatform;
}

export type AssistClaimResult =
  | { ok: true; record: AssistLinkRecord; claim: AssistOAuthClaim; reclaimedExpiredClaim: boolean }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_consumed' | 'revoked' | 'claim_in_progress' | 'conflict' | 'legacy_record' };

export type AssistClaimValidation =
  | { ok: true; record: AssistLinkRecord }
  | { ok: false; reason: 'not_found' | 'invalid_binding' | 'expired' | 'not_claimed' | 'legacy_record' };

const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const CLAIM_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ASSIST_CLAIM_TTL_MS = 10 * 60 * 1000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function revisionOf(record: AssistLinkRecord): number {
  const revision = Number(record.revision ?? 0);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function expiredAt(value: unknown, now: number): boolean {
  const timestamp = Date.parse(text(value));
  return !Number.isFinite(timestamp) || timestamp <= now;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isHardenedRecord(record: AssistLinkRecord): boolean {
  return !text(record.token) && TOKEN_HASH_PATTERN.test(text(record.token_hash));
}

export function assistSecretHash(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function generateAssistLinkToken(): { rawToken: string; tokenHash: string; tokenPrefix: string; tokenLast4: string } {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  return {
    rawToken,
    tokenHash: assistSecretHash(rawToken),
    tokenPrefix: rawToken.slice(0, 6),
    tokenLast4: rawToken.slice(-4),
  };
}

export function oauthPlatformForAssistPlatform(platform: AssistLinkPlatform): 'youtube' | 'facebook' | 'tiktok' {
  if (platform === 'google') return 'youtube';
  if (platform === 'meta') return 'facebook';
  return 'tiktok';
}

export function publicAssistLinkStatus(record: AssistLinkRecord, now = Date.now()) {
  const expired = expiredAt(record.expires_at, now);
  const staleClaim = record.status === 'claimed' && expiredAt(record.claim_expires_at, now);
  const consumed = record.status === 'consumed' && Boolean(text(record.used_at));
  const revoked = record.status === 'revoked';
  return {
    platform: record.platform,
    platformName: record.platform === 'meta'
      ? 'Meta / Facebook / Instagram'
      : record.platform === 'google'
        ? 'Google / YouTube'
        : 'TikTok',
    expiresAt: record.expires_at,
    usedAt: consumed ? text(record.used_at) : '',
    status: record.status || 'revoked',
    valid: !expired && !revoked && !consumed,
    canStart: !expired && !revoked && !consumed && (record.status === 'pending' || staleClaim),
  };
}

export async function recordAssistLinkAudit(
  record: AssistLinkRecord,
  action: 'assist_link.created' | 'assist_link.claimed' | 'assist_link.released' | 'assist_link.consumed',
  input: { actorUserId?: string; actorEmail?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await writeAuditLog({
    tenantId: record.tenant_id,
    actorUserId: text(input.actorUserId) || `assist-link:${record.id}`,
    actorEmail: text(input.actorEmail),
    action,
    targetType: 'assist_link',
    targetId: record.id,
    metadata: {
      platform: record.platform,
      revision: revisionOf(record),
      ...(input.metadata || {}),
    },
  });
}

export async function findAssistLinkByRawToken(
  rawToken: string,
  dataStore: DataStore = defaultStore,
): Promise<AssistLinkRecord | null> {
  const token = text(rawToken);
  if (!CLAIM_NONCE_PATTERN.test(token)) return null;
  const tokenHash = assistSecretHash(token);
  const result = await dataStore.list<AssistLinkRecord>('assist_links', {
    where: { token_hash: tokenHash },
    perPage: 1,
  });
  const record = result.items[0] ?? null;
  if (!record || !isHardenedRecord(record)) return null;
  return safeEqual(text(record.token_hash), tokenHash) ? record : null;
}

export async function claimAssistLink(
  record: AssistLinkRecord,
  dataStore: DataStore = defaultStore,
  now = Date.now(),
): Promise<AssistClaimResult> {
  if (!isHardenedRecord(record)) return { ok: false, reason: 'legacy_record' };
  if (expiredAt(record.expires_at, now)) return { ok: false, reason: 'expired' };
  if (record.status === 'consumed' || text(record.used_at)) return { ok: false, reason: 'already_consumed' };
  if (record.status === 'revoked') return { ok: false, reason: 'revoked' };

  const currentRevision = revisionOf(record);
  const claimNonce = crypto.randomBytes(32).toString('base64url');
  const claimNonceHash = assistSecretHash(claimNonce);
  const claimedAt = new Date(now).toISOString();
  const claimExpiresAt = new Date(Math.min(now + ASSIST_CLAIM_TTL_MS, Date.parse(record.expires_at))).toISOString();
  const reclaimedExpiredClaim = record.status === 'claimed' && expiredAt(record.claim_expires_at, now);

  if (record.status === 'claimed' && !reclaimedExpiredClaim) {
    return { ok: false, reason: 'claim_in_progress' };
  }
  if (record.status !== 'pending' && !reclaimedExpiredClaim) {
    return { ok: false, reason: 'legacy_record' };
  }

  const expected: Where = record.status === 'pending'
    ? { status: 'pending', revision: currentRevision, token_hash: text(record.token_hash) }
    : {
      status: 'claimed',
      revision: currentRevision,
      claim_nonce_hash: text(record.claim_nonce_hash),
      claim_expires_at: text(record.claim_expires_at),
    };
  const changed = await dataStore.compareAndSet<AssistLinkRecord>('assist_links', record.id, expected, {
    status: 'claimed',
    claimed_at: claimedAt,
    claim_expires_at: claimExpiresAt,
    claim_nonce_hash: claimNonceHash,
    revision: currentRevision + 1,
  });
  if (!changed.ok) return { ok: false, reason: changed.reason === 'not_found' ? 'not_found' : 'conflict' };

  return {
    ok: true,
    record: changed.record,
    claim: {
      linkId: changed.record.id,
      claimNonce,
      revision: currentRevision + 1,
      platform: changed.record.platform,
    },
    reclaimedExpiredClaim,
  };
}

export async function validateAssistOAuthClaim(
  input: {
    tenantId: string;
    oauthPlatform: string;
    claim: AssistOAuthClaim;
  },
  dataStore: DataStore = defaultStore,
  now = Date.now(),
): Promise<AssistClaimValidation> {
  if (!input.claim?.linkId || !CLAIM_NONCE_PATTERN.test(text(input.claim.claimNonce))) {
    return { ok: false, reason: 'invalid_binding' };
  }
  if (!Number.isSafeInteger(input.claim.revision) || input.claim.revision < 1) {
    return { ok: false, reason: 'invalid_binding' };
  }
  const record = await dataStore.getById<AssistLinkRecord>('assist_links', input.claim.linkId);
  if (!record) return { ok: false, reason: 'not_found' };
  if (!isHardenedRecord(record)) return { ok: false, reason: 'legacy_record' };
  if (record.status !== 'claimed') return { ok: false, reason: 'not_claimed' };
  if (expiredAt(record.expires_at, now) || expiredAt(record.claim_expires_at, now)) {
    return { ok: false, reason: 'expired' };
  }

  const bindingMatches = record.tenant_id === input.tenantId
    && record.platform === input.claim.platform
    && oauthPlatformForAssistPlatform(record.platform) === input.oauthPlatform
    && revisionOf(record) === input.claim.revision
    && safeEqual(text(record.claim_nonce_hash), assistSecretHash(input.claim.claimNonce));
  return bindingMatches ? { ok: true, record } : { ok: false, reason: 'invalid_binding' };
}

export async function consumeAssistOAuthClaim(
  input: {
    tenantId: string;
    oauthPlatform: string;
    claim: AssistOAuthClaim;
    connectedAccountId: string;
    connectedAccountCount?: number;
  },
  dataStore: DataStore = defaultStore,
  now = Date.now(),
): Promise<AssistClaimValidation> {
  const valid = await validateAssistOAuthClaim(input, dataStore, now);
  if (!valid.ok) return valid;
  const record = valid.record;
  const changed = await dataStore.compareAndSet<AssistLinkRecord>('assist_links', record.id, {
    status: 'claimed',
    revision: input.claim.revision,
    claim_nonce_hash: text(record.claim_nonce_hash),
    tenant_id: input.tenantId,
    platform: input.claim.platform,
  }, {
    status: 'consumed',
    used_at: new Date(now).toISOString(),
    claim_nonce_hash: '',
    claim_expires_at: '',
    connected_account_id: text(input.connectedAccountId),
    connected_account_count: Math.max(1, Number(input.connectedAccountCount || 1)),
    revision: input.claim.revision + 1,
  });
  return changed.ok ? { ok: true, record: changed.record } : {
    ok: false,
    reason: changed.reason === 'not_found' ? 'not_found' : 'not_claimed',
  };
}

export async function releaseAssistOAuthClaim(
  input: { tenantId: string; oauthPlatform: string; claim: AssistOAuthClaim },
  dataStore: DataStore = defaultStore,
  now = Date.now(),
): Promise<AssistClaimValidation> {
  const valid = await validateAssistOAuthClaim(input, dataStore, now);
  if (!valid.ok) return valid;
  const record = valid.record;
  const changed = await dataStore.compareAndSet<AssistLinkRecord>('assist_links', record.id, {
    status: 'claimed',
    revision: input.claim.revision,
    claim_nonce_hash: text(record.claim_nonce_hash),
    tenant_id: input.tenantId,
    platform: input.claim.platform,
  }, {
    status: 'pending',
    claimed_at: '',
    claim_expires_at: '',
    claim_nonce_hash: '',
    revision: input.claim.revision + 1,
  });
  return changed.ok ? { ok: true, record: changed.record } : {
    ok: false,
    reason: changed.reason === 'not_found' ? 'not_found' : 'not_claimed',
  };
}
