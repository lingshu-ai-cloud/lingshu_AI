import { extractJSON, langName } from './studioTranslationCore.js';
import { callLLM } from '../agents/llm.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { auditCommercialClaims, confirmedEnterpriseContextForProduct, hasConfirmedEnterpriseFacts, unconfirmedEnterpriseProductFields, upstreamGenerationFailure } from '../lib/studioGenerationTruthfulness.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioCoverTitleRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
  const studioRouter = deps.studioRouter;
  const enterpriseCtx: StudioApplicationPorts['enterpriseCtx'] = (...args) => deps.enterpriseCtx(...args);

  function registerPostCovers() {
    studioRouter.post('/covers', async (req, res) => {
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { script = '', productInfo = '', language = 'en', provider, tone = '' } = req.body ?? {};
      const lang = langName(language);
      const providerOpt: 'qwen' = 'qwen';
      const enterprise = await enterpriseCtx();
      if (!hasConfirmedEnterpriseFacts(enterprise)) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PROFILE_REQUIRED', covers: [],
          error: '企业中心尚无已确认资料，不能生成可用于发布的封面标题。',
          fieldsToConfirm: ['企业产品资料'],
        });
        return;
      }
      if (!String(productInfo || '').trim()) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PRODUCT_REQUIRED', covers: [], fieldsToConfirm: ['企业产品资料'],
          error: '请先选择企业中心已确认产品；未调用模型生成封面标题。',
        });
        return;
      }
      const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
      const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
      if (unconfirmedProductFields.length) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', covers: [], fieldsToConfirm: unconfirmedProductFields,
          error: '封面请求中的产品资料无法在当前企业中心已确认资料中核对。',
        });
        return;
      }

      const prompt = `Generate 3 punchy ${lang} video cover titles (max 6 words each) for an overseas e-commerce short video.
Context — product: ${productInfo || '(see enterprise profile)'} ; tone: ${tone || '(fit platform)'} ; script: ${script.slice(0, 300)}
Use only product categories, facts, specifications and claims explicitly present in the context. If context is sparse, use a neutral product-demo title instead of guessing.
Return ONLY a JSON array of 3 strings. No other text.`;

      try {
        const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: productEnterprise });
        const arr = extractJSON<string[]>(text);
        if (arr && arr.length) {
          const covers = arr.slice(0, 3).map(String).map(item => item.trim()).filter(Boolean);
          const audit = auditCommercialClaims(covers.join('\n'), productEnterprise);
          if (audit.issues.length || audit.fieldsToConfirm.length) {
            res.status(422).json({
              ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
              code: audit.issues.length ? 'UNVERIFIED_COMMERCIAL_CLAIMS' : 'COMMERCIAL_FIELDS_REQUIRE_CONFIRMATION',
              covers: [], fieldsToConfirm: audit.fieldsToConfirm,
              error: audit.issues.length
                ? `封面标题包含企业中心未确认的商业声明：${audit.issues.join('；')}`
                : `封面标题仍有待确认商业字段：${audit.fieldsToConfirm.join('、')}`,
            });
            return;
          }
          res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', covers });
          return;
        }
        throw new Error('parse');
      } catch (error) {
        res.status(502).json({ ...upstreamGenerationFailure(error, '封面标题'), covers: [] });
      }
    });
  }

  return { registerPostCovers };
}
