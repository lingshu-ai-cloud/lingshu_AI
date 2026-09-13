import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict } from './auth.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { AdHandoffError, goalAdHandoffs, handoffGoalToAds } from '../platformAds/handoff.js';

export const platformAdHandoffRouter = Router();
platformAdHandoffRouter.use(requireAuth);
platformAdHandoffRouter.get('/business-goals/:goalId/ads', async (req, res) => {
  try { res.json({ items: await goalAdHandoffs((res.locals as AuthLocals).tenantId, req.params.goalId) }); }
  catch (error) { res.status(error instanceof AdHandoffError ? error.status : 503).json({ error: error instanceof AdHandoffError ? error.message : '经营投放关联暂不可用' }); }
});
platformAdHandoffRouter.post('/business-goals/:goalId/ads', async (req, res) => {
  try {
    const { tenantId, userId, supportAccess } = res.locals as AuthLocals;
    const role = await requestOrganizationRoleStrict(req.headers.authorization, userId);
    if (isBrowserReadToken(req.headers.authorization) || supportAccess || !role || !['super_admin', 'admin', 'social_operator'].includes(role)) { res.status(403).json({ error: '当前身份不能创建投放任务' }); return; }
    res.status(201).json(await handoffGoalToAds(tenantId, userId, req.params.goalId, req.body || {}));
  } catch (error) {
    res.status(error instanceof AdHandoffError ? error.status : 400).json({ error: error instanceof Error ? error.message : '投放任务交接失败' });
  }
});
