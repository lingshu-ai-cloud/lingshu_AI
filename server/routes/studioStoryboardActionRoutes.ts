import { materialResponse } from './studioMaterialProjection.js';
import { productIdentity } from '../digitalEmployees/contentProductionPlanning.js';
import fs from 'fs';
import path from 'path';
import { randomUUID, createHash } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { store } from '../storage/index.js';
import { getTenantSubscription } from '../middleware/subscription.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { type ReferenceImage } from '../lib/imageGen.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { type StoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { planStoryboardActionSegments } from '../../shared/storyboardActionSegments.js';
import type { StoryboardKeyState } from '../../shared/storyboardActionSegments.js';
import { assembleStoryboardActionSegments } from '../lib/storyboardActionAssembly.js';
import { storyboardAigcProjectBudget, type StoryboardAigcSpendEntry } from '../lib/storyboardAigcProjectBudget.js';
import { applyStoryboardReplicationAutomation, automaticStoryboardFrameAdmission, buildStoryboardQaReport, inspectStoryboardTechnicalFrames, type StoryboardQaReport } from '../lib/storyboardAigcQuality.js';
import { studioAigcBudgetConfigForSpec, studioAigcBudgetPreviewForSpec } from './studioAigcBatchBudget.js';
import { getPublicOrigin } from '../lib/oauthConfig.js';
import { estimateSeedanceCostCny, reserveSeedanceBudget, type SeedanceBudgetReservation } from '../lib/seedanceBudget.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';
import { inspectStoryboardAigcFramesWithQwen } from '../agents/qwen.js';
import { type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl, tenantAssetDir } from '../lib/assetAccess.js';
import { MEDIA_DIR } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioStoryboardActionRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'loadMaterials' | 'seedanceVideoConfig' | 'storyboardKbFrameVersionIssues' | 'storyboardPersonFrameVersionIssues' | 'storyboardEnvironmentFrameVersionIssues' | 'respondToExistingStoryboardOperation' | 'storyboardReplayVideoResponse' | 'isSeedanceVideoEnabled' | 'studioAigcBudgetContext' | 'storyboardEnterpriseImage' | 'storyboardKbProductViewReferences' | 'storyboardPersonAssetImage' | 'storyboardMaterialImage' | 'seedanceFetchJson' | 'seedanceTaskId' | 'waitForSeedanceTask' | 'findUrlDeep' | 'downloadGeneratedVideo' | 'execFileAsync' | 'createGeneratedVideoMaterial' | 'persistMaterials'>) {
  const studioRouter = deps.studioRouter;
  const loadMaterials: StudioApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const seedanceVideoConfig: StudioApplicationPorts['seedanceVideoConfig'] = (...args) => deps.seedanceVideoConfig(...args);
  const storyboardKbFrameVersionIssues: StudioApplicationPorts['storyboardKbFrameVersionIssues'] = (...args) => deps.storyboardKbFrameVersionIssues(...args);
  const storyboardPersonFrameVersionIssues: StudioApplicationPorts['storyboardPersonFrameVersionIssues'] = (...args) => deps.storyboardPersonFrameVersionIssues(...args);
  const storyboardEnvironmentFrameVersionIssues: StudioApplicationPorts['storyboardEnvironmentFrameVersionIssues'] = (...args) => deps.storyboardEnvironmentFrameVersionIssues(...args);
  const respondToExistingStoryboardOperation: StudioApplicationPorts['respondToExistingStoryboardOperation'] = (...args) => deps.respondToExistingStoryboardOperation(...args);
  const storyboardReplayVideoResponse: StudioApplicationPorts['storyboardReplayVideoResponse'] = (...args) => deps.storyboardReplayVideoResponse(...args);
  const isSeedanceVideoEnabled: StudioApplicationPorts['isSeedanceVideoEnabled'] = (...args) => deps.isSeedanceVideoEnabled(...args);
  const studioAigcBudgetContext: StudioApplicationPorts['studioAigcBudgetContext'] = (...args) => deps.studioAigcBudgetContext(...args);
  const storyboardEnterpriseImage: StudioApplicationPorts['storyboardEnterpriseImage'] = (...args) => deps.storyboardEnterpriseImage(...args);
  const storyboardKbProductViewReferences: StudioApplicationPorts['storyboardKbProductViewReferences'] = (...args) => deps.storyboardKbProductViewReferences(...args);
  const storyboardPersonAssetImage: StudioApplicationPorts['storyboardPersonAssetImage'] = (...args) => deps.storyboardPersonAssetImage(...args);
  const storyboardMaterialImage: StudioApplicationPorts['storyboardMaterialImage'] = (...args) => deps.storyboardMaterialImage(...args);
  const seedanceFetchJson: StudioApplicationPorts['seedanceFetchJson'] = (...args) => deps.seedanceFetchJson(...args);
  const seedanceTaskId: StudioApplicationPorts['seedanceTaskId'] = (...args) => deps.seedanceTaskId(...args);
  const waitForSeedanceTask: StudioApplicationPorts['waitForSeedanceTask'] = (...args) => deps.waitForSeedanceTask(...args);
  const findUrlDeep: StudioApplicationPorts['findUrlDeep'] = (...args) => deps.findUrlDeep(...args);
  const downloadGeneratedVideo: StudioApplicationPorts['downloadGeneratedVideo'] = (...args) => deps.downloadGeneratedVideo(...args);
  const execFileAsync: StudioApplicationPorts['execFileAsync'] = (...args) => deps.execFileAsync(...args);
  const createGeneratedVideoMaterial: StudioApplicationPorts['createGeneratedVideoMaterial'] = (...args) => deps.createGeneratedVideoMaterial(...args);
  const persistMaterials: StudioApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);

  function registerPostStoryboardActionVideo() {
    studioRouter.post('/storyboard-action-video', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const body = req.body ?? {};
      const firstFrameMaterialId = String(body.firstFrameMaterialId || '');
      const firstFrameFingerprint = String(body.firstFrameFingerprint || '');
      const shotId = String(body.shotId || '');
      const requestId = String(body.requestId || '').trim();
      const resolution = String(body.resolution || '720p');
      const materials = loadMaterials();
      const firstFrame = materials.find(item => item.id === firstFrameMaterialId && item.tenantId === tenantId && item.sourceType === 'ai-storyboard-first-frame');
      const shotSpec = firstFrame?.provenance?.shotSpec as StoryboardShotSpec | undefined;
      if (!firstFrame || !shotSpec || !firstFrameFingerprint || !shotId
        || (firstFrame.provenance?.firstFrameQualityState && firstFrame.provenance.firstFrameQualityState !== 'evaluated')
        || (firstFrame.provenance?.confirmed !== true && !automaticStoryboardFrameAdmission(firstFrame.provenance))
        || firstFrame.provenance?.fingerprint !== firstFrameFingerprint || firstFrame.provenance?.shotId !== shotId) {
        res.status(409).json({ ok: false, code: 'FIRST_FRAME_NOT_CONFIRMED', error: '当前分镜首帧未确认或输入已变化' }); return;
      }
      if (shotSpec.scene !== 'usage' || shotSpec.shotId !== shotId || String(body.ratio || shotSpec.layout.ratio) !== shotSpec.layout.ratio
        || !['480p', '720p'].includes(resolution)) {
        res.status(422).json({ ok: false, code: 'ACTION_VIDEO_INPUT_INVALID', error: '多步动作视频的镜头、画幅或清晰度无效' }); return;
      }
      if (!/^[A-Za-z0-9_:.-]{8,180}$/.test(requestId)) {
        res.status(400).json({ ok: false, code: 'ACTION_REQUEST_ID_REQUIRED', error: '请为本次多段生成提供稳定请求 ID' }); return;
      }
      const rawStates = Array.isArray(body.keyStates) ? body.keyStates : [];
      const validKeyStateSources = shotSpec.mode === 'replication'
        ? ['confirmed_reference_analysis', 'confirmed_storyboard'] : ['confirmed_storyboard'];
      if (rawStates.some((item: any) => !item || !validKeyStateSources.includes(item.source) || typeof item.description !== 'string'
        || item.description.trim().length < 4 || item.description.length > 400 || !Number.isInteger(item.afterBeat)
        || item.imageAssetId)) {
        res.status(422).json({ ok: false, code: 'ACTION_KEY_STATE_INVALID', error: '中间关键状态须来自已确认分镜，且不能直接指定未经核验的外部首帧' }); return;
      }
      const keyStates: StoryboardKeyState[] = rawStates.map((item: any) => ({
        afterBeat: Number(item.afterBeat), description: item.description.trim(), source: item.source,
      }));
      const beatDurationsSeconds = Array.isArray(body.beatDurationsSeconds) ? body.beatDurationsSeconds.map(Number) : undefined;
      if (JSON.stringify(keyStates) !== JSON.stringify(firstFrame.provenance?.actionKeyStates || [])
        || JSON.stringify(beatDurationsSeconds || null) !== JSON.stringify(firstFrame.provenance?.actionBeatDurations || null)) {
        res.status(409).json({ ok: false, code: 'ACTION_KEY_STATES_CHANGED', error: '动作关键状态与已确认首帧不一致，请重做首帧' }); return;
      }
      const actionPlan = planStoryboardActionSegments({ shot: shotSpec,
        capability: { minDurationSeconds: 4, maxDurationSeconds: 15, integerDurationSeconds: true, supportsFirstFrame: true, supportsEndFrame: false },
        firstFrameAssetId: firstFrame.id, keyStates, beatDurationsSeconds, requireKeyStateSegments: true });
      if (actionPlan.status === 'blocked' || !actionPlan.requiresSequentialGeneration) {
        res.status(422).json({ ok: false, code: 'ACTION_SEGMENT_PLAN_NOT_READY', error: '当前动作缺少可验收的分段关键状态，或可使用单段生成', actionPlan }); return;
      }
      const config = seedanceVideoConfig();
      const projectId = String(firstFrame.provenance?.projectId || '');
      if (!projectId) { res.status(422).json({ ok: false, code: 'ACTION_PROJECT_REQUIRED', error: '多段动作须绑定本片制作项目' }); return; }
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId) { res.status(404).json({ ok: false, code: 'ACTION_PROJECT_UNAVAILABLE', error: '当前分镜项目不存在' }); return; }
      const currentShotInput = storyboardProjectShotInput(project.spec ?? {}, shotId);
      if (!currentShotInput || currentShotInput.fingerprint !== firstFrame.provenance?.projectShotFingerprint) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PROJECT_INPUT_CHANGED', error: '当前分镜输入已变化，请重新生成并确认首帧' }); return;
      }
      const kbIssues = await storyboardKbFrameVersionIssues(tenantId, shotSpec);
      if (kbIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_IMAGE_CHANGED', error: kbIssues.join('；') }); return; }
      const personIssues = await storyboardPersonFrameVersionIssues(tenantId, shotSpec);
      if (personIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_PERSON_IMAGE_CHANGED', error: personIssues.join('；') }); return; }
      const environmentIssues = await storyboardEnvironmentFrameVersionIssues(tenantId, project.spec ?? {}, shotSpec);
      if (environmentIssues.length) { res.status(409).json({ ok: false, code: 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED', error: environmentIssues.join('；') }); return; }
      const currentSourcePlan = project.spec?.storyboardSourcePlans?.[shotId];
      const savedActionKeyStates = String(currentSourcePlan?.actionKeyStates || '').split(/[；;\n]+/).map(item => item.trim()).filter(Boolean);
      if (JSON.stringify(keyStates.map(item => item.description)) !== JSON.stringify(savedActionKeyStates)) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_ACTION_KEY_STATES_CHANGED', error: '镜内拆段的中间状态未在当前分镜确认，请重新确认后制作首帧' }); return;
      }
      const plannedProductIds = Array.isArray(currentSourcePlan?.productIds) ? currentSourcePlan.productIds.map(String) : [];
      const frameProductIds = Array.isArray(firstFrame.provenance?.productIds) ? firstFrame.provenance.productIds.map(String) : [];
      if (plannedProductIds.length && JSON.stringify(plannedProductIds) !== JSON.stringify(frameProductIds)) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_PRODUCT_CHANGED', error: '本镜头已选产品变化，请重新生成首帧' }); return;
      }
      if (currentSourcePlan && (String(currentSourcePlan.actionStartState || '') !== shotSpec.action.startState
        || String(currentSourcePlan.actionEndState || '') !== shotSpec.action.endState)) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_ACTION_CHANGED', error: '本镜头动作关键状态变化，请重新生成首帧' }); return;
      }
      const plannedCost = actionPlan.segments.reduce((sum, segment) => sum + estimateSeedanceCostCny(segment.providerDurationSeconds, resolution), 0);
      const operationId = `storyboard-action:${requestId}`;
      const actionInputFingerprint = createHash('sha256').update(JSON.stringify({ projectId, shotId,
        firstFrameMaterialId, firstFrameFingerprint, projectShotFingerprint: currentShotInput.fingerprint,
        resolution, model: config.model, actionPlan })).digest('hex');
      const replyExistingAction = (entry: StoryboardAigcSpendEntry | undefined) => respondToExistingStoryboardOperation(res, {
        entry, operationId, shotId, stage: 'video', kind: 'action', estimatedCostCny: plannedCost,
        inputFingerprint: entry?.inputFingerprint ? actionInputFingerprint : undefined,
        recover: original => storyboardReplayVideoResponse({ entry: original, tenantId, projectId,
          projectSpec: project.spec ?? {}, firstFrame, shotId, firstFrameFingerprint, resolution,
          duration: actionPlan.segments.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0),
          model: config.model, actionSegments: actionPlan.segments }),
      });
      const existingActionOperation = (await storyboardAigcProjectBudget.status(tenantId, projectId)).entries
        .find(entry => entry.operationId === operationId);
      if (await replyExistingAction(existingActionOperation)) return;
      if (!isSeedanceVideoEnabled() || !config.apiKey || !ffmpegStatic) {
        res.status(423).json({ ok: false, code: 'ACTION_VIDEO_PROVIDER_UNAVAILABLE', error: '当前分段视频生成或本地视频组件不可用' }); return;
      }
      const budgetPreview = studioAigcBudgetPreviewForSpec(project.spec ?? {},
        studioAigcBudgetConfigForSpec(project.spec ?? {}, req.body?.maxCostCny, tenantId),
        await studioAigcBudgetContext(tenantId, project));
      const budgetShotId = String((Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : [])
        .find((slot: any) => String(slot.slotId || slot.id || '') === shotId || String(slot.id || '') === shotId)?.id || shotId);
      const budgetPlan = budgetPreview.shotPlans.find(item => item.shotId === budgetShotId);
      if (!budgetPlan || budgetPlan.status !== 'ready' || budgetPlan.resolutionTier !== resolution || budgetPlan.modelId !== config.model
        || Math.abs(budgetPlan.targetDurationSeconds - Math.ceil(shotSpec.targetDurationSeconds)) > .01 || plannedCost > budgetPlan.estimatedVideoCostCny + .01) {
        res.status(409).json({ ok: false, code: 'STORYBOARD_BUDGET_PLAN_CHANGED', error: '多段生成成本超出当前分镜预算方案，请刷新预算计划', budgetPlan }); return;
      }
      const productImages: Array<ReferenceImage & { timeLabel: string }> = [];
      if (frameProductIds.length) {
        const profile = await readTenantEnterpriseProfile(tenantId);
        const profileProducts = profile.products.items || [];
        for (const [index, productId] of frameProductIds.entries()) {
          let product = profileProducts.find((item, productIndex) => productIdentity(item, productIndex) === productId);
          if (!product) {
            const legacy = productId.match(/^product-(\d+)-(.+)$/);
            const candidate = legacy ? profileProducts[Number(legacy[1])] : undefined;
            if (candidate && candidate.name === legacy?.[2] && profileProducts.filter(item => item.name === candidate.name).length === 1) product = candidate;
          }
          const imageUrl = String(product?.images?.[0]?.url || product?.imageUrl || '');
          const image = imageUrl ? await storyboardEnterpriseImage(imageUrl, tenantId) : null;
          if (image) productImages.push({ ...image, timeLabel: `企业产品参考${index + 1}` });
        }
      }
      if (shotSpec.constraints.includes('product_identity') && productImages.length !== frameProductIds.length) {
        res.status(422).json({ ok: false, code: 'PRODUCT_REFERENCE_UNAVAILABLE', error: '知识库产品参考图不可读取，未提交付费生成' }); return;
      }
      const actionViewAssets = shotSpec.assets.filter(asset => asset.role === 'product_view');
      const actionViewReferences = await storyboardKbProductViewReferences(tenantId, shotSpec);
      if (actionViewReferences.length !== actionViewAssets.length) {
        res.status(422).json({ ok: false, code: 'PRODUCT_VIEW_CHANGED', error: '产品多角度参考图已变化，未提交付费生成' }); return;
      }
      productImages.push(...actionViewReferences);
      const personAsset = shotSpec.assets.find(asset => asset.role === 'person');
      const personReference = personAsset ? await storyboardPersonAssetImage(personAsset.id, tenantId) : null;
      if (personAsset && !personReference) {
        res.status(422).json({ ok: false, code: 'PERSON_REFERENCE_UNAVAILABLE', error: '指定人物参考图不可读取，未提交付费生成' }); return;
      }
      const environmentAsset = shotSpec.assets.find(asset => asset.role === 'environment');
      const environmentReference = environmentAsset ? await storyboardMaterialImage(environmentAsset.id, tenantId) : null;
      if (environmentAsset && !environmentReference) {
        res.status(422).json({ ok: false, code: 'ENVIRONMENT_REFERENCE_UNAVAILABLE', error: '工厂环境参考图不可读取，未提交付费生成' }); return;
      }
      if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;

      try {
        const reserved = await storyboardAigcProjectBudget.reserve({ tenantId, projectId, shotId, stage: 'video', operationId,
          estimatedCostCny: plannedCost, inputFingerprint: actionInputFingerprint, limitCny: budgetPreview.batchBudgetCny });
        if (reserved.existing) {
          await replyExistingAction(reserved.entry); return;
        }
      } catch (error) {
        res.status(429).json({ ok: false, code: 'ACTION_PROJECT_BUDGET_EXCEEDED', error: error instanceof Error ? error.message : '项目预算不足' }); return;
      }
      const subscription = await getTenantSubscription(tenantId);
      const isFormalTenant = subscription?.status === 'active' && !['admin', 'local', 'trial'].includes(String(subscription?.plan || '').toLowerCase());
      const temporaryFiles: string[] = [];
      const accepted: Array<{ taskId: string; path: string; quality: StoryboardQaReport; duration: number }> = [];
      let currentFrame = firstFrame;
      let previousTerminalFrame: ReferenceImage | null = null;
      let uncertainSubmission = false;
      try {
        for (const segment of actionPlan.segments) {
          const frameUrl = (await materialResponse(currentFrame, tenantId)).url;
          const referenceUrl = frameUrl.startsWith('/') ? `${getPublicOrigin(req)}${signAssetUrl(frameUrl, tenantId)}` : frameUrl;
          if (!referenceUrl) throw new Error('分段起始帧不可读取');
          const prompt = [
            `Create one continuous ${segment.providerDurationSeconds}-second realistic, silent product-use B-roll shot.`,
            `Aspect ratio ${shotSpec.layout.ratio}; resolution ${resolution}.`,
            `Opening state: ${segment.startState}.`,
            `Only these action steps, in order: ${segment.beats.join(' → ')}.`,
            `Visible final state: ${segment.endState}. Finish the action by ${segment.targetDurationSeconds} seconds and hold that stable completed state afterward.`,
            `Camera: ${shotSpec.action.cameraMotion || 'stable, continuous shot'}.`,
            `Preserve all selected enterprise products, their packaging, the environment and any designated person across the whole shot.`,
            ...shotSpec.assets.filter(asset => asset.role === 'product'
              && !shotSpec.assets.some(view => view.role === 'product_view' && view.derivedFromAssetId === asset.id))
              .map(asset => `Keep product ${asset.id} near its only supplied view; do not invent unseen back or side details.`),
            `Forbidden changes: ${shotSpec.action.forbiddenChanges.join('; ') || 'no product distortion, no extra product, no scene jump, no impossible hand contact'}.`,
            'No dialogue, narration, subtitles, invented packaging text, watermarks or cuts.',
          ].join('\n');
          let monthlyBudget: SeedanceBudgetReservation | null = null;
          if (isFormalTenant) {
            monthlyBudget = reserveSeedanceBudget({ tenantId, duration: segment.providerDurationSeconds, resolution });
            if (!monthlyBudget.ok) throw new Error(`本月 Seedance 额度不足：第 ${segment.index + 1} 段未提交`);
          }
          let taskId = '';
          try {
            const created = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks`, config.apiKey, {
              method: 'POST', body: JSON.stringify({ model: config.model,
                content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: referenceUrl }, role: 'first_frame' }],
                ratio: shotSpec.layout.ratio, duration: segment.providerDurationSeconds, resolution,
                generate_audio: false, watermark: false }),
            });
            taskId = seedanceTaskId(created);
            if (!taskId) throw new Error('供应商未返回分段任务 ID，需核查是否受理');
            accepted.push({ taskId, path: '', quality: null as unknown as StoryboardQaReport, duration: segment.providerDurationSeconds });
          } catch (error) {
            // A transport error after POST may mean the supplier accepted the call.
            uncertainSubmission = true;
            if (monthlyBudget?.reservationId) { /* retain uncertain supplier budget */ }
            throw error;
          }
          const task = await waitForSeedanceTask(config, taskId);
          const remoteUrl = findUrlDeep(task);
          if (!remoteUrl) throw new Error('供应商未返回可下载的分段视频');
          const fileName = `storyboard-action-${randomUUID()}.mp4`;
          await downloadGeneratedVideo(remoteUrl, fileName, tenantId);
          const localVideo = path.join(tenantAssetDir(MEDIA_DIR, tenantId), fileName);
          temporaryFiles.push(localVideo);
          const frameDir = fs.mkdtempSync(path.join(tenantAssetDir(MEDIA_DIR, tenantId), 'storyboard-action-frames-'));
          temporaryFiles.push(frameDir);
          const labels: string[] = [];
          const frames: Array<ReferenceImage & { timeLabel: string }> = [];
          const sampleTimes = [0.04, .25, .5, .75, 1].map(fraction => fraction < 1
            ? Math.min(segment.targetDurationSeconds - .04, Math.max(.04, segment.targetDurationSeconds * fraction))
            : Math.max(.04, segment.targetDurationSeconds - .04));
          for (const [frameIndex, seconds] of sampleTimes.entries()) {
            const file = path.join(frameDir, `frame-${frameIndex}.jpg`);
            await execFileAsync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(seconds), '-i', localVideo,
              '-frames:v', '1', '-q:v', '3', '-y', file], 30_000);
            const label = `${seconds.toFixed(2)}s`;
            labels.push(label);
            frames.push({ base64: fs.readFileSync(file).toString('base64'), mimeType: 'image/jpeg', timeLabel: label });
          }
          const observations = await inspectStoryboardAigcFramesWithQwen({
            phase: 'video', sceneType: 'usage', frames, productReferences: productImages,
            previousTerminalFrame: previousTerminalFrame ? { ...previousTerminalFrame, timeLabel: '上一段合格末帧' } : undefined,
            personReferences: personReference ? [{ ...personReference, timeLabel: '企业人物参考' }] : [],
            environmentReferences: environmentReference && !(shotSpec.mode === 'replication' && !shotSpec.constraints.includes('person_identity')) ? [{ ...environmentReference, timeLabel: '企业工厂环境参考' }] : [],
            storyboard: shotSpec.description, productInfo: firstFrame.productName || '',
            startState: segment.startState, beats: segment.beats, endState: segment.endState,
          });
          const technical = await inspectStoryboardTechnicalFrames('video', frames.map(frame => ({
            bytes: Buffer.from(frame.base64, 'base64'), timeLabel: frame.timeLabel,
          })));
          let quality = buildStoryboardQaReport({
            phase: 'video', sceneType: 'usage', hasProduct: shotSpec.constraints.includes('product_identity'),
            hasNamedPerson: shotSpec.constraints.includes('person_identity'), hasContact: true, hasAction: true,
            hasSeam: !!previousTerminalFrame,
            hasEnvironmentReference: !!environmentReference,
            observations: [...(Array.isArray(observations) ? observations : []).filter(item => !technical.some(check => check.key === item?.key)), ...technical],
            evidenceFrameLabels: previousTerminalFrame ? ['上一段合格末帧', ...labels] : labels,
          });
          if (shotSpec.mode === 'replication' && !shotSpec.constraints.includes('person_identity')) quality = applyStoryboardReplicationAutomation(quality);
          accepted[accepted.length - 1] = { taskId, path: localVideo, quality, duration: segment.providerDurationSeconds };
          if (quality.acceptanceSource === 'automatic_policy' ? !quality.passed : !quality.automatedPassed || quality.checks.end_state?.verdict !== 'pass') {
            const error = new Error('分段动作或产品一致性质检未通过') as Error & { quality?: StoryboardQaReport; segmentIndex?: number };
            error.quality = quality; error.segmentIndex = segment.index;
            throw error;
          }
          if (segment.index < actionPlan.segments.length - 1) {
            const terminal = fs.readFileSync(path.join(frameDir, `frame-${frames.length - 1}.jpg`));
            previousTerminalFrame = { base64: terminal.toString('base64'), mimeType: 'image/jpeg' };
            currentFrame = await createGeneratedImageMaterial({ title: `分镜 ${shotId} 第 ${segment.index + 1} 段末帧`,
              bytes: terminal, mimeType: 'image/jpeg', source: 'storyboard-action-continuation', tenantId });
          }
        }
        const finalFile = `storyboard-action-${randomUUID()}.mp4`;
        const finalPath = path.join(tenantAssetDir(MEDIA_DIR, tenantId), finalFile);
        const assembled = await assembleStoryboardActionSegments({
          segments: accepted.map((item, index) => ({ plan: actionPlan.segments[index]!, videoPath: item.path,
            qualityPassed: true as const, terminalStateVerified: item.quality.checks.end_state?.verdict === 'pass' })),
          outputPath: finalPath,
        });
        const material = await createGeneratedVideoMaterial({ title: String(body.title || '多步使用场景'), filename: finalFile,
          duration: assembled.durationSeconds, tenantId, sourceType: 'ai-seedance' });
        if (!material) throw new Error('分段合成视频素材保存失败');
        material.provenance = {
          ...material.provenance, storyboardAigc: true, projectId, shotId, shotSpec,
          firstFrameMaterialId: firstFrame.id, firstFrameFingerprint, generatedAt: new Date().toISOString(),
          providerModel: config.model, resolution, durationSeconds: assembled.durationSeconds,
          segmentTasks: accepted.map((item, index) => ({ taskId: item.taskId, durationSeconds: item.duration,
            targetDurationSeconds: actionPlan.segments[index]!.targetDurationSeconds, quality: item.quality })),
          estimatedCostCny: plannedCost, requiresFinalHumanReview: true,
        };
        const currentMaterials = loadMaterials();
        const materialIndex = currentMaterials.findIndex(item => item.id === material.id);
        if (materialIndex >= 0) { currentMaterials[materialIndex] = material; persistMaterials(currentMaterials); }
        await storyboardAigcProjectBudget.mark(tenantId, projectId, operationId, 'completed', { materialId: material.id,
          segmentTaskIds: accepted.map(item => item.taskId), estimatedCostCny: plannedCost });
        const visible = await materialResponse(material, tenantId);
        res.json({ ok: true, source: 'seedance', id: material.id, url: visible.url, poster: visible.poster,
          duration: assembled.durationSeconds, material: visible, quality: shotSpec.mode === 'replication' && !shotSpec.constraints.includes('person_identity')
            ? { status: 'passed', requiresHumanReview: false, acceptanceSource: 'automatic_policy' }
            : { status: 'needs_review', requiresHumanReview: true },
          segments: accepted.map((item, index) => ({ index, taskId: item.taskId, quality: item.quality })) });
      } catch (error) {
        const acceptedCost = accepted.reduce((sum, item) => sum + estimateSeedanceCostCny(item.duration, resolution), 0);
        if (uncertainSubmission) {
          await storyboardAigcProjectBudget.mark(tenantId, projectId, operationId, 'uncertain', { acceptedTaskIds: accepted.map(item => item.taskId) }).catch(() => undefined);
        } else {
          await storyboardAigcProjectBudget.settlePartial(tenantId, projectId, operationId, acceptedCost,
            { acceptedTaskIds: accepted.map(item => item.taskId) }).catch(() => undefined);
        }
        const failure = error as Error & { quality?: StoryboardQaReport; segmentIndex?: number };
        res.status(failure.quality ? 422 : 502).json({ ok: false,
          code: failure.quality ? 'STORYBOARD_SEGMENT_QA_FAILED' : 'STORYBOARD_ACTION_VIDEO_FAILED',
          error: failure.message || '分段生成失败', segmentIndex: failure.segmentIndex, quality: failure.quality,
          acceptedSegmentCount: accepted.length });
      } finally {
        for (const item of temporaryFiles.reverse()) fs.rmSync(item, { recursive: true, force: true });
      }
    });
  }

  return { registerPostStoryboardActionVideo };
}
