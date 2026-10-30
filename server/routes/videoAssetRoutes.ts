import { storedVideoAvailability } from './storedVideoAvailability.js';
import { isPublicTestTenantVideo } from './videoRecordVisibility.js';
import { fetchThumbnailBuffer, publicSourceThumbnail } from './videoThumbnailPersistence.js';
import { type Request } from 'express';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { attachFile, fetchFile } from '../storage/files.js';
import { objectStorageEnabled, objectStorageDownload } from '../storage/objectStorage.js';
import type { Platform } from '../types/index.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { ASSET_SESSION_COOKIE, cookieValue, signAssetUrl, tenantAssetDir } from '../lib/assetAccess.js';
import { validatePublicVideoSourceUrl } from '../lib/publicVideoSourceSecurity.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { inferPlatformFromUrl, isPlatformUrl, parseJsonRecord } from './videoCrawlerNormalization.js';
import { COL, MEDIA_DIR, ANALYSIS_DIR } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoAssetRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'streamCrawlerCosObject' | 'downloadVideoForAnalysis' | 'cleanupTempVideo' | 'extractPoster' | 'uploadCrawlerCosObject' | 'recoverCrawlerImageObjectKey' | 'storeThumbnailBuffer'>) {
  const videosRouter = deps.videosRouter;
  const streamCrawlerCosObject: VideoApplicationPorts['streamCrawlerCosObject'] = (...args) => deps.streamCrawlerCosObject(...args);
  const downloadVideoForAnalysis: VideoApplicationPorts['downloadVideoForAnalysis'] = (...args) => deps.downloadVideoForAnalysis(...args);
  const cleanupTempVideo: VideoApplicationPorts['cleanupTempVideo'] = (...args) => deps.cleanupTempVideo(...args);
  const extractPoster: VideoApplicationPorts['extractPoster'] = (...args) => deps.extractPoster(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);
  const recoverCrawlerImageObjectKey: VideoApplicationPorts['recoverCrawlerImageObjectKey'] = (...args) => deps.recoverCrawlerImageObjectKey(...args);
  const storeThumbnailBuffer: VideoApplicationPorts['storeThumbnailBuffer'] = (...args) => deps.storeThumbnailBuffer(...args);

  function registerGetIdMedia() {
    videosRouter.get('/:id/media', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById(COL, req.params.id);
      if (!record) { res.status(404).json({ error: 'Not found' }); return; }
      if (record.tenantId !== tenantId && !await requireAdminUser(req)) { res.status(404).json({ error: 'Not found' }); return; }
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const filename = String(record.videoFileId || '');
      const localReference = localReferenceVideoPath(filename, String(record.tenantId || ''));
      // Imports are mirrored locally before object-storage upload. Prefer that durable
      // local copy so a temporary COS outage cannot break preview or stop the server.
      if (localReference && fs.existsSync(localReference)) {
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.type('mp4').sendFile(localReference);
        return;
      }
      const cosKey = String(analysis.videoObjectKey || '');
      if (cosKey) {
        try {
          if (!await streamCrawlerCosObject(res, cosKey, req.headers.range)) res.status(404).json({ error: 'video_media_missing', message: '视频文件缺失，请重新上传原视频或联系管理员核对存储。' });
        } catch (error) {
          console.warn('[videos] object storage preview unavailable:', error instanceof Error ? error.message : error);
          if (!res.headersSent) res.status(502).json({ error: 'video_storage_temporarily_unavailable' });
          else res.end();
        }
        return;
      }
      if (!filename) { res.status(404).json({ error: 'Video not stored' }); return; }
      if (localReference) {
        if (!fs.existsSync(localReference)) { res.status(404).json({ error: 'Video not stored' }); return; }
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.type('mp4').sendFile(localReference);
        return;
      }
      const file = await fetchFile(COL, req.params.id, filename);
      if (!file) { res.status(404).json({ error: 'PocketBase video not found' }); return; }
      const range = req.headers.range;
      res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Type', file.contentType || 'video/mp4'); res.setHeader('Cache-Control', 'private, max-age=3600');
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/); const start = Math.max(0, Number(match?.[1] || 0)); const end = Math.min(file.buf.length - 1, Number(match?.[2] || file.buf.length - 1));
        if (start > end) { res.status(416).end(); return; }
        res.status(206); res.setHeader('Content-Range', `bytes ${start}-${end}/${file.buf.length}`); res.setHeader('Content-Length', end - start + 1); res.end(file.buf.subarray(start, end + 1)); return;
      }
      res.setHeader('Content-Length', file.buf.length); res.end(file.buf);
    });
  }

  function localReferenceVideoPath(filename: string, tenantId: string): string | null {
    const clean = filename.replace(/\\/g, '/');
    const prefix = `tenants/${tenantId}/reference-videos/`;
    if (!clean.startsWith(prefix) || !/^tenants\/[A-Za-z0-9_-]+\/reference-videos\/[A-Za-z0-9_-]+\.mp4$/.test(clean)) return null;
    const fullPath = path.resolve(MEDIA_DIR, clean);
    const tenantRoot = path.resolve(tenantAssetDir(MEDIA_DIR, tenantId));
    return fullPath.startsWith(`${tenantRoot}${path.sep}`) ? fullPath : null;
  }

  async function ensureLocalReferenceVideoPath(record: Record<string, unknown>, tenantId: string): Promise<string | null> {
    const existing = localReferenceVideoPath(String(record.videoFileId || ''), tenantId);
    if (existing && fs.existsSync(existing)) return existing;
    const sourceUrl = String(record.sourceUrl || '').trim();
    const platform = (record.platform || inferPlatformFromUrl(sourceUrl)) as Platform;
    if (!sourceUrl || !validatePublicVideoSourceUrl(sourceUrl, platform)) return null;
    const downloaded = await downloadVideoForAnalysis({ record, sourceUrl, title: String(record.title || `${platform}-video`), platform });
    try {
      const analysis = videoAnalysisOf(record);
      const measured = createHash('sha256').update(fs.readFileSync(downloaded.filePath)).digest('hex');
      if (analysis.contentSha256 && analysis.contentSha256 !== measured) throw new Error('reference_source_bytes_changed');
      const destination = path.join(tenantAssetDir(MEDIA_DIR, tenantId), 'reference-videos', `${String(record.id)}.mp4`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(downloaded.filePath, destination);
      const videoFileId = path.posix.join('tenants', tenantId, 'reference-videos', `${String(record.id)}.mp4`);
      await store.update(COL, String(record.id), { videoFileId });
      return destination;
    } finally {
      cleanupTempVideo(downloaded.filePath);
    }
  }

  function registerGetIdShotNumberKind() {
    videosRouter.get('/:id/shot/:number/:kind', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById(COL, req.params.id);
      if (!record || (record.tenantId !== tenantId && !await requireAdminUser(req))) {
        res.status(404).json({ error: 'Not found' }); return;
      }
      const index = Number(req.params.number) - 1;
      const kind = req.params.kind;
      if (!Number.isSafeInteger(index) || index < 0 || (kind !== 'clip' && kind !== 'first-frame')) {
        res.status(404).json({ error: 'Shot evidence not found' }); return;
      }
      const geminiValue = videoAnalysisOf(record).gemini;
      const gemini = geminiValue && typeof geminiValue === 'object' && !Array.isArray(geminiValue)
        ? geminiValue as Record<string, unknown>
        : parseJsonRecord<Record<string, unknown>>(geminiValue, {});
      const details = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : [];
      const detailValue = details[index];
      const detail = detailValue && typeof detailValue === 'object' && !Array.isArray(detailValue)
        ? detailValue as Record<string, unknown>
        : parseJsonRecord<Record<string, unknown>>(detailValue, {});
      const evidenceValue = detail.materialEvidence;
      const evidence = evidenceValue && typeof evidenceValue === 'object' && !Array.isArray(evidenceValue)
        ? evidenceValue as Record<string, unknown>
        : parseJsonRecord<Record<string, unknown>>(evidenceValue, {});
      const key = String(kind === 'clip' ? evidence.clipObjectKey || '' : evidence.firstFrameObjectKey || '');
      if (evidence.extractionStatus !== 'ready' || !key) {
        if (evidence.extractionStatus !== 'ready' || objectStorageEnabled()) {
          res.status(404).json({ error: 'Shot evidence not found' }); return;
        }
        const file = path.join(tenantAssetDir(MEDIA_DIR, tenantId), 'trend-shots', String(record.id), `shot-${index + 1}.${kind === 'clip' ? 'mp4' : 'jpg'}`);
        if (!fs.existsSync(file)) { res.status(404).json({ error: 'Shot evidence not found' }); return; }
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(file);
        return;
      }
      if (!await streamCrawlerCosObject(res, key, kind === 'clip' ? req.headers.range : undefined)) {
        res.status(404).json({ error: 'Shot evidence not found' });
      }
    });
  }

  function registerGetIdMediaUrl() {
    videosRouter.get('/:id/media-url', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById(COL, req.params.id);
      if (!record) { res.status(404).json({ error: 'Not found' }); return; }
      if (record.tenantId !== tenantId && !await requireAdminUser(req)) { res.status(404).json({ error: 'Not found' }); return; }
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const filename = String(record.videoFileId || '');
      if (!filename && !analysis.videoObjectKey) { res.status(404).json({ error: 'Video not stored' }); return; }
      res.setHeader('Cache-Control', 'private, no-store');
      const normalizedLocalFile = filename.replace(/\\/g, '/').replace(/^\/+/, '');
      const recordTenantId = String(record.tenantId || '');
      const expectedPrefix = `tenants/${recordTenantId}/`;
      const tenantRoot = path.resolve(MEDIA_DIR, 'tenants', recordTenantId);
      const localPath = path.resolve(MEDIA_DIR, normalizedLocalFile);
      if (normalizedLocalFile.startsWith(expectedPrefix)
        && localPath.startsWith(`${tenantRoot}${path.sep}`)
        && fs.existsSync(localPath)
        && fs.statSync(localPath).isFile()) {
        res.json({ url: signAssetUrl(`/media/${normalizedLocalFile}`, tenantId) });
        return;
      }
      if (analysis.videoObjectKey) {
        const availability = await storedVideoAvailability(String(analysis.videoObjectKey));
        if (availability === 'missing') { res.status(404).json({ error: 'video_media_missing', message: '视频文件缺失，请重新上传原视频或联系管理员核对存储。' }); return; }
        if (availability === 'unavailable') { res.status(503).json({ error: 'video_storage_temporarily_unavailable', message: '视频存储暂时无法连接，请稍后再试。' }); return; }
      } else if (normalizedLocalFile.startsWith(expectedPrefix)) {
        res.status(404).json({ error: 'video_media_missing', message: '视频文件缺失，请重新上传原视频或联系管理员核对存储。' }); return;
      }
      res.json({ url: signAssetUrl(`/api/overseas/videos/${encodeURIComponent(req.params.id)}/media`, tenantId) });
    });
  }

  async function isAdminForAssetRequest(req: Request): Promise<boolean> {
    if (await requireAdminUser(req)) return true;
    const cookieToken = cookieValue(req, ASSET_SESSION_COOKIE);
    if (!cookieToken) return false;
    const proxied = Object.create(req, {
      headers: { value: { ...req.headers, authorization: `Bearer ${cookieToken}` } },
    }) as Request;
    return Boolean(await requireAdminUser(proxied));
  }

  function isSharedInspirationThumbnailReadable(record: Record<string, unknown>): boolean {
    const sharedTenantId = String(process.env.SOCIAL_SHARED_INSPIRATION_TENANT_ID || 'demo-shared-video-pool').trim();
    const analysis = videoAnalysisOf(record);
    return Boolean(sharedTenantId)
      && String(record.tenantId || '') === sharedTenantId
      && analysis.userVisible === true
      && isPublicTestTenantVideo(record);
  }

  async function generateThumbnailFromStoredVideo(record: Record<string, unknown>): Promise<{ buf: Buffer; contentType: string } | null> {
    const recordId = String(record.id || '');
    if (!recordId) return null;
    const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
    const videoKey = String(analysis.videoObjectKey || '');
    const filename = String(record.videoFileId || '');
    const localReference = localReferenceVideoPath(filename, String(record.tenantId || ''));
    let video: Awaited<ReturnType<typeof objectStorageDownload>> | null = null;
    if (videoKey) {
      try {
        video = await objectStorageDownload(videoKey);
      } catch (error) {
        // A branch can carry database metadata without the corresponding local
        // object-storage blob. Continue to the record/local reference fallbacks.
        console.warn('[videos] object thumbnail source unavailable, trying local fallback:', error instanceof Error ? error.message : error);
      }
    }
    if (!video && localReference && fs.existsSync(localReference)) video = { buf: fs.readFileSync(localReference), contentType: 'video/mp4' };
    if (!video && filename) video = await fetchFile(COL, recordId, filename);
    if (!video?.buf.length) return null;

    if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const sourceName = videoKey || filename || 'video.mp4';
    const ext = path.extname(sourceName).replace(/^\./, '').toLowerCase()
      || (video.contentType.includes('webm') ? 'webm' : video.contentType.includes('quicktime') ? 'mov' : 'mp4');
    const base = `thumb-${recordId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const videoPath = path.join(ANALYSIS_DIR, `${base}.${ext}`);
    const posterPath = path.join(ANALYSIS_DIR, `${base}.jpg`);
    try {
      fs.writeFileSync(videoPath, video.buf);
      const ok = await extractPoster(videoPath, posterPath, Number(record.duration || 0) > 1 ? 1 : 0);
      if (!ok || !fs.existsSync(posterPath)) return null;
      const posterBuf = fs.readFileSync(posterPath);
      const thumbnailUrl = `/api/overseas/videos/${encodeURIComponent(recordId)}/thumbnail`;
      if (objectStorageEnabled()) {
        const thumbnailObjectKey = await uploadCrawlerCosObject(recordId, 'thumbnail', posterBuf, 'image/jpeg');
        await store.update(COL, recordId, {
          thumbnailUrl,
          aiAnalysis: JSON.stringify({
            ...analysis,
            thumbnailStorage: 'cos',
            thumbnailObjectKey,
          }),
        });
      } else {
        const thumbnailFile = await attachFile(COL, recordId, 'thumbnailFile', {
          name: `${recordId}-thumbnail.jpg`,
          buf: posterBuf,
          contentType: 'image/jpeg',
        });
        await store.update(COL, recordId, {
          thumbnailUrl,
          ...(thumbnailFile ? { thumbnailFile } : {}),
        });
      }
      return { buf: posterBuf, contentType: 'image/jpeg' };
    } catch (error) {
      console.warn('[videos] thumbnail generation failed:', error instanceof Error ? error.message : error);
      return null;
    } finally {
      for (const filePath of [videoPath, posterPath]) {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
      }
    }
  }

  function registerGetIdThumbnail() {
    videosRouter.get('/:id/thumbnail', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById<Record<string, unknown>>(COL, req.params.id);
      if (!record) {
        // Frozen weekly plans intentionally keep their source evidence after a
        // discovery record is removed. Resolve that public source instead of
        // turning every historical calendar card into a permanent broken cover.
        const sourceUrl = String(req.query.sourceUrl || '').trim().slice(0, 2_000);
        const platform = inferPlatformFromUrl(sourceUrl);
        if (!sourceUrl || !isPlatformUrl(sourceUrl, platform)) { res.status(404).end(); return; }
        const remoteUrl = await publicSourceThumbnail({ sourceUrl, platform });
        const fallback = remoteUrl ? await fetchThumbnailBuffer(remoteUrl) : null;
        if (!fallback) { res.status(404).end(); return; }
        res.setHeader('Content-Type', fallback.contentType.startsWith('image/') ? fallback.contentType : 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=86400');
        res.setHeader('Content-Length', fallback.buf.length);
        res.end(fallback.buf);
        return;
      }
      const ownsRecord = String(record.tenantId || '') === tenantId;
      if (!ownsRecord && !isSharedInspirationThumbnailReadable(record) && !await isAdminForAssetRequest(req)) {
        res.status(404).end();
        return;
      }

      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      let cosKey = String(analysis.thumbnailObjectKey || '');
      if (!cosKey && analysis.contentFormat === 'image') {
        cosKey = await recoverCrawlerImageObjectKey(record, 'thumbnail');
        if (cosKey) {
          void store.update(COL, String(record.id), {
            aiAnalysis: JSON.stringify({ ...analysis, thumbnailStorage: 'cos', thumbnailObjectKey: cosKey }),
          });
        }
      }
      if (cosKey) {
        try {
          if (await streamCrawlerCosObject(res, cosKey, req.headers.range)) return;
        } catch (error) {
          console.warn('[videos] stored thumbnail unavailable, trying fallbacks:', error instanceof Error ? error.message : error);
        }
      }
      const filename = String(record.thumbnailFile || '');
      let file = filename ? await fetchFile(COL, req.params.id, filename) : null;
      if (!file) file = await generateThumbnailFromStoredVideo(record as Record<string, unknown>);
      if (!file) {
        const remoteUrl = await publicSourceThumbnail(record);
        if (remoteUrl) {
          file = await fetchThumbnailBuffer(remoteUrl);
          if (file) void storeThumbnailBuffer(String(record.id), file.buf, file.contentType);
        }
      }
      if (!file) { res.status(404).end(); return; }

      res.setHeader('Content-Type', file.contentType.startsWith('image/') ? file.contentType : 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.setHeader('Content-Length', file.buf.length);
      res.end(file.buf);
    });
  }

  function registerGetIdImageIndex() {
    videosRouter.get('/:id/image/:index', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const record = await store.getById(COL, req.params.id);
      if (!record) { res.status(404).end(); return; }
      if (record.tenantId !== tenantId && !await isAdminForAssetRequest(req)) { res.status(404).end(); return; }
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const keys = Array.isArray(analysis.imageObjectKeys) ? analysis.imageObjectKeys.map(String) : [];
      const index = Number(req.params.index);
      let key = Number.isInteger(index) && index >= 0 ? keys[index] : '';
      if (!key && Number.isInteger(index) && index >= 0 && analysis.contentFormat === 'image') {
        key = await recoverCrawlerImageObjectKey(record as Record<string, unknown>, `image-${index + 1}`);
        if (key) {
          const repairedKeys = [...keys];
          repairedKeys[index] = key;
          void store.update(COL, String(record.id), {
            aiAnalysis: JSON.stringify({ ...analysis, imageStorage: 'cos', imageObjectKeys: repairedKeys }),
          });
        }
      }
      if (!key || !await streamCrawlerCosObject(res, key, req.headers.range)) res.status(404).end();
    });
  }

  return { localReferenceVideoPath, ensureLocalReferenceVideoPath, registerGetIdMedia, registerGetIdShotNumberKind, registerGetIdMediaUrl, registerGetIdThumbnail, registerGetIdImageIndex };
}
