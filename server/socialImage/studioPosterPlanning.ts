import { imageLanguageSchema, normalizeImageLanguage } from '../../shared/contracts/imageLanguages.js';
import { neutralSocialImageCopy } from '../socialImage/socialImageLanguageCopy.js';
import { extractJSON, langName } from '../routes/studioTranslationCore.js';
import { IMAGE_DELIVERABLES, IMAGE_DELIVERABLE_LABELS, IMAGE_PRODUCTION_STRATEGIES, type ImageDeliverable, type ImageProductionStrategy } from '../../shared/imageCreativePlanning.js';
import { callLLM } from '../agents/llm.js';
import { normalizePosterBrief } from '../socialImage/studioPosterHelpers.js';
import { keywordPromptContext, mergePlannedHashtags, researchSocialImageKeywords } from '../lib/keywordIntelligence.js';
import { auditCommercialClaims, confirmationFields, confirmedEnterpriseContextForProduct, hasConfirmedEnterpriseFacts, sanitizePosterCommercialClaims, unconfirmedEnterpriseProductFields, userFacingPosterText } from '../lib/studioGenerationTruthfulness.js';
import type { DataStore } from '../storage/datastore.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
import { socialImageV3PaidPrerequisiteIssue } from '../socialImage/socialImagePaidPrerequisites.js';
import { recordSocialImageV3DirectorBrief, socialImageV3TrustedPlanningRequest, type SocialImageFormalPlannerResult } from '../socialImage/socialImageFormalPlan.js';
import { socialImageEnglishTitleMatchesPackaging } from './socialImagePackagingLabel.js';
import { assertSocialImageCurrentContentTask, SocialImageProductionRunError } from '../socialImage/socialImageProductionRun.js';
export interface PosterPlanningInput {
    imageTaskId?: string;
    expectedImageTaskVersion?: number;
    deliverableType?: ImageDeliverable;
    productionStrategy?: ImageProductionStrategy;
    productInfo?: string;
    platform?: string;
    ratio?: string;
    posterStyle?: string;
    language?: string;
    provider?: string;
    materials?: Array<{
        name?: string;
        role?: string;
    }>;
    referenceNotes?: string;
    referenceCaption?: string;
    brandName?: string;
    categoryTerms?: string[];
    targetMarket?: string;
    confirmedFields?: Record<string, string>;
}
export class PosterPlanningError extends Error {
    constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.code || body.error || 'social_image_planning_failed')); }
}
export async function planStudioPoster(input: {
    store: DataStore;
    tenantId: string;
    body: PosterPlanningInput;
    enterpriseCtx: () => Promise<string>;
    allowPaidCall: () => Promise<boolean>;
    callPlanner?: typeof callLLM;
    beforeProviderCall?: () => Promise<void>;
    packagingHint?: string;
}) {
    const { store, tenantId, body, enterpriseCtx, allowPaidCall, callPlanner = callLLM, beforeProviderCall } = input;
    const imageTaskId = String(body?.imageTaskId || '').trim();
    const boundTask = imageTaskId ? await readSocialImageTask(store, tenantId, imageTaskId) : null;
    if (imageTaskId && (!boundTask || boundTask.schemaVersion !== 'social-image-creation.v3'
        || Number(body?.expectedImageTaskVersion) !== boundTask.version)) {
        throw new PosterPlanningError(409, { ok: false, code: 'social_image_planning_task_version_conflict',
            error: '图片任务不存在、不是当前生产版本，或已被更新' });
    }
    if (boundTask) {
        try {
            await assertSocialImageCurrentContentTask(store, tenantId, boundTask);
        }
        catch (error) {
            const failure = error instanceof SocialImageProductionRunError ? error
                : new SocialImageProductionRunError('social_image_content_task_read_failed', 503);
            throw new PosterPlanningError(failure.status, { ok: false, code: failure.code, error: failure.code });
        }
        const issue = socialImageV3PaidPrerequisiteIssue(boundTask, 'queue');
        if (!['social_image_director_brief_required', 'social_image_director_brief_stale'].includes(issue || '')) {
            throw new PosterPlanningError(422, { ok: false, code: issue || 'social_image_director_brief_already_completed',
                error: '图片上游证据尚未就绪，不能发起编导策划' });
        }
    }
    const respond = async (result: Record<string, unknown> & SocialImageFormalPlannerResult) => {
        if (!boundTask)
            return result;
        try {
            const imageTask = await recordSocialImageV3DirectorBrief({ store, tenantId, taskId: boundTask.id,
                expectedVersion: boundTask.version, result });
            return { ...result, imageTask };
        }
        catch (error) {
            const failure = error instanceof SocialImageProductionRunError ? error
                : new SocialImageProductionRunError('social_image_director_brief_persist_failed', 503);
            throw new PosterPlanningError(failure.status, { ok: false, code: failure.code, error: failure.code });
        }
    };
    const planningRequest: PosterPlanningInput = boundTask ? socialImageV3TrustedPlanningRequest(boundTask) : body;
    const { deliverableType: rawDeliverableType = 'social_poster', productionStrategy: rawProductionStrategy = 'reference_generate', productInfo = '', platform = 'facebook', ratio = '1:1', posterStyle = 'oem-factory', language: rawLanguage = 'en', provider, materials = [], referenceNotes = '', referenceCaption = '', brandName = '', categoryTerms = [], targetMarket = '', confirmedFields = {}, } = planningRequest;
    const parsedLanguage = imageLanguageSchema.safeParse(normalizeImageLanguage(rawLanguage));
    if (!parsedLanguage.success) {
        throw new PosterPlanningError(400, { ok: false, code: 'social_image_language_unsupported', error: '请选择支持的图文语言。' });
    }
    const language = parsedLanguage.data;
    if (!await allowPaidCall())
        return;
    const neutral = neutralSocialImageCopy(language);
    const deliverableType: ImageDeliverable = IMAGE_DELIVERABLES.includes(rawDeliverableType)
        ? rawDeliverableType : 'social_poster';
    const productionStrategy: ImageProductionStrategy = IMAGE_PRODUCTION_STRATEGIES.includes(rawProductionStrategy) ? rawProductionStrategy : 'reference_generate';
    const providerOpt: 'qwen' = 'qwen';
    const lang = langName(language), keywordResearch = researchSocialImageKeywords({ platform, language, targetMarket, brandName, productInfo, categoryTerms, referenceCaption, maxHashtags: 8 });
    const enterprise = await enterpriseCtx();
    if (!hasConfirmedEnterpriseFacts(enterprise)) {
        throw new PosterPlanningError(422, {
            ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
            code: 'ENTERPRISE_PROFILE_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品与商业能力资料'],
            error: '企业中心尚无已确认资料，不能生成商业海报文案。',
        });
    }
    if (!String(productInfo || '').trim()) {
        throw new PosterPlanningError(422, {
            ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
            code: 'ENTERPRISE_PRODUCT_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品资料'],
            error: '请先选择企业中心已确认产品；未调用模型生成海报文案。',
        });
    }
    const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
    const taskConfirmedFacts = Object.entries(confirmedFields && typeof confirmedFields === 'object' && !Array.isArray(confirmedFields) ? confirmedFields : {}).slice(0, 20).map(([field, value]) => {
        const safeField = String(field || '').replace(/[\r\n：:]/g, ' ').trim().slice(0, 80);
        const safeValue = String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, 500);
        return safeField && safeValue ? `${safeField}：${safeValue}` : '';
    }).filter(Boolean).join('\n');
    const commercialEvidence = [productEnterprise, taskConfirmedFacts ? `本次任务由用户确认的商业事实：\n${taskConfirmedFacts}` : ''].filter(Boolean).join('\n');
    const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
    if (unconfirmedProductFields.length) {
        throw new PosterPlanningError(422, {
            ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
            code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', caption: '', hashtags: [], fieldsToConfirm: unconfirmedProductFields,
            error: '海报请求中的产品资料无法在当前企业中心已确认资料中核对。',
        });
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

Approximate OCR from the bound enterprise product package (identity spelling hint only, not a new commercial claim):
${boundTask ? input.packagingHint || '(unreadable)' : '(not available)'}

Selected material references:
${materialLines || '(none selected yet)'}

Reference / inspiration notes: ${String(referenceNotes || '').slice(0, 1500) || '(none)'}; ${keywordPromptContext(keywordResearch)}

Hard rules:
- AI may optimize expression, but must not invent commercial promises.
- MOQ, certifications, lead time, price, export countries, factory qualifications must come from the authenticated profile or explicit user-confirmed task facts; otherwise place them in fieldsToConfirm.
- If inspiration notes exist, output a module-level deconstruction and local asset matching plan. The final image must be a new composition using our product/materials, not a copy of the reference.
- Shape the composition for the requested finished image (${deliverableType}); do not silently change it into another asset type.- Poster text should be concise enough for a dense B2B product-information poster.
- Use exact English text for poster fields when language is English.
- If the package has a readable English product name, keep its product-type word exactly; do not rename Honey to Mousse, or introduce another variant.
- Make the visible headline at most 42 characters, supporting text at most 60 characters and CTA at most 42 characters. Put longer explanations in the caption, not the image.
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
            await beforeProviderCall?.();
            const text = await callPlanner(prompt, { backend, systemPrompt: productEnterprise, timeoutMs: boundTask ? 90_000 : 30_000 });
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
                // Claims invented by the model are removed from the draft; they
                // are not extra requirements that the customer must confirm.
                let fieldsToConfirm = confirmationFields(requestedCommercialFields);
                let safeDraft = audit.issues.length || audit.fieldsToConfirm.length
                    ? sanitizePosterCommercialClaims(normalized, commercialEvidence)
                    : normalized;
                if (!safeDraft.poster.headline)
                    safeDraft.poster.headline = neutral.headline;
                if (!safeDraft.caption)
                    safeDraft.caption = neutral.caption;
                if (boundTask) {
                    if (language === 'en' && !socialImageEnglishTitleMatchesPackaging(safeDraft.poster.headline, input.packagingHint || '')) {
                        safeDraft = { ...safeDraft, poster: { ...normalizePosterBrief({}),
                            headline: neutral.headline, subheadline: neutral.subheadline, cta: neutral.cta },
                            caption: neutral.caption, hashtags: [], commentCta: '', dmOpening: '' };
                    }
                    if (safeDraft.poster.headline.length > 42) safeDraft.poster.headline = neutral.headline;
                    if (safeDraft.poster.subheadline.length > 60) safeDraft.poster.subheadline = neutral.subheadline;
                    if (safeDraft.poster.cta.length > 42) safeDraft.poster.cta = neutral.cta;
                    if (language === 'en') {
                        for (const field of ['headline', 'subheadline', 'cta'] as const) {
                            const withoutOriginalNames = boundTask.contentBrief.productNames
                                .reduce((text, name) => text.split(name).join(''), safeDraft.poster[field]);
                            if (/[\u3400-\u9fff]/u.test(withoutOriginalNames)) safeDraft.poster[field] = neutral[field];
                        }
                        const withoutOriginalNames = boundTask.contentBrief.productNames
                            .reduce((text, name) => text.split(name).join(''), safeDraft.caption);
                        if (/[\u3400-\u9fff]/u.test(withoutOriginalNames)) safeDraft.caption = neutral.caption;
                        safeDraft.hashtags = (Array.isArray(safeDraft.hashtags) ? safeDraft.hashtags : [])
                            .filter((tag: unknown): tag is string => typeof tag === 'string' && !/[\u3400-\u9fff]/u.test(tag));
                    }
                    // The fixed compositor renders only three short, verified
                    // copy zones. Dense model-generated rows cannot become tiny
                    // labels or unsupported commercial badges in the output.
                    safeDraft.poster = normalizePosterBrief({ headline: safeDraft.poster.headline,
                        subheadline: safeDraft.poster.subheadline, cta: safeDraft.poster.cta });
                    // The model's free-form image prompt may repeat rejected text.
                    // Layout measurements and the admitted poster contract are enough
                    // for rendering; never send stale model prose to the image model.
                    safeDraft.imagePrompt = `Create a visually polished ${ratio} product presentation. Use the selected enterprise product as the only identity source and preserve the measured reference layout. No additional text or commercial assertions. Newly authored text uses ${lang}.`;
                }
                const remainingAudit = auditCommercialClaims(userFacingPosterText(safeDraft), commercialEvidence);
                if (remainingAudit.issues.length || remainingAudit.fieldsToConfirm.length) {
                    // A stubborn model sentence must not block first-draft production.
                    // It cannot become a customer requirement: replace it with
                    // neutral copy, leaving only the customer's own claims pending.
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
                if (boundTask) {
                    // The enterprise profile may contain broad marketing copy for
                    // this or other products. A model paraphrase is not evidence
                    // that a claim belongs in this particular user-confirmed
                    // image task. Keep the package-checked product title, and use
                    // localized, claim-free supporting copy until an explicit
                    // per-task claim contract and verifier are available.
                    safeDraft = {
                        ...safeDraft,
                        poster: { ...safeDraft.poster, subheadline: neutral.subheadline, cta: neutral.cta },
                        caption: neutral.caption,
                        hashtags: [],
                        commentCta: '',
                        dmOpening: '',
                    };
                }
                const publishable = fieldsToConfirm.length === 0;
                return await respond({
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
            }
            failures.push(`${backend}: parse_failed`);
        }
        catch (err: any) {
            if (err instanceof PosterPlanningError) throw err;
            // A bound production task has already submitted a potentially paid
            // request. Preserve the uncertainty rather than disguising a timeout
            // as an editable, locally generated director brief.
            if (boundTask) {
                const timedOut = /timed out|timeout/i.test(String(err?.message || err));
                throw new PosterPlanningError(timedOut ? 504 : 502, {
                    ok: false, code: timedOut ? 'social_image_planning_provider_outcome_unknown' : 'social_image_planning_provider_failed',
                    error: timedOut ? '图文策划请求已超时，供应商结果尚未核对；不会自动重复提交。' : '图文策划未取得有效供应商结果；不会自动重复提交。',
                });
            }
            failures.push(`${backend}: ${String(err?.message || err).slice(0, 180)}`);
        }
    }
    if (boundTask) {
        throw new PosterPlanningError(502, { ok: false, code: 'social_image_planning_response_invalid',
            error: '图文策划响应未通过结构校验；不会自动重复提交。' });
    }
    console.warn('[studio] fb-poster generation failed:', failures.join(' | '));
    const selectedProductName = String(productInfo).match(/^\s*产品名称[：:]\s*([^\r\n]+)/m)?.[1]?.trim().slice(0, 120)
        || neutral.headline;
    return await respond({
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
}
