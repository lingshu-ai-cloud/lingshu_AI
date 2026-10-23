import { compactVideoPipelineError } from './videoAnalysisRecovery.js';
import { RecordWorkRegistry } from '../lib/downloadExecution.js';
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { COL, MEDIA_DIR, ANALYSIS_DIR, REFERENCE_UPLOAD_MAX_BYTES, analysisRunsInWorkerProcess } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoReferenceImportRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'referenceVideoDuration' | 'findTenantReferenceByHash' | 'recoverExistingReferenceImport' | 'clearTenantVisibleListCache' | 'startQueuedLocalAnalysis' | 'compressVideoBufferForPocketBase' | 'uploadCrawlerCosObject' | 'queueAnalyzeSource'>) {
  const videosRouter = deps.videosRouter;
  const referenceVideoDuration: VideoApplicationPorts['referenceVideoDuration'] = (...args) => deps.referenceVideoDuration(...args);
  const findTenantReferenceByHash: VideoApplicationPorts['findTenantReferenceByHash'] = (...args) => deps.findTenantReferenceByHash(...args);
  const recoverExistingReferenceImport: VideoApplicationPorts['recoverExistingReferenceImport'] = (...args) => deps.recoverExistingReferenceImport(...args);
  const clearTenantVisibleListCache: VideoApplicationPorts['clearTenantVisibleListCache'] = (...args) => deps.clearTenantVisibleListCache(...args);
  const startQueuedLocalAnalysis: VideoApplicationPorts['startQueuedLocalAnalysis'] = (...args) => deps.startQueuedLocalAnalysis(...args);
  const compressVideoBufferForPocketBase: VideoApplicationPorts['compressVideoBufferForPocketBase'] = (...args) => deps.compressVideoBufferForPocketBase(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);
  const queueAnalyzeSource: VideoApplicationPorts['queueAnalyzeSource'] = (...args) => deps.queueAnalyzeSource(...args);

  const referenceImportRegistry = new RecordWorkRegistry();

  function registerPostImportReferenceFile() {
    videosRouter.post('/import-reference-file', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (!/^video\/mp4(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
        res.status(415).json({ error: 'Only video/mp4 is supported' }); return;
      }
      const declaredSize = Number(req.headers['content-length'] || 0);
      if (declaredSize > REFERENCE_UPLOAD_MAX_BYTES) {
        res.status(413).json({ error: 'Video exceeds 32 MiB limit' }); return;
      }
      fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
      const incomingPath = path.join(ANALYSIS_DIR, `reference-import-${randomUUID()}.mp4`);
      const hash = createHash('sha256');
      let size = 0;
      try {
        const fd = fs.openSync(incomingPath, 'wx');
        try {
          for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > REFERENCE_UPLOAD_MAX_BYTES) throw new Error('reference_upload_too_large');
            hash.update(bytes);
            fs.writeSync(fd, bytes);
          }
        } finally { fs.closeSync(fd); }
        if (size < 1024) throw new Error('reference_upload_empty');
        const header = Buffer.alloc(12);
        const headerFd = fs.openSync(incomingPath, 'r');
        try { fs.readSync(headerFd, header, 0, header.length, 0); } finally { fs.closeSync(headerFd); }
        if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('reference_upload_invalid_mp4');
        const duration = await referenceVideoDuration(incomingPath);
        const sha256 = hash.digest('hex');
        const result = await referenceImportRegistry.run(`${tenantId}:${sha256}`, async () => {
          const existing = await findTenantReferenceByHash(tenantId, sha256);
          if (existing) {
            const recovered = await recoverExistingReferenceImport({
              record: existing,
              tenantId,
              incomingPath,
              duration,
            });
            return { ...recovered, deduplicated: true };
          }
          const title = String(req.query.title || '本地参考视频').trim().slice(0, 160) || '本地参考视频';
          const platform = req.query.platform === 'instagram' || req.query.platform === 'facebook' || req.query.platform === 'youtube'
            ? req.query.platform : 'tiktok';
          const sourceUrl = String(req.query.sourceUrl || '').trim().slice(0, 1000);
          const now = new Date().toISOString();
          const initialAnalysis = {
            usage: 'reference_only', mayAnalyze: true, mayUseInProduction: false,
            contentSha256: sha256, originalBytes: size, requestedAnalysisMode: 'exact',
            analysisMode: 'exact', analysisRunId: randomUUID(), analysisRunMode: 'exact',
            analysisQueueKind: 'stored_video', analysisQueueState: 'queued',
            geminiStatus: 'queued', downloadStatus: 'uploaded', videoFetchStatus: 'manual_upload',
            analysisQuality: 'pending', userVisible: true, importedAt: now,
          };
          const record = await store.create(COL, {
            tenantId, contentFormat: 'video', platform, title, sourceUrl,
            thumbnailUrl: '', videoFileId: '', duration, views: '', tags: '[]',
            status: 'pending' as VideoStatus, crawledAt: now,
            aiAnalysis: JSON.stringify(initialAnalysis),
          });
          if (!record) throw new Error('reference_record_create_failed');
          const destination = path.join(tenantAssetDir(MEDIA_DIR, tenantId), 'reference-videos', `${record.id}.mp4`);
          try {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(incomingPath, destination);
            const videoFileId = path.posix.join('tenants', tenantId, 'reference-videos', `${record.id}.mp4`);
            await store.update(COL, record.id, {
              videoFileId,
              thumbnailUrl: `/api/overseas/videos/${record.id}/thumbnail`,
            });
            clearTenantVisibleListCache();
            if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(record.id);
            return { id: record.id, deduplicated: false, analysisQueued: true };
          } catch (error) {
            await store.update(COL, record.id, { status: 'failed', aiAnalysis: JSON.stringify({ ...initialAnalysis, geminiStatus: 'analysis_retryable', analysisQuality: 'pending', analysisError: compactVideoPipelineError(error) }) });
            throw error;
          }
        }) as { id: string; deduplicated: boolean; analysisQueued: boolean };
        res.status(result.deduplicated ? 200 : 202).json({ ...result, status: result.analysisQueued ? 'pending' : 'existing', analysisUrl: `/api/overseas/videos/${result.id}`, sourceVideoRef: `/api/overseas/videos/${result.id}/media` });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'reference_upload_failed';
        res.status(message === 'reference_upload_too_large' ? 413
          : ['reference_upload_empty', 'reference_upload_invalid_mp4', 'reference_upload_invalid_video'].includes(message) ? 400 : 500)
          .json({ error: message });
      } finally {
        try { fs.unlinkSync(incomingPath); } catch { /* already removed */ }
      }
    });
  }

  function registerPostIngest() {
    videosRouter.post('/ingest', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const { platform, title, tags, sourceUrl, videoBase64, mimeType } = req.body as {
        platform?: Platform;
        title?: string;
        tags?: string[];
        sourceUrl?: string;
        videoBase64?: string;
        mimeType?: string;
      };

      if (!platform) {
        res.status(400).json({ error: 'platform is required' });
        return;
      }

      // Create the record first; the video blob (if any) attaches to it.
      const record = await store.create(COL, {
        tenantId,
        contentFormat: 'video',
        platform: platform ?? 'tiktok',
        title: title ?? '',
        thumbnailUrl: '',
        videoFileId: '',
        duration: 0,
        sourceUrl: sourceUrl ?? '',
        tags: JSON.stringify(tags ?? []),
        aiAnalysis: JSON.stringify({}),
        status: 'pending' as VideoStatus,
        crawledAt: new Date().toISOString(),
      });

      if (!record) {
        res.status(500).json({ error: 'Failed to create video record' });
        return;
      }

      // Attach the video to the PB record's file field (PB disk storage, no S3).
      let filename = '';
      if (videoBase64) {
        const buf = Buffer.from(videoBase64.replace(/^data:[^,]+,/, ''), 'base64');
        const ext = (mimeType ?? 'video/mp4').split('/')[1] ?? 'mp4';
        const previewBuf = await compressVideoBufferForPocketBase(buf, ext);
        filename = await uploadCrawlerCosObject(record.id, 'video', previewBuf, 'video/mp4');
        if (!filename) {
          await store.update(COL, record.id, { status: 'failed' });
          res.status(500).json({ error: 'Video upload failed' });
          return;
        }
        const analysisRunId = randomUUID();
        await store.update(COL, record.id, {
          videoFileId: filename,
          aiAnalysis: JSON.stringify({
            videoStorage: 'cos', videoObjectKey: filename,
            requestedAnalysisMode: 'exact', analysisRunId, analysisRunMode: 'exact',
            analysisQueueKind: 'stored_video', analysisQueueState: 'queued',
            analysisQueuedAt: new Date().toISOString(), geminiStatus: 'queued',
          }),
        });
        if (!analysisRunsInWorkerProcess()) startQueuedLocalAnalysis(record.id);
      } else if (/^https?:\/\//i.test(String(sourceUrl || ''))) {
        const analysisRunId = randomUUID();
        const queuedRecord = {
          ...record,
          sourceUrl,
          aiAnalysis: JSON.stringify({ requestedAnalysisMode: 'exact', analysisRunId, analysisRunMode: 'exact' }),
        };
        await store.update(COL, record.id, { aiAnalysis: queuedRecord.aiAnalysis });
        await queueAnalyzeSource(queuedRecord);
      } else {
        await store.update(COL, record.id, { status: 'failed' as VideoStatus });
      }

      res.status(201).json({ id: record.id, status: 'pending' });
    });
  }

  return { registerPostImportReferenceFile, registerPostIngest };
}
