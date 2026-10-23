import { softDownloadFailure } from '../routes/videoCrawlerPublicProjection.js';
import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { buildDownloadedReferenceMaterial } from '../lib/downloadedReferenceMaterial.js';
import { validatePublicVideoSourceUrl } from '../lib/publicVideoSourceSecurity.js';
import { humanSize, parseJsonRecord, safeMaterialName } from '../routes/videoCrawlerNormalization.js';
import { COL, MEDIA_DIR } from './runtimeConfig.js';
import type { Material } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createMaterialAcquisitionApplication(deps: Pick<VideoApplicationPorts, 'storedCrawlerVideo' | 'extractPoster' | 'probeDuration' | 'persistMaterials' | 'loadMaterials' | 'withDownloadSlot' | 'downloadVideoToMaterial' | 'compressPocketBasePreview' | 'uploadCrawlerCosObject' | 'analyzeDownloadedMaterial'>) {
  const storedCrawlerVideo: VideoApplicationPorts['storedCrawlerVideo'] = (...args) => deps.storedCrawlerVideo(...args);
  const extractPoster: VideoApplicationPorts['extractPoster'] = (...args) => deps.extractPoster(...args);
  const probeDuration: VideoApplicationPorts['probeDuration'] = (...args) => deps.probeDuration(...args);
  const persistMaterials: VideoApplicationPorts['persistMaterials'] = (...args) => deps.persistMaterials(...args);
  const loadMaterials: VideoApplicationPorts['loadMaterials'] = (...args) => deps.loadMaterials(...args);
  function withDownloadSlot<T>(fn: () => Promise<T>): Promise<T> { return deps.withDownloadSlot<T>(fn); }
  const downloadVideoToMaterial: VideoApplicationPorts['downloadVideoToMaterial'] = (...args) => deps.downloadVideoToMaterial(...args);
  const compressPocketBasePreview: VideoApplicationPorts['compressPocketBasePreview'] = (...args) => deps.compressPocketBasePreview(...args);
  const uploadCrawlerCosObject: VideoApplicationPorts['uploadCrawlerCosObject'] = (...args) => deps.uploadCrawlerCosObject(...args);
  const analyzeDownloadedMaterial: VideoApplicationPorts['analyzeDownloadedMaterial'] = (...args) => deps.analyzeDownloadedMaterial(...args);

  async function copyStoredCrawlerVideoToMaterial(input: {
    record: Record<string, unknown>;
    tenantId: string;
    title: string;
    platform: Platform;
    duration: number;
  }): Promise<Material> {
    const stored = await storedCrawlerVideo(input.record);
    if (!stored) throw new Error('站内视频文件暂不可用，请稍后重试');

    const tenantMediaDir = tenantAssetDir(MEDIA_DIR, input.tenantId);
    fs.mkdirSync(tenantMediaDir, { recursive: true });
    const id = randomUUID();
    const videoFile = `${id}.mp4`;
    const posterFile = `${id}.poster.jpg`;
    const videoPath = path.join(tenantMediaDir, videoFile);
    const posterPath = path.join(tenantMediaDir, posterFile);
    fs.writeFileSync(videoPath, stored.buf);
    const posterOk = await extractPoster(videoPath, posterPath, input.duration > 1 ? 1 : 0);
    const createdAt = new Date().toISOString();
    const sourceUrl = String(input.record.sourceUrl || `/api/overseas/videos/${encodeURIComponent(String(input.record.id || ''))}/media`);
    const base = buildDownloadedReferenceMaterial({
      id,
      tenantId: input.tenantId,
      name: safeMaterialName(input.title, input.platform),
      platform: input.platform,
      sourceUrl,
      duration: input.duration || await probeDuration(videoPath),
      size: humanSize(stored.buf.length),
      file: tenantAssetRelativePath(input.tenantId, videoFile),
      poster: posterOk ? tenantAssetRelativePath(input.tenantId, posterFile) : undefined,
      contentSha256: createHash('sha256').update(stored.buf).digest('hex'),
      createdAt,
    });
    const material = {
      ...base,
      provenance: {
        ...base.provenance,
        sourceRecordId: String(input.record.id || ''),
        copiedFromStoredVideo: true,
      },
    } as Material;
    persistMaterials([material, ...loadMaterials().filter(item => item.id !== material.id)]);

    const analysis = parseJsonRecord<Record<string, unknown>>(input.record.aiAnalysis, {});
    await store.update(COL, String(input.record.id || ''), {
      aiAnalysis: JSON.stringify({
        ...analysis,
        materialId: material.id,
        materialUrl: material.url,
        materialPoster: material.poster,
        downloadedAt: createdAt,
        downloadStatus: 'downloaded',
      }),
    });
    return material;
  }

  async function downloadMaterialJob(input: {
    record: Record<string, unknown> | null;
    tenantId: string;
    sourceUrl: string;
    title: string;
    platform: Platform;
    duration: number;
  }): Promise<Material> {
    const source = validatePublicVideoSourceUrl(input.sourceUrl, input.platform);
    if (!source) throw new Error('unsafe_public_video_source');
    if (!input.tenantId.trim()) throw new Error('download_material_tenant_missing');
    return withDownloadSlot(() => downloadMaterialJobInner({ ...input, ...source }));
  }

  async function downloadMaterialJobInner(input: {
    record: Record<string, unknown> | null;
    tenantId: string;
    sourceUrl: string;
    title: string;
    platform: Platform;
    duration: number;
  }): Promise<Material> {
    const recordId = input.record?.id ? String(input.record.id) : '';
    try {
      if (recordId) {
        const analysis = parseJsonRecord(input.record?.aiAnalysis, {});
        await store.update(COL, recordId, {
          status: 'pending' as VideoStatus,
          aiAnalysis: JSON.stringify({ ...analysis, downloadStatus: 'downloading', downloadStartedAt: new Date().toISOString() }),
        });
      }

      const material = await downloadVideoToMaterial(input);
      if (recordId) {
        const localVideoPath = path.join(MEDIA_DIR, material.file);
        if (!fs.existsSync(localVideoPath)) throw new Error('Downloaded video file missing before PocketBase upload');
        const previewPath = await compressPocketBasePreview(localVideoPath);
        const pocketBaseFilename = await uploadCrawlerCosObject(recordId, 'video', fs.readFileSync(previewPath), 'video/mp4');
        try { fs.unlinkSync(previewPath); } catch { /* best effort */ }
        if (!pocketBaseFilename) throw new Error('PocketBase video persistence failed');
        const analysis = parseJsonRecord(input.record?.aiAnalysis, {});
        await store.update(COL, recordId, {
          videoFileId: pocketBaseFilename,
          thumbnailUrl: material.poster || String(input.record?.thumbnailUrl || ''),
          aiAnalysis: JSON.stringify({
            ...analysis,
            materialId: material.id,
            materialUrl: `/api/overseas/videos/${recordId}/media`,
            videoStorage: 'cos',
            videoObjectKey: pocketBaseFilename,
            materialPoster: material.poster,
            downloadedAt: material.createdAt,
            downloadStatus: 'downloaded',
          }),
        });
        void analyzeDownloadedMaterial(recordId, path.join(MEDIA_DIR, material.file), material);
      }
      return material;
    } catch (e) {
      const soft = softDownloadFailure(input.platform, e);
      if (recordId) {
        const analysis = parseJsonRecord(input.record?.aiAnalysis, {});
        await store.update(COL, recordId, {
          status: soft ? 'pending' as VideoStatus : 'failed' as VideoStatus,
          aiAnalysis: JSON.stringify({
            ...analysis,
            downloadStatus: soft ? soft.status : 'failed',
            downloadError: e instanceof Error ? e.message : 'Video download failed',
          }),
        });
      }
      throw e;
    }
  }

  return { copyStoredCrawlerVideoToMaterial, downloadMaterialJob };
}
