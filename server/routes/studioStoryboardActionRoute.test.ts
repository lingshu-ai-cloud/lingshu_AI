import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { compileStoryboardShotSpec } from '../../shared/storyboardShotSpec';
import { tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess';
import { saveLocalMaterials } from '../lib/materialLibrary';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput';

const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-action-route-'));
process.chdir(sandbox);
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.SEEDANCE_VIDEO_ENABLED = 'true';
process.env.SEEDANCE_API_KEY = 'local-test-key';
process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY = '100';
process.env.STORYBOARD_AIGC_MAX_RETRIES = '1';
process.env.SEEDANCE_BASE_URL = 'https://provider-test.invalid';

const tenantId = 'local_tenant_storyboard_action_route_tenant';
const projectId = 'project-1';
const shotId = 'slot-1';
const productId = 'lamp-1';
const firstFrameId = 'confirmed-frame-1';
const fingerprint = 'confirmed-fingerprint-1';
const requestId = 'action-route-test-001';
const keyStates = [{ afterBeat: 1, description: '灯具已经对准安装位，尚未固定', source: 'confirmed_storyboard' as const }];
const firstFrameFile = 'confirmed-frame.jpg';
const firstFrameDirectory = tenantAssetDir(path.resolve('data/media'), tenantId);
const productDirectory = path.resolve('data/enterprise-assets', enterpriseAssetTenantKey(tenantId));
fs.mkdirSync(firstFrameDirectory, { recursive: true });
fs.mkdirSync(productDirectory, { recursive: true });
const image = await sharp({ create: { width: 128, height: 192, channels: 3, background: '#d7e2ee' } }).jpeg().toBuffer();
fs.writeFileSync(path.join(firstFrameDirectory, firstFrameFile), image);
fs.writeFileSync(path.join(productDirectory, 'lamp.jpg'), image);

const shotSpec = compileStoryboardShotSpec({
  shotId, mode: 'free_creation', scene: 'usage', description: '在家使用并安装吊灯', ratio: '9:16',
  startSeconds: 0, endSeconds: 20,
  assets: [{ role: 'product', id: productId, version: createHash('sha256').update(image.toString('base64')).digest('hex'), source: 'knowledge_base' }],
  action: { startState: '手持吊灯', beats: ['对准安装位', '固定吊灯', '松手展示'], endState: '吊灯固定完成', evidence: 'confirmed_storyboard' },
});
const projectSpec = { ratio: '9:16', selectedProductIds: [productId],
  shootingSlots: [{ id: 'persisted-shot-1', slotId: shotId, detail: '在家使用并安装吊灯', duration: 20 }],
  storyboardSourcePlans: { [shotId]: { mode: 'ai', userSource: 'ai', productIds: [productId],
    videoResolutionPinned: true, videoResolution: '480p', actionStartState: '手持吊灯', actionEndState: '吊灯固定完成',
    actionKeyStates: keyStates[0].description } },
};
const projectShotFingerprint = storyboardProjectShotInput(projectSpec, shotId)?.fingerprint;
assert.ok(projectShotFingerprint);
saveLocalMaterials([{ id: firstFrameId, name: '已确认首帧', folder: 'product', type: 'image', duration: 0,
  size: '1 KB', file: tenantAssetRelativePath(tenantId, firstFrameFile),
  url: `/media/${tenantAssetRelativePath(tenantId, firstFrameFile)}`, scope: 'own', tenantId,
  sourceType: 'ai-storyboard-first-frame', createdAt: new Date().toISOString(),
  provenance: { projectId, shotId, fingerprint, projectShotFingerprint, confirmed: true, shotSpec,
    productIds: [productId], actionKeyStates: keyStates } }]);

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => {
  bindDataAuthority('local');
  return { userId: 'action-route-test', tenantId, dataAuthority: 'local' };
};
store.list = (async collection => collection === 'tenant_profiles'
  ? { items: [{ id: 'profile', tenant_id: tenantId, profile: { products: { items: [
    { id: productId, name: '测试吊灯', imageUrl: '/api/overseas/enterprise/assets/lamp.jpg' },
  ] } } }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 }
  : { items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 }) as typeof store.list;
store.getById = (async (collection, id) => collection === 'studio_projects' && id === projectId
  ? { id, tenant_id: tenantId, spec: projectSpec } : null) as typeof store.getById;

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(dataAuthorityRequestScope);
app.use(express.json());
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
let providerSubmissions = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://provider-test.invalid/contents/generations/tasks')) {
    providerSubmissions += 1;
    return new Response(JSON.stringify({ error: { message: 'controlled provider rejection' } }),
      { status: 400, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
}) as typeof fetch;
const post = async (body: Record<string, unknown>) => {
  const response = await originalFetch(`http://127.0.0.1:${address.port}/studio/storyboard-action-video`, {
    method: 'POST', headers: { authorization: 'Bearer route-test', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
try {
  const base = { firstFrameMaterialId: firstFrameId, firstFrameFingerprint: fingerprint, shotId,
    requestId, ratio: '9:16', resolution: '480p', keyStates };
  const changed = await post({ ...base, keyStates: [{ ...keyStates[0], description: '未经首帧确认的不同状态' }] });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.code, 'ACTION_KEY_STATES_CHANGED');
  assert.equal(providerSubmissions, 0);

  const attempted = await post(base);
  assert.equal(providerSubmissions, 1, `confirmed text key state should reach one provider submission: ${JSON.stringify(attempted.body)}`);
  assert.equal(attempted.body.code, 'STORYBOARD_ACTION_VIDEO_FAILED');
  assert.equal(attempted.body.acceptedSegmentCount, 0);
  const duplicate = await post(base);
  assert.equal(duplicate.body.code, 'ACTION_REQUEST_NEEDS_RECONCILIATION');
  assert.equal(providerSubmissions, 1, 'same paid request must never be submitted twice');
  console.log('studioStoryboardActionRoute tests passed');
} finally {
  globalThis.fetch = originalFetch;
  server.close();
  process.chdir(originalCwd);
  fs.rmSync(sandbox, { recursive: true, force: true });
}
