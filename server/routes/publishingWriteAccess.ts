import type { NextFunction, Request, Response } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from './auth.js';

const PUBLISHING_WRITE_ROLES = new Set<OrganizationRole>(['super_admin', 'admin', 'social_operator']);

export function publishingWriteAccessDecision(input: {
  method: string;
  supportAccess: boolean;
  role?: OrganizationRole | null;
}): 'allow' | 'support_read_only' | 'publishing_write_forbidden' {
  if (['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) return 'allow';
  if (input.supportAccess) return 'support_read_only';
  return input.role && PUBLISHING_WRITE_ROLES.has(input.role) ? 'allow' : 'publishing_write_forbidden';
}

/** Global guard for every authenticated mutation in social publishing routes. */
export async function requirePublishingWriteAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = res.locals as AuthLocals;
  const initial = publishingWriteAccessDecision({
    method: req.method,
    supportAccess: Boolean(identity.supportAccess),
    role: null,
  });
  if (initial === 'allow') { next(); return; }
  if (initial === 'support_read_only') { res.status(403).json({ error: 'support_access_read_only' }); return; }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, identity.userId);
  const decision = publishingWriteAccessDecision({ method: req.method, supportAccess: false, role });
  if (decision !== 'allow') { res.status(403).json({ error: 'publishing_write_forbidden' }); return; }
  next();
}
