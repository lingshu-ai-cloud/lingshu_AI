import { submitStoryboardSeedance } from '../lib/storyboardSeedanceSubmission.js';
import { mvpBudgetAdmission } from '../lib/mvpBudgetAdmission.js';
import { materialResponse, type Material } from './studioMaterialProjection.js';
import { langName } from './studioTranslationCore.js';
import { normalizeFreeCreationProjectSpec } from '../../shared/contracts/freeCreationProject.js';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { store } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { SeedanceProductRecovery } from '../lib/seedanceProductRecovery.js';
import { buildStoryboardVideoActionPrompt } from '../lib/storyboardAigcPrompt.js';
import { type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { planStoryboardActionSegments } from '../../shared/storyboardActionSegments.js';
import { storyboardAigcProjectBudget, type StoryboardAigcSpendEntry } from '../lib/storyboardAigcProjectBudget.js';
import { projectStoryboardProviderReceipt } from '../lib/storyboardProviderReceipt.js';
import { automaticManagedFallbackFrameAdmission, automaticStoryboardFrameAdmission } from '../lib/storyboardAigcQuality.js';
import { studioAigcBudgetConfigForSpec, studioAigcBudgetPreviewForSpec } from './studioAigcBatchBudget.js';
import { getPublicOrigin } from '../lib/oauthConfig.js';
import { estimateSeedanceCostCny, releaseSeedanceBudget, reserveSeedanceBudget, type SeedanceBudgetReservation } from '../lib/seedanceBudget.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';
import { type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { objectStorageDownload } from '../storage/objectStorage.js';
import { MEDIA_DIR } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioStoryboardVideoRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadMaterials' | 'normalizeSeedanceVideoDuration' | 'seedanceVideoConfig' | 'storyboardKbFrameVersionIssues' | 'storyboardPersonFrameVersionIssues' | 'storyboardEnvironmentFrameVersionIssues' | 'respondToExistingStoryboardOperation' | 'storyboardReplayVideoResponse' | 'studioAigcBudgetContext' | 'isSeedanceVideoEnabled' | 'seedanceFetchJson' | 'seedanceTaskId' | 'waitForSeedanceTask' | 'findUrlDeep' | 'downloadGeneratedVideo' | 'createGeneratedVideoMaterial' | 'persistMaterials' | 'appendVideoVersion' | 'summarizeSeedanceError'>) {
  const studioRouter = deps.studioRouter;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const normalizeSeedanceVideoDuration: StudioApplicationPorts['normalizeSeedanceVideoDuration'] = (...args) => deps.normalizeSeedanceVideoDuration(...args);
  const seedanceVideoConfig: StudioApplicationPorts['seedanceVideoConfig'] = (...args) => deps.seedanceVideoConfig(...args);
  const storyboardKbFrameVersionIssues: StudioApplicationPorts['storyboardKbFrameVersionIssues'] = (...args) => deps.storyboardKbFrameVersionIssues(...args);
  const storyboardPersonFrameVersionIssues: StudioApplicationPorts['storyboardPersonFrameVersionIssues'] = (...args) => deps.storyboardPersonFrameVersionIssues(...args);
  const storyboardEnvironmentFrameVersionIssues: StudioApplicationPorts['storyboardEnvironmentFrameVersionIssues'] = (...args) => deps.storyboardEnvironmentFrameVersionIssues(...args);
  const respondToExistingStoryboardOperation: StudioApplicationPorts['respondToExistingStoryboardOperation'] = (...args) => deps.respondToExistingStoryboardOperation(...args);
  const storyboardReplayVideoResponse: StudioApplicationPorts['storyboardReplayVideoResponse'] = (...args) => deps.storyboardReplayVideoResponse(...args);
  const studioAigcBudgetContext: StudioApplicationPorts['studioAigcBudgetContext'] = (...args) => deps.studioAigcBudgetContext(...args);
  const isSeedanceVideoEnabled: StudioApplicationPorts['isSeedanceVideoEnabled'] = (...args) => deps.isSeedanceVideoEnabled(...args);
  const seedanceFetchJson: StudioApplicationPorts['seedanceFetchJson'] = (...args) => deps.seedanceFetchJson(...args);
  const seedanceTaskId: StudioApplicationPorts['seedanceTaskId'] = (...args) => deps.seedanceTaskId(...args);
  const waitForSeedanceTask: StudioApplicationPorts['waitForSeedanceTask'] = (...args) => deps.waitForSeedanceTask(...args);
  const findUrlDeep: StudioApplicationPorts['findUrlDeep'] = (...args) => deps.findUrlDeep(...args);
  const downloadGeneratedVideo: StudioApplicationPorts['downloadGeneratedVideo'] = (...args) => deps.downloadGeneratedVideo(...args);
  const createGeneratedVideoMaterial: StudioApplicationPorts['createGeneratedVideoMaterial'] = (...args) => deps.createGeneratedVideoMaterial(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);
  const appendVideoVersion: StudioApplicationPorts['appendVideoVersion'] = (...args) => deps.appendVideoVersion(...args);
  const summarizeSeedanceError: StudioApplicationPorts['summarizeSeedanceError'] = (...args) => deps.summarizeSeedanceError(...args);

  function registerPostSeedanceVideo() {
    studioRouter.post('/seedance-video', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const {
        script = '',
        productInfo = '',
        language = 'en',
        ratio = '9:16',
        duration: rawDuration,
        resolution = '720p',
        title = 'Seedance 生成视频',
        referenceImageUrl = '',
        firstFrameMaterialId = '',
        firstFrameFingerprint = '',
        shotId = '',
        generationGroupKey = '',
        generationContext = {},
        parentVersionId = '',
        requestId = '',
      } = req.body ?? {};
      const freeHookContext = generationContext && typeof generationContext === 'object' && !Array.isArray(generationContext)
        && (generationContext as Record<string, unknown>).freeCreationHook === true
        ? generationContext as Record<string, unknown> : null;
      if (freeHookContext) {
        const hookProjectId = String(freeHookContext.projectId || '').trim();
        if (!hookProjectId || !/^[A-Za-z0-9_:.-]{8,180}$/.test(String(requestId))) {
          res.status(400).json({ ok: false, code: 'FREE_HOOK_REQUEST_ID_REQUIRED', error: 'AI 钩子视频需要当前草稿和稳定请求 ID，未调用供应商' }); return;
        }
        const hookProject = await store.getById<any>('studio_projects', hookProjectId);
        const hookState = hookProject && hookProject.tenant_id === tenantId ? normalizeFreeCreationProjectSpec(hookProject.spec || {}).freeCreation : null;
        if (!hookState?.manualWorkflow || hookState.hookSource !== 'ai') {
          res.status(409).json({ ok: false, code: 'FREE_HOOK_PROJECT_CHANGED', error: '自由创作草稿或钩子方式已变化，未调用供应商' }); return;
        }
        const previous = loadMaterials().find(item => item.tenantId === tenantId && item.sourceType === 'ai-free-creation-hook-video'
          && item.provenance?.requestId === String(requestId));
        if (previous) {
          const expected = createHash('sha256').update(JSON.stringify({ script: String(script), productInfo: String(productInfo), language: String(language), ratio: String(ratio), duration: rawDuration, resolution: String(resolution), referenceImageUrl: String(referenceImageUrl), projectId: hookProjectId })).digest('hex');
          if (previous.provenance?.inputFingerprint !== expected) { res.status(409).json({ ok: false, code: 'FREE_HOOK_REQUEST_CONFLICT', error: '该请求 ID 已用于不同的 AI 钩子视频输入' }); return; }
          const visible = await materialResponse(previous, tenantId);
          res.json({ ok: true, reused: true, source: 'seedance', id: visible.id, url: visible.url, poster: visible.poster, duration: visible.duration, material: visible }); return;
        }
      }
      const duration = normalizeSeedanceVideoDuration(rawDuration ?? (firstFrameMaterialId ? 4 : 8));
      let firstFrame = firstFrameMaterialId
        ? loadMaterials().find(item => item.id === String(firstFrameMaterialId) && item.tenantId === tenantId && item.sourceType === 'ai-storyboard-first-frame')
        : undefined;
      const storyboardShotSpec = firstFrame?.provenance?.shotSpec as StoryboardShotSpec | undefined;
      if (firstFrameMaterialId && (Number(rawDuration ?? 4) < 4 || Number(rawDuration ?? 4) > 15 || !Number.isInteger(Number(rawDuration ?? 4)))) {
        res.status(400).json({ ok: false, code: 'UNSUPPORTED_STORYBOARD_DURATION', error: '分镜视频候选时长须为 4–15 秒整数；长镜头请先拆镜' }); return;
      }
      const projectBoundUnconfirmedFrame = !!firstFrame?.provenance?.projectId
        && firstFrame?.provenance?.firstFrameQualityState === 'evaluated';
      if (firstFrameMaterialId && (!firstFrame || !shotId || !firstFrameFingerprint
        || (firstFrame.provenance?.firstFrameQualityState && firstFrame.provenance.firstFrameQualityState !== 'evaluated')
        || (firstFrame.provenance?.confirmed !== true && !automaticStoryboardFrameAdmission(firstFrame.provenance)
          && !projectBoundUnconfirmedFrame) ||
        firstFrame.provenance?.shotId !== String(shotId) ||
        firstFrame.provenance?.fingerprint !== String(firstFrameFingerprint) ||
        (generationContext && typeof generationContext === 'object' && !Array.isArray(generationContext) &&
          'projectId' in generationContext && String((generationContext as Record<string, unknown>).projectId || '') !== String(firstFrame.provenance?.projectId || '')))) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_NOT_CONFIRMED', error: '当前分镜首帧未确认或输入已变化' }); return;
      }
      if (firstFrameMaterialId && !['480p', '720p'].includes(String(resolution))) {
        res.status(400).json({ ok: false, code: 'UNSUPPORTED_RESOLUTION', error: '分镜视频仅支持 480p 或 720p' }); return;
      }
      if (storyboardShotSpec && (String(ratio) !== storyboardShotSpec.layout.ratio || duration < Math.ceil(storyboardShotSpec.targetDurationSeconds))) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_SHOT_SPEC_CHANGED', error: '视频画幅或时长与已确认首帧的分镜规格不一致，请重新确认' }); return;
      }
      if (storyboardShotSpec?.scene === 'usage' && (!storyboardShotSpec.action.startState || !storyboardShotSpec.action.endState || !storyboardShotSpec.action.beats.length)) {
        res.status(422).json({ ok: false, code: 'USAGE_ACTION_STATES_REQUIRED', error: '使用场景需明确动作起点、步骤和可见终点，填写后重新生成并确认首帧' }); return;
      }
      if (firstFrame && storyboardShotSpec?.scene === 'usage') {
        const actionPlan = planStoryboardActionSegments({ shot: storyboardShotSpec,
          capability: { minDurationSeconds: 4, maxDurationSeconds: 15, integerDurationSeconds: true, supportsFirstFrame: true, supportsEndFrame: false },
          firstFrameAssetId: firstFrame.id });
        if (actionPlan.status === 'blocked' || !actionPlan.readyForSubmission || actionPlan.requiresSequentialGeneration) {
          res.status(422).json({ ok: false, code: 'USAGE_ACTION_PLAN_NOT_READY', error: '当前使用动作需要补关键状态或拆成可逐段验收的短镜头', actionPlan }); return;
        }
      }
      const prompt = [
        `Create a ${duration}-second vertical commercial social video in ${langName(language)}.`,
        `Aspect ratio: ${ratio}. Resolution: ${resolution}.`,
        `Use this script/storyboard as the primary direction:\n${firstFrame && storyboardShotSpec ? buildStoryboardVideoActionPrompt(storyboardShotSpec) : String(script).slice(0, 4000)}`,
        productInfo ? `Product and brand context:\n${String(productInfo).slice(0, 1800)}` : '',
        'Style: realistic UGC product video, clear product focus, clean lighting, smooth camera movement, high conversion pacing.',
        firstFrame ? 'This is non-presenter B-roll. No dialogue, narration, lip sync or generated voiceover.' : 'Generate synchronized natural audio. Dialogue or voiceover lines should follow the quoted script language.',
        firstFrame ? 'Preserve the confirmed first frame exactly as the opening composition. Keep the target product identity, shape, color and visible packaging stable across the shot. Complete one clear action without changing the scene or adding objects.' : '固定提示词：全程不要出现任何文字、符号、标识。',
        firstFrame ? 'Do not add captions, subtitles, UI, watermarks or invented labels. Existing target product packaging may remain visible.' : 'No text, symbols, logos, captions, subtitles, labels, UI, watermarks, brand marks, written characters, numbers, or signage may appear at any point in the video.',
        firstFrame ? 'Keep the visible action aligned with the storyboard description.' : 'Keep visual actions aligned with the spoken lines.',
      ].filter(Boolean).join('\n\n');

      const config = seedanceVideoConfig();
      let frozenFrameObject = null as Awaited<ReturnType<typeof objectStorageDownload>> | null;
      let frozenFrameBytes: Buffer | null = null;
      let videoInputFingerprint = '';
      const productRecovery = new SeedanceProductRecovery(storyboardAigcProjectBudget);
      let recoveredTaskId = '';
      let recoveredVideoUrl = '';
      let videoMvpScope: any = null;
      let videoMvpIdentity: any = null;
      let storyboardProjectId = '';
      let storyboardOperationId = '';
      let storyboardInputFingerprint: string | undefined;
      let replyExistingVideo: ((entry: StoryboardAigcSpendEntry | undefined) => Promise<boolean>) | undefined;
      let existingStoryboardVideoOperation: StoryboardAigcSpendEntry | undefined;
      let storyboardBudgetLimitCny: number | undefined;
      let storyboardApprovedFrozenLimit = false;
      const storyboardEstimatedCostCny = estimateSeedanceCostCny(duration, String(resolution));
      if (firstFrame && !/^[A-Za-z0-9_:.-]{8,180}$/.test(String(requestId))) {
        res.status(400).json({ ok: false, code: 'STORYBOARD_VIDEO_REQUEST_ID_REQUIRED', error: '分镜视频需要稳定请求 ID，未调用供应商' }); return;
      }
      if (firstFrame && firstFrame.provenance?.projectId) {
        storyboardProjectId = String(firstFrame.provenance.projectId);
        storyboardOperationId = `storyboard-video:${createHash('sha256').update(`${tenantId}:${storyboardProjectId}:${shotId}:${requestId}`).digest('hex')}`;
        const project = await store.getById<any>('studio_projects', String(firstFrame.provenance.projectId));
        if (!project || project.tenant_id !== tenantId) {
          res.status(404).json({ ok: false, code: 'STORYBOARD_PROJECT_UNAVAILABLE', error: '分镜项目已不存在或不可访问' }); return;
        }
        videoMvpScope = project.spec?.mvpExecutionPackage?.scopes?.video || project.spec?.mvpExecutionPackage;
        videoMvpIdentity = project.spec?.mvpExecutionPackage?.identity || project.spec;
        storyboardApprovedFrozenLimit = project.spec?.automation?.managedBy === 'digital_employee'
          && Boolean(project.spec?.contentOrder?.operatingContext?.budgetApprovedAt);
        const currentShotInput = storyboardProjectShotInput(project.spec ?? {}, String(shotId));
        if (!currentShotInput || currentShotInput.fingerprint !== firstFrame.provenance?.projectShotFingerprint) {
          res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入已变化，请重新生成并确认首帧' }); return;
        }
        const kbIssues = await storyboardKbFrameVersionIssues(tenantId, storyboardShotSpec);
        if (kbIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_IMAGE_CHANGED', error: kbIssues.join('；') }); return; }
        const personIssues = await storyboardPersonFrameVersionIssues(tenantId, storyboardShotSpec);
        if (personIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PERSON_IMAGE_CHANGED', error: personIssues.join('；') }); return; }
        const environmentIssues = await storyboardEnvironmentFrameVersionIssues(tenantId, project.spec ?? {}, storyboardShotSpec);
        if (environmentIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED', error: environmentIssues.join('；') }); return; }
        const currentSourcePlan = project.spec?.storyboardSourcePlans?.[String(shotId)];
        if (firstFrame.provenance?.confirmed !== true
          && !automaticStoryboardFrameAdmission(firstFrame.provenance)
          && !automaticManagedFallbackFrameAdmission(firstFrame.provenance, currentSourcePlan)) {
          res.status(409).json({ ok: false, code: 'FIRST_FRAME_NOT_CONFIRMED', error: '当前分镜首帧未确认或输入已变化' }); return;
        }
        const plannedProductIds = Array.isArray(currentSourcePlan?.productIds) ? currentSourcePlan.productIds.map(String) : [];
        const frameProductIds = Array.isArray(firstFrame.provenance?.productIds) ? firstFrame.provenance.productIds.map(String) : [];
        if (plannedProductIds.length && JSON.stringify(plannedProductIds) !== JSON.stringify(frameProductIds)) {
          res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_CHANGED', error: '当前镜头选择的企业产品已变化，请重新生成首帧' }); return;
        }
        if (storyboardShotSpec?.scene === 'usage' && currentSourcePlan &&
          (String(currentSourcePlan.actionStartState || '') !== storyboardShotSpec.action.startState
            || String(currentSourcePlan.actionEndState || '') !== storyboardShotSpec.action.endState)) {
          res.status(409).json({ ok: false, code: 'STORYBOARD_ACTION_CHANGED', error: '使用动作关键状态已变化，请重新生成首帧' }); return;
        }
        storyboardInputFingerprint = createHash('sha256').update(JSON.stringify({ projectId: storyboardProjectId,
          shotId: String(shotId), firstFrameMaterialId: String(firstFrameMaterialId), firstFrameFingerprint: String(firstFrameFingerprint),
          projectShotFingerprint: currentShotInput.fingerprint, resolution: String(resolution), duration,
          ratio: String(ratio), model: config.model, language: String(language), productInfo: String(productInfo).slice(0, 1800) })).digest('hex');
        const currentFrame = firstFrame;
        replyExistingVideo = entry => respondToExistingStoryboardOperation(res, {
          entry, operationId: storyboardOperationId, shotId: String(shotId), stage: 'video', kind: 'video',
          estimatedCostCny: storyboardEstimatedCostCny, inputFingerprint: entry?.inputFingerprint ? storyboardInputFingerprint : undefined,
          recover: original => storyboardReplayVideoResponse({ entry: original, tenantId, projectId: storyboardProjectId,
            projectSpec: project.spec ?? {}, firstFrame: currentFrame, shotId: String(shotId),
            firstFrameFingerprint: String(firstFrameFingerprint), resolution: String(resolution), duration, model: config.model }),
        });
        existingStoryboardVideoOperation = (await storyboardAigcProjectBudget.status(tenantId, storyboardProjectId)).entries
          .find(entry => entry.operationId === storyboardOperationId);
        if (existingStoryboardVideoOperation && await storyboardAigcProjectBudget.releaseExpiredUnacceptedReservation(
          tenantId, storyboardProjectId, storyboardOperationId)) existingStoryboardVideoOperation = undefined;
        if (existingStoryboardVideoOperation) {
          const recoverable = existingStoryboardVideoOperation.status === 'uncertain'
            && !!existingStoryboardVideoOperation.output?.providerTaskId;
          if (!recoverable && await replyExistingVideo(existingStoryboardVideoOperation)) return;
        } else {
          const preview = studioAigcBudgetPreviewForSpec(project.spec ?? {},
            studioAigcBudgetConfigForSpec(project.spec ?? {}, req.body?.maxCostCny, tenantId),
            await studioAigcBudgetContext(tenantId, project));
          storyboardBudgetLimitCny = preview.batchBudgetCny;
          const persistedShotId = String((Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : [])
            .find((slot: any) => String(slot.slotId || slot.id || '') === String(shotId) || String(slot.id || '') === String(shotId))?.id || shotId);
          const budgetShotPlan = preview.shotPlans.find(item => item.shotId === persistedShotId);
          if (!budgetShotPlan || budgetShotPlan.status !== 'ready') {
            res.status(409).json({ ok: false, code: 'STORYBOARD_BUDGET_PLAN_UNAVAILABLE', error: '当前镜头未进入智能生成预算计划，请刷新分镜计划', plan: budgetShotPlan }); return;
          }
          if (budgetShotPlan.targetDurationSeconds !== duration || budgetShotPlan.resolutionTier !== String(resolution) || budgetShotPlan.modelId !== config.model) {
            res.status(409).json({ ok: false, code: 'STORYBOARD_BUDGET_PLAN_CHANGED', error: '视频时长、清晰度或模型与当前预算计划不一致，请刷新后重试', plan: budgetShotPlan }); return;
          }
        }
      }
      // Preserve an accepted supplier receipt before local-byte/new-call checks; retries must never submit twice.
      if (firstFrame && existingStoryboardVideoOperation?.status === 'uncertain' && existingStoryboardVideoOperation.output?.providerTaskId && (!isSeedanceVideoEnabled() || !config.apiKey)) {
        res.status(202).json({ ok: false, code: 'STORYBOARD_VIDEO_IN_PROGRESS', error: '原视频任务已有供应商回执；当前无法查询供应商状态，已保留原任务且未重复提交', providerTaskId: existingStoryboardVideoOperation.output.providerTaskId, providerModel: config.model, providerAcceptedAt: existingStoryboardVideoOperation.output?.providerAcceptedAt }); return;
      }
      frozenFrameObject = firstFrame?.objectKey ? await objectStorageDownload(firstFrame.objectKey) : null;
      frozenFrameBytes = frozenFrameObject?.buf?.length ? frozenFrameObject.buf : firstFrame?.file && fs.existsSync(path.join(MEDIA_DIR, firstFrame.file)) ? fs.readFileSync(path.join(MEDIA_DIR, firstFrame.file)) : null;
      if (firstFrame && !frozenFrameBytes) { res.status(409).json({ ok: false, code: 'STORYBOARD_FIRST_FRAME_BYTES_UNAVAILABLE', error: '确认首帧字节不可读取，无法冻结真实供应商输入；未调用供应商' }); return; }
      const firstFrameContentSha256 = frozenFrameBytes ? createHash('sha256').update(frozenFrameBytes).digest('hex') : '';
      videoInputFingerprint = createHash('sha256').update(JSON.stringify({ prompt, model: config.model, baseUrl: config.baseUrl, ratio, duration, resolution, firstFrameMaterialId, firstFrameFingerprint, firstFrameContentSha256, firstFrameObjectKey: firstFrame?.objectKey, firstFrameFile: firstFrame?.file, shotSpec: storyboardShotSpec, generateAudio: !firstFrame })).digest('hex');
      if (!isSeedanceVideoEnabled()) {
        res.status(423).json({ ok: false, locked: true, source: 'seedance',
          error: 'Seedance 视频生成接口未启用。请配置 SEEDANCE_API_KEY 并设置 SEEDANCE_VIDEO_ENABLED=true。' }); return;
      }
      if (!config.apiKey) {
        res.json({ ok: false, source: 'seedance', error: 'SEEDANCE_API_KEY not set' });
        return;
      }

      const recoveryScope = { tenantId, projectId: storyboardProjectId, shotId: String(shotId),
        operationId: storyboardOperationId, inputFingerprint: videoInputFingerprint };
      if (firstFrame && existingStoryboardVideoOperation?.status === 'uncertain'
        && existingStoryboardVideoOperation.output?.providerTaskId) {
        try {
          const recovered = await productRecovery.recover(recoveryScope, config);
          if (recovered.state === 'processing') {
            res.status(202).json({ ok: false, code: 'STORYBOARD_VIDEO_IN_PROGRESS',
              error: '原视频任务仍在供应商处理中，系统会继续查询；未重复提交',
              providerTaskId: recovered.taskId, providerStatus: recovered.providerStatus,
              providerModel: config.model, providerAcceptedAt: existingStoryboardVideoOperation.output?.providerAcceptedAt }); return;
          }
          if (recovered.state === 'failed') {
            res.status(409).json({ ok: false, code: 'STORYBOARD_VIDEO_PROVIDER_FAILED',
              error: `原视频任务已由供应商标记失败（${recovered.providerStatus}），未重复提交`,
              providerTaskId: recovered.taskId, providerStatus: recovered.providerStatus }); return;
          }
          if (recovered.state === 'ready') {
            recoveredTaskId = recovered.taskId;
            recoveredVideoUrl = recovered.videoUrl;
          } else if (recovered.state === 'completed' && replyExistingVideo) {
            await replyExistingVideo(existingStoryboardVideoOperation); return;
          }
        } catch (error) {
          res.status(202).json({ ok: false, code: 'STORYBOARD_VIDEO_IN_PROGRESS',
            error: '原视频任务正在核验供应商状态，系统会继续查询；未重复提交',
            providerTaskId: existingStoryboardVideoOperation.output?.providerTaskId,
            providerModel: config.model, providerAcceptedAt: existingStoryboardVideoOperation.output?.providerAcceptedAt }); return;
        }
      }

      if (firstFrame && !recoveredTaskId) {
        if (!storyboardProjectId || !storyboardOperationId) {
          res.status(422).json({ ok: false, code: 'STORYBOARD_PROJECT_REQUIRED', error: '分镜视频需要当前项目，未调用供应商' }); return;
        }
        try {
          await mvpBudgetAdmission.reserve({ scope: videoMvpScope, tenantId,
            accountId: videoMvpIdentity?.accountId === null ? null : String(videoMvpIdentity?.accountId || ''), productId: String(videoMvpIdentity?.productId || ''), runId: String(videoMvpIdentity?.runId || ''),
            action: 'generate_media', taskId: String(videoMvpIdentity?.taskId || ''), version: Number(videoMvpIdentity?.version), session: 'B',
            provider: 'seedance', model: config.model, shotId: String(shotId), estimatedCostCny: storyboardEstimatedCostCny,
            operationId: storyboardOperationId, fingerprint: videoInputFingerprint });
          const reserved = await storyboardAigcProjectBudget.reserve({ tenantId, projectId: storyboardProjectId,
            shotId: String(shotId), stage: 'video', operationId: storyboardOperationId,
            estimatedCostCny: storyboardEstimatedCostCny, inputFingerprint: storyboardInputFingerprint, limitCny: storyboardBudgetLimitCny,
            approvedFrozenLimit: storyboardApprovedFrozenLimit });
          if (reserved.existing) {
            if (replyExistingVideo) { await replyExistingVideo(reserved.entry); return; }
            res.status(409).json({ ok: false, code: 'STORYBOARD_VIDEO_RECONCILIATION_REQUIRED',
              error: '原请求已存在但当前输入不可核验，未重复调用供应商', operationId: storyboardOperationId }); return;
          }
        } catch (error) {
          res.status(429).json({ ok: false, code: 'STORYBOARD_PROJECT_BUDGET_EXCEEDED',
            error: error instanceof Error ? error.message : '项目 AIGC 预算不足，未调用供应商' }); return;
        }
      }

      if (!recoveredTaskId && !await consumeDemoQuota(req, res, 'videoGeneration')) {
        if (storyboardOperationId) await storyboardAigcProjectBudget.releaseRejected(tenantId, storyboardProjectId, storyboardOperationId);
        return;
      }

      const subscription = await getTenantSubscription(tenantId);
      const plan = String(subscription?.plan || '').toLowerCase();
      const isFormalTenant = subscription?.status === 'active' && !['admin', 'local', 'trial'].includes(plan);
      let budget: SeedanceBudgetReservation | null = null;
      if (isFormalTenant && !recoveredTaskId) {
        budget = reserveSeedanceBudget({ tenantId, duration, resolution: String(resolution) });
        if (!budget.ok) {
          if (storyboardOperationId) await storyboardAigcProjectBudget.releaseRejected(tenantId, storyboardProjectId, storyboardOperationId);
          res.status(429).json({
            ok: false,
            code: 'seedance_monthly_budget_exceeded',
            error: `本月 Seedance 成本额度已不足：剩余 ¥${budget.remainingCny.toFixed(2)}，本次预计需要 ¥${budget.reservedCny.toFixed(2)}。`,
            message: `本月 Seedance 预算剩余 ¥${budget.remainingCny.toFixed(2)}，本次预计需要 ¥${budget.reservedCny.toFixed(2)}。`,
            budget,
          });
          return;
        }
      }


      let taskAccepted = !!recoveredTaskId;
      const generationStartedAt = Date.now();
      try {
        const content: any[] = [{ type: 'text', text: prompt }];
        // Storyboard frames are product/B-roll images, not portrait assets.  Do
        // not put them in the presenter's LivenessFace asset group: Ark correctly
        // rejects a product image there as lacking face consistency.  Seedance
        // accepts an image data URL, which also avoids making a local dev tunnel a
        // dependency of the provider's image fetch.
        let rawReferenceImageUrl = String(referenceImageUrl).trim();
        if (firstFrame) {
          const object = frozenFrameObject;
          if (object?.buf?.length) {
            if (object.buf.length > 30 * 1024 * 1024) throw new Error('分镜首帧超过 Seedance 允许的 30MB 上限');
            const contentType = /^image\/(?:jpeg|png|webp|bmp|tiff|gif|heic|heif)$/i.test(object.contentType)
              ? object.contentType.toLowerCase()
              : 'image/jpeg';
            rawReferenceImageUrl = `data:${contentType};base64,${object.buf.toString('base64')}`;
          } else {
            rawReferenceImageUrl = (await materialResponse(firstFrame, tenantId)).url;
          }
        }
        // Internal Agent calls arrive from localhost, but Seedance must receive a
        // supplier-reachable origin for the protected first-frame route.
        const supplierAssetOrigin = String(process.env.LOCAL_OBJECT_STORAGE_PUBLIC_BASE_URL || '').replace(/\/$/, '') || getPublicOrigin(req);
        const resolvedReferenceImageUrl = rawReferenceImageUrl.startsWith('/')
          ? `${supplierAssetOrigin}${signAssetUrl(rawReferenceImageUrl, tenantId)}`
          : rawReferenceImageUrl;
        if (resolvedReferenceImageUrl) {
          content.push({
            type: 'image_url',
            image_url: { url: resolvedReferenceImageUrl },
            ...(firstFrame ? { role: 'first_frame' } : {}),
          });
        }
        const created = await submitStoryboardSeedance({ model: config.model, baseUrl: config.baseUrl,
          apiKey: config.apiKey, content, ratio, duration, resolution: String(resolution), silent: !!firstFrame,
          existingTaskId: recoveredTaskId || undefined }, {
          assertCurrent: async () => {
            if (!firstFrame) return;
            const latest = await store.getById<any>('studio_projects', storyboardProjectId);
            const current = latest?.tenant_id === tenantId ? storyboardProjectShotInput(latest.spec ?? {}, String(shotId)) : null;
            if (!current || current.fingerprint !== firstFrame.provenance?.projectShotFingerprint)
              throw new Error('storyboard_seedance_current_input_changed');
          },
          prepare: async () => { if (firstFrame) await productRecovery.recordPrepared(recoveryScope,
              { model: config.model, baseUrl: config.baseUrl, firstFrameMaterialId: firstFrame.id, firstFrameFingerprint: String(firstFrameFingerprint) }); },
          accepted: async id => { if (firstFrame) await productRecovery.recordAccepted(recoveryScope, id); },
          request: seedanceFetchJson,
        });
        const taskId = seedanceTaskId(created);
        if (!taskId) throw new Error('Seedance 未返回任务 ID');
        taskAccepted = true;

        if (storyboardOperationId) {
          const receipt = await storyboardAigcProjectBudget.recordProviderAcceptance(tenantId, storyboardProjectId,
            storyboardOperationId, taskId, config.model);
          await projectStoryboardProviderReceipt({ store, tenantId, projectId: storyboardProjectId,
            slotId: String(shotId), firstFrameMaterialId: String(firstFrameMaterialId),
            firstFrameFingerprint: String(firstFrameFingerprint), providerTaskId: taskId,
            providerModel: config.model, providerAcceptedAt: String(receipt.output!.providerAcceptedAt) });
        }
        const task = recoveredVideoUrl ? { content: { video_url: recoveredVideoUrl } } : await waitForSeedanceTask(config, taskId);
        const remoteUrl = recoveredVideoUrl || findUrlDeep(task);
        if (!remoteUrl) throw new Error('Seedance 未返回可下载的视频地址');
        const filename = `seedance-${taskId.replace(/[^\w.-]+/g, '-')}-${Date.now()}.mp4`;
        let url = remoteUrl;
        let material: Material | null = null;
        try {
          url = await downloadGeneratedVideo(remoteUrl, filename, tenantId);
          material = await createGeneratedVideoMaterial({ title, filename, duration, tenantId, sourceType: 'ai-seedance' });
          if (freeHookContext && material) {
            const inputFingerprint = createHash('sha256').update(JSON.stringify({ script: String(script), productInfo: String(productInfo), language: String(language), ratio: String(ratio), duration: rawDuration, resolution: String(resolution), referenceImageUrl: String(referenceImageUrl), projectId: String(freeHookContext.projectId || '') })).digest('hex');
            material.sourceType = 'ai-free-creation-hook-video';
            material.provenance = { ...material.provenance, freeCreationHook: true, projectId: String(freeHookContext.projectId || ''), requestId: String(requestId), inputFingerprint,
              firstFrameMaterialId: String(freeHookContext.firstFrameMaterialId || ''), productIds: Array.isArray(freeHookContext.productIds) ? freeHookContext.productIds.map(String) : [],
              providerTaskId: taskId, providerModel: config.model, resolution: String(resolution), durationSeconds: duration,
              estimatedCostCny: estimateSeedanceCostCny(duration, String(resolution)), generatedAt: new Date().toISOString() };
            const materialList = loadMaterials(); const materialIndex = materialList.findIndex(item => item.id === material?.id);
            if (materialIndex >= 0) { materialList[materialIndex] = material; persistMaterials(materialList); }
          }
          if (firstFrame && material) {
            material.provenance = {
              ...material.provenance,
              storyboardAigc: true,
              firstFrameMaterialId: firstFrame.id,
              firstFrameFingerprint: String(firstFrameFingerprint),
              shotId: String(shotId),
              projectId: String(firstFrame.provenance?.projectId || ''),
              shotSpec: storyboardShotSpec,
              providerTaskId: taskId,
              providerModel: config.model,
              resolution: String(resolution),
              durationSeconds: duration,
              generatedAt: new Date().toISOString(),
              estimatedCostCny: estimateSeedanceCostCny(duration, String(resolution)),
              generationLatencyMs: Date.now() - generationStartedAt,
            };
            const materialList = loadMaterials();
            const materialIndex = materialList.findIndex(item => item.id === material?.id);
            if (materialIndex >= 0) { materialList[materialIndex] = material; persistMaterials(materialList); }
          }
        } catch (downloadError) {
          console.warn('[studio] Seedance video download failed, returning remote url:', downloadError);
        }
        if (firstFrame && !material) throw new Error('分镜视频已由供应商生成，但本地素材保存失败，请核对任务记录；未重复提交供应商');
        const version = String(generationGroupKey).trim()
          ? appendVideoVersion({
            tenantId,
            groupKey: String(generationGroupKey).trim(),
            parentVersionId: String(parentVersionId).trim() || undefined,
            materialId: material?.id,
            taskId,
            title: String(title),
            url,
            poster: material?.poster,
            duration,
            source: 'seedance',
            model: config.model,
            promptSnapshot: {
              script: String(script), productInfo: String(productInfo), language: String(language),
              ratio: String(ratio), resolution: String(resolution),
              firstFrameMaterialId: String(firstFrameMaterialId || ''),
            },
            context: generationContext && typeof generationContext === 'object' && !Array.isArray(generationContext)
              ? generationContext as Record<string, unknown> : {},
          })
          : undefined;
        if (storyboardOperationId && material) {
          await storyboardAigcProjectBudget.mark(tenantId, storyboardProjectId, storyboardOperationId, 'completed',
            { materialId: material.id, providerTaskId: taskId, estimatedCostCny: storyboardEstimatedCostCny });
        }
        res.json({
          ok: true,
          source: 'seedance',
          id: material?.id || taskId,
          taskId,
          title,
          url,
          poster: material?.poster,
          duration,
          model: config.model,
          budget,
          material,
          version,
          createdAt: new Date().toISOString(),
        });
      } catch (e: any) {
        const definitelyRejected = !taskAccepted && e?.providerRejected === true;
        if (definitelyRejected && videoMvpScope) await mvpBudgetAdmission.releaseRejected(videoMvpScope.budgetPoolId, storyboardOperationId).catch(() => undefined);
        if (storyboardOperationId) {
          if (definitelyRejected) await storyboardAigcProjectBudget.releaseRejected(tenantId, storyboardProjectId, storyboardOperationId).catch(() => undefined);
          else await storyboardAigcProjectBudget.mark(tenantId, storyboardProjectId, storyboardOperationId, 'uncertain').catch(() => undefined);
        }
        if (!taskAccepted && budget?.reservationId && (!storyboardOperationId || definitelyRejected)) {
          releaseSeedanceBudget(tenantId, budget.reservationId);
        }
        const reason = summarizeSeedanceError(e);
        console.error('[studio] Seedance video generation failed:', e);
        res.json({ ok: false, source: 'seedance', error: `Seedance 视频生成失败：${reason}` });
      }
    });
  }

  return { registerPostSeedanceVideo };
}
