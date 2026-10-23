import { mvpBudgetAdmission } from '../lib/mvpBudgetAdmission.js';
import { materialResponse } from './studioMaterialProjection.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import { createHash } from 'node:crypto';
import { isTenantPrivateObjectKey } from '../storage/materialAssets.js';
import sharp from 'sharp';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { ImageProviderRejectedError, type ReferenceImage } from '../lib/imageGen.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { SeedreamFirstFrameGenerator } from '../lib/seedreamFirstFrameGenerator.js';
import { FirstFrameProviderError, firstFrameInputFingerprint, type FirstFrameReferenceRole } from '../lib/firstFrameGenerator.js';
import { storyboardFirstFrameExecutionRoute } from '../lib/storyboardFirstFrameRouting.js';
import { buildStoryboardFirstFramePrompt, STORYBOARD_FIRST_FRAME_PROMPT_VERSION, type StoryboardSceneType, type StoryboardMode } from '../lib/storyboardAigcPrompt.js';
import { compileStoryboardShotSpec, type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { prepareProductIdentityLayer, verifiedTransparentCutoutGeometry } from '../lib/productIdentityPreparation.js';
import { compositeProductIdentityLayer } from '../lib/productIdentityLayer.js';
import { storyboardMultiProductViewSheet, storyboardProductReferenceSheet } from '../lib/storyboardProductReferenceSheet.js';
import { storyboardMissingProductViews } from '../lib/storyboardProductViewCapability.js';
import { storyboardPersonEnvironmentSheet } from '../lib/storyboardPersonEnvironmentSheet.js';
import { storyboardReferenceCapacity } from '../lib/storyboardReferenceCapacity.js';
import { planStoryboardExactProductGeometry, type StoryboardGeometryPlan } from '../lib/storyboardGeometryPlanner.js';
import { createStoryboardGeometryQwenObserver } from '../lib/storyboardGeometryQwen.js';
import { planStoryboardActionSegments } from '../../shared/storyboardActionSegments.js';
import type { StoryboardKeyState } from '../../shared/storyboardActionSegments.js';
import { storyboardAigcProjectBudget, type StoryboardAigcSpendEntry } from '../lib/storyboardAigcProjectBudget.js';
import { inspectStoryboardTechnicalFrames } from '../lib/storyboardAigcQuality.js';
import { studioAigcBudgetConfigForSpec, studioAigcBudgetConfigFromEnv, studioAigcBudgetPreviewForSpec } from './studioAigcBatchBudget.js';
import { evaluateStoryboardFirstFrameQuality } from '../lib/storyboardFirstFrameQualityEvaluation.js';
import { storyboardProjectShotInput, storyboardProjectShotRequestIssue } from '../lib/storyboardProjectShotInput.js';
import { upstreamGenerationFailure } from '../lib/studioGenerationTruthfulness.js';
import { inspectStoryboardAigcFramesWithQwen } from '../agents/qwen.js';
import { type AuthLocals } from '../middleware/auth.js';

import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioStoryboardFirstFrameRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'storyboardEnterpriseImage' | 'storyboardUrlImage' | 'loadMaterials' | 'storyboardCharacterMaterialAuthorizationIssue' | 'storyboardPersonAssetImage' | 'storyboardMaterialImage' | 'storyboardReplayFrameBytesCurrent' | 'storyboardIdentityNotice' | 'respondToExistingStoryboardOperation' | 'studioAigcBudgetContext' | 'storyboardImageUrlPath' | 'persistMaterials'>) {
  const studioRouter = deps.studioRouter;
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const storyboardUrlImage: StudioApplicationPorts['storyboardUrlImage'] = (...args) => deps.storyboardUrlImage(...args);
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const storyboardCharacterMaterialAuthorizationIssue: StudioApplicationPorts['storyboardCharacterMaterialAuthorizationIssue'] = (...args) => deps.storyboardCharacterMaterialAuthorizationIssue(...args);
  const storyboardPersonAssetImage: StudioApplicationPorts['storyboardPersonAssetImage'] = (...args) => deps.storyboardPersonAssetImage(...args);
  const storyboardMaterialImage: StudioApplicationPorts['storyboardMaterialImage'] = (...args) => deps.storyboardMaterialImage(...args);
  const storyboardReplayFrameBytesCurrent: StudioApplicationPorts['storyboardReplayFrameBytesCurrent'] = (...args) => deps.storyboardReplayFrameBytesCurrent(...args);
  const storyboardIdentityNotice: StudioApplicationPorts['storyboardIdentityNotice'] = (...args) => deps.storyboardIdentityNotice(...args);
  const respondToExistingStoryboardOperation: StudioApplicationPorts['respondToExistingStoryboardOperation'] = (...args) => deps.respondToExistingStoryboardOperation(...args);
  const studioAigcBudgetContext: StudioApplicationPorts['studioAigcBudgetContext'] = (...args) => deps.studioAigcBudgetContext(...args);
  const storyboardImageUrlPath: StudioApplicationPorts['storyboardImageUrlPath'] = (...args) => deps.storyboardImageUrlPath(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);

  function registerPostStoryboardFirstFrame() {
    studioRouter.post('/storyboard-first-frame', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const body = req.body ?? {};
      const shotId = String(body.shotId || '').trim().slice(0, 160);
      const shotDescription = String(body.shotDescription || '').trim();
      const mode: StoryboardMode = body.mode === 'replication' ? 'replication' : 'free_creation';
      const sceneType: StoryboardSceneType = ['product', 'factory', 'usage', 'general'].includes(body.sceneType) ? body.sceneType : 'product';
      const ratio = ['9:16', '16:9', '1:1'].includes(body.ratio) ? body.ratio : '9:16';
      if (!shotId || !shotDescription || shotDescription.length > 4000) {
        res.status(400).json({ ok: false, error: '分镜 ID 和画面要求不能为空，且画面要求不能超过 4000 字' }); return;
      }
      let selectedProjectProductIds: string[] | null = null;
      let firstFrameProject: any = null;
      let firstFrameProjectShotId = '';
      let firstFrameProjectSlotId = '';
      if (body.projectId) {
        const project = await store.getById<any>('studio_projects', String(body.projectId));
        if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, error: '当前企业的制作项目不存在' }); return; }
        const slot = (Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : [])
          .find((item: any) => String(item.id) === shotId || String(item.slotId) === shotId);
        if (!slot || project.spec?.shotProductions?.[`${String(project.spec?.activeAssemblyId || '')}:${String(slot.id)}`]?.locked) {
          res.status(409).json({ ok: false, code: 'STORYBOARD_SHOT_UNAVAILABLE', error: '当前项目分镜不存在或已锁定，未调用供应商' }); return;
        }
        firstFrameProject = project;
        firstFrameProjectShotId = String(slot.id);
        firstFrameProjectSlotId = String(slot.slotId || slot.id);
        selectedProjectProductIds = Array.isArray(project.spec?.selectedProductIds) ? project.spec.selectedProductIds.map(String) : [];
      }
      const requestedProductIds: string[] = Array.isArray(body.productIds) ? body.productIds.map((id: unknown) => String(id || '').trim()).filter(Boolean) : [];
      const productIds: string[] = [...new Set<string>(requestedProductIds.length ? requestedProductIds : [String(body.productId || '').trim()].filter(Boolean))];
      if (selectedProjectProductIds && productIds.some(id => !selectedProjectProductIds?.includes(id))) {
        res.status(422).json({ ok: false, code: 'PRODUCT_NOT_SELECTED_FOR_VIDEO', error: '当前分镜产品必须来自内容创作第一步已选的本片产品' }); return;
      }
      if (productIds.length > 3) { res.status(422).json({ ok: false, code: 'TOO_MANY_PRODUCTS', error: '单镜最多支持三个产品身份参考，请拆分镜头' }); return; }
      const productReferences: Array<{ id: string; name: string; imageUrl: string; image: ReferenceImage;
        views: Array<{ index: number; imageUrl: string; image: ReferenceImage }> }> = [];
      if (productIds.length) {
        const profile = await readTenantEnterpriseProfile(tenantId);
        const products = profile.products.items || [];
        for (const productId of productIds) {
          let product = products.find((item, index) => productIdentity(item, index) === productId);
          if (!product) {
            // The legacy Studio selector uses product-${index}-${name}. Accept it
            // only when the embedded index/name agree and that name is unique.
            const legacy = productId.match(/^product-(\d+)-(.+)$/);
            const legacyIndex = legacy ? Number(legacy[1]) : -1;
            const candidate = products[legacyIndex];
            if (candidate && candidate.name === legacy?.[2] && products.filter(item => item.name === candidate.name).length === 1) product = candidate;
          }
          if (!product) { res.status(400).json({ ok: false, error: '所选产品不在当前企业知识库中' }); return; }
          const imageUrl = String(product.images?.[0]?.url || product.imageUrl || '');
          const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
          if (!image) { res.status(422).json({ ok: false, code: 'PRODUCT_IMAGE_REQUIRED', error: `企业知识库中的产品「${String(product.name || '')}」缺少可读取的图片` }); return; }
          const views = [{ index: 0, imageUrl, image }];
          {
            for (const [index, productImage] of (product.images || []).slice(1, 3).entries()) {
              const viewUrl = String(productImage?.url || '');
              if (!viewUrl || views.some(view => view.imageUrl === viewUrl)) continue;
              const viewImage = await storyboardEnterpriseImage(viewUrl, tenantId);
              if (!viewImage) { res.status(422).json({ ok: false, code: 'PRODUCT_VIEW_UNAVAILABLE', error: `产品「${String(product.name || '')}」的第 ${index + 2} 张参考图不可读取` }); return; }
              views.push({ index: index + 1, imageUrl: viewUrl, image: viewImage });
            }
          }
          productReferences.push({ id: productId, name: String(product.name || ''), imageUrl, image, views });
        }
      } else if (sceneType === 'product' || sceneType === 'usage') {
        res.status(422).json({ ok: false, code: 'PRODUCT_REQUIRED', error: '请先选择企业知识库中的目标产品' }); return;
      }
      const missingProductViews = storyboardMissingProductViews({ description: shotDescription,
        action: body.action && typeof body.action === 'object' ? body.action : undefined,
        layout: body.layout && typeof body.layout === 'object' && !Array.isArray(body.layout) ? body.layout : undefined,
        products: productReferences.map(item => ({ id: item.id, viewCount: item.views.length })) });
      if (missingProductViews.length) {
        res.status(422).json({ ok: false, code: 'PRODUCT_ADDITIONAL_VIEW_REQUIRED',
          error: '当前镜头要求展示产品未提供的背面、侧面或大幅翻转；请补充对应产品视角图，或改为接近现有图片角度的轻微运镜', productIds: missingProductViews }); return;
      }
      const sourceFrame = body.sourceFirstFrameUrl ? await storyboardUrlImage(String(body.sourceFirstFrameUrl), tenantId) : null;
      if (mode === 'replication' && !sourceFrame) {
        res.status(422).json({ ok: false, code: 'SOURCE_FRAME_REQUIRED', error: '爆款复刻需要当前分镜可读取的原片首帧' }); return;
      }
      const characterMaterialId = String(body.characterMaterialId || '').trim();
      if (body.characterImageUrl) {
        res.status(422).json({ ok: false, code: 'CHARACTER_MATERIAL_REQUIRED', error: '指定人物请使用已授权企业人物图片素材，不能直接传入图片地址' }); return;
      }
      if (characterMaterialId && !loadMaterials().some(item => item.id === characterMaterialId && item.tenantId === tenantId
        && item.scope === 'own' && item.type === 'image')) {
        res.status(422).json({ ok: false, code: 'CHARACTER_MATERIAL_UNAVAILABLE', error: '指定人物必须来自本企业图片素材' }); return;
      }
      if (characterMaterialId) {
        const authIssue = await storyboardCharacterMaterialAuthorizationIssue(tenantId, characterMaterialId);
        if (authIssue) { res.status(422).json({ ok: false, code: 'CHARACTER_MATERIAL_NOT_AUTHORIZED', error: authIssue }); return; }
      }
      const characterAssetId = characterMaterialId;
      const characterImage = characterAssetId ? await storyboardPersonAssetImage(characterAssetId, tenantId) : null;
      if (characterAssetId && !characterImage) {
        res.status(422).json({ ok: false, code: 'CHARACTER_IMAGE_UNAVAILABLE', error: '指定人物图片无法读取' }); return;
      }
      const environmentMaterialId = String(body.environmentMaterialId || '').trim();
      let environmentImage: ReferenceImage | null = null;
      if (environmentMaterialId) {
        const selectedIds = Array.isArray(firstFrameProject?.spec?.selected)
          ? firstFrameProject.spec.selected.map(String) : [];
        const material = loadMaterials().find(item => item.id === environmentMaterialId && item.tenantId === tenantId
          && item.scope === 'own' && item.type === 'image');
        if (!selectedIds.includes(environmentMaterialId) || !material
          || (material.objectKey && !isTenantPrivateObjectKey(material.objectKey, tenantId))) {
          res.status(422).json({ ok: false, code: 'ENVIRONMENT_MATERIAL_NOT_SELECTED', error: '环境参考图必须是当前项目已选的本企业图片素材' }); return;
        }
        environmentImage = await storyboardMaterialImage(environmentMaterialId, tenantId);
        if (!environmentImage) {
          res.status(422).json({ ok: false, code: 'ENVIRONMENT_IMAGE_UNAVAILABLE', error: '当前项目已选的环境参考图无法读取' }); return;
        }
      }
      const referenceCapacity = storyboardReferenceCapacity({ source: !!sourceFrame, products: productReferences.length,
        person: !!characterImage, environment: !!environmentImage });
      if (!referenceCapacity.fits) {
        res.status(422).json({ ok: false, code: 'FIRST_FRAME_REFERENCE_LIMIT', error: '首帧模型最多支持 3 张参考图；当前原片、产品、指定人物和环境参考图无法同时输入，请减少产品或移除可选环境图' }); return;
      }
      const requiresProductSheet = referenceCapacity.useProductSheet;
      const hasProductViewSheet = productReferences.length === 1 && productReferences[0]!.views.length > 1;
      const hasMultiProductViews = productReferences.length > 1 && productReferences.some(item => item.views.length > 1);
      const productModelReferences = hasMultiProductViews
        ? [await storyboardMultiProductViewSheet(productReferences.map(item => item.views.map(view => view.image)))]
        : requiresProductSheet ? [await storyboardProductReferenceSheet(productReferences.map(item => item.image))]
          : hasProductViewSheet ? [await storyboardProductReferenceSheet(productReferences[0]!.views.map(view => view.image))]
            : productReferences.map(item => item.image);
      const personEnvironmentModelReferences = referenceCapacity.usePersonEnvironmentSheet && characterImage && environmentImage
        ? [await storyboardPersonEnvironmentSheet(characterImage, environmentImage)]
        : [characterImage, environmentImage].filter(Boolean) as ReferenceImage[];
      const references = [sourceFrame, ...productModelReferences, ...personEnvironmentModelReferences].filter(Boolean) as ReferenceImage[];
      if (references.length > 3) {
        res.status(422).json({ ok: false, code: 'FIRST_FRAME_REFERENCE_LIMIT', error: '首帧模型最多支持 3 张参考图；当前原片、产品、指定人物和环境参考图无法同时输入，请减少产品或移除可选环境图' }); return;
      }
      const sourceCutout = productReferences.length === 1 ? productReferences[0] : undefined;
      const sourceCutoutVersion = sourceCutout ? createHash('sha256').update(sourceCutout.image.base64).digest('hex') : '';
      const sourceCutoutGeometry = sourceCutout
        ? await verifiedTransparentCutoutGeometry(Buffer.from(sourceCutout.image.base64, 'base64')) : null;
      const verifiedSourceCutout = !!sourceCutoutGeometry;
      const requestedLayout = body.layout && typeof body.layout === 'object' && !Array.isArray(body.layout) ? body.layout as Record<string, any> : {};
      const savedPlacement = (firstFrameProject?.spec?.storyboardSourcePlans?.[firstFrameProjectSlotId]
        || firstFrameProject?.spec?.storyboardSourcePlans?.[firstFrameProjectShotId])?.placementOverride;
      const confirmedVisual = String(firstFrameProject?.spec?.shootingSlots?.find((item: any) =>
        String(item.slotId || item.id) === shotId || String(item.id) === shotId)?.detail || shotDescription);
      const descriptor = `${confirmedVisual} ${String(requestedLayout.environment || '')}`;
      const hasConveyor = /传送带|流水线|产线|conveyor/i.test(descriptor);
      const hasTabletop = /桌面|桌上|台面|摄影台|tabletop|on (?:a |the )?table/i.test(descriptor);
      const geometryScene = savedPlacement?.contactScene === 'tabletop' || savedPlacement?.contactScene === 'conveyor'
        ? savedPlacement.contactScene as 'tabletop' | 'conveyor'
        : hasConveyor !== hasTabletop ? (hasConveyor ? 'conveyor' : 'tabletop') : null;
      let geometryPlan: StoryboardGeometryPlan | null = null;
      if (verifiedSourceCutout && sourceCutout && geometryScene) {
        geometryPlan = await planStoryboardExactProductGeometry({ shotId, mode, scene: geometryScene,
          confirmedVisual, product: { assetId: sourceCutout.id, version: sourceCutoutVersion, view: 'source',
            cutoutAspectRatio: sourceCutoutGeometry!.aspectRatio },
          ...(savedPlacement ? { confirmedLayout: { shotId, scene: geometryScene,
              productBox: savedPlacement.productBox, contactSurfaceY: savedPlacement.contactSurfaceY,
              productView: String(savedPlacement.productView || 'source'),
              foregroundOcclusion: (savedPlacement.foregroundOcclusion || 'none') as 'none' | 'required',
              foregroundOccluderAssetId: savedPlacement.foregroundOccluderAssetId } } : {}),
        });
      }
      const resolvedLayout = geometryPlan?.status === 'ready' ? { ...requestedLayout, ...geometryPlan.layout } : requestedLayout;
      let shotSpec: StoryboardShotSpec;
      try {
        shotSpec = compileStoryboardShotSpec({
          shotId, mode, scene: sceneType, description: shotDescription, ratio,
          startSeconds: body.startSeconds, endSeconds: body.endSeconds,
          assets: [
            ...(sourceFrame ? [{ role: 'composition' as const, id: String(body.sourceFirstFrameUrl), version: createHash('sha256').update(sourceFrame.base64).digest('hex'), source: 'reference_video' as const }] : []),
            ...productReferences.map(item => ({ role: 'product' as const, id: item.id, version: createHash('sha256').update(item.image.base64).digest('hex'), source: 'knowledge_base' as const, label: item.name })),
            ...productReferences.flatMap(item => item.views.slice(1).map(view => ({ role: 'product_view' as const,
              id: `${item.id}:view:${view.index}`, version: createHash('sha256').update(view.image.base64).digest('hex'),
              source: 'knowledge_base' as const, derivedFromAssetId: item.id, view: String(view.index) }))),
            ...(verifiedSourceCutout && sourceCutout ? [{ role: 'product_cutout' as const, id: sourceCutout.imageUrl,
              version: sourceCutoutVersion, source: 'knowledge_base' as const, derivedFromAssetId: sourceCutout.id,
              derivedFromVersion: sourceCutoutVersion, view: 'source' }] : []),
            ...(characterImage ? [{ role: 'person' as const, id: characterAssetId, version: createHash('sha256').update(characterImage.base64).digest('hex'), source: 'enterprise_asset' as const }] : []),
            ...(environmentImage ? [{ role: 'environment' as const, id: environmentMaterialId, version: createHash('sha256').update(environmentImage.base64).digest('hex'), source: 'enterprise_asset' as const }] : []),
          ],
          layout: resolvedLayout,
          action: body.action && typeof body.action === 'object' && !Array.isArray(body.action) ? body.action : undefined,
        });
      } catch (error) {
        res.status(422).json({ ok: false, code: 'INVALID_SHOT_SPEC', error: error instanceof Error ? error.message : '分镜输入不完整' }); return;
      }
      // An exact source-pixel layer is currently supported only for a single
      // tabletop or conveyor product in its knowledge-base image's own view.
      // Handheld needs a verified aligned foreground hand mask and stays on the
      // generative route until that asset exists.
      const identityPreflight = !geometryPlan || geometryPlan.status !== 'ready'
        ? { status: 'generative_fallback' as const,
          reason: geometryPlan?.status === 'blocked' ? geometryPlan.code : 'contact_scene_or_cutout_unavailable' }
        : shotSpec.scene === 'usage'
          ? { status: 'generative_fallback' as const, reason: 'usage_scene_requires_action' }
          : characterImage
            ? { status: 'generative_fallback' as const, reason: 'named_person_requires_generation' }
            : shotSpec.layout.contactScene === 'handheld'
              ? { status: 'generative_fallback' as const, reason: 'hand_foreground_missing' }
              : await prepareProductIdentityLayer({ spec: shotSpec, cleanPlate: true,
                background: await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer(),
                assetBytes: new Map(productReferences.map(item => [item.imageUrl, Buffer.from(item.image.base64, 'base64')])) });
      let useExactProductLayer = identityPreflight.status === 'eligible';
      let identityFallbackReason = identityPreflight.status === 'generative_fallback' ? identityPreflight.reason : '';
      if (firstFrameProject) {
        const issue = storyboardProjectShotRequestIssue({ projectSpec: firstFrameProject.spec ?? {}, shotId,
          shotDescription, mode, ratio, sceneType, productIds, targetDurationSeconds: shotSpec.targetDurationSeconds,
          sourceFirstFrameUrl: String(body.sourceFirstFrameUrl || ''),
          environmentMaterialId,
          characterMaterialId,
          action: body.action,
          keyStates: Array.isArray(body.keyStates) ? body.keyStates : [],
          placement: { contactScene: shotSpec.layout.contactScene, productBox: shotSpec.layout.productBox,
            contactSurfaceY: shotSpec.layout.contactSurfaceY } });
        if (issue) { res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_MISMATCH', error: issue }); return; }
      }
      const rawKeyStates = Array.isArray(body.keyStates) ? body.keyStates : [];
      const validKeyStateSources = mode === 'replication'
        ? ['confirmed_reference_analysis', 'confirmed_storyboard'] : ['confirmed_storyboard'];
      if (rawKeyStates.some((item: any) => !item || !validKeyStateSources.includes(item.source) || !Number.isInteger(item.afterBeat)
        || typeof item.description !== 'string' || item.description.trim().length < 4 || item.description.length > 400 || item.imageAssetId)) {
        res.status(422).json({ ok: false, code: 'ACTION_KEY_STATE_INVALID', error: '动作关键状态必须来自已确认分镜，且不能指定未经核验的外部图片' }); return;
      }
      const actionKeyStates: StoryboardKeyState[] = rawKeyStates.map((item: any) => ({ afterBeat: Number(item.afterBeat),
        description: item.description.trim(), source: item.source }));
      const qualityRepairReasonCodes: string[] = Array.isArray(body.qualityRepairReasonCodes)
        ? [...new Set<string>(body.qualityRepairReasonCodes.map((value: unknown) => String(value))
          .filter((code: string) => /^[A-Z0-9_]{3,80}$/.test(code)).slice(0, 8))]
        : [];
      const actionBeatDurations = Array.isArray(body.beatDurationsSeconds) ? body.beatDurationsSeconds.map(Number) : undefined;
      if (sceneType === 'usage' && shotSpec.targetDurationSeconds > 15) {
        const draftPlan = planStoryboardActionSegments({ shot: shotSpec,
          capability: { minDurationSeconds: 4, maxDurationSeconds: 15, integerDurationSeconds: true, supportsFirstFrame: true, supportsEndFrame: false },
          keyStates: actionKeyStates, beatDurationsSeconds: actionBeatDurations });
        if (draftPlan.status === 'blocked' || !draftPlan.requiresSequentialGeneration) {
          res.status(422).json({ ok: false, code: 'ACTION_SEGMENT_PLAN_NOT_READY', error: '长使用动作缺少可验收的中间关键状态，未提交首帧生成', actionPlan: draftPlan }); return;
        }
      }
      const fingerprint = createHash('sha256').update(JSON.stringify({
        projectId: String(body.projectId || ''), shotSpec, actionKeyStates, actionBeatDurations,
        productIds, productImageIdentities: productReferences.flatMap(item => item.views.map(view => view.imageUrl)),
        sourceFrameHash: sourceFrame ? createHash('sha256').update(sourceFrame.base64).digest('hex') : '',
        characterImageHash: characterImage ? createHash('sha256').update(characterImage.base64).digest('hex') : '',
        environmentImageHash: environmentImage ? createHash('sha256').update(environmentImage.base64).digest('hex') : '',
        qualityRepairReasonCodes,
        promptVersion: STORYBOARD_FIRST_FRAME_PROMPT_VERSION,
      })).digest('hex');
      const requestId = String(body.requestId || '').trim().slice(0, 160);
      if (!requestId) {
        res.status(400).json({ ok: false, code: 'STORYBOARD_OPERATION_ID_REQUIRED', error: '分镜首帧需要稳定请求标识，未调用供应商' }); return;
      }
      if (requestId) {
        const previous = loadMaterials().find(item => item.tenantId === tenantId && item.sourceType === 'ai-storyboard-first-frame' &&
          item.provenance?.requestId === requestId);
        if (previous) {
          if (previous.provenance?.fingerprint !== fingerprint) {
            res.status(409).json({ ok: false, code: 'FIRST_FRAME_REQUEST_CONFLICT', error: '该请求 ID 已用于不同的分镜输入' }); return;
          }
          const currentProjectShot = firstFrameProject ? storyboardProjectShotInput(firstFrameProject.spec ?? {}, shotId) : null;
          if (!currentProjectShot || previous.provenance?.projectId !== String(body.projectId) || previous.provenance?.shotId !== shotId
            || previous.provenance?.projectShotFingerprint !== currentProjectShot.fingerprint
            || !await storyboardReplayFrameBytesCurrent(previous, tenantId, firstFrameProject.spec ?? {}).catch(() => false)) {
            res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入版本已变化，请发起新的首帧请求' }); return;
          }
          res.json({ ok: true, material: await materialResponse(previous, tenantId), fingerprint, promptVersion: STORYBOARD_FIRST_FRAME_PROMPT_VERSION, firstFrameQuality: previous.provenance?.firstFrameQuality,
            firstFrameQualityState: previous.provenance?.firstFrameQualityState, firstFrameQualityError: previous.provenance?.firstFrameQualityError,
            identityNotice: storyboardIdentityNotice(previous.provenance?.identityLayer, !!(previous.provenance?.productIds as string[] | undefined)?.length), reused: true }); return;
        }
      }
      const prompt = buildStoryboardFirstFramePrompt({ mode, sceneType, shotDescription,
        productName: productReferences.map(item => item.name).join('、'), productNames: productReferences.map(item => item.name),
        hasSourceFrame: !!sourceFrame, hasProductImage: productReferences.length > 0, productImageCount: productReferences.length,
        productReferenceMode: hasMultiProductViews ? 'multi_product_view_sheet' : requiresProductSheet ? 'contact_sheet' : hasProductViewSheet ? 'multi_view_sheet' : 'individual',
        productViewCount: hasProductViewSheet ? productReferences[0]!.views.length : undefined,
        hasCharacterImage: !!characterImage, hasEnvironmentImage: !!environmentImage,
        personEnvironmentReferenceMode: referenceCapacity.usePersonEnvironmentSheet ? 'contact_sheet' : 'individual',
        qualityRepairReasonCodes, ratio, spec: shotSpec });
      if (!firstFrameProject || !firstFrameProjectShotId) {
        res.status(400).json({ ok: false, code: 'STORYBOARD_PROJECT_REQUIRED', error: '分镜首帧需要当前项目，未调用供应商' }); return;
      }
      const projectShotInput = storyboardProjectShotInput(firstFrameProject.spec ?? {}, shotId);
      if (!projectShotInput || !['ai', 'hybrid'].includes(projectShotInput.input.source.mode)) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜制作要求已变化，未调用供应商' }); return;
      }
      const currentFirstFrameSourcePlan = firstFrameProject.spec?.storyboardSourcePlans?.[firstFrameProjectSlotId]
        || firstFrameProject.spec?.storyboardSourcePlans?.[firstFrameProjectShotId];
      const managedFallbackAutomation = firstFrameProject.spec?.automation?.managedBy === 'digital_employee'
        && body.fallbackMode === 'enterprise_product_display'
        && currentFirstFrameSourcePlan?.fallbackMode === 'enterprise_product_display'
        && currentFirstFrameSourcePlan?.mode === 'ai'
        && mode === 'free_creation'
        && !characterImage
        && productReferences.length > 0;
      const seedreamProductComposite = mode === 'replication' && sceneType === 'product'
        && Boolean(sourceFrame) && productReferences.length > 0;
      const frameCallCount = seedreamProductComposite ? 2 : 1;
      const frameCostConfig = studioAigcBudgetConfigFromEnv();
      const expectedFirstFrameCostCny = frameCostConfig.firstFrameCostCny * frameCallCount
        + (mode === 'replication' && firstFrameProject.spec?.mode === 'clone' ? frameCostConfig.cloneGeometryObservationCostCny : 0);
      const frameOperationId = `firstframe:${createHash('sha256').update(`${tenantId}:${String(body.projectId)}:${shotId}:${requestId}`).digest('hex')}`;
      const replyExistingFrame = (entry: StoryboardAigcSpendEntry | undefined) => respondToExistingStoryboardOperation(res, {
        entry, operationId: frameOperationId, shotId, stage: 'first_frame', kind: 'frame',
        estimatedCostCny: expectedFirstFrameCostCny, inputFingerprint: entry?.inputFingerprint ? fingerprint : undefined,
        recover: async original => {
          const recovered = loadMaterials().find(item => item.id === String(original.output?.materialId || '')
            && item.tenantId === tenantId && item.sourceType === 'ai-storyboard-first-frame'
            && item.provenance?.projectId === String(body.projectId) && item.provenance?.shotId === shotId
            && item.provenance?.fingerprint === fingerprint && item.provenance?.projectShotFingerprint === projectShotInput.fingerprint);
          if (!recovered || !await storyboardReplayFrameBytesCurrent(recovered, tenantId, firstFrameProject.spec ?? {})) return null;
          return { ok: true, material: await materialResponse(recovered, tenantId), fingerprint,
            promptVersion: STORYBOARD_FIRST_FRAME_PROMPT_VERSION, firstFrameQuality: recovered.provenance?.firstFrameQuality,
            firstFrameQualityState: recovered.provenance?.firstFrameQualityState, firstFrameQualityError: recovered.provenance?.firstFrameQualityError,
            identityNotice: storyboardIdentityNotice(recovered.provenance?.identityLayer, !!(recovered.provenance?.productIds as string[] | undefined)?.length) };
        },
      });
      let existingFrameOperation = (await storyboardAigcProjectBudget.status(tenantId, String(body.projectId))).entries
        .find(entry => entry.operationId === frameOperationId);
      if (existingFrameOperation && await storyboardAigcProjectBudget.releaseExpiredUnacceptedReservation(
        tenantId, String(body.projectId), frameOperationId)) existingFrameOperation = undefined;
      if (await replyExistingFrame(existingFrameOperation)) return;
      const budgetPlan = studioAigcBudgetPreviewForSpec(firstFrameProject?.spec ?? {},
        studioAigcBudgetConfigForSpec(firstFrameProject?.spec ?? {}, body.maxCostCny, tenantId),
        await studioAigcBudgetContext(tenantId, firstFrameProject));
      const planned = budgetPlan.shotPlans.find(item => item.shotId === firstFrameProjectShotId);
      if (!planned || planned.status !== 'ready') {
        res.status(409).json({ ok: false, code: 'STORYBOARD_BUDGET_PLAN_UNAVAILABLE', error: '当前分镜未进入智能生成预算计划，未调用供应商', plan: planned }); return;
      }
      if (planned.firstFrameCallCount !== frameCallCount || Math.abs(planned.estimatedFirstFrameCostCny - expectedFirstFrameCostCny) > .000001) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_FIRST_FRAME_BUDGET_CHANGED',
          error: '首帧实际子调用数或费用与预算计划不一致，未调用供应商', planned }); return;
      }
      if (!String(process.env.SEEDREAM_API_KEY || process.env.SEEDANCE_API_KEY || '').trim()) {
        res.status(423).json({ ok: false, code: 'STORYBOARD_IMAGE_PROVIDER_UNAVAILABLE', error: 'Seedream 首帧模型尚未配置，未调用供应商' }); return;
      }
      if (!await consumeDemoQuota(req, res, 'generation')) return;
      // Product remakes are image-to-image twice: first remove the reference
      // product from its actual shot, then rebuild that same shot using only the
      // enterprise product references.  This preserves the reference framing
      // without asking one model call to both erase and invent packaging.
      const reservedFirstFrameCostCny = Number(planned.estimatedFirstFrameCostCny || 0);
      const frameMvpScope = firstFrameProject.spec?.mvpExecutionPackage?.scopes?.first_frame || firstFrameProject.spec?.mvpExecutionPackage;
      const frameMvpIdentity = firstFrameProject.spec?.mvpExecutionPackage?.identity || firstFrameProject.spec;
      try {
        await mvpBudgetAdmission.reserve({ scope: frameMvpScope, tenantId,
          accountId: frameMvpIdentity.accountId === null ? null : String(frameMvpIdentity.accountId || ''), productId: String(frameMvpIdentity.productId || ''), runId: String(frameMvpIdentity.runId || ''),
          action: 'generate_media', taskId: String(frameMvpIdentity.taskId || ''), version: Number(frameMvpIdentity.version), session: 'B',
          provider: 'seedream', model: new SeedreamFirstFrameGenerator().model, shotId, estimatedCostCny: reservedFirstFrameCostCny,
          operationId: frameOperationId, fingerprint });
        const admission = await storyboardAigcProjectBudget.reserve({ tenantId, projectId: String(body.projectId), shotId,
          stage: 'first_frame', operationId: frameOperationId,
          estimatedCostCny: reservedFirstFrameCostCny, inputFingerprint: fingerprint, limitCny: budgetPlan.batchBudgetCny,
          approvedFrozenLimit: firstFrameProject.spec?.automation?.managedBy === 'digital_employee'
            && Boolean(firstFrameProject.spec?.contentOrder?.operatingContext?.budgetApprovedAt) });
        if (admission.existing) {
          await replyExistingFrame(admission.entry); return;
        }
      } catch (error) {
        res.status(429).json({ ok: false, code: 'STORYBOARD_PROJECT_BUDGET_EXCEEDED',
          error: error instanceof Error ? error.message : '项目 AIGC 预算不足，未调用供应商' }); return;
      }
      const generationStartedAt = Date.now();
      let seedreamAcceptedStages = 0;
      const seedreamReceipts: Record<string, unknown>[] = [];
      let geometryObserverAttempted = false;
      try {
        if (mode === 'replication' && firstFrameProject.spec?.mode === 'clone'
          && process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED === 'true') {
          const currentSourceFrameUrl = String(projectShotInput.input.reference?.firstFrameRef || '');
          const sourceMime = String(sourceFrame?.mimeType || '');
          if (!sourceCutoutGeometry || !sourceCutout || !geometryScene || sceneType === 'usage' || characterImage) {
            identityFallbackReason = 'clone_exact_layer_prerequisites_missing';
          } else if (!/^\/api\/overseas\/videos\/[\w-]+\/shot\/\d+\/first-frame$/.test(storyboardImageUrlPath(currentSourceFrameUrl))
            || currentSourceFrameUrl !== String(body.sourceFirstFrameUrl || '')) {
            identityFallbackReason = 'clone_source_frame_not_bound_to_current_shot';
          } else if (!sourceFrame || !['image/png', 'image/jpeg', 'image/webp'].includes(sourceMime)) {
            identityFallbackReason = 'clone_source_frame_unreadable';
          } else if (!(Number(planned.estimatedGeometryObservationCostCny) > 0)) {
            identityFallbackReason = 'clone_geometry_observer_not_budgeted';
          } else {
            geometryObserverAttempted = true;
            geometryPlan = await planStoryboardExactProductGeometry({ shotId, mode, scene: geometryScene,
              confirmedVisual, product: { assetId: sourceCutout.id, version: sourceCutoutVersion, view: 'source',
                cutoutAspectRatio: sourceCutoutGeometry.aspectRatio },
              sourceFrame: { assetId: currentSourceFrameUrl,
                version: createHash('sha256').update(sourceFrame.base64).digest('hex'),
                mimeType: sourceMime as 'image/png' | 'image/jpeg' | 'image/webp', base64: sourceFrame.base64 },
            }, createStoryboardGeometryQwenObserver());
            if (geometryPlan.status === 'ready') {
              shotSpec.layout = { ...shotSpec.layout, ...geometryPlan.layout };
              const prepared = await prepareProductIdentityLayer({ spec: shotSpec, cleanPlate: true,
                background: await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer(),
                assetBytes: new Map([[sourceCutout.imageUrl, Buffer.from(sourceCutout.image.base64, 'base64')]]) });
              useExactProductLayer = prepared.status === 'eligible';
              identityFallbackReason = prepared.status === 'eligible' ? '' : prepared.reason;
            } else identityFallbackReason = geometryPlan.code;
          }
        }
        const cleanPlatePrompt = [
          `Create exactly one photorealistic ${ratio} EMPTY environment plate for a continuous commercial video shot.`,
          `Scene and spatial layout: ${shotDescription}. ${shotSpec.layout.environment}. ${shotSpec.layout.cameraAngle}.`,
          `Leave the product slot empty: normalized box x=${shotSpec.layout.productBox?.x}, y=${shotSpec.layout.productBox?.y}, width=${shotSpec.layout.productBox?.width}, height=${shotSpec.layout.productBox?.height}.`,
          `The empty slot sits on the ${shotSpec.layout.contactScene === 'conveyor' ? 'conveyor belt' : 'tabletop'} at normalized height ${shotSpec.layout.contactSurfaceY}. Keep its contact plane and realistic light direction visible.`,
          mode === 'replication' ? 'Reference image 1 is the current source shot first frame for composition ONLY. Preserve camera angle and spatial layout; remove its product, brand, packaging, caption and watermark.' : '',
          environmentImage ? 'Use the selected environment reference only for directly visible spatial appearance. Do not infer factory ownership, equipment capabilities, certifications or other business claims.' : '',
          'Do not draw any product, package, hand, extra prop, brand, readable label, subtitle or watermark in or over the empty product slot. A separate exact knowledge-base product cutout will be inserted after this plate is generated.',
        ].filter(Boolean).join('\n');
        let directCompositionUsed = false;
        let identityLayer: Record<string, unknown> = { strategy: 'generative', fallbackReason: identityFallbackReason };
        let generated: { bytes: Buffer; mimeType: string; source: string; model: string };
        const firstFrameRoute = storyboardFirstFrameExecutionRoute({ hasReliableComposition: !!sourceFrame,
          hasExactProductLayer: useExactProductLayer,
          seedanceModel: String(process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128'),
          multimodalEnabled: process.env.SEEDANCE_STORYBOARD_MULTIMODAL_ENABLED !== 'false' });
        if (firstFrameRoute === 'direct_seedance_input' && !seedreamProductComposite) {
          const prepared = await prepareProductIdentityLayer({ spec: shotSpec, cleanPlate: true,
            background: Buffer.from(sourceFrame!.base64, 'base64'),
            assetBytes: new Map(productReferences.map(item => [item.imageUrl, Buffer.from(item.image.base64, 'base64')])) });
          if (prepared.status !== 'eligible') throw new Error(`product_identity_preparation_changed:${prepared.reason}`);
          const composite = await compositeProductIdentityLayer(prepared.composite);
          generated = { bytes: composite.bytes, mimeType: 'image/png', source: 'local_exact_composite',
            model: `${String(process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128')}:direct-input` };
          identityLayer = { strategy: 'exact_source_pixels', directToSeedance: true, ...prepared.provenance,
            productBox: composite.productBox, occludedProductFraction: composite.occludedProductFraction };
          directCompositionUsed = true;
        } else if (seedreamProductComposite) {
          const seedream = new SeedreamFirstFrameGenerator();
          const asReference = (role: FirstFrameReferenceRole, reference: ReferenceImage) => {
            const bytes = Buffer.from(reference.base64, 'base64');
            return { role, bytes, mimeType: reference.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
              sha256: createHash('sha256').update(bytes).digest('hex') };
          };
          const cleanupPrompt = [
            `Create exactly one photorealistic ${ratio} clean background plate for this source shot.`,
            'Reference image 1 is the real source shot. Preserve its camera, framing, people, hands, lighting and background.',
            'Remove every source product, package, brand mark, readable label, subtitle, watermark and unrelated foreground prop. Reconstruct only the exposed background and any hand area naturally hidden by the removed product.',
            'Do not introduce a new product, package, logo, caption or readable text.',
          ].join('\n');
          const cleanupRequest = {
            referenceMode: 'environment_plate' as const, tenantId, videoId: String(body.projectId),
            compositionId: `${shotId}:cleanup`, presenterVersion: fingerprint, prompt: cleanupPrompt,
            ratio: ratio as '9:16' | '16:9' | '1:1', references: [asReference('source_composition', sourceFrame!)], idempotencyKey: '',
          };
          cleanupRequest.idempotencyKey = firstFrameInputFingerprint(cleanupRequest, seedream.provider, seedream.model);
          const cleanPlate = await seedream.generate(cleanupRequest);
          seedreamAcceptedStages++;
          seedreamReceipts.push({ stage: 'cleanup', providerRequestId: cleanPlate.providerRequestId, model: cleanPlate.model, estimatedCostCny: cleanPlate.estimatedCostCny });
          await storyboardAigcProjectBudget.mark(tenantId, String(body.projectId), frameOperationId, 'reserved', { seedreamReceipts });
          const plate: ReferenceImage = { mimeType: cleanPlate.mimeType, base64: cleanPlate.bytes.toString('base64') };
          const compositePrompt = [
            `Create exactly one photorealistic ${ratio} first frame for a continuous commercial video shot.`,
            'Reference image 1 is the cleaned version of the target shot. Preserve its camera, framing, people, hands, lighting and background.',
            `Use the enterprise product reference images only for this product: ${productReferences.map(item => item.name).join('、')}.`,
            'Place the enterprise product naturally in the product positions established by the cleaned reference shot. Preserve plausible hand contact and scale.',
            'Do not restore, copy or invent any source-video product, brand, package form, label, subtitle, watermark or extra SKU.',
          ].join('\n');
          const compositeReferences = [asReference('source_composition', plate), ...productReferences.map(item => asReference('product_identity', item.image))];
          const compositeRequest = {
            referenceMode: 'product_scene' as const, tenantId, videoId: String(body.projectId),
            compositionId: `${shotId}:product-composite`, presenterVersion: fingerprint, prompt: compositePrompt,
            ratio: ratio as '9:16' | '16:9' | '1:1', references: compositeReferences, idempotencyKey: '',
          };
          compositeRequest.idempotencyKey = firstFrameInputFingerprint(compositeRequest, seedream.provider, seedream.model);
          const result = await seedream.generate(compositeRequest);
          seedreamAcceptedStages++;
          seedreamReceipts.push({ stage: 'composite', providerRequestId: result.providerRequestId, model: result.model, estimatedCostCny: result.estimatedCostCny });
          await storyboardAigcProjectBudget.mark(tenantId, String(body.projectId), frameOperationId, 'reserved', { seedreamReceipts });
          generated = { ...result, source: result.provider };
          identityLayer = { strategy: 'seedream_reference_composite', cleanupModel: cleanPlate.model,
            cleanupProviderRequestId: cleanPlate.providerRequestId, compositeProviderRequestId: result.providerRequestId };
        } else {
          const selectedReferences = useExactProductLayer
            ? [sourceFrame, environmentImage].filter(Boolean) as ReferenceImage[] : references;
          const seedream = new SeedreamFirstFrameGenerator();
          const seedreamReferences = selectedReferences.map(reference => {
            const role: FirstFrameReferenceRole = sourceFrame && reference === sourceFrame ? 'source_composition'
              : environmentImage && reference === environmentImage ? 'enterprise_environment'
                : characterImage && reference === characterImage ? 'authorized_presenter' : 'product_identity';
            const bytes = Buffer.from(reference.base64, 'base64');
            return { role, bytes, mimeType: reference.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
              sha256: createHash('sha256').update(bytes).digest('hex') };
          });
          const seedreamRequest = {
            referenceMode: 'storyboard_scene' as const, tenantId, videoId: String(body.projectId), compositionId: shotId,
            presenterVersion: fingerprint, prompt: useExactProductLayer ? cleanPlatePrompt : prompt,
            ratio: ratio as '9:16' | '16:9' | '1:1', references: seedreamReferences, idempotencyKey: '',
          };
          seedreamRequest.idempotencyKey = firstFrameInputFingerprint(seedreamRequest, seedream.provider, seedream.model);
          const seedreamResult = await seedream.generate(seedreamRequest);
          seedreamAcceptedStages++;
          seedreamReceipts.push({ stage: 'first_frame', providerRequestId: seedreamResult.providerRequestId, model: seedreamResult.model, estimatedCostCny: seedreamResult.estimatedCostCny });
          await storyboardAigcProjectBudget.mark(tenantId, String(body.projectId), frameOperationId, 'reserved', { seedreamReceipts });
          generated = { ...seedreamResult, source: seedreamResult.provider };
        }
        if (useExactProductLayer && !directCompositionUsed && !seedreamProductComposite) {
          const prepared = await prepareProductIdentityLayer({ spec: shotSpec, cleanPlate: true,
            background: Buffer.from(generated.bytes),
            assetBytes: new Map(productReferences.map(item => [item.imageUrl, Buffer.from(item.image.base64, 'base64')])) });
          if (prepared.status !== 'eligible') throw new Error(`product_identity_preparation_changed:${prepared.reason}`);
          const composite = await compositeProductIdentityLayer(prepared.composite);
          generated = { ...generated, bytes: composite.bytes, mimeType: 'image/png' };
          identityLayer = { strategy: 'exact_source_pixels', ...prepared.provenance, productBox: composite.productBox,
            occludedProductFraction: composite.occludedProductFraction, cleanPlateModel: generated.model };
        }
        const qualityEvaluation = await evaluateStoryboardFirstFrameQuality({
          sceneType, hasProduct: productReferences.length > 0, hasNamedPerson: !!characterImage,
          hasEnvironmentReference: !!environmentImage, hasContact: shotSpec.constraints.includes('physical_contact'),
          hasAction: !!(shotSpec.action.startState || shotSpec.action.beats.length), candidateLabels: ['候选首帧'],
          referenceLabels: [...productReferences.flatMap((item, index) => item.views.map(view => `企业产品参考${index + 1}视角${view.index + 1}：${item.name}`)),
          ...(characterImage ? ['企业人物参考'] : []), ...(environmentImage && !(mode === 'replication' && !characterImage) ? ['企业工厂环境参考'] : [])],
          applyReplicationAutomation: (mode === 'replication' && !characterImage) || managedFallbackAutomation,
          inspectVisual: () => inspectStoryboardAigcFramesWithQwen({
            phase: 'first_frame', sceneType,
            frames: [{ base64: Buffer.from(generated.bytes).toString('base64'), mimeType: generated.mimeType, timeLabel: '候选首帧' }],
            productReferences: productReferences.flatMap((item, index) => item.views.map(view => ({ ...view.image,
              timeLabel: `企业产品参考${index + 1}视角${view.index + 1}：${item.name}` }))),
            personReferences: characterImage ? [{ ...characterImage, timeLabel: '企业人物参考' }] : [],
            environmentReferences: environmentImage && !(mode === 'replication' && !characterImage) ? [{ ...environmentImage, timeLabel: '企业工厂环境参考' }] : [],
            storyboard: shotDescription, productInfo: productReferences.map(item => item.name).join('、'),
            startState: shotSpec.action.startState, beats: shotSpec.action.beats, endState: shotSpec.action.endState,
          }),
          inspectTechnical: () => inspectStoryboardTechnicalFrames('first_frame', [{ bytes: Buffer.from(generated.bytes), timeLabel: '候选首帧' }]),
        });
        const firstFrameQuality = qualityEvaluation.firstFrameQuality;
        const firstFrameQualityError = qualityEvaluation.firstFrameQualityState === 'evaluated' ? null
          : { code: qualityEvaluation.code, error: qualityEvaluation.error, retryable: true, contractIssues: qualityEvaluation.contractIssues };
        const material = await createGeneratedImageMaterial({ title: `分镜首帧 · ${shotId}`.slice(0, 120), bytes: generated.bytes, mimeType: generated.mimeType, source: generated.source, tenantId });
        material.sourceType = 'ai-storyboard-first-frame';
        material.productId = productReferences[0]?.id;
        material.productName = productReferences.map(item => item.name).join('、') || undefined;
        material.provenance = { projectId: String(body.projectId || ''), shotId, fingerprint, projectShotFingerprint: projectShotInput.fingerprint, requestId, promptVersion: STORYBOARD_FIRST_FRAME_PROMPT_VERSION, sceneType, mode, shotSpec, geometryPlan, actionKeyStates, actionBeatDurations, productIds, identityLayer, firstFrameQuality,
          ...(managedFallbackAutomation ? { automationFallbackMode: 'enterprise_product_display' } : {}),
          firstFrameQualityState: qualityEvaluation.firstFrameQualityState, firstFrameQualityError,
          firstFrameQualityInput: qualityEvaluation.firstFrameQualityState === 'evaluated'
            ? { sourceSha256: createHash('sha256').update(generated.bytes).digest('hex'), checkedAt: firstFrameQuality?.checkedAt, provider: 'qwen_vl' } : undefined,
          confirmed: firstFrameQuality?.acceptanceSource === 'automatic_policy' && firstFrameQuality.passed,
          ...(firstFrameQuality?.acceptanceSource === 'automatic_policy' ? { confirmationSource: 'automatic_policy', qualityStatus: !firstFrameQuality.passed ? 'automated_checks_failed' : firstFrameQuality.automatedPassed ? 'automated_checks_passed' : 'automatic_policy_with_uncertainties' } : {}), provider: generated.source, model: generated.model,
          estimatedCostCny: (directCompositionUsed ? 0 : studioAigcBudgetConfigFromEnv().firstFrameCostCny * (seedreamProductComposite ? 2 : 1))
            + (geometryObserverAttempted ? Number(planned.estimatedGeometryObservationCostCny || 0) : 0),
          generationLatencyMs: Date.now() - generationStartedAt };
        const list = loadMaterials();
        const index = list.findIndex(item => item.id === material.id);
        if (index >= 0) { list[index] = material; persistMaterials(list); }
        if (directCompositionUsed) {
          await storyboardAigcProjectBudget.settlePartial(tenantId, String(body.projectId), frameOperationId,
            geometryObserverAttempted ? Number(planned.estimatedGeometryObservationCostCny || 0) : 0, { materialId: material.id });
        } else if (!geometryObserverAttempted && Number(planned.estimatedGeometryObservationCostCny || 0) > 0) {
          await storyboardAigcProjectBudget.settlePartial(tenantId, String(body.projectId), frameOperationId,
            reservedFirstFrameCostCny - Number(planned.estimatedGeometryObservationCostCny || 0), { materialId: material.id });
        } else {
          await storyboardAigcProjectBudget.mark(tenantId, String(body.projectId), frameOperationId, 'completed', { materialId: material.id });
        }
        res.json({ ok: true, material: await materialResponse(material, tenantId), fingerprint, promptVersion: STORYBOARD_FIRST_FRAME_PROMPT_VERSION,
          model: generated.model, firstFrameQuality, firstFrameQualityState: qualityEvaluation.firstFrameQualityState,
          firstFrameQualityError, identityNotice: storyboardIdentityNotice(identityLayer, productReferences.length > 0) });
      } catch (error) {
        if (error instanceof ImageProviderRejectedError || error instanceof FirstFrameProviderError && error.status === 'rejected') {
          if (geometryObserverAttempted || seedreamAcceptedStages > 0) {
            await storyboardAigcProjectBudget.settlePartial(tenantId, String(body.projectId), frameOperationId,
              seedreamAcceptedStages * Number(planned.estimatedFirstFrameCostCny || 0) + (geometryObserverAttempted ? Number(planned.estimatedGeometryObservationCostCny || 0) : 0), { seedreamReceipts, partialFailure: true }).catch(markError =>
                console.error('[studio] first-frame geometry partial settlement unavailable:', markError));
          } else {
            if (frameMvpScope) await mvpBudgetAdmission.releaseRejected(frameMvpScope.budgetPoolId, frameOperationId);
            await storyboardAigcProjectBudget.releaseRejected(tenantId, String(body.projectId), frameOperationId).catch(markError =>
              console.error('[studio] first-frame rejected budget release unavailable:', markError));
          }
        } else {
          await storyboardAigcProjectBudget.mark(tenantId, String(body.projectId), frameOperationId, 'uncertain', { seedreamReceipts, ...(error instanceof FirstFrameProviderError ? { uncertainProviderRequestId: error.providerRequestId } : {}) }).catch(markError =>
            console.error('[studio] first-frame budget state unavailable:', markError));
        }
        res.status(502).json(upstreamGenerationFailure(error, '分镜首帧'));
      }
    });
  }

  return { registerPostStoryboardFirstFrame };
}
