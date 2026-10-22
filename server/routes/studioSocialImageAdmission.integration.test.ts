import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createSocialImageTask } from '../socialImage/socialImageTask.js';

const localStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-social-image-admission-'));
process.env.LOCAL_STORE_DIR = localStoreDir;
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
const tenantId = 'local_tenant_studio_social_image_admission';
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'studio-social-image-admission-test', tenantId, dataAuthority: 'local' };
};

const { studioRouter } = await import('./studio.js');

test('GIF and invalid carousel units are rejected by HTTP admission before any paid render', async () => {
  const app = express();
  app.use(dataAuthorityRequestScope);
  app.use(express.json());
  app.use('/studio', studioRouter);
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
    }
  } finally {
    for (const id of createdIds) await store.delete('studio_projects', id);
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(localStoreDir, { recursive: true, force: true });
  }
});
