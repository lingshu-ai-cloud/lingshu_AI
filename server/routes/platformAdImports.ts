import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
import { importPlatformAdCampaign, listAdImports } from '../platformAds/imports.js';

export const platformAdImportsRouter = Router();
platformAdImportsRouter.use(requireAuth);
platformAdImportsRouter.use(requireAdWriteAccess);
platformAdImportsRouter.get('/imports', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json({ items: await listAdImports(tenantId, typeof req.query.taskId === 'string' ? req.query.taskId : undefined) });
});
platformAdImportsRouter.post('/connections/:connectionId/import', async (req, res) => {
  try {
    const { tenantId, userId } = res.locals as AuthLocals;
    const result = await importPlatformAdCampaign(tenantId, userId, req.params.connectionId, req.body || {});
    res.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    const known = error instanceof AdProviderError;
    res.status(known && error.code === 'NOT_FOUND' ? 404 : known && error.code === 'ACCOUNT_MISMATCH' ? 403 : known && ['INVALID_INPUT', 'CURRENCY_MISMATCH', 'NOT_SUPPORTED'].includes(error.code) ? 400 : 503).json({ error: known ? error.message : '广告系列暂时无法导入', code: known ? error.code : 'SERVICE_ERROR' });
  }
});
