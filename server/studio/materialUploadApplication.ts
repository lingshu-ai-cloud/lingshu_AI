import { productSceneMaterialBindingChanges, recordObject } from '../routes/studioProductSceneProvenance.js';
import { type Material } from '../routes/studioMaterialProjection.js';
import { PRODUCT_SCENE_UPLOAD_SOURCE, productSceneUploadReuseMetadata, type MaterialUploadProductBinding, type VerifiedProductSceneUpload } from '../routes/studioProductSceneUpload.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { type MaterialUsage } from '../lib/materialPolicy.js';
import { upsertTenantUploadCloudMaterial } from '../lib/cloudMaterials.js';
import { objectStorageEnabled, objectStorageEnsureFile } from '../storage/objectStorage.js';
import { materialContentAddressedObjectKey, materialPosterObjectKey } from '../storage/materialAssets.js';

import type { StudioApplicationPorts } from './applicationPorts.js';

export function createMaterialUploadApplication(deps: Pick<StudioApplicationPorts, 'extractPoster'>) {
  const extractPoster: StudioApplicationPorts['extractPoster'] = (...args) => deps.extractPoster(...args);

  function materialUploadFileName(type: Material['type'], mimeType: string): string {
    const id = randomUUID();
    const subtype = mimeType.split('/', 2)[1]?.replace('quicktime', 'mov').replace(/[^a-z0-9]/gi, '');
    const extension = subtype || (type === 'image' ? 'jpg' : type === 'audio' ? 'mp3' : 'mp4');
    return `${id}.${extension}`;
  }

  async function createTransientMaterialPoster(input: {
    directory: string;
    mediaPath: string;
    type: Material['type'];
    duration: number;
  }): Promise<{ name: string; path: string; contentType: string }> {
    const jpgPath = path.join(input.directory, 'poster.jpg');
    if (input.type !== 'audio') {
      const ok = await extractPoster(input.mediaPath, jpgPath, input.type === 'video' && input.duration > 1 ? 1 : 0);
      if (ok && fs.statSync(jpgPath).size <= 5 * 1024 * 1024) {
        return { name: 'poster.jpg', path: jpgPath, contentType: 'image/jpeg' };
      }
      fs.rmSync(jpgPath, { force: true });
    }
    // Audio and unreadable/unsupported previews get a tiny neutral placeholder;
    // the original media still remains the sole playback authority.
    const pngPath = path.join(input.directory, 'poster.png');
    fs.writeFileSync(pngPath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    return { name: 'poster.png', path: pngPath, contentType: 'image/png' };
  }

  async function saveMaterialUploadToDatabase(input: {
    tenantId: string;
    name: string;
    folder: string;
    type: Material['type'];
    duration: number;
    width: number;
    height: number;
    usage: string;
    sourceType: string;
    sourceUrl: string;
    mimeType: string;
    mediaName: string;
    mediaPath: string;
    sizeBytes: number;
    sha256: string;
    tempDirectory: string;
    productScene?: VerifiedProductSceneUpload;
    productBinding?: MaterialUploadProductBinding;
    rightsConfirmed?: boolean;
  }): Promise<Material> {
    const requestedUsage: MaterialUsage = 'editable';
    if (input.productScene && input.productScene.contentSha256 !== input.sha256.toLowerCase()) {
      throw new Error('product_scene_upload_hash_mismatch');
    }
    const productSceneReuse = productSceneUploadReuseMetadata(input.productScene);
    if (input.productScene && !productSceneReuse.licenseEvidence) {
      throw new Error('product_scene_upload_verification_invalid');
    }
    const sourceType = input.productScene ? PRODUCT_SCENE_UPLOAD_SOURCE : input.sourceType || 'tenant_upload';
    const productBinding = input.productScene || input.productBinding;
    const rightsEvidence = input.productScene
      ? productSceneReuse.licenseEvidence
      : input.rightsConfirmed ? `tenant-upload-confirmation:${input.tenantId}:${input.sha256}` : undefined;
    const rightsConfirmed = Boolean(input.productScene || input.rightsConfirmed);
    const duration = input.productScene?.durationSeconds ?? (Number.isFinite(input.duration) ? Math.max(0, input.duration) : 0);
    const width = input.productScene?.width ?? input.width;
    const height = input.productScene?.height ?? input.height;
    const baseProvenance: Record<string, unknown> = {
      uploadMethod: 'studio_my_materials',
      sourceEntry: 'studio_workspace',
      originalName: input.name || input.mediaName,
      mimeType: input.mimeType,
      receivedAt: new Date().toISOString(),
      ...(rightsConfirmed ? {
        rightsConfirmation: {
          schemaVersion: 'tenant-material-rights-confirmation.v1',
          confirmedAt: new Date().toISOString(),
          scope: ['commercial_use', 'derivative_use', 'model_input'],
          evidenceRef: rightsEvidence,
        },
      } : {}),
      ...(productSceneReuse.authorizationScopes ? { authorizationScopes: productSceneReuse.authorizationScopes } : {}),
    };
    const productSceneChanges = input.productScene
      ? productSceneMaterialBindingChanges({
        material: { provenance: baseProvenance },
        productId: input.productScene.productId,
        productName: input.productScene.productName,
        kind: input.productScene.kind,
        verification: input.productScene,
      })
      : {};
    const poster = await createTransientMaterialPoster({
      directory: input.tempDirectory,
      mediaPath: input.mediaPath,
      type: input.type,
      duration,
    });

    if (!objectStorageEnabled()) throw new Error('对象存储未配置，素材文件不会写入数据库文件字段');
    const objectKey = materialContentAddressedObjectKey(input.tenantId, input.sha256, input.mediaName);
    const storedMedia = await objectStorageEnsureFile({
      key: objectKey,
      filePath: input.mediaPath,
      contentType: input.mimeType,
      contentLength: input.sizeBytes,
    });
    const posterStat = fs.statSync(poster.path);
    const posterKey = materialPosterObjectKey(input.tenantId, input.sha256, poster.name);
    const storedPoster = await objectStorageEnsureFile({
      key: posterKey,
      filePath: poster.path,
      contentType: poster.contentType,
      contentLength: posterStat.size,
    });
    const material = await upsertTenantUploadCloudMaterial({
      tenantId: input.tenantId,
      title: input.name || input.mediaName,
      folder: input.folder,
      type: input.type,
      duration,
      width: width > 0 ? Math.round(width) : undefined,
      height: height > 0 ? Math.round(height) : undefined,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      scope: 'own',
      usage: requestedUsage,
      sourceType,
      sourceName: input.name || input.mediaName,
      sourceProvider: 'tenant',
      sourceUrl: input.sourceUrl || undefined,
      productId: productBinding?.productId,
      productName: productBinding?.productName,
      tags: typeof productSceneChanges.tags === 'string' ? productSceneChanges.tags : undefined,
      shotFunction: typeof productSceneChanges.shotFunction === 'string' ? productSceneChanges.shotFunction : undefined,
      licenseEvidence: rightsEvidence,
      commercialUseApproved: rightsConfirmed,
      derivativesApproved: rightsConfirmed,
      rawLibraryUseApproved: rightsConfirmed,
      provenance: recordObject(productSceneChanges.provenance || baseProvenance),
      sourceEntry: 'studio_workspace',
      ...((input.productScene || input.productBinding || rightsConfirmed) ? {
        verifiedDeduplicatedUpdate: {
          title: input.name || input.mediaName,
          folder: input.folder,
          type: input.type,
          duration,
          width: width > 0 ? Math.round(width) : 0,
          height: height > 0 ? Math.round(height) : 0,
          sourceType,
          sourceName: input.name || input.mediaName,
          productId: productBinding?.productId,
          productName: productBinding?.productName,
          tags: typeof productSceneChanges.tags === 'string' ? productSceneChanges.tags : undefined,
          shotFunction: typeof productSceneChanges.shotFunction === 'string' ? productSceneChanges.shotFunction : undefined,
          licenseEvidence: rightsEvidence,
          commercialUseApproved: rightsConfirmed,
          derivativesApproved: rightsConfirmed,
          rawLibraryUseApproved: rightsConfirmed,
        },
      } : {}),
      media: { key: objectKey, etag: storedMedia.head.etag, contentType: input.mimeType },
      poster: { key: posterKey, etag: storedPoster.head.etag, contentType: poster.contentType },
    });
    return material as unknown as Material;
  }

  return { materialUploadFileName, saveMaterialUploadToDatabase };
}
