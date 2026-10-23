import { Router } from 'express';
import type { AuthLocals } from '../middleware/auth.js';
import { getFollowupBatch, getFollowupBatchItems } from '../digitalEmployees/customerWorkflow.js';
import { getTenantFollowupDispatchStatus, preflightFollowupBatchDispatch } from '../digitalEmployees/followupDispatchWorker.js';
import { jsonObject } from './digitalEmployeeRecords.js';

// Mounted behind the parent router's authentication and support-session gate.
export function createDigitalEmployeeFollowupReadRouter() {
  const router = Router();
  router.get('/followup-batches/:batchId', async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    const batch = await getFollowupBatch(tenantId, req.params.batchId);
    if (!batch) { res.status(404).json({ error: 'followup_batch_not_found' }); return; }
    const items = await getFollowupBatchItems(tenantId, batch.id);
    res.json({
      batch: { ...batch, delivery_policy: jsonObject(batch.delivery_policy, {}), safety_summary: jsonObject(batch.safety_summary, {}), counts: jsonObject(batch.counts, {}) },
      items: items.map(item => ({ ...item, provider_receipt: jsonObject(item.provider_receipt, {}) })),
      bulkWorkerStatus: await getTenantFollowupDispatchStatus(tenantId),
      messagesSent: items.filter(item => ['sent', 'delivered', 'read', 'partial_sent'].includes(item.status) && Boolean(item.provider_message_id)).length,
    });
  });
  router.get('/followup-worker/status', async (_req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    res.json(await getTenantFollowupDispatchStatus(tenantId));
  });
  router.get('/followup-batches/:batchId/dispatch-preflight', async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    try {
      res.json(await preflightFollowupBatchDispatch(tenantId, req.params.batchId, { mode: 'manual' }));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'followup_dispatch_preflight_failed';
      res.status(code === 'followup_batch_not_found' ? 404 : 502).json({ error: code });
    }
  });
  return router;
}
