import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict } from '../lib/organizationRole.js';
import {
  AgentNotificationError,
  createAgentNotification,
  listAgentNotifications,
  markAgentNotificationRead,
  markAllAgentNotificationsRead,
} from '../notifications/agentNotifications.js';

export const agentNotificationsRouter = Router();
agentNotificationsRouter.use(requireAuth);

const fail = (res: import('express').Response, error: unknown) => {
  const status = error instanceof AgentNotificationError ? error.status : 503;
  res.status(status).json({ error: error instanceof Error ? error.message : 'notification_service_unavailable' });
};

agentNotificationsRouter.get('/', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.setHeader('Cache-Control', 'private, no-store'); res.json(await listAgentNotifications(tenantId, userId, Number(req.query.limit) || 30)); }
  catch (error) { fail(res, error); }
});

agentNotificationsRouter.post('/', async (req, res) => {
  const { tenantId, userId, supportAccess } = res.locals as AuthLocals;
  try {
    const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
    if (supportAccess || !role || !['super_admin', 'admin', 'social_operator'].includes(role)) { res.status(403).json({ error: 'notification_create_forbidden' }); return; }
    // Identity scope always wins over untrusted request JSON.
    const result = await createAgentNotification({ ...(req.body || {}), tenantId });
    res.status(result.created ? 201 : 200).json({ item: result.notification, created: result.created });
  } catch (error) { fail(res, error); }
});

agentNotificationsRouter.patch('/:id/read', async (_req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.json({ item: await markAgentNotificationRead(tenantId, userId, _req.params.id) }); }
  catch (error) { fail(res, error); }
});

agentNotificationsRouter.post('/read-all', async (_req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  try { res.json({ updated: await markAllAgentNotificationsRead(tenantId, userId) }); }
  catch (error) { fail(res, error); }
});
