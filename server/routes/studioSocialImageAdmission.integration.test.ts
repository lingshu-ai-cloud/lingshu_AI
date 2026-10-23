import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';

const localStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-social-image-admission-'));
process.env.LOCAL_STORE_DIR = localStoreDir;
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.MATERIAL_LIBRARY_FILE = path.join(localStoreDir, 'materials.json');
process.env.LOCAL_OBJECT_STORAGE_ROOT = path.join(localStoreDir, 'objects');
process.env.OBJECT_STORAGE_DRIVER = 'local';

const { auth, store } = await import('../storage/index.js');
const { createSocialImageTask, updateSocialImageTask } = await import('../socialImage/socialImageTask.js');
const { createOrResumeBoundSocialImageRun } = await import('../socialImage/socialImageProductionRun.js');
const { defaultBrief } = await import('../starter198/socialContentTaskSupport.js');
const { STARTER_COLLECTIONS } = await import('../starter198/repository.js');
const { SOCIAL_WORK_PACKAGE_KINDS } = await import('../../shared/contracts/socialContentWorkflow.js');
const { claimSocialImagePlannedUnit } = await import('../socialImage/socialImageDurablePlan.js');
const { completeSocialImagePaidJob, socialImageOwnedMaterialUrl } = await import('../socialImage/socialImagePaidJob.js');
const { createGeneratedImageMaterial } = await import('../lib/generatedImageMaterial.js');
const { readLocalMaterials } = await import('../lib/materialLibrary.js');
const { enterpriseAssetObjectKey } = await import('../storage/enterpriseAssets.js');
const { objectStorageDownload, objectStorageUpload } = await import('../storage/objectStorage.js');
const { bindDataAuthority, dataAuthorityRequestScope, runWithDataAuthority } = await import('../storage/dataAuthority.js');
const { requireAuth } = await import('../middleware/auth.js');
const tenantId = 'local_tenant_studio_social_image_admission';
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'studio-social-image-admission-test', tenantId, dataAuthority: 'local' };
};

const { studioRouter } = await import('./studio.js');
const { socialImageRouter } = await import('./socialImage.js');
const { readTenantEnterpriseProfile, updateTenantEnterpriseProfile } = await import('./enterpriseProfileStore.js');

test('HTTP image routes reject forged evidence and finalize durable GIF plates idempotently', async () => {
  const app = express();
  app.use(dataAuthorityRequestScope);
  app.use(express.json());
  app.use('/studio', studioRouter);
  app.use('/social-images', requireAuth, socialImageRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/studio/fb-poster/render`;
  const headers = { 'content-type': 'application/json', authorization: 'Bearer studio-social-image-admission-test' };
  const createdIds: string[] = [];

  try {
    const now = '2026-10-24T02:00:00.000Z';
    await store.create(STARTER_COLLECTIONS.socialContentTasks, {
      id: 'studio-image-paid-gate-content', tenant_id: tenantId, task_id: 'studio-image-paid-gate',
      status: 'plan_review', version: '1', brief: defaultBrief({ title: '付费前置证据测试', objective: '展示产品',
        mode: 'instant', productId: 'product-a', productRef: '产品 A', audience: '采购', platforms: ['instagram'],
        languages: ['zh'], formats: ['social_image'], aspectRatio: '4:5', creationMode: 'material_processing' }),
      task_mode: 'instant', theme_selection: '', script_baseline: '', director_plan: '', material_requirements: [],
      package_selection: SOCIAL_WORK_PACKAGE_KINDS.map(kind => ({ kind, packageKey: kind, version: '1', name: kind })),
      run_id: '', weekly_plan_id: '', source_count: 0, knowledge_source_count: 0, material_source_count: 0,
      artifact_count: 0, approved_artifact_count: 0, delivery_package_count: 0, publication_count: 0,
      metric_submission_count: 0, created_at: now, updated_at: now,
    });
    const v3 = (await createOrResumeBoundSocialImageRun(store, tenantId, {
      contentTaskId: 'studio-image-paid-gate', expectedContentTaskVersion: '1',
      idempotencyKey: 'studio-image-paid-gate', entrySource: 'assistant', imageType: 'product_poster',
    }, now)).task;
    createdIds.push(v3.id);
    const queued = { id: 'forged-paid-unit', idempotencyKey: 'forged-paid-unit', status: 'queued' as const,
      outputNodeIds: [], attempt: 0, createdAt: now, updatedAt: now };
    const v3Patch = await fetch(`http://127.0.0.1:${address.port}/social-images/tasks/${v3.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: v3.version,
        patch: { status: 'generating', step: 'generate', generationJobs: [queued] } }),
    });
    assert.equal(v3Patch.status, 422);
    assert.equal((await v3Patch.json() as { code?: string }).code, 'social_image_business_context_incomplete');
    const row = await store.getById<{ spec: Record<string, unknown> }>('studio_projects', v3.id);
    assert.ok(row);
    await store.update('studio_projects', v3.id, { spec: { ...row.spec, socialImageTask: { ...v3, generationJobs: [queued] } } });
    const v3Render = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ imageTaskId: v3.id, imageJobId: queued.id, imagePrompt: 'bypass formal evidence' }) });
    assert.equal(v3Render.status, 409);
    assert.equal((await v3Render.json() as { code?: string }).code, 'social_image_business_context_incomplete');

    for (const [imageType, expectedCode] of [
      ['gif_poster', 'social_image_frozen_plan_invalid'],
      ['carousel', 'social_image_frozen_plan_invalid'],
    ] as const) {
      const task = await createSocialImageTask(store, tenantId, { title: `Admission ${imageType}`, imageType });
      createdIds.push(task.id);
      const response = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({ imageTaskId: task.id, imageJobId: 'not-a-frozen-unit', imagePrompt: 'Must not run' }),
      });
      const result = await response.json() as { code?: string };
      assert.equal(response.status, 409, JSON.stringify(result));
      assert.equal(result.code, expectedCode);
      if (imageType === 'gif_poster') {
        const finalize = await fetch(`http://127.0.0.1:${address.port}/social-images/tasks/${task.id}/finalize-gif`, {
          method: 'POST', headers, body: JSON.stringify({ expectedVersion: task.version }),
        });
        const finalization = await finalize.json() as { code?: string };
        assert.equal(finalize.status, 409, JSON.stringify(finalization));
        assert.equal(finalization.code, 'social_image_frozen_plan_invalid');
      }
    }

    const reviewTask = await createSocialImageTask(store, tenantId, { title: 'Output admission' });
    createdIds.push(reviewTask.id);
    const output = {
      id: 'server-output-1', role: 'single' as const, label: '主视觉', state: 'quality_checking' as const,
      mediaUrl: '/media/tenant-owned.png', materialId: 'material-1', version: 1, qualityChecks: [],
    };
    const ready = await updateSocialImageTask(store, tenantId, reviewTask.id, reviewTask.version, { outputs: [output] });
    assert.equal(ready.kind, 'updated');
    if (ready.kind !== 'updated') return;
    const patchUrl = `http://127.0.0.1:${address.port}/social-images/tasks/${reviewTask.id}`;
    const forged = await fetch(patchUrl, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expectedVersion: ready.task.version, patch: {
        outputs: [{ ...output, state: 'approved', qualityChecks: [{ key: 'product_identity', verdict: 'pass', severity: 'hard', note: 'forged' }] }],
      } }),
    });
    const rejection = await forged.json() as { code?: string };
    assert.equal(forged.status, 409, JSON.stringify(rejection));
    assert.equal(rejection.code, 'social_image_outputs_server_owned');

    const forgedDelivery = await fetch(patchUrl, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expectedVersion: ready.task.version, patch: {
        gifDelivery: { planVersion: 1, sourceHash: 'forged', frameOutputIds: [], finalOutputId: 'forged' },
      } }),
    });
    assert.equal(forgedDelivery.status, 403);
    assert.equal((await forgedDelivery.json() as { code?: string }).code, 'social_image_gif_delivery_server_owned');

    const repair = await fetch(patchUrl, {
      method: 'PATCH', headers,
      body: JSON.stringify({ expectedVersion: ready.task.version, patch: {
        outputs: [{ ...output, state: 'repair_required' }],
      } }),
    });
    const repaired = await repair.json() as { task?: { outputs?: Array<{ state?: string }> } };
    assert.equal(repair.status, 200, JSON.stringify(repaired));
    assert.equal(repaired.task?.outputs?.[0]?.state, 'repair_required');

    const product = await sharp({ create: { width: 30, height: 50, channels: 4, background: '#c52727' } }).png().toBuffer();
    const productFilename = `gif-http-product-${process.pid}.png`;
    await objectStorageUpload({ key: enterpriseAssetObjectKey(tenantId, productFilename), body: product, contentType: 'image/png' });
    const profile = await readTenantEnterpriseProfile(tenantId);
    await updateTenantEnterpriseProfile(tenantId, { products: { ...profile.products, items: [{ id: 'gif-http-product', name: 'Fixture product',
      images: [{ name: productFilename, type: 'image/png', size: product.length, updatedAt: new Date().toISOString(),
        url: `/api/overseas/enterprise/assets/${productFilename}` }] }] } }, 'test');
    const gif = await createSocialImageTask(store, tenantId, { imageType: 'gif_poster', title: 'Durable HTTP GIF' });
    createdIds.push(gif.id);
    const configured = await updateSocialImageTask(store, tenantId, gif.id, gif.version, {
      renderBrief: { headline: 'Product', subheadline: 'Stable', originBadge: '', trustBadges: [], sellingPoints: [],
        process: [], categories: [], bottomBar: [], cta: 'Contact' },
      contentBrief: { ...gif.contentBrief, coreClaim: 'Fixture product', productRefs: ['gif-http-product'] },
      enterpriseAssets: [{ assetId: 'gif-http-product', role: 'product', name: 'Fixture product',
        source: 'enterprise_knowledge_base', required: true }],
    });
    assert.equal(configured.kind, 'updated');
    if (configured.kind !== 'updated') return;
    const plannedResponse = await fetch(`http://127.0.0.1:${address.port}/social-images/tasks/${gif.id}/plan-units`, {
      method: 'POST', headers, body: JSON.stringify({ expectedVersion: configured.task.version }),
    });
    const plannedBody = await plannedResponse.json() as { task?: typeof configured.task; code?: string; paidExecutionEnabled?: boolean };
    assert.equal(plannedResponse.status, 200, JSON.stringify(plannedBody));
    assert.equal(plannedBody.paidExecutionEnabled, true);
    let current = plannedBody.task!;
    assert.equal(current.enterpriseAssets[0]?.contentHash, createHash('sha256').update(product).digest('hex'));
    await objectStorageUpload({ key: enterpriseAssetObjectKey(tenantId, productFilename), body: Buffer.from('changed'), contentType: 'image/png' });
    const stalePlate = await fetch(url, { method: 'POST', headers,
      body: JSON.stringify({ imageTaskId: gif.id, imageJobId: current.renderPlan!.units[0]!.jobId }) });
    assert.equal(stalePlate.status, 409);
    assert.equal((await stalePlate.json() as { code?: string }).code, 'social_image_gif_product_identity_changed');
    assert.equal(current.generationJobs[0]?.status, 'queued');
    await objectStorageUpload({ key: enterpriseAssetObjectKey(tenantId, productFilename), body: product, contentType: 'image/png' });
    for (const unit of current.renderPlan!.units) {
      const background = await sharp({ create: { width: 120, height: 150, channels: 4,
        background: ['#1769aa', '#39a96b', '#f29f05', '#9b51e0'][unit.index]! } }).png().toBuffer();
      const material = await createGeneratedImageMaterial({ title: `Plate ${unit.index}`, bytes: background,
        mimeType: 'image/png', source: 'fixture', tenantId, mediaRoot: path.join(localStoreDir, 'media') });
      const requestHash = 'a'.repeat(64);
      current = await runWithDataAuthority('local', async () => {
        await claimSocialImagePlannedUnit({ store, tenantId, taskId: gif.id, jobId: unit.jobId,
          idempotencyKey: unit.idempotencyKey, plannedInputHash: unit.plannedInputHash, renderRequestHash: requestHash });
        return completeSocialImagePaidJob({ store, tenantId, taskId: gif.id, jobId: unit.jobId,
          inputHash: requestHash, provider: 'fixture', output: { id: `gif-http-plate-${unit.index}`, role: 'gif_plate',
            label: unit.label, state: 'quality_checking', mediaUrl: socialImageOwnedMaterialUrl(material, tenantId),
            materialId: material.id, version: 1, qualityChecks: [] } });
      });
    }
    const finalizeUrl = `http://127.0.0.1:${address.port}/social-images/tasks/${gif.id}/finalize-gif`;
    await objectStorageUpload({ key: enterpriseAssetObjectKey(tenantId, productFilename), body: Buffer.from('changed'), contentType: 'image/png' });
    const changedProduct = await fetch(finalizeUrl, { method: 'POST', headers,
      body: JSON.stringify({ expectedVersion: current.version }) });
    assert.equal(changedProduct.status, 409);
    assert.equal((await changedProduct.json() as { code?: string }).code, 'social_image_gif_product_identity_changed');
    assert.equal(readLocalMaterials().filter(item => item.provenance?.socialImageTaskId === gif.id).length, 0);
    await objectStorageUpload({ key: enterpriseAssetObjectKey(tenantId, productFilename), body: product, contentType: 'image/png' });
    const deliveryResponse = await fetch(finalizeUrl, { method: 'POST', headers,
      body: JSON.stringify({ expectedVersion: current.version }) });
    const delivery = await deliveryResponse.json() as { task?: typeof current; url?: string; code?: string };
    assert.equal(deliveryResponse.status, 200, JSON.stringify(delivery));
    assert.equal(delivery.task?.gifDelivery?.frameOutputIds.length, 4);
    assert.equal(delivery.task?.outputs.filter(output => output.role === 'gif_output').length, 1);
    assert.equal(readLocalMaterials().filter(item => item.provenance?.socialImageTaskId === gif.id).length, 5);
    const final = readLocalMaterials().find(item => item.id === delivery.task?.outputs.find(output => output.role === 'gif_output')?.materialId);
    assert.ok(final?.objectKey);
    const storedGif = await objectStorageDownload(final.objectKey);
    assert.equal((await sharp(storedGif!.buf, { animated: true }).metadata()).pages, 4);
    const staleInputRewrite = await fetch(`http://127.0.0.1:${address.port}/social-images/tasks/${gif.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ expectedVersion: delivery.task!.version,
        patch: { contentBrief: { ...delivery.task!.contentBrief, coreClaim: 'Changed after paid delivery' } } }),
    });
    assert.equal(staleInputRewrite.status, 409);
    assert.equal((await staleInputRewrite.json() as { code?: string }).code, 'social_image_paid_inputs_frozen');
    const repeated = await fetch(finalizeUrl, { method: 'POST', headers,
      body: JSON.stringify({ expectedVersion: current.version }) });
    const repeatedBody = await repeated.json() as { task?: typeof current };
    assert.equal(repeated.status, 200);
    assert.equal(repeatedBody.task?.version, delivery.task?.version);
    assert.equal(readLocalMaterials().filter(item => item.provenance?.socialImageTaskId === gif.id).length, 5);
  } finally {
    for (const id of createdIds) await store.delete('studio_projects', id);
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(localStoreDir, { recursive: true, force: true });
  }
});
