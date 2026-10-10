import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  AssistedBrowserTaskGrant,
  AssistedBrowserTaskRecord,
  SocialChannelId,
} from '../../shared/contracts/socialChannels.js';
import { normalizeSocialChannelId } from '../../shared/contracts/socialChannels.js';

export const ASSISTED_BROWSER_DEFAULT_TTL_MS = 5 * 60 * 1_000;
export const ASSISTED_BROWSER_MAX_TTL_MS = 10 * 60 * 1_000;

export class AssistedBrowserSessionError extends Error {
  constructor(readonly code: string, readonly status = 400, message = code) {
    super(message);
    this.name = 'AssistedBrowserSessionError';
  }
}

const text = (value: unknown): string => String(value ?? '').trim();
const validId = (value: unknown): boolean => /^[a-z0-9:_-]{1,200}$/i.test(text(value));
const validHash = (value: unknown): boolean => /^[a-f0-9]{32,128}$/i.test(text(value));
const tokenDigest = (token: string): string => createHash('sha256').update(token).digest('hex');

function assertSafeRequestShape(value: unknown, path = 'request'): void {
  if (!value || typeof value !== 'object') return;
  const forbidden = /(password|passwd|cookie|session[_-]?storage|local[_-]?storage|authorization|access[_-]?token|refresh[_-]?token)/i;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbidden.test(key)) throw new AssistedBrowserSessionError('assisted_browser_secret_field_forbidden');
    if (typeof child === 'object') assertSafeRequestShape(child, `${path}.${key}`);
  }
}

function normalizeLoopbackOrigin(value: unknown): string {
  let url: URL;
  try { url = new URL(text(value)); } catch { throw new AssistedBrowserSessionError('assisted_browser_loopback_required'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || !url.port || url.username || url.password
    || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new AssistedBrowserSessionError('assisted_browser_loopback_required');
  }
  return url.origin;
}

export interface CreateAssistedBrowserTaskInput {
  tenantId: string;
  packageId: string;
  packageHash: string;
  contentHash: string;
  channelId: SocialChannelId | 'tiktok';
  targetAccountId: string;
  requestedBy: string;
  callbackOrigin: string;
  ttlMs?: number;
  now?: Date;
}

export interface CreatedAssistedBrowserTask extends AssistedBrowserTaskGrant {
  /** Server-only persistence projection. Never include it in an HTTP response. */
  record: AssistedBrowserTaskRecord;
}

export function createAssistedBrowserTask(input: CreateAssistedBrowserTaskInput): CreatedAssistedBrowserTask {
  assertSafeRequestShape(input);
  const channelId = normalizeSocialChannelId(input.channelId);
  if (!channelId) throw new AssistedBrowserSessionError('assisted_browser_channel_invalid');
  if (![input.tenantId, input.packageId, input.targetAccountId, input.requestedBy].every(validId)) {
    throw new AssistedBrowserSessionError('assisted_browser_identity_invalid');
  }
  if (!validHash(input.packageHash) || !validHash(input.contentHash)) {
    throw new AssistedBrowserSessionError('assisted_browser_hash_invalid');
  }
  const ttlMs = input.ttlMs ?? ASSISTED_BROWSER_DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > ASSISTED_BROWSER_MAX_TTL_MS) {
    throw new AssistedBrowserSessionError('assisted_browser_ttl_invalid');
  }
  const now = input.now ?? new Date();
  const oneTimeToken = randomBytes(32).toString('base64url');
  const sessionId = `asst_${createHash('sha256').update(`${input.tenantId}:${input.packageId}:${oneTimeToken}`).digest('hex').slice(0, 24)}`;
  const record: AssistedBrowserTaskRecord = {
    schemaVersion: 'assisted-browser-task.v1',
    sessionId,
    tenantId: text(input.tenantId),
    packageId: text(input.packageId),
    packageHash: text(input.packageHash).toLowerCase(),
    contentHash: text(input.contentHash).toLowerCase(),
    channelId,
    targetAccountId: text(input.targetAccountId),
    requestedBy: text(input.requestedBy),
    callbackOrigin: normalizeLoopbackOrigin(input.callbackOrigin),
    tokenDigest: tokenDigest(oneTimeToken),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    status: 'waiting_for_local_helper',
    createdAt: now.toISOString(),
  };
  const { tokenDigest: _notReturned, ...session } = record;
  return { session, oneTimeToken, record };
}

export function claimAssistedBrowserTask(
  record: AssistedBrowserTaskRecord,
  oneTimeToken: string,
  now = new Date(),
): AssistedBrowserTaskRecord {
  if (record.status !== 'waiting_for_local_helper' || record.tokenConsumedAt) {
    throw new AssistedBrowserSessionError('assisted_browser_token_already_used', 409);
  }
  if (new Date(record.expiresAt).getTime() <= now.getTime()) {
    throw new AssistedBrowserSessionError('assisted_browser_session_expired', 410);
  }
  const expected = Buffer.from(record.tokenDigest, 'hex');
  const received = Buffer.from(tokenDigest(text(oneTimeToken)), 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new AssistedBrowserSessionError('assisted_browser_token_invalid', 403);
  }
  return { ...record, tokenConsumedAt: now.toISOString(), status: 'in_progress' };
}

export type AssistedBrowserSafetyStop =
  | 'login_required'
  | 'captcha_required'
  | 'two_factor_required'
  | 'risk_control'
  | 'page_mismatch'
  | 'rate_limited';

export function pauseAssistedBrowserTask(
  record: AssistedBrowserTaskRecord,
  reason: AssistedBrowserSafetyStop,
): AssistedBrowserTaskRecord & { pauseReason: AssistedBrowserSafetyStop } {
  if (!['in_progress', 'awaiting_final_confirmation'].includes(record.status)) {
    throw new AssistedBrowserSessionError('assisted_browser_transition_invalid', 409);
  }
  // A safety stop is terminal for the current helper run. No bypass or guessed
  // click is represented by this protocol.
  return { ...record, status: 'paused_for_user', pauseReason: reason };
}

export function requestAssistedBrowserFinalConfirmation(
  record: AssistedBrowserTaskRecord,
): AssistedBrowserTaskRecord {
  if (record.status !== 'in_progress') {
    throw new AssistedBrowserSessionError('assisted_browser_transition_invalid', 409);
  }
  return { ...record, status: 'awaiting_final_confirmation' };
}

export interface ConfirmAssistedBrowserTaskInput {
  record: AssistedBrowserTaskRecord;
  confirmed: true;
  confirmedBy: string;
  packageHash: string;
  contentHash: string;
  now?: Date;
}

export function confirmAssistedBrowserTask(input: ConfirmAssistedBrowserTaskInput): AssistedBrowserTaskRecord {
  const { record } = input;
  if (record.status !== 'awaiting_final_confirmation') {
    throw new AssistedBrowserSessionError('assisted_browser_confirmation_not_ready', 409);
  }
  if (input.confirmed !== true || !validId(input.confirmedBy)) {
    throw new AssistedBrowserSessionError('assisted_browser_explicit_confirmation_required');
  }
  if (text(input.packageHash).toLowerCase() !== record.packageHash
    || text(input.contentHash).toLowerCase() !== record.contentHash) {
    throw new AssistedBrowserSessionError('assisted_browser_frozen_version_mismatch', 409);
  }
  const confirmedAt = (input.now ?? new Date()).toISOString();
  return {
    ...record,
    status: 'confirmation_received',
    finalConfirmation: {
      confirmedBy: text(input.confirmedBy),
      confirmedAt,
      packageHash: record.packageHash,
      contentHash: record.contentHash,
    },
  };
}

export function markAssistedBrowserEvidencePending(record: AssistedBrowserTaskRecord): AssistedBrowserTaskRecord {
  if (record.status !== 'confirmation_received' || !record.finalConfirmation) {
    throw new AssistedBrowserSessionError('assisted_browser_final_confirmation_required', 409);
  }
  // This does not assert that the platform accepted or published the content.
  return { ...record, status: 'evidence_pending' };
}
