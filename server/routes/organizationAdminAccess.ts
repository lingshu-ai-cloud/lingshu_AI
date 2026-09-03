import type { NextFunction, Request, Response } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from './auth.js';

const ORGANIZATION_ADMIN_ROLES = new Set<OrganizationRole>(['super_admin', 'admin']);

export function organizationAdminAccessDecision(input: {
  supportAccess: boolean;
  role?: OrganizationRole | null;
}): 'allow' | 'support_read_only' | 'organization_admin_forbidden' {
  if (input.supportAccess) return 'support_read_only';
  return input.role && ORGANIZATION_ADMIN_ROLES.has(input.role) ? 'allow' : 'organization_admin_forbidden';
}

/** Defense-in-depth guard for secret management and tenant governance routes. */
export async function requireOrganizationAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const identity = res.locals as AuthLocals;
  const initial = organizationAdminAccessDecision({ supportAccess: Boolean(identity.supportAccess), role: null });
  if (initial === 'support_read_only') {
    res.status(403).json({ error: 'support_access_read_only' });
    return;
  }
  if (!identity.userId) {
    res.status(403).json({ error: 'organization_admin_required' });
    return;
  }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, identity.userId);
  if (organizationAdminAccessDecision({ supportAccess: false, role }) !== 'allow') {
    res.status(403).json({ error: 'organization_admin_forbidden' });
    return;
  }
  next();
}
