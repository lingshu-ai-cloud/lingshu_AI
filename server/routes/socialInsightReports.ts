import type { Router } from 'express';
import { z } from 'zod';
import { readInsightMerchantContext } from '../socialInsights/merchantContext.js';
import { store } from '../storage/index.js';
import type { AuthLocals } from '../middleware/auth.js';
import { previewInformationScope } from '../assistantContext/previewInformationScope.js';
import { withSocialInsightPreviewInformation } from '../../scripts/customer-preview-ai-scope.mjs';
import { createSocialInsightService, SocialInsightError } from '../socialInsights/service.js';
const requestSchema = z.object({ keyword: z.string(), requestId: z.string().uuid() }).strict();
const service = createSocialInsightService({ store, merchantContext: readInsightMerchantContext, executeScope: async (config, fn) => {
  if (process.env.LINGSHU_LOCAL_PREVIEW !== '1') return fn();
  const result = await withSocialInsightPreviewInformation(config, fn);
  console.info('[social-insight-preview]', JSON.stringify(result.audit));
  return result.value;
} });
export function registerSocialInsightReports(router: Router): void {
  router.post('/social-insight-reports', previewInformationScope, async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'social_insight_request_invalid' }); return; }
    try {
      const result = await service.create((res.locals as AuthLocals).tenantId, parsed.data.keyword, parsed.data.requestId);
      res.status(result.status === 'blocked' ? 200 : 202).json(result);
    } catch (cause) {
      res.status(cause instanceof SocialInsightError ? cause.status : 503).json({ error: cause instanceof SocialInsightError ? cause.code : 'social_insight_storage_unavailable' });
    }
  });
  router.get('/social-insight-reports/:id', async (req, res) => {
    if (!/^[a-f0-9]{15}$/.test(req.params.id)) { res.status(404).json({ error: 'social_insight_not_found' }); return; }
    try {
      const job = await service.get((res.locals as AuthLocals).tenantId, req.params.id);
      if (!job) { res.status(404).json({ error: 'social_insight_not_found' }); return; }
      res.json(job);
    } catch { res.status(503).json({ error: 'social_insight_storage_unavailable' }); }
  });
}
