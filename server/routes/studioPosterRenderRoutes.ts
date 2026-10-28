import { materialResponse } from './studioMaterialProjection.js';
import { IMAGE_DELIVERABLES, IMAGE_PRODUCTION_STRATEGIES, type ImageDeliverable, type ImageProductionStrategy } from '../../shared/imageCreativePlanning.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { requestMaterialAnalysis } from '../lib/materialLibraryAnalysis.js';
import { randomUUID, createHash } from 'node:crypto';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { generatePosterImage, ImageProviderRejectedError, normalizeImageGenerationQuality, type ReferenceImage } from '../lib/imageGen.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { claimSocialImagePaidJob, completeSocialImagePaidJob, markSocialImagePaidJobNotSubmitted, recordSocialImagePaidJobFailure, socialImageOwnedMaterialUrl, SocialImagePaidJobError } from '../socialImage/socialImagePaidJob.js';
import { claimSocialImagePlannedUnit, socialImagePlannedRenderInput } from '../socialImage/socialImageDurablePlan.js';
import { buildStudioSocialImagePaidPrompt, socialImageReferenceRoleText, verifyFrozenGifProductAssets } from '../socialImage/socialImagePaidRenderAdmission.js';
import { readSocialImageTask } from '../socialImage/socialImageTask.js';
import { normalizePosterBrief } from '../socialImage/studioPosterHelpers.js';
import { SOCIAL_IMAGE_HARD_CHECKS } from '../../shared/contracts/socialImageCreation.js';
import { auditCommercialClaims, confirmationFields, hasConfirmedEnterpriseFacts, sanitizePosterCommercialClaims, upstreamGenerationFailure, userFacingPosterText } from '../lib/studioGenerationTruthfulness.js';
import { type AuthLocals } from '../middleware/auth.js';
import type { PosterReferenceDescriptor } from '../studio/contracts.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';
import { conformSocialImageToCanvas, socialImageCanvasForAspectRatio, type SocialImageAspectRatio } from '../socialImage/referenceCanvas.js';
import { socialImageFrozenCommercialIssue, socialImageV3PaidPrerequisiteIssue, socialImageV3RenderSpecInputHash,
  socialImageV3ReferencePermitted, socialImageV3ResolvedAssetIssue,
  socialImageV3SingleRenderInput } from '../socialImage/socialImagePaidPrerequisites.js';
import { readSocialImageReferenceBytes } from '../socialImage/socialImageReferenceBytes.js';
import { submitClaimedSocialImageSingleRender } from '../socialImage/socialImagePaidSingleRender.js';

export function createStudioPosterRenderRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'enterpriseCtx' | 'storyboardUrlImage' | 'storyboardEnterpriseImage' | 'resolveReferenceImages'>) {
  const studioRouter = deps.studioRouter;
  const enterpriseCtx: StudioApplicationPorts['enterpriseCtx'] = (...args) => deps.enterpriseCtx(...args);
  const storyboardUrlImage: StudioApplicationPorts['storyboardUrlImage'] = (...args) => deps.storyboardUrlImage(...args);
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const resolveReferenceImages: StudioApplicationPorts['resolveReferenceImages'] = (...args) => deps.resolveReferenceImages(...args);

  function registerPostFbPosterRender() {
    studioRouter.post('/fb-poster/render', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const imageTaskId = String(req.body?.imageTaskId || '').trim();
      const imageJobId = String(req.body?.imageJobId || '').trim();
      if (Boolean(imageTaskId) !== Boolean(imageJobId)) {
        res.status(400).json({ ok: false, code: 'SOCIAL_IMAGE_JOB_IDENTITY_REQUIRED', error: '图片任务与生成单元必须同时指定' });
        return;
      }
      let plannedInput: ReturnType<typeof socialImagePlannedRenderInput> | null = null;
      let plannedImageTask: Awaited<ReturnType<typeof readSocialImageTask>> = null;
      let v3ImageTask: Awaited<ReturnType<typeof readSocialImageTask>> = null;
      let v3SingleInput: ReturnType<typeof socialImageV3SingleRenderInput> = null;
      if (imageTaskId) {
        try {
          const imageTask = await readSocialImageTask(store, tenantId, imageTaskId);
          if (!imageTask) throw new SocialImagePaidJobError('social_image_task_missing');
          if (imageTask.schemaVersion === 'social-image-creation.v3') {
            const issue = socialImageV3PaidPrerequisiteIssue(imageTask, 'execute');
            if (issue) throw new SocialImagePaidJobError(issue);
            v3ImageTask = imageTask;
          }
          if (imageTask.imageType === 'carousel' || imageTask.imageType === 'gif_poster') {
            plannedInput = socialImagePlannedRenderInput(imageTask, imageJobId);
            plannedImageTask = imageTask;
          } else if (v3ImageTask) {
            v3SingleInput = socialImageV3SingleRenderInput(imageTask, imageJobId);
            if (imageTask.contentBrief.productRefs.length) {
              throw new SocialImagePaidJobError('social_image_product_cutout_queue_required');
            }
          }
        } catch (error) {
          const code = error instanceof SocialImagePaidJobError ? error.code
            : error instanceof Error && error.message.startsWith('social_image_') ? error.message : 'social_image_render_admission_failed';
          res.status(code === 'social_image_task_missing' ? 404 : 409).json({ ok: false, code, error: '图片任务未通过冻结证据与计划校验；未调用图片供应商' });
          return;
        }
      }
      if (!imageTaskId && !await consumeDemoQuota(req, res, 'generation')) return;
      const {
        poster = null,
        imagePrompt = '', imageQuality: rawImageQuality = 'low',
        ratio = '1:1',
        materialIds = [],
        productIds = [],
        deliverableType: rawDeliverableType = 'social_poster',
        productionStrategy: rawProductionStrategy = 'reference_generate',
        referencePlan = [],    referenceImageUrls = [],
        idempotencyKey = '',
        confirmedFields = {},
      } = plannedInput ? {
        poster: plannedInput.poster,
        imagePrompt: plannedInput.imagePrompt,
        imageQuality: plannedInput.quality,
        ratio: plannedInput.ratio,
        materialIds: plannedInput.materialIds,
        productIds: plannedInput.productIds,
        referenceImageUrls: plannedInput.referenceImageUrls,
        referencePlan: plannedInput.referencePlan,
        deliverableType: plannedInput.deliverableType,
        productionStrategy: plannedInput.productionStrategy,
        idempotencyKey: plannedInput.idempotencyKey,
        confirmedFields: {},
      } : v3SingleInput || req.body || {};
      const deliverableType: ImageDeliverable = IMAGE_DELIVERABLES.includes(rawDeliverableType)
        ? rawDeliverableType : 'social_poster';
      const productionStrategy: ImageProductionStrategy = IMAGE_PRODUCTION_STRATEGIES.includes(rawProductionStrategy) ? rawProductionStrategy : 'reference_generate';
      const enterprise = await enterpriseCtx();
      if (!hasConfirmedEnterpriseFacts(enterprise)) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: 'ENTERPRISE_PROFILE_REQUIRED', error: '企业中心尚无已确认资料，不能生成商业海报图片。',
          fieldsToConfirm: ['企业产品与商业能力资料'],
        });
        return;
      }
      const normalizedPoster = normalizePosterBrief(poster || {});
      const taskConfirmedFacts = Object.entries(
        confirmedFields && typeof confirmedFields === 'object' && !Array.isArray(confirmedFields) ? confirmedFields : {},
      ).slice(0, 20).map(([field, value]) => {
        const safeField = String(field || '').replace(/[\r\n：:]/g, ' ').trim().slice(0, 80);
        const safeValue = String(value || '').replace(/[\r\n]/g, ' ').trim().slice(0, 500);
        return safeField && safeValue ? `${safeField}：${safeValue}` : '';
      }).filter(Boolean).join('\n');
      const commercialEvidence = [enterprise, taskConfirmedFacts ? `本次任务由用户确认的商业事实：\n${taskConfirmedFacts}` : ''].filter(Boolean).join('\n');
      const commercialAudit = auditCommercialClaims(userFacingPosterText({ poster: normalizedPoster, imagePrompt }), commercialEvidence);
      if (v3ImageTask) {
        const issue = socialImageFrozenCommercialIssue({ ...commercialAudit,
          headline: normalizedPoster.headline, imagePrompt: String(imagePrompt || '') });
        if (issue) {
          res.status(409).json({ ok: false, code: issue,
            error: '已冻结的图片文案与企业事实不一致；请重新策划并冻结输入，未调用图片供应商' });
          return;
        }
      }
      // Generation is allowed to continue with a conservative draft. Unverified
      // claims remain visible review warnings and block publishing, not creation.
      const safeDraft = !v3ImageTask && (commercialAudit.issues.length || commercialAudit.fieldsToConfirm.length)
        ? sanitizePosterCommercialClaims({ poster: normalizedPoster, imagePrompt: String(imagePrompt || '') }, commercialEvidence)
        : { poster: normalizedPoster, imagePrompt: String(imagePrompt || '') };
      const safePoster = normalizePosterBrief(safeDraft.poster || {});
      if (!v3ImageTask && !safePoster.headline) safePoster.headline = 'Product overview';
      const safeImagePrompt = v3ImageTask ? String(imagePrompt) : String(safeDraft.imagePrompt || 'Create a neutral product presentation background.').trim();
      const headline = safePoster.headline;
      const benchmarkReferences: ReferenceImage[] = [];
      let v3ReferenceHash: string | null = null;
      if (v3ImageTask?.creationPath === 'viral_replication') {
        const referenceUrl = v3ImageTask.referenceSnapshot?.imageUrls[0] || v3ImageTask.referenceUrls[0] || '';
        const source = referenceUrl ? await readSocialImageReferenceBytes(tenantId, referenceUrl) : null;
        v3ReferenceHash = source?.bytes.length ? createHash('sha256').update(source.bytes).digest('hex') : null;
      }
      for (const url of Array.isArray(referenceImageUrls) ? referenceImageUrls.map(String).slice(0, 1) : []) {
        const reference = await storyboardUrlImage(url, tenantId) || await storyboardEnterpriseImage(url, tenantId);
        if (reference) benchmarkReferences.push(reference);
      }
      if (v3ImageTask?.creationPath === 'viral_replication' && socialImageV3ReferencePermitted(v3ImageTask)
        && (!benchmarkReferences[0] || createHash('sha256').update(Buffer.from(benchmarkReferences[0].base64, 'base64')).digest('hex') !== v3ReferenceHash)) {
        res.status(409).json({ ok: false, code: 'social_image_reference_bytes_changed', error: '参考图原始字节已变化；未调用图片供应商' });
        return;
      }
      const productReferences: Array<{ productId: string; image: ReferenceImage }> = [];
      const v3ProductHashes: Record<string, string> = {};
      const assetFieldsToConfirm: string[] = [];
      if (plannedInput?.unit.role === 'gif_plate' && plannedImageTask) {
        const profile = await readTenantEnterpriseProfile(tenantId);
        const products = profile.products.items || [];
        try { Object.assign(v3ProductHashes, await verifyFrozenGifProductAssets(plannedImageTask, products, productIdentity, async imageUrl => {
            const image = await storyboardEnterpriseImage(imageUrl, tenantId);
            return image ? Buffer.from(image.base64, 'base64') : null;
          })); } catch (error) {
          res.status(409).json({ ok: false, code: error instanceof SocialImagePaidJobError ? error.code : 'social_image_gif_product_identity_changed',
            error: '企业产品主图与冻结计划不一致；未调用图片供应商' }); return;
        }
      }
      const requestedProductIds = Array.isArray(productIds) ? productIds.map(String).filter(Boolean).slice(0, 2) : [];
      if (requestedProductIds.length) {
        const profile = await readTenantEnterpriseProfile(tenantId);
        const products = profile.products.items || [];
        for (const requestedId of requestedProductIds) {
          const product = products.find((item, index) => productIdentity(item, index) === requestedId);
          const imageUrl = String(product?.images?.[0]?.url || product?.imageUrl || '');
          const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
          if (!product || !image) {
            assetFieldsToConfirm.push(`产品主图待补充：${String(product?.name || requestedId)}`);
            continue;
          }
          productReferences.push({ productId: requestedId, image });
          v3ProductHashes[requestedId] = createHash('sha256').update(Buffer.from(image.base64, 'base64')).digest('hex');
        }
      }
      const hasMaterialReferences = Array.isArray(materialIds) && materialIds.some(Boolean);
      const referenceResolution = hasMaterialReferences
        ? await resolveReferenceImages(materialIds, tenantId, referencePlan)
        : { images: [] as ReferenceImage[], descriptors: [] as PosterReferenceDescriptor[], blockers: [] as string[] };
      if (v3ImageTask) {
        const materialHashes = Object.fromEntries(referenceResolution.descriptors.map((descriptor, index) => [
          descriptor.materialId,
          referenceResolution.images[index]
            ? createHash('sha256').update(Buffer.from(referenceResolution.images[index]!.base64, 'base64')).digest('hex') : '',
        ]));
        const issue = socialImageV3ResolvedAssetIssue(v3ImageTask, {
          productHashes: v3ProductHashes, materialHashes, referenceHash: v3ReferenceHash,
        });
        if (issue) {
          res.status(409).json({ ok: false, code: issue, error: '已核验的图片素材与当前原始字节不一致；未调用图片供应商' });
          return;
        }
      }
      const exactProductIds = new Set(referenceResolution.descriptors
        .filter(item => item.role === 'exact_product').map(item => item.productId).filter(Boolean));
      for (const item of productReferences) exactProductIds.add(item.productId);
      const missingProductIds = requestedProductIds.filter(id => !exactProductIds.has(id));
      const ownedReferences = [...productReferences.map(item => item.image), ...referenceResolution.images]
        .slice(0, benchmarkReferences.length ? 2 : 3);
      const referenceBlockers = [
        ...referenceResolution.blockers,
        ...(missingProductIds.length ? [`缺少当前产品的精准身份图片：${missingProductIds.join('、')}`] : []),
        ...(!ownedReferences.length && plannedInput?.unit.role !== 'gif_plate' ? ['没有可用于锁定产品或企业身份的已授权图片'] : []),
      ];
      if (referenceBlockers.length) {
        res.status(422).json({
          ok: false, code: 'IMAGE_REFERENCE_ADMISSION_FAILED', publishable: false, qualityStatus: 'rejected',
          error: `图片参考素材未通过生产准入：${referenceBlockers.join('；')}`,
          fieldsToConfirm: confirmationFields(assetFieldsToConfirm),
        });
        return;
      }
      // Tenant-owned identity references stay first. A competitor image can only
      // be the final style benchmark and never becomes product authority.
      const references = [...ownedReferences, ...benchmarkReferences].slice(0, 3);
      const referenceRoleText = socialImageReferenceRoleText({ productIds: productReferences.map(item => item.productId),
        materialReferences: referenceResolution.descriptors, benchmarkCount: benchmarkReferences.length,
        ownedReferenceCount: ownedReferences.length });
      const prompt = buildStudioSocialImagePaidPrompt({ sceneIntent: safeImagePrompt, ratio: String(ratio),
        language: v3ImageTask?.deliverySpec.language,
        poster: safePoster, deliverableType, productionStrategy, referenceRoleText,
        benchmarkCount: benchmarkReferences.length, ownedReferenceCount: ownedReferences.length,
        ...(plannedInput?.unit.role === 'gif_plate' ? { gifUnit: plannedInput.unit } : {}),
      });
      let paidInputHash = '';
      let paidRequestMayHaveStarted = false;
      try {
        let claimedImageTask = null as Awaited<ReturnType<typeof claimSocialImagePaidJob>> | null;
        if (imageTaskId) {
          paidInputHash = createHash('sha256').update(JSON.stringify({
            prompt, ratio, quality: normalizeImageGenerationQuality(rawImageQuality),
            references: references.map(item => createHash('sha256').update(Buffer.from(item.base64, 'base64')).digest('hex')),
            requestedProductIds, materialIds, imageTaskId, imageJobId,
            plannedInputHash: plannedInput?.unit.plannedInputHash || null,
            renderSpecInputHash: v3ImageTask ? socialImageV3RenderSpecInputHash(v3ImageTask) : null,
          })).digest('hex');
          claimedImageTask = plannedInput
            ? await claimSocialImagePlannedUnit({
              store, tenantId, taskId: imageTaskId, jobId: imageJobId,
              idempotencyKey: plannedInput.idempotencyKey,
              plannedInputHash: plannedInput.unit.plannedInputHash,
              renderRequestHash: paidInputHash,
            })
            : await claimSocialImagePaidJob({
              store, tenantId, taskId: imageTaskId, jobId: imageJobId,
              idempotencyKey: String(idempotencyKey || '').trim(), inputHash: paidInputHash,
            });
          if (!await consumeDemoQuota(req, res, 'generation')) {
            await markSocialImagePaidJobNotSubmitted({ store, tenantId, taskId: imageTaskId, jobId: imageJobId, inputHash: paidInputHash, reason: 'demo_quota_denied' })
              .catch(error => console.warn('[studio] image quota rejection could not release claimed job', error instanceof Error ? error.message : error));
            return;
          }
        }
        paidRequestMayHaveStarted = true;
        const requestedRatio = ['1:1', '4:5', '9:16', '16:9'].includes(String(ratio)) ? String(ratio) as SocialImageAspectRatio : '1:1';
        if (v3ImageTask && !plannedInput && claimedImageTask) {
          const rendered = await submitClaimedSocialImageSingleRender({ store, tenantId,
            task: claimedImageTask, jobId: imageJobId, inputHash: paidInputHash, prompt,
            ratio: requestedRatio, quality: normalizeImageGenerationQuality(rawImageQuality),
            references, idempotencyKey: String(idempotencyKey), productId: requestedProductIds[0]!,
            materialIds: referenceResolution.descriptors.map(item => item.materialId),
            benchmarkReferenceCount: benchmarkReferences.length });
          const responseMaterial = await materialResponse(rendered.material, tenantId);
          res.json({ ok: true, task: rendered.task, source: rendered.generated.source,
            model: rendered.generated.model, url: responseMaterial.url,
            material: responseMaterial, references: references.length,
            deliverableType, productionStrategy,
            fieldsToConfirm: confirmationFields([...commercialAudit.fieldsToConfirm, ...assetFieldsToConfirm]),
            qualityStatus: 'needs_review', publishable: false });
          return;
        }
        const generated = await generatePosterImage({ prompt, ratio: requestedRatio, references, provider: 'openai', quality: normalizeImageGenerationQuality(rawImageQuality), idempotencyKey: String(idempotencyKey || '').trim() || undefined });
        const normalizedBytes = await conformSocialImageToCanvas(generated.bytes, socialImageCanvasForAspectRatio(requestedRatio));
        const material = await createGeneratedImageMaterial({
          title: `AI 图文海报 · ${headline}`.slice(0, 120),
          bytes: normalizedBytes,
          mimeType: 'image/png',
          source: generated.source,
          tenantId,
          sourceType: 'ai_generated_marketing_image',
          productId: requestedProductIds.length === 1 ? requestedProductIds[0] : undefined,
          provenance: {
            deliverableType,
            productionStrategy,
            inputMaterialIds: referenceResolution.descriptors.map(item => item.materialId),
            inputRoles: referenceResolution.descriptors,
            inputProductIds: requestedProductIds,
            benchmarkReferenceCount: benchmarkReferences.length,
            promptSha256: createHash('sha256').update(prompt).digest('hex'),
            ...(imageTaskId ? { socialImageTaskId: imageTaskId, socialImageJobId: imageJobId, socialImageInputHash: paidInputHash } : {}),
            model: generated.model,
            qualityStatus: 'needs_review',
          },
        });
        void requestMaterialAnalysis(tenantId, material.id).catch(error => {
          console.warn('[studio] generated poster material analysis could not start', error instanceof Error ? error.message : error);
        });
        const responseMaterial = await materialResponse(material, tenantId);
        const imageTask = claimedImageTask ? await completeSocialImagePaidJob({
          store, tenantId, taskId: imageTaskId, jobId: imageJobId, inputHash: paidInputHash,
          provider: generated.source,
          output: {
            id: randomUUID(), role: plannedInput?.unit.role || 'single', label: plannedInput?.unit.label || '主视觉', state: 'quality_checking',
            mediaUrl: socialImageOwnedMaterialUrl(material, tenantId), materialId: material.id, contentHash: material.contentSha256,
            version: Math.max(0, ...claimedImageTask.outputs.filter(item => item.role === (plannedInput?.unit.role || 'single') && item.label === (plannedInput?.unit.label || '主视觉')).map(item => item.version)) + 1,
            qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain', severity: 'hard', note: '等待人工复核' })),
          },
        }) : undefined;
        res.json({
          ok: true,
          ...(imageTask ? { task: imageTask } : {}),
          source: generated.source,
          model: generated.model,
          url: responseMaterial.url,
          material: responseMaterial,
          references: references.length,
          deliverableType,
          productionStrategy,
          fieldsToConfirm: confirmationFields([...commercialAudit.fieldsToConfirm, ...assetFieldsToConfirm]),
          qualityStatus: commercialAudit.fieldsToConfirm.length || commercialAudit.issues.length || assetFieldsToConfirm.length
            ? 'needs_confirmation'
            : 'needs_review',
          publishable: false,    });
      } catch (err: any) {
        console.warn('[studio] fb-poster image generation failed:', String(err?.message || err).slice(0, 800));
        if (imageTaskId && paidInputHash && paidRequestMayHaveStarted) {
          await recordSocialImagePaidJobFailure({ store, tenantId, taskId: imageTaskId, jobId: imageJobId, inputHash: paidInputHash, error: String(err?.message || err), definitiveRejection: err instanceof ImageProviderRejectedError })
            .catch(error => console.warn('[studio] image request outcome could not be recorded', error instanceof Error ? error.message : error));
        }
        if (err instanceof SocialImagePaidJobError) {
          res.status(err.code === 'social_image_atomic_store_required' ? 503 : 409).json({ ok: false, code: err.code, error: err.message });
          return;
        }
        if (err instanceof ImageProviderRejectedError) {
          res.status(422).json({
            ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
            code: 'IMAGE_PROVIDER_REJECTED', retryable: false,
            error: err.statusCode === 400
              ? '图片模型拒绝了当前请求格式或内容，系统未产生图片费用。请返回策划精简内容后重试。'
              : `图片模型授权或请求不可用（HTTP ${err.statusCode}），系统未生成图片。`,
          });
          return;
        }
        res.status(502).json(upstreamGenerationFailure(err, '海报图片'));
      }
    });
  }

  return { registerPostFbPosterRender };
}
