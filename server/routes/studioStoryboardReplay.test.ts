import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { compileStoryboardShotSpec } from '../../shared/storyboardShotSpec.js';
import { planStoryboardActionSegments } from '../../shared/storyboardActionSegments.js';
import { storyboardProjectShotInput } from '../lib/storyboardProjectShotInput.js';
import { tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { saveLocalMaterials } from '../lib/materialLibrary.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';

const previousCwd = process.cwd();
const previousFetch = globalThis.fetch;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-replay-'));
process.chdir(sandbox);
process.env.SUBSCRIPTION_ENFORCED = 'false';
process.env.DEMO_MODE = 'false';
process.env.SEEDANCE_VIDEO_ENABLED = 'false';
delete process.env.SEEDANCE_API_KEY;
delete process.env.SEEDREAM_API_KEY;
process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY = '100';
process.env.STORYBOARD_AIGC_MAX_RETRIES = '1';
process.env.STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED = 'false';

const tenantId = 'local_tenant_storyboard_replay';
const slotId = 'slot-1';
const productId = 'lamp-1';
const keyStates = [{ afterBeat: 1, description: '灯具已经对准安装位，尚未固定', source: 'confirmed_storyboard' as const }];
const image = await sharp({ create: { width: 128, height: 192, channels: 3, background: '#ddeeff' } }).jpeg().toBuffer();
const productDirectory = path.resolve('data/enterprise-assets', enterpriseAssetTenantKey(tenantId));
fs.mkdirSync(productDirectory, { recursive: true });
fs.writeFileSync(path.join(productDirectory, 'lamp.jpg'), image);
const mediaDirectory = tenantAssetDir(path.resolve('data/media'), tenantId);
fs.mkdirSync(mediaDirectory, { recursive: true });
fs.writeFileSync(path.join(mediaDirectory, 'frame.jpg'), image);
const productAsset = { role: 'product' as const, id: productId,
  version: createHash('sha256').update(image.toString('base64')).digest('hex'), source: 'knowledge_base' as const };
const singleShot = compileStoryboardShotSpec({ shotId: slotId, mode: 'free_creation', scene: 'product',
  description: '吊灯产品固定机位特写', ratio: '9:16', startSeconds: 0, endSeconds: 4, assets: [productAsset] });
const actionShot = compileStoryboardShotSpec({ shotId: slotId, mode: 'free_creation', scene: 'usage',
  description: '在家使用并安装吊灯', ratio: '9:16', startSeconds: 0, endSeconds: 20, assets: [productAsset],
  action: { startState: '手持吊灯', beats: ['对准安装位', '固定吊灯', '松手展示'], endState: '吊灯固定完成', evidence: 'confirmed_storyboard' } });
const specFor = (shot: typeof singleShot) => ({ ratio: '9:16', selectedProductIds: [productId],
  automation: { managedBy: 'digital_employee' }, contentOrder: { operatingContext: { estimatedContentCost: 0.01 } },
  shootingSlots: [{ id: 'persisted-1', slotId, detail: shot.description, duration: shot.targetDurationSeconds }],
  storyboardSourcePlans: { [slotId]: { mode: 'ai', productIds: [productId], sceneType: shot.scene,
    videoResolutionPinned: true, videoResolution: '480p', actionStartState: shot.action.startState,
    actionEndState: shot.action.endState, actionKeyStates: shot.scene === 'usage' ? keyStates[0].description : '' } } });
const singleSpec = specFor(singleShot);
const actionSpec = specFor(actionShot);
const frameSpec = { mode: 'free_creation', ratio: '9:16', selectedProductIds: [],
  automation: { managedBy: 'digital_employee' }, contentOrder: { operatingContext: { estimatedContentCost: 0.01 } },
  shootingSlots: [{ id: 'persisted-1', slotId, detail: '工厂生产线固定机位全景', duration: 4 }],
  storyboardSourcePlans: { [slotId]: { mode: 'ai', sceneType: 'factory' } } };
const projects: Record<string, any> = { 'single-project': singleSpec, 'action-project': actionSpec, 'frame-project': frameSpec };
saveLocalMaterials([['single-project', singleShot, singleSpec], ['action-project', actionShot, actionSpec]].map(([projectId, shot, spec]) => ({
  id: `${projectId}-frame`, name: '已确认首帧', folder: 'product', type: 'image', duration: 0, size: '1 KB',
  file: tenantAssetRelativePath(tenantId, 'frame.jpg'), url: `/media/${tenantAssetRelativePath(tenantId, 'frame.jpg')}`,
  scope: 'own', tenantId, sourceType: 'ai-storyboard-first-frame', createdAt: new Date().toISOString(),
  provenance: { projectId, shotId: slotId, fingerprint: `${projectId}-fingerprint`, confirmed: true,
    projectShotFingerprint: storyboardProjectShotInput(spec as any, slotId)!.fingerprint, shotSpec: shot,
    productIds: [productId], ...(projectId === 'action-project' ? { actionKeyStates: keyStates } : {}) },
})) as any);

const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => { bindDataAuthority('local'); return { userId: 'replay-test', tenantId, dataAuthority: 'local' }; };
store.list = (async collection => collection === 'tenant_profiles'
  ? { items: [{ id: 'profile', tenant_id: tenantId, profile: { products: { items: [{ id: productId, name: '测试吊灯', imageUrl: '/api/overseas/enterprise/assets/lamp.jpg' }] } } }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 }
  : { items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 }) as typeof store.list;
store.getById = (async (collection, id) => collection === 'studio_projects' && projects[id]
  ? { id, tenant_id: tenantId, spec: projects[id] } : null) as typeof store.getById;
const { storyboardAigcProjectBudget } = await import('../lib/storyboardAigcProjectBudget.js');
const singleRequestId = 'existing-video-request';
const singleOperationId = `storyboard-video:${createHash('sha256').update(`${tenantId}:single-project:${slotId}:${singleRequestId}`).digest('hex')}`;
const frameRequestId = 'existing-frame-request';
const frameOperationId = `firstframe:${createHash('sha256').update(`${tenantId}:frame-project:${slotId}:${frameRequestId}`).digest('hex')}`;
const actionRequestId = 'existing-action-request';
const actionPlan = planStoryboardActionSegments({ shot: actionShot,
  capability: { minDurationSeconds: 4, maxDurationSeconds: 15, integerDurationSeconds: true, supportsFirstFrame: true, supportsEndFrame: false },
  firstFrameAssetId: 'action-project-frame', keyStates, requireKeyStateSegments: true });
if (actionPlan.status === 'blocked') assert.fail('The replay fixture must have a valid segmented action plan');
const actionCost = actionPlan.segments.reduce((sum, segment) => sum + segment.providerDurationSeconds * .9, 0);
for (const [projectId, operationId, stage, amount] of [
  ['single-project', singleOperationId, 'video', 3.6], ['frame-project', frameOperationId, 'first_frame', .3],
  ['action-project', `storyboard-action:${actionRequestId}`, 'video', actionCost],
] as const) {
  await storyboardAigcProjectBudget.reserve({ tenantId, projectId, operationId, shotId: slotId, stage, estimatedCostCny: amount });
  await storyboardAigcProjectBudget.recordProviderAcceptance(tenantId, projectId, operationId, `original-${projectId}`, 'original-model');
}
process.env.STORYBOARD_AIGC_BATCH_BUDGET_CNY = '0.01';
const { studioRouter } = await import('./studio.js');
const app = express(); app.use(dataAuthorityRequestScope); app.use(express.json()); app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
let providerCalls = 0;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  if (!String(args[0]).startsWith('http://127.0.0.1:')) { providerCalls++; throw new Error('No provider calls allowed in receipt tests'); }
  return previousFetch(...args);
}) as typeof fetch;
const post = async (route: string, body: Record<string, unknown>) => {
  const response = await previousFetch(`http://127.0.0.1:${address.port}/studio${route}`, {
    method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
try {
  const singleBody = { firstFrameMaterialId: 'single-project-frame', firstFrameFingerprint: 'single-project-fingerprint',
    shotId: slotId, requestId: singleRequestId, ratio: '9:16', duration: 4, resolution: '480p' };
  const single = await post('/seedance-video', singleBody);
  assert.equal(single.status, 202, JSON.stringify(single.body));
  assert.equal(single.body.providerTaskId, 'original-single-project', JSON.stringify(single.body));
  assert.equal(single.body.code, 'STORYBOARD_VIDEO_IN_PROGRESS');
  const changed = await post('/seedance-video', { ...singleBody, duration: 5 });
  assert.equal(changed.body.code, 'STORYBOARD_OPERATION_INPUT_CONFLICT');
  await storyboardAigcProjectBudget.mark(tenantId, 'single-project', singleOperationId, 'uncertain');
  const uncertain = await post('/seedance-video', singleBody);
  assert.equal(uncertain.status, 202, JSON.stringify(uncertain.body));
  assert.equal(uncertain.body.code, 'STORYBOARD_VIDEO_IN_PROGRESS');
  assert.equal(uncertain.body.providerTaskId, 'original-single-project', JSON.stringify(uncertain.body));
  await storyboardAigcProjectBudget.mark(tenantId, 'single-project', singleOperationId, 'completed', { materialId: 'missing-output' });
  const missing = await post('/seedance-video', singleBody);
  assert.equal(missing.body.code, 'STORYBOARD_VIDEO_RECONCILIATION_REQUIRED');
  const action = await post('/storyboard-action-video', { firstFrameMaterialId: 'action-project-frame',
    firstFrameFingerprint: 'action-project-fingerprint', shotId: slotId, requestId: actionRequestId,
    ratio: '9:16', resolution: '480p', keyStates });
  assert.equal(action.status, 202, JSON.stringify(action.body));
  assert.equal(action.body.providerTaskId, 'original-action-project');
  const frame = await post('/storyboard-first-frame', { projectId: 'frame-project', shotId: slotId, requestId: frameRequestId,
    mode: 'free_creation', sceneType: 'factory', ratio: '9:16', shotDescription: '工厂生产线固定机位全景', startSeconds: 0, endSeconds: 4 });
  assert.equal(frame.status, 202, JSON.stringify(frame.body));
  assert.equal(frame.body.providerTaskId, 'original-frame-project');
  assert.equal(providerCalls, 0);
  assert.equal((await storyboardAigcProjectBudget.status(tenantId, 'single-project')).usedCny, 3.6);
  assert.equal((await storyboardAigcProjectBudget.status(tenantId, 'frame-project')).usedCny, .3);
  assert.equal((await storyboardAigcProjectBudget.status(tenantId, 'action-project')).usedCny, actionCost);
  console.log('studioStoryboardReplay isolated route tests passed');
} finally {
  globalThis.fetch = previousFetch;
  server.close();
  process.chdir(previousCwd);
  fs.rmSync(sandbox, { recursive: true, force: true });
}
