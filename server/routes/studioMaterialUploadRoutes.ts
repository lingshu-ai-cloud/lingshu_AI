import { tenantUploadUsesReservedOrigin } from '../lib/industryMaterialAccess.js';
import { materialResponse, type Material } from './studioMaterialProjection.js';
import { productSceneUploadErrorResponse, resolveMaterialUploadProductBinding, resolveProductSceneUploadIntent, verifyProductSceneUpload, type MaterialUploadProductBinding, type ProductSceneUploadIntent, type VerifiedProductSceneUpload } from './studioProductSceneUpload.js';
import { requestMaterialAnalysis } from '../lib/materialLibraryAnalysis.js';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type AuthLocals } from '../middleware/auth.js';
import { materialAssetContentType, materialAssetTypeAllowed } from '../storage/materialAssets.js';
import { MAX_MATERIAL_UPLOAD_BYTES } from '../studio/runtimeConfig.js';
import type { StudioApplicationPorts } from '../studio/applicationPorts.js';

export function createStudioMaterialUploadRoutes(deps: Pick<StudioApplicationPorts, 'studioRouter' | 'materialUploadFileName' | 'saveMaterialUploadToDatabase'>) {
  const studioRouter = deps.studioRouter;
  const materialUploadFileName: StudioApplicationPorts['materialUploadFileName'] = (...args) => deps.materialUploadFileName(...args);
  const saveMaterialUploadToDatabase: StudioApplicationPorts['saveMaterialUploadToDatabase'] = (...args) => deps.saveMaterialUploadToDatabase(...args);

  function registerPostMaterialsFile() {
    studioRouter.post('/materials/file', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      if (tenantUploadUsesReservedOrigin(req.query as Record<string, unknown>)) { res.status(403).json({ ok: false, error: '官方行业素材与系统生成来源不能通过用户上传设置' }); return; }
      const name = String(req.query.name || '').trim();
      const folder = String(req.query.folder || 'upload').trim() || 'upload';
      const type = String(req.query.type || '');
      const duration = Number(req.query.duration || 0);
      const width = Number(req.query.width || 0);
      const height = Number(req.query.height || 0);
      const mimeType = String(req.query.mimeType || req.headers['x-material-mime-type'] || '');
      const usage = String(req.query.usage || '');
      const sourceType = String(req.query.sourceType || '');
      const sourceUrl = String(req.query.sourceUrl || '');
      const rightsConfirmed = String(req.query.rightsConfirmed || '') === '1';
      if (!['video', 'image', 'audio'].includes(type)) {
        res.status(400).json({ ok: false, error: 'invalid type' });
        return;
      }
      let productSceneIntent: ProductSceneUploadIntent | undefined;
      let productBinding: MaterialUploadProductBinding | undefined;
      try {
        productSceneIntent = await resolveProductSceneUploadIntent({
          tenantId,
          type,
          sourceType,
          productId: req.query.productId,
          productSceneType: req.query.productSceneType,
        });
        productBinding = productSceneIntent ? undefined : await resolveMaterialUploadProductBinding(tenantId, req.query.productId);
      } catch (error) {
        const response = productSceneUploadErrorResponse(error);
        res.status(response?.status || 503).json({ ok: false, error: response?.message || '产品资料暂不可读取，请稍后重试' });
        return;
      }

      const declaredLength = Number(req.headers['content-length'] || 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MATERIAL_UPLOAD_BYTES) {
        res.status(413).json({ ok: false, error: '单个素材不能超过 100 MB' });
        return;
      }

      const file = materialUploadFileName(type as Material['type'], mimeType);
      const contentType = materialAssetContentType(file, mimeType);
      if (!materialAssetTypeAllowed(contentType)) {
        res.status(415).json({ ok: false, error: 'unsupported material type' });
        return;
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-upload-'));
      const storedPath = path.join(tempDir, file);

      let bytes = 0;
      const digest = createHash('sha256');
      const sizeLimiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_MATERIAL_UPLOAD_BYTES) {
            const error = Object.assign(new Error('material upload too large'), { code: 'MATERIAL_TOO_LARGE' });
            callback(error);
            return;
          }
          digest.update(chunk);
          callback(null, chunk);
        },
      });
      try {
        await pipeline(req, sizeLimiter, fs.createWriteStream(storedPath, { flags: 'wx' }));
      } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        const tooLarge = (error as NodeJS.ErrnoException)?.code === 'MATERIAL_TOO_LARGE';
        res.status(tooLarge ? 413 : 400).json({
          ok: false,
          error: tooLarge ? '单个素材不能超过 100 MB' : '素材上传中断，请重试',
        });
        return;
      }
      if (!bytes) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        res.status(400).json({ ok: false, error: '素材文件为空' });
        return;
      }

      const sha256 = digest.digest('hex');
      let productScene: VerifiedProductSceneUpload | undefined;
      try {
        productScene = await verifyProductSceneUpload(productSceneIntent, storedPath, sha256);
      } catch (error) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        const response = productSceneUploadErrorResponse(error);
        res.status(response?.status || 422).json({ ok: false, error: response?.message || '视频文件校验失败' });
        return;
      }

      try {
        const material = await saveMaterialUploadToDatabase({
          tenantId, name, folder, type: type as Material['type'], duration, width, height,
          usage, sourceType, sourceUrl, mimeType: contentType, mediaName: file,
          mediaPath: storedPath, sizeBytes: bytes, sha256, tempDirectory: tempDir, productScene, productBinding, rightsConfirmed,
        });
        if (['video', 'image'].includes(material.type)) {
          void requestMaterialAnalysis(tenantId, material.id).catch(() => {});
        }
        res.status(201).json({ ok: true, material: await materialResponse(material, tenantId) });
      } catch (error) {
        console.error('[materials] database upload failed', error instanceof Error ? error.message : error);
        res.status(503).json({ ok: false, error: '素材数据库暂时不可用，请稍后重试' });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }

  return { registerPostMaterialsFile };
}
