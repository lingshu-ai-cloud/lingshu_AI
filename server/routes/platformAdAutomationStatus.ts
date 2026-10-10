import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { readAdWorkerStatus } from '../platformAds/workerHealth.js';
export const platformAdAutomationStatusRouter = Router();
platformAdAutomationStatusRouter.use(requireAuth);
platformAdAutomationStatusRouter.get('/automation/status', async (_req, res) => {
  try { res.json({ worker: await readAdWorkerStatus((res.locals as AuthLocals).tenantId) }); }
  catch { res.status(503).json({ error: '后台检查证据暂时无法读取' }); }
});
