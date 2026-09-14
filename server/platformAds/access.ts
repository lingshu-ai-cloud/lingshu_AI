import type { Request, Response, NextFunction } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
export async function requireAdWriteAccess(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') { next(); return; }
  if (isBrowserReadToken(req.headers.authorization)) { res.status(403).json({ error: 'agent_browser_read_only' }); return; }
  const { userId, supportAccess } = res.locals as AuthLocals;
  const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
  if (supportAccess || !role || !['super_admin', 'admin', 'social_operator'].includes(role)) { res.status(403).json({ error: '当前身份无权修改广告账户或投放' }); return; }
  next();
}
