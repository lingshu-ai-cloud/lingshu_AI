import { videoSuccessVisibilityPatch } from './videoAnalysisSuccessPatch.js';
import { queuedMaterialFailureRequiresSourceFallback, videoAnalysisRetryQueuePatch, type VideoAnalysisRetryQueueKind } from './videoAnalysisRecovery.js';
import fs from 'fs';
import { createHash, randomUUID } from 'node:crypto';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform, VideoAiAnalysis, VideoStatus } from '../types/index.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { getCloudMaterialRecord } from '../lib/cloudMaterials.js';
import { canPromoteExistingAnalysisToExact, exactVideoClassificationQualityError, exactVideoReviewReasons } from '../lib/videoAnalysisCodec.js';
import { benchmarkAnalysisForRecord } from '../lib/benchmarkAnalysis.js';
import { productionReferenceAdmission } from '../../shared/productionReferenceAdmission.js';
import { reconcileStoredOpeningHookMotionEvidence } from './hookMotionEvidence.js';
import { humanSize, parseJsonRecord } from './videoCrawlerNormalization.js';
import { COL, analysisRunsInWorkerProcess } from '../videos/runtimeConfig.js';
import type { Material } from '../videos/contracts.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoAnalysisControlRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'resolveCrawlerOpsTasksForRecord' | 'activeAnalysisRequest' | 'resetCrawlerOpsTaskForExplicitRetry' | 'queueAnalyzeSource' | 'startQueuedLocalAnalysis' | 'loadMaterials' | 'canRepairStoredExactClassification' | 'localReferenceVideoPath'>) {
  const videosRouter = deps.videosRouter;
  const resolveCrawlerOpsTasksForRecord: VideoApplicationPorts['resolveCrawlerOpsTasksForRecord'] = (...args) => deps.resolveCrawlerOpsTasksForRecord(...args);
  const activeAnalysisRequest: VideoApplicationPorts['activeAnalysisRequest'] = (...args) => deps.activeAnalysisRequest(...args);
  const resetCrawlerOpsTaskForExplicitRetry: VideoApplicationPorts['resetCrawlerOpsTaskForExplicitRetry'] = (...args) => deps.resetCrawlerOpsTaskForExplicitRetry(...args);
  const queueAnalyzeSource: VideoApplicationPorts['queueAnalyzeSource'] = (...args) => deps.queueAnalyzeSource(...args);
  const startQueuedLocalAnalysis: VideoApplicationPorts['startQueuedLocalAnalysis'] = (...args) => deps.startQueuedLocalAnalysis(...args);
  const loadMaterials: VideoApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const canRepairStoredExactClassification: VideoApplicationPorts['canRepairStoredExactClassification'] = (...args) => deps.canRepairStoredExactClassification(...args);
  const localReferenceVideoPath: VideoApplicationPorts['localReferenceVideoPath'] = (...args) => deps.localReferenceVideoPath(...args);

  const analysisQueueMutations = new Set<string>();

  function registerPostIdAnalysisPause() {
    videosRouter.post('/:id/analysis-pause', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
        res.status(404).json({ error: 'Video record not found' });
        return;
      }
      const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const geminiStatus = String(previous.geminiStatus || '');
      const downloadStatus = String(previous.downloadStatus || '');
      const videoFetchStatus = String(previous.videoFetchStatus || '');
      const activeStatuses = new Set([
        'queued', 'analyzing', 'waiting_for_video', 'downloading', 'download_retrying',
        'analysis_retryable', 'ops_queued', 'ops_processing',
      ]);
      const isRunning = Boolean(previous.requestedAnalysisMode)
        || activeStatuses.has(geminiStatus)
        || activeStatuses.has(downloadStatus)
        || activeStatuses.has(videoFetchStatus);
      if (!isRunning) {
        res.status(409).json({ error: '当前视频不在分析中' });
        return;
      }
      const pausedAt = new Date().toISOString();
      // Rotating the run id makes every in-flight completion stale. Expensive
      // provider calls may finish remotely, but their result can no longer
      // overwrite this durable paused state.
      await store.update(COL, req.params.id, {
        status: previous.gemini || previous.analysisQuality ? 'analyzed' as VideoStatus : 'failed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          analysisRunId: randomUUID(),
          requestedAnalysisMode: undefined,
          analysisQueueState: 'paused',
          analysisStage: 'paused',
          analysisStageUpdatedAt: pausedAt,
          geminiStatus: 'paused',
          downloadStatus: activeStatuses.has(downloadStatus) ? 'paused' : previous.downloadStatus,
          videoFetchStatus: activeStatuses.has(videoFetchStatus) ? 'paused' : previous.videoFetchStatus,
          analysisPausedAt: pausedAt,
          analysisPausedBy: userId,
          analysisError: undefined,
        }),
      });
      resolveCrawlerOpsTasksForRecord(req.params.id, 'paused_by_user');
      res.json({ ok: true, id: req.params.id, status: 'paused', pausedAt });
    });
  }

  function registerPostIdAnalysisCancel() {
    videosRouter.post('/:id/analysis-cancel', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
        res.status(404).json({ error: 'Video record not found' });
        return;
      }
      const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      if (!activeAnalysisRequest(previous) && !['paused', 'queued', 'running'].includes(String(previous.analysisQueueState || ''))) {
        res.status(409).json({ error: '当前视频没有可取消的分析任务' });
        return;
      }
      const cancelledAt = new Date().toISOString();
      await store.update(COL, req.params.id, {
        status: previous.gemini || previous.analysisQuality === 'video' ? 'analyzed' as VideoStatus : 'failed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          analysisRunId: randomUUID(),
          requestedAnalysisMode: undefined,
          analysisQueueState: 'cancelled',
          analysisStage: 'cancelled',
          analysisStageUpdatedAt: cancelledAt,
          geminiStatus: 'cancelled',
          downloadStatus: previous.downloadStatus === 'analyzed' ? 'analyzed' : 'cancelled',
          videoFetchStatus: previous.videoFetchStatus === 'fetched' ? 'fetched' : 'cancelled',
          analysisCancelledAt: cancelledAt,
          analysisCancelledBy: userId,
          analysisPausedAt: undefined,
          analysisPausedBy: undefined,
          analysisError: undefined,
        }),
      });
      resolveCrawlerOpsTasksForRecord(req.params.id, 'cancelled_by_user');
      res.json({ ok: true, id: req.params.id, status: 'cancelled', cancelledAt });
    });
  }

  function registerPostIdAnalysisResume() {
    videosRouter.post('/:id/analysis-resume', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
        res.status(404).json({ error: 'Video record not found' });
        return;
      }
      const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const mutationKey = `${String(record.tenantId || tenantId)}:record:${req.params.id}`;
      if (analysisQueueMutations.has(mutationKey) || activeAnalysisRequest(previous)) {
        res.status(202).json({ status: 'pending', analysisRunId: previous.analysisRunId, deduplicated: true });
        return;
      }
      analysisQueueMutations.add(mutationKey);
      res.once('finish', () => analysisQueueMutations.delete(mutationKey));
      const fileId = String(record.videoFileId || '');
      const sourceUrl = String(record.sourceUrl || '').trim();
      const materialId = String(previous.materialId || '').trim();
      if (!fileId && !materialId && !/^https?:\/\//i.test(sourceUrl)) {
        res.status(400).json({ error: '没有可恢复的源视频或素材' });
        return;
      }
      const analysisMode = req.body?.analysisMode === 'strategy'
        ? 'strategy'
        : String(previous.analysisRunMode || previous.analysisMode) === 'strategy' ? 'strategy' : 'exact';
      const analysisRunId = randomUUID();
      const queuedAt = new Date().toISOString();
      const missingMaterial = queuedMaterialFailureRequiresSourceFallback(previous);
      const analysisQueueKind: VideoAnalysisRetryQueueKind = fileId
        ? 'stored_video'
        : materialId && !missingMaterial ? 'material'
          : 'source_url';
      if (analysisQueueKind === 'source_url' && !/^https?:\/\//i.test(sourceUrl)) {
        res.status(409).json({ error: '原素材已不存在，请重新上传可读的原视频后再分析' });
        return;
      }
      resetCrawlerOpsTaskForExplicitRetry({
        recordId: req.params.id,
        tenantId: String(record.tenantId || tenantId),
        userId,
        usesSourceQueue: analysisQueueKind === 'source_url',
        now: queuedAt,
      });
      const nextAnalysis = {
        ...videoAnalysisRetryQueuePatch(previous, {
          analysisMode, analysisRunId, queueKind: analysisQueueKind, queuedAt, userId,
        }),
        analysisResumedAt: queuedAt,
        analysisResumedBy: userId,
      };
      const queuedRecord = { ...record, status: 'pending' as VideoStatus, aiAnalysis: JSON.stringify(nextAnalysis) };
      await store.update(COL, req.params.id, { status: 'pending' as VideoStatus, aiAnalysis: queuedRecord.aiAnalysis });
      if (analysisQueueKind === 'source_url') await queueAnalyzeSource(queuedRecord);
      else if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(req.params.id);
      res.status(202).json({ status: 'pending', analysisRunId, resumed: true });
    });
  }

  function registerPostMaterialExactAnalysis() {
    videosRouter.post('/material-exact-analysis', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const materialId = String(req.body?.materialId || '').trim();
      const rawMaterialId = materialId.replace(/^pb-/, '');
      const title = String(req.body?.title || '置顶素材').trim().slice(0, 200);
      const platform = (['tiktok', 'instagram', 'youtube', 'facebook'].includes(String(req.body?.platform))
        ? req.body.platform : 'tiktok') as Platform;
      const duration = Math.max(0, Number(req.body?.duration || 0));
      if (!materialId) { res.status(400).json({ error: 'materialId is required' }); return; }
      const mutationKey = `${tenantId}:material:${materialId}`;
      if (analysisQueueMutations.has(mutationKey)) {
        res.status(202).json({ status: 'pending', deduplicated: true });
        return;
      }
      analysisQueueMutations.add(mutationKey);
      res.once('finish', () => analysisQueueMutations.delete(mutationKey));

      let material: Material | null = null;
      let cloudRecord: Record<string, unknown> | null = null;
      if (materialId.startsWith('pb-')) {
        cloudRecord = await getCloudMaterialRecord(rawMaterialId, tenantId);
        const scope = String(cloudRecord?.scope || 'own');
        if (!cloudRecord) {
          res.status(404).json({ error: 'Material not found' });
          return;
        }
        material = {
          id: materialId,
          name: String(cloudRecord.title || cloudRecord.sourceName || title),
          folder: String(cloudRecord.folder || 'upload'),
          type: 'video',
          duration: Number(cloudRecord.duration || duration),
          size: humanSize(Number(cloudRecord.sizeBytes || 0)),
          file: String(cloudRecord.videoFile || ''),
          url: `/api/overseas/studio/materials/pb/${rawMaterialId}/media`,
          poster: `/api/overseas/studio/materials/pb/${rawMaterialId}/poster`,
          scope: scope === 'shared' ? 'shared' : 'own',
          tenantId: String(cloudRecord.tenantId || cloudRecord.tenant_id || ''),
          createdAt: String(cloudRecord.created || new Date().toISOString()),
        };
      } else {
        material = loadMaterials().find(item => item.id === materialId
          && (item.scope === 'shared' || item.tenantId === tenantId)) || null;
        if (!material) { res.status(404).json({ error: 'Material not found' }); return; }
      }
      if (material.type !== 'video') { res.status(400).json({ error: 'Only video materials can be analyzed' }); return; }

      const existingPage = await store.list<Record<string, unknown>>(COL, { where: { tenantId }, page: 1, perPage: 500 });
      const existing = existingPage.items.find(item => {
        const analysis = parseJsonRecord<Record<string, unknown>>(item.aiAnalysis, {});
        return String(analysis.materialId || '') === materialId;
      });
      const existingAnalysis = existing ? parseJsonRecord<Record<string, unknown>>(existing.aiAnalysis, {}) : {};
      if (existing && activeAnalysisRequest(existingAnalysis, 'exact')) {
        res.status(202).json({
          status: 'pending',
          id: String(existing.id),
          analysisRunId: existingAnalysis.analysisRunId,
          deduplicated: true,
        });
        return;
      }
      if (existing && productionReferenceAdmission(benchmarkAnalysisForRecord(existing, existingAnalysis)).ready) {
        res.json({
          status: 'analyzed',
          id: String(existing.id),
          analysisRunId: existingAnalysis.analysisRunId,
          reused: true,
        });
        return;
      }
      const analysisRunId = randomUUID();
      const queuedAt = new Date().toISOString();
      const queueAnalysis = {
        ...(existing ? parseJsonRecord<Record<string, unknown>>(existing.aiAnalysis, {}) : {}),
        materialId,
        materialUrl: material.url,
        materialPoster: material.poster,
        analysisSource: 'studio-material-exact',
        analysisRunId,
        analysisRunMode: 'exact',
        requestedAnalysisMode: 'exact',
        analysisMode: 'strategy',
        analysisQuality: 'segment_grounded',
        geminiStatus: 'queued',
        downloadStatus: 'analyzing',
        videoFetchStatus: 'fetched',
        analysisQueuedAt: queuedAt,
        reanalyzeQueuedAt: queuedAt,
        analysisQueueKind: 'material',
        analysisQueueState: 'queued',
        analysisStage: 'queued',
        analysisStageUpdatedAt: queuedAt,
        analysisError: undefined,
        videoLevelFailureStatus: undefined,
        userVisible: true,
      };
      let record: Record<string, unknown> | null = existing || null;
      if (existing) {
        await store.update(COL, String(existing.id), { status: 'pending' as VideoStatus, aiAnalysis: JSON.stringify(queueAnalysis) });
      } else {
        record = await store.create(COL, {
          tenantId,
          contentFormat: 'video',
          platform,
          title: title || material.name,
          thumbnailUrl: material.poster || '',
          videoFileId: '',
          duration: material.duration || duration,
          sourceUrl: '',
          tags: JSON.stringify(['置顶素材', '全片精确分析']),
          aiAnalysis: JSON.stringify(queueAnalysis),
          status: 'pending' as VideoStatus,
          crawledAt: queuedAt,
        });
      }
      const recordId = String(record?.id || existing?.id || '');
      if (!recordId) { res.status(500).json({ error: 'Failed to create analysis task' }); return; }

      if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(recordId);

      res.status(202).json({ status: 'pending', id: recordId, analysisRunId, queuedAt });
    });
  }

  function registerPatchIdReanalyze() {
    videosRouter.patch('/:id/reanalyze', async (req, res) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const record = await store.getById(COL, req.params.id);

      if (!record) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (record.tenantId !== tenantId && !await requireAdminUser(req)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const analysisMode = req.body?.analysisMode === 'exact' ? 'exact' : 'strategy';
      const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const mutationKey = `${String(record.tenantId || tenantId)}:record:${req.params.id}`;
      if (analysisQueueMutations.has(mutationKey) || (req.body?.force !== true && activeAnalysisRequest(previous, analysisMode))) {
        res.status(202).json({
          status: 'pending',
          analysisRunId: previous.analysisRunId,
          deduplicated: true,
        });
        return;
      }
      analysisQueueMutations.add(mutationKey);
      res.once('finish', () => analysisQueueMutations.delete(mutationKey));
      const analysisRunId = randomUUID();
      const fileId = record.videoFileId as string | undefined;
      const recordTenantId = String(record.tenantId || tenantId);
      if (analysisMode === 'exact'
        && req.body?.force !== true
        && canRepairStoredExactClassification(record, previous)) {
        const queuedAt = new Date().toISOString();
        resetCrawlerOpsTaskForExplicitRetry({ recordId: req.params.id, tenantId: recordTenantId, userId, usesSourceQueue: false, now: queuedAt });
        await store.update(COL, req.params.id, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify(videoAnalysisRetryQueuePatch(previous, {
            analysisMode, analysisRunId, queueKind: 'classification_repair', queuedAt, userId,
          })),
        });
        if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(req.params.id);
        res.status(202).json({ status: 'pending', analysisRunId, repair: 'classification_only' });
        return;
      }
      if (analysisMode === 'exact'
        && req.body?.force !== true
        && Boolean(fileId)
        && ['video', 'video_review_required'].includes(String(previous.analysisQuality || ''))
        && canPromoteExistingAnalysisToExact(previous.gemini, Number(record.duration || 0))
        && !exactVideoClassificationQualityError(previous.gemini as VideoAiAnalysis)
        && !exactVideoReviewReasons(previous.gemini as VideoAiAnalysis, Number(record.duration || 0)).length) {
        const localReference = localReferenceVideoPath(String(fileId), String(record.tenantId || tenantId));
        const sourceSha256 = localReference && fs.existsSync(localReference)
          ? createHash('sha256').update(fs.readFileSync(localReference)).digest('hex') : '';
        const promotedGemini = reconcileStoredOpeningHookMotionEvidence(previous.gemini as VideoAiAnalysis);
        resetCrawlerOpsTaskForExplicitRetry({ recordId: req.params.id, tenantId: recordTenantId, userId, usesSourceQueue: false });
        await store.update(COL, req.params.id, {
          status: 'analyzed',
          aiAnalysis: JSON.stringify({
            ...previous,
            gemini: promotedGemini,
            ...(sourceSha256 ? { contentSha256: sourceSha256 } : {}),
            durationSeconds: Number(record.duration || 0),
            ...videoSuccessVisibilityPatch(),
            analysisMode: 'exact',
            analysisQuality: 'video',
            requestedAnalysisMode: undefined,
            geminiStatus: 'analyzed',
            downloadStatus: 'analyzed',
            videoFetchStatus: 'fetched',
            videoStorage: previous.videoObjectKey ? 'cos' : (previous.videoStorage || 'pocketbase'),
            videoLevelFailureStatus: undefined,
            manualRequiredReason: undefined,
            analysisError: undefined,
            analysisQueueState: 'completed',
            analysisStage: 'completed',
            analysisReviewReasons: (Array.isArray(previous.analysisReviewReasons) ? previous.analysisReviewReasons : [])
              .filter(reason => reason !== 'opening_hook_observation_uncertainty'),
            downloadError: undefined,
            analysisPausedAt: undefined,
            analysisPausedBy: undefined,
            exactPromotedFromExisting: true,
            exactAnalyzedAt: new Date().toISOString(),
          }),
        });
        res.json({ status: 'analyzed', reused: true });
        return;
      }
      if (!fileId) {
        const sourceUrl = String(record.sourceUrl || '').trim();
        const materialUnavailable = queuedMaterialFailureRequiresSourceFallback(previous);
        if (previous.materialId && !materialUnavailable) {
          const retryResetAt = new Date().toISOString();
          await store.update(COL, req.params.id, {
            status: 'pending' as VideoStatus,
            aiAnalysis: JSON.stringify(videoAnalysisRetryQueuePatch(previous, {
              analysisMode, analysisRunId, queueKind: 'material', queuedAt: retryResetAt, userId,
            })),
          });
          if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(req.params.id);
          res.status(202).json({ status: 'pending', analysisRunId });
          return;
        }
        if (!/^https?:\/\//i.test(sourceUrl)) {
          res.status(materialUnavailable ? 409 : 400).json({ error: materialUnavailable
              ? '原素材已不存在，请重新上传可读的原视频后再分析'
              : 'No video file or public sourceUrl attached to this record' });
          return;
        }
        const retryResetAt = new Date().toISOString();
        resetCrawlerOpsTaskForExplicitRetry({ recordId: req.params.id, tenantId: recordTenantId, userId, usesSourceQueue: true, now: retryResetAt });
        const queuedRecord = { ...record, status: 'pending' as VideoStatus, aiAnalysis: JSON.stringify(videoAnalysisRetryQueuePatch(previous, {
            analysisMode, analysisRunId, queueKind: 'source_url', queuedAt: retryResetAt, userId,
          })) };
        await store.update(COL, req.params.id, { aiAnalysis: queuedRecord.aiAnalysis });
        await queueAnalyzeSource(queuedRecord);
        res.json({ status: 'pending', analysisRunId });
        return;
      }

      const retryResetAt = new Date().toISOString();
      resetCrawlerOpsTaskForExplicitRetry({ recordId: req.params.id, tenantId: recordTenantId, userId, usesSourceQueue: false, now: retryResetAt });
      await store.update(COL, req.params.id, {
        status: 'pending',
        aiAnalysis: JSON.stringify(videoAnalysisRetryQueuePatch(previous, {
          analysisMode, analysisRunId, queueKind: 'stored_video', queuedAt: retryResetAt, userId,
        })),
      });
      if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(req.params.id);

      res.status(202).json({ status: 'pending', analysisRunId });
    });
  }

  return { registerPostIdAnalysisPause, registerPostIdAnalysisCancel, registerPostIdAnalysisResume, registerPostMaterialExactAnalysis, registerPatchIdReanalyze };
}
