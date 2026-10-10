import { Router, type Request, type Response } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  setSupportAccessDefaultAuthorized,
  supportAccessDefaultAuthorized,
} from '../lib/supportAccess.js';
import { writeAuditLog } from '../lib/auditLog.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';

export const supportAccessRouter = Router();

supportAccessRouter.use(requireAuth);

async function requireTenantOwner(req: Request, res: Response): Promise<AuthLocals | null> {
  const locals = res.locals as AuthLocals;
  const { userId, supportAccess } = locals;
  if (supportAccess) {
    res.status(403).json({ error: 'support_session_cannot_change_authorization' });
    return null;
  }
  const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
  if (role !== 'super_admin') {
    res.status(403).json({
      error: 'tenant_owner_required',
      message: '只有企业负责人可以查看或修改技术支持授权。',
    });
    return null;
  }
  return locals;
}

supportAccessRouter.get('/settings', async (req, res) => {
  const locals = await requireTenantOwner(req, res);
  if (!locals) return;
  const { tenantId } = locals;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ defaultAuthorized: supportAccessDefaultAuthorized(tenantId) });
});

supportAccessRouter.put('/settings', async (req, res) => {
  const locals = await requireTenantOwner(req, res);
  if (!locals) return;
  const { tenantId, userId } = locals;
  const mode = String(req.body?.mode || '');
  if (mode !== 'default' && mode !== 'off') {
    res.status(400).json({ error: 'invalid_support_access_mode' });
    return;
  }

  const defaultAuthorized = mode === 'default';
  setSupportAccessDefaultAuthorized(tenantId, userId, defaultAuthorized);
  await writeAuditLog({
    tenantId,
    actorUserId: userId,
    action: defaultAuthorized ? 'support_access_enabled' : 'support_access_disabled',
    targetType: 'tenant',
    targetId: tenantId,
  });
  res.json({ defaultAuthorized });
});
