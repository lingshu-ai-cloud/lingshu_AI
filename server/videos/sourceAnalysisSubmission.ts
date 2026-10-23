import { videoLevelSuccessPatch } from '../routes/videoAnalysisSuccessPatch.js';
import { compactVideoPipelineError, queuedVideoAnalysisFailurePatch } from '../routes/videoAnalysisRecovery.js';
import { type CrawlerOpsTask } from '../routes/videoCrawlerOpsTaskState.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import { fetchFile } from '../storage/files.js';
import { objectStorageDownload } from '../storage/objectStorage.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { updateVideoAdminAlertByRecordId } from '../lib/videoAdminAlerts.js';
import { hasCompletedExactVideoEvidence, videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { benchmarkAnalysisForRecord } from '../lib/benchmarkAnalysis.js';
import { productionReferenceAdmission } from '../../shared/productionReferenceAdmission.js';
import { inferPlatformFromUrl, mimeFromPath, parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { sourceAnalysisQueueFailurePatch, sourceAnalysisQueueReceiptPatch } from '../lib/videoAnalysisProgress.js';
import { COL, ANALYSIS_DIR, analysisRunsInWorkerProcess } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createSourceAnalysisSubmission(deps: Pick<VideoApplicationPorts, 'localReferenceVideoPath' | 'analyzeDownloadedVideoWithFallback' | 'persistExactShotEvidence' | 'cleanupTempVideo' | 'exactSourceClockDuration' | 'enqueueCrawlerOpsTask' | 'updateCrawlerOpsTask' | 'analyzeSourceVideoJob' | 'startQueuedLocalAnalysis' | 'shouldQueueVideoAnalysis'>) {
  const localReferenceVideoPath: VideoApplicationPorts['localReferenceVideoPath'] = (...args) => deps.localReferenceVideoPath(...args);
  const analyzeDownloadedVideoWithFallback: VideoApplicationPorts['analyzeDownloadedVideoWithFallback'] = (...args) => deps.analyzeDownloadedVideoWithFallback(...args);
  const persistExactShotEvidence: VideoApplicationPorts['persistExactShotEvidence'] = (...args) => deps.persistExactShotEvidence(...args);
  const cleanupTempVideo: VideoApplicationPorts['cleanupTempVideo'] = (...args) => deps.cleanupTempVideo(...args);
  const exactSourceClockDuration: VideoApplicationPorts['exactSourceClockDuration'] = (...args) => deps.exactSourceClockDuration(...args);
  const enqueueCrawlerOpsTask: VideoApplicationPorts['enqueueCrawlerOpsTask'] = (...args) => deps.enqueueCrawlerOpsTask(...args);
  const updateCrawlerOpsTask: VideoApplicationPorts['updateCrawlerOpsTask'] = (...args) => deps.updateCrawlerOpsTask(...args);
  const analyzeSourceVideoJob: VideoApplicationPorts['analyzeSourceVideoJob'] = (...args) => deps.analyzeSourceVideoJob(...args);
  const startQueuedLocalAnalysis: VideoApplicationPorts['startQueuedLocalAnalysis'] = (...args) => deps.startQueuedLocalAnalysis(...args);
  const shouldQueueVideoAnalysis: VideoApplicationPorts['shouldQueueVideoAnalysis'] = (...args) => deps.shouldQueueVideoAnalysis(...args);

  async function triggerVideoAnalysis(
    recordId: string,
    filename: string | undefined,
    mimeType: string | undefined,
    _userId: string,
    expectedRunId?: string,
  ): Promise<void> {
    if (!filename) {
      await store.update(COL, recordId, { status: 'failed' });
      return;
    }

    let tempPath = '';
    let runId = expectedRunId || '';
    try {
      const record = await store.getById<Record<string, unknown>>(COL, recordId);
      const previousRecordAnalysis = parseJsonRecord<Record<string, unknown>>(record?.aiAnalysis, {});
      if (expectedRunId && String(previousRecordAnalysis.analysisRunId || '') !== expectedRunId) {
        console.warn(`[videos] stale queued analysis skipped for ${recordId}: ${expectedRunId}`);
        return;
      }
      const localReference = localReferenceVideoPath(filename, String(record?.tenantId || ''));
      let dl = localReference && fs.existsSync(localReference)
        ? { buf: fs.readFileSync(localReference), contentType: 'video/mp4' }
        : previousRecordAnalysis.videoObjectKey
          ? await objectStorageDownload(String(previousRecordAnalysis.videoObjectKey))
          : await fetchFile(COL, recordId, filename);
      // COS/S3-compatible storage can briefly return an empty/not-found response
      // while HEAD succeeds (gateway propagation or a transient upstream miss).
      // Retry the same immutable object key twice before surfacing a real failure.
      if (!dl && previousRecordAnalysis.videoObjectKey) {
        for (const delayMs of [500, 1500]) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
          dl = await objectStorageDownload(String(previousRecordAnalysis.videoObjectKey));
          if (dl) break;
        }
      }
      if (!dl) throw new Error('video file fetch failed');

      const latestBeforeStart = await store.getById<Record<string, unknown>>(COL, recordId);
      const latestBeforeStartAnalysis = parseJsonRecord<Record<string, unknown>>(latestBeforeStart?.aiAnalysis, {});
      if (expectedRunId && String(latestBeforeStartAnalysis.analysisRunId || '') !== expectedRunId) {
        console.warn(`[videos] stale fetched analysis skipped for ${recordId}: ${expectedRunId}`);
        return;
      }

      if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
      tempPath = path.join(ANALYSIS_DIR, `upload-${recordId}-${Date.now()}.${mimeFromPath(filename).split('/').pop() || 'mp4'}`);
      fs.writeFileSync(tempPath, dl.buf);
      const previous = latestBeforeStartAnalysis;
      runId = runId || String(previous.analysisRunId || randomUUID());
      const modelStartedAt = new Date().toISOString();
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          manualVideoUploadStatus: 'analyzing',
          downloadStatus: 'uploaded',
          videoFetchStatus: 'manual_upload',
          geminiStatus: 'analyzing',
          analysisSource: 'gemini-upload-video',
          geminiStartedAt: modelStartedAt,
          analysisStage: 'analyzing',
          analysisStageUpdatedAt: modelStartedAt,
          analysisRunId: runId,
          analysisRunMode: previous.requestedAnalysisMode === 'strategy' ? 'strategy' : 'exact',
        }),
      });
      updateVideoAdminAlertByRecordId(recordId, {
        statusLabel: '已上传/分析中',
        manualUploadStatus: 'analyzing',
        error: '缺失视频已补充，Gemini 视频级分析处理中。',
      });
      const result = await analyzeDownloadedVideoWithFallback({
        filePath: tempPath,
        mimeType: mimeType ?? dl.contentType,
        title: String(record?.title || ''),
        platform: record?.platform as Platform | undefined,
        duration: Number(record?.duration || 0),
        tags: parseJsonRecord<string[]>(record?.tags, []),
        sourceLabel: 'gemini-upload-video',
        videoId: recordId,
        tenantId: String(record?.tenantId || ''),
        analysisMode: previous.requestedAnalysisMode === 'strategy' ? 'strategy' : 'exact',
        analysisRunId: runId,
        videoObjectKey: String(previous.videoObjectKey || record?.videoFileId || ''),
      });
      if (previous.requestedAnalysisMode !== 'strategy') {
        const evidenceStartedAt = new Date().toISOString();
        const beforeEvidence = await store.getById<Record<string, unknown>>(COL, recordId);
        const beforeEvidenceAnalysis = parseJsonRecord<Record<string, unknown>>(beforeEvidence?.aiAnalysis, {});
        await store.update(COL, recordId, {
          aiAnalysis: JSON.stringify({
            ...beforeEvidenceAnalysis,
            analysisStage: 'extracting_evidence',
            analysisStageUpdatedAt: evidenceStartedAt,
            analysisEvidenceStartedAt: evidenceStartedAt,
          }),
        });
        result.analysis = await persistExactShotEvidence(recordId, tempPath, result.analysis);
      }
      cleanupTempVideo(tempPath);
      tempPath = '';
      const latest = await store.getById<Record<string, unknown>>(COL, recordId);
      const latestAnalysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? record?.aiAnalysis, {});
      if (String(latestAnalysis.analysisRunId || '') !== runId) {
        console.warn(`[videos] stale analysis success ignored for ${recordId}: ${runId}`);
        return;
      }

      const measuredDuration = exactSourceClockDuration(result.analysis, runId);
      await store.update(COL, recordId, {
        aiAnalysis: JSON.stringify({
          ...latestAnalysis,
          ...videoLevelSuccessPatch({
            analysis: result.analysis,
            source: result.source,
            videoFetchStatus: 'manual_upload',
            extra: { manualVideoUploadStatus: 'analyzed', analysisMode: previous.requestedAnalysisMode === 'strategy' ? 'strategy' : 'exact', requestedAnalysisMode: undefined },
          }),
        }),
        status: 'analyzed',
        ...(measuredDuration ? { duration: measuredDuration } : {}),
      });
      updateVideoAdminAlertByRecordId(recordId, {
        statusLabel: '已上传/分析完成',
        manualUploadStatus: 'analyzed',
        error: '补充视频已完成 Gemini 视频级分析，已可进入灵感大屏展示。',
      });
      console.log(`[videos] analyzed ${recordId}`);
    } catch (e) {
      console.error(`[videos] analysis failed for ${recordId}:`, e);
      if (tempPath) cleanupTempVideo(tempPath);
      const record = await store.getById<Record<string, unknown>>(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(record?.aiAnalysis, {});
      if (runId && String(previous.analysisRunId || '') !== runId) {
        console.warn(`[videos] stale analysis failure ignored for ${recordId}: ${runId}`);
        return;
      }
      const compactError = compactVideoPipelineError(e instanceof Error ? e.message : e);
      const failedAt = new Date().toISOString();
      await store.update(COL, recordId, {
        status: 'analyzed' as VideoStatus,
        aiAnalysis: JSON.stringify(queuedVideoAnalysisFailurePatch(previous, compactError, failedAt)),
      });
      updateVideoAdminAlertByRecordId(recordId, {
        statusLabel: '上传后分析失败',
        manualUploadStatus: 'failed',
        error: compactError,
      });
    }
  }

  async function queueAnalyzeSource(
    record: Record<string, unknown>,
    job?: { record: Record<string, unknown> | null; sourceUrl: string; title: string; platform: Platform },
  ): Promise<void> {
    const remoteUrl = String(job?.sourceUrl || record.sourceUrl || '').trim();
    const platform = (job?.platform || record.platform || inferPlatformFromUrl(remoteUrl)) as Platform;
    const analysis = parseJsonRecord(record.aiAnalysis, {});
    const queuedAt = new Date().toISOString();
    const queuedRecord = await store.update(COL, String(record.id), {
      status: 'pending' as VideoStatus,
      aiAnalysis: JSON.stringify({
        ...analysis,
        downloadStatus: 'queued',
        videoFetchStatus: 'queued',
        geminiStatus: 'waiting_for_video',
        analysisSource: 'gemini-temp-video',
        analysisError: undefined,
        downloadError: undefined,
        analysisQueueKind: 'source_url',
        analysisQueueState: 'queued',
        analysisQueuedAt: queuedAt,
        analysisStage: 'queued',
        analysisStageUpdatedAt: queuedAt,
      }),
    });
    if (!queuedRecord) throw new Error('source_analysis_queue_marker_persist_failed');
    let opsTask: CrawlerOpsTask | null = null;
    try {
      opsTask = enqueueCrawlerOpsTask({
        recordId: String(record.id),
        tenantId: String(record.tenantId || '').trim() || undefined,
        platform,
        sourceUrl: remoteUrl,
        title: String(job?.title || record.title || `${platform}-video`),
        reason: 'analysis_requested',
        forceQueue: true,
      });
      const acceptedAt = new Date().toISOString();
      const latest = await store.getById<Record<string, unknown>>(COL, String(record.id));
      const latestAnalysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis, analysis);
      const receiptRecord = await store.update(COL, String(record.id), {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...latestAnalysis,
          ...sourceAnalysisQueueReceiptPatch(opsTask, acceptedAt),
        }),
      });
      if (!receiptRecord) throw new Error('source_analysis_queue_receipt_persist_failed');
    } catch (error) {
      const failedAt = new Date().toISOString();
      const compactError = compactVideoPipelineError(error instanceof Error ? error.message : error);
      if (opsTask?.id) {
        updateCrawlerOpsTask(opsTask.id, { status: 'failed', reason: 'analysis_queue_receipt_failed', lastError: compactError, updatedAt: failedAt });
      }
      try {
        const latest = await store.getById<Record<string, unknown>>(COL, String(record.id));
        const latestAnalysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis, analysis);
        const failureRecord = await store.update(COL, String(record.id), {
          status: latestAnalysis.gemini || latestAnalysis.analysisQuality === 'video' ? 'analyzed' as VideoStatus : 'failed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...latestAnalysis,
            ...sourceAnalysisQueueFailurePatch(compactError || 'crawler_ops_enqueue_failed', failedAt),
          }),
        });
        if (!failureRecord) throw new Error('source_analysis_queue_failure_persist_failed');
      } catch (persistError) {
        console.error('[videos] failed to persist source analysis queue failure:', persistError);
      }
      throw error;
    }
    if (analysisRunsInWorkerProcess()) return;
    void analyzeSourceVideoJob(job || {
      record,
      sourceUrl: remoteUrl,
      title: String(record.title || `${platform}-video`),
      platform,
    }).catch((e) => {
      console.warn('[videos] async analyze-source failed:', e instanceof Error ? e.message : e);
    });
  }

  async function queueExactSourceAnalysisForTenant(input: {
    tenantId: string;
    recordId: string;
  }): Promise<'already_ready' | 'queued'> {
    const record = await store.getById<Record<string, unknown>>(COL, input.recordId);
    if (!record || String(record.tenantId || '') !== input.tenantId) throw new Error('Trend video not found');
    const previous = videoAnalysisOf(record);
    const admission = hasCompletedExactVideoEvidence(previous)
      ? productionReferenceAdmission(benchmarkAnalysisForRecord(record, previous))
      : null;
    if (admission?.ready) {
      // An earlier queue attempt could mark a local:// upload as
      // waiting_for_video before failing public-URL validation. Restore the
      // completed exact evidence in place; keep its run id and source hash so
      // existing Director review and verified speech remain version-bound.
      if (String(record.sourceUrl || '').startsWith('local://')
        && (previous.requestedAnalysisMode === 'exact'
          || ['queued', 'waiting_for_video', 'analyzing'].includes(String(previous.geminiStatus || '')))) {
        await store.update(COL, input.recordId, {
          status: 'analyzed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...previous,
            requestedAnalysisMode: undefined,
            geminiStatus: previous.analysisQuality === 'video_review_required' ? 'needs_review' : 'analyzed',
            analysisError: undefined,
            downloadError: undefined,
          }),
        });
      }
      return 'already_ready';
    }
    if (String(previous.requestedAnalysisMode) === 'exact'
      && ['queued', 'waiting_for_video', 'analyzing'].includes(String(previous.geminiStatus || ''))
      && !(previous.geminiStatus === 'waiting_for_video' && previous.analysisError)) {
      return 'queued';
    }
    const analysisRunId = randomUUID();
    const nextAnalysis = {
      ...previous,
      requestedAnalysisMode: 'exact',
      analysisRunId,
      analysisRunMode: 'exact',
      geminiStatus: 'queued',
      analysisQueuedAt: new Date().toISOString(),
      analysisError: undefined,
    };
    await store.update(COL, input.recordId, {
      status: 'pending' as VideoStatus,
      aiAnalysis: JSON.stringify(nextAnalysis),
    });
    if (record.videoFileId) {
      if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(input.recordId);
    } else {
      await queueAnalyzeSource({ ...record, aiAnalysis: JSON.stringify(nextAnalysis) });
    }
    return 'queued';
  }

  async function enqueueCrawledRecordsForAnalysis(records: unknown[]): Promise<void> {
    for (const raw of records) {
      const record = raw as Record<string, unknown>;
      const id = String(record.id || '');
      if (!id) continue;
      const latest = await store.getById(COL, id);
      if (!latest || !shouldQueueVideoAnalysis(latest)) continue;
      await queueAnalyzeSource(latest);
    }
  }

  return { triggerVideoAnalysis, queueAnalyzeSource, queueExactSourceAnalysisForTenant, enqueueCrawledRecordsForAnalysis };
}
