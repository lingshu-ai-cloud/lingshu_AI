import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { listTenantFollowupTemplates } from '../whatsapp/templates.js';
import { configureWorkflowFollowupTemplate } from './digitalEmployees.js';

export const followupTemplatesRouter = Router();
followupTemplatesRouter.use(requireAuth);
followupTemplatesRouter.get('/templates', async (_req, res) => {
  try { res.json({ items: await listTenantFollowupTemplates((res.locals as AuthLocals).tenantId) }); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : 'whatsapp_template_catalog_unavailable' }); }
});
followupTemplatesRouter.put('/batches/:batchId/items/:itemId/template', async (req, res) => {
  if (isBrowserReadToken(req.headers.authorization)) { res.status(403).json({ error: 'agent_browser_read_only' }); return; }
  try {
    const body = req.body || {};
    const result = await configureWorkflowFollowupTemplate({ tenantId: (res.locals as AuthLocals).tenantId, batchId: String(req.params.batchId), itemId: String(req.params.itemId), templateName: String(body.templateName || ''), language: String(body.language || ''), variables: body.variables });
    res.json(result);
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : 'followup_template_configuration_failed' }); }
});
