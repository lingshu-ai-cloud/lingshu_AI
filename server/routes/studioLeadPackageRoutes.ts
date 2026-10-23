import { extractJSON, langName } from './studioTranslationCore.js';
import { callLLM } from '../agents/llm.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { auditCommercialClaims, confirmationFields, confirmedEnterpriseContextForProduct, hasConfirmedEnterpriseFacts, unconfirmedEnterpriseProductFields, upstreamGenerationFailure, userFacingLeadPackageText } from '../lib/studioGenerationTruthfulness.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioLeadPackageRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
  const studioRouter = deps.studioRouter;
  const enterpriseCtx: StudioApplicationPorts['enterpriseCtx'] = (...args) => deps.enterpriseCtx(...args);

  function registerPostLeadContentPackage() {
    studioRouter.post('/lead-content-package', async (req, res) => {
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const { productInfo = '', platform = 'instagram', language = 'en', ratio = '4:5', referenceEvidence = null, referenceTitle = '' } = req.body ?? {};
      if (!referenceEvidence?.observedFacts?.length) { res.status(400).json({ error: '缺少可信的竞品逐图证据，不能生成获客内容包' }); return; }
      const enterprise = await enterpriseCtx();
      if (!hasConfirmedEnterpriseFacts(enterprise)) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PROFILE_REQUIRED', strategySummary: '', referenceModulesUsed: [], items: [],
          fieldsToConfirm: ['企业产品与商业能力资料'], error: '企业中心尚无已确认资料，不能生成获客内容包。',
        });
        return;
      }
      if (!String(productInfo || '').trim()) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PRODUCT_REQUIRED', strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm: ['企业产品资料'],
          error: '请先选择企业中心已确认产品；未调用模型生成获客内容包。',
        });
        return;
      }
      const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
      const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
      if (unconfirmedProductFields.length) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', strategySummary: '', referenceModulesUsed: [], items: [],
          fieldsToConfirm: unconfirmedProductFields, error: '获客内容包请求中的产品资料无法在当前企业中心已确认资料中核对。',
        });
        return;
      }
      const prompt = `你是外贸 B2B 社媒获客内容总监。请基于企业真实资料和竞品公开图文的结构化证据，生成三条连续图文内容：吸引目标买家、解释合作能力、建立供应商信任。

企业资料（唯一商业事实来源）：
${productEnterprise || '(企业中心资料为空)'}

当前选择产品：
${String(productInfo || '(未选择产品)').slice(0, 5000)}

竞品标题（仅用于定位参考，不得复制）：${String(referenceTitle || '').slice(0, 300)}
竞品证据：
${JSON.stringify(referenceEvidence).slice(0, 12000)}

平台：${platform}；语言：${langName(language)}；比例：${ratio}

硬规则：
- 只复用竞品的通用布局、信息层级、色彩关系和轮播功能；禁止复制竞品品牌、Logo、产品、包装、联系方式和原句。
- MOQ、价格、认证、交期、出口国家、工厂年限等只能来自企业资料；缺失时写入 fieldsToConfirm，不能出现在 poster 或 caption。
- 三条内容必须分别服务 buyer_attention、capability_explanation、supplier_trust，不是三张相似 A/B 图。
- 每条建议 5 张轮播，每张都必须有明确 role、headline、body、assetRole；文字简洁。
- 输出合法 JSON，不要 markdown。

Schema:
{
  "strategySummary":"string",
  "referenceModulesUsed":[{"module":"string","evidence":"string","application":"string"}],
  "items":[{
    "role":"buyer_attention|capability_explanation|supplier_trust",
    "title":"string",
    "objective":"string",
    "slides":[{"index":1,"role":"attention|product|detail|process|proof|cta","headline":"string","body":"string","assetRole":"product image|factory image|certificate image|packaging image|scene image|brand visual|none"}],
    "caption":"string",
    "hashtags":["string"],
    "cta":"string",
    "dmOpening":"string",
    "imagePrompt":"string"
  }],
  "fieldsToConfirm":["string"]
}`;
      const failures: string[] = [];
      for (const backend of ['qwen'] as const) {
        try {
          const text = await callLLM(prompt, { backend, systemPrompt: productEnterprise || undefined });
          const parsed = extractJSON<any>(text);
          if (Array.isArray(parsed?.items) && parsed.items.length >= 3) {
            const items = parsed.items.slice(0, 3);
            const audit = auditCommercialClaims(userFacingLeadPackageText({ ...parsed, items }), productEnterprise);
            const fieldsToConfirm = confirmationFields([
              ...(Array.isArray(parsed.fieldsToConfirm) ? parsed.fieldsToConfirm : []),
              ...audit.fieldsToConfirm,
            ]);
            if (audit.issues.length) {
              res.status(422).json({
                ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
                code: 'UNVERIFIED_COMMERCIAL_CLAIMS', strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm,
                error: `获客内容包包含企业中心未确认的商业声明：${audit.issues.join('；')}`,
              });
              return;
            }
            const publishable = fieldsToConfirm.length === 0;
            res.json({
              ok: true, source: 'ai', provenance: 'ai', publishable,
              qualityStatus: publishable ? 'passed' : 'needs_confirmation', provider: backend,
              strategySummary: String(parsed.strategySummary || ''),
              referenceModulesUsed: Array.isArray(parsed.referenceModulesUsed) ? parsed.referenceModulesUsed.slice(0, 12) : [],
              items,
              fieldsToConfirm,
            });
            return;
          }
          failures.push(`${backend}: parse_failed`);
        } catch (error) { failures.push(`${backend}: ${String((error as Error)?.message || error).slice(0, 180)}`); }
      }
      res.status(502).json({
        ...upstreamGenerationFailure(failures[0] || 'lead content generation failed', '获客内容包'),
        strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm: [], details: failures,
      });
    });
  }

  return { registerPostLeadContentPackage };
}
