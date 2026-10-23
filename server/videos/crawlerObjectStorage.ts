import { type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { store } from '../storage/index.js';
import { fetchFile } from '../storage/files.js';
import { objectStorageEnabled, objectStorageDownload, objectStorageGetObject, objectStorageHead, objectStorageUpload } from '../storage/objectStorage.js';
import { parseJsonRecord } from '../routes/videoCrawlerNormalization.js';
import { COL, MEDIA_DIR } from './runtimeConfig.js';

export function crawlerCosKey(record: Record<string, unknown>, role: string, extension: string): string {
  const tenantId = String(record.tenantId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const recordId = String(record.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeRole = role.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
  return `crawlers/tenants/${tenantId}/trend-videos/${recordId}/${safeRole}.${safeExtension}`;
}

export async function uploadCrawlerCosObject(
  recordId: string,
  role: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  if (!objectStorageEnabled()) throw new Error('COS object storage is not configured for crawler media');
  const record = await store.getById<Record<string, unknown>>(COL, recordId);
  if (!record) throw new Error(`Crawler record not found before COS upload: ${recordId}`);
  const extension = contentType.includes('webp') ? 'webp'
    : contentType.includes('png') ? 'png'
      : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
        : contentType.includes('mp4') ? 'mp4' : 'bin';
  const key = crawlerCosKey(record, role, extension);
  await objectStorageUpload({ key, body, contentType });
  const verified = await objectStorageHead(key);
  if (!verified || verified.size !== body.length) throw new Error(`COS crawler upload verification failed: ${key}`);
  return key;
}

export async function recoverCrawlerImageObjectKey(
  record: Record<string, unknown>,
  role: string,
): Promise<string> {
  if (!objectStorageEnabled()) return '';
  for (const extension of ['jpg', 'png', 'webp']) {
    const key = crawlerCosKey(record, role, extension);
    if (await objectStorageHead(key)) return key;
  }
  return '';
}

export async function streamCrawlerCosObject(res: Response, key: string, range?: string): Promise<boolean> {
  const object = await objectStorageGetObject(key, range);
  if (!object) return false;
  res.status(object.contentRange ? 206 : 200);
  res.setHeader('Content-Type', object.contentType || 'application/octet-stream');
  res.setHeader('Accept-Ranges', object.acceptRanges || 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (object.contentLength !== undefined) res.setHeader('Content-Length', object.contentLength);
  if (object.contentRange) res.setHeader('Content-Range', object.contentRange);
  for await (const chunk of object.body) res.write(chunk);
  res.end();
  return true;
}

export async function storedCrawlerVideo(record: Record<string, unknown>): Promise<{ buf: Buffer; contentType: string } | null> {
  const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
  const objectKey = String(analysis.videoObjectKey || '').trim();
  if (objectKey) {
    try {
      const stored = await objectStorageDownload(objectKey);
      if (stored?.buf.length) return { buf: stored.buf, contentType: stored.contentType || 'video/mp4' };
    } catch (error) {
      console.warn('[videos] stored favorite COS read failed, trying local/PocketBase copy:', error instanceof Error ? error.message : error);
    }
  }

  const filename = String(record.videoFileId || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const recordTenantId = String(record.tenantId || '').trim();
  if (filename && recordTenantId) {
    const expectedPrefix = `tenants/${recordTenantId}/`;
    const tenantRoot = path.resolve(MEDIA_DIR, 'tenants', recordTenantId);
    const localPath = path.resolve(MEDIA_DIR, filename);
    if (filename.startsWith(expectedPrefix)
      && localPath.startsWith(`${tenantRoot}${path.sep}`)
      && fs.existsSync(localPath)
      && fs.statSync(localPath).isFile()) {
      return { buf: fs.readFileSync(localPath), contentType: 'video/mp4' };
    }
  }
  if (!filename) return null;
  const stored = await fetchFile(COL, String(record.id || ''), filename);
  return stored?.buf.length ? { buf: stored.buf, contentType: stored.contentType || 'video/mp4' } : null;
}
