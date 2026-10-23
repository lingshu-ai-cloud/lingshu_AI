import { softDownloadFailure, isNonRetryableVideoFetch } from '../routes/videoCrawlerPublicProjection.js';
import { metadataFallbackAnalysis } from '../routes/videoCrawlerMetadataFallback.js';
import { videoLevelSuccessPatch } from '../routes/videoAnalysisSuccessPatch.js';
import { compactVideoPipelineError } from '../routes/videoAnalysisRecovery.js';
import { classifyCrawlerFailure } from '../routes/videoCrawlerOpsTaskState.js';
import { classifyDiscoverySourceFailure } from '../socialDiscovery/sourceFailure.js';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import { analyzeYouTubeUrl } from '../agents/gemini.js';
import type { Platform, VideoAiAnalysis, VideoStatus } from '../types/index.js';
import { recordVideoAdminAlert } from '../lib/videoAdminAlerts.js';
import { validatePublicVideoSourceUrl } from '../lib/publicVideoSourceSecurity.js';
import { isVideoLevelAnalysis } from '../lib/videoAnalysisCodec.js';
import { humanSize, parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { COL } from './runtimeConfig.js';
import type { VideoApplicationPorts, SourceAnalysisAdapters } from './applicationPorts.js';

export function createSourceAnalysisExecution(deps: Pick<VideoApplicationPorts, 'withDownloadSlot' | 'activeAnalysisRecords' | 'durableAnalysisRecords' | 'shouldUseQwenFirst' | 'downloadVideoForAnalysis' | 'compressPocketBasePreview' | 'uploadCrawlerCosObject' | 'analyzeDownloadedVideoWithFallback' | 'persistExactShotEvidence' | 'exactSourceClockDuration' | 'isTikTokUnusableWithoutVideoFallback' | 'updateCrawlerOpsTask' | 'enqueueCrawlerOpsTask' | 'pushCrawlerOpsTask' | 'isRetryableAnalysisFailure' | 'cleanupTempVideo' | 'scheduleTestTenantVideoBackfill'>) {
  function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> { return deps.withDownloadSlot<T>(fn); }
  const activeAnalysisRecords = deps.activeAnalysisRecords;
  const durableAnalysisRecords = deps.durableAnalysisRecords;
  const shouldUseQwenFirst: VideoApplicationPorts['shouldUseQwenFirst'] = (...args) => deps.shouldUseQwenFirst(...args);
  const downloadVideoForAnalysis: VideoApplicationPorts['downloadVideoForAnalysis'] = (...args) => deps.downloadVideoForAnalysis(...args);
  const compressPocketBasePreview: VideoApplicationPorts['compressPocketBasePreview'] = (...args) => deps.compressPocketBasePreview(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);
  const analyzeDownloadedVideoWithFallback: VideoApplicationPorts['analyzeDownloadedVideoWithFallback'] = (...args) => deps.analyzeDownloadedVideoWithFallback(...args);
  const persistExactShotEvidence: VideoApplicationPorts['persistExactShotEvidence'] = (...args) => deps.persistExactShotEvidence(...args);
  const exactSourceClockDuration: VideoApplicationPorts['exactSourceClockDuration'] = (...args) => deps.exactSourceClockDuration(...args);
  const isTikTokUnusableWithoutVideoFallback: VideoApplicationPorts['isTikTokUnusableWithoutVideoFallback'] = (...args) => deps.isTikTokUnusableWithoutVideoFallback(...args);
  const updateCrawlerOpsTask: VideoApplicationPorts['updateCrawlerOpsTask'] = (...args) => deps.updateCrawlerOpsTask(...args);
  const enqueueCrawlerOpsTask: VideoApplicationPorts['enqueueCrawlerOpsTask'] = (...args) => deps.enqueueCrawlerOpsTask(...args);
  const pushCrawlerOpsTask: VideoApplicationPorts['pushCrawlerOpsTask'] = (...args) => deps.pushCrawlerOpsTask(...args);
  const isRetryableAnalysisFailure: VideoApplicationPorts['isRetryableAnalysisFailure'] = (...args) => deps.isRetryableAnalysisFailure(...args);
  const cleanupTempVideo: VideoApplicationPorts['cleanupTempVideo'] = (...args) => deps.cleanupTempVideo(...args);
  const scheduleTestTenantVideoBackfill: VideoApplicationPorts['scheduleTestTenantVideoBackfill'] = (...args) => deps.scheduleTestTenantVideoBackfill(...args);

  async function analyzeSourceVideoJob(input: {
    record: Record<string, unknown> | null;
    sourceUrl: string;
    title: string;
    platform: Platform;
    opsTaskId?: string;
    suppressOpsRequeue?: boolean;
    skipYoutubeUrlAnalysis?: boolean;
    suppressVisibleBackfill?: boolean;
    forceManualFailure?: boolean;
  }, adapters: SourceAnalysisAdapters = {}): Promise<unknown> {
    const source = validatePublicVideoSourceUrl(input.sourceUrl, input.platform);
    if (!source) throw new Error('unsafe_public_video_source');
    input = { ...input, ...source };
    const key = String(input.record?.id || '');
    const execute = () => withDownloadSlot(() => analyzeSourceVideoJobInner(input, adapters));
    return key ? activeAnalysisRecords.run(key, () => (adapters.lease || durableAnalysisRecords).run(key, execute)) : execute();
  }

  async function analyzeSourceVideoJobInner(input: {
    record: Record<string, unknown> | null;
    sourceUrl: string;
    title: string;
    platform: Platform;
    opsTaskId?: string;
    suppressOpsRequeue?: boolean;
    skipYoutubeUrlAnalysis?: boolean;
    suppressVisibleBackfill?: boolean;
    forceManualFailure?: boolean;
  }, adapters: SourceAnalysisAdapters = {}): Promise<unknown> {
    const recordId = input.record?.id ? String(input.record.id) : '';
    const inputAnalysis = parseJsonRecord<Record<string, unknown>>(input.record?.aiAnalysis, {});
    const requestedMode = inputAnalysis.requestedAnalysisMode;
    // A crawled video is useful to the director only after full-timeline shot
    // analysis. Keep the lighter mode solely for explicitly requested strategy
    // jobs; ordinary ingestion goes straight to the detailed pipeline.
    const analysisMode = requestedMode === 'strategy' ? 'strategy' : 'exact';
    const analysisRunId = String(inputAnalysis.analysisRunId || randomUUID());
    const stillOwnsRun = async (): Promise<boolean> => {
      if (!recordId) return true;
      const latest = await store.getById(COL, recordId);
      const latestAnalysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis, {});
      return !latestAnalysis.analysisRunId || String(latestAnalysis.analysisRunId) === analysisRunId;
    };
    let tempPath = '';
    try {
      if (!await stillOwnsRun()) return null;
      if (analysisMode !== 'exact' && input.platform === 'youtube' && !input.skipYoutubeUrlAnalysis && (input.forceManualFailure || !shouldUseQwenFirst())) {
        const direct = await tryAnalyzeYouTubeUrl(input, analysisRunId);
        if (!await stillOwnsRun()) return null;
        if (direct) return direct;
        if (input.forceManualFailure) {
          return persistMetadataFallbackAnalysis(input, 'youtube_url_failed', {
            downloadStatus: 'metadata_only',
            videoFetchStatus: 'url_failed',
            geminiStatus: 'metadata_fallback',
            crawlerOpsStatus: 'skipped',
          });
        }
        if (!youtubeDownloadFallbackSyncEnabled()) {
          if (youtubeDownloadFallbackEnabled()) scheduleYouTubeDownloadFallback(input);
          return persistMetadataFallbackAnalysis(input, 'youtube_url_failed', {
            downloadStatus: youtubeDownloadFallbackEnabled() ? 'download_retrying' : 'metadata_only',
            videoFetchStatus: youtubeDownloadFallbackEnabled() ? 'download_retrying' : 'url_failed',
            geminiStatus: 'metadata_fallback',
            crawlerOpsStatus: youtubeDownloadFallbackEnabled() ? 'background_downloading' : 'skipped',
          });
        }
      }

      if (recordId) {
        const latest = await store.getById(COL, recordId);
        const analysis: Record<string, unknown> = parseJsonRecord(latest?.aiAnalysis ?? input.record?.aiAnalysis, {} as Record<string, unknown>);
        if (analysis.analysisRunId && String(analysis.analysisRunId) !== analysisRunId) {
          console.warn(`[videos] stale source analysis skipped for ${recordId}: ${analysisRunId}`);
          return analysis.gemini || null;
        }
        const downloadStartedAt = new Date().toISOString();
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            downloadStatus: 'downloading',
            videoFetchStatus: 'downloading',
            geminiStatus: 'waiting_for_video',
            analysisSource: 'gemini-temp-video',
            downloadStartedAt,
            analysisStage: 'downloading',
            analysisStageUpdatedAt: downloadStartedAt,
            analysisRunId,
            analysisRunMode: analysisMode,
          }),
        });
      }

      const downloaded = await (adapters.download || downloadVideoForAnalysis)(input);
      tempPath = downloaded.filePath;
      // Precise analysis previously deleted its temporary file without attaching a
      // playable copy to the record.  Persist a compact preview first so a record
      // that passes video-level analysis is also guaranteed to play in-app.
      if (recordId) {
        if (!await stillOwnsRun()) return null;
        let previewPath = '';
        try {
          const previewTranscodeStartedAt = new Date().toISOString();
          const beforePreview = await store.getById(COL, recordId);
          const beforePreviewAnalysis = parseJsonRecord<Record<string, unknown>>(beforePreview?.aiAnalysis ?? input.record?.aiAnalysis, {});
          await store.update(COL, recordId, {
            status: 'pending' as VideoStatus,
            aiAnalysis: JSON.stringify({
              ...beforePreviewAnalysis,
              analysisStage: 'transcoding',
              analysisStageUpdatedAt: previewTranscodeStartedAt,
              previewTranscodeStartedAt,
            }),
          });
          previewPath = await (adapters.compressPreview || compressPocketBasePreview)(downloaded.filePath);
          const pocketBaseFilename = await uploadCrawlerCosObject(recordId, 'video', fs.readFileSync(previewPath), 'video/mp4');
          if (!pocketBaseFilename) throw new Error('PocketBase analysis preview persistence failed');
          const latest = await store.getById(COL, recordId);
          const analysis = parseJsonRecord(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
          await store.update(COL, recordId, {
            videoFileId: pocketBaseFilename,
            aiAnalysis: JSON.stringify({
              ...analysis,
              videoStorage: 'cos',
              videoObjectKey: pocketBaseFilename,
              materialUrl: `/api/overseas/videos/${recordId}/media`,
              previewPersistedAt: new Date().toISOString(),
            }),
          });
        } catch (error) {
          // A preview is an optional playback optimization. The source permalink
          // remains playable, and the downloaded file is still valid input for
          // Gemini. Do not turn a successful crawl into a failed analysis merely
          // because ffmpeg/COS preview persistence failed.
          console.warn('[videos] analysis preview persistence skipped:', error instanceof Error ? error.message : error);
        } finally {
          if (previewPath) {
            try { fs.unlinkSync(previewPath); } catch { /* best effort */ }
          }
        }
      }
      if (recordId) {
        if (!await stillOwnsRun()) return null;
        const latest = await store.getById(COL, recordId);
        const analysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        const downloadedAt = new Date().toISOString();
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            downloadStatus: 'analyzing',
            videoFetchStatus: 'fetched',
            geminiStatus: 'queued',
            analysisSource: 'gemini-temp-video',
            analysisFileSize: humanSize(downloaded.size),
            downloadedAt,
            analysisStage: 'analyzing',
            analysisStageUpdatedAt: downloadedAt,
          }),
        });
      }

      if (recordId) {
        if (!await stillOwnsRun()) return null;
        const latest = await store.getById(COL, recordId);
        const analysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        const modelStartedAt = new Date().toISOString();
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            downloadStatus: 'analyzing',
            videoFetchStatus: 'fetched',
            geminiStatus: 'analyzing',
            geminiStartedAt: modelStartedAt,
            analysisStage: 'analyzing',
            analysisStageUpdatedAt: modelStartedAt,
          }),
        });
      }

      const videoAnalysis = await (adapters.analyze || analyzeDownloadedVideoWithFallback)({
        filePath: downloaded.filePath,
        mimeType: downloaded.mimeType,
        title: String(input.record?.title || input.title),
        platform: input.platform,
        duration: Number(input.record?.duration || 0),
        views: String(input.record?.views || ''),
        tags: parseJsonRecord<string[]>(input.record?.tags, []),
        sourceLabel: 'gemini-temp-video',
        videoId: recordId,
        tenantId: String(input.record?.tenantId || ''),
        analysisMode,
        analysisRunId,
        videoObjectKey: String(parseJsonRecord<Record<string, unknown>>(input.record?.aiAnalysis, {}).videoObjectKey || input.record?.videoFileId || ''),
      });

      if (recordId && analysisMode === 'exact') {
        const evidenceStartedAt = new Date().toISOString();
        const beforeEvidence = await store.getById<Record<string, unknown>>(COL, recordId);
        const beforeEvidenceAnalysis = parseJsonRecord<Record<string, unknown>>(beforeEvidence?.aiAnalysis ?? input.record?.aiAnalysis, {});
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...beforeEvidenceAnalysis,
            analysisStage: 'extracting_evidence',
            analysisStageUpdatedAt: evidenceStartedAt,
            analysisEvidenceStartedAt: evidenceStartedAt,
          }),
        });
        videoAnalysis.analysis = await persistExactShotEvidence(recordId, downloaded.filePath, videoAnalysis.analysis);
      }

      if (recordId) {
        if (!await stillOwnsRun()) {
          console.warn(`[videos] stale source analysis success ignored for ${recordId}: ${analysisRunId}`);
          return videoAnalysis.analysis;
        }
        const latest = await store.getById(COL, recordId);
        const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        const measuredDuration = exactSourceClockDuration(videoAnalysis.analysis, analysisRunId);
        const persisted = await store.update(COL, recordId, {
          status: 'analyzed' as VideoStatus,
          ...(measuredDuration ? { duration: measuredDuration } : {}),
          aiAnalysis: JSON.stringify({
            ...previous,
            ...videoLevelSuccessPatch({
              analysis: videoAnalysis.analysis,
              source: videoAnalysis.source,
              videoFetchStatus: 'fetched',
              extra: { tempVideoDeleted: true, analysisMode, requestedAnalysisMode: undefined },
            }),
          }),
        });
        if (!persisted) throw new Error('video_analysis_writeback_failed');
      }
      return videoAnalysis.analysis;
    } catch (e) {
      const soft = softDownloadFailure(input.platform, e);
      const errorMessage = e instanceof Error ? e.message : 'Video download failed';
      const nonRetryableFetch = isNonRetryableVideoFetch(input.platform, errorMessage)
        || isTikTokUnusableWithoutVideoFallback(input.platform, errorMessage, input.record);
      const forceManualFailure = input.forceManualFailure === true;
      const fallback = metadataFallbackAnalysis({
        platform: input.platform,
        title: String(input.record?.title || input.title),
        duration: Number(input.record?.duration || 0),
        views: String(parseJsonRecord<Record<string, unknown>>(input.record?.aiAnalysis, {}).views || input.platform),
        tags: parseJsonRecord<string[]>(input.record?.tags, []),
      });
      if (recordId) {
        if (!await stillOwnsRun()) {
          console.warn(`[videos] stale source analysis failure ignored for ${recordId}: ${analysisRunId}`);
          throw e;
        }
        const failureReason = soft?.status || classifyCrawlerFailure(errorMessage);
        if (nonRetryableFetch || forceManualFailure) {
          await persistManualVideoFailure(input, errorMessage, failureReason, fallback);
          return fallback;
        }
        const latest = await store.getById(COL, recordId);
        const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        const compactError = compactVideoPipelineError(errorMessage);
        const compactReason = compactVideoPipelineError(failureReason, 360);
        const opsWorkerEnabled = process.env.CRAWLER_OPS_WORKER_ENABLED !== '0';
        if (!opsWorkerEnabled && previous.requestedAnalysisMode === 'exact') {
          // Production may intentionally pause the historical crawler-ops worker.
          // In that mode a retryable exact-analysis failure must become a visible,
          // retryable failure instead of entering a queue that nobody consumes.
          const failedAt = new Date().toISOString();
          await store.update(COL, recordId, {
            status: 'analyzed' as VideoStatus,
            aiAnalysis: JSON.stringify({
              ...previous,
              requestedAnalysisMode: undefined,
              analysisQueueState: 'failed',
              analysisStage: 'failed',
              analysisStageUpdatedAt: failedAt,
              analysisFailedAt: failedAt,
              analysisMode: previous.analysisMode === 'exact' ? 'exact' : 'strategy',
              downloadStatus: previous.analysisQuality === 'video' ? 'analyzed' : 'manual_required',
              videoFetchStatus: previous.analysisQuality === 'video' ? 'fetched' : 'manual_required',
              geminiStatus: previous.analysisQuality === 'video' ? 'analyzed' : 'video_failed',
              crawlerOpsStatus: 'failed',
              crawlerOpsReason: compactReason,
              analysisError: compactError,
              analysisRetryable: classifyDiscoverySourceFailure(e) !== 'model_unavailable',
              analysisFailureKind: classifyDiscoverySourceFailure(e) === 'model_unavailable' ? 'model_configuration' : 'quality_or_timeout',
              videoLevelFailureStatus: classifyDiscoverySourceFailure(e) === 'model_unavailable' ? '分析模型不可用，等待配置修复' : '全片精确分析失败，可重试',
              downloadError: compactError,
            }),
          });
          throw e;
        }
        const opsTask = input.suppressOpsRequeue
          ? updateCrawlerOpsTask(input.opsTaskId || '', {
            status: 'failed',
            reason: compactReason,
            lastError: compactError,
            updatedAt: new Date().toISOString(),
          })
          : enqueueCrawlerOpsTask({
            recordId,
            tenantId: String(input.record?.tenantId || '').trim() || undefined,
            platform: input.platform,
            sourceUrl: input.sourceUrl,
            title: String(input.record?.title || input.title),
            reason: compactReason,
            forceQueue: true,
          });
        if (opsTask && !input.suppressOpsRequeue) {
          void pushCrawlerOpsTask(opsTask).catch((pushError) => {
            console.warn('[videos] crawler ops push failed:', pushError instanceof Error ? pushError.message : pushError);
          });
        }
        const remainsQueued = Boolean(opsTask && ['queued', 'pushed', 'processing'].includes(opsTask.status));
        const stateChangedAt = new Date().toISOString();
        await store.update(COL, recordId, {
          status: 'analyzed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...previous,
            ...(previous.gemini ? { gemini: previous.gemini } : isRetryableAnalysisFailure(e) ? { gemini: undefined } : { gemini: fallback }),
            analysisSource: previous.gemini ? previous.analysisSource || 'metadata-fallback' : isRetryableAnalysisFailure(e) ? 'analysis-pending' : 'metadata-fallback',
            analysisQuality: previous.gemini ? previous.analysisQuality || 'metadata' : isRetryableAnalysisFailure(e) ? 'pending' : 'metadata',
            videoAnalysisAttemptedAt: new Date().toISOString(),
            downloadStatus: remainsQueued ? 'ops_queued' : 'manual_required',
            videoFetchStatus: remainsQueued ? 'ops_queued' : previous.contentSha256 ? 'fetched' : 'manual_required',
            geminiStatus: remainsQueued ? 'waiting_for_video' : 'video_failed',
            crawlerOpsTaskId: opsTask?.id || input.opsTaskId || previous.crawlerOpsTaskId,
            crawlerOpsStatus: opsTask?.status || 'failed',
            crawlerOpsReason: compactReason,
            analysisError: compactError,
            analysisRetryable: isRetryableAnalysisFailure(e),
            analysisFailureKind: classifyDiscoverySourceFailure(e) === 'model_unavailable' ? 'model_configuration' : isRetryableAnalysisFailure(e) ? 'quality_or_timeout' : previous.analysisFailureKind,
            downloadError: compactError,
            requestedAnalysisMode: remainsQueued ? previous.requestedAnalysisMode : undefined,
            analysisQueueKind: remainsQueued ? 'source_url' : previous.analysisQueueKind,
            analysisQueueState: remainsQueued ? 'queued' : 'failed',
            analysisStage: remainsQueued ? 'queued' : 'failed',
            analysisStageUpdatedAt: stateChangedAt,
            ...(remainsQueued ? {} : { analysisFailedAt: stateChangedAt }),
          }),
        });
      }
      throw e;
    } finally {
      if (tempPath) cleanupTempVideo(tempPath);
    }
  }

  async function persistManualVideoFailure(input: {
    record: Record<string, unknown> | null;
    sourceUrl: string;
    title: string;
    platform: Platform;
    suppressVisibleBackfill?: boolean;
  }, errorMessage: string, reason: string, fallback: VideoAiAnalysis): Promise<void> {
    const recordId = input.record?.id ? String(input.record.id) : '';
    if (!recordId) return;

    const latest = await store.getById(COL, recordId);
    const record = latest ?? input.record;
    const previous = parseJsonRecord<Record<string, unknown>>(record?.aiAnalysis, {});
    const tenantId = String(record?.tenantId || '');
    const title = String(record?.title || input.title || `${input.platform}-video`);
    const now = new Date().toISOString();
    const hadVideoAnalysis = isVideoLevelAnalysis(previous)
      || (previous.analysisQuality === 'video' && Boolean(previous.gemini) && typeof previous.gemini === 'object');
    const requestedAnalysisMode = previous.requestedAnalysisMode === 'exact' ? 'exact' : undefined;
    const compactError = compactVideoPipelineError(errorMessage);
    const compactReason = compactVideoPipelineError(reason, 360);
    const failure = {
      statusLabel: '视频级失败/需人工处理',
      reason: compactReason,
      error: compactError,
      platform: input.platform,
      sourceUrl: input.sourceUrl,
      recordedAt: now,
    };

    await store.update(COL, recordId, {
      status: 'analyzed' as VideoStatus,
      aiAnalysis: JSON.stringify({
        ...previous,
        gemini: previous.gemini || fallback,
        analysisSource: hadVideoAnalysis ? previous.analysisSource : previous.gemini ? previous.analysisSource || 'metadata-fallback' : 'metadata-fallback',
        analysisQuality: hadVideoAnalysis ? 'video' : 'metadata',
        videoAnalysisAttemptedAt: now,
        // A failed upgrade must not be presented as a completed exact analysis.
        analysisMode: previous.analysisMode === 'exact' ? 'exact' : 'strategy',
        requestedAnalysisMode: undefined,
        analysisQueueState: 'failed',
        analysisStage: 'failed',
        analysisStageUpdatedAt: now,
        analysisFailedAt: now,
        analysisRetryable: true,
        downloadStatus: hadVideoAnalysis ? previous.downloadStatus || 'analyzed' : 'manual_required',
        videoFetchStatus: hadVideoAnalysis ? previous.videoFetchStatus || 'fetched' : 'manual_required',
        geminiStatus: hadVideoAnalysis ? previous.geminiStatus || 'analyzed' : 'video_failed',
        crawlerOpsStatus: 'needs_manual',
        crawlerOpsReason: compactReason,
        videoLevelFailureStatus: '视频级失败/需人工处理',
        manualRequiredReason: compactReason,
        userVisible: hadVideoAnalysis ? previous.userVisible : false,
        adminOnlyVideoFailure: failure,
        analysisError: compactError,
        downloadError: compactError,
      }),
    });

    recordVideoAdminAlert({
      recordId,
      tenantId,
      platform: input.platform,
      title,
      sourceUrl: input.sourceUrl,
      reason: compactReason,
      error: compactError,
    });

    if (!hadVideoAnalysis && tenantId && !input.suppressVisibleBackfill) {
      const keyword = String(previous.keyword || '');
      scheduleTestTenantVideoBackfill({
        tenantId,
        platform: input.platform,
        keyword,
        target: 1,
        replacementForRecordId: recordId,
        reason,
        forceCreate: true,
        dateFrom: String(previous.dateFrom || ''),
        dateTo: String(previous.dateTo || ''),
      });
    }
  }

  async function persistMetadataFallbackAnalysis(input: {
    record: Record<string, unknown> | null;
    sourceUrl: string;
    title: string;
    platform: Platform;
  }, reason: string, status: {
    downloadStatus?: string;
    videoFetchStatus?: string;
    geminiStatus?: string;
    crawlerOpsStatus?: string;
  } = {}): Promise<VideoAiAnalysis> {
    const fallback = metadataFallbackAnalysis({
      platform: input.platform,
      title: String(input.record?.title || input.title),
      duration: Number(input.record?.duration || 0),
      views: String(parseJsonRecord<Record<string, unknown>>(input.record?.aiAnalysis, {}).views || input.platform),
      tags: parseJsonRecord<string[]>(input.record?.tags, []),
    });
    const recordId = input.record?.id ? String(input.record.id) : '';
    const finalManualFailure = (status.downloadStatus || 'metadata_only') === 'metadata_only'
      || (status.videoFetchStatus || 'url_failed') === 'url_failed';
    if (recordId && finalManualFailure) {
      await persistManualVideoFailure(input, reason, reason, fallback);
      return fallback;
    }
    if (recordId) {
      const latest = await store.getById(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'analyzed' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...previous,
          gemini: previous.gemini || fallback,
          analysisSource: previous.gemini ? previous.analysisSource || 'metadata-fallback' : 'metadata-fallback',
          analysisQuality: previous.gemini ? previous.analysisQuality || 'metadata' : 'metadata',
          downloadStatus: status.downloadStatus || 'metadata_only',
          videoFetchStatus: status.videoFetchStatus || 'url_failed',
          geminiStatus: status.geminiStatus || 'metadata_fallback',
          crawlerOpsStatus: status.crawlerOpsStatus || 'skipped',
          crawlerOpsReason: reason,
          videoAnalysisAttemptedAt: new Date().toISOString(),
        }),
      });
    }
    return fallback;
  }

  function scheduleYouTubeDownloadFallback(input: {
    record: Record<string, unknown> | null;
    sourceUrl: string;
    title: string;
    platform: Platform;
    suppressVisibleBackfill?: boolean;
    forceManualFailure?: boolean;
  }): void {
    if (input.platform !== 'youtube') return;
    const recordId = input.record?.id ? String(input.record.id) : '';
    if (!recordId) return;
    void (async () => {
      const latest = await store.getById(COL, recordId);
      if (!latest) return;
      const analysis = parseJsonRecord<Record<string, unknown>>(latest.aiAnalysis, {});
      if (analysis.analysisQuality === 'video') return;
      if (['paused', 'cancelled'].includes(String(analysis.analysisQueueState || analysis.geminiStatus || ''))) return;
      await analyzeSourceVideoJob({
        record: latest,
        sourceUrl: input.sourceUrl,
        title: input.title,
        platform: input.platform,
        skipYoutubeUrlAnalysis: true,
        suppressVisibleBackfill: input.suppressVisibleBackfill,
        forceManualFailure: input.forceManualFailure,
      });
    })().catch((e) => {
      console.warn('[videos] YouTube background download fallback failed:', e instanceof Error ? e.message : e);
    });
  }

  function youtubeDownloadFallbackEnabled(): boolean {
    return process.env.YOUTUBE_DOWNLOAD_FALLBACK_ENABLED !== '0';
  }

  function youtubeDownloadFallbackSyncEnabled(): boolean {
    return process.env.YOUTUBE_DOWNLOAD_FALLBACK_MODE === 'sync';
  }

  async function tryAnalyzeYouTubeUrl(input: {
    record: Record<string, unknown> | null;
    sourceUrl: string;
    title: string;
    platform: Platform;
  }, expectedRunId: string): Promise<unknown | null> {
    const recordId = input.record?.id ? String(input.record.id) : '';
    try {
      if (recordId) {
        const latest = await store.getById(COL, recordId);
        const analysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        if (analysis.analysisRunId && String(analysis.analysisRunId) !== expectedRunId) return null;
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            downloadStatus: 'analyzing',
            videoFetchStatus: 'direct_url',
            geminiStatus: 'analyzing',
            analysisSource: 'gemini-youtube-url',
            geminiStartedAt: new Date().toISOString(),
            analysisRunId: expectedRunId,
            analysisRunMode: 'strategy',
          }),
        });
      }
      const geminiAnalysis = await analyzeYouTubeUrl({ url: input.sourceUrl });
      if (recordId) {
        const latest = await store.getById(COL, recordId);
        const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        if (String(previous.analysisRunId || '') !== expectedRunId) return null;
        await store.update(COL, recordId, {
          status: 'analyzed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...previous,
            ...videoLevelSuccessPatch({
              analysis: geminiAnalysis,
              source: 'gemini-youtube-url',
              videoFetchStatus: 'direct_url',
            }),
          }),
        });
      }
      return geminiAnalysis;
    } catch (e) {
      if (recordId) {
        const latest = await store.getById(COL, recordId);
        const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis ?? input.record?.aiAnalysis, {});
        if (String(previous.analysisRunId || '') !== expectedRunId) return null;
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...previous,
            youtubeDirectError: compactVideoPipelineError(e instanceof Error ? e.message : 'YouTube direct Gemini analysis failed'),
            downloadStatus: 'metadata_only',
            videoFetchStatus: youtubeDownloadFallbackEnabled() ? 'queued' : 'url_failed',
            geminiStatus: youtubeDownloadFallbackEnabled() ? 'waiting_for_video' : 'metadata_fallback',
          }),
        });
      }
      return null;
    }
  }

  return { analyzeSourceVideoJob, persistManualVideoFailure };
}
