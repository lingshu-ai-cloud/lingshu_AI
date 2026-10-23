import { metadataFallbackAnalysis } from '../routes/videoCrawlerMetadataFallback.js';
import { videoLevelSuccessPatch } from '../routes/videoAnalysisSuccessPatch.js';
import { compactVideoPipelineError } from '../routes/videoAnalysisRecovery.js';
import { classifyCrawlerFailure } from '../routes/videoCrawlerOpsTaskState.js';
import { store } from '../storage/index.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { inferPlatformFromUrl, mimeFromPath, parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { COL } from './runtimeConfig.js';
import type { Material } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createMaterialAnalysisExecution(deps: Pick<VideoApplicationPorts, 'analyzeDownloadedVideoWithFallback' | 'persistExactShotEvidence' | 'exactSourceClockDuration' | 'isRetryableAnalysisFailure' | 'persistManualVideoFailure'>) {
  const analyzeDownloadedVideoWithFallback: VideoApplicationPorts['analyzeDownloadedVideoWithFallback'] = (...args) => deps.analyzeDownloadedVideoWithFallback(...args);
  const persistExactShotEvidence: VideoApplicationPorts['persistExactShotEvidence'] = (...args) => deps.persistExactShotEvidence(...args);
  const exactSourceClockDuration: VideoApplicationPorts['exactSourceClockDuration'] = (...args) => deps.exactSourceClockDuration(...args);
  const isRetryableAnalysisFailure: VideoApplicationPorts['isRetryableAnalysisFailure'] = (...args) => deps.isRetryableAnalysisFailure(...args);
  const persistManualVideoFailure: VideoApplicationPorts['persistManualVideoFailure'] = (...args) => deps.persistManualVideoFailure(...args);

  async function analyzeDownloadedMaterial(recordId: string, filePath: string, material: Material, analysisMode: 'strategy' | 'exact' = 'exact', expectedRunId?: string): Promise<void> {
    try {
      if (expectedRunId) {
        const current = await store.getById<Record<string, unknown>>(COL, recordId);
        const currentAnalysis = parseJsonRecord<Record<string, unknown>>(current?.aiAnalysis, {});
        if (String(currentAnalysis.analysisRunId || '') !== expectedRunId) {
          console.warn(`[videos] stale material analysis skipped for ${recordId}: ${expectedRunId}`);
          return;
        }
      }
      const modelStartedAt = new Date().toISOString();
      const beforeModel = await store.getById<Record<string, unknown>>(COL, recordId);
      const beforeModelAnalysis = parseJsonRecord<Record<string, unknown>>(beforeModel?.aiAnalysis, {});
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...beforeModelAnalysis,
          geminiStatus: 'analyzing',
          geminiStartedAt: modelStartedAt,
          analysisStage: 'analyzing',
          analysisStageUpdatedAt: modelStartedAt,
        }),
      });
      const videoAnalysis = await analyzeDownloadedVideoWithFallback({
        filePath,
        mimeType: mimeFromPath(filePath),
        title: material.name,
        duration: material.duration,
        sourceLabel: 'gemini-video',
        videoId: recordId,
        tenantId: material.tenantId,
        analysisMode,
        analysisRunId: expectedRunId,
        videoObjectKey: String(material.objectKey || ''),
      });
      if (analysisMode === 'exact') {
        const evidenceStartedAt = new Date().toISOString();
        const beforeEvidence = await store.getById<Record<string, unknown>>(COL, recordId);
        const beforeEvidenceAnalysis = parseJsonRecord<Record<string, unknown>>(beforeEvidence?.aiAnalysis, {});
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...beforeEvidenceAnalysis,
            analysisStage: 'extracting_evidence',
            analysisStageUpdatedAt: evidenceStartedAt,
            analysisEvidenceStartedAt: evidenceStartedAt,
          }),
        });
        videoAnalysis.analysis = await persistExactShotEvidence(recordId, filePath, videoAnalysis.analysis);
      }
      const latest = await store.getById(COL, recordId);
      const previous: Record<string, unknown> = parseJsonRecord(latest?.aiAnalysis, {} as Record<string, unknown>);
      if (expectedRunId && String(previous.analysisRunId || '') !== expectedRunId) {
        console.warn(`[videos] stale material analysis success ignored for ${recordId}: ${expectedRunId}`);
        return;
      }
      const measuredDuration = exactSourceClockDuration(videoAnalysis.analysis, expectedRunId || '');
      await store.update(COL, recordId, {
        status: 'analyzed' as VideoStatus,
        ...(measuredDuration ? { duration: measuredDuration } : {}),
        aiAnalysis: JSON.stringify({
          ...previous,
          ...videoLevelSuccessPatch({
            analysis: videoAnalysis.analysis,
            source: videoAnalysis.source,
            videoFetchStatus: 'fetched',
            extra: {
              analysisMode,
              requestedAnalysisMode: undefined,
              materialId: material.id,
              materialUrl: material.url,
              materialPoster: material.poster,
            },
          }),
        }),
      });
    } catch (e) {
      console.error(`[videos] Gemini material analysis failed for ${recordId}:`, e);
      const latest = await store.getById(COL, recordId);
      const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis, {});
      if (expectedRunId && String(previous.analysisRunId || '') !== expectedRunId) {
        console.warn(`[videos] stale material analysis failure ignored for ${recordId}: ${expectedRunId}`);
        return;
      }
      const platform = (latest?.platform || inferPlatformFromUrl(String(latest?.sourceUrl || ''))) as Platform;
      if (latest && isRetryableAnalysisFailure(e)) {
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
            geminiStatus: 'analysis_retryable',
            analysisRetryable: true,
            analysisFailureKind: 'quality_or_timeout',
            analysisError: compactVideoPipelineError(e instanceof Error ? e.message : String(e)),
            videoLevelFailureStatus: '分析未完成，可重试',
          }),
        });
        return;
      }
      const fallback = metadataFallbackAnalysis({
        platform,
        title: String(latest?.title || material.name),
        duration: Number(latest?.duration || material.duration || 0),
        views: String(previous.views || platform),
        tags: parseJsonRecord<string[]>(latest?.tags, []),
      });
      if (latest) {
        await persistManualVideoFailure({
          record: latest,
          sourceUrl: String(latest.sourceUrl || material.url || ''),
          title: String(latest.title || material.name),
          platform,
        }, e instanceof Error ? e.message : 'Gemini analysis failed', classifyCrawlerFailure(e instanceof Error ? e.message : String(e)), fallback);
      } else {
        const failedAt = new Date().toISOString();
        await store.update(COL, recordId, {
          status: 'failed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...previous,
            analysisSource: 'gemini-video',
            requestedAnalysisMode: undefined,
            analysisQueueState: 'failed',
            analysisStage: 'failed',
            analysisStageUpdatedAt: failedAt,
            analysisFailedAt: failedAt,
            analysisRetryable: true,
            analysisError: compactVideoPipelineError(e instanceof Error ? e.message : 'Gemini analysis failed'),
          }),
        });
      }
    }
  }

  return { analyzeDownloadedMaterial };
}
