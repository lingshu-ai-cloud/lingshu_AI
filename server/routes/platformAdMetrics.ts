import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { getAdTaskMetrics } from '../platformAds/metrics.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
export const platformAdMetricsRouter = Router();
platformAdMetricsRouter.use(requireAuth);
platformAdMetricsRouter.get('/tasks/:id/metrics', async (req, res) => {
  try { res.json(await getAdTaskMetrics((res.locals as AuthLocals).tenantId, req.params.id)); }
  catch (error) { res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503).json({ error: error instanceof AdProviderError ? error.message : '投放效果暂不可用' }); }
});
