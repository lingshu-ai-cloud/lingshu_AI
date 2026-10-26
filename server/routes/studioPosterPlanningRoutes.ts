import { imageLanguageSchema, normalizeImageLanguage } from '../../shared/contracts/imageLanguages.js';
import { neutralSocialImageCopy } from '../socialImage/socialImageLanguageCopy.js';
import { extractJSON, langName } from './studioTranslationCore.js';
import { IMAGE_DELIVERABLES, IMAGE_DELIVERABLE_LABELS, IMAGE_PRODUCTION_STRATEGIES, type ImageDeliverable, type ImageProductionStrategy } from '../../shared/imageCreativePlanning.js';
import { callLLM } from '../agents/llm.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { normalizePosterBrief } from '../socialImage/studioPosterHelpers.js';
import { keywordPromptContext, mergePlannedHashtags, researchSocialImageKeywords } from '../lib/keywordIntelligence.js';
import { auditCommercialClaims, confirmationFields, confirmedEnterpriseContextForProduct, hasConfirmedEnterpriseFacts, sanitizePosterCommercialClaims, unconfirmedEnterpriseProductFields, userFacingPosterText } from '../lib/studioGenerationTruthfulness.js';
import { store } from '../storage/index.js';
import { type AuthLocals } from '../middleware/auth.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
import { socialImageV3PaidPrerequisiteIssue } from '../socialImage/socialImagePaidPrerequisites.js';
import { recordSocialImageV3DirectorBrief, socialImageV3TrustedPlanningRequest,
  type SocialImageFormalPlannerResult } from '../socialImage/socialImageFormalPlan.js';
import { assertSocialImageCurrentContentTask, SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioPosterPlanningRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx'>) {
  const studioRouter = deps.studioRouter;
  const enterpriseCtx: StudioApplicationPorts['enterpriseCtx'] = (...args) => deps.enterpriseCtx(...args);

  function registerPostFbPoster() {
    studioRouter.post('/fb-poster', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const imageTaskId = String(req.body?.imageTaskId || '').trim();
      const boundTask = imageTaskId ? await readSocialImageTask(store, tenantId, imageTaskId) : null;
      if (imageTaskId && (!boundTask || boundTask.schemaVersion !== 'social-image-creation.v3'
        || Number(req.body?.expectedImageTaskVersion) !== boundTask.version)) {
        res.status(409).json({ ok: false, code: 'social_image_planning_task_version_conflict',
          error: '图片任务不存在、不是当前生产版本，或已被更新' }); return;
      }
      if (boundTask) {
        try { await assertSocialImageCurrentContentTask(store, tenantId, boundTask); }
        catch (error) {
          const failure = error instanceof SocialImageProductionRunError ? error
            : new SocialImageProductionRunError('social_image_content_task_read_failed', 503);
          res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code }); return;
        }
        const issue = socialImageV3PaidPrerequisiteIssue(boundTask, 'queue');
        if (!['social_image_director_brief_required', 'social_image_director_brief_stale'].includes(issue || '')) {
          res.status(422).json({ ok: false, code: issue || 'social_image_director_brief_already_completed',
            error: '图片上游证据尚未就绪，不能发起编导策划' }); return;
        }
      }
      const respond = async (result: Record<string, unknown> & SocialImageFormalPlannerResult) => {
        if (!boundTask) { res.json(result); return; }
        try {
          const imageTask = await recordSocialImageV3DirectorBrief({ store, tenantId, taskId: boundTask.id,
            expectedVersion: boundTask.version, result });
          res.setHeader('Cache-Control', 'private, no-store');
          res.json({ ...result, imageTask });
        } catch (error) {
          const failure = error instanceof SocialImageProductionRunError ? error
            : new SocialImageProductionRunError('social_image_director_brief_persist_failed', 503);
          res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
        }
      };
      const {
        deliverableType: rawDeliverableType = 'social_poster',
        productionStrategy: rawProductionStrategy = 'reference_generate',
        productInfo = '',
        platform = 'facebook',
        ratio = '1:1',
        posterStyle = 'oem-factory',
        language: rawLanguage = 'en',
        provider,
        materials = [],
        referenceNotes = '', referenceCaption = '', brandName = '', categoryTerms = [], targetMarket = '',
        confirmedFields = {},
      } = boundTask ? socialImageV3TrustedPlanningRequest(boundTask) : req.body ?? {};
      const parsedLanguage = imageLanguageSchema.safeParse(normalizeImageLanguage(rawLanguage));
      if (!parsedLanguage.success) {
        res.status(400).json({ ok: false, code: 'social_image_language_unsupported', error: '请选择支持的图文语言。' }); return;
      }
      const language = parsedLanguage.data;
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      const neutral = neutralSocialImageCopy(language);
      const deliverableType: ImageDeliverable = IMAGE_DELIVERABLES.includes(rawDeliverableType)
        ? rawDeliverableType : 'social_poster';
      const productionStrategy: ImageProductionStrategy = IMAGE_PRODUCTION_STRATEGIES.includes(rawProductionStrategy) ? rawProductionStrategy : 'reference_generate';
      const providerOpt: 'qwen' = 'qwen';
      const lang = langName(language), keywordResearch = researchSocialImageKeywords({ platform, language, targetMarket, brandName, productInfo, categoryTerms, referenceCaption, maxHashtags: 8 });
      const enterprise = await enterpriseCtx();
      if (!hasConfirmedEnterpriseFacts(enterprise)) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PROFILE_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品与商业能力资料'],
          error: '企业中心尚无已确认资料，不能生成商业海报文案。',
        });
        return;
      }
      if (!String(productInfo || '').trim()) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PRODUCT_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品资料'],
          error: '请先选择企业中心已确认产品；未调用模型生成海报文案。',
        });
        return;
      }
      const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
      const taskConfirmedFacts = Object.entries(
        confirmedFields && typeof confirmedFields === 'object' && !Array.isArray(confirmedFields) ? confirmedFields : {},
      ).slice(0, 20).map(([field, value]) => {
        const safeField = String(field || '').replace(/[\r\n：:]/g, ' ').trim().slice(0, 80);
        const safeValue = String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, 500);
        return safeField && safeValue ? `${safeField}：${safeValue}` : '';
      }).filter(Boolean).join('\n');
      const commercialEvidence = [productEnterprise, taskConfirmedFacts ? `本次任务由用户确认的商业事实：\n${taskConfirmedFacts}` : ''].filter(Boolean).join('\n');
      const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
      if (unconfirmedProductFields.length) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', caption: '', hashtags: [], fieldsToConfirm: unconfirmedProductFields,
          error: '海报请求中的产品资料无法在当前企业中心已确认资料中核对。',
        });
        return;
      }
      const materialLines = Array.isArray(materials)
        ? materials.slice(0, 8).map((item: any, index: number) => `${index + 1}. ${String(item?.name || item || '').slice(0, 120)}${item?.role ? ` (${item.role})` : ''}`).join('\n')
        : '';
      const strategyGuide: Record<ImageProductionStrategy, string> = {
        reuse_existing: 'Reuse only a production-admitted template or finished asset; replace text and product content with verified enterprise facts.',
        compose_assets: 'Keep the exact product reference unchanged as the identity anchor, then compose it with admitted supporting scene or evidence assets.',
        reference_generate: 'Lock product appearance to the exact enterprise product reference. Style references may guide layout and rhythm only; rebuild all brand, product and text content.',
        generate_supporting: 'Generate only neutral supporting visuals that do not carry product identity, certification or commercial proof.',
      };

      const prompt = `You are a senior B2B social media creative director. Never assume that the company is a factory, exporter, OEM/ODM supplier, private-label provider, or certified business unless the authenticated enterprise profile explicitly says so.
Create a structured poster brief and ${platform} caption in ${lang}.
All newly authored poster headlines, subheadlines, CTA and caption must use ${lang}, with its correct script and reading direction. Preserve original brand names and physical product-label text; do not translate or redraw packaging labels.

Requested finished image: ${IMAGE_DELIVERABLE_LABELS[deliverableType]} (${deliverableType})
Agent-selected production strategy: ${productionStrategy}
Strategy rule: ${strategyGuide[productionStrategy]}
Poster style: ${posterStyle === 'oem-factory' ? 'structured B2B product-information layout (the legacy id is visual only; it does not authorize any OEM or factory claim)' : posterStyle}
Canvas ratio: ${ratio}
Selected product context (selection only; authenticated enterprise profile remains the sole source of commercial facts):
${productInfo || '(no product selected)'}

Authenticated enterprise profile and user-confirmed facts for this task (the only allowed commercial fact sources):
${commercialEvidence}

Selected material references:
${materialLines || '(none selected yet)'}

Reference / inspiration notes: ${String(referenceNotes || '').slice(0, 1500) || '(none)'}; ${keywordPromptContext(keywordResearch)}

Hard rules:
- AI may optimize expression, but must not invent commercial promises.
- MOQ, certifications, lead time, price, export countries, factory qualifications must come from the authenticated profile or explicit user-confirmed task facts; otherwise place them in fieldsToConfirm.
- If inspiration notes exist, output a module-level deconstruction and local asset matching plan. The final image must be a new composition using our product/materials, not a copy of the reference.
- Shape the composition for the requested finished image (${deliverableType}); do not silently change it into another asset type.- Poster text should be concise enough for a dense B2B product-information poster.
- Use exact English text for poster fields when language is English.
- Return ONLY valid JSON. No markdown.

Schema:
{
  "layoutModules": [
    {
      "module": "headline zone / product hero / background / verified evidence / badges / process row / category cards / CTA bar",
      "referencePattern": "what to reuse from the viral poster structure or style",
      "localAssetRole": "product photo / factory image / packaging image / certificate image / scene image / brand visual / none",
      "replacementInstruction": "how to replace competitor content with our verified assets and copy"
    }
  ],
  "poster": {
    "headline": "string",
    "subheadline": "string",
    "originBadge": "string",
    "trustBadges": ["only an exact certification from the authenticated profile, otherwise empty"],
    "sellingPoints": ["only an exact verified product fact"],
    "process": ["only steps explicitly supported by the authenticated profile, otherwise empty"],
    "categories": [{"name":"verified product name or category","description":"verified neutral description"}],
    "bottomBar": ["only verified facts, otherwise empty"],
    "cta": "string"
  },
  "caption": "3 short paragraphs with emoji hooks and CTA",
  "hashtags": ["verified product/category terms only; capability tags such as OEM or private label require profile evidence"],
  "commentCta": "string",
  "dmOpening": "string",
  "fieldsToConfirm": ["every desired but missing commercial field; do not put its value elsewhere"],
  "imagePrompt": "detailed prompt for a no-extra-text B2B product poster image model; include layoutModules as composition guidance, include all poster text exactly as above, mention product replacement, background/style reuse, verified local material roles, sections, and layout"
}`;

      const backends = [providerOpt] as const;
      const failures: string[] = [];
      for (const backend of backends) {
        try {
          const text = await callLLM(prompt, { backend, systemPrompt: productEnterprise, timeoutMs: 30_000 });
          const obj = extractJSON<any>(text);
          if (obj?.poster?.headline && obj?.caption) {
            const normalized = {
              ...obj,
              poster: normalizePosterBrief(obj.poster),
              caption: String(obj.caption || ''),
              commentCta: String(obj.commentCta || ''),
              dmOpening: String(obj.dmOpening || ''),
              imagePrompt: String(obj.imagePrompt || ''),
            };
            const audit = auditCommercialClaims(userFacingPosterText(normalized), commercialEvidence);
            // Missing commercial fields invented or requested by the model are not
            // user requirements. Strip them from the draft and only block when the
            // user's own brief/reference explicitly asks to retain such a claim.
            const requestedCommercialFields = auditCommercialClaims(referenceNotes, commercialEvidence).fieldsToConfirm;
            let fieldsToConfirm = confirmationFields([...requestedCommercialFields, ...audit.fieldsToConfirm]);
            let safeDraft = audit.issues.length || audit.fieldsToConfirm.length
              ? sanitizePosterCommercialClaims(normalized, commercialEvidence)
              : normalized;
            if (!safeDraft.poster.headline) safeDraft.poster.headline = neutral.headline;
            const remainingAudit = auditCommercialClaims(userFacingPosterText(safeDraft), commercialEvidence);
            if (remainingAudit.issues.length) {
              // A stubborn model sentence must not block first-draft production.
              // Fall back to deterministic neutral copy and carry every unresolved
              // claim into review, where it blocks publishing rather than creation.
              fieldsToConfirm = confirmationFields([...fieldsToConfirm, ...remainingAudit.fieldsToConfirm]);
              safeDraft = {
                ...safeDraft,
                poster: {
                  ...normalizePosterBrief({}),
                  headline: neutral.headline,
                  subheadline: neutral.subheadline,
                  cta: neutral.cta,
                },
                caption: neutral.caption,
                hashtags: [],
                commentCta: '',
                dmOpening: '',
                imagePrompt: language === 'zh'
                  ? '使用已提供的企业产品图片，制作不含额外商业声明的中性产品展示海报。'
                  : `Create a neutral product presentation using the supplied enterprise product images, without additional commercial claims. All newly authored visible text must be in ${lang}.`,
              };
            }
            const publishable = fieldsToConfirm.length === 0;
            await respond({
              ok: true,
              source: 'ai',
              provenance: 'ai',
              publishable,
              qualityStatus: publishable ? 'passed' : 'needs_confirmation',
              provider: backend,
              layoutModules: Array.isArray(obj.layoutModules) ? obj.layoutModules.slice(0, 12) : [],
              poster: safeDraft.poster,
              caption: safeDraft.caption,
              hashtags: mergePlannedHashtags(safeDraft.hashtags, keywordResearch, 10),
              commentCta: safeDraft.commentCta,
              dmOpening: safeDraft.dmOpening,
              fieldsToConfirm,
              imagePrompt: safeDraft.imagePrompt,
            });
            return;
          }
          failures.push(`${backend}: parse_failed`);
        } catch (err: any) {
          failures.push(`${backend}: ${String(err?.message || err).slice(0, 180)}`);
        }
      }
      console.warn('[studio] fb-poster generation failed:', failures.join(' | '));
      const selectedProductName = String(productInfo).match(/^\s*产品名称[：:]\s*([^\r\n]+)/m)?.[1]?.trim().slice(0, 120)
        || neutral.headline;
      await respond({
        ok: true,
        source: 'ai',
        provenance: 'deterministic_fallback',
        publishable: false,
        qualityStatus: 'needs_confirmation',
        provider: 'local_fallback',
        layoutModules: [],
        poster: {
          ...normalizePosterBrief({}),
          headline: neutral.headline,
          subheadline: neutral.subheadline,
          cta: neutral.cta,
        },
        caption: `${neutral.caption} (${selectedProductName})`,
        hashtags: [],
        commentCta: '',
        dmOpening: '',
        fieldsToConfirm: [],
        imagePrompt: language === 'zh'
          ? `使用已提供的企业产品图片，为 ${selectedProductName} 制作中性产品展示海报，不添加未经确认的商业声明。`
          : `Create a neutral product presentation for ${selectedProductName} using the supplied enterprise product images, without unverified commercial claims. All newly authored visible text must be in ${lang}.`,
      });
    });
  }

  return { registerPostFbPoster };
}
