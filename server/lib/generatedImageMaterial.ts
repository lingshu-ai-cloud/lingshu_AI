import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { imageExt } from './imageGen.js';
import { tenantAssetDir, tenantAssetRelativePath } from './assetAccess.js';
import { readLocalMaterials, saveLocalMaterials } from './materialLibrary.js';
import { materialAssetObjectKey } from '../storage/materialAssets.js';
import { objectStorageEnabled, objectStorageUpload } from '../storage/objectStorage.js';

export interface GeneratedImageMaterial {
  id: string;
  name: string;
  folder: string;
  type: 'image';
  duration: number;
  size: string;
  file: string;
  url: string;
  poster?: string;
  objectKey?: string;
  posterObjectKey?: string;
  scope: 'own';
  tenantId: string;
  sourceType: string;
  sourceProvider: string;
  contentSha256: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  productId?: string;
  productName?: string;
  rightsStatus: 'authorized';
  rightsEvidenceRef: string;
  licenseEvidence: string;
  commercialUseApproved: true;
  derivativesApproved: true;
  rawLibraryUseApproved: true;
  provenance: Record<string, unknown>;
  createdAt: string;
}

const MEDIA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/media');

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The Studio render route and deterministic GIF delivery share one material writer. */
export async function createGeneratedImageMaterial(input: {
  title: string;
  bytes: Buffer;
  mimeType: string;
  source?: string;
  tenantId: string;
  sourceType?: string;
  productId?: string;
  productName?: string;
  provenance?: Record<string, unknown>;
  mediaRoot?: string;
}): Promise<GeneratedImageMaterial> {
  const outputDir = tenantAssetDir(input.mediaRoot || MEDIA_ROOT, input.tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const id = randomUUID();
  const filename = `${id}.${imageExt(input.mimeType)}`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, input.bytes);
  const contentSha256 = createHash('sha256').update(input.bytes).digest('hex');
  const metadata = await sharp(input.bytes).metadata().catch(() => null);
  const rightsEvidenceRef = `generated:${input.source || 'image-model'}:${contentSha256}`;
  const relativeFile = tenantAssetRelativePath(input.tenantId, filename);
  const material: GeneratedImageMaterial = {
    id,
    name: input.title || 'AI 图文海报',
    folder: 'product',
    type: 'image',
    duration: 0,
    size: humanSize(input.bytes.length),
    file: relativeFile,
    url: `/media/${relativeFile}`,
    poster: `/media/${relativeFile}`,
    scope: 'own',
    tenantId: input.tenantId,
    sourceType: input.sourceType || 'ai_generated_image',
    sourceProvider: input.source || 'image-model',
    contentSha256,
    width: metadata?.width,
    height: metadata?.height,
    ...(metadata?.width && metadata.height ? { aspectRatio: metadata.width / metadata.height } : {}),
    ...(input.productId ? { productId: input.productId } : {}),
    ...(input.productName ? { productName: input.productName } : {}),
    rightsStatus: 'authorized',
    rightsEvidenceRef,
    licenseEvidence: rightsEvidenceRef,
    commercialUseApproved: true,
    derivativesApproved: true,
    rawLibraryUseApproved: true,
    provenance: {
      schemaVersion: 'generated-image-lineage.v1',
      generatedAt: new Date().toISOString(),
      provider: input.source || 'image-model',
      ...(input.provenance || {}),
    },
    createdAt: new Date().toISOString(),
  };
  if (objectStorageEnabled()) {
    material.objectKey = materialAssetObjectKey(input.tenantId, filename);
    material.posterObjectKey = material.objectKey;
    await objectStorageUpload({ key: material.objectKey, body: input.bytes, contentType: input.mimeType });
    material.url = '';
    material.poster = undefined;
    fs.rmSync(filePath, { force: true });
  }
  const list = readLocalMaterials().filter(item => item.id !== material.id);
  list.push(material);
  saveLocalMaterials(list);
  console.log(`[studio] generated poster image material ${material.id} via ${input.source || 'image-model'}`);
  return material;
}
