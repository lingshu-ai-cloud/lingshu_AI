import type { Response } from 'express';
import { randomBytes } from 'node:crypto';

export function safeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function normalizeOAuthReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const candidate = value.trim();
  if (!candidate || candidate.length > 300 || !candidate.startsWith('/') || candidate.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(candidate)) return '/';
  try {
    const base = new URL('https://oauth-return.invalid');
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin || parsed.username || parsed.password) return '/';
    return `${parsed.pathname}${parsed.search}`.slice(0, 300);
  } catch {
    return '/';
  }
}

export function secureOAuthCallbackResponse(res: Response): string {
  const nonce = randomBytes(18).toString('base64url');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  );
  return nonce;
}
