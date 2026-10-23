import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import sharp from 'sharp';
import type { AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readSocialImageTask, socialImageClientOutputPatchIssue, updateSocialImageTask } from '../socialImage/socialImageTask.js';
import { socialImageOwnedMaterialUrl, socialImageQueuedJobIssue, SocialImagePaidJobError } from '../socialImage/socialImagePaidJob.js';
import { recoverSocialImagePaidMaterial } from '../socialImage/socialImageMaterialRecovery.js';
import { abandonSocialImageMultiUnitPlan, persistSocialImageMultiUnitPlan } from '../socialImage/socialImageDurablePlan.js';
import { finalizeSocialImageGif } from '../socialImage/socialImageGifDelivery.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { mergeSocialImageVisualChecks, socialImageCandidateOcrCheck, socialImageCandidatePixelChecks,
  socialImageDeterministicChecks } from '../socialImage/socialImageQuality.js';
import { qualityCheckSocialImageWithQwen } from '../agents/qwen.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import { SOCIAL_IMAGE_HARD_CHECKS, socialImageCurrentOutputs, type SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';
import { compileLuxuryProductHero } from '../socialImage/templates/luxuryProductHero.js';
import { assertSocialImageLayerGraph } from '../socialImage/layerGraphValidation.js';
import { renderSocialImageLayerGraph } from '../socialImage/layerRenderer.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { objectStorageDownload, objectStorageEnabled } from '../storage/objectStorage.js';
import {
  createOrResumeBoundSocialImageRun,
  createSocialImageDeliveryPackage,
  decideSocialImageCandidate,
  recordSocialImageBusinessContext,
  recordSocialImageNodeOutput,
  refreshSocialImageContentTaskBinding,
  runSocialImageDirectorReview,
  SocialImageProductionRunError,
} from '../socialImage/socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from '../socialImage/socialImageProductionRuntime.js';
import { analyzeSocialImageReference, inspectSocialImageAsset, socialImageAssetManifest } from '../socialImage/socialImageEvidenceWorker.js';
import { compileSocialImageReferencePlan, inspectSocialImageCandidateFactors,
  prepareSocialImageReferenceStrategy, socialImageFrozenGraphMatches, socialImageFrozenSourceIssue } from '../socialImage/socialImageReferenceStrategy.js';
import { localProductOcrReadiness, recognizeProductImageLocally, recognizeProductImageTokensLocally } from '../lib/localProductOcr.js';

export const socialImageRouter = Router();

const renderRoot = (tenantId: string) => path.resolve(process.cwd(), 'data', 'social-image-renders', enterpriseAssetTenantKey(tenantId));

function productIdentity(product: Record<string, unknown>, index: number) {
  return String(product.id || product.productId || product.sku || `product-${index}-${String(product.name || '')}`);
}

async function enterpriseProductAsset(tenantId: string, productId: string): Promise<{ name: string; bytes: Buffer } | null> {
  const profile = await readTenantEnterpriseProfile(tenantId);
  const products = profile.products.items || [];
  const index = products.findIndex((item, itemIndex) => productIdentity(item as unknown as Record<string, unknown>, itemIndex) === productId);
  const product = index >= 0 ? products[index] : undefined;
  if (!product) return null;
  const url = String(product.images?.[0]?.url || product.imageUrl || '');
  let route = '';
  try { route = new URL(url, 'http://local.invalid').pathname; } catch { return null; }
  const match = route.match(/^\/api\/overseas\/enterprise\/assets\/([\w.-]+)$/);
  if (!match) return null;
  const filename = path.basename(match[1]!);
  const local = path.resolve(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId), filename);
  if (local.startsWith(path.resolve(process.cwd(), 'data', 'enterprise-assets')) && fs.existsSync(local)) return { name: String(product.name || productId), bytes: fs.readFileSync(local) };
  if (objectStorageEnabled()) {
    const stored = await objectStorageDownload(enterpriseAssetObjectKey(tenantId, filename));
    if (stored?.buf?.length) return { name: String(product.name || productId), bytes: stored.buf };
  }
  return null;
}

async function outputImageBytes(tenantId: string, output: { mediaUrl?: string; materialId?: string }): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (output.materialId) {
    const material = await store.getById('materials', output.materialId).catch(() => null)
      || (await readMaterialLibrary(tenantId)).items.find(item => item.id === output.materialId);
    if (material) {
      const loaded = await readTenantMaterialBytes(material as any, tenantId).catch(() => null);
      const expectedHash = String((material as { contentSha256?: string }).contentSha256 || '').toLowerCase();
      if (!loaded || (expectedHash && createHash('sha256').update(loaded.bytes).digest('hex') !== expectedHash)) return null;
      return loaded;
    }
  }
  const route = String(output.mediaUrl || '');
  const match = route.match(/^\/api\/overseas\/social-images\/renders\/([a-zA-Z0-9._-]+\.png)$/);
  if (!match) return null;
  const file = path.join(renderRoot(tenantId), path.basename(match[1]!));
  return fs.existsSync(file) ? { bytes: fs.readFileSync(file), mimeType: 'image/png' } : null;
}

async function referenceImageBytes(tenantId: string, raw: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  let route = '';
  try { route = new URL(raw, 'http://local.invalid').pathname; } catch { return null; }
  const rendered = route.match(/^\/api\/overseas\/social-images\/renders\/([a-zA-Z0-9._-]+\.png)$/);
  if (rendered) return outputImageBytes(tenantId, { mediaUrl: route });
  const enterprise = route.match(/^\/api\/overseas\/enterprise\/assets\/([\w.-]+)$/);
  if (enterprise) {
    const filename = path.basename(enterprise[1]!);
    const local = path.resolve(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId), filename);
    if (local.startsWith(path.resolve(process.cwd(), 'data', 'enterprise-assets')) && fs.existsSync(local)) return { bytes: fs.readFileSync(local), mimeType: /\.png$/i.test(filename) ? 'image/png' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/jpeg' };
    if (objectStorageEnabled()) {
      const object = await objectStorageDownload(enterpriseAssetObjectKey(tenantId, filename));
      if (object?.buf?.length) return { bytes: object.buf, mimeType: object.contentType || 'image/jpeg' };
    }
  }
  const library = await readMaterialLibrary(tenantId).catch(() => null);
  const privateName = route.match(/^\/api\/overseas\/studio\/private-assets\/materials\/([\w.-]+)$/)?.[1];
  const material = library?.items.find(item => item.type === 'image' && String(item.tenantId || item.tenant_id || '') === tenantId && (
    [item.url, item.poster].some(url => {
      try { return url && new URL(String(url), 'http://local.invalid').pathname === route; } catch { return false; }
    }) || (privateName && [item.objectKey, item.posterObjectKey].some(key => key && path.basename(String(key)) === privateName))
  ));
  return material ? readTenantMaterialBytes(material as any, tenantId).catch(() => null) : null;
}

socialImageRouter.get('/renders/:filename', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const filename = String(req.params.filename || '');
  if (!/^[a-zA-Z0-9._-]+\.png$/.test(filename)) { res.status(400).json({ ok: false, error: '成片文件名无效' }); return; }
  const file = path.join(renderRoot(tenantId), filename);
  if (!fs.existsSync(file)) { res.status(404).json({ ok: false, error: '成片不存在' }); return; }
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.type('png').sendFile(file);
});

socialImageRouter.post('/tasks', async (req, res) => {
  res.status(409).json({ ok: false, code: 'social_image_content_task_required', error: '请先创建或恢复统一内容任务，再启动图片生产。' });
});

socialImageRouter.post('/tasks/from-reference', async (req, res) => {
  res.status(409).json({ ok: false, code: 'social_image_content_task_required', error: '爆款裂变必须绑定统一内容任务后启动。' });
});

/** Canonical entry: create or resume one image child run under an existing ContentTask. */
socialImageRouter.post('/content-tasks/:contentTaskId/runs', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const rawKey = Array.isArray(req.headers['idempotency-key']) ? req.headers['idempotency-key'][0] : req.headers['idempotency-key'];
    const entrySource = String(req.body?.entrySource || 'assistant');
    if (!['assistant', 'workspace', 'weekly_package'].includes(entrySource)) {
      res.status(400).json({ ok: false, code: 'social_image_entry_source_invalid', error: '图片任务入口无效' }); return;
    }
    const result = await createOrResumeBoundSocialImageRun(store, tenantId, {
      contentTaskId: req.params.contentTaskId,
      expectedContentTaskVersion: String(req.body?.expectedContentTaskVersion || ''),
      idempotencyKey: String(rawKey || ''),
      deliverableKey: req.body?.deliverableKey,
      entrySource: entrySource as 'assistant' | 'workspace' | 'weekly_package',
      imageType: req.body?.imageType,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(result.resumed ? 200 : 201).json({ ok: true, ...result, snapshot: projectSocialImageProductionSnapshot(result.task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_run_unavailable', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
  }
});

socialImageRouter.get('/tasks/:id', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task });
  } catch {
    res.status(503).json({ ok: false, error: '图片任务读取失败' });
  }
});

/** Pollable recovery/event projection. The assistant BFF may relay it over its shared stream. */
socialImageRouter.get('/tasks/:id/production', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, code: 'social_image_task_missing', error: '图片任务不存在' }); return; }
    const after = Number(req.query.afterSequence || 0);
    if (!Number.isSafeInteger(after) || after < 0) { res.status(400).json({ ok: false, code: 'social_image_event_cursor_invalid', error: '事件游标无效' }); return; }
    const events = (task.productionRuntime?.events || []).filter(event => event.sequence > after).slice(0, 100);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, snapshot: projectSocialImageProductionSnapshot(task), events });
  } catch {
    res.status(503).json({ ok: false, code: 'social_image_production_read_failed', error: '图片生产状态读取失败' });
  }
});

socialImageRouter.post('/tasks/:id/refresh-content-task', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await refreshSocialImageContentTaskBinding({ store, tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion), expectedContentTaskVersion: String(req.body?.expectedContentTaskVersion || '') });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task, snapshot: projectSocialImageProductionSnapshot(task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_binding_refresh_failed', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
  }
});

/** Decode tenant-owned assets and reference pixels before any paid generation. */
socialImageRouter.post('/tasks/:id/evidence/prepare', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const foundTask = await readSocialImageTask(store, tenantId, req.params.id);
    if (!foundTask) { res.status(404).json({ ok: false, code: 'social_image_task_missing', error: '图片任务不存在' }); return; }
    let task: SocialImageCreationTask = foundTask;
    if (Number(req.body?.expectedVersion) !== task.version) {
      res.status(409).json({ ok: false, code: 'social_image_version_conflict', error: '任务已被更新，请刷新后继续', task }); return;
    }
    if (task.schemaVersion !== 'social-image-creation.v3' || !task.productionRuntime?.binding) {
      res.status(409).json({ ok: false, code: 'social_image_content_task_binding_missing', error: '历史图片项目不自动升级生产运行' }); return;
    }
    task = await recordSocialImageBusinessContext({ store, tenantId, taskId: task.id, expectedVersion: task.version });
    const library = await readMaterialLibrary(tenantId);
    const ocrReadiness = localProductOcrReadiness();
    const ocr = ocrReadiness.ready ? recognizeProductImageTokensLocally : undefined;
    const inspected = [] as Awaited<ReturnType<typeof inspectSocialImageAsset>>[];
    for (const asset of task.enterpriseAssets) {
      let loaded: { bytes: Buffer; mimeType: string } | null = null;
      if (asset.role === 'product' && asset.source === 'enterprise_knowledge_base') {
        const product = await enterpriseProductAsset(tenantId, asset.assetId);
        if (product) {
          const format = (await sharp(product.bytes).metadata().catch(() => ({ format: undefined }))).format;
          loaded = { bytes: product.bytes, mimeType: format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg' };
        }
      } else {
        const material = library.items.find(item => item.id === asset.assetId && item.type === 'image');
        if (material) loaded = await readTenantMaterialBytes(material as any, tenantId).catch(() => null);
      }
      inspected.push(await inspectSocialImageAsset({ assetId: asset.assetId, role: asset.role, required: asset.required,
        bytes: loaded?.bytes || null, mimeType: loaded?.mimeType || 'application/octet-stream',
        expectedContentHash: asset.contentHash, ocr }));
    }
    const manifest = socialImageAssetManifest({ assets: inspected, ocrAvailable: ocrReadiness.ready,
      prohibitedClaims: task.contentBrief.prohibitedClaims });
    const unreadable = manifest.assets.filter(asset => asset.required && !asset.readable).map(asset => asset.assetId);
    task = await recordSocialImageNodeOutput({ store, tenantId, taskId: task.id, expectedVersion: task.version,
      nodeId: 'asset_manifest', status: unreadable.length ? 'blocked' : 'completed', value: manifest, inputRefs: [],
      evidenceRefs: manifest.assets.filter(asset => asset.readable).map(asset => ({ objectType: 'enterprise-image-asset',
        id: asset.assetId, version: asset.version, contentHash: asset.contentHash })),
      createdBy: { kind: 'worker', id: 'social_image_asset_probe' },
      blockingReasons: unreadable.map(id => `social_image_required_asset_unreadable:${id}`),
      warnings: ocrReadiness.ready ? [] : [ocrReadiness.code] });
    if (unreadable.length) {
      res.status(422).json({ ok: false, code: 'social_image_required_asset_unreadable',
        error: `强制企业图片不可读取：${unreadable.join('、')}`, task, snapshot: projectSocialImageProductionSnapshot(task) }); return;
    }
    if (task.creationPath === 'material_processing') {
      res.json({ ok: true, task, snapshot: projectSocialImageProductionSnapshot(task), manifest }); return;
    }
    const referenceUrl = task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || task.referenceSnapshot?.sourceUrl || '';
    const reference = referenceUrl ? await referenceImageBytes(tenantId, referenceUrl) : null;
    let inventory: Awaited<ReturnType<typeof analyzeSocialImageReference>> | null = null;
    if (reference) {
      try { inventory = await analyzeSocialImageReference({ bytes: reference.bytes, mimeType: reference.mimeType,
        referenceId: task.referenceSnapshot?.sourceRecordId || task.id, ocr }); }
      catch { inventory = null; }
    }
    const referenceReadable = Boolean(reference && inventory);
    const referenceHash = reference?.bytes.length ? createHash('sha256').update(reference.bytes).digest('hex')
      : createHash('sha256').update(referenceUrl || 'missing-reference').digest('hex');
    const imageAssetRef = { objectType: 'social-image-reference', id: task.referenceSnapshot?.sourceRecordId || task.id,
      version: 1, contentHash: referenceHash };
    const referenceValue = {
      referenceId: task.referenceSnapshot?.sourceRecordId || task.id, sourceUrl: referenceUrl || null,
      sourceRecordId: task.referenceSnapshot?.sourceRecordId || null, imageAssetRef,
      platform: task.referenceSnapshot?.platform || null, account: task.referenceSnapshot?.accountName || null,
      publishedAt: null, rightsPolicy: 'structure_only' as const, performanceEvidence: [], relativePerformance: null,
      referencePurpose: ['structure', 'visual_hook'] as Array<'structure' | 'visual_hook'>,
      fingerprint: task.referenceSnapshot?.fingerprint || referenceHash,
    };
    task = await recordSocialImageNodeOutput({ store, tenantId, taskId: task.id, expectedVersion: task.version,
      nodeId: 'reference_snapshot', status: referenceReadable ? 'completed' : 'blocked', value: referenceValue,
      inputRefs: [], evidenceRefs: referenceReadable ? [imageAssetRef] : [],
      createdBy: { kind: 'worker', id: 'social_image_reference_probe' },
      blockingReasons: referenceReadable ? [] : ['social_image_reference_bytes_unreadable'] });
    if (!referenceReadable || !inventory) {
      res.status(422).json({ ok: false, code: 'social_image_reference_bytes_unreadable', error: '参考图不可读取，不能执行爆点拆解',
        task, snapshot: projectSocialImageProductionSnapshot(task) }); return;
    }
    const snapshotEnvelope = task.productionRuntime!.nodeOutputs.filter(output => output.nodeId === 'reference_snapshot').at(-1)!;
    task = await recordSocialImageNodeOutput({ store, tenantId, taskId: task.id, expectedVersion: task.version,
      nodeId: 'element_inventory', status: 'completed', value: inventory,
      inputRefs: [{ objectType: snapshotEnvelope.schemaVersion, id: snapshotEnvelope.id,
        version: snapshotEnvelope.version, contentHash: snapshotEnvelope.contentHash }],
      evidenceRefs: inventory.regions.map(region => region.evidenceRef),
      createdBy: { kind: 'worker', id: 'social_image_reference_pixel_analyzer' },
      warnings: ocrReadiness.ready ? [] : [ocrReadiness.code] });
    task = await prepareSocialImageReferenceStrategy({ store, tenantId, taskId: task.id, expectedVersion: task.version });
    res.json({ ok: true, task, snapshot: projectSocialImageProductionSnapshot(task), manifest, inventory });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_evidence_prepare_failed', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
  }
});

/** The client selects only a frozen candidate; the server owns the director verdict. */
socialImageRouter.post('/tasks/:id/director-review', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await runSocialImageDirectorReview({
      store, tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion),
      candidateId: String(req.body?.candidateId || ''),
      candidateVersion: Number(req.body?.candidateVersion),
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task, snapshot: projectSocialImageProductionSnapshot(task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_director_review_failed', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
  }
});

/** Explicit user acceptance. Automatic preflight may never call this endpoint. */
socialImageRouter.post('/tasks/:id/decision', async (req, res) => {
  try {
    const { tenantId, userId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, code: 'social_image_task_missing', error: '图片任务不存在' }); return; }
    const candidateId = String(req.body?.candidateId || '');
    const candidateVersion = Number(req.body?.candidateVersion);
    const output = socialImageCurrentOutputs(task).find(item => item.id === candidateId && item.version === candidateVersion);
    if (!output) { res.status(409).json({ ok: false, code: 'social_image_approval_candidate_stale', error: '候选版本已变化，请刷新后验收' }); return; }
    const media = await outputImageBytes(tenantId, output);
    if (!media?.bytes.length) { res.status(422).json({ ok: false, code: 'social_image_candidate_bytes_unavailable', error: '候选图片不可读取，不能验收' }); return; }
    const actualContentHash = createHash('sha256').update(media.bytes).digest('hex');
    const decision = String(req.body?.decision || '');
    if (!['approved', 'rejected'].includes(decision)) { res.status(400).json({ ok: false, code: 'social_image_decision_invalid', error: '验收决定无效' }); return; }
    const result = await decideSocialImageCandidate({
      store, tenantId, userId, taskId: task.id,
      expectedVersion: Number(req.body?.expectedVersion),
      candidateId, candidateVersion,
      expectedContentHash: String(req.body?.expectedContentHash || '').toLowerCase(),
      actualContentHash,
      decision: decision as 'approved' | 'rejected',
      note: String(req.body?.note || ''),
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, ...result, snapshot: projectSocialImageProductionSnapshot(result.task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_decision_failed', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
  }
});

/** Build a deterministic delivery package from the frozen approved artifact. No platform publish occurs here. */
socialImageRouter.post('/tasks/:id/delivery-packages', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const result = await createSocialImageDeliveryPackage({ store, tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion) });
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(201).json({ ok: true, ...result, snapshot: projectSocialImageProductionSnapshot(result.task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_delivery_package_failed', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
  }
});

/** Attach a proven existing image material after a lost task-write response; never call the provider. */
socialImageRouter.post('/tasks/:id/jobs/:jobId/reconcile-material', async (req, res) => {
  let inventoryComplete = false;
  try {
    const { tenantId } = res.locals as AuthLocals;
    const library = await readMaterialLibrary(tenantId);
    inventoryComplete = library.status === 'ready';
    const recovered = await recoverSocialImagePaidMaterial({
      store, tenantId, taskId: req.params.id, jobId: req.params.jobId,
      materials: library.items,
      readBytes: readTenantMaterialBytes,
      materialUrl: socialImageOwnedMaterialUrl,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, recovered: true, ...recovered });
  } catch (error) {
    const code = error instanceof SocialImagePaidJobError ? error.code : 'social_image_material_reconcile_failed';
    const status = code === 'social_image_task_missing' ? 404
      : code === 'social_image_atomic_store_required' ? 503
      : code === 'social_image_material_not_found' ? inventoryComplete ? 404 : 503 : 409;
    res.status(status).json({ ok: false, code, error: '未找到可安全关联的同租户已生成素材；不会重新调用图片供应商' });
  }
});

/** Persist bounded multi-output units before any paid call. */
socialImageRouter.post('/tasks/:id/plan-units', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) { res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return; }
    const current = await readSocialImageTask(store, tenantId, req.params.id);
    if (!current) { res.status(404).json({ ok: false, code: 'social_image_task_missing', error: '图片任务不存在' }); return; }
    const productHashes: Record<string, string> = {};
    for (const id of current.contentBrief.productRefs) {
      const product = await enterpriseProductAsset(tenantId, id);
      if (!product?.bytes.length) throw new SocialImagePaidJobError('social_image_product_asset_unavailable');
      productHashes[id] = createHash('sha256').update(product.bytes).digest('hex');
    }
    const task = await persistSocialImageMultiUnitPlan({ store, tenantId, taskId: req.params.id, expectedVersion, productHashes });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task, paidExecutionEnabled: task.imageType === 'carousel' || task.imageType === 'gif_poster' });
  } catch (error) {
    const code = error instanceof SocialImagePaidJobError ? error.code : 'social_image_plan_failed';
    const status = code === 'social_image_task_missing' ? 404 : code === 'social_image_atomic_store_required' ? 503 : 409;
    res.status(status).json({ ok: false, code, error: '多图单元计划无法安全持久化；未调用图片供应商' });
  }
});

/** Explicitly retire only known, non-running units; never infer a provider outcome. */
socialImageRouter.post('/tasks/:id/abandon-plan', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return;
    }
    const task = await abandonSocialImageMultiUnitPlan({ store, tenantId, taskId: req.params.id, expectedVersion });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task });
  } catch (error) {
    const code = error instanceof SocialImagePaidJobError ? error.code : 'social_image_plan_abandon_failed';
    const status = code === 'social_image_task_missing' ? 404 : code === 'social_image_atomic_store_required' ? 503 : 409;
    res.status(status).json({ ok: false, code, error: '当前轮播/GIF 计划存在未确认的付费结果或版本冲突，未废弃计划' });
  }
});

/** Compose persisted paid background plates into reviewable frames and one GIF; no provider call. */
socialImageRouter.post('/tasks/:id/finalize-gif', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return;
    }
    const task = await finalizeSocialImageGif({
      store, tenantId, taskId: req.params.id, expectedVersion,
      readPlate: async output => (await outputImageBytes(tenantId, output))?.bytes || null,
      readProduct: async productId => (await enterpriseProductAsset(tenantId, productId))?.bytes || null,
      readBenchmark: async url => (await referenceImageBytes(tenantId, url))?.bytes || null,
      persist: async asset => {
        const material = await createGeneratedImageMaterial({
          title: asset.kind === 'gif' ? 'AI GIF 海报 · 成片' : `AI GIF 海报 · 合成画面 ${Number(asset.index || 0) + 1}`,
          bytes: asset.bytes, mimeType: asset.kind === 'gif' ? 'image/gif' : 'image/png',
          source: 'deterministic-compositor', tenantId, sourceType: 'ai_generated_marketing_image',
          stableKey: asset.stableKey,
          provenance: { socialImageTaskId: req.params.id, socialImageStableKey: asset.stableKey,
            ...(asset.sourceJobId ? { socialImageSourceJobId: asset.sourceJobId } : {}) },
        });
        return { materialId: material.id, mediaUrl: socialImageOwnedMaterialUrl(material, tenantId),
          contentSha256: material.contentSha256 };
      },
    });
    const output = task.outputs.find(item => item.id === task.gifDelivery?.finalOutputId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, task, url: output?.mediaUrl });
  } catch (error) {
    const code = error instanceof SocialImagePaidJobError ? error.code : 'social_image_gif_finalization_failed';
    const status = code === 'social_image_task_missing' ? 404 : code === 'social_image_atomic_store_required' ? 503 : 409;
    res.status(status).json({ ok: false, code, error: 'GIF 成片未能从已持久化底图安全合成；不会重新调用图片供应商' });
  }
});

socialImageRouter.patch('/tasks/:id', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const expectedVersion = Number(req.body?.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) { res.status(400).json({ ok: false, error: '缺少有效任务版本' }); return; }
    const patch = req.body?.patch || {};
    const protectedFields = ['productionRuntime', 'hookFactorSpec', 'adaptationSpec', 'directorReviewDecision', 'approvalDecisions', 'approvedArtifact', 'repairPlans', 'deliveryPackages'];
    if (protectedFields.some(field => Object.prototype.hasOwnProperty.call(patch, field)) || patch.status === 'approved') {
      res.status(403).json({ ok: false, code: 'social_image_governed_fields_server_owned', error: '图片节点结果与验收凭证只能由对应 Agent、Worker 或显式验收接口写入' }); return;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'renderPlan')) { res.status(403).json({ ok: false, code: 'social_image_render_plan_server_owned', error: '逐单元计划只能由服务端冻结' }); return; }
    if (Object.prototype.hasOwnProperty.call(patch, 'gifDelivery')) { res.status(403).json({ ok: false, code: 'social_image_gif_delivery_server_owned', error: 'GIF 成片关联只能由服务端写入' }); return; }
    if (Object.prototype.hasOwnProperty.call(patch, 'generationJobs')) {
      const current = await readSocialImageTask(store, tenantId, req.params.id);
      if (!current) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
      if (current.version !== expectedVersion) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task: current }); return; }
      const issue = socialImageQueuedJobIssue(current, patch.generationJobs);
      if (issue) { res.status(409).json({ ok: false, code: issue, error: '已有图片生成请求待完成或待核对，不能改写付费任务记录' }); return; }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'outputs')) {
      const current = await readSocialImageTask(store, tenantId, req.params.id);
      if (!current) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
      if (current.version !== expectedVersion) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task: current }); return; }
      const issue = socialImageClientOutputPatchIssue(current.outputs, patch.outputs);
      if (issue) { res.status(409).json({ ok: false, code: issue, error: '成片与质检证据由服务端写入，页面只能将现有成片标记为待修复' }); return; }
    }
    if (['imageType', 'creationPath', 'deliverySpec', 'contentBrief', 'creativeRecipe', 'enterpriseAssets', 'materialIds', 'referenceUrls', 'referenceSnapshot', 'replicationRecipe', 'renderBrief', 'imageTextContract', 'layerGraph']
      .some(field => Object.prototype.hasOwnProperty.call(patch, field))) {
      const current = await readSocialImageTask(store, tenantId, req.params.id);
      if (current?.renderPlan || current?.generationJobs.some(job => ['queued', 'running', 'outcome_unknown'].includes(job.status) && !job.outputNodeIds.length)) {
        res.status(409).json({ ok: false, code: 'social_image_paid_inputs_frozen', error: '图片付费输入已冻结；先显式撤销计划并核对已有回执' });
        return;
      }
    }
    const result = await updateSocialImageTask(store, tenantId, req.params.id, expectedVersion, patch);
    if (result.kind === 'missing') { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (result.kind === 'conflict') { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task: result.task }); return; }
    if (result.kind === 'invalid') { res.status(422).json({ ok: false, error: result.issues.join('；'), issues: result.issues, task: result.task }); return; }
    res.json({ ok: true, task: result.task });
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : '图片任务保存失败' });
  }
});

socialImageRouter.post('/tasks/:id/compile-layered', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (Number(req.body?.expectedVersion) !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    const productId = task.contentBrief.productRefs[0];
    if (!productId) { res.status(422).json({ ok: false, error: '分层编译需要企业知识库产品' }); return; }
    const product = await enterpriseProductAsset(tenantId, productId);
    if (!product) { res.status(422).json({ ok: false, error: '企业产品主图不可读取，未进入渲染' }); return; }
    // Logo is optional during first-draft creation. It can be added later from
    // the unified review surface once a resolvable enterprise asset exists.
    if (task.schemaVersion === 'social-image-creation.v3' && task.creationPath === 'viral_replication') {
      const planned = await compileSocialImageReferencePlan({ store, tenantId, taskId: task.id,
        expectedVersion: task.version, productName: product.name });
      res.json({ ok: true, task: planned.task, layerGraph: planned.graph }); return;
    }
    const layerGraph = compileLuxuryProductHero({ task, productId, productName: product.name });
    assertSocialImageLayerGraph(layerGraph);
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, { layerGraph, status: 'planned', step: 'generate' });
    if (updated.kind !== 'updated') { res.status(updated.kind === 'conflict' ? 409 : 422).json({ ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '分层合同保存失败' }); return; }
    res.json({ ok: true, task: updated.task, layerGraph });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '分层编译失败' });
  }
});

socialImageRouter.post('/tasks/:id/repair-layered', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (Number(req.body?.expectedVersion) !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    if (!task.layerGraph) { res.status(422).json({ ok: false, error: '当前成片没有可修改的分层合同' }); return; }
    const instruction = String(req.body?.instruction || '').trim().slice(0, 1000);
    if (!instruction) { res.status(400).json({ ok: false, error: '请输入修改要求' }); return; }
    const graph = structuredClone(task.layerGraph);
    let nextFieldsToConfirm = [...task.fieldsToConfirm];
    let nextTextContract = { ...task.imageTextContract };
    let targetLayer: 'background' | 'product' | 'logo' | 'typography' | 'full_composite' = 'full_composite';
    const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
    const move = (kind: 'product' | 'overlay', dx: number, dy: number) => graph.layers.filter(layer => layer.kind === kind).forEach(layer => {
      layer.rect.x = clamp(layer.rect.x + dx, 1 - layer.rect.width);
      layer.rect.y = clamp(layer.rect.y + dy, 1 - layer.rect.height);
    });
    if (/产品|瓶|包装/i.test(instruction)) {
      targetLayer = 'product';
      for (const layer of graph.layers.filter(item => item.kind === 'product')) {
        const factor = /小一点|缩小|小些/i.test(instruction) ? .9 : /大一点|放大|大些/i.test(instruction) ? 1.1 : 1;
        if (factor !== 1) {
          const centerX = layer.rect.x + layer.rect.width / 2; const centerY = layer.rect.y + layer.rect.height / 2;
          layer.rect.width = clamp(layer.rect.width * factor, .88);
          layer.rect.height = clamp(layer.rect.height * factor, .84);
          layer.rect.x = clamp(centerX - layer.rect.width / 2, 1 - layer.rect.width);
          layer.rect.y = clamp(centerY - layer.rect.height / 2, 1 - layer.rect.height);
        }
      }
      if (/左移|往左/i.test(instruction)) move('product', -.04, 0);
      if (/右移|往右/i.test(instruction)) move('product', .04, 0);
      if (/上移|往上/i.test(instruction)) move('product', 0, -.04);
      if (/下移|往下/i.test(instruction)) move('product', 0, .04);
    }
    if (/遮罩|蒙版|玻璃/i.test(instruction)) {
      targetLayer = 'background';
      if (/左移|往左/i.test(instruction)) move('overlay', -.04, 0);
      if (/右移|往右/i.test(instruction)) move('overlay', .04, 0);
      if (/上移|往上/i.test(instruction)) move('overlay', 0, -.04);
      if (/下移|往下/i.test(instruction)) move('overlay', 0, .04);
      for (const layer of graph.layers.filter(item => item.kind === 'overlay')) {
        if (/淡一点|透明一点|浅一点/i.test(instruction)) layer.opacity = Math.max(.2, (layer.opacity ?? .72) - .15);
        if (/深一点|明显一点|不透明/i.test(instruction)) layer.opacity = Math.min(.92, (layer.opacity ?? .72) + .15);
      }
    }
    const title = instruction.match(/(?:标题|headline).*?(?:改成|改为|换成)[：:]?\s*(.+)$/i)?.[1]?.trim();
    if (title) {
      targetLayer = 'typography';
      const layer = graph.layers.find(item => item.id === 'headline');
      if (layer) layer.content = title.slice(0, 160);
      nextTextContract = { ...nextTextContract, headline: title.slice(0, 160) };
    }
    if (/删除|去掉|不要/.test(instruction) && /认证|资质|产地|泰国|MOQ|起订|交期|价格|工厂|OEM|ODM/i.test(instruction)) {
      targetLayer = 'typography';
      const sensitive = /[^。！？.!?\n]*(?:认证|资质|产地|泰国|MOQ|起订|交期|价格|工厂|OEM|ODM)[^。！？.!?\n]*[。！？.!?]?/gi;
      graph.layers = graph.layers.filter(layer => layer.kind !== 'badge').map(layer => (layer.kind === 'text' || layer.kind === 'cta') && layer.content
        ? { ...layer, content: layer.content.replace(sensitive, '').trim() }
        : layer).filter(layer => !((layer.kind === 'text' || layer.kind === 'cta') && !layer.content));
      const requestedKinds = [
        /认证|资质/i.test(instruction) ? /认证|资质|certif/i : null,
        /产地|泰国/i.test(instruction) ? /产地|国家|泰国|origin|country/i : null,
        /MOQ|起订/i.test(instruction) ? /MOQ|起订|minimum order/i : null,
        /交期/i.test(instruction) ? /交期|周转|lead time|turnaround/i : null,
        /价格/i.test(instruction) ? /价格|price/i : null,
        /工厂/i.test(instruction) ? /工厂|产能|factory/i : null,
        /OEM|ODM/i.test(instruction) ? /OEM|ODM|私标|定制/i : null,
      ].filter(Boolean) as RegExp[];
      nextFieldsToConfirm = nextFieldsToConfirm.filter(field => !requestedKinds.some(pattern => pattern.test(field)));
      nextTextContract = {
        ...nextTextContract,
        headline: nextTextContract.headline.replace(sensitive, '').trim(),
        supportingText: nextTextContract.supportingText?.replace(sensitive, '').trim(),
        caption: nextTextContract.caption.replace(sensitive, '').trim(),
        cta: nextTextContract.cta?.replace(sensitive, '').trim(),
        hashtags: nextTextContract.hashtags.filter(item => !requestedKinds.some(pattern => pattern.test(item))),
      };
    }
    if (targetLayer === 'full_composite') { res.status(422).json({ ok: false, error: '暂未识别这条修改要求，请描述产品大小/位置、遮罩、标题或删除敏感声明。' }); return; }
    const sourceOutput = task.outputs.filter(item => item.state !== 'superseded').at(-1);
    const priorAttempts = (task.repairPlans || []).filter(item => item.sourceCandidateId === (sourceOutput?.id || '')).length;
    if (priorAttempts >= 3) { res.status(409).json({ ok: false, code: 'social_image_repair_attempt_limit', error: '已达到定向返工上限，请由用户确认降级目标或新建候选版本。' }); return; }
    assertSocialImageLayerGraph(graph);
    const repair = {
      id: randomUUID(), outputNodeId: task.outputs.at(-1)?.id || '', failedChecks: [], targetLayer,
      instruction, status: 'pending' as const, fromVersion: Math.max(1, ...task.outputs.map(item => item.version)),
    };
    const targetKinds = targetLayer === 'background' ? new Set(['background', 'overlay'])
      : targetLayer === 'typography' ? new Set(['text', 'cta', 'badge']) : new Set([targetLayer]);
    const repairPlan = {
      schemaVersion: 'social-image-repair-plan.v1' as const, repairPlanId: randomUUID(),
      sourceCandidateId: sourceOutput?.id || '', fromVersion: sourceOutput?.version || repair.fromVersion,
      toVersion: (sourceOutput?.version || repair.fromVersion) + 1, failedCheckRefs: [], targetRegions: [], targetLayers: [targetLayer],
      repairMethod: targetLayer === 'typography' ? 'text_layer_fix' as const : 'layer_edit' as const,
      preservedLayers: graph.layers.filter(layer => !targetKinds.has(layer.kind)).map(layer => layer.id),
      instruction, attempt: priorAttempts + 1, maxAttempts: 3, createdAt: new Date().toISOString(),
    };
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, {
      layerGraph: graph, status: 'planned', step: 'generate', repairInstructions: [...task.repairInstructions, repair],
      repairPlans: [...(task.repairPlans || []), repairPlan], fieldsToConfirm: nextFieldsToConfirm, imageTextContract: nextTextContract,
    });
    if (updated.kind !== 'updated') { res.status(updated.kind === 'conflict' ? 409 : 422).json({ ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '图层修改保存失败' }); return; }
    res.json({ ok: true, task: updated.task, layerGraph: graph, targetLayer });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '图层修改失败' });
  }
});

socialImageRouter.post('/tasks/:id/render-layered', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    if (Number(req.body?.expectedVersion) !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    if (!task.layerGraph) { res.status(422).json({ ok: false, error: '任务尚未生成分层合同' }); return; }
    if (task.schemaVersion === 'social-image-creation.v3' && task.creationPath === 'viral_replication'
      && !socialImageFrozenGraphMatches(task)) {
      res.status(422).json({ ok: false, code: 'social_image_reference_plan_stale', error: '参考版式证据或冻结规格已失效，请重新规划' }); return;
    }
    // Unresolved optional layers are omitted from the first draft instead of
    // stopping production. The user can add them later from unified review.
    const renderGraph = {
      ...task.layerGraph,
      layers: task.layerGraph.layers.filter(item => item.kind !== 'logo'),
    };
    assertSocialImageLayerGraph(renderGraph);
    const assets = new Map<string, Buffer>();
    for (const layer of renderGraph.layers.filter(item => item.kind === 'product')) {
      const product = layer.sourceAssetId ? await enterpriseProductAsset(tenantId, layer.sourceAssetId) : null;
      if (!product || !layer.sourceAssetId) { res.status(422).json({ ok: false, error: `企业产品资产不可读取：${layer.id}` }); return; }
      assets.set(layer.sourceAssetId, product.bytes);
    }
    if (task.schemaVersion === 'social-image-creation.v3' && task.creationPath === 'viral_replication') {
      const referenceUrl = task.referenceSnapshot?.imageUrls[0] || task.referenceUrls[0] || task.referenceSnapshot?.sourceUrl || '';
      const reference = referenceUrl ? await referenceImageBytes(tenantId, referenceUrl) : null;
      const sourceIssue = socialImageFrozenSourceIssue({ task, productBytes: assets, referenceBytes: reference?.bytes || null });
      if (sourceIssue) { res.status(422).json({ ok: false, code: sourceIssue, error: sourceIssue }); return; }
    }
    const rendered = await renderSocialImageLayerGraph({ graph: renderGraph, assets });
    const digest = createHash('sha256').update(rendered.bytes).digest('hex');
    const filename = `${task.id}-v${task.version}-${digest.slice(0, 12)}.png`;
    const directory = renderRoot(tenantId);
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, filename);
    if (!fs.existsSync(target)) {
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, rendered.bytes, { mode: 0o600 });
      fs.renameSync(temporary, target);
    }
    const mediaUrl = `/api/overseas/social-images/renders/${filename}`;
    const outputVersion = Math.max(0, ...task.outputs.filter(item => item.role === 'single' && item.label === '分层主视觉').map(item => item.version)) + 1;
    const output = {
      id: randomUUID(), role: 'single' as const, label: '分层主视觉', state: 'quality_checking' as const,
      mediaUrl, contentHash: digest, version: outputVersion,
      qualityChecks: SOCIAL_IMAGE_HARD_CHECKS.map(key => ({ key, verdict: 'uncertain' as const, severity: 'hard' as const, checker: 'deterministic' as const, note: '等待分层成片质检' })),
    };
    const updated = await updateSocialImageTask(store, tenantId, task.id, task.version, {
      status: 'review_required', step: 'review', layerGraph: renderGraph,
      outputs: [...task.outputs.map(item => item.role === output.role && item.label === output.label ? { ...item, state: 'superseded' as const } : item), output],
      repairInstructions: task.repairInstructions.map(item => item.status === 'pending'
        ? { ...item, status: 'completed' as const, toVersion: outputVersion } : item),
    });
    if (updated.kind !== 'updated') { res.status(updated.kind === 'conflict' ? 409 : 422).json({ ok: false, error: updated.kind === 'invalid' ? updated.issues.join('；') : '分层成片保存失败' }); return; }
    res.json({ ok: true, task: updated.task, layerGraph: renderGraph, url: mediaUrl, sha256: digest, mimeType: rendered.mimeType });
  } catch (error) {
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '分层渲染失败' });
  }
});

socialImageRouter.post('/tasks/:id/quality/preflight', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const task = await readSocialImageTask(store, tenantId, req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '图片任务不存在' }); return; }
    const expectedVersion = Number(req.body?.expectedVersion);
    if (expectedVersion !== task.version) { res.status(409).json({ ok: false, error: '任务已被更新，请刷新后继续', task }); return; }
    const deterministic = socialImageDeterministicChecks(task);
    const productAssets = (await Promise.all(task.contentBrief.productRefs.map(id => enterpriseProductAsset(tenantId, id))))
      .filter((item): item is { name: string; bytes: Buffer } => Boolean(item));
    const products = await Promise.all(productAssets.map(async item => {
      const format = (await sharp(item.bytes).metadata()).format;
      return { ...item, mimeType: format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg' };
    }));
    const reference = (await Promise.all([...(task.referenceSnapshot?.imageUrls || []), ...task.referenceUrls]
      .slice(0, 4).map(url => referenceImageBytes(tenantId, url)))).find(Boolean) || undefined;
    const outputs = await Promise.all(task.outputs.map(async output => {
      if (output.state === 'superseded') return output;
      // GIF plates are paid background evidence, not customer-visible frames.
      // Their fixed product/copy layers are checked on the composed frame/GIF.
      if (task.imageType === 'gif_poster' && output.role === 'gif_plate') return output;
      const plannedUnit = task.renderPlan?.units.find(unit => (unit.role === output.role || output.role === 'gif_frame') && unit.label === output.label);
      const generated = await outputImageBytes(tenantId, output);
      if (!generated) {
        const pixelChecks = await socialImageCandidatePixelChecks({ bytes: Buffer.alloc(0), aspectRatio: task.deliverySpec.aspectRatio });
        const localChecks = new Map(pixelChecks.map(check => [check.key, check]));
        return { ...output, state: 'repair_required' as const,
          qualityChecks: deterministic.map(check => localChecks.get(check.key) || check) };
      }
      const pixelChecks = await socialImageCandidatePixelChecks({ bytes: generated.bytes, aspectRatio: task.deliverySpec.aspectRatio });
      const ocrCheck = await socialImageCandidateOcrCheck({ bytes: generated.bytes, mimeType: generated.mimeType,
        expectedTexts: [String(plannedUnit?.poster.headline || task.imageTextContract.headline),
          String(plannedUnit?.poster.subheadline || task.imageTextContract.supportingText || ''), task.imageTextContract.cta || ''],
        recognize: recognizeProductImageLocally });
      const localChecks = new Map([...pixelChecks, ocrCheck].map(check => [check.key, check]));
      const deterministicForOutput = deterministic.map(check => localChecks.get(check.key) || check);
      let visual = [] as Awaited<ReturnType<typeof qualityCheckSocialImageWithQwen>>;
      try {
        visual = await qualityCheckSocialImageWithQwen({ generated, products, reference, expected: {
          headline: String(plannedUnit?.poster.headline || task.imageTextContract.headline),
          supportingText: String(plannedUnit?.poster.subheadline || task.imageTextContract.supportingText),
          cta: task.imageTextContract.cta, facts: task.imageTextContract.requiredFacts, format: task.deliverySpec.format,
        } });
      } catch { /* provider failure stays uncertain; never fabricate a pass */ }
      const qualityChecks = mergeSocialImageVisualChecks(deterministicForOutput, visual);
      qualityChecks.push(...await inspectSocialImageCandidateFactors({ task, bytes: generated.bytes,
        mimeType: generated.mimeType, ocr: localProductOcrReadiness().ready ? recognizeProductImageTokensLocally : undefined }));
      const failed = qualityChecks.filter(check => check.severity === 'hard' && !['pass', 'not_applicable'].includes(check.verdict));
      return { ...output, contentHash: createHash('sha256').update(generated.bytes).digest('hex'),
        state: failed.length ? 'repair_required' as const : 'quality_checking' as const, qualityChecks };
    }));
    const generationJobs = task.generationJobs.map(job => job.status === 'quality_checking'
      ? { ...job, status: 'completed' as const, updatedAt: new Date().toISOString() }
      : job);
    const repairInstructions = [...task.repairInstructions];
    for (const output of outputs.filter(item => item.state === 'repair_required')) {
      const failed = output.qualityChecks.filter(check => check.severity === 'hard' && check.verdict === 'fail');
      if (!failed.length || repairInstructions.some(item => item.outputNodeId === output.id && item.status === 'pending')) continue;
      repairInstructions.push({
        id: randomUUID(), outputNodeId: output.id, failedChecks: failed.map(check => check.key),
        targetLayer: failed.some(check => ['product_identity','packaging_visibility','subject_visibility','safe_zone'].includes(check.key)) ? 'product' : 'typography',
        instruction: failed.map(check => check.repairSuggestion || check.note).join('；').slice(0, 1000),
        status: 'pending', fromVersion: output.version,
      });
    }
    const result = await updateSocialImageTask(store, tenantId, task.id, task.version, { outputs, generationJobs, repairInstructions, status: 'review_required', step: 'review' });
    if (result.kind !== 'updated') { res.status(result.kind === 'conflict' ? 409 : 422).json({ ok: false, error: result.kind === 'invalid' ? result.issues.join('；') : '质检结果保存失败' }); return; }
    let reviewedTask = result.task;
    const current = socialImageCurrentOutputs(result.task).filter(output => output.state !== 'superseded');
    const snapshot = projectSocialImageProductionSnapshot(result.task);
    if (current.length === 1 && snapshot.currentNode === 'director_review' && snapshot.currentStatus === 'needs_review') {
      reviewedTask = await runSocialImageDirectorReview({ store, tenantId, taskId: result.task.id,
        expectedVersion: result.task.version, candidateId: current[0]!.id, candidateVersion: current[0]!.version });
    }
    res.json({ ok: true, task: reviewedTask, checks: outputs.flatMap(output => output.qualityChecks) });
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : '自动预检失败' });
  }
});
