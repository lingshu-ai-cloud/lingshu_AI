import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { KeyedWorkQueue } from './keyedWorkQueue.js';
import { readMaterialLibrary, type MaterialRecord } from './materialLibrary.js';
import { readTenantMaterialBytes } from './sentenceReplicationProduction.js';
import { isVerifiedTransparentProductCutout } from './productIdentityPreparation.js';
import { upsertLocalEnterpriseMaterial } from '../routes/enterpriseLocalMaterial.js';
import { readTenantProfile } from '../routes/enterpriseProfileStore.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { upsertTenantUploadCloudMaterial } from './cloudMaterials.js';
import { requestMaterialAnalysis, waitForMaterialAnalysis } from './materialLibraryAnalysis.js';
import { tenantAssetRelativePath } from './assetAccess.js';
import type { MaterialAssetV2Metadata } from '../../shared/contracts/materialAssetV2.js';
import type { EnterpriseProfile } from '../routes/enterpriseProfileContracts.js';

const queue = new KeyedWorkQueue(2);
const states = new Map<string, { status: 'queued' | 'running' | 'completed' | 'failed'; sourceSha256: string; errorCode?: string }>();
const keyOf = (tenantId: string, productId: string) => `${tenantId}:${productId}`;
const jobKeyOf = (tenantId: string, productId: string, sourceSha256: string) => `${keyOf(tenantId, productId)}:${sourceSha256}`;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const exactCutoutMetadata = (): MaterialAssetV2Metadata => ({
  schemaVersion: 'material-asset.v2', assetRole: 'exact_product', contentRole: 'transparent_cutout',
  productIdentityLevel: 'exact', enterpriseCommon: false, subjectRefs: [], sceneType: null,
  personProductContact: null, occlusion: null, cleanPlate: null, cameraMotion: null,
  labelReadability: null, templateEligible: false, reuseScore: 0, segmentCandidates: [],
});

export function productCutoutProcessingState(tenantId: string, productId: string) {
  return states.get(keyOf(tenantId, productId)) || null;
}

export function runLocalProductCutout(source: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const privatePython = path.resolve(process.cwd(), '.venv-product-cutout/bin/python');
    const python = process.env.PRODUCT_CUTOUT_PYTHON || (fs.existsSync(privatePython) ? privatePython : 'python3');
    const child = spawn(python, [path.resolve(process.cwd(), 'scripts/product_cutout.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    const parts: Buffer[] = [];
    let total = 0;
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stdout.on('data', (part: Buffer) => {
      total += part.length;
      if (total > 20 * 1024 * 1024) child.kill('SIGKILL');
      else parts.push(part);
    });
    child.stderr.on('data', (part: Buffer) => { stderr = `${stderr}${part.toString()}`.slice(-2000); });
    child.stdin.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || !parts.length) reject(new Error(`product_cutout_model_failed:${stderr.slice(-200)}`));
      else resolve(Buffer.concat(parts));
    });
    child.stdin.end(source);
  });
}

async function saveCutout(tenantId: string, productId: string, productName: string, sourceSha256: string, bytes: Buffer) {
  const sha256 = digest(bytes);
  const metadata = exactCutoutMetadata();
  const name = `${productName}-透明抠图.png`;
  const provenance = { generatedBy: 'local-rembg-u2netp', cutoutSourceSha256: sourceSha256,
    generatedAt: new Date().toISOString(), productId, materialAssetV2: metadata };
  if (currentDataAuthority() === 'local') {
    const file = tenantAssetRelativePath(tenantId, `product-cutout-${sha256}.png`);
    const target = path.resolve(process.cwd(), 'data/media', file);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { mode: 0o600 });
    return upsertLocalEnterpriseMaterial({ tenantId, title: name, type: 'image', sizeBytes: bytes.length,
      sha256, sourceUrl: `/media/${file}`, sourceName: name, productId, file,
      sourceType: 'enterprise_product_cutout', materialV2: metadata, provenance });
  }
  return upsertTenantUploadCloudMaterial({ tenantId, title: name, folder: 'product', type: 'image',
    sizeBytes: bytes.length, sha256, scope: 'own', usage: 'editable', sourceType: 'enterprise_product_cutout',
    sourceName: name, sourceProvider: 'local-rembg', productId, productName, sourceEntry: 'enterprise_knowledge',
    provenance, materialV2: metadata, media: { name: `product-cutout-${sha256}.png`, buf: bytes, contentType: 'image/png' } });
}

function productIdentity(product: Record<string, unknown>): string {
  return String(product.id || product.productId || product.sku || '').trim();
}

export async function ensureProductCutout(tenantId: string, productId: string, options: {
  wait?: boolean; waitForAnalysis?: boolean; runModel?: (source: Buffer) => Promise<Buffer>;
} = {}): Promise<'ready' | 'processing'> {
  const profile = await readTenantProfile(tenantId);
  const product = (profile.products.items || []).find(item => productIdentity(item as Record<string, unknown>) === productId);
  const productImageUrl = String(product?.images?.[0]?.url || product?.imageUrl || '').trim();
  if (!product || !productImageUrl) throw new Error('product_cutout_source_unavailable');
  const inventory = await readMaterialLibrary(tenantId);
  const source = inventory.items.find(item => item.type === 'image' && item.scope === 'own'
    && String(item.productId || '') === productId
    && [item.sourceUrl, item.url, item.provenance?.enterpriseAssetUrl].map(String).includes(productImageUrl)
    && ['enterprise_product_table', 'enterprise_upload', 'enterprise_product_image_import'].includes(String(item.sourceType || '')));
  if (!source) throw new Error('product_cutout_source_unavailable');
  const loaded = await readTenantMaterialBytes(source, tenantId).catch(() => null);
  if (!loaded || loaded.bytes.length > 20 * 1024 * 1024) throw new Error('product_cutout_source_unavailable');
  const sourceSha256 = digest(loaded.bytes);
  if (sourceSha256 !== String(source.contentSha256 || '').toLowerCase()) throw new Error('product_cutout_source_changed');
  const sourceAlreadyCutout = await isVerifiedTransparentProductCutout(loaded.bytes);
  const sourceMetadata = sourceAlreadyCutout ? exactCutoutMetadata() : undefined;
  const sourceName = `${product.name}-产品图`;
  const sourceProvenance = { productId, sourceImageUrl: productImageUrl,
    ...(sourceAlreadyCutout ? { cutoutSourceSha256: sourceSha256, materialAssetV2Source: 'user' } : {}) };
  const bound = currentDataAuthority() === 'local'
    ? upsertLocalEnterpriseMaterial({ tenantId, title: sourceName, type: 'image', sizeBytes: loaded.bytes.length,
      sha256: sourceSha256, sourceUrl: productImageUrl, sourceName, productId,
      file: source.file, objectKey: source.objectKey, sourceType: 'enterprise_product_table',
      materialV2: sourceMetadata, provenance: sourceProvenance })
    : await upsertTenantUploadCloudMaterial({ tenantId, title: sourceName, folder: 'product', type: 'image',
      sizeBytes: loaded.bytes.length, sha256: sourceSha256, scope: 'own', usage: 'editable',
      sourceType: 'enterprise_product_table', sourceName, sourceProvider: 'tenant',
      sourceUrl: productImageUrl, productId, productName: product.name,
      sourceEntry: 'enterprise_knowledge', provenance: sourceProvenance, materialV2: sourceMetadata,
      media: { name: `${sourceSha256}.png`, buf: loaded.bytes, contentType: loaded.mimeType } });
  const analysis = requestMaterialAnalysis(tenantId, String(bound.id || '')).catch(error =>
    console.warn('[product-cutout] analysis start failed', tenantId, productId, error instanceof Error ? error.message : error));
  const waitForAnalysis = async () => {
    if (options.waitForAnalysis) { await analysis; await waitForMaterialAnalysis(tenantId, String(bound.id || '')); }
  };
  const analysisComplete = async () => {
    await analysis;
    const current = await readMaterialLibrary(tenantId);
    return current.items.some(item => item.id === bound.id && item.segmentAnalysisStatus === 'completed');
  };
  const matchingCutout = inventory.items.find(item => String(item.productId || '') === productId
    && item.type === 'image' && !item.libraryRemovedAt
    && item.provenance?.cutoutSourceSha256 === sourceSha256
    && item.materialV2?.contentRole === 'transparent_cutout');
  if (matchingCutout) {
    const cutout = await readTenantMaterialBytes(matchingCutout, tenantId).catch(() => null);
    if (cutout && digest(cutout.bytes) === matchingCutout.contentSha256
      && await isVerifiedTransparentProductCutout(cutout.bytes)) {
      await waitForAnalysis();
      return options.waitForAnalysis || await analysisComplete() ? 'ready' : 'processing';
    }
  }
  const stateKey = keyOf(tenantId, productId);
  const jobKey = jobKeyOf(tenantId, productId, sourceSha256);
  if (queue.has(jobKey)) {
    if (options.wait) { await queue.get(jobKey); await waitForAnalysis(); return 'ready'; }
    return 'processing';
  }
  const process = async () => {
    states.set(stateKey, { status: 'running', sourceSha256 });
    try {
      const output = await (sourceAlreadyCutout
        ? Promise.resolve(loaded.bytes) : (options.runModel || runLocalProductCutout)(loaded.bytes));
      if (!await isVerifiedTransparentProductCutout(output)) throw new Error('product_cutout_output_invalid');
      await saveCutout(tenantId, productId, product.name, sourceSha256, output);
      states.set(stateKey, { status: 'completed', sourceSha256 });
    } catch (error) {
      const errorCode = error instanceof Error && error.message.startsWith('product_cutout_output_invalid')
        ? 'product_cutout_output_invalid' : 'product_cutout_model_failed';
      states.set(stateKey, { status: 'failed', sourceSha256, errorCode });
      throw new Error(errorCode);
    }
  };
  await queue.enqueue(jobKey, async () => { states.set(stateKey, { status: 'queued', sourceSha256 }); }, process,
    error => console.warn('[product-cutout] processing failed', tenantId, productId, error instanceof Error ? error.message : error));
  if (options.wait) { await queue.get(jobKey); await waitForAnalysis(); return 'ready'; }
  return 'processing';
}

export function startImportedProductCutouts(tenantId: string, profile: EnterpriseProfile, productIds?: ReadonlySet<string>): void {
  for (const product of profile.products.items || []) {
    const id = productIdentity(product as Record<string, unknown>);
    if (!id || !(product.images?.[0]?.url || product.imageUrl) || (productIds && !productIds.has(id))) continue;
    void ensureProductCutout(tenantId, id).catch(error => {
      states.set(keyOf(tenantId, id), { status: 'failed', sourceSha256: '',
        errorCode: error instanceof Error ? error.message : 'product_cutout_start_failed' });
      console.warn('[product-cutout] start failed', tenantId, id, error instanceof Error ? error.message : error);
    });
  }
}
