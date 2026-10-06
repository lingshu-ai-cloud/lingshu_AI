import { preparePhotoTalkingFirstFrames } from '../lib/photoTalkingFirstFrames.js';
import { photoTalkingBudget } from '../lib/photoTalkingBudget.js';
import { selectPresenterPortraitFrame } from '../lib/presenterPortraitFromVideo.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { assertSeedanceCueDurations, assertSplitCueAssignments } from '../lib/sentenceCueSceneCuts.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import { fetchCloudMaterial, getOwnedCloudMaterialRecord, updateCloudMaterial } from '../lib/cloudMaterials.js';
import { legacyAvatarSourceObjectKey, measureAvatarSourceCaptions } from '../lib/avatarSourceCaptions.js';
import { downloadHeygenSubtitles, heygenRequest } from '../integrations/heygen.js';
import { sourceCuesForShot } from '../../src/lib/narrationTimeline.js';
import { materialAssetObjectKey } from '../storage/materialAssets.js';
import { objectStorageDownload, objectStorageHead, objectStorageSignedGetUrl, objectStorageSupplierDeliveryReady, objectStorageUpload } from '../storage/objectStorage.js';
import { resolveHeyGenPresenterPhoto } from '../lib/heygenPresenterPhoto.js';
import { sentenceReplicationReadiness as photoSentenceReadiness } from '../runtime/readiness.js';
import { createPresenterAssetsRouter } from './presenterAssets.js';
import { createPresenterArkEnrollmentRouter } from './presenterArkEnrollment.js';
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { studioPaidBudget } from '../lib/studioPaidBudget.js';
import type { DataStore } from '../storage/datastore.js';
import { HeyGenClient, type HeyGenInput } from '../lib/heygen.js';
import { EMPTY_DEFAULTS, presenterAssetFingerprint, presenterCapabilities, shotFingerprint, type AvatarJob, type PresenterAsset, type PresenterCapability, type ProductionDefaults, type ShotProduction } from '../../src/lib/shotProduction.js';
import { mapNarrationCues, narrationFromDetail } from '../../src/lib/narrationAlignment.js';
import { candidateToolsFor, digitalHumanRouteSteps, planDigitalHumanShot, referenceCues, referenceModelInputAuthorization, routeStepsForExecution, usesDirectReferenceVideo, type DigitalHumanExecutionRecord, type DigitalHumanPlanRecord, type DigitalHumanReferenceCue, type SentenceFirstFrameDraftResult, type SentenceReplicationResult } from '../../src/lib/digitalHumanPlan.js';
import { deferUnavailableVisualChecksToManual, initialDigitalHumanQuality, recordDigitalHumanMediaCheck, recordModelQualityChecks, recordReferenceTechnicalChecks, recordReferenceVisualChecks, reviewDigitalHumanQuality, type ModelQualityDecision, type ModelQualityKey, type ReferenceTechnicalMetrics, type ReferenceVisualMetrics } from '../../src/lib/digitalHumanQuality.js';
import { digitalHumanToolCapabilities, isDefinitiveSupplierSubmissionError, requiredReferencePreservation, selectReferenceAdapter, verifiedSupplierCost, type DigitalHumanExecutionAdapter, type DigitalHumanToolId } from '../lib/digitalHumanProviderRegistry.js';
import { normalizePresenterAccountIdentity } from '../lib/presenterAccountIdentity.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { planPersonShotClusters } from '../../src/lib/personShotClustering.js';
import type { ExecutionStoreRecord, FirstFrameDraftJobRecord, ImportedVideoResult, JobRecord, PlanStoreRecord, ProductionRouterOptions, ReferenceImportResult, SentenceJobRecord } from './productionContracts.js';
import { candidateOutputFromImport, createProductionRuntime, createProductionStoreRuntime } from './productionRuntime.js';
import { batchShotRequestId, planStudioBatchShotRoutes, uniqueAuthorizedSalesPresenter } from './studioBatchShotRoutes.js';
import { studioAigcBatchBudgetPreview, studioAigcBudgetConfigFromEnv } from './studioAigcBatchBudget.js';
import { productionTrendReference } from '../lib/productionTrendReference.js';
export { candidateOutputFromImport } from './productionRuntime.js';

export function createProductionRouter(store: DataStore, importVideo: (url: string, duration: number, job: AvatarJob, input: HeyGenInput, tenantId: string) => Promise<string | ImportedVideoResult>, options: ProductionRouterOptions = {}) {
  const router = Router();
  const { exclusive, enabled, client, executableReferenceAdapters, referenceBudgetLimitCny, maxAttemptsPerShot, sentenceReadiness, releaseReferenceReservation, assertCandidateOutputCurrent } = createProductionRuntime(options);
  const { assertAttemptAvailable, readDefaults } = createProductionStoreRuntime(store, maxAttemptsPerShot);
  router.use('/presenters', createPresenterAssetsRouter(store, exclusive));
  router.use('/presenters', createPresenterArkEnrollmentRouter(store, exclusive));
  router.post('/avatar-source-captions', async (req, res) => {
    try {
      const tenantId = String(res.locals.tenantId || '');
      const { projectId, assemblyId, shotId, slotId, materialId } = req.body || {};
      if (![projectId, assemblyId, shotId, slotId, materialId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 180))
        throw new Error('数字人分镜与素材标识无效');
      const result = await exclusive(`avatar-source-captions:${tenantId}:${materialId}`, async () => {
        const project = await store.getById<any>('studio_projects', projectId);
        if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
        const assembly = (project.spec?.storyboardAssemblies || []).find((item: any) => item.id === assemblyId);
        const assignments = assemblyId === project.spec?.activeAssemblyId
          ? project.spec?.storyboardAssignments : assembly?.assignments;
        const shot = project.spec?.shotProductions?.[`${assemblyId}:${shotId}`] as ShotProduction | undefined;
        if (assignments?.[slotId] !== materialId || shot?.source !== 'avatar' || shot.sound !== 'source')
          throw new Error('所选素材不是此分镜已确认的数字人原声');
        const adopted = shot.candidates.some(candidate => candidate.id === shot.adoptedId
          && candidate.source === 'avatar' && candidate.materialId === materialId);
        const material = readLocalMaterials().find(item => item.id === materialId && item.tenantId === tenantId && item.scope === 'own');
        const cloudId = materialId.startsWith('pb-') ? materialId.slice(3) : '';
        const cloud = !material && cloudId ? await getOwnedCloudMaterialRecord(cloudId, tenantId) : null;
        const snapshot = !material && !cloud ? (project.spec?.materialSnapshots || []).find((item: any) => item.id === materialId) : null;
        const jobs = await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: tenantId, project_id: projectId }, perPage: 500 });
        const verifiedHeygenJob = jobs.items.find(job => job.tenant_id === tenantId && job.payload.status === 'completed'
          && job.payload.materialId === materialId && job.payload.assemblyId === assemblyId && job.payload.shotId === shotId);
        const executions = await store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: tenantId, project_id: projectId }, perPage: 500 });
        const verifiedAdoption = executions.items.some(record => record.tenant_id === tenantId
            && record.payload.assemblyId === assemblyId && record.payload.shotId === shotId
            && record.payload.adoption?.materialId === materialId && record.payload.quality.state === 'accepted');
        if (snapshot) {
          if (!verifiedHeygenJob && !verifiedAdoption) throw new Error('旧数字人素材缺少与当前镜头匹配的生成或采纳凭证');
        }
        const cloudProvenance = cloud?.provenance && typeof cloud.provenance === 'object'
          ? cloud.provenance as Record<string, unknown> : (() => { try { return JSON.parse(String(cloud?.provenance || '{}')) as Record<string, unknown>; } catch { return {}; } })();
        const source = material || (cloud ? { id: materialId, tenantId, scope: 'own', type: cloud.type,
          duration: cloud.duration, sourceType: cloud.sourceType,
          transcript: cloudProvenance.avatarSourceTranscript,
          transcriptCues: cloudProvenance.avatarSourceCues,
          transcriptCuesProvenance: cloudProvenance.avatarSourceCuesProvenance } : snapshot);
        if (!source || source.type !== 'video') throw new Error('数字人源片不存在或不属于当前企业');
        const reusableSentenceVideo = Boolean(material && material.sourceType === 'digital-human-sentence-video'
          && material.providerTaskId && material.contentSha256);
        if (!adopted && !verifiedHeygenJob && !verifiedAdoption && !reusableSentenceVideo)
          throw new Error('所选素材缺少数字人生成与采纳记录');
        const trustedStoredCues = ['heygen:source_video_srt', 'qwen_filetrans:source_material'].includes(String(source.transcriptCuesProvenance || ''));
        const existing = trustedStoredCues ? sourceCuesForShot(source.transcriptCues, Number(source.duration)) : [];
        if (existing.length) return { materialId, transcript: String(source.transcript || ''), cues: existing,
          provenance: String(source.transcriptCuesProvenance || 'material_source'), cached: true };
        let legacyObjectKey = '';
        if (snapshot) {
          legacyObjectKey = legacyAvatarSourceObjectKey(String(snapshot.url || ''), materialId, tenantId);
        }
        let measured: Awaited<ReturnType<typeof measureAvatarSourceCaptions>> | null = null;
        if (verifiedHeygenJob?.payload.remoteId) {
          try {
            const remoteCues = options.recoverAvatarSourceCaptions
              ? await options.recoverAvatarSourceCaptions(verifiedHeygenJob.payload.remoteId, Number(source.duration), String(verifiedHeygenJob.input.script || ''))
              : await (async () => {
                const provider = await heygenRequest(`videos/${encodeURIComponent(verifiedHeygenJob.payload.remoteId!)}`);
                return downloadHeygenSubtitles(String(provider.data?.subtitle_url || ''), Number(source.duration), String(verifiedHeygenJob.input.script || ''));
              })();
            const cues = sourceCuesForShot(remoteCues, Number(source.duration));
            if (cues.length) measured = { transcript: cues.map(cue => cue.text).join(' '), cues,
              provenance: 'heygen:source_video_srt', sourceHash: '' };
          } catch { /* Historical provider captions may be gone; use measured source-audio alignment. */ }
        }
        if (!measured) {
          if (req.body?.confirmedPaidAsr !== true) throw new Error('HeyGen 原字幕不可用；如需用千问从数字人源片实测转写，将产生 ASR 费用，请确认后重试');
          if (!options.measureAvatarSourceCaptions && !objectStorageSupplierDeliveryReady())
            throw new Error('数字人原声字幕需先配置可供千问读取的 HTTPS 对象存储地址');
          let sourceBytes: Buffer | undefined;
          if (cloudId) {
            const cloudMedia = await fetchCloudMaterial(cloudId, 'videoFile', undefined, tenantId);
            if (!cloudMedia) throw new Error('数字人云素材文件不可读取');
            sourceBytes = Buffer.from(await cloudMedia.arrayBuffer());
          } else if (snapshot) {
            const object = await objectStorageDownload(legacyObjectKey);
            if (!object?.buf.length) throw new Error('旧数字人源片文件不可读取');
            sourceBytes = object.buf;
          } else if (material) {
            sourceBytes = (await readTenantMaterialBytes(material, tenantId)).bytes;
          }
          if (!sourceBytes?.length) throw new Error('数字人源片文件不可读取');
          const reservationId = `avatar-source-captions:${tenantId}:${projectId}:${materialId}`;
          await (options.reserveAvatarSourceAsr
            ? options.reserveAvatarSourceAsr(reservationId)
            : studioPaidBudget.reserve('qwen_asr', reservationId));
          measured = await (options.measureAvatarSourceCaptions || measureAvatarSourceCaptions)(source, tenantId, sourceBytes);
        }
        if (cloudId) {
          const saved = await updateCloudMaterial(cloudId, { provenance: { ...cloudProvenance,
            avatarSourceTranscript: measured.transcript, avatarSourceCues: measured.cues,
            avatarSourceCuesProvenance: measured.provenance, avatarSourceHash: measured.sourceHash } });
          if (!saved) throw new Error('数字人源片字幕写回云素材失败');
        } else if (snapshot) {
          const nextSpec = structuredClone(project.spec || {});
          nextSpec.materialSnapshots = (nextSpec.materialSnapshots || []).map((item: any) => item.id === materialId
            ? { ...item, transcript: measured.transcript, transcriptCues: measured.cues,
              transcriptCuesProvenance: measured.provenance, transcriptSourceHash: measured.sourceHash } : item);
          if (!await store.update('studio_projects', project.id, { spec: nextSpec })) throw new Error('旧数字人源片字幕写回草稿失败');
        } else {
          const latest = readLocalMaterials();
          const index = latest.findIndex(item => item.id === materialId && item.tenantId === tenantId);
          if (index < 0) throw new Error('字幕生成完成后原素材已不可用');
          latest[index] = { ...latest[index], transcript: measured.transcript, transcriptCues: measured.cues,
            transcriptCuesProvenance: measured.provenance, transcriptSourceHash: measured.sourceHash };
          saveLocalMaterials(latest);
        }
        return { materialId, transcript: measured.transcript, cues: measured.cues, provenance: measured.provenance, cached: false };
      });
      res.json(result);
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : '数字人源片字幕补取失败' });
    }
  });
  router.post('/presenters/portrait-from-video', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const presenterId = String(req.body?.presenterId || '');
      const videoMaterialId = String(req.body?.videoMaterialId || '');
      const result = await exclusive(`presenter-portrait:${tenantId}:${presenterId}:${videoMaterialId}`, async () => {
        const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
        const presenter = defaults?.presenters.find(item => item.id === presenterId && item.authorized);
        if (!presenter || !presenter.referenceMaterialIds?.includes(videoMaterialId)) throw new Error('请选择已绑定且授权的企业人物视频');
        const video = readLocalMaterials().find(item => item.id === videoMaterialId && item.type === 'video' && item.scope === 'own' && item.tenantId === tenantId);
        if (!video) throw new Error('企业人物视频不存在或不属于当前企业');
        const source = await readTenantMaterialBytes(video, tenantId);
        const portrait = await selectPresenterPortraitFrame(source.bytes);
        const id = `presenter-frame-${createHash('sha256').update(`${tenantId}:${presenterId}:${videoMaterialId}:${portrait.sha256}`).digest('hex').slice(0, 24)}`;
        const existing = readLocalMaterials().find(item => item.id === id);
        if (existing) return { materialId: id, atSeconds: portrait.atSeconds, sharpness: portrait.sharpness, previewUrl: await objectStorageSignedGetUrl(String(existing.objectKey), 900), alreadyExists: true };
        const key = materialAssetObjectKey(tenantId, `${id}.jpg`);
        await objectStorageUpload({ key, body: portrait.bytes, contentType: 'image/jpeg' });
        const head = await objectStorageHead(key);
        if (!head?.etag) throw new Error('人像帧入库后缺少对象版本');
        const material = { id, name: `${presenter.name} · 视频清晰帧`, folder: 'presenter', type: 'image', scope: 'own', tenantId,
          size: `${Math.ceil(portrait.bytes.length / 1024)} KB`, duration: 0, file: '', url: '', objectKey: key, objectEtag: head.etag,
          contentSha256: portrait.sha256, sourceType: 'presenter-video-frame', sourceMaterialId: videoMaterialId,
          frameAtSeconds: portrait.atSeconds, frameSharpness: portrait.sharpness, presenterAssetId: presenterId, createdAt: new Date().toISOString() };
        saveLocalMaterials([...readLocalMaterials(), material]);
        return { materialId: id, atSeconds: portrait.atSeconds, sharpness: portrait.sharpness, previewUrl: await objectStorageSignedGetUrl(key, 900), alreadyExists: false };
      });
      res.json(result);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '人物视频取帧失败' }); }
  });
  const persistPlan = async (input: { tenantId: string; project: any; assemblyId: string; shotId: string; fingerprint: string; origin?: 'manual' | 'content_agent'; sourceTaskId?: string; sourceTaskVersion?: string }) => {
    const { tenantId, project, assemblyId, shotId, fingerprint } = input;
    const shot = project.spec?.shotProductions?.[`${assemblyId}:${shotId}`] as ShotProduction | undefined;
    if (!shot || shot.source !== 'avatar') throw new Error('草稿中未找到当前数字人分镜');
    if (!fingerprint || shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), shotId) !== fingerprint) throw new Error('镜头要求与已保存草稿不一致，请保存后重试');
    const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
    const presenter = defaults?.presenters.find(item => item.id === shot.presenterId && item.authorized);
    const slot = (Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : []).find((item: any) => String(item.id) === shotId);
    const now = new Date().toISOString();
    let plan = planDigitalHumanShot({ requirements: shot.digitalHuman, narration: shot.narration, hasAuthorizedPresenter: Boolean(presenter), talkingAvailable: enabled(), presenterCapabilities: presenter ? presenterCapabilities(presenter) : undefined });
    let referenceEstimatedCostCny: number | null = null;
    let routeDecision: DigitalHumanPlanRecord['routeDecision'] = null;
    const modelInputAuthorization = referenceModelInputAuthorization(shot.digitalHuman, now);
    if (shot.digitalHuman && shot.digitalHuman.method !== 'talking' && plan.state === 'preview_only' && modelInputAuthorization) {
      const requiredPreservation = requiredReferencePreservation({ preserve: shot.digitalHuman.preserve, productMaterialId: shot.productMaterialId, backgroundMaterialId: shot.backgroundMaterialId });
      const selection = selectReferenceAdapter({ adapters: executableReferenceAdapters(), candidates: candidateToolsFor(shot.digitalHuman), method: shot.digitalHuman.method,
        targetDurationSeconds: Number(slot?.duration) || null,
        maxEstimatedCostCny: referenceBudgetLimitCny(),
        requiredPreservation });
      routeDecision = { targetDurationSeconds: Number(slot?.duration) || null, budgetLimitCny: referenceBudgetLimitCny(), requiredPreservation, selectedTool: selection.adapter?.id || null, evaluations: selection.evaluations };
      if (selection.adapter) {
        plan = { ...plan, state: 'ready', executable: true, reasons: [], provider: selection.adapter.id };
        referenceEstimatedCostCny = selection.estimatedCostCny;
      } else if (executableReferenceAdapters().length) {
        plan = { ...plan, reasons: [selection.reason] };
      }
    } else if (shot.digitalHuman?.method === 'reenact' && usesDirectReferenceVideo(shot.digitalHuman) && plan.state === 'preview_only' && !modelInputAuthorization) {
      plan = { ...plan, reasons: ['当前仅做结构分析与方案预览；如需把源视频提交给生成模型，请确认模型输入授权并填写依据'] };
    } else if (shot.digitalHuman?.method === 'reenact' && !usesDirectReferenceVideo(shot.digitalHuman) && plan.state === 'preview_only') {
      plan = { ...plan, reasons: ['逐句首帧重建方案已就绪；等待接通“首帧提取 → 目标人物首帧生成 → 逐句视频生成 → 拼接”编排器'] };
    }
    if (plan.provider === 'heygen' && plan.executable && presenter) {
      const trust = validateHeyGenPresenterRecord(presenter);
      if (!trust.ok) plan = { ...plan, state: 'needs_input', executable: false, reasons: [`HeyGen 人物、音色或授权预检未通过：${trust.reasons.join('、')}`] };
    }
    const shotKey = `${assemblyId}:${shotId}`;
    const rate = Number(process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND);
    const presenterVersion = Math.max(1, presenter?.assetVersion || 1);
    const existing = (await store.list<PlanStoreRecord>('studio_digital_human_plans', { where: { tenant_id: tenantId, project_id: project.id, shot_key: shotKey, fingerprint }, perPage: 500 })).items
      .find(item => item.payload.presenterAssetVersion === presenterVersion);
    const inputSnapshot = {
      narration: shot.narration, language: String(project.spec?.activeVoiceLang || project.spec?.lang || ''), ratio: String(project.spec?.ratio || ''),
      targetDurationSeconds: Number.isFinite(Number(slot?.duration)) && Number(slot?.duration) > 0 ? Number(slot?.duration) : null,
      sound: shot.sound, presenterId: shot.presenterId, presenterAssetVersion: presenterVersion,
      presenterReferenceMaterialIds: [...new Set((presenter?.toolMappings?.runway?.referenceMaterialIds || presenter?.referenceMaterialIds || []).map(String).filter(Boolean))],
      voiceMapping: presenter?.voiceId && (presenter.avatarId || shot.digitalHuman?.presenterMode === "photo_talking") ? { avatarId: presenter.avatarId, voiceId: presenter.voiceId } : null,
      productId: shot.productId, productMaterialId: shot.productMaterialId, backgroundMaterialId: shot.backgroundMaterialId,
      requirements: shot.digitalHuman ? structuredClone(shot.digitalHuman) : null,
      ...(shot.digitalHuman?.method === 'replace' && shot.digitalHuman.reference?.derivativeAuthorized === true && shot.digitalHuman.reference.derivativeAuthorizationEvidence?.trim() ? {
        derivativeAuthorization: { evidence: shot.digitalHuman.reference.derivativeAuthorizationEvidence.trim(), confirmedAt: now },
      } : {}),
      ...(modelInputAuthorization ? { modelInputAuthorization } : {}),
    };
    const payload: DigitalHumanPlanRecord = { id: existing?.id || '', projectId: project.id, assemblyId, shotId, fingerprint,
      workflow: shot.digitalHuman?.workflow || 'material_processing', method: shot.digitalHuman?.method || 'talking', presenterId: shot.presenterId,
      presenterAssetVersion: presenterVersion, candidateTools: candidateToolsFor(shot.digitalHuman), inputSnapshot,
      routeSteps: digitalHumanRouteSteps(shot.digitalHuman?.method || 'talking', plan.provider, plan.executable, plan.state),
      routeDecision,
      estimatedCostCny: plan.provider === 'heygen' && rate > 0 ? Number((Math.max(1, shot.narration.length / 4) * rate).toFixed(2)) : referenceEstimatedCostCny,
      ...plan, origin: input.origin || existing?.payload.origin || 'manual',
      ...((input.sourceTaskId || existing?.payload.sourceTaskId) ? { sourceTaskId: input.sourceTaskId || existing?.payload.sourceTaskId } : {}),
      ...((input.sourceTaskVersion || existing?.payload.sourceTaskVersion) ? { sourceTaskVersion: input.sourceTaskVersion || existing?.payload.sourceTaskVersion } : {}),
      createdAt: existing?.payload.createdAt || now, updatedAt: now };
    if (existing) {
      if (!await store.update('studio_digital_human_plans', existing.id, { payload })) throw new Error('制作方案来源版本更新失败');
      return { ...payload, id: existing.id };
    }
    const saved = await store.create<PlanStoreRecord>('studio_digital_human_plans', { tenant_id: tenantId, project_id: project.id, shot_key: shotKey, fingerprint, payload });
    if (!saved) throw new Error('制作方案保存失败');
    return { ...payload, id: saved.id };
  };
  router.get('/capabilities', (_req, res) => {
    const rate = Number(process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND);
    const budget = studioPaidBudget.status('heygen');
    res.json({ configured: enabled() && budget.allowed, reason: !enabled() ? '管理员须配置 HEYGEN_API_KEY 并明确启用 HEYGEN_GENERATION_ENABLED；当前不会发起付费生成' : budget.reason, costPerSecond: rate > 0 ? rate : null, budget, referenceBudgetLimitCny: referenceBudgetLimitCny(), maxAttemptsPerShot: maxAttemptsPerShot(),
      tools: digitalHumanToolCapabilities({ talkingEnabled: enabled() && budget.allowed, talkingCostReconciliation: Boolean(options.reconcileHeyGenCost), adapters: executableReferenceAdapters(), unavailableReasons: options.toolUnavailableReasons }) });
  });
  router.get('/defaults', async (_req, res) => {
    try { res.json({ ...EMPTY_DEFAULTS, ...((await readDefaults(res.locals.tenantId))?.payload || {}) }); }
    catch { res.status(503).json({ error: '企业出镜设置读取失败' }); }
  });
  router.get('/plans', async (req, res) => {
    try {
      const projectId = String(req.query.projectId || '');
      const result = await store.list<PlanStoreRecord>('studio_digital_human_plans', { where: { tenant_id: res.locals.tenantId, project_id: projectId }, perPage: 500 });
      res.json(result.items.filter(item => item.tenant_id === res.locals.tenantId).map(item => ({ ...item.payload, id: item.id })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch { res.status(503).json({ error: '数字人分镜制作方案读取失败' }); }
  });
  router.get('/batch-shot-routes', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const projectId = String(req.query.projectId || '');
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
      const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
      const authorizedPresenters = (defaults?.presenters ?? []).filter(item => validateHeyGenPresenterRecord(item).ok);
      const salesPresenter = uniqueAuthorizedSalesPresenter(authorizedPresenters);
      const routes = planStudioBatchShotRoutes(project.spec ?? {}, {
        talkingExecutorReady: enabled() && studioPaidBudget.status('heygen').allowed,
        actionExecutorReady: executableReferenceAdapters().length > 0,
        authorizedPresenterIds: authorizedPresenters.map(item => item.id),
        defaultSalesPresenterId: salesPresenter?.id ?? null,
      });
      const aigcBudgetPreview = studioAigcBatchBudgetPreview(routes, {
        ...studioAigcBudgetConfigFromEnv(),
        creationMode: String(project.spec?.mode || ''),
        slots: Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : [],
        requestedResolutions: Object.fromEntries(Object.entries(project.spec?.storyboardSourcePlans || {}).map(([id, value]) => {
          const plan = value as { videoResolution?: string; videoResolutionPinned?: boolean };
          return [id, plan?.videoResolutionPinned && (plan.videoResolution === '480p' || plan.videoResolution === '720p')
            ? plan.videoResolution : undefined];
        })),
      });
      res.json({ projectId, planningOnly: true, routes, aigcBudgetPreview, counts: {
        matched: routes.filter(item => item.status === 'matched').length,
        needsPlan: routes.filter(item => item.status === 'needs_plan').length,
        aigcFirstFrame: routes.filter(item => item.route === 'aigc_first_frame').length,
        needsMaterial: routes.filter(item => item.status === 'needs_material').length,
        blocked: routes.filter(item => item.status === 'blocked').length,
      } });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '批量分镜路线检查失败' }); }
  });
  router.get('/executions', async (req, res) => {
    try {
      const result = await store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: res.locals.tenantId, project_id: String(req.query.projectId || '') }, perPage: 500 });
      res.json(result.items.filter(item => item.tenant_id === res.locals.tenantId).map(item => ({ ...item.payload, id: item.id })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    } catch { res.status(503).json({ error: '数字人执行记录读取失败' }); }
  });
  router.post('/executions/:id/cost', async (req, res) => {
    try {
      const record = await store.getById<ExecutionStoreRecord>('studio_digital_human_executions', req.params.id);
      if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('数字人执行记录不存在');
      const amount = Number(req.body?.actualCostCny); const sourceRef = String(req.body?.sourceRef || '').trim();
      if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000 || !sourceRef || sourceRef.length > 300) throw new Error('实际费用或账单依据无效');
      const payload: DigitalHumanExecutionRecord = { ...record.payload, id: record.id, actualCostCny: Number(amount.toFixed(4)), costStatus: 'reconciled', costSourceRef: sourceRef, updatedAt: new Date().toISOString() };
      if (!await store.update('studio_digital_human_executions', record.id, { payload })) throw new Error('实际费用保存失败');
      res.json(payload);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '实际费用保存失败' }); }
  });
  router.post('/executions/:id/reconcile-cost', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const payload = await exclusive(`cost-reconcile:${tenantId}:${req.params.id}`, async () => {
        const record = await store.getById<ExecutionStoreRecord>('studio_digital_human_executions', req.params.id);
        if (!record || record.tenant_id !== tenantId) throw new Error('数字人执行记录不存在');
        if (record.payload.costStatus === 'reconciled') return { ...record.payload, id: record.id };
        if (record.payload.state !== 'completed' || !record.payload.externalTaskId) throw new Error('供应商任务尚未完成，不能核对最终账单');
        const adapter = (options.adapters || []).find(item => item.id === record.payload.tool);
        const lookup = record.payload.tool === 'heygen'
          ? options.reconcileHeyGenCost
          : adapter?.cost ? (externalTaskId: string) => adapter.cost!(externalTaskId) : undefined;
        if (!lookup) throw new Error('当前供应商未提供可核验的账单查询能力');
        const evidence = verifiedSupplierCost(await lookup(record.payload.externalTaskId));
        if (!evidence) throw new Error('供应商账单尚未生成，请稍后核对原任务；不会使用预计费用替代');
        const next: DigitalHumanExecutionRecord = { ...record.payload, id: record.id, ...evidence, costStatus: 'reconciled', updatedAt: new Date().toISOString() };
        if (!await store.update('studio_digital_human_executions', record.id, { payload: next })) throw new Error('供应商账单对账结果保存失败');
        return next;
      });
      res.json(payload);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '供应商账单对账失败' }); }
  });
  router.post('/executions/:id/quality', async (req, res) => {
    try {
      const record = await store.getById<ExecutionStoreRecord>('studio_digital_human_executions', req.params.id);
      if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('数字人执行记录不存在');
      if (record.payload.adoption) throw new Error('候选已填入分镜；如需更换，请先创建新的候选或装配版本，不能改写已采用版本的验收结论');
      if (record.payload.quality.state !== 'manual_review') throw new Error('当前候选的人工验收已经结束；不通过后请按修改意见生成新候选，不能改写原结论');
      if (record.payload.quality.checks.find(check => check.key === 'media_import')?.status !== 'passed') throw new Error('媒体尚未通过入库检查，不能完成人工验收');
      await assertCandidateOutputCurrent(record, res.locals.tenantId as string);
      const raw = req.body?.decisions;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('请提交人工验收结果');
      const pendingManual = record.payload.quality.checks.filter(check => check.mode === 'manual' && check.status === 'pending');
      const allowed = new Set(pendingManual.map(check => check.key));
      const decisions: Record<string, { passed: boolean; evidence: string }> = {};
      for (const [key, value] of Object.entries(raw as Record<string, any>)) {
        if (!allowed.has(key) || typeof value?.passed !== 'boolean' || !String(value?.evidence || '').trim()) throw new Error('人工验收项目或依据无效');
        decisions[key] = { passed: value.passed, evidence: String(value.evidence).trim().slice(0, 500) };
      }
      if (!pendingManual.length || pendingManual.some(check => !decisions[check.key]) || Object.keys(decisions).length !== pendingManual.length) {
        throw new Error('请一次提交当前候选全部待人工验收项目的明确结论');
      }
      const reviewNote = String(req.body?.reviewNote || '').trim().slice(0, 1000);
      if (Object.values(decisions).some(decision => !decision.passed) && !reviewNote) throw new Error('质检不通过时请填写具体修改意见');
      const quality = reviewDigitalHumanQuality(record.payload.quality, decisions, new Date().toISOString(), reviewNote);
      const payload = { ...record.payload, id: record.id, quality,
        routeSteps: record.payload.routeSteps ? routeStepsForExecution(record.payload.routeSteps, record.payload.state, quality, Boolean(record.payload.adoption)) : undefined,
        updatedAt: new Date().toISOString() };
      if (!await store.update('studio_digital_human_executions', record.id, { payload })) throw new Error('人工验收结果保存失败');
      res.json(payload);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '人工验收结果保存失败' }); }
  });
  router.post('/plans', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const b = req.body || {};
      const project = await store.getById<any>('studio_projects', String(b.projectId || ''));
      if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
      res.json(await persistPlan({ tenantId, project, assemblyId: String(b.assemblyId || ''), shotId: String(b.shotId || ''), fingerprint: String(b.fingerprint || '') }));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '数字人分镜制作方案保存失败' }); }
  });

  router.post('/sentence-first-frames', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string; const b = req.body || {};
      const project = await store.getById<any>('studio_projects', String(b.projectId || ''));
      if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
      const shot = project.spec?.shotProductions?.[`${b.assemblyId}:${b.shotId}`] as ShotProduction | undefined;
      if (!shot?.digitalHuman || shot.digitalHuman.workflow !== 'viral_replication' || shot.digitalHuman.method !== 'reenact'
        || usesDirectReferenceVideo(shot.digitalHuman)) throw new Error('当前分镜不是逐句首帧重建路线');
      if (shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), String(b.shotId || '')) !== String(b.fingerprint || '')) throw new Error('数字人参数与已保存草稿不一致，请保存后重试');
      const materialId = String(shot.digitalHuman.reference?.materialId || '');
      const originalCues = referenceCues(shot.digitalHuman);
      const slot = (Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : []).find((item: any) => String(item.id) === String(b.shotId || ''));
      const confirmedWholePersonShot = originalCues.length === 1 && slot?.salesPresenterConfirmed === true
        && slot?.observedPresenterRole === 'sales_presenter'
        && Math.abs(Number(slot.duration) - (originalCues[0]!.end - originalCues[0]!.start)) < 0.2;
      const cues = confirmedWholePersonShot && originalCues[0]!.personShot === undefined
        ? [{ ...originalCues[0]!, personShot: true, classificationSource: 'manual' as const,
          compositionClusterId: originalCues[0]!.compositionClusterId || `${b.shotId}:confirmed-sales-presenter`,
          targetText: originalCues[0]!.targetText || String(shot.narration || '').trim() }]
        : originalCues;
      if (!cues.length) throw new Error('请先完成爆款参考视频逐句分析');
      const sourceMaterial = materialId ? undefined : await productionTrendReference({ store, tenantId, projectSpec: project.spec,
        shotReference: shot.digitalHuman.reference || {} });
      const resolvedMaterialId = materialId || sourceMaterial!.id;
      const clusterPlan = planPersonShotClusters(cues, Math.max(1, Number(process.env.DIGITAL_HUMAN_MAX_FIRST_FRAMES_PER_VIDEO) || 3));
      if (clusterPlan.state !== 'ready') throw new Error(clusterPlan.blockers.join('；'));
      if (!options.prepareSentenceFirstFrames) throw new Error('逐句首帧提取服务尚未配置');
      res.json({ cues: await options.prepareSentenceFirstFrames({ tenantId, referenceMaterialId: resolvedMaterialId, cues, sourceMaterial }), clusterPlan });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '逐句首帧提取失败' }); }
  });

  router.post('/photo-talking-first-frames', async (req,res) => {
    try { const tenantId=res.locals.tenantId as string; const b=req.body||{}; if(b.confirmed!==true) throw new Error('请确认目标首帧生成及供应商计费');
      const maxCostCny=Number(b.maxCostCny); if(!Number.isFinite(maxCostCny)||maxCostCny<=0) throw new Error('请填写本次照片口播费用上限');
      const project=await store.getById<any>('studio_projects',String(b.projectId||'')); if(!project||project.tenant_id!==tenantId||project.status!=='draft') throw new Error('创作草稿不存在');
      const shot=project.spec?.shotProductions?.[`${b.assemblyId}:${b.shotId}`] as ShotProduction|undefined;
      if(shot?.digitalHuman?.presenterMode!=='photo_talking'||shot.digitalHuman.workflow!=='viral_replication') throw new Error('当前分镜不是爆款照片口播');
      if(shotFingerprint(shot,String(project.spec?.shotProductionContext||''),String(b.shotId))!==b.fingerprint) throw new Error('请先保存当前人物配置');
      const sourceAuthorization=shot.digitalHuman.reference;
      if(sourceAuthorization?.modelInputAuthorized!==true||!String(sourceAuthorization.modelInputAuthorizationEvidence||'').trim()) throw new Error('请先确认原片首帧可作为方舟构图参考，并填写授权依据；未调用供应商');
      const defaults=(await readDefaults(tenantId))?.payload as ProductionDefaults|undefined; const presenter=defaults?.presenters.find(item=>item.id===shot.presenterId&&item.authorized); if(!presenter) throw new Error('请选择企业人物照片');
      const cues=referenceCues(shot.digitalHuman);assertSplitCueAssignments(cues);const clusters=planPersonShotClusters(cues,Math.max(1,Number(process.env.DIGITAL_HUMAN_MAX_FIRST_FRAMES_PER_VIDEO)||3));if(clusters.state!=='ready')throw new Error(clusters.blockers.join('；'));
      const quote=photoTalkingBudget({cues,frameCount:clusters.clusters.length,fixedHeygenReserveCny:Number(process.env.STUDIO_HEYGEN_RESERVE_CNY)});
      if(quote.totalCny>maxCostCny)throw new Error(`首帧与口播合计预估费用 ¥${quote.totalCny.toFixed(2)} 超过本次上限 ¥${maxCostCny.toFixed(2)}，未调用供应商`);
      const result=await exclusive(`photo-first-frames:${tenantId}:${b.projectId}`,()=>(options.preparePhotoTalkingFirstFrames || preparePhotoTalkingFirstFrames)({tenantId,projectId:project.id,assemblyId:String(b.assemblyId),presenter,cues}));res.json(result);
    } catch(error) {res.status(400).json({error:error instanceof Error?error.message:'目标首帧生成失败'});}
  });
  router.post('/sentence-first-frame-drafts',async(req,res)=>{
    try{const tenantId=res.locals.tenantId as string;const b=req.body||{};const requestId=String(b.requestId||'');if(b.confirmed!==true||!/^[A-Za-z0-9_:.-]{1,150}$/.test(requestId))throw new Error('请确认千问首帧草稿生成及计费，并提供有效请求标识');const result=await exclusive(`qwen-first-frame-draft:${tenantId}:${requestId}`,async()=>{const prior=(await store.list<FirstFrameDraftJobRecord>('studio_first_frame_draft_jobs',{where:{tenant_id:tenantId,request_id:requestId},perPage:1})).items[0];if(prior){if(prior.payload.state==='completed'&&prior.payload.result)return prior.payload.result;throw new Error(prior.payload.state==='failed'?`该千问草稿请求已失败并留档：${prior.payload.error||'原因未知'}；修正后请使用新请求标识`:'该千问草稿请求状态未确认，请核对原任务，勿重复提交计费');}const project=await store.getById<any>('studio_projects',String(b.projectId||''));if(!project||project.tenant_id!==tenantId||project.status!=='draft')throw new Error('创作草稿不存在或不可编辑');const assemblyId=String(b.assemblyId||''),shotId=String(b.shotId||''),fingerprint=String(b.fingerprint||'');const shot=project.spec?.shotProductions?.[`${assemblyId}:${shotId}`] as ShotProduction|undefined;if(!shot?.digitalHuman||shot.digitalHuman.workflow!=='viral_replication'||shot.digitalHuman.method!=='reenact'||usesDirectReferenceVideo(shot.digitalHuman))throw new Error('当前分镜不是逐句首帧重建路线');if(shotFingerprint(shot,String(project.spec?.shotProductionContext||''),shotId)!==fingerprint)throw new Error('数字人参数与已保存草稿不一致，请保存后重试');const defaults=(await readDefaults(tenantId))?.payload as ProductionDefaults|undefined;const presenter=defaults?.presenters.find(item=>item.id===shot.presenterId&&item.authorized);if(!presenter)throw new Error('请选择已授权企业人物');const cues=referenceCues(shot.digitalHuman);assertSplitCueAssignments(cues);if(shot.digitalHuman.presenterMode!=='photo_talking')assertSeedanceCueDurations(cues);if(!cues.length||cues.some(cue=>cue.personShot!==false&&!cue.sourceFirstFrame?.materialId))throw new Error('请先完成全部人物镜头的逐句源首帧提取');if(!options.generateSentenceFirstFrameDrafts)throw new Error('千问首帧草稿服务尚未配置');const now=new Date().toISOString();const created=await store.create<FirstFrameDraftJobRecord>('studio_first_frame_draft_jobs',{tenant_id:tenantId,project_id:project.id,request_id:requestId,payload:{state:'running',fingerprint,assemblyId,shotId,createdAt:now,updatedAt:now}});if(!created)throw new Error('千问首帧草稿作业留档失败，未发起计费');try{const generated=await options.generateSentenceFirstFrameDrafts({tenantId,projectId:project.id,assemblyId,presenter,cues});await store.update('studio_first_frame_draft_jobs',created.id,{payload:{...created.payload,state:'completed',result:generated,updatedAt:new Date().toISOString()}});return generated;}catch(error){await store.update('studio_first_frame_draft_jobs',created.id,{payload:{...created.payload,state:'failed',error:error instanceof Error?error.message:'生成失败',updatedAt:new Date().toISOString()}});throw error;}});res.json(result);}catch(error){res.status(400).json({error:error instanceof Error?error.message:'千问首帧草稿生成失败'});}
  });

  router.get('/sentence-replication-readiness', (_req, res) => {
    // Safe to return to the UI: this reports variable names only, never values.
    res.json(sentenceReadiness());
  });

  router.get('/sentence-replication-jobs/:id', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const record = await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs', req.params.id);
      if (!record || record.tenant_id !== tenantId) throw new Error('逐句生产作业不存在');
      if (record.payload.state !== 'completed' || !record.payload.result) throw new Error(`逐句生产作业尚未完成：${record.payload.state}`);
      res.json({ ...record.payload.result, sentenceJobId: record.id });
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : '逐句生产作业读取失败' }); }
  });

  router.get('/sentence-replication-jobs/:id/status', async (req, res) => {
    try {
      const record = await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs', req.params.id);
      if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('逐句生产作业不存在');
      res.json({ id: record.id, state: record.payload.state, providerTasks: record.payload.providerTasks || {}, error: record.payload.error || '', updatedAt: record.payload.updatedAt });
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : '逐句生产状态读取失败' }); }
  });
  router.get('/sentence-replication-requests/:requestId/status', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const record = (await store.list<SentenceJobRecord>('studio_sentence_replication_jobs', { where: { tenant_id: tenantId, request_id: req.params.requestId }, perPage: 1 })).items[0];
      if (!record) throw new Error('逐句生产请求不存在');
      res.json({ id: record.id, state: record.payload.state, providerTasks: record.payload.providerTasks || {}, error: record.payload.error || '', updatedAt: record.payload.updatedAt });
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : '逐句生产状态读取失败' }); }
  });
  router.get('/sentence-replication-pending', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string; const projectId = String(req.query.projectId || '');
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId) throw new Error('创作草稿不存在');
      const jobs = (await store.list<SentenceJobRecord>('studio_sentence_replication_jobs', { where: { tenant_id: tenantId, project_id: projectId }, perPage: 500 })).items;
      const matches = jobs.filter(item => item.payload.assemblyId === req.query.assemblyId && item.payload.shotId === req.query.shotId && item.payload.fingerprint === req.query.fingerprint && item.payload.state === 'uncertain' && Object.keys(item.payload.providerTasks || {}).length);
      matches.sort((a, b) => b.payload.updatedAt.localeCompare(a.payload.updatedAt));
      const record = matches[0]; res.json(record ? { id: record.id, state: record.payload.state, providerTasks: record.payload.providerTasks, error: record.payload.error, updatedAt: record.payload.updatedAt } : null);
    } catch (error) { res.status(404).json({ error: error instanceof Error ? error.message : '待核实逐句任务读取失败' }); }
  });

  async function submitSentenceReplication(tenantId: string, b: { projectId: string; assemblyId: string; shotId: string; fingerprint: string; requestId: string; maxCostCny?: number }, resumeJobId?: string, reprocessJobId?: string) {
    return await exclusive(`sentence-replication:${tenantId}:${b.requestId}`, async () => {
        const requestId = String(b.requestId);
        const existing = (await store.list<SentenceJobRecord>('studio_sentence_replication_jobs', { where: { tenant_id: tenantId, request_id: requestId }, perPage: 1 })).items[0];
        if (resumeJobId && (!existing || existing.id !== resumeJobId || existing.payload.state !== 'uncertain')) throw new Error('原作业不在可恢复状态，请核对状态');
        if (existing && !resumeJobId) {
          if (existing.payload.state === 'completed' && existing.payload.result) return existing.payload.result;
          throw new Error(existing.payload.state === 'failed'
            ? `该请求已失败并已留档：${existing.payload.error || '原因未知'}。修正输入后请发起新请求，勿复用请求标识`
            : '该请求已有生成记录，状态未确认；请核对原任务，勿重复提交计费');
        }
        const project = await store.getById<any>('studio_projects', String(b.projectId || ''));
        if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
        const shot = project.spec?.shotProductions?.[`${b.assemblyId}:${b.shotId}`] as ShotProduction | undefined;
        if (!shot?.digitalHuman || shot.digitalHuman.workflow !== 'viral_replication' || shot.digitalHuman.method !== 'reenact' || usesDirectReferenceVideo(shot.digitalHuman)) throw new Error('当前分镜不是逐句首帧重建路线');
        const fingerprint = String(b.fingerprint || '');
        if (shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), String(b.shotId || '')) !== fingerprint) throw new Error('数字人参数与已保存草稿不一致，请保存后重试');
        if (!resumeJobId) {
          const priorJobs = (await store.list<SentenceJobRecord>('studio_sentence_replication_jobs', { where: { tenant_id: tenantId, project_id: project.id }, perPage: 500 })).items;
          if (priorJobs.some(item => item.payload.assemblyId === b.assemblyId && item.payload.shotId === b.shotId && item.payload.fingerprint === fingerprint && ['running','uncertain'].includes(item.payload.state))) throw new Error('当前分镜已有未核实的逐句任务，请查询并恢复原任务，勿重新提交计费');
        }
        const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
        const presenter = defaults?.presenters.find(item => item.id === shot.presenterId && item.authorized);
        if (!presenter) throw new Error('请选择已授权企业人物');
        if (shot.digitalHuman.presenterMode !== 'photo_talking' && shot.digitalHuman.preferredProvider && !['auto', 'sd'].includes(shot.digitalHuman.preferredProvider)) throw new Error('逐句首帧视频路线当前使用 Seedance；所选模型需走对应执行接口，不能自动替换模型');
        const cues = referenceCues(shot.digitalHuman);
        assertSplitCueAssignments(cues);
        const reprocessRecord = reprocessJobId ? await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs', reprocessJobId) : null;
        if (reprocessJobId && (!reprocessRecord || reprocessRecord.tenant_id !== tenantId || reprocessRecord.project_id !== project.id || reprocessRecord.payload.state !== 'completed' || reprocessRecord.payload.assemblyId !== b.assemblyId || reprocessRecord.payload.shotId !== b.shotId || reprocessRecord.payload.fingerprint !== fingerprint || shot.digitalHuman.presenterMode !== 'photo_talking' || cues.some(cue => cue.personShot !== false && !reprocessRecord.payload.providerTasks?.[cue.id]))) throw new Error('原 HeyGen 作业不完整或与当前分镜不一致，不能复用');
        if (shot.digitalHuman.presenterMode !== 'photo_talking') assertSeedanceCueDurations(cues);
        if (resumeJobId && (shot.digitalHuman.presenterMode !== 'photo_talking' || cues.some(cue => cue.personShot !== false && !existing?.payload.providerTasks?.[cue.id]))) throw new Error('原作业缺少完整 HeyGen 任务 ID，需人工核对，不能重新提交计费');
        if (shot.digitalHuman.presenterMode === 'photo_talking' && (!shot.digitalHuman.targetFramesConfirmed || cues.some(cue => cue.personShot !== false && cue.targetFirstFrame?.state !== 'ready'))) throw new Error('请先重建并确认目标人物首帧');
        const clusterPlan = planPersonShotClusters(cues, Math.max(1, Number(process.env.DIGITAL_HUMAN_MAX_FIRST_FRAMES_PER_VIDEO) || 3));
        if (clusterPlan.state !== 'ready') throw new Error(clusterPlan.blockers.join('；'));
        if (!clusterPlan.personCueIds.length) throw new Error('当前视频没有人物镜头，不应调用人物首帧或数字人口播生成；请按普通素材混剪路线制作');
        if (!cues.length || cues.some(cue => cue.personShot !== false && !cue.sourceFirstFrame?.materialId)) throw new Error('请先完成全部人物镜头的逐句源首帧提取');
        if (!options.runSentenceReplication) throw new Error('逐句目标人物首帧与视频编排器尚未配置');
        const readiness = shot.digitalHuman.presenterMode === 'photo_talking' ? photoSentenceReadiness(process.env, 'heygen') : sentenceReadiness();
        if (!readiness.ready) throw new Error(readiness.reason);
        if (shot.digitalHuman.presenterMode === 'photo_talking' && (!Number.isFinite(Number(b.maxCostCny)) || Number(b.maxCostCny) <= 0)) throw new Error('请填写本次照片口播费用上限');
        const sourceMaterial = shot.digitalHuman.reference?.materialId ? undefined : await productionTrendReference({ store, tenantId, projectSpec: project.spec, shotReference: shot.digitalHuman.reference || {} });
        const savedPlan = await persistPlan({ tenantId, project, assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint });
        const now = new Date().toISOString();
        const record = existing || await store.create<SentenceJobRecord>('studio_sentence_replication_jobs', { tenant_id: tenantId, project_id: project.id, request_id: requestId,
          payload: { state: 'running', fingerprint, assemblyId: String(b.assemblyId), shotId: String(b.shotId), ...(reprocessRecord?.payload.providerTasks ? {providerTasks:reprocessRecord.payload.providerTasks} : {}), createdAt: now, updatedAt: now } });
        if (!record) throw new Error('逐句生成请求记录保存失败，尚未调用供应商');
        if (resumeJobId) { record.payload = { ...record.payload, state: 'running', error: '', updatedAt: now }; if (!await store.update('studio_sentence_replication_jobs', record.id, { payload: record.payload })) throw new Error('原作业恢复状态保存失败'); }
        try {
          const generated = await options.runSentenceReplication({ tenantId, projectId: project.id, assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint, shot, presenter, cues, requestId, maxCostCny: b.maxCostCny, sourceMaterial, existingProviderTasks: resumeJobId || reprocessJobId ? record.payload.providerTasks : undefined,
            onProviderTaskSubmitted: async (cueId,taskId)=>{ const providerTasks={...(record.payload.providerTasks||{}),[cueId]:taskId}; record.payload={...record.payload,providerTasks,updatedAt:new Date().toISOString()}; if(!await store.update('studio_sentence_replication_jobs',record.id,{payload:record.payload})) throw new Error('供应商已受理任务但任务 ID 持久化失败；请核对原任务，勿重复提交'); } });
          if (!generated.candidateOutput) throw new Error('逐句拼接候选缺少可复核的对象版本与内容哈希');
          let quality = initialDigitalHumanQuality(shot.digitalHuman);
          quality = recordDigitalHumanMediaCheck(quality, { passed: true, evidence: `material:${generated.materialId}` });
          quality = deferUnavailableVisualChecksToManual(quality);
          const execution: DigitalHumanExecutionRecord = { id: '', planId: savedPlan.id, jobId: record.id, projectId: project.id, assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint,
            tool: shot.digitalHuman.presenterMode === 'photo_talking' ? 'heygen' : 'runway_seedance', provider: shot.digitalHuman.presenterMode === 'photo_talking' ? 'sentence_first_frame_heygen' : 'sentence_first_frame_pipeline', model: shot.digitalHuman.presenterMode === 'photo_talking' ? 'heygen-v3-photo' : process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128', presenterAssetVersion: presenter.assetVersion || 1,
            submissionOutcome: 'created', candidateOutput: generated.candidateOutput, routeSteps: routeStepsForExecution(savedPlan.routeSteps || [], 'completed', quality), state: 'completed',
            externalTaskId: generated.providerTaskIds?.join(',') || null, materialId: generated.materialId, estimatedCostCny: null, actualCostCny: null, costStatus: 'awaiting_invoice', costSourceRef: null,
            error: '', quality, createdAt: now, updatedAt: new Date().toISOString() };
          const executionRecord = await store.create<ExecutionStoreRecord>('studio_digital_human_executions', { tenant_id: tenantId, project_id: project.id, job_id: record.id, plan_id: savedPlan.id, request_id: requestId, payload: execution });
          if (!executionRecord) throw new Error('逐句生成已完成但验收记录保存失败；请核对素材库，勿重复提交');
          const completed = { ...generated, executionId: executionRecord.id, sentenceJobId: record.id };
          const payload: SentenceJobRecord['payload'] = { ...record.payload, state: 'completed', result: completed, updatedAt: new Date().toISOString() };
          if (!await store.update('studio_sentence_replication_jobs', record.id, { payload })) throw new Error('逐句生成已完成但结果记录保存失败；请核对素材库，勿重复提交');
          return completed;
        } catch (error) {
          const message = error instanceof Error ? error.message : '逐句生成失败';
          const hasSubmittedTask = Object.keys(record.payload.providerTasks || {}).length > 0;
          const uncertain = !/任务明确失败/.test(message) && (hasSubmittedTask || /未知|超时|核对原任务|已完成但/.test(message));
          await store.update('studio_sentence_replication_jobs', record.id, { payload: { ...record.payload, state: uncertain ? 'uncertain' : 'failed', error: message, updatedAt: new Date().toISOString() } });
          throw error;
        }
      });
  }
  router.post('/sentence-replication-jobs', async (req, res) => {
    try {
      const b = req.body || {};
      if (b.confirmed !== true || !/^[A-Za-z0-9_:.-]{1,150}$/.test(String(b.requestId || ''))) throw new Error('请确认逐句视频生成及供应商计费，并提供有效请求标识');
      res.json(await submitSentenceReplication(res.locals.tenantId as string, b));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '逐句爆款复刻失败' }); }
  });
  router.post('/sentence-replication-jobs/:id/resume', async (req, res) => {
    try {
      if (req.body?.confirmed !== true) throw new Error('请确认查询原 HeyGen 任务并继续本地验收');
      const record = await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs', req.params.id);
      if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('逐句生产作业不存在');
      res.json(await submitSentenceReplication(record.tenant_id, { projectId: record.project_id, assemblyId: record.payload.assemblyId, shotId: record.payload.shotId, fingerprint: record.payload.fingerprint, requestId: record.request_id, maxCostCny: Number(req.body?.maxCostCny) }, record.id));
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '逐句生产原任务恢复失败' }); }
  });
  router.post('/sentence-replication-jobs/:id/reprocess', async (req, res) => {
    try {
      const record = await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs', req.params.id);
      if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('原 HeyGen 作业不存在');
      res.json(await submitSentenceReplication(record.tenant_id, {projectId:record.project_id,assemblyId:record.payload.assemblyId,shotId:record.payload.shotId,fingerprint:record.payload.fingerprint,requestId:randomUUID(),maxCostCny:Number(req.body?.maxCostCny)},undefined,record.id));
    } catch (error) { res.status(400).json({error:error instanceof Error?error.message:'原 HeyGen 素材重整失败'}); }
  });
  router.post('/sentence-replication-jobs/:id/cue-quality', async (req,res)=>{
    try { const tenantId=res.locals.tenantId as string; const record=await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs',req.params.id);
      if(!record || record.tenant_id!==tenantId || record.payload.state!=='completed' || !record.payload.result?.cueQuality) throw new Error('逐镜质检记录不存在或生产尚未完成');
      const submitted=req.body?.decisions && typeof req.body.decisions==='object'?req.body.decisions as Record<string,Record<string,{passed?:unknown;evidence?:unknown}>>:{};
      const allowed=new Set(['identity','motion','product_brand_text','background','audio_sync','reuse_risk']);
      const cueQuality=record.payload.result.cueQuality.map(cue=>{ const decisions=submitted[cue.cueId]||{}; const checks=cue.checks.map(check=>{ if(check.status!=='pending'||!allowed.has(check.key)||!decisions[check.key]) return check; const decision=decisions[check.key]!; const evidence=String(decision.evidence||'').trim(); if(typeof decision.passed!=='boolean'||!evidence) throw new Error(`镜头 ${cue.cueId} 的 ${check.key} 缺少明确结论或证据`); return {...check,status:decision.passed?'passed' as const:'failed' as const,evidence}; }); const state=checks.some(check=>check.status==='failed')?'failed':checks.every(check=>check.status==='passed')?'accepted':'manual_review'; return {...cue,checks,state}; });
      const failedCueIds=cueQuality.filter(cue=>cue.state==='failed').map(cue=>cue.cueId); const result={...record.payload.result,cueQuality,failedCueIds}; const payload={...record.payload,result,updatedAt:new Date().toISOString()}; if(!await store.update('studio_sentence_replication_jobs',record.id,{payload})) throw new Error('逐镜质检结果保存失败'); res.json(result);
    } catch(error){res.status(400).json({error:error instanceof Error?error.message:'逐镜质检保存失败'});}
  });
  router.post('/sentence-replication-jobs/:id/retry-failed',async(req,res)=>{
    let retryRecord:SentenceJobRecord|undefined;
    try { const tenantId=res.locals.tenantId as string; const requestId=String(req.body?.requestId||''); if(req.body?.confirmed!==true||!/^[A-Za-z0-9_:.-]{1,150}$/.test(requestId)) throw new Error('请确认局部返工计费，并提供新的有效请求标识');
      const result=await exclusive(`sentence-repair:${tenantId}:${requestId}`,async()=>{ const previous=await store.getById<SentenceJobRecord>('studio_sentence_replication_jobs',req.params.id); if(!previous||previous.tenant_id!==tenantId||previous.payload.state!=='completed'||!previous.payload.result) throw new Error('原逐句作业不存在或尚未完成');
        const existing=(await store.list<SentenceJobRecord>('studio_sentence_replication_jobs',{where:{tenant_id:tenantId,request_id:requestId},perPage:1})).items[0]; if(existing){if(existing.payload.state==='completed'&&existing.payload.result)return existing.payload.result;throw new Error('该返工请求已存在且状态未确认，请核对原任务，勿重复提交计费');}
        const failed=new Set(previous.payload.result.failedCueIds||[]); if(!failed.size) throw new Error('原作业没有已确认的失败镜头，无需发起局部返工');
        const project=await store.getById<any>('studio_projects',previous.project_id); if(!project||project.tenant_id!==tenantId||project.status!=='draft') throw new Error('创作草稿不存在或不可编辑');
        const {assemblyId,shotId,fingerprint}=previous.payload; const shot=project.spec?.shotProductions?.[`${assemblyId}:${shotId}`] as ShotProduction|undefined; if(!shot||shotFingerprint(shot,String(project.spec?.shotProductionContext||''),shotId)!==fingerprint) throw new Error('分镜要求已经变化，请保存为新的完整生产请求');
        const defaults=(await readDefaults(tenantId))?.payload as ProductionDefaults|undefined; const presenter=defaults?.presenters.find(item=>item.id===shot.presenterId&&item.authorized); if(!presenter)throw new Error('原人物资产已不可用'); const cues=referenceCues(shot.digitalHuman);
        const priorCues=new Map(previous.payload.result.cues.map(cue=>[cue.id,cue])); const reuseCueMaterialIds:Record<string,string>={}; for(const cue of cues)if(!failed.has(cue.id)){const materialId=String(priorCues.get(cue.id)?.generatedClip?.materialId||'');if(!materialId)throw new Error(`已通过镜头 ${cue.id} 缺少可复用素材`);reuseCueMaterialIds[cue.id]=materialId;}
        const reuseCueQuality=(previous.payload.result.cueQuality||[]).filter(item=>!failed.has(item.cueId)&&item.state==='accepted'); if(Object.keys(reuseCueMaterialIds).length!==reuseCueQuality.length)throw new Error('已通过镜头缺少完整质量验收证据，不能在局部返工中直接复用');
        const now=new Date().toISOString(); const createdRetry=await store.create<SentenceJobRecord>('studio_sentence_replication_jobs',{tenant_id:tenantId,project_id:project.id,request_id:requestId,payload:{state:'running',fingerprint,assemblyId,shotId,createdAt:now,updatedAt:now}}); if(!createdRetry)throw new Error('局部返工作业保存失败，尚未调用供应商'); retryRecord=createdRetry;
        try { const generated=await options.runSentenceReplication!({tenantId,projectId:project.id,assemblyId,shotId,fingerprint,shot,presenter,cues,requestId,reuseCueMaterialIds,reuseCueQuality,onProviderTaskSubmitted:async(cueId,taskId)=>{const providerTasks={...(retryRecord!.payload.providerTasks||{}),[cueId]:taskId};retryRecord!.payload={...retryRecord!.payload,providerTasks,updatedAt:new Date().toISOString()};if(!await store.update('studio_sentence_replication_jobs',retryRecord!.id,{payload:retryRecord!.payload}))throw new Error('Seedance 已受理返工任务但任务 ID 持久化失败；请核对原任务，勿重复提交');}});
          if(!generated.candidateOutput)throw new Error('局部返工拼接结果缺少可复核对象证据'); const savedPlan=await persistPlan({tenantId,project,assemblyId,shotId,fingerprint}); let quality=recordDigitalHumanMediaCheck(initialDigitalHumanQuality(shot.digitalHuman),{passed:true,evidence:`material:${generated.materialId}`});quality=deferUnavailableVisualChecksToManual(quality); const execution:DigitalHumanExecutionRecord={id:'',planId:savedPlan.id,jobId:retryRecord.id,projectId:project.id,assemblyId,shotId,fingerprint,tool:shot.digitalHuman?.presenterMode==='photo_talking'?'heygen':'runway_seedance',provider:shot.digitalHuman?.presenterMode==='photo_talking'?'sentence_first_frame_heygen_repair':'sentence_first_frame_repair',model:shot.digitalHuman?.presenterMode==='photo_talking'?'heygen-v3-photo':process.env.SEEDANCE_MODEL||'doubao-seedance-2-0-fast-260128',presenterAssetVersion:presenter.assetVersion||1,submissionOutcome:'created',candidateOutput:generated.candidateOutput,routeSteps:routeStepsForExecution(savedPlan.routeSteps||[],'completed',quality),state:'completed',externalTaskId:generated.providerTaskIds?.join(',')||null,materialId:generated.materialId,estimatedCostCny:null,actualCostCny:null,costStatus:'awaiting_invoice',costSourceRef:null,error:'',quality,createdAt:now,updatedAt:new Date().toISOString()}; const executionRecord=await store.create<ExecutionStoreRecord>('studio_digital_human_executions',{tenant_id:tenantId,project_id:project.id,job_id:retryRecord.id,plan_id:savedPlan.id,request_id:requestId,payload:execution});if(!executionRecord)throw new Error('局部返工已完成但执行记录保存失败；请核对素材库，勿重复提交'); const completed={...generated,executionId:executionRecord.id,sentenceJobId:retryRecord.id}; const payload={...retryRecord.payload,state:'completed' as const,result:completed,updatedAt:new Date().toISOString()};if(!await store.update('studio_sentence_replication_jobs',retryRecord.id,{payload}))throw new Error('局部返工已完成但结果记录保存失败；请核对素材库，勿重复提交');return completed;
        }catch(error){const message=error instanceof Error?error.message:'局部返工失败';const uncertain=/未知|超时|核对原任务|已完成但|已受理/.test(message);await store.update('studio_sentence_replication_jobs',retryRecord.id,{payload:{...retryRecord.payload,state:uncertain?'uncertain':'failed',error:message,updatedAt:new Date().toISOString()}});throw error;}
      });res.json(result);
    }catch(error){res.status(400).json({error:error instanceof Error?error.message:'逐镜局部返工失败'});}
  });
  router.post('/executions/:id/adopt', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const payload = await exclusive(`adopt:${tenantId}:${req.params.id}`, async () => {
        const record = await store.getById<ExecutionStoreRecord>('studio_digital_human_executions', req.params.id);
        if (!record || record.tenant_id !== tenantId) throw new Error('数字人执行记录不存在');
        const candidateId = String(req.body?.candidateId || ''); const materialId = String(req.body?.materialId || '');
        if (!candidateId || !materialId) throw new Error('候选或素材标识无效');
        if (record.payload.quality.state !== 'accepted' || !record.payload.quality.reviewedAt || record.payload.state !== 'completed' || record.payload.materialId !== materialId) throw new Error('候选尚未完成生成与逐项人工验收，不能填入分镜');
        await assertCandidateOutputCurrent(record, tenantId);
        if (record.payload.adoption) {
          if (record.payload.adoption.candidateId !== candidateId || record.payload.adoption.materialId !== materialId) throw new Error('该执行结果已填入其他候选，不能静默改写装配记录');
          return { ...record.payload, id: record.id };
        }
        const project = await store.getById<any>('studio_projects', record.project_id);
        if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
        const shotKey = `${record.payload.assemblyId}:${record.payload.shotId}`;
        const shot = project.spec?.shotProductions?.[shotKey] as ShotProduction | undefined;
        if (!shot || shot.locked || shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), record.payload.shotId) !== record.payload.fingerprint) throw new Error('当前分镜要求已变化或已锁定，不能采用旧候选');
        const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
        const currentPresenter = defaults?.presenters.find(item => item.id === shot.presenterId && item.authorized);
        if (!currentPresenter || Math.max(1, currentPresenter.assetVersion || 1) !== record.payload.presenterAssetVersion) throw new Error('人物或音色资产版本已变化，请重新生成并验收当前分镜');
        if (record.payload.tool === 'heygen') {
          const trust = validateHeyGenPresenterRecord(currentPresenter);
          if (!trust.ok) throw new Error(`人物或声音授权已失效，不能采用候选：${trust.reasons.join('、')}`);
        }
        const candidate = shot.candidates.find(item => item.id === candidateId && item.materialId === materialId && item.fingerprint === record.payload.fingerprint
          && (item.jobId === record.id || item.jobId === record.payload.jobId));
        if (!candidate) throw new Error('当前草稿中未找到与本次执行匹配的候选');
        const slot = (Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : []).find((item: any) => String(item.id) === record.payload.shotId);
        if (!slot?.slotId) throw new Error('当前分镜缺少装配时间轴绑定');
        const adoptedAt = new Date().toISOString(); const assemblyVersion = randomUUID();
        const nextSpec = structuredClone(project.spec || {});
        nextSpec.shotProductions = { ...(nextSpec.shotProductions || {}), [shotKey]: { ...shot, adoptedId: candidateId } };
        nextSpec.storyboardAssignments = { ...(nextSpec.storyboardAssignments || {}), [slot.slotId]: materialId };
        const adoption = { candidateId, materialId, assemblyVersion, adoptedAt, planId: record.payload.planId, fingerprint: record.payload.fingerprint,
          presenterAssetVersion: record.payload.presenterAssetVersion, qualityReviewedAt: record.payload.quality.reviewedAt,
          ...(record.payload.candidateOutput ? { ...(record.payload.candidateOutput.objectKey ? { candidateObjectKey: record.payload.candidateOutput.objectKey } : {}),
            ...(record.payload.candidateOutput.localFile ? { candidateLocalFile: record.payload.candidateOutput.localFile } : {}),
            candidateContentSha256: record.payload.candidateOutput.contentSha256,
            ...(record.payload.candidateOutput.objectEtag ? { candidateObjectEtag: record.payload.candidateOutput.objectEtag } : {}) } : {}) };
        nextSpec.digitalHumanAssemblyAdoptions = { ...(nextSpec.digitalHumanAssemblyAdoptions || {}), [shotKey]: { executionId: record.id, ...adoption } };
        if (!await store.update('studio_projects', project.id, { spec: nextSpec })) throw new Error('候选装配保存失败');
        const next: DigitalHumanExecutionRecord = { ...record.payload, id: record.id, adoption,
          routeSteps: record.payload.routeSteps ? routeStepsForExecution(record.payload.routeSteps, record.payload.state, record.payload.quality, true) : undefined,
          updatedAt: adoptedAt };
        if (!await store.update('studio_digital_human_executions', record.id, { payload: next })) throw new Error('候选已写入草稿，但执行装配记录保存失败；请刷新原任务修复，勿重新生成');
        return next;
      });
      res.json(payload);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '候选填入分镜失败' }); }
  });
  router.post('/plans/sync-agent', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const project = await store.getById<any>('studio_projects', String(req.body?.projectId || ''));
      if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
      const sourcePlans = Array.isArray(project.spec?.socialDigitalHumanPlans) ? project.spec.socialDigitalHumanPlans : [];
      const slots = Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : [];
      const assemblyId = String(project.spec?.activeAssemblyId || '');
      const records: DigitalHumanPlanRecord[] = [];
      for (const [index, source] of sourcePlans.entries()) {
        const slot = slots.find((item: any) => item.slotId === source.shotId) || slots[Number.isInteger(source.shotIndex) ? source.shotIndex : index];
        if (!slot?.id) continue;
        const shot = project.spec?.shotProductions?.[`${assemblyId}:${slot.id}`] as ShotProduction | undefined;
        if (!shot || shot.source !== 'avatar') continue;
        records.push(await persistPlan({ tenantId, project, assemblyId, shotId: String(slot.id), fingerprint: shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), String(slot.id)),
          origin: 'content_agent', sourceTaskId: String(source.sourceTaskId || ''), sourceTaskVersion: String(source.sourceTaskVersion || '') }));
      }
      res.json(records);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Content Agent 分镜方案同步失败' }); }
  });
  router.post('/defaults', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const b = req.body as ProductionDefaults;
      if (!b || !['auto', 'avatar', 'real', 'none'].includes(b.preference) || !Array.isArray(b.presenters) || b.presenters.length > 50 || b.presenters.some(item => !item || !item.id || !item.name || item.authorized !== true
        || (!((item.avatarId && item.voiceId) || (item.toolMappings?.heygen?.avatarId && item.toolMappings?.heygen?.voiceId)) && !(Array.isArray(item.referenceMaterialIds) && item.referenceMaterialIds.some(Boolean))))
        || new Set(b.presenters.map(item => item.id)).size !== b.presenters.length || (b.defaultPresenterId && !b.presenters.some(item => item.id === b.defaultPresenterId))) {
        res.status(400).json({ error: '请完整填写人物、声音ID并确认已取得使用授权' }); return;
      }
      if (options.validatePresenterMaterials) {
        const presenterMaterialIds = b.presenters.flatMap(item => [item.referenceMaterialIds,
          item.toolMappings?.seedance?.referenceMaterialIds, item.toolMappings?.sd?.referenceMaterialIds,
          item.toolMappings?.runway?.referenceMaterialIds].flatMap(ids => Array.isArray(ids) ? ids : []));
        try { await options.validatePresenterMaterials(tenantId, presenterMaterialIds); }
        catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '人物参考资产校验失败' }); return; }
      }
      const payload = await exclusive(`defaults:${tenantId}`, async () => {
        const existing = await readDefaults(tenantId); const previous = (existing?.payload as ProductionDefaults | undefined)?.presenters || [];
        const next: ProductionDefaults = { preference: b.preference, defaultPresenterId: String(b.defaultPresenterId || ''),
          defaultSound: ['voiceover', 'source', 'silent'].includes(b.defaultSound) ? b.defaultSound : 'voiceover',
          defaultLayout: ['full', 'split', 'pip'].includes(b.defaultLayout) ? b.defaultLayout : 'full', presenters: b.presenters.map(item => {
        const referenceMaterialIds = Array.isArray(item.referenceMaterialIds) ? [...new Set(item.referenceMaterialIds.map(id => String(id).trim()).filter(Boolean))].slice(0, 30) : [];
        const avatarId = String(item.toolMappings?.heygen?.avatarId || item.avatarId).slice(0, 200);
        const voiceId = String(item.toolMappings?.heygen?.voiceId || item.voiceId).slice(0, 200);
        const capabilities: PresenterCapability[] = [...(avatarId && voiceId ? ['talking' as const] : []), ...(referenceMaterialIds.length && voiceId && !avatarId ? ['talking' as const] : []), ...(referenceMaterialIds.length ? ['reference_image' as const, 'reference_video' as const, 'person_replacement' as const] : [])];
        const accountIdentity = normalizePresenterAccountIdentity(item);
        const certification = item.arkCertification && typeof item.arkCertification === 'object' ? item.arkCertification : undefined;
        const assetUri = String(certification?.assetUri || '').trim(); const assetStatus = String(certification?.status || 'ark_pending');
        if (assetUri && !/^asset:\/\/asset-[a-z0-9-]+$/i.test(assetUri)) throw new Error('方舟 Asset ID 格式无效');
        const priorPresenter = previous.find(value => value.id === String(item.id));
        const declaration = item.authorizationConfirmation?.subjectAdultConfirmed === true
          ? { ...(priorPresenter?.authorizationConfirmation || { id: randomUUID(), recordedAt: new Date().toISOString(), version: 'presenter-upload-authorization-v1', subjectAdultConfirmed: true }),
              ...(item.authorizationConfirmation.arkProcessingAuthorized === true ? { arkProcessingAuthorized: true } : {}),
              ...(item.authorizationConfirmation.heygenProcessingAuthorized === true ? { heygenProcessingAuthorized: true } : {}) } : undefined;
        // This records the user's actual declaration; provider certification remains independently required.
        let rightsEvidence = declaration?.arkProcessingAuthorized ? { ...(item.rightsEvidence || {}),
          authorizationRef: item.rightsEvidence?.authorizationRef || `document://presenter-declarations/${declaration.id}`,
          consentRef: item.rightsEvidence?.consentRef || `consent://presenter-declarations/${declaration.id}`,
          grantedAt: item.rightsEvidence?.grantedAt || declaration.recordedAt!, subjectAdultConfirmed: true,
          permittedProviders: [...new Set([...(item.rightsEvidence?.permittedProviders || []), 'volcengine_ark' as const])],
          permittedUses: [...new Set([...(item.rightsEvidence?.permittedUses || []), 'digital_presenter' as const, 'person_replacement' as const])],
        } : item.rightsEvidence;
        if (declaration?.heygenProcessingAuthorized) rightsEvidence = { ...(rightsEvidence || {}),
          authorizationRef: rightsEvidence?.authorizationRef || `document://presenter-declarations/${declaration.id}`,
          consentRef: rightsEvidence?.consentRef || `consent://presenter-declarations/${declaration.id}`,
          grantedAt: rightsEvidence?.grantedAt || declaration.recordedAt!, subjectAdultConfirmed: true,
          permittedProviders: [...new Set([...(rightsEvidence?.permittedProviders || []), 'heygen' as const])],
          permittedUses: [...new Set([...(rightsEvidence?.permittedUses || []), 'digital_presenter' as const, 'voice_synthesis' as const])],
        };
        if (assetStatus === 'active' && (!assetUri || certification?.assetType !== 'image' || !referenceMaterialIds.includes(String(certification?.materialId || '')) || !rightsEvidence?.authorizationRef || !rightsEvidence?.consentRef || rightsEvidence?.subjectAdultConfirmed !== true)) {
          throw new Error('方舟图片资产标记为 Active 前，必须绑定人物图片并补齐主体授权、同意凭证和成年人确认');
        }
        if (assetStatus === 'active' && certification?.verificationSource === 'manual_console') {
          const confirmation = certification.manualConfirmation;
          const previousCertification = priorPresenter?.arkCertification;
          const unchangedLegacyConfirmation = previousCertification?.status === 'active' && previousCertification.verificationSource === 'manual_console'
            && previousCertification.assetUri === assetUri && previousCertification.materialId === certification.materialId
            && !previousCertification.manualConfirmation;
          if (!unchangedLegacyConfirmation && (confirmation?.imageTypeConfirmed !== true || confirmation?.activeConfirmed !== true
            || confirmation?.samePersonConfirmed !== true || !Number.isFinite(Date.parse(String(confirmation?.confirmedAt || ''))))) {
            throw new Error('请确认方舟素材是图片、状态为 Active，且与当前授权人物为同一人');
          }
        }
        if (assetStatus === 'active' && !['ark_api', 'manual_console'].includes(String(certification?.verificationSource || ''))) {
          throw new Error('方舟 Active 状态必须来自只读接口或控制台人工核验');
        }
        const normalized: PresenterAsset = { id: String(item.id).slice(0, 100), name: String(item.name).slice(0, 100), avatarId, voiceId,
          ...(item.voiceAuthorization?.voiceId === voiceId && Number.isFinite(Date.parse(String(item.voiceAuthorization.recordedAt || ''))) ? { voiceAuthorization: { voiceId, recordedAt: item.voiceAuthorization.recordedAt, source: 'user_confirmation' as const } } : {}),
          authorized: item.authorized === true, supportsAlpha: item.supportsAlpha === true,
          nativeOrientation: ['portrait', 'landscape', 'square'].includes(item.nativeOrientation || '') ? item.nativeOrientation : 'unknown',
          assetVersion: 1, capabilities, referenceMaterialIds,
          ...accountIdentity,
          ...(declaration ? { authorizationConfirmation: declaration } : {}),
          ...(rightsEvidence ? { rightsEvidence: structuredClone(rightsEvidence) } : {}),
          ...(certification ? { arkCertification: { projectName: String(certification.projectName || 'default').slice(0, 100), groupId: String(certification.groupId || '').slice(0, 200), assetUri,
            assetType: certification.assetType === 'image' || certification.assetType === 'video' ? certification.assetType : '',
            status: ['profile_incomplete','authorization_pending','ark_pending','processing','active','failed','disabled'].includes(assetStatus) ? assetStatus as NonNullable<PresenterAsset['arkCertification']>['status'] : 'ark_pending',
            materialId: String(certification.materialId || '').slice(0, 200), syncedAt: certification.syncedAt ? String(certification.syncedAt) : undefined,
            failureReason: certification.failureReason ? String(certification.failureReason).slice(0, 500) : undefined,
            verificationSource: certification.verificationSource === 'ark_api' || certification.verificationSource === 'manual_console' ? certification.verificationSource : undefined,
            ...(certification.manualConfirmation ? { manualConfirmation: {
              imageTypeConfirmed: certification.manualConfirmation.imageTypeConfirmed === true,
              activeConfirmed: certification.manualConfirmation.activeConfirmed === true,
              samePersonConfirmed: certification.manualConfirmation.samePersonConfirmed === true,
              confirmedAt: String(certification.manualConfirmation.confirmedAt || ''),
            } } : {}) } } : {}),
          toolMappings: { ...(voiceId ? { heygen: { avatarId, voiceId } } : {}),
            ...(referenceMaterialIds.length ? { runway: { referenceMaterialIds }, sd: { referenceMaterialIds }, seedance: { referenceMaterialIds } } : {}) },
        };
        const old = previous.find(value => value.id === normalized.id);
        normalized.assetVersion = old ? Math.max(1, old.assetVersion || 1) + (presenterAssetFingerprint(old) === presenterAssetFingerprint(normalized) ? 0 : 1) : 1;
        return normalized;
      }) };
        const saved = existing ? await store.update('studio_production_defaults', existing.id, { payload: next }) : await store.create('studio_production_defaults', { tenant_id: tenantId, payload: next });
        if (!saved) throw new Error('storage');
        if (options.bindArkAsset) for (const presenter of next.presenters) if (presenter.arkCertification?.materialId) await options.bindArkAsset({ tenantId, presenterId: presenter.id, certification: presenter.arkCertification });
        return next;
      });
      res.json(payload);
    } catch (error) { const message = error instanceof Error ? error.message : '企业出镜设置保存失败'; res.status(message === 'storage' ? 503 : 400).json({ error: message === 'storage' ? '企业出镜设置保存失败' : message }); }
  });
  router.post('/presenters/ark-status', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string; const assetUri = String(req.body?.assetUri || '').trim();
      const match = /^asset:\/\/(asset-[a-z0-9-]+)$/i.exec(assetUri); if (!match) throw new Error('请输入有效的方舟 asset:// 图片资产 ID');
      if (!options.verifyArkAsset) { res.status(409).json({ error: '当前套餐未配置 Assets API 只读查询；请在方舟控制台确认状态为 Active 后选择“控制台人工确认”' }); return; }
      const groupId = String(req.body?.groupId || '').trim();
      if (!/^group-[a-z0-9-]+$/i.test(groupId)) throw new Error('请先关联有效的方舟人物资产组');
      const result = await options.verifyArkAsset({ tenantId, projectName: String(req.body?.projectName || 'default').trim() || 'default', groupId, assetId: match[1] });
      res.json({ ...result, assetUri, syncedAt: new Date().toISOString(), verificationSource: 'ark_api' });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '方舟资产状态查询失败' }); }
  });
  router.get('/jobs', async (req, res) => {
    try {
      const result = await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: res.locals.tenantId, project_id: String(req.query.projectId || '') }, perPage: 500 });
      res.json(result.items.filter(item => item.tenant_id === res.locals.tenantId).map(item => ({ ...item.payload, id: item.id })));
    } catch { res.status(503).json({ error: '镜头任务读取失败' }); }
  });
  const update = async (record: JobRecord, patch: Partial<AvatarJob>): Promise<AvatarJob> => {
    const payload = { ...record.payload, id: record.id, ...patch, updatedAt: new Date().toISOString() };
    if (!await store.update('studio_avatar_jobs', record.id, { payload })) throw new Error('镜头任务状态保存失败，请刷新原任务；不要重复提交');
    record.payload = payload; return payload;
  };
  const readExecution = async (jobId: string) => (await store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { job_id: jobId }, perPage: 1 })).items[0];
  const updateExecution = async (jobId: string, patch: Partial<DigitalHumanExecutionRecord>) => {
    const record = await readExecution(jobId);
    if (!record) throw new Error('数字人执行记录缺失，请勿重复提交');
    let payload = { ...record.payload, id: record.id, ...patch, updatedAt: new Date().toISOString() };
    if (payload.routeSteps) payload = { ...payload, routeSteps: routeStepsForExecution(payload.routeSteps, payload.state, payload.quality, Boolean(payload.adoption)) };
    if (!await store.update('studio_digital_human_executions', record.id, { payload })) throw new Error('数字人执行状态保存失败，请刷新原任务；不要重复提交');
    return payload;
  };
  const latestRevisionFeedback = async (tenantId: string, projectId: string, assemblyId: string, shotId: string, fingerprint: string, presenterAssetVersion: number) => {
    const result = await store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: tenantId, project_id: projectId }, perPage: 500 });
    return result.items.filter(item => item.payload.assemblyId === assemblyId && item.payload.shotId === shotId && item.payload.fingerprint === fingerprint
      && item.payload.presenterAssetVersion === presenterAssetVersion && item.payload.quality.state === 'failed' && item.payload.quality.reviewNote)
      .sort((a, b) => b.payload.updatedAt.localeCompare(a.payload.updatedAt))[0]?.payload.quality.reviewNote || null;
  };
  const submitRemote = async (record: JobRecord) => {
    try {
      if (record.input.audioRef && !record.input.audioAssetId) {
        if (!options.prepareAudio) throw new Error('统一旁白分段服务不可用');
        const prepared = await options.prepareAudio(record.input.audioRef, record.tenant_id);
        const audio = prepared instanceof Uint8Array ? prepared : prepared.bytes;
        const audioAssetId = await client().uploadAudio(audio, `${record.request_id}:audio`);
        const input = { ...record.input, audioAssetId };
        if (!await store.update('studio_avatar_jobs', record.id, { input })) throw new Error('音频资产绑定保存失败');
        record.input = input;
        if (!(prepared instanceof Uint8Array)) {
          const execution = await readExecution(record.id);
          if (!execution) throw new Error('数字人执行记录缺失，请勿重复提交');
          await updateExecution(record.id, { inputSnapshot: execution.payload.inputSnapshot ? { ...execution.payload.inputSnapshot, audioSegment: {
            segmentId: prepared.segmentId, checksumSha256: prepared.checksumSha256, start: prepared.start, duration: prepared.duration,
          } } : execution.payload.inputSnapshot });
        }
      }
      const remoteId = await client().create(record.input, record.request_id);
      const job = await update(record, { remoteId, status: 'pending', error: '' });
      await updateExecution(record.id, { externalTaskId: remoteId, submissionOutcome: 'created', state: 'pending', error: '' });
      return job;
    } catch (error) {
      const message = error instanceof Error ? error.message : '供应商提交结果待核实';
      const job = await update(record, { status: 'uncertain', error: message });
      await updateExecution(record.id, { state: 'uncertain', error: message });
      return job;
    }
  };
  const submitTalkingJob = async (tenantId: string, b: any): Promise<AvatarJob> => {
    return exclusive(`submit:${tenantId}`, async () => {
        const existing = (await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: tenantId, request_id: `${tenantId}:${b.requestId}` }, perPage: 1 })).items[0];
        if (existing) return { ...existing.payload, id: existing.id };
        const project = await store.getById<any>('studio_projects', String(b.projectId || ''));
        if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
        const pendingJobs = await store.list<JobRecord>('studio_avatar_jobs', { where: { tenant_id: tenantId, project_id: project.id }, perPage: 500 });
        if (pendingJobs.items.some(item => item.payload.assemblyId === b.assemblyId && item.payload.shotId === b.shotId && item.payload.fingerprint === b.fingerprint && ['submitting', 'pending', 'uncertain'].includes(item.payload.status))) throw new Error('该镜头已有未结束任务，请刷新原任务，不重复提交');
        const shot = project.spec?.shotProductions?.[`${b.assemblyId}:${b.shotId}`] as ShotProduction | undefined;
        const context = project.spec?.shotProductionContext;
        if (!shot) throw new Error('草稿中未找到当前镜头，请重新打开分镜');
        if (shot.source !== 'avatar') throw new Error('当前镜头尚未保存为数字人来源');
        if (shot.locked) throw new Error('当前镜头已锁定，请先解锁');
        if (shotFingerprint(shot, String(context || ''), String(b.shotId || '')) !== b.fingerprint) throw new Error('数字人参数与已保存草稿不一致，请保存后重试');
        const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
        const presenter = defaults?.presenters.find(item => item.id === shot.presenterId && item.authorized);
        if (!presenter) throw new Error('请先保存已授权的人物与声音资产');
        const presenterTrust = validateHeyGenPresenterRecord(presenter);
        if (!presenterTrust.ok) throw new Error(`HeyGen 人物、音色或授权预检未通过：${presenterTrust.reasons.join('、')}`);
        const plan = planDigitalHumanShot({ requirements: shot.digitalHuman, narration: shot.narration, hasAuthorizedPresenter: Boolean(presenter), talkingAvailable: enabled(), presenterCapabilities: presenter ? presenterCapabilities(presenter) : undefined });
        if (!plan.executable) throw new Error(plan.reasons.join('；'));
        if (shot.layout === 'pip' && !shot.transparent) throw new Error('数字人画中画需要去背景的透明人物层；请先核验透明支持，或改用全屏普通混剪');
        if (shot.digitalHuman?.presenterMode !== 'photo_talking' && b.ratio === '9:16' && !shot.transparent && presenter.nativeOrientation !== 'portrait') throw new Error('竖屏生成前须在人物资产中核验原生竖屏画幅；横屏或未知人物可能产生大面积留白，已阻止付费提交');
        if (shot.transparent && !presenter.supportsAlpha) throw new Error('该人物未确认支持透明视频，不能生成独立背景人物层');
        if (shot.backgroundMaterialId && shot.backgroundMode === 'baked') throw new Error('首版只支持独立背景合成，请改用透明人物层；不将新背景参数静默忽略');
        if (!shot.narration.trim() || shot.narration.length > 5000 || !['9:16', '16:9', '1:1'].includes(b.ratio) || b.ratio !== project.spec.ratio) throw new Error('台词或画幅无效，请先保存当前草稿');
        const now = new Date().toISOString();
        const input: HeyGenInput = { avatarId: presenter.avatarId, voiceId: presenter.voiceId, script: shot.narration, ratio: b.ratio, transparent: shot.transparent, title: `灵枢镜头 ${b.shotId}` };
        if (shot.digitalHuman?.presenterMode === 'photo_talking') {
          const photo = await resolveHeyGenPresenterPhoto(tenantId, presenter);
          input.imageAssetId = await client().uploadImage(photo.bytes, photo.mimeType, `${tenantId}:${b.requestId}:photo`);
          input.avatarId = '';
        }
        if (shot.sound === 'voiceover') {
          const language = project.spec.activeVoiceLang || project.spec.lang;
          const audio = project.spec.voiceoverAudios?.[language];
          const audioUrl = project.spec.voiceoverMode === 'ai' ? audio?.url : project.spec.voiceoverUrl;
          if (!audioUrl) throw new Error('请先生成或上传并确认统一旁白，再用其驱动数字人');
          const slots = project.spec.shootingSlots || []; const slotIndex = slots.findIndex((item: any) => item.id === b.shotId);
          if (slotIndex < 0) throw new Error('未找到镜头音频区间');
          const ranges = mapNarrationCues(slots.map((item: any) => project.spec.shotProductions?.[`${b.assemblyId}:${item.id}`]?.narration ?? narrationFromDetail(item.detail)),
            project.spec.alignedCuesByLang?.[language] || audio?.cues || [],
            project.spec.voiceoverMode === 'ai' ? audio?.duration : project.spec.voiceoverDur, audio?.alignmentSource);
          const range = ranges[slotIndex];
          if (!range) throw new Error('该镜头没有已对齐的口播，不提交数字人生成');
          if (range.end - range.start > slots[slotIndex].duration + 0.01) throw new Error('台词超过镜头时长，请先延长镜头');
          input.audioRef = { url: audioUrl, start: range.start, duration: range.end - range.start };
        }
        const payload: AvatarJob = { id: '', projectId: project.id, shotId: String(b.shotId), assemblyId: String(b.assemblyId), fingerprint: b.fingerprint, status: 'submitting', createdAt: now, updatedAt: now };
        const savedPlan = (await store.list<PlanStoreRecord>('studio_digital_human_plans', { where: { tenant_id: tenantId, project_id: project.id, shot_key: `${b.assemblyId}:${b.shotId}`, fingerprint: b.fingerprint }, perPage: 500 })).items
          .find(item => item.payload.presenterAssetVersion === Math.max(1, presenter.assetVersion || 1));
        if (!savedPlan || !savedPlan.payload.executable || savedPlan.payload.provider !== 'heygen') throw new Error('请先保存当前分镜的可执行制作方案');
        await assertAttemptAvailable({ tenantId, projectId: project.id, assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint: b.fingerprint,
          presenterAssetVersion: savedPlan.payload.presenterAssetVersion });
        await (options.reserve || (id => studioPaidBudget.reserve('heygen', id)))(`${tenantId}:${b.requestId}`);
        const record = await store.create<JobRecord>('studio_avatar_jobs', { tenant_id: tenantId, project_id: project.id, request_id: `${tenantId}:${b.requestId}`, payload, input });
        if (!record) throw new Error('任务存储不可用，未发起付费生成');
        const quality = initialDigitalHumanQuality(shot.digitalHuman, now);
        const execution: DigitalHumanExecutionRecord = { id: '', planId: savedPlan.id, jobId: record.id, projectId: project.id,
          assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint: b.fingerprint, tool: 'heygen', provider: 'heygen', model: null,
          presenterAssetVersion: savedPlan.payload.presenterAssetVersion, submissionOutcome: 'unknown', inputSnapshot: savedPlan.payload.inputSnapshot ? { ...savedPlan.payload.inputSnapshot,
            revisionFeedback: await latestRevisionFeedback(tenantId, project.id, String(b.assemblyId), String(b.shotId), b.fingerprint, savedPlan.payload.presenterAssetVersion) } : undefined,
          state: 'submitting', externalTaskId: null, materialId: null,
          estimatedCostCny: savedPlan.payload.estimatedCostCny, actualCostCny: null, costStatus: 'estimated', costSourceRef: null, error: '',
          quality, routeSteps: routeStepsForExecution(savedPlan.payload.routeSteps || digitalHumanRouteSteps('talking', 'heygen', true), 'submitting', quality), createdAt: now, updatedAt: now };
        const executionRecord = await store.create<ExecutionStoreRecord>('studio_digital_human_executions', { tenant_id: tenantId, project_id: project.id, job_id: record.id, plan_id: savedPlan.id, payload: execution });
        if (!executionRecord) {
          await store.delete('studio_avatar_jobs', record.id).catch(() => false);
          throw new Error('执行记录存储不可用，未发起付费生成');
        }
        return submitRemote(record);
      });
  };
  router.post('/jobs', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const b = req.body || {};
      if (!enabled()) { res.status(503).json({ error: '数字人服务尚未配置或启用' }); return; }
      if (b.confirmed !== true || !/^[A-Za-z0-9_:.-]{1,150}$/.test(String(b.requestId || ''))) { res.status(400).json({ error: '请确认本镜头生成及供应商计费，并提供有效请求标识' }); return; }
      const job = await submitTalkingJob(tenantId, b);
      res.json(job);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '生成提交失败' }); }
  });
  router.post('/batch-shot-jobs', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const projectId = String(req.body?.projectId || '');
      const batchId = String(req.body?.batchId || '');
      if (req.body?.confirmed !== true || !/^[A-Za-z0-9_:.-]{1,100}$/.test(batchId))
        throw new Error('请确认批量生成及供应商计费，并提供稳定批次标识');
      const project = await store.getById<any>('studio_projects', projectId);
      if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
      const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
      const authorizedPresenters = (defaults?.presenters ?? []).filter(item => validateHeyGenPresenterRecord(item).ok);
      const salesPresenter = uniqueAuthorizedSalesPresenter(authorizedPresenters);
      let routes = planStudioBatchShotRoutes(project.spec ?? {}, {
        talkingExecutorReady: enabled() && studioPaidBudget.status('heygen').allowed,
        actionExecutorReady: executableReferenceAdapters().length > 0,
        authorizedPresenterIds: authorizedPresenters.map(item => item.id),
        defaultSalesPresenterId: salesPresenter?.id ?? null,
      });
      if (req.body.slotIds !== undefined) {
        if (!Array.isArray(req.body.slotIds) || !req.body.slotIds.length || req.body.slotIds.length > 100 || req.body.slotIds.some((id: unknown) => typeof id !== 'string')) throw new Error('请选择有效的分镜');
        const selected = new Set<string>(req.body.slotIds);
        if ([...selected].some(id => !routes.some(route => route.slotId === id))) throw new Error('所选分镜不属于当前草稿');
        routes = routes.filter(route => selected.has(route.slotId));
      }
      if (!routes.length || routes.length > 100) throw new Error('批量分镜数量必须为 1–100');
      const assemblyId = String(project.spec?.activeAssemblyId || '');
      const identities = new Map<string, string>();
      for (const slot of project.spec?.shootingSlots || []) {
        const sourcePerson = String(slot.personContinuityId || '').trim();
        if (!sourcePerson) continue;
        const route = routes.find(item => item.shotId === slot.id);
        if (!route || route.route === 'local_material') continue;
        const target = project.spec?.shotProductions?.[`${assemblyId}:${slot.id}`]?.presenterId;
        if (!target) continue;
        if (identities.has(sourcePerson) && identities.get(sourcePerson) !== target) throw new Error(`同一原片人物 ${sourcePerson} 选择了不同企业数字人，请在工作面板统一人物后再批量制作`);
        identities.set(sourcePerson, target);
      }
      const results: Array<{ shotId: string; slotId: string; state: 'submitted' | 'matched' | 'needs_material' | 'blocked'; jobId: string | null; reason: string }> = [];
      for (const route of routes) {
        if (route.route === 'local_material') {
          results.push({ shotId: route.shotId, slotId: route.slotId,
            state: route.status === 'matched' ? 'matched' : 'needs_material', jobId: null, reason: route.reason });
          continue;
        }
        if (route.route === 'aigc_first_frame') {
          results.push({ shotId: route.shotId, slotId: route.slotId,
            state: 'blocked', jobId: null, reason: route.reason });
          continue;
        }
        const configuredShot = project.spec?.shotProductions?.[`${assemblyId}:${route.shotId}`] as ShotProduction | undefined;
        if (configuredShot?.digitalHuman?.contentConfirmed && configuredShot.digitalHuman.method === 'reenact' && route.visualTopic === 'presenter') {
          try {
            if (configuredShot.locked) throw new Error('镜头已锁定，请先解锁');
            const fingerprint = shotFingerprint(configuredShot, String(project.spec?.shotProductionContext || ''), route.shotId);
            const requestId = batchShotRequestId({ projectId, batchId, assemblyId, shotId: route.shotId, fingerprint });
            const generated = await submitSentenceReplication(tenantId, { projectId, assemblyId, shotId: route.shotId, fingerprint, requestId });
            results.push({ shotId: route.shotId, slotId: route.slotId, state: 'submitted', jobId: generated.sentenceJobId || null, reason: '场景重建候选已生成，等待逐镜验收' });
          } catch (error) {
            results.push({ shotId: route.shotId, slotId: route.slotId, state: 'blocked', jobId: null, reason: error instanceof Error ? error.message : '场景重建失败' });
          }
          continue;
        }
        if (route.route !== 'digital_human' || route.status === 'blocked') {
          results.push({ shotId: route.shotId, slotId: route.slotId, state: 'blocked', jobId: null, reason: route.reason });
          continue;
        }
        let shot = project.spec?.shotProductions?.[`${assemblyId}:${route.shotId}`] as ShotProduction | undefined;
        if (!shot || shot.locked) {
          results.push({ shotId: route.shotId, slotId: route.slotId, state: 'blocked', jobId: null,
            reason: '人物口播镜头不存在或已锁定，未提交供应商' });
          continue;
        }
        if (!shot.presenterId) {
          results.push({ shotId: route.shotId, slotId: route.slotId, state: 'blocked', jobId: null,
            reason: '企业出镜设置中没有唯一且已授权的“销售”人物资产' });
          continue;
        }
        const fingerprint = shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), route.shotId);
        try {
          const plan = await persistPlan({ tenantId, project, assemblyId, shotId: route.shotId, fingerprint });
          if (!plan.executable || plan.provider !== 'heygen') throw new Error(plan.reasons.join('；') || '数字人口播执行器尚未就绪');
          // The single-shot submitter owns reservation, persisted execution,
          // supplier idempotency, and uncertain-outcome handling. Batch mode
          // only supplies a stable per-shot request ID; it never skips checks.
          const requestId = batchShotRequestId({ projectId, batchId, assemblyId, shotId: route.shotId, fingerprint });
          const job = await submitTalkingJob(tenantId, { projectId, assemblyId, shotId: route.shotId,
            fingerprint, ratio: project.spec?.ratio, requestId });
          results.push({ shotId: route.shotId, slotId: route.slotId, state: 'submitted', jobId: job.id,
            reason: job.status === 'uncertain' ? '供应商提交结果待核实；请刷新原任务，勿重复提交' : `供应商任务状态：${job.status}` });
        } catch (error) {
          results.push({ shotId: route.shotId, slotId: route.slotId, state: 'blocked', jobId: null,
            reason: error instanceof Error ? error.message : '本镜提交失败' });
        }
      }
      res.json({ projectId, batchId, results, counts: {
        submitted: results.filter(item => item.state === 'submitted').length,
        matched: results.filter(item => item.state === 'matched').length,
        needsMaterial: results.filter(item => item.state === 'needs_material').length,
        blocked: results.filter(item => item.state === 'blocked').length,
      } });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '批量分镜生成失败' }); }
  });
  router.post('/jobs/:id/refresh', async (req, res) => {
    try {
      const job = await exclusive(`job:${req.params.id}`, async () => {
        const record = await store.getById<JobRecord>('studio_avatar_jobs', req.params.id);
        if (!record || record.tenant_id !== res.locals.tenantId) throw new Error('镜头任务不存在');
        if (record.payload.status === 'completed' || record.payload.status === 'failed') return { ...record.payload, id: record.id };
        if (!record.payload.remoteId) {
          throw new Error('提交结果未知：刷新不会再次付费生成。请管理员核对供应商任务和账单；不要创建新请求重试');
        }
        const remote = await client().status(record.payload.remoteId);
        if (remote.status === 'completed') {
          try {
            const imported = await importVideo(remote.url!, remote.duration!, { ...record.payload, id: record.id }, record.input, record.tenant_id);
            const materialId = typeof imported === 'string' ? imported : imported.materialId;
            const candidateOutput = typeof imported === 'string' ? undefined : candidateOutputFromImport(imported);
            if (!candidateOutput) throw new Error('新候选缺少可复核的存储引用、内容 SHA-256 或对象版本，不能进入人工验收');
            const job = await update(record, { status: 'completed', materialId, error: '' });
            const execution = await readExecution(record.id);
            if (!execution) throw new Error('数字人执行记录缺失，请勿重复提交');
            await updateExecution(record.id, { state: 'completed', materialId, ...(candidateOutput ? { candidateOutput } : {}), costStatus: 'awaiting_invoice', error: '',
              quality: recordDigitalHumanMediaCheck(execution.payload.quality, { passed: true, evidence: `material:${materialId}` }) });
            return job;
          } catch (error) {
            const message = `供应商已生成，但下载或技术检查未通过：${error instanceof Error ? error.message : '导入失败'}。刷新仅复查原任务，不重新生成。`;
            const job = await update(record, { status: 'pending', error: message });
            const execution = await readExecution(record.id);
            if (!execution) throw new Error('数字人执行记录缺失，请勿重复提交');
            await updateExecution(record.id, { state: 'pending', error: message,
              quality: recordDigitalHumanMediaCheck(execution.payload.quality, { passed: false, evidence: message }) });
            return job;
          }
        }
        const job = await update(record, { status: remote.status, error: remote.error || '' });
        await updateExecution(record.id, { state: remote.status, error: remote.error || '' });
        return job;
      });
      res.json(job);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '镜头状态刷新失败' }); }
  });

  router.post('/reference-jobs', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string; const b = req.body || {};
      if (b.confirmed !== true || !/^[A-Za-z0-9_:.-]{1,150}$/.test(String(b.requestId || ''))) throw new Error('请确认本镜头生成及供应商计费，并提供有效请求标识');
      const execution = await exclusive(`reference-submit:${tenantId}`, async () => {
        const requestId = `${tenantId}:${b.requestId}`;
        const existing = (await store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: tenantId, request_id: requestId }, perPage: 1 })).items[0];
        if (existing) return { ...existing.payload, id: existing.id };
        const project = await store.getById<any>('studio_projects', String(b.projectId || ''));
        if (!project || project.tenant_id !== tenantId || project.status !== 'draft') throw new Error('创作草稿不存在或不可编辑');
        const shot = project.spec?.shotProductions?.[`${b.assemblyId}:${b.shotId}`] as ShotProduction | undefined;
        if (!shot || shot.source !== 'avatar' || shot.locked) throw new Error('当前数字人分镜不存在或已锁定');
        if (shotFingerprint(shot, String(project.spec?.shotProductionContext || ''), String(b.shotId || '')) !== b.fingerprint) throw new Error('数字人参数与已保存草稿不一致，请保存后重试');
        if (!shot.digitalHuman || shot.digitalHuman.method === 'talking') throw new Error('人物口播请使用口播生成任务');
        const defaults = (await readDefaults(tenantId))?.payload as ProductionDefaults | undefined;
        const presenter = defaults?.presenters.find(item => item.id === shot.presenterId && item.authorized);
        if (!presenter || !presenterCapabilities(presenter).some(value => ['reference_image', 'reference_video', 'person_replacement'].includes(value))) throw new Error('请先保存已授权的人物参考资产');
        const savedPlan = (await store.list<PlanStoreRecord>('studio_digital_human_plans', { where: { tenant_id: tenantId, project_id: project.id, shot_key: `${b.assemblyId}:${b.shotId}`, fingerprint: b.fingerprint }, perPage: 500 })).items
          .find(item => item.payload.presenterAssetVersion === Math.max(1, presenter.assetVersion || 1));
        if (!savedPlan?.payload.executable || !savedPlan.payload.provider || savedPlan.payload.provider === 'heygen') throw new Error('请先保存当前分镜的可执行参考人物制作方案');
        if (shot.digitalHuman.method === 'replace' && (!savedPlan.payload.inputSnapshot?.derivativeAuthorization?.evidence || !savedPlan.payload.inputSnapshot.derivativeAuthorization.confirmedAt)) {
          throw new Error('当前人物替换方案缺少服务端固化的源视频派生授权依据，请重新确认并保存方案');
        }
        if (usesDirectReferenceVideo(shot.digitalHuman) && (!savedPlan.payload.inputSnapshot?.modelInputAuthorization?.evidence || !savedPlan.payload.inputSnapshot.modelInputAuthorization.confirmedAt)) {
          throw new Error('当前参考人物方案缺少服务端固化的源视频模型输入授权依据，不能提交给生成供应商');
        }
        if (!usesDirectReferenceVideo(shot.digitalHuman)) throw new Error('逐句首帧重建必须由分句编排器执行，不能把整段爆款原片提交给参考视频适配器');
        const existingExecutions = await store.list<ExecutionStoreRecord>('studio_digital_human_executions', { where: { tenant_id: tenantId, project_id: project.id }, perPage: 500 });
        if (existingExecutions.items.some(item => item.payload.assemblyId === String(b.assemblyId) && item.payload.shotId === String(b.shotId)
          && item.payload.fingerprint === b.fingerprint && item.payload.presenterAssetVersion === savedPlan.payload.presenterAssetVersion
          && ['submitting', 'pending', 'uncertain'].includes(item.payload.state))) {
          throw new Error('该镜头已有未结束的参考人物任务，请刷新或取消原任务，不重复提交');
        }
        await assertAttemptAvailable({ tenantId, projectId: project.id, assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint: b.fingerprint,
          presenterAssetVersion: savedPlan.payload.presenterAssetVersion });
        const slot = (Array.isArray(project.spec?.shootingSlots) ? project.spec.shootingSlots : []).find((item: any) => String(item.id) === String(b.shotId));
        const selection = selectReferenceAdapter({ adapters: executableReferenceAdapters(), candidates: candidateToolsFor(shot.digitalHuman), method: shot.digitalHuman.method,
          targetDurationSeconds: Number(slot?.duration) || null,
          maxEstimatedCostCny: referenceBudgetLimitCny(),
          requiredPreservation: requiredReferencePreservation({ preserve: shot.digitalHuman.preserve, productMaterialId: shot.productMaterialId, backgroundMaterialId: shot.backgroundMaterialId }) });
        const adapter = selection.adapter;
        if (!adapter || adapter.id !== savedPlan.payload.provider) throw new Error(selection.reason || '制作方案对应的参考人物执行适配器当前不可用或能力已变化，请重新保存方案');
        const resolvedInputs = await options.resolveReferenceInputs!({ shot, presenter, tenantId });
        const ratio = ({ '9:16': '720:1280', '16:9': '1280:720', '1:1': '960:960' } as const)[String(project.spec?.ratio || '') as '9:16' | '16:9' | '1:1'];
        if (!ratio) throw new Error('当前画幅不受参考人物适配器支持');
        await options.reserveReference!(adapter.id, requestId, selection.estimatedCostCny);
        const now = new Date().toISOString(); const jobId = `reference:${randomUUID()}`;
        const revisionFeedback = await latestRevisionFeedback(tenantId, project.id, String(b.assemblyId), String(b.shotId), b.fingerprint, savedPlan.payload.presenterAssetVersion);
        const quality = initialDigitalHumanQuality(shot.digitalHuman, now);
        const payload: DigitalHumanExecutionRecord = { id: '', planId: savedPlan.id, jobId, projectId: project.id,
          assemblyId: String(b.assemblyId), shotId: String(b.shotId), fingerprint: b.fingerprint, tool: adapter.id, provider: adapter.id, model: null,
          presenterAssetVersion: savedPlan.payload.presenterAssetVersion, submissionOutcome: 'unknown', inputSnapshot: savedPlan.payload.inputSnapshot ? { ...savedPlan.payload.inputSnapshot, revisionFeedback,
            ...(resolvedInputs.characterMaterialId && resolvedInputs.characterObjectKey ? { presenterInput: {
              materialId: resolvedInputs.characterMaterialId, objectKey: resolvedInputs.characterObjectKey, type: resolvedInputs.characterType, objectEtag: resolvedInputs.characterObjectEtag,
            } } : {}),
            ...(resolvedInputs.referenceClipKey && resolvedInputs.referenceMaterialId && resolvedInputs.referenceStart != null && resolvedInputs.referenceDuration != null ? { referenceInput: {
              materialId: resolvedInputs.referenceMaterialId, clipObjectKey: resolvedInputs.referenceClipKey, start: resolvedInputs.referenceStart, duration: resolvedInputs.referenceDuration,
              sourceObjectEtag: resolvedInputs.referenceSourceObjectEtag, clipObjectEtag: resolvedInputs.referenceClipObjectEtag,
            } } : {}) } : undefined,
          state: 'submitting', externalTaskId: null, materialId: null,
          estimatedCostCny: savedPlan.payload.estimatedCostCny, actualCostCny: null, costStatus: 'estimated', costSourceRef: null, error: '',
          quality, routeSteps: routeStepsForExecution(savedPlan.payload.routeSteps || digitalHumanRouteSteps(shot.digitalHuman.method, adapter.id, true), 'submitting', quality), createdAt: now, updatedAt: now };
        let record: ExecutionStoreRecord | null;
        try {
          record = await store.create<ExecutionStoreRecord>('studio_digital_human_executions', { tenant_id: tenantId, project_id: project.id, job_id: jobId, plan_id: savedPlan.id, request_id: requestId, payload });
          if (!record) throw new Error('执行记录存储不可用，未发起供应商生成');
        } catch (error) {
          const releaseError = await releaseReferenceReservation(adapter.id, requestId);
          const message = error instanceof Error ? error.message : '执行记录存储不可用，未发起供应商生成';
          throw new Error(releaseError ? `${message}；${releaseError}` : message);
        }
        try {
          const submitted = await adapter.submit({ projectId: project.id, assemblyId: b.assemblyId, shotId: b.shotId, shot, presenter, revisionFeedback, ...resolvedInputs,
          ratio, targetDurationSeconds: Number(slot?.duration) || null, bodyControl: true, expressionIntensity: 3 }, requestId);
          const next = { ...payload, id: record.id, externalTaskId: submitted.externalTaskId, submissionOutcome: 'created' as const, state: 'pending' as const,
            routeSteps: payload.routeSteps ? routeStepsForExecution(payload.routeSteps, 'pending', payload.quality) : undefined, updatedAt: new Date().toISOString() };
          if (!await store.update('studio_digital_human_executions', record.id, { payload: next })) throw new Error('供应商任务已提交但状态保存失败，请核对原任务');
          return next;
        } catch (error) {
          const definitive = isDefinitiveSupplierSubmissionError(error);
          const releaseError = definitive ? await releaseReferenceReservation(adapter.id, requestId) : '';
          const state = definitive ? 'failed' as const : 'uncertain' as const;
          const baseError = error instanceof Error ? error.message : '供应商提交结果待核实';
          const next = { ...payload, id: record.id, state, submissionOutcome: definitive ? 'rejected' as const : 'unknown' as const, error: releaseError ? `${baseError}；${releaseError}` : baseError,
            routeSteps: payload.routeSteps ? routeStepsForExecution(payload.routeSteps, state, payload.quality) : undefined, updatedAt: new Date().toISOString() };
          if (!await store.update('studio_digital_human_executions', record.id, { payload: next })) throw new Error('供应商提交结果无法写入执行记录，请核对原任务与预算账本');
          return next;
        }
      });
      res.json(execution);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '参考人物生成提交失败' }); }
  });

  router.post('/reference-jobs/:id/refresh', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const result = await exclusive(`reference-refresh:${req.params.id}`, async () => {
        const record = await store.getById<ExecutionStoreRecord>('studio_digital_human_executions', req.params.id);
        if (!record || record.tenant_id !== tenantId || record.payload.tool === 'heygen') throw new Error('参考人物执行记录不存在');
        if (['completed', 'failed'].includes(record.payload.state)) return { ...record.payload, id: record.id };
        if (!record.payload.externalTaskId) throw new Error('提交结果未知：刷新不会再次生成，请核对供应商任务和账单');
        const adapter = (options.adapters || []).find(item => item.id === record.payload.tool);
        if (!adapter) throw new Error('原执行适配器当前不可用，不能查询任务状态');
        let remote: Awaited<ReturnType<DigitalHumanExecutionAdapter['status']>>;
        try {
          remote = await adapter.status(record.payload.externalTaskId);
        } catch (error) {
          const message = `供应商状态查询失败：${error instanceof Error ? error.message : '未知错误'}。可稍后重查原任务，系统不会重新提交生成。`;
          const payload = { ...record.payload, id: record.id, error: message, updatedAt: new Date().toISOString() };
          if (!await store.update('studio_digital_human_executions', record.id, { payload })) throw new Error('供应商状态查询失败且执行记录更新失败');
          throw new Error(message);
        }
        let payload: DigitalHumanExecutionRecord = { ...record.payload, id: record.id, state: remote.state, error: remote.error || '', updatedAt: new Date().toISOString() };
        const supplierCost = verifiedSupplierCost(remote);
        if (supplierCost) payload = { ...payload, ...supplierCost, costStatus: 'reconciled' };
        if (remote.state === 'completed') {
          if ((!remote.outputUrl || !options.importReferenceVideo) && (!remote.outputObjectKey || !options.importReferenceObject)) throw new Error('供应商已完成，但参考视频导入服务不可用');
          try {
            const snapshot = payload.inputSnapshot;
            const requiresVersionCheck = Boolean(snapshot?.presenterInput?.objectEtag || snapshot?.referenceInput?.clipObjectEtag);
            if (requiresVersionCheck && (!snapshot || !options.verifyReferenceInputs || !await options.verifyReferenceInputs(snapshot, tenantId))) {
              throw new Error('当次人物或精确参考片段对象版本已变化，不能使用当前对象完成历史任务质检');
            }
            const imported = remote.outputObjectKey
              ? await options.importReferenceObject!(remote.outputObjectKey, payload, tenantId)
              : await options.importReferenceVideo!(remote.outputUrl!, payload, tenantId);
            let quality = recordDigitalHumanMediaCheck(payload.quality, { passed: true, evidence: `material:${imported.materialId}` });
            if (imported.technicalMetrics) quality = recordReferenceTechnicalChecks(quality, imported.technicalMetrics);
            if (imported.visualMetrics) quality = recordReferenceVisualChecks(quality, imported.visualMetrics);
            else quality = deferUnavailableVisualChecksToManual(quality);
            if (options.inspectReferenceQuality) {
              const referenceInput = payload.inputSnapshot?.referenceInput;
              const presenterInput = payload.inputSnapshot?.presenterInput;
              if (!referenceInput?.clipObjectKey || !referenceInput.materialId) throw new Error('模型质检缺少精确原片证据');
              if (!presenterInput?.materialId || !presenterInput.objectKey) throw new Error('身份质检缺少本次实际采用的企业人物资产证据');
              quality = recordModelQualityChecks(quality, await options.inspectReferenceQuality({
                referenceClipObjectKey: referenceInput.clipObjectKey,
                referenceMaterialId: referenceInput.materialId,
                presenterReferenceMaterialIds: [presenterInput.materialId],
                candidateMaterialId: imported.materialId,
                candidateVideoUrl: remote.outputUrl || '',
                execution: payload,
                tenantId,
              }));
            }
            const candidateOutput = candidateOutputFromImport(imported);
            if (!candidateOutput) throw new Error('新候选缺少可复核的存储引用、内容 SHA-256 或对象版本，不能进入人工验收');
            payload = { ...payload, materialId: imported.materialId, ...(candidateOutput ? { candidateOutput } : {}), costStatus: payload.costStatus === 'reconciled' ? 'reconciled' : 'awaiting_invoice', quality };
          } catch (error) {
            const message = `供应商已生成，但下载或技术检查未通过：${error instanceof Error ? error.message : '导入失败'}。刷新仅复查原任务，不重新生成。`;
            payload = { ...payload, state: 'pending', error: message, quality: recordDigitalHumanMediaCheck(payload.quality, { passed: false, evidence: message }) };
          }
        }
        if (payload.routeSteps) payload = { ...payload, routeSteps: routeStepsForExecution(payload.routeSteps, payload.state, payload.quality) };
        if (!await store.update('studio_digital_human_executions', record.id, { payload })) throw new Error('参考人物执行状态保存失败');
        return payload;
      });
      res.json(result);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '参考人物任务刷新失败' }); }
  });
  router.post('/reference-jobs/:id/cancel', async (req, res) => {
    try {
      const tenantId = res.locals.tenantId as string;
      const payload = await exclusive(`reference-cancel:${req.params.id}`, async () => {
        const record = await store.getById<ExecutionStoreRecord>('studio_digital_human_executions', req.params.id);
        if (!record || record.tenant_id !== tenantId || record.payload.tool === 'heygen') throw new Error('参考人物执行记录不存在');
        if (record.payload.state === 'cancelled') return { ...record.payload, id: record.id };
        if (!['submitting', 'pending'].includes(record.payload.state) || !record.payload.externalTaskId) throw new Error('当前任务不能取消；提交结果未知或任务已结束时请核对供应商状态');
        const adapter = (options.adapters || []).find(item => item.id === record.payload.tool);
        if (!adapter?.cancel) throw new Error('当前执行工具未提供可核验的取消能力，不能只在本地标记取消');
        const cancelled = await adapter.cancel(record.payload.externalTaskId);
        if (!cancelled.cancelled) throw new Error(cancelled.reason || '供应商未确认取消，任务状态保持不变');
        const next: DigitalHumanExecutionRecord = { ...record.payload, id: record.id, state: 'cancelled', error: cancelled.reason || '',
          routeSteps: record.payload.routeSteps ? routeStepsForExecution(record.payload.routeSteps, 'cancelled', record.payload.quality) : undefined, updatedAt: new Date().toISOString() };
        if (!await store.update('studio_digital_human_executions', record.id, { payload: next })) throw new Error('取消结果保存失败，请核对供应商原任务');
        return next;
      });
      res.json(payload);
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '参考人物任务取消失败' }); }
  });
  return router;
}
