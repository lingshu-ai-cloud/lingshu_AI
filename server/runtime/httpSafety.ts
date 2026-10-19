import { createHash, randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { Identity } from '../storage/datastore.js';

interface RateLimitBucket {
  count: number;
  resetAt: number;
  touchedAt: number;
  exemptionChecks: number;
}

export type RateLimitIdentityVerifier = (authorization: string | undefined) => Promise<Identity | null>;

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  maxKeys?: number;
  now?: () => number;
  verifyIdentity?: RateLimitIdentityVerifier;
  exemptTenantIds?: ReadonlySet<string>;
  exemptUserIds?: ReadonlySet<string>;
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function apiRateLimitConfig() {
  return {
    windowMs: positiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000, 3_600_000),
    limit: positiveInteger(process.env.API_RATE_LIMIT_REQUESTS, 300, 10_000),
    maxKeys: positiveInteger(process.env.API_RATE_LIMIT_MAX_KEYS, 20_000, 200_000),
    exemptTenantIds: exactPrincipalIds(process.env.API_RATE_LIMIT_EXEMPT_TENANT_IDS),
    exemptUserIds: exactPrincipalIds(process.env.API_RATE_LIMIT_EXEMPT_USER_IDS),
  };
}

function exactPrincipalIds(value: unknown): ReadonlySet<string> {
  return new Set(
    String(value ?? '')
      .split(',')
      .map(item => item.trim())
      // These are opaque server-side IDs, not patterns or email addresses.
      // Rejecting wildcard characters keeps the exemption exact by design.
      .filter(item => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item)),
  );
}

function requestPrincipal(req: Pick<Request, 'ip' | 'socket'>): string {
  // This middleware runs before authentication, so an Authorization header is
  // untrusted input. Keying on it would let an attacker rotate garbage bearer
  // values to bypass the overload guard.
  return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
}

/**
 * Per-process overload guard. Production still needs an edge/distributed limit,
 * but this prevents one client from exhausting a single Node worker first.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const buckets = new Map<string, RateLimitBucket>();
  const now = options.now ?? Date.now;
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 20_000));
  const exemptTenantIds = options.exemptTenantIds ?? new Set<string>();
  const exemptUserIds = options.exemptUserIds ?? new Set<string>();
  const canResolveExemption = !!options.verifyIdentity && (exemptTenantIds.size > 0 || exemptUserIds.size > 0);
  const verifiedExemptions = new Map<string, number>();
  const exemptionRequests = new Map<string, Promise<boolean>>();
  const maxExemptionChecksPerWindow = Math.min(
    1_000,
    Math.max(32, Math.ceil(options.windowMs / 5_000) + 4),
  );
  let requestsSincePrune = 0;

  const prune = (timestamp: number) => {
    // Map insertion order is maintained as LRU order below. Inspect a bounded
    // prefix instead of scanning/sorting the entire attacker-controlled map.
    for (let inspected = 0; inspected < 500; inspected += 1) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = buckets.get(oldestKey);
      if (!oldest || oldest.resetAt <= timestamp) buckets.delete(oldestKey);
      else break;
    }
    while (buckets.size >= maxKeys) {
      const oldestKey = buckets.keys().next().value as string | undefined;
      if (!oldestKey) break;
      buckets.delete(oldestKey);
    }
    for (const [key, expiresAt] of verifiedExemptions) {
      if (expiresAt <= timestamp) verifiedExemptions.delete(key);
    }
    while (verifiedExemptions.size >= maxKeys) {
      const oldestKey = verifiedExemptions.keys().next().value as string | undefined;
      if (!oldestKey) break;
      verifiedExemptions.delete(oldestKey);
    }
  };

  const verifiedExemption = async (
    req: Request,
    bucket: RateLimitBucket,
    timestamp: number,
  ): Promise<boolean> => {
    if (!canResolveExemption) return false;
    const authorization = typeof req.headers.authorization === 'string'
      ? req.headers.authorization.trim()
      : '';
    if (!authorization || authorization.length > 8_192 || !/^Bearer\s+\S+/i.test(authorization)) return false;
    const key = createHash('sha256').update(authorization).digest('base64url');
    const cachedUntil = verifiedExemptions.get(key);
    if (cachedUntil && cachedUntil > timestamp) {
      verifiedExemptions.delete(key);
      verifiedExemptions.set(key, cachedUntil);
      return true;
    }
    const inFlight = exemptionRequests.get(key);
    if (inFlight) return inFlight;
    // Do not let an attacker rotate arbitrary bearer strings into an unbounded
    // authentication-provider workload after the IP guard has fired.
    if (bucket.exemptionChecks >= maxExemptionChecksPerWindow) return false;
    bucket.exemptionChecks += 1;
    const request = (async () => {
      try {
        const identity = await options.verifyIdentity!(authorization);
        const allowed = !!identity && (
          exemptTenantIds.has(identity.tenantId)
          || exemptUserIds.has(identity.userId)
        );
        if (allowed) {
          // Keep this cache no broader than the auth verifier's normal bounded
          // revocation window. The protected route will still authenticate.
          verifiedExemptions.set(key, timestamp + Math.min(options.windowMs, 5_000));
        }
        return allowed;
      } catch {
        // Authentication outages or malformed credentials must fail closed:
        // they never turn a rate-limited request into an exempt one.
        return false;
      }
    })();
    exemptionRequests.set(key, request);
    try {
      return await request;
    } finally {
      if (exemptionRequests.get(key) === request) exemptionRequests.delete(key);
    }
  };

  const reject = (res: Response, timestamp: number, resetAt: number) => {
    const retryAfter = Math.max(1, Math.ceil((resetAt - timestamp) / 1_000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'rate_limit_exceeded', retryAfterSeconds: retryAfter });
  };

  return (req, res, next) => {
    const timestamp = now();
    requestsSincePrune += 1;
    if (requestsSincePrune >= 500 || buckets.size > maxKeys) {
      requestsSincePrune = 0;
      prune(timestamp);
    }
    const key = requestPrincipal(req);
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAt <= timestamp
      ? { count: 0, resetAt: timestamp + options.windowMs, touchedAt: timestamp, exemptionChecks: 0 }
      : existing;
    bucket.count += 1;
    bucket.touchedAt = timestamp;
    // Refresh insertion order so bounded eviction is true LRU rather than an
    // O(n) minimum search on every new attacker-controlled key.
    buckets.delete(key);
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.limit - bucket.count);
    res.setHeader('RateLimit-Limit', String(options.limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1_000)));
    if (bucket.count <= options.limit) {
      next();
      return;
    }
    if (!canResolveExemption) {
      reject(res, timestamp, bucket.resetAt);
      return;
    }
    void verifiedExemption(req, bucket, timestamp).then(exempt => {
      if (exempt) next();
      else reject(res, timestamp, bucket.resetAt);
    });
  };
}

export const requestSafetyHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // Recording a voice sample and capturing source media are first-party studio
  // features. Keep powerful APIs scoped to this origin instead of disabling
  // those workflows for every browser.
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  if (!res.getHeader('X-Request-Id')) res.setHeader('X-Request-Id', randomUUID());
  next();
};

export function jsonBodyLimits() {
  return {
    default: positiveInteger(process.env.DEFAULT_JSON_BODY_LIMIT_MB, 2, 8),
    legacyUpload: positiveInteger(process.env.LEGACY_JSON_UPLOAD_LIMIT_MB, 32, 64),
    voiceUpload: positiveInteger(process.env.VOICE_JSON_UPLOAD_LIMIT_MB, 24, 32),
  };
}

export function configureHttpServer(server: {
  requestTimeout: number;
  headersTimeout: number;
  keepAliveTimeout: number;
  maxRequestsPerSocket: number | null;
}): void {
  server.requestTimeout = positiveInteger(process.env.HTTP_REQUEST_TIMEOUT_MS, 15 * 60_000, 30 * 60_000);
  server.headersTimeout = positiveInteger(process.env.HTTP_HEADERS_TIMEOUT_MS, 15_000, 120_000);
  server.keepAliveTimeout = positiveInteger(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000, 60_000);
  server.maxRequestsPerSocket = positiveInteger(process.env.HTTP_MAX_REQUESTS_PER_SOCKET, 1_000, 10_000);
}

export function sendServiceUnavailable(res: Response, issues: string[]): void {
  res.status(503).json({ status: 'degraded', issues });
}
