import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { executeAdAction, listAdExecutions, reconcileAdExecution } from '../platformAds/execution.js';
import { AdProviderError } from '../platformAds/metaAdapter.js';
import { requireAdWriteAccess } from '../platformAds/access.js';
export const platformAdExecutionRouter = Router();
platformAdExecutionRouter.use(requireAuth);
platformAdExecutionRouter.use(requireAdWriteAccess);
platformAdExecutionRouter.post('/tasks/:id/executions/:executionId/reconcile', async (req, res) => {
  try { res.json({ execution: await reconcileAdExecution((res.locals as AuthLocals).tenantId, req.params.id, req.params.executionId) }); }
  catch (error) { res.status(409).json({ error: error instanceof AdProviderError ? error.message : '对账暂不可用' }); }
});
platformAdExecutionRouter.get('/tasks/:id/executions', async (req, res) => {
  try { res.json({ items: await listAdExecutions((res.locals as AuthLocals).tenantId, req.params.id) }); }
  catch { res.status(503).json({ error: '执行记录暂不可用' }); }
});
platformAdExecutionRouter.post('/tasks/:id/execute', async (req, res) => {
  try { res.json({ execution: await executeAdAction((res.locals as AuthLocals).tenantId, req.params.id, req.body || {}) }); }
  catch (error) {
    res.status(error instanceof AdProviderError && error.code === 'NOT_FOUND' ? 404 : 409).json({ error: error instanceof AdProviderError ? error.message : '投放执行暂不可用', code: error instanceof AdProviderError ? error.code : 'SERVICE_ERROR' });
  }
});
