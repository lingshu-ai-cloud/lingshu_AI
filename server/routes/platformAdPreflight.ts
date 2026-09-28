import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { preflightAdAction } from '../platformAds/preflight.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
export const platformAdPreflightRouter = Router();
platformAdPreflightRouter.use(requireAuth);
platformAdPreflightRouter.use(requireAdWriteAccess);
// Read-only POST: does not grant write access or bypass execution route permissions.
platformAdPreflightRouter.post('/tasks/:id/preflight', async (req, res) => {
  try { res.json(await preflightAdAction((res.locals as AuthLocals).tenantId, req.params.id, req.body || {})); }
  catch (error) { res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 503).json({ error: error instanceof AdProviderError ? error.message : '本地投放预检暂不可用', code: error instanceof AdProviderError ? error.code : 'SERVICE_ERROR' }); }
});
