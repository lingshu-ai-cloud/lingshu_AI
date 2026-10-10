import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';

interface RateLimitBucket {
  count: number;
  resetAt: number;
  touchedAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  maxKeys?: number;
  now?: () => number;
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
  };
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
      ? { count: 0, resetAt: timestamp + options.windowMs, touchedAt: timestamp }
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
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'rate_limit_exceeded', retryAfterSeconds: retryAfter });
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
