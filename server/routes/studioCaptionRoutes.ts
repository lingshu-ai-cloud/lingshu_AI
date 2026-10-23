import { extractJSON, langName } from './studioTranslationCore.js';
import { callLLM } from '../agents/llm.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { keywordPromptContext, mergePlannedHashtags, researchSocialImageKeywords } from '../lib/keywordIntelligence.js';
import { auditCommercialClaims, confirmedEnterpriseContextForProduct, hasConfirmedEnterpriseFacts, normalizedFactValue, unconfirmedEnterpriseProductFields, upstreamGenerationFailure } from '../lib/studioGenerationTruthfulness.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioCaptionRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
  const studioRouter = deps.studioRouter;
  const enterpriseCtx: StudioApplicationPorts['enterpriseCtx'] = (...args) => deps.enterpriseCtx(...args);

  function registerPostCaption() {
    studioRouter.post('/caption', async (req, res) => {
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { script = '', productInfo = '', platform = 'tiktok', language = 'en', provider, audience = '', sellingPoints = '', tone = '', referenceCaption = '', brandName = '', categoryTerms = [], targetMarket = '' } = req.body ?? {};
      const lang = langName(language);
      const providerOpt: 'qwen' = 'qwen';
      const enterprise = await enterpriseCtx();
      if (!hasConfirmedEnterpriseFacts(enterprise)) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PROFILE_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品资料'],
          error: '企业中心尚无已确认资料，不能生成可发布配文。',
        });
        return;
      }
      const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
      const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
      const sellingPointKey = normalizedFactValue(String(sellingPoints || ''));
      if (sellingPointKey && !normalizedFactValue(productEnterprise).includes(sellingPointKey)) unconfirmedProductFields.push('创作卖点');
      if (unconfirmedProductFields.length) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', caption: '', hashtags: [], fieldsToConfirm: Array.from(new Set(unconfirmedProductFields)),
          error: '配文请求中的产品或卖点资料无法在当前企业中心已确认资料中核对。',
        });
        return;
      }

      const keywordResearch = researchSocialImageKeywords({ platform, language, targetMarket, brandName, productInfo, categoryTerms, valueThemes: [sellingPoints].filter(Boolean), referenceCaption, maxHashtags: 8 });
      const prompt = `Write a ${platform} post caption in ${lang} for this overseas e-commerce video.
Product: ${productInfo || '(see enterprise profile)'} ; audience: ${audience || '(infer)'} ; selling points: ${sellingPoints || '(infer)'} ; tone: ${tone || '(fit platform)'} ; script: ${script.slice(0, 300)} ; ${keywordPromptContext(keywordResearch)}
Use only facts and product terms explicitly present above. Never invent a product category, certification, price, MOQ, shipping promise, lead time, geography or performance claim.
Return ONLY JSON: { "caption": string, "hashtags": string[] (no # prefix) }`;

      try {
        const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: productEnterprise });
        const obj = extractJSON<{ caption: string; hashtags: string[] }>(text);
        if (obj?.caption) {
          const caption = String(obj.caption || '').trim();
          const hashtags = mergePlannedHashtags(obj.hashtags, keywordResearch, 8);
          const audit = auditCommercialClaims([caption, ...hashtags].join('\n'), productEnterprise);
          if (audit.issues.length || audit.fieldsToConfirm.length) {
            res.status(422).json({
              ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
              code: audit.issues.length ? 'UNVERIFIED_COMMERCIAL_CLAIMS' : 'COMMERCIAL_FIELDS_REQUIRE_CONFIRMATION',
              caption: '', hashtags: [], fieldsToConfirm: audit.fieldsToConfirm,
              error: audit.issues.length
                ? `发布配文包含企业中心未确认的商业声明：${audit.issues.join('；')}`
                : `发布配文仍有待确认商业字段：${audit.fieldsToConfirm.join('、')}`,
            });
            return;
          }
          res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', caption, hashtags, keywordResearch });
          return;
        }
        throw new Error('parse');
      } catch (error) {
        res.status(502).json({ ...upstreamGenerationFailure(error, '发布配文'), caption: '', hashtags: [], fieldsToConfirm: [] });
      }
    });
  }

  return { registerPostCaption };
}
