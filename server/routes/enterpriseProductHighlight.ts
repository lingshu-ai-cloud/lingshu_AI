import { Router } from 'express';
import { productHighlightRequestSchema } from '../../shared/contracts/productHighlight.js';
import { readTenantEnterpriseProfileStrict } from './enterpriseProfileStore.js';
import { draftProductHighlight, ProductHighlightError } from '../knowledge/productHighlight.js';
import type { AuthLocals } from '../middleware/auth.js';
import { previewInformationScope } from '../assistantContext/previewInformationScope.js';

export function createEnterpriseProductHighlightRouter(deps: {
  read?: typeof readTenantEnterpriseProfileStrict; generate?: (prompt: string) => Promise<string>;
} = {}) {
  const router = Router();
  router.post('/product-highlight', previewInformationScope, async (req, res) => {
    const { tenantId } = res.locals as AuthLocals;
    if (!tenantId) { res.status(401).json({ error: 'unauthorized' }); return; }
    const parsed = productHighlightRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'product_highlight_input_invalid', message: '请选择产品并刷新资料后再提炼。' }); return; }
    try {
      const read = deps.read || readTenantEnterpriseProfileStrict;
      const profile = await read(tenantId);
      if (!profile) throw new ProductHighlightError('enterprise_profile_missing', 404, '请先在企业知识库录入产品。');
      const draft = await draftProductHighlight(profile, parsed.data.productId, parsed.data.factVersion, deps.generate);
      if ((await read(tenantId))?.factVersion?.contentHash !== draft.factVersion) throw new ProductHighlightError('enterprise_fact_version_conflict', 409, '提炼期间企业资料已更新，请刷新产品后重新提炼。');
      res.json({ draft });
    } catch (error) {
      res.status(error instanceof ProductHighlightError ? error.status : 503).json({
        error: error instanceof ProductHighlightError ? error.code : 'product_highlight_unavailable',
        message: error instanceof ProductHighlightError ? error.message : '卖点提炼暂时不可用，请稍后重试。',
      });
    }
  });
  return router;
}
