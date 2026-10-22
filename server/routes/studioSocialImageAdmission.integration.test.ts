import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createSocialImageTask, updateSocialImageTask } from '../socialImage/socialImageTask.js';

const localStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-social-image-admission-'));
process.env.LOCAL_STORE_DIR = localStoreDir;
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
const { requireAuth } = await import('../middleware/auth.js');
const tenantId = 'local_tenant_studio_social_image_admission';
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'studio-social-image-admission-test', tenantId, dataAuthority: 'local' };
};

const { studioRouter } = await import('./studio.js');
const { socialImageRouter } = await import('./socialImage.js');

test('HTTP admission blocks unsafe multi-output renders and forged client delivery evidence', async () => {
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
    for (const [imageType, expectedCode] of [
      ['gif_poster', 'social_image_gif_delivery_not_ready'],
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
  } finally {
    for (const id of createdIds) await store.delete('studio_projects', id);
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(localStoreDir, { recursive: true, force: true });
  }
});
