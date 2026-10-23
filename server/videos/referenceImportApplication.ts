import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { VideoStatus } from '../types/index.js';
import { updateVideoAdminAlertByRecordId } from '../lib/videoAdminAlerts.js';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { mimeFromPath, parseJsonRecord, safeVideoExtension } from '../routes/videoCrawlerNormalization.js';
import { COL, execFileAsync, MEDIA_DIR, ffmpegBin, MANUAL_UPLOAD_MAX_BYTES, analysisRunsInWorkerProcess } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createReferenceImportApplication(deps: Pick<VideoApplicationPorts, 'localReferenceVideoPath' | 'shouldResumeReferenceAnalysis' | 'clearTenantVisibleListCache' | 'startQueuedLocalAnalysis' | 'compressVideoBufferForPocketBase' | 'uploadCrawlerCosObject'>) {
  const localReferenceVideoPath: VideoApplicationPorts['localReferenceVideoPath'] = (...args) => deps.localReferenceVideoPath(...args);
  const shouldResumeReferenceAnalysis: VideoApplicationPorts['shouldResumeReferenceAnalysis'] = (...args) => deps.shouldResumeReferenceAnalysis(...args);
  const clearTenantVisibleListCache: VideoApplicationPorts['clearTenantVisibleListCache'] = (...args) => deps.clearTenantVisibleListCache(...args);
  const startQueuedLocalAnalysis: VideoApplicationPorts['startQueuedLocalAnalysis'] = (...args) => deps.startQueuedLocalAnalysis(...args);
  const compressVideoBufferForPocketBase: VideoApplicationPorts['compressVideoBufferForPocketBase'] = (...args) => deps.compressVideoBufferForPocketBase(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);

  async function referenceVideoDuration(filePath: string): Promise<number> {
    if (!ffmpegBin) throw new Error('ffmpeg_unavailable');
    let output = '';
    try {
      const result = await execFileAsync(ffmpegBin, ['-hide_banner', '-i', filePath, '-frames:v', '1', '-f', 'null', '-'], { timeout: 30_000 });
      output = result.stderr;
    } catch (error) {
      output = String((error as { stderr?: string }).stderr || '');
    }
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match || !/Video:\s/.test(output)) throw new Error('reference_upload_invalid_video');
    const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('reference_upload_invalid_video');
    return duration;
  }

  async function findTenantReferenceByHash(tenantId: string, sha256: string): Promise<Record<string, unknown> | null> {
    let page = 1;
    let totalPages = 1;
    do {
      const result = await store.list<Record<string, unknown>>(COL, { where: { tenantId }, page, perPage: 200 });
      const found = result.items.find(record => {
        const analysis = videoAnalysisOf(record);
        return analysis.contentSha256 === sha256 && analysis.usage === 'reference_only' && Boolean(record.videoFileId);
      });
      if (found) return found;
      totalPages = result.totalPages;
      page += 1;
    } while (page <= totalPages);
    return null;
  }

  async function recoverExistingReferenceImport(input: {
    record: Record<string, unknown>;
    tenantId: string;
    incomingPath: string;
    duration: number;
  }): Promise<{ id: string; analysisQueued: boolean }> {
    const recordId = String(input.record.id || '');
    if (!recordId) throw new Error('reference_record_invalid');
    const now = new Date().toISOString();
    const previous = videoAnalysisOf(input.record);
    const canonicalFileId = path.posix.join('tenants', input.tenantId, 'reference-videos', `${recordId}.mp4`);
    const canonicalPath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), 'reference-videos', `${recordId}.mp4`);
    const savedPath = localReferenceVideoPath(String(input.record.videoFileId || ''), input.tenantId);
    if (!fs.existsSync(canonicalPath)) {
      fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
      fs.copyFileSync(savedPath && fs.existsSync(savedPath) ? savedPath : input.incomingPath, canonicalPath);
    }

    const commonAnalysis = {
      ...previous,
      usage: 'reference_only',
      mayAnalyze: true,
      mayUseInProduction: false,
      userVisible: true,
      downloadStatus: previous.downloadStatus || 'uploaded',
      videoFetchStatus: previous.videoFetchStatus || 'manual_upload',
    };
    const shouldResume = shouldResumeReferenceAnalysis(commonAnalysis, Number(input.record.duration || input.duration));
    const analysisRunId = shouldResume ? randomUUID() : String(previous.analysisRunId || randomUUID());
    const nextAnalysis = shouldResume ? {
      ...commonAnalysis,
      requestedAnalysisMode: 'exact',
      analysisMode: 'exact',
      analysisRunId,
      analysisRunMode: 'exact',
      geminiStatus: 'queued',
      downloadStatus: 'uploaded',
      videoFetchStatus: 'manual_upload',
      analysisQuality: 'pending',
      analysisError: undefined,
      downloadError: undefined,
      videoLevelFailureStatus: undefined,
      analysisRetryable: undefined,
      analysisFailureKind: undefined,
      analysisQueuedAt: now,
      reanalyzeQueuedAt: now,
      analysisQueueKind: 'stored_video',
      analysisQueueState: 'queued',
    } : commonAnalysis;
    await store.update(COL, recordId, {
      tenantId: input.tenantId,
      contentFormat: 'video',
      videoFileId: canonicalFileId,
      thumbnailUrl: `/api/overseas/videos/${recordId}/thumbnail`,
      duration: Number(input.record.duration || input.duration),
      status: shouldResume ? 'pending' as VideoStatus : input.record.status,
      aiAnalysis: JSON.stringify(nextAnalysis),
    });
    clearTenantVisibleListCache();

    if (shouldResume) {
      if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(recordId);
    }
    return { id: recordId, analysisQueued: shouldResume };
  }

  async function attachManualVideoUploadAndQueue(input: {
    recordId: string;
    videoBase64: string;
    mimeType?: string;
    filename?: string;
    uploadedBy?: string;
  }): Promise<{ recordId: string; filename: string; status: 'queued' }> {
    const record = await store.getById<Record<string, unknown>>(COL, input.recordId);
    if (!record) throw new Error('Video record not found');

    const mimeType = input.mimeType?.trim() || mimeFromPath(input.filename || 'video.mp4');
    if (!/^video\//i.test(mimeType)) throw new Error('Only video files can be uploaded');
    const raw = input.videoBase64.replace(/^data:[^,]+,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new Error('Video file is empty');
    if (buf.length > MANUAL_UPLOAD_MAX_BYTES) throw new Error('视频压缩后仍超过 10MB，请换更短的视频或降低清晰度后再上传。');

    const ext = safeVideoExtension(input.filename, mimeType);
    const previewBuf = await compressVideoBufferForPocketBase(buf, ext);
    const storedFilename = await uploadCrawlerCosObject(input.recordId, 'video', previewBuf, 'video/mp4');
    if (!storedFilename) throw new Error('Video upload failed');

    const previous = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
    const analysisRunId = randomUUID();
    const queuedAt = new Date().toISOString();
    await store.update(COL, input.recordId, {
      videoFileId: storedFilename,
      status: 'pending' as VideoStatus,
      aiAnalysis: JSON.stringify({
        ...previous,
        videoStorage: 'cos',
        videoObjectKey: storedFilename,
        manualVideoUploadedAt: queuedAt,
        manualVideoUploadedBy: input.uploadedBy,
        manualVideoUploadStatus: 'queued',
        requestedAnalysisMode: 'exact',
        analysisRunId,
        analysisRunMode: 'exact',
        analysisQueueKind: 'stored_video',
        analysisQueueState: 'queued',
        analysisQueuedAt: queuedAt,
        analysisStage: 'queued',
        analysisStageUpdatedAt: queuedAt,
        downloadStatus: 'uploaded',
        videoFetchStatus: 'manual_upload',
        geminiStatus: 'queued',
        analysisSource: 'gemini-upload-video',
        userVisible: false,
        adminOnlyVideoFailure: undefined,
        videoLevelFailureStatus: undefined,
        manualRequiredReason: undefined,
        downloadError: undefined,
        analysisError: undefined,
      }),
    });

    updateVideoAdminAlertByRecordId(input.recordId, {
      statusLabel: '已上传/分析排队',
      manualUploadStatus: 'queued',
      manualUploadedAt: new Date().toISOString(),
      manualUploadRecordId: input.recordId,
      error: '缺失视频已补充，等待 Gemini 视频级分析。',
    });

    if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(input.recordId);

    return { recordId: input.recordId, filename: storedFilename, status: 'queued' };
  }

  return { referenceVideoDuration, findTenantReferenceByHash, recoverExistingReferenceImport, attachManualVideoUploadAndQueue };
}
