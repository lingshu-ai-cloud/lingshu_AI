import { videoLevelSuccessPatch } from '../routes/videoAnalysisSuccessPatch.js';
import { compactVideoPipelineError } from '../routes/videoAnalysisRecovery.js';
import { AnalysisAlreadyRunningError } from '../lib/analysisLease.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import { objectStorageDownload } from '../storage/objectStorage.js';
import { repairVideoShotClassificationsWithQwen } from '../agents/qwen.js';
import type { VideoAiAnalysis, VideoStatus } from '../types/index.js';
import { fetchCloudMaterial, getCloudMaterialRecord } from '../lib/cloudMaterials.js';
import { humanSize, parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { COL, MEDIA_DIR, ANALYSIS_DIR } from './runtimeConfig.js';
import type { Material } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createQueuedMaterialAnalysis(deps: Pick<VideoApplicationPorts, 'loadMaterials' | 'activeAnalysisRecords' | 'durableAnalysisRecords' | 'analyzeDownloadedMaterial' | 'localReferenceVideoPath' | 'triggerVideoAnalysis'>) {
  const loadMaterials: VideoApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  const activeAnalysisRecords = deps.activeAnalysisRecords;
  const durableAnalysisRecords = deps.durableAnalysisRecords;
  const analyzeDownloadedMaterial: VideoApplicationPorts['analyzeDownloadedMaterial'] = (...args) => deps.analyzeDownloadedMaterial(...args);
  const localReferenceVideoPath: VideoApplicationPorts['localReferenceVideoPath'] = (...args) => deps.localReferenceVideoPath(...args);
  const triggerVideoAnalysis: VideoApplicationPorts['triggerVideoAnalysis'] = (...args) => deps.triggerVideoAnalysis(...args);

  function startQueuedLocalAnalysis(recordId: string): void {
    void executeQueuedLocalAnalysisRecord(recordId).catch(error => {
      if (error instanceof AnalysisAlreadyRunningError) return;
      console.warn(`[videos] queued local analysis failed for ${recordId}:`, error instanceof Error ? error.message : error);
    });
  }

  async function materialForQueuedAnalysis(
    record: Record<string, unknown>,
    analysis: Record<string, unknown>,
  ): Promise<{ material: Material; filePath: string; temporary: boolean }> {
    const recordId = String(record.id || '');
    const tenantId = String(record.tenantId || '');
    const materialId = String(analysis.materialId || '');
    if (!materialId) throw new Error('queued_material_id_missing');
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const tempPath = path.join(ANALYSIS_DIR, `queued-material-${recordId}-${String(analysis.analysisRunId || randomUUID())}.mp4`);
    if (materialId.startsWith('pb-')) {
      const rawMaterialId = materialId.replace(/^pb-/, '');
      const cloudRecord = await getCloudMaterialRecord(rawMaterialId, tenantId);
      if (!cloudRecord) throw new Error('queued_cloud_material_not_found');
      const response = await fetchCloudMaterial(rawMaterialId, 'videoFile', undefined, tenantId);
      if (!response?.ok) throw new Error('queued_cloud_material_unreadable');
      fs.writeFileSync(tempPath, Buffer.from(await response.arrayBuffer()));
      return {
        material: {
          id: materialId,
          name: String(cloudRecord.title || cloudRecord.sourceName || record.title || '置顶素材'),
          folder: String(cloudRecord.folder || 'upload'),
          type: 'video',
          duration: Number(cloudRecord.duration || record.duration || 0),
          size: humanSize(Number(cloudRecord.sizeBytes || fs.statSync(tempPath).size)),
          file: String(cloudRecord.videoFile || ''),
          url: String(analysis.materialUrl || `/api/overseas/studio/materials/pb/${rawMaterialId}/media`),
          poster: String(analysis.materialPoster || record.thumbnailUrl || '') || undefined,
          scope: String(cloudRecord.scope || 'own') === 'shared' ? 'shared' : 'own',
          tenantId,
          createdAt: String(cloudRecord.created || new Date().toISOString()),
        },
        filePath: tempPath,
        temporary: true,
      };
    }
    const material = loadMaterials().find(item => item.id === materialId
      && (item.scope === 'shared' || item.tenantId === tenantId));
    if (!material) throw new Error('queued_material_not_found');
    if (material.objectKey) {
      const downloaded = await objectStorageDownload(material.objectKey);
      if (!downloaded?.buf.length) throw new Error('queued_object_material_unreadable');
      fs.writeFileSync(tempPath, downloaded.buf);
      return { material, filePath: tempPath, temporary: true };
    }
    const localPath = path.join(MEDIA_DIR, material.file);
    if (!fs.existsSync(localPath)) throw new Error('queued_local_material_missing');
    return { material, filePath: localPath, temporary: false };
  }

  async function executeQueuedLocalAnalysisRecord(recordId: string): Promise<boolean> {
    return await activeAnalysisRecords.run(recordId, () => durableAnalysisRecords.run(recordId, async () => {
      const record = await store.getById<Record<string, unknown>>(COL, recordId);
      if (!record) return false;
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const queueState = String(analysis.analysisQueueState || 'queued');
      if (!analysis.requestedAnalysisMode || ['paused', 'cancelled', 'completed'].includes(queueState)) return false;
      const analysisRunId = String(analysis.analysisRunId || randomUUID());
      const analysisMode = analysis.requestedAnalysisMode === 'strategy' ? 'strategy' : 'exact';
      const queueKind = String(analysis.analysisQueueKind || '');
      const workerStartedAt = new Date().toISOString();
      await store.update(COL, recordId, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          analysisRunId,
          analysisRunMode: analysisMode,
          analysisQueueState: 'running',
          analysisWorkerStartedAt: workerStartedAt,
          analysisStage: queueKind === 'classification_repair' ? 'repairing_classification' : 'downloading',
          analysisStageUpdatedAt: workerStartedAt,
          analysisWorkerAttempt: Number(analysis.analysisWorkerAttempt || 0) + 1,
          geminiStatus: 'analyzing',
        }),
      });
      try {
        if (queueKind === 'classification_repair') {
          const gemini = analysis.gemini && typeof analysis.gemini === 'object'
            ? analysis.gemini as VideoAiAnalysis
            : parseJsonRecord<VideoAiAnalysis>(analysis.gemini, {} as VideoAiAnalysis);
          const repaired = await repairVideoShotClassificationsWithQwen(gemini);
          const latest = await store.getById<Record<string, unknown>>(COL, recordId);
          const previous = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis, {});
          if (String(previous.analysisRunId || '') !== analysisRunId) return false;
          await store.update(COL, recordId, {
            status: 'analyzed' as VideoStatus,
            aiAnalysis: JSON.stringify({
              ...previous,
              ...videoLevelSuccessPatch({
                analysis: repaired,
                source: `${String(analysis.analysisSource || 'video')}-classification-repair`,
                videoFetchStatus: String(analysis.videoFetchStatus || 'fetched'),
                extra: {
                  analysisMode: 'exact',
                  requestedAnalysisMode: undefined,
                  classificationRepairedAt: new Date().toISOString(),
                },
              }),
            }),
          });
        } else if (queueKind === 'material' || (!record.videoFileId && analysis.materialId)) {
          const resolved = await materialForQueuedAnalysis(record, analysis);
          try {
            await analyzeDownloadedMaterial(recordId, resolved.filePath, resolved.material, analysisMode, analysisRunId);
          } finally {
            if (resolved.temporary) { try { fs.unlinkSync(resolved.filePath); } catch { /* best effort */ } }
          }
        } else {
          const filename = String(record.videoFileId || '');
          if (!filename) throw new Error('queued_video_file_missing');
          const tenantId = String(record.tenantId || '');
          const localPath = localReferenceVideoPath(filename, tenantId) || path.join(MEDIA_DIR, filename);
          if (fs.existsSync(localPath)) {
            await analyzeDownloadedMaterial(recordId, localPath, {
              id: String(analysis.materialId || path.parse(filename).name),
              name: String(record.title || filename),
              folder: 'hot',
              type: 'video',
              duration: Number(record.duration || 0),
              size: humanSize(fs.statSync(localPath).size),
              file: filename,
              url: `/api/overseas/videos/${recordId}/media`,
              poster: String(analysis.materialPoster || record.thumbnailUrl || '') || undefined,
              scope: 'own',
              tenantId,
              createdAt: new Date().toISOString(),
            }, analysisMode, analysisRunId);
          } else {
            await triggerVideoAnalysis(recordId, filename, undefined, 'analysis-worker', analysisRunId);
          }
        }
        const finished = await store.getById<Record<string, unknown>>(COL, recordId);
        const finishedAnalysis = parseJsonRecord<Record<string, unknown>>(finished?.aiAnalysis, {});
        if (String(finishedAnalysis.analysisRunId || '') === analysisRunId
          && finishedAnalysis.analysisQueueState === 'running') {
          const succeeded = !finishedAnalysis.requestedAnalysisMode
            && ['analyzed', 'needs_review'].includes(String(finishedAnalysis.geminiStatus || ''))
            && ['video', 'video_review_required'].includes(String(finishedAnalysis.analysisQuality || ''));
          const finishedAt = new Date().toISOString();
          await store.update(COL, recordId, {
            aiAnalysis: JSON.stringify({
              ...finishedAnalysis,
              analysisQueueState: succeeded ? 'completed' : 'failed',
              analysisStage: succeeded ? 'completed' : 'failed',
              analysisStageUpdatedAt: finishedAt,
              ...(succeeded
                ? { analysisCompletedAt: finishedAt }
                : { analysisFailedAt: finishedAt, analysisRetryable: true }),
            }),
          });
        }
        return true;
      } catch (error) {
        const latest = await store.getById<Record<string, unknown>>(COL, recordId);
        const latestAnalysis = parseJsonRecord<Record<string, unknown>>(latest?.aiAnalysis, {});
        if (String(latestAnalysis.analysisRunId || '') === analysisRunId) {
          const failedAt = new Date().toISOString();
          await store.update(COL, recordId, {
            status: 'failed' as VideoStatus,
            aiAnalysis: JSON.stringify({
              ...latestAnalysis,
              requestedAnalysisMode: undefined,
              analysisQueueState: 'failed',
              analysisStage: 'failed',
              analysisStageUpdatedAt: failedAt,
              analysisFailedAt: failedAt,
              geminiStatus: 'analysis_retryable',
              analysisRetryable: true,
              analysisError: compactVideoPipelineError(error instanceof Error ? error.message : error),
              videoLevelFailureStatus: '后台分析中断，可重试或恢复',
            }),
          });
        }
        throw error;
      }
    })) as boolean;
  }

  return { startQueuedLocalAnalysis, executeQueuedLocalAnalysisRecord };
}
