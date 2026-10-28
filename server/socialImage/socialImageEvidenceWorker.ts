import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type {
  SocialImageAssetManifest,
  SocialImageElementInventory,
  SocialImageVersionedRef,
} from '../../shared/contracts/socialImageProduction.js';

export type SocialImageOcrBlock = {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
};

export type SocialImageOcrPort = (input: { bytes: Buffer; mimeType: string }) => Promise<SocialImageOcrBlock[]>;

export interface SocialImageAssetAuthorization {
  rightsStatus: 'authorized' | 'owned' | 'restricted' | 'unknown';
  rightsEvidenceRef: string;
  commercialUseApproved: boolean;
  derivativesApproved: boolean;
}

/** A product image resolved from this tenant's enterprise profile is owned input; no separate license annotation is required. */
export function enterpriseProductImageAuthorization(tenantId: string, productId: string): SocialImageAssetAuthorization {
  return { rightsStatus: 'owned', rightsEvidenceRef: `enterprise_profile:${tenantId}:product:${productId}`,
    commercialUseApproved: true, derivativesApproved: true };
}

/** Authorization is read from the tenant's persisted inventory, not the image or task patch. */
export function socialImageAssetAuthorization(record: Record<string, unknown> | null, tenantId: string): SocialImageAssetAuthorization | null {
  if (!record || String(record.tenantId || record.tenant_id || '') !== tenantId || record.scope === 'shared') return null;
  const rightsStatus = String(record.rightsStatus || 'unknown');
  const rightsEvidenceRef = String(record.rightsEvidenceRef || record.licenseEvidence || '').trim();
  if (!['authorized', 'owned'].includes(rightsStatus) || !rightsEvidenceRef
    || /^(?:unknown|unverified|pending)(?:$|:)/i.test(rightsEvidenceRef)
    || record.commercialUseApproved !== true || record.derivativesApproved !== true
    || (record.modelInputAllowed !== true && record.rawLibraryUseApproved !== true)) return null;
  return { rightsStatus: rightsStatus as 'authorized' | 'owned', rightsEvidenceRef,
    commercialUseApproved: true, derivativesApproved: true };
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const rounded = (value: number) => Number(value.toFixed(4));

async function decodedImage(bytes: Buffer) {
  const normalized = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().toBuffer({ resolveWithObject: true });
  const width = Number(normalized.info.width || 0), height = Number(normalized.info.height || 0);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || width * height > 16_000_000) throw new Error('social_image_asset_decode_failed');
  return { bytes: normalized.data, width, height };
}
export async function inspectSocialImageAsset(input: {
  assetId: string;
  role: SocialImageAssetManifest['assets'][number]['role'];
  required: boolean;
  bytes: Buffer | null;
  mimeType: string;
  version?: string | number;
  expectedContentHash?: string;
  authorization?: SocialImageAssetAuthorization | null;
  ocr?: SocialImageOcrPort;
}): Promise<SocialImageAssetManifest['assets'][number]> {
  if (!input.bytes?.length) return {
    assetId: input.assetId, version: input.version || 1, contentHash: '', role: input.role,
    required: input.required, readable: false, dimensions: null, rights: 'unknown', observedSubjects: [], ocr: [], confidence: 0,
  };
  try {
    const decoded = await decodedImage(input.bytes);
    const contentHash = sha256(input.bytes);
    const expectedHash = String(input.expectedContentHash || '').trim().toLowerCase();
    const hashMatches = !expectedHash || expectedHash === contentHash;
    const authorized = input.authorization && ['authorized', 'owned'].includes(input.authorization.rightsStatus)
      && input.authorization.commercialUseApproved === true && input.authorization.derivativesApproved === true
      && Boolean(input.authorization.rightsEvidenceRef.trim());
    let ocr: string[] = [];
    if (input.ocr) {
      try { ocr = (await input.ocr({ bytes: input.bytes, mimeType: input.mimeType })).map(block => block.text.trim()).filter(Boolean); }
      catch { /* OCR inability is represented by an empty observation, never a pass. */ }
    }
    return {
      assetId: input.assetId, version: input.version || 1, contentHash, role: input.role,
      required: input.required, readable: hashMatches, dimensions: { width: decoded.width, height: decoded.height },
      rights: hashMatches && authorized ? 'cleared' : input.authorization?.rightsStatus === 'restricted' ? 'restricted' : 'unknown',
      ...(hashMatches && authorized ? { rightsEvidenceRef: input.authorization!.rightsEvidenceRef } : {}),
      observedSubjects: [], ocr: [...new Set(ocr)].slice(0, 40),
      confidence: hashMatches ? 1 : 0,
    };
  } catch {
    return {
      assetId: input.assetId, version: input.version || 1, contentHash: sha256(input.bytes), role: input.role,
      required: input.required, readable: false, dimensions: null, rights: 'unknown', observedSubjects: [], ocr: [], confidence: 0,
    };
  }
}

function regionLabel(column: number, row: number) {
  const vertical = ['top', 'middle', 'bottom'][row] || 'middle';
  const horizontal = ['left', 'center', 'right'][column] || 'center';
  return `${vertical}_${horizontal}`;
}

async function regionObservation(input: { bytes: Buffer; width: number; height: number; row: number; column: number }) {
  const left = Math.floor(input.width * input.column / 3), top = Math.floor(input.height * input.row / 3);
  const right = Math.floor(input.width * (input.column + 1) / 3), bottom = Math.floor(input.height * (input.row + 1) / 3);
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  const crop = await sharp(input.bytes).extract({ left, top, width, height }).png().toBuffer();
  const { data, info } = await sharp(crop).greyscale().resize({ width: 96, height: 96, fit: 'fill' }).raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0, sumSquares = 0, edges = 0, comparisons = 0;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const value = data[y * info.width + x]!;
    sum += value; sumSquares += value * value;
    if (x > 0) { edges += Math.abs(value - data[y * info.width + x - 1]!); comparisons += 1; }
    if (y > 0) { edges += Math.abs(value - data[(y - 1) * info.width + x]!); comparisons += 1; }
  }
  const count = info.width * info.height, mean = sum / count;
  const contrast = Math.sqrt(Math.max(0, sumSquares / count - mean * mean)) / 127.5;
  const edgeDensity = comparisons ? edges / comparisons / 255 : 0;
  const saliency = Math.min(1, contrast * .65 + edgeDensity * .35);
  const bbox = { x: rounded(left / input.width), y: rounded(top / input.height),
    width: rounded(width / input.width), height: rounded(height / input.height) };
  return { bbox, cropHash: sha256(crop), luminance: rounded(mean / 255), contrast: rounded(contrast),
    edgeDensity: rounded(edgeDensity), saliency: rounded(saliency) };
}

export async function analyzeSocialImageReference(input: {
  bytes: Buffer;
  mimeType: string;
  referenceId: string;
  ocr?: SocialImageOcrPort;
}): Promise<SocialImageElementInventory> {
  const decoded = await decodedImage(input.bytes);
  const regions = [] as SocialImageElementInventory['regions'];
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    const observed = await regionObservation({ bytes: decoded.bytes, width: decoded.width, height: decoded.height, row, column });
    const regionId = `${input.referenceId}:${regionLabel(column, row)}`;
    regions.push({ regionId, bbox: observed.bbox, layerRole: regionLabel(column, row), observedContent: 'machine_visual_region',
      toolScores: { saliency: observed.saliency, luminance: observed.luminance, contrast: observed.contrast, edgeDensity: observed.edgeDensity },
      evidenceRef: { objectType: 'social-image-region-crop', id: regionId, version: 1, contentHash: observed.cropHash } });
  }
  let ocrBlocks: SocialImageOcrBlock[] = [];
  if (input.ocr) {
    try { ocrBlocks = (await input.ocr({ bytes: input.bytes, mimeType: input.mimeType })).filter(block => block.text.trim()); }
    catch { /* Persist an empty OCR observation instead of fabricating text. */ }
  }
  const stats = await sharp(decoded.bytes).stats();
  const means = stats.channels.slice(0, 3).map(channel => rounded(channel.mean));
  const saliencyOrder = [...regions].sort((left, right) => Number(right.toolScores.saliency || 0) - Number(left.toolScores.saliency || 0))
    .map(region => region.regionId);
  const sourceRef: SocialImageVersionedRef = { objectType: 'social-image-reference', id: input.referenceId,
    version: 1, contentHash: sha256(input.bytes) };
  return {
    canvas: { width: decoded.width, height: decoded.height, aspectRatio: `${decoded.width}:${decoded.height}` },
    regions,
    ocrBlocks: ocrBlocks.slice(0, 80).map(block => ({ text: block.text.trim().slice(0, 500), bbox: block.bbox,
      confidence: Math.max(0, Math.min(1, block.confidence)) })),
    saliencyOrder,
    composition: { grid: '3x3', highestSaliencyRegion: saliencyOrder[0] || null },
    colorAndLighting: { meanRgb: means, isDark: means.reduce((sum, value) => sum + value, 0) / Math.max(1, means.length) < 110 },
    informationHierarchy: [...ocrBlocks].sort((left, right) => right.bbox.width * right.bbox.height - left.bbox.width * left.bbox.height)
      .map(block => block.text.trim()).filter(Boolean).slice(0, 12),
    observations: regions.map(region => ({ kind: 'observed' as const,
      description: `${region.layerRole} saliency=${region.toolScores.saliency}`,
      evidenceRefs: [region.evidenceRef, sourceRef] })),
    analysisConfidence: 1,
  };
}

export function socialImageAssetManifest(input: {
  assets: SocialImageAssetManifest['assets'];
  prohibitedClaims?: string[];
  ocrAvailable: boolean;
}): SocialImageAssetManifest {
  return {
    enterpriseFactSnapshotRef: null,
    assets: input.assets,
    requiredEvidence: input.assets.filter(asset => asset.required).map(asset => asset.assetId),
    missingCapabilities: input.ocrAvailable ? [] : ['local_ocr_unavailable'],
    prohibitedClaims: input.prohibitedClaims || [],
  };
}
