import type { NextFunction, Request, Response } from 'express';
import { incrementMetric } from './observability.js';

type Bucket = { count: number; resetsAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

export function fixedWindowRateLimit(options: {
  name: string;
  limit: number;
  windowMs?: number;
  key?: (req: Request) => string;
}) {
  const windowMs = Math.max(1_000, options.windowMs ?? 60_000);
  const limit = Math.max(1, options.limit);
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const identity = options.key?.(req) || req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.name}:${identity}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetsAt <= now) {
      bucket = { count: 0, resetsAt: now + windowMs };
      if (buckets.size >= MAX_BUCKETS) {
        for (const [candidate, value] of buckets) {
          if (value.resetsAt <= now) buckets.delete(candidate);
          if (buckets.size < MAX_BUCKETS) break;
        }
        if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value as string);
      }
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetsAt / 1_000)));
    if (bucket.count > limit) {
      incrementMetric('http_rate_limited_total', { limiter: options.name });
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetsAt - now) / 1_000))));
      res.status(429).json({ error: 'rate_limit_exceeded' });
      return;
    }
    next();
  };
}
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}
