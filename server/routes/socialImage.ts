import {registerSocialImageExecutionRoutes} from './socialImageExecutionRoutes.js';
import {imageWorkflowAssets} from '../socialImage/socialImageWorkflowAssets.js';
import { prepareImageEvidence, renderImageLayers, preflightImage, ImageQuotaResponseHandled, ImageWorkflowError } from '../socialImage/socialImageWorkflowCommands.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import sharp from 'sharp';
import type { AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { readSocialImageTask, socialImageClientOutputPatchIssue, updateSocialImageTask } from '../socialImage/socialImageTask.js';
import { admitSocialImageV3QueuedJob, socialImageOwnedMaterialUrl, socialImageQueuedJobIssue, SocialImagePaidJobError } from '../socialImage/socialImagePaidJob.js';
import { recoverSocialImagePaidMaterial } from '../socialImage/socialImageMaterialRecovery.js';
import { finalizeSocialImageGif } from '../socialImage/socialImageGifDelivery.js';
import { createGeneratedImageMaterial } from '../lib/generatedImageMaterial.js';
import { consumeDemoQuota } from '../lib/demo.js';
import { readTenantMaterialBytes } from '../lib/sentenceReplicationProduction.js';
import { readMaterialLibrary } from '../lib/materialLibrary.js';
import {socialImageCurrentOutputs} from '../../shared/contracts/socialImageCreation.js';
import { compileLuxuryProductHero } from '../socialImage/templates/luxuryProductHero.js';
import { assertSocialImageLayerGraph } from '../socialImage/layerGraphValidation.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import {createOrResumeBoundSocialImageRun, createSocialImageDeliveryPackage, decideSocialImageCandidate, refreshSocialImageContentTaskBinding, runSocialImageDirectorReview, SocialImageProductionRunError} from '../socialImage/socialImageProductionRun.js';
import { projectSocialImageProductionSnapshot } from '../socialImage/socialImageProductionRuntime.js';
import { readSocialImageReferenceBytes } from '../socialImage/socialImageReferenceBytes.js';
import {compileSocialImageReferencePlan} from '../socialImage/socialImageReferenceStrategy.js';
import { resolveSocialImageReviewSet } from '../socialImage/socialImageReviewSet.js';
import { registerSocialImageFormalPlanRoutes } from './socialImageFormalPlanRoutes.js';
import {SocialImageQualityPreflightError} from '../socialImage/socialImageQualityPreflight.js';
import { acceptSocialImageQualityByHuman } from '../socialImage/socialImageHumanAcceptance.js';
import { continueSocialImageProduction } from '../socialImage/socialImageProductionContinuation.js';

export const socialImageRouter = Router();
registerSocialImageExecutionRoutes(socialImageRouter,store);
registerSocialImageFormalPlanRoutes(socialImageRouter, store,
  async (tenantId, productId) => (await enterpriseProductAsset(tenantId, productId))?.bytes || null);

const renderRoot = (tenantId: string) => path.resolve(process.cwd(), 'data', 'social-image-renders', enterpriseAssetTenantKey(tenantId));

const {enterpriseProductAsset,outputImageBytes}=imageWorkflowAssets(store);

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

/** Resume deterministic nodes only. This command never queues or invokes a paid provider. */
socialImageRouter.post('/tasks/:id/continue', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const result = await continueSocialImageProduction({ store, tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion) });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, ...result, snapshot: projectSocialImageProductionSnapshot(result.task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error
      : new SocialImageProductionRunError('social_image_continuation_failed', 503);
    res.status(failure.status).json({ ok: false, code: failure.code, error: failure.code });
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
    const result = await prepareImageEvidence({ store, tenantId: (res.locals as AuthLocals).tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion), enterpriseProductAsset, outputImageBytes,
      allowPaidCall: async () => { if (!await consumeDemoQuota(req, res, 'generation')) throw new ImageQuotaResponseHandled(); return true; } });
    res.json(result);
} catch (error) {
    if (error instanceof ImageQuotaResponseHandled) return;
    if(error instanceof ImageWorkflowError){res.status(error.status).json(error.body);return;}

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

/** The user's explicit visual decision is bound to the exact stored candidate bytes. */
socialImageRouter.post('/tasks/:id/quality/human-accept', async (req, res) => {
  try {
    if (req.body?.confirmed !== true) { res.status(400).json({ ok: false, code: 'social_image_human_confirmation_required' }); return; }
    const { tenantId, userId } = res.locals as AuthLocals;
    const result = await acceptSocialImageQualityByHuman({ store, tenantId, userId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion), candidateId: String(req.body?.candidateId || ''),
      candidateVersion: Number(req.body?.candidateVersion),
      expectedContentHash: String(req.body?.expectedContentHash || '').toLowerCase(), loadBytes: outputImageBytes });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, ...result, snapshot: projectSocialImageProductionSnapshot(result.task) });
  } catch (error) {
    const failure = error instanceof SocialImageProductionRunError ? error : new SocialImageProductionRunError('social_image_human_review_failed', 503);
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
    const decision = String(req.body?.decision || '');
    if (!['approved', 'rejected'].includes(decision)) { res.status(400).json({ ok: false, code: 'social_image_decision_invalid', error: '验收决定无效' }); return; }
    const idempotencyKey = String(req.body?.idempotencyKey || req.header('Idempotency-Key') || '').trim();
    if (!/^[a-z0-9:_-]{8,200}$/i.test(idempotencyKey)) {
      res.status(400).json({ ok: false, code: 'social_image_decision_idempotency_key_invalid', error: '验收请求缺少有效幂等键' }); return;
    }
    const replay = (task.approvalDecisions || []).some(item => item.idempotencyKey === idempotencyKey);
    const reviewSet = resolveSocialImageReviewSet(task, candidateId, candidateVersion);
    if (decision === 'approved' && !reviewSet) { res.status(409).json({ ok: false, code: 'social_image_review_set_incomplete', error: '交付物尚未全部完成，请刷新后审阅' }); return; }
    if (decision === 'approved' && reviewSet && !replay) {
      for (const candidate of reviewSet.outputs) {
        const media = await outputImageBytes(tenantId, candidate);
        if (!media?.bytes.length) { res.status(422).json({ ok: false, code: 'social_image_candidate_bytes_unavailable', error: '候选图片不可读取，不能验收' }); return; }
        if (createHash('sha256').update(media.bytes).digest('hex') !== candidate.contentHash) {
          res.status(409).json({ ok: false, code: 'social_image_candidate_hash_conflict', error: '交付物字节已变化，请重新质检' }); return;
        }
      }
    }
    const result = await decideSocialImageCandidate({
      store, tenantId, userId, taskId: task.id,
      expectedVersion: Number(req.body?.expectedVersion),
      candidateId, candidateVersion,
      expectedContentHash: String(req.body?.expectedContentHash || '').toLowerCase(),
      actualContentHash: String(output.contentHash || req.body?.expectedContentHash || ''),
      decision: decision as 'approved' | 'rejected',
      idempotencyKey,
      note: String(req.body?.note || ''),
    });
    const continued = await continueSocialImageProduction({ store, tenantId, taskId: result.task.id,
      expectedVersion: result.task.version });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, ...result, ...continued, snapshot: projectSocialImageProductionSnapshot(continued.task) });
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
      readBenchmark: async url => (await readSocialImageReferenceBytes(tenantId, url))?.bytes || null,
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
      try { Object.assign(patch, await admitSocialImageV3QueuedJob(store, tenantId, current, patch)); }
      catch (error) {
        const code = error instanceof SocialImagePaidJobError ? error.code : 'social_image_job_admission_failed';
        res.status(code === 'social_image_atomic_store_required' ? 503 : 422).json({ ok: false, code,
          error: '图片证据或生成规格未通过付费准入' }); return;
      }
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
    const result = await renderImageLayers({ store, tenantId: (res.locals as AuthLocals).tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion), enterpriseProductAsset, outputImageBytes,
      allowPaidCall: async () => { if (!await consumeDemoQuota(req, res, 'generation')) throw new ImageQuotaResponseHandled(); return true; } });
    res.json(result);
} catch (error) {
    if (error instanceof ImageQuotaResponseHandled) return;
    if(error instanceof ImageWorkflowError){res.status(error.status).json(error.body);return;}

    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '分层渲染失败' });
  }
});

socialImageRouter.post('/tasks/:id/quality/preflight', async (req, res) => {
  try {
    const result = await preflightImage({ store, tenantId: (res.locals as AuthLocals).tenantId, taskId: req.params.id,
      expectedVersion: Number(req.body?.expectedVersion), enterpriseProductAsset, outputImageBytes,
      allowPaidCall: async () => { if (!await consumeDemoQuota(req, res, 'generation')) throw new ImageQuotaResponseHandled(); return true; } });
    res.json(result);
} catch (error) {
    if (error instanceof ImageQuotaResponseHandled) return;
    if(error instanceof ImageWorkflowError){res.status(error.status).json(error.body);return;}

    const failure = error instanceof SocialImageQualityPreflightError ? error : null;
    res.status(failure?.status || 503).json({ ok: false, code: failure?.code || 'social_image_quality_preflight_failed',
      error: error instanceof Error ? error.message : '自动预检失败' });
  }
});
