import type { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { auth } from '../storage/index.js';
import type { Identity } from '../storage/datastore.js';

export const ASSET_SESSION_COOKIE = 'lingshu_asset_session';
const ASSET_SESSION_PREFIX = 'asset-v1.';
const ASSET_SESSION_TTL_MS = 15 * 60_000;

export function safeAssetTenantId(value: unknown): string {
  const tenantId = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tenantId)) throw new Error('invalid tenant id');
  return tenantId;
}

export function tenantAssetDir(root: string, tenantId: string): string {
  return path.join(root, 'tenants', safeAssetTenantId(tenantId));
}

export function tenantAssetRelativePath(tenantId: string, file: string): string {
  return path.posix.join('tenants', safeAssetTenantId(tenantId), path.basename(file));
}

export function sharedAssetRelativePath(file: string): string {
  return path.posix.join('shared', path.basename(file));
}

export function cookieValue(req: Request, key: string): string {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === key) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function assetSessionSignature(body: string): string {
  return createHmac('sha256', assetTokenSecret()).update(`session:${body}`).digest('base64url');
}

function encodeAssetSession(identity: Identity): string {
  const now = Date.now();
  const supportExpiry = identity.supportAccess?.expiresAt ? Date.parse(identity.supportAccess.expiresAt) : Number.POSITIVE_INFINITY;
  const expiresAt = Math.min(now + ASSET_SESSION_TTL_MS, Number.isFinite(supportExpiry) ? supportExpiry : now + ASSET_SESSION_TTL_MS);
  const body = Buffer.from(JSON.stringify({
    userId: identity.userId,
    tenantId: safeAssetTenantId(identity.tenantId),
    issuedAt: now,
    expiresAt,
    ...(identity.supportAccess ? { supportAccess: identity.supportAccess } : {}),
  }), 'utf8').toString('base64url');
  return `${ASSET_SESSION_PREFIX}${body}.${assetSessionSignature(body)}`;
}

function decodeAssetSession(token: string): Identity | null {
  if (!token.startsWith(ASSET_SESSION_PREFIX)) return null;
  const [body, supplied, ...extra] = token.slice(ASSET_SESSION_PREFIX.length).split('.');
  if (!body || !supplied || extra.length) return null;
  const expected = assetSessionSignature(body);
  const actualBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Identity & { issuedAt?: number; expiresAt?: number };
    const now = Date.now();
    if (!payload.userId || !payload.tenantId || !Number.isSafeInteger(payload.issuedAt)
      || !Number.isSafeInteger(payload.expiresAt) || payload.issuedAt! > now + 60_000
      || payload.expiresAt! <= now || payload.expiresAt! - payload.issuedAt! > ASSET_SESSION_TTL_MS) return null;
    return { userId: String(payload.userId), tenantId: safeAssetTenantId(payload.tenantId), supportAccess: payload.supportAccess };
  } catch {
    return null;
  }
}

export async function setAssetSessionCookie(req: Request, res: Response): Promise<void> {
  if (!req.headers.authorization) return;
  const identity = await auth.verifyToken(req.headers.authorization);
  if (!identity) return;
  res.cookie(ASSET_SESSION_COOKIE, encodeAssetSession(identity), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ASSET_SESSION_TTL_MS,
    path: '/',
  });
}

export function isExplicitAssetRequest(method: string, originalUrl: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = new URL(originalUrl || '/', 'http://local').pathname;
  return /^\/(?:media|bgm|tts|voice-samples|covers|cloud-files|studio-media)(?:\/|$)/.test(pathname)
    || /^\/api\/overseas\/videos\/[^/]+\/(?:media|thumbnail|image\/[^/]+)$/.test(pathname)
    || /^\/api\/overseas\/digital-employees\/artifacts\/[^/]+\/video$/.test(pathname);
}

export function clearAssetSessionCookie(res: Response): void {
  res.clearCookie(ASSET_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

function assetTokenSecret(): string {
  const configured = String(process.env.ASSET_ACCESS_SECRET || process.env.SUPPORT_ACCESS_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production' && !configured) throw new Error('ASSET_ACCESS_SECRET is required in production');
  return configured || 'lingshu-local-asset-access-secret';
}

function assetSignature(body: string): string {
  return createHmac('sha256', assetTokenSecret()).update(body).digest('base64url');
}

export function signAssetUrl(url: string, tenantId: string, ttlMs = 15 * 60 * 1000): string {
  const parsed = new URL(url, 'http://local');
  const payload = Buffer.from(JSON.stringify({ path: parsed.pathname, tenantId: safeAssetTenantId(tenantId), expiresAt: Date.now() + ttlMs }), 'utf8').toString('base64url');
  parsed.searchParams.set('assetToken', `${payload}.${assetSignature(payload)}`);
  return `${parsed.pathname}${parsed.search}`;
}

export function signPathAssetUrl(url: string, tenantId: string, ttlMs = 15 * 60 * 1000): string {
  const signed = new URL(signAssetUrl(url, tenantId, ttlMs), 'http://local');
  const token = signed.searchParams.get('assetToken');
  if (!token) return signed.pathname;
  const segments = signed.pathname.split('/');
  const filename = segments.pop();
  return `${segments.join('/')}/signed/${token}/${filename}`;
}

export function verifyAssetToken(token: unknown, pathname: string): { tenantId: string } | null {
  const [body, supplied] = String(token || '').split('.');
  if (!body || !supplied) return null;
  const expected = assetSignature(body);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { path?: string; tenantId?: string; expiresAt?: number };
    if (payload.path !== pathname || !payload.tenantId || Number(payload.expiresAt || 0) <= Date.now()) return null;
    return { tenantId: safeAssetTenantId(payload.tenantId) };
  } catch {
    return null;
  }
}

export async function assetIdentity(req: Request): Promise<Identity | null> {
  if (!isExplicitAssetRequest(req.method, req.originalUrl || req.url)) return null;
  if (req.headers.authorization) return auth.verifyToken(req.headers.authorization);
  return decodeAssetSession(cookieValue(req, ASSET_SESSION_COOKIE));
}

export async function syncAssetSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.headers.authorization) await setAssetSessionCookie(req, res);
    next();
  } catch (error) {
    next(error);
  }
}

export function allowLegacyUnscopedAsset(identity: Identity | null): boolean {
  // Legacy root files have no ownership metadata. They remain a local-dev
  // compatibility aid only; production must migrate them into shared/ or an
  // explicit tenants/<tenantId>/ prefix before they can be served.
  return process.env.NODE_ENV !== 'production' && Boolean(identity);
}

export async function requireScopedAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = await assetIdentity(req);
  const pathname = `${req.baseUrl}${req.path}`;
  const signed = identity ? null : verifyAssetToken(req.query.assetToken, pathname);
  const viewerTenantId = identity?.tenantId || signed?.tenantId;
  if (!viewerTenantId) {
    res.status(401).end();
    return;
  }
  const segments = req.path.split('/').filter(Boolean);
  if (segments.length === 1 && allowLegacyUnscopedAsset(identity)) {
    next();
    return;
  }
  if (segments[0] === 'shared' || (segments[0] === 'tenants' && segments[1] === viewerTenantId)) {
    next();
    return;
  }
  res.status(404).end();
}
