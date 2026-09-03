import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const META_VERIFY_TOKEN_PREFIX = 'sha256:';

export function generateWebhookVerifyToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashMetaWebhookVerifyToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length < 24 || normalized.length > 256) throw new Error('webhook_verify_token_invalid');
  return hashNormalizedMetaWebhookVerifyToken(normalized);
}

function hashNormalizedMetaWebhookVerifyToken(normalized: string): string {
  return `${META_VERIFY_TOKEN_PREFIX}${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

/** Compatibility-only conversion for a pre-hardening plaintext token. */
export function hashLegacyMetaWebhookVerifyToken(token: string): string {
  const normalized = token.trim();
  if (!normalized || normalized.length > 256) throw new Error('webhook_verify_token_invalid');
  return hashNormalizedMetaWebhookVerifyToken(normalized);
}

export function isMetaWebhookVerifyTokenHash(value: unknown): boolean {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}

export function verifyMetaWebhookVerifyToken(storedHash: unknown, suppliedToken: unknown): boolean {
  if (!isMetaWebhookVerifyTokenHash(storedHash) || typeof suppliedToken !== 'string') return false;
  const normalized = suppliedToken.trim();
  // Existing installations may have used a shorter token. New writes enforce
  // 24+ characters, while verification remains compatible with the one-way
  // digest produced during lazy legacy hardening.
  if (!normalized || normalized.length > 256) return false;
  const candidate = hashNormalizedMetaWebhookVerifyToken(normalized);
  const expected = Buffer.from(String(storedHash).toLowerCase(), 'utf8');
  const supplied = Buffer.from(candidate.toLowerCase(), 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
