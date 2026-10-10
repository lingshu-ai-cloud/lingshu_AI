import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { objectStorageUpload, objectStorageDelete } from '../storage/objectStorage.js';

process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.SEEDANCE_VIDEO_ENABLED = 'true';
process.env.DASHSCOPE_API_KEY = '';

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
const tenantId = 'local_tenant_storyboard_aigc_test';
const frameKey = `storyboard-test/${tenantId}/owned-video-shot-1.jpg`;
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'storyboard-test', tenantId, dataAuthority: 'local' };
};
store.list = (async collection => collection === 'tenant_profiles'
  ? { items: [{ id: 'profile', tenant_id: tenantId, profile: { products: { items: [
    { name: '重复产品', imageUrl: '/api/overseas/enterprise/assets/first.jpg' },
    { name: '重复产品', imageUrl: '/api/overseas/enterprise/assets/second.jpg' },
    { id: 'unique-product', name: '星河吊灯', imageUrl: '/api/overseas/enterprise/assets/third.jpg' },
  ] } } }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 }
  : { items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 }) as typeof store.list;
store.getById = (async (collection, id) => collection === 'trend_videos' && id === 'other-tenant-video'
  ? { id, tenantId: 'other-tenant', aiAnalysis: '{}' }
  : collection === 'trend_videos' && id === 'owned-video'
    ? { id, tenantId, aiAnalysis: JSON.stringify({ gemini: { scriptDetails15s: [{ materialEvidence: { extractionStatus: 'ready', firstFrameObjectKey: frameKey } }] } }) }
    : collection === 'studio_projects' && id === 'selected-project'
      ? { id, tenant_id: tenantId, spec: { selectedProductIds: ['unique-product'], shootingSlots: [{ id: 'shooting-1', slotId: 'shot-1', detail: '客厅安装星河吊灯' }] } }
    : null) as typeof store.getById;

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(dataAuthorityRequestScope);
app.use(express.json());
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const post = async (path: string, body: unknown) => {
  const response = await fetch(`http://127.0.0.1:${address.port}/studio${path}`, {
    method: 'POST', headers: { authorization: 'Bearer storyboard-test', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const frameDir = path.join(tenantAssetDir(path.resolve('data/media'), tenantId), 'trend-shots', 'owned-video');
try {
  const matched = await post('/storyboard-product-match', { projectId: 'selected-project', shotId: 'shot-1' });
  assert.equal(matched.status, 200);
  assert.deepEqual(matched.body.productIds, ['unique-product'], 'automatic shot mapping must stay within first-step selected products');
  const outsideSelection = await post('/storyboard-first-frame', { projectId: 'selected-project', shotId: 'shot-1', shotDescription: '产品特写', productId: 'product-0-重复产品', sceneType: 'product' });
  assert.equal(outsideSelection.body.code, 'PRODUCT_NOT_SELECTED_FOR_VIDEO');
  const duplicate = await post('/storyboard-first-frame', { shotId: 'shot-1', shotDescription: '产品特写', productId: 'product-0-重复产品', sceneType: 'product' });
  assert.equal(duplicate.status, 400, 'legacy product ID must not choose between duplicate names');

  const crossTenant = await post('/storyboard-first-frame', {
    shotId: 'shot-1', shotDescription: '工厂镜头', mode: 'replication', sceneType: 'factory',
    sourceFirstFrameUrl: '/api/overseas/videos/other-tenant-video/shot/1/first-frame',
  });
  assert.equal(crossTenant.status, 422);
  assert.equal(crossTenant.body.code, 'SOURCE_FRAME_REQUIRED');

  fs.mkdirSync(frameDir, { recursive: true });
  fs.writeFileSync(path.join(frameDir, 'shot-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await objectStorageUpload({ key: frameKey, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg' });
  const owned = await post('/storyboard-first-frame', {
    shotId: 'shot-1', shotDescription: '工厂镜头', mode: 'replication', sceneType: 'factory',
    sourceFirstFrameUrl: '/api/overseas/videos/owned-video/shot/1/first-frame',
  });
  assert.notEqual(owned.body.code, 'SOURCE_FRAME_REQUIRED', 'tenant-owned extracted first frame must resolve');

  const wrongConfirm = await post('/storyboard-first-frame/missing/confirm', { shotId: 'shot-1', fingerprint: 'wrong' });
  assert.equal(wrongConfirm.status, 404);

  const unconfirmed = await post('/seedance-video', { firstFrameMaterialId: 'missing', firstFrameFingerprint: 'hash', shotId: 'shot-1' });
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.body.code, 'FIRST_FRAME_NOT_CONFIRMED');
  const unconfirmedAction = await post('/storyboard-action-video', {
    firstFrameMaterialId: 'missing', firstFrameFingerprint: 'hash', shotId: 'shot-1', requestId: 'action-test-1',
    keyStates: [{ afterBeat: 1, description: '安装位置已对准', source: 'confirmed_storyboard' }],
  });
  assert.equal(unconfirmedAction.status, 409, 'multi-step route must reject an unconfirmed tenant first frame before paid calls');
  assert.equal(unconfirmedAction.body.code, 'FIRST_FRAME_NOT_CONFIRMED');
} finally {
  fs.rmSync(frameDir, { recursive: true, force: true });
  await objectStorageDelete(frameKey);
  server.close();
}
