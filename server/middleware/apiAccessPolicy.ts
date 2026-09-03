import type { NextFunction, Request, Response } from 'express';
import { requireAuth, type AuthLocals } from './auth.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from '../routes/auth.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_ROLES: readonly OrganizationRole[] = ['super_admin', 'admin'];
const PUBLISHING_ROLES: readonly OrganizationRole[] = ['super_admin', 'admin', 'social_operator'];

function requestPath(req: Request): string {
  return new URL(req.originalUrl || req.url, 'http://local').pathname.replace(/\/+$/, '') || '/';
}

/** Explicit service-auth/public exceptions to the otherwise authenticated API. */
export function isPublicOrServiceAuthenticatedApiPath(method: string, pathname: string): boolean {
  const verb = method.toUpperCase();
  const path = pathname.replace(/\/+$/, '') || '/';
  if (/^\/api\/webhooks(?:\/|$)/.test(path)) return true;
  if (/^\/api\/v1\/products(?:\/|$)/.test(path)) return true;
  if (/^\/api\/overseas\/crawl-worker(?:\/|$)/.test(path)) return true;
  if (verb === 'GET' && /^\/api\/overseas\/youtube\/oauth\/callback$/.test(path)) return true;
  if (verb === 'GET' && /^\/api\/overseas\/social\/oauth\/[^/]+\/callback$/.test(path)) return true;
  if (verb === 'GET' && /^\/api\/assist-links\/[^/]+$/.test(path)) return true;
  if (verb === 'POST' && /^\/api\/assist-links\/[^/]+\/start$/.test(path)) return true;
  if (/^\/api\/overseas\/auth\/(?:invite\/[^/]+|register|login|logout)$/.test(path)) {
    return verb === 'GET' || verb === 'POST';
  }
  return false;
}

export function requiredRolesForApiWrite(pathname: string): readonly OrganizationRole[] | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/overseas/plugins/translate/run') return null;
  if ([
    '/api/overseas/enterprise',
    '/api/overseas/platform-integrations',
    '/api/overseas/channels',
    '/api/channels',
    '/api/overseas/plugins',
    '/api/oauth/whatsapp',
    '/api/overseas/support-access',
  ].some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return ADMIN_ROLES;
  if ([
    '/api/overseas/publishing',
    '/api/overseas/youtube',
    '/api/overseas/social',
    '/api/overseas/social-engagement',
    '/api/overseas/scheduler',
    '/api/overseas/studio',
    '/api/overseas/videos',
    '/api/overseas/scripts',
    '/api/overseas/trends',
    '/api/overseas/assets',
    '/api/overseas/copywriting',
    '/api/overseas/translation',
    '/api/overseas/competitor',
    '/api/overseas/competitor-accounts',
  ].some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return PUBLISHING_ROLES;
  return null;
}

export async function apiAuthenticationBoundary(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isPublicOrServiceAuthenticatedApiPath(req.method, requestPath(req))) {
    next();
    return;
  }
  await requireAuth(req, res, next);
}

export async function apiRoleBoundary(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (READ_METHODS.has(req.method) || isPublicOrServiceAuthenticatedApiPath(req.method, requestPath(req))) {
    next();
    return;
  }
  const allowed = requiredRolesForApiWrite(requestPath(req));
  if (!allowed) {
    next();
    return;
  }
  const identity = res.locals as AuthLocals;
  if (!identity.userId || identity.supportAccess) {
    res.status(403).json({ error: identity.supportAccess ? 'support_access_read_only' : 'organization_role_required' });
    return;
  }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, identity.userId);
  if (!role || !allowed.includes(role)) {
    res.status(403).json({ error: 'organization_role_forbidden' });
    return;
  }
  next();
}
