import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import sharp from 'sharp';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import { objectStorageUpload } from '../storage/objectStorage.js';
import { tenantPrivateObjectKey } from '../storage/materialAssets.js';

const suffix = randomUUID();
const tenantId = `local_tenant_storyboard_e2e_${suffix}`;
let projectId = `storyboard-project-${suffix}`;
const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-aigc-e2e-'));
const originals = {
  fetch: globalThis.fetch,
  env: Object.fromEntries(['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_IMAGE_BASE_URL', 'SEEDANCE_API_KEY',
    'SEEDANCE_BASE_URL', 'SEEDANCE_VIDEO_ENABLED', 'OBJECT_STORAGE_DRIVER', 'LOCAL_OBJECT_STORAGE_ROOT',
    'STORYBOARD_AIGC_BATCH_BUDGET_CNY', 'STORYBOARD_AIGC_MAX_RETRIES', 'STORYBOARD_AIGC_BUDGET_DIR', 'DEMO_MODE', 'SUBSCRIPTION_ENFORCED'].map(key => [key, process.env[key]])),
};
Object.assign(process.env, {
  DASHSCOPE_API_KEY: 'test-only', DASHSCOPE_BASE_URL: 'https://mock.storyboard/compatible-mode/v1',
  DASHSCOPE_IMAGE_BASE_URL: 'https://mock.storyboard/compatible-mode/v1', SEEDANCE_API_KEY: 'test-only',
  SEEDANCE_BASE_URL: 'https://mock.seedance', SEEDANCE_VIDEO_ENABLED: 'true',
  OBJECT_STORAGE_DRIVER: 'local', LOCAL_OBJECT_STORAGE_ROOT: path.join(assetRoot, 'objects'),
  STORYBOARD_AIGC_BATCH_BUDGET_CNY: '200', STORYBOARD_AIGC_MAX_RETRIES: '1',
  STORYBOARD_AIGC_BUDGET_DIR: path.join(assetRoot, 'budget'), DEMO_MODE: 'false', SUBSCRIPTION_ENFORCED: 'false',
});
const image = await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#c27f49' } }).png().toBuffer();
const videoFile = path.join(assetRoot, 'candidate.mp4');
assert.ok(ffmpegStatic);
execFileSync(String(ffmpegStatic), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#c27f49:s=360x640:r=8:d=4',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', videoFile], { timeout: 30_000 });
const video = fs.readFileSync(videoFile);
const assetDir = path.join(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId));
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, 'product.png'), image);
const sideImage = await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#786a98' } }).png().toBuffer();
fs.writeFileSync(path.join(assetDir, 'product-side.png'), sideImage);
fs.writeFileSync(path.join(assetDir, 'product-2.png'), await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#4b78ac' } }).png().toBuffer());
const shotMediaDir = path.join(tenantAssetDir(path.resolve('data/media'), tenantId), 'trend-shots', `trend-${suffix}`);
fs.mkdirSync(shotMediaDir, { recursive: true });
fs.writeFileSync(path.join(shotMediaDir, 'shot-1.jpg'), await sharp(image).jpeg().toBuffer());
const sourceObjectKey = `storyboard-e2e/${tenantId}/source.jpg`;
await objectStorageUpload({ key: sourceObjectKey, body: await sharp(image).jpeg().toBuffer(), contentType: 'image/jpeg' });
const environmentMaterialId = `factory-environment-${suffix}`;
const characterMaterialId = `presenter-reference-${suffix}`;
const environmentObjectKey = tenantPrivateObjectKey('storyboard-e2e', tenantId, 'factory.png');
const characterObjectKey = tenantPrivateObjectKey('storyboard-e2e', tenantId, 'presenter.png');
await objectStorageUpload({ key: environmentObjectKey, body: image, contentType: 'image/png' });
await objectStorageUpload({ key: characterObjectKey, body: image, contentType: 'image/png' });
saveLocalMaterials([...readLocalMaterials(),
  { id: environmentMaterialId, tenantId, scope: 'own', type: 'image', name: '工厂流水线', folder: 'factory', duration: 0, url: '', objectKey: environmentObjectKey } as any,
  { id: characterMaterialId, tenantId, scope: 'own', type: 'image', name: '授权人物参考', folder: 'presenter', duration: 0, url: '', objectKey: characterObjectKey } as any]);
const foreignCharacterMaterialId = `foreign-presenter-${suffix}`;
saveLocalMaterials([...readLocalMaterials(), { id: foreignCharacterMaterialId, tenantId: `other-${tenantId}`,
  scope: 'own', type: 'image', name: '其他企业人物', folder: 'presenter', duration: 0, url: '', objectKey: characterObjectKey } as any]);
let supplierVideoPosts = 0;
let supplierImagePosts = 0;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://mock.storyboard/compatible-mode/v1/images/generations') {
    supplierImagePosts++;
    const payload = JSON.parse(String(init?.body || '{}'));
    if (String(payload.prompt || '').includes('两款企业吊灯')) {
      assert.equal(payload.image?.length, 3, 'clone source frame, product sheet and named person fit provider reference limit');
      assert.match(payload.prompt, /Reference image 2 is a grid of SEPARATE enterprise products/);
    }
    if (String(payload.prompt || '').includes('在家中安装星河吊灯'))
      assert.match(payload.prompt, /DIFFERENT VIEWS OF THE SAME/, 'single KB product uses its available second view');
    if (String(payload.prompt || '').includes('企业人物在本厂流水线手持星河吊灯特写')) {
      assert.equal(payload.image?.length, 3, 'source, enterprise product and person/environment sheet fit the model limit');
      assert.match(payload.prompt, /two-panel contact sheet/);
    }
    if (String(payload.prompt || '').includes('工厂流水线设备近景')) {
      assert.equal(payload.image?.length, 1, 'factory shot receives the selected environment image');
      assert.match(payload.prompt, /environment/i);
    }
    return json({ data: [{ url: 'https://mock.storyboard/candidate.png' }] });
  }
  if (url === 'https://mock.storyboard/candidate.png') return new Response(image, { headers: { 'content-type': 'image/png' } });
  if (url === 'https://mock.storyboard/compatible-mode/v1/chat/completions') {
    const payload = JSON.parse(String(init?.body || '{}'));
    const prompt = String(payload.messages?.[0]?.content?.[0]?.text || '');
    const firstFrame = prompt.includes('质检阶段：first_frame');
    const label = firstFrame ? '候选首帧' : '0s';
    const keys = firstFrame
      ? ['product_identity', 'person_identity', 'environment_fidelity', 'layout', 'contact', 'start_state', 'visual_integrity']
      : ['product_identity', 'person_identity', 'environment_fidelity', 'layout_continuity', 'contact_continuity', 'action_order', 'end_state', 'visual_integrity'];
    if (prompt.includes('企业工厂环境参考'))
      assert.ok(payload.messages?.[0]?.content?.some((item: any) => item.type === 'image_url'), 'factory reference enters visual QA');
    return json({ choices: [{ message: { content: JSON.stringify({ observations: keys.map(key => ({ key, verdict: 'pass',
      evidenceFrames: key === 'environment_fidelity' && !firstFrame ? ['0s', '0.5s'] : [label], note: '模拟模型返回通过，仅检验工作流接线' })) }) } }] });
  }
  if (url === 'https://mock.seedance/contents/generations/tasks' && init?.method === 'POST') {
    supplierVideoPosts++;
    const payload = JSON.parse(String(init.body || '{}'));
    assert.equal(payload.generate_audio, false, 'non-presenter B-roll must be silent');
    assert.ok(payload.content?.some((entry: any) => entry.role === 'first_frame'));
    return json({ id: `mock-task-${supplierVideoPosts}` });
  }
  if (url.startsWith('https://mock.seedance/contents/generations/tasks/mock-task-'))
    return json({ status: 'succeeded', video_url: 'https://mock.seedance/video.mp4' });
  if (url === 'https://mock.seedance/video.mp4') return new Response(video, { headers: { 'content-type': 'video/mp4' } });
  return originals.fetch(input as any, init);
}) as typeof fetch;

const shots = [
  { id: 'free-product', mode: 'free', scene: 'product', detail: '桌面上手持展示星河吊灯' },
  { id: 'clone-product', mode: 'clone', scene: 'product', detail: '复刻原片首帧中的星河吊灯特写' },
  { id: 'clone-multiple', mode: 'clone', scene: 'product', detail: '复刻原片首帧中的两款企业吊灯对比' },
  { id: 'free-factory', mode: 'free', scene: 'factory', detail: '工厂流水线设备近景' },
  { id: 'clone-composite', mode: 'clone', scene: 'factory', detail: '企业人物在本厂流水线手持星河吊灯特写' },
  { id: 'free-usage', mode: 'free', scene: 'usage', detail: '在家中安装星河吊灯' },
] as const;
let projectSpec: any = {
  mode: 'free', ratio: '9:16', activeAssemblyId: 'assembly-e2e', selectedProductIds: ['product-1', 'product-2'],
  shootingSlots: shots.map(item => ({ id: item.id, slotId: item.id, detail: item.detail, duration: 4 })),
  storyboardSourcePlans: Object.fromEntries(shots.map(item => [item.id, { mode: 'ai', sceneType: item.scene,
    productIds: item.scene === 'factory' ? [] : ['product-1'], videoResolution: '480p', videoResolutionPinned: true }])),
  storyboardAssignments: {},
};
let project = { id: projectId, tenant_id: tenantId, title: 'AIGC E2E', status: 'draft', spec: projectSpec };
const presenter = { id: 'authorized-presenter', name: '企业人物', authorized: true,
  referenceMaterialIds: [characterMaterialId], rightsEvidence: {
    authorizationRef: 'rights://e2e/presenter', consentRef: 'consent://e2e/presenter',
    grantedAt: '2026-09-25T00:00:00.000Z', subjectAdultConfirmed: true,
    permittedProviders: ['dashscope'], permittedUses: ['person_replacement', 'quality_inspection'],
    providerScopes: [{ provider: 'dashscope', uses: ['person_replacement', 'quality_inspection'] }],
  } };
const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => { bindDataAuthority('local'); return { userId: 'storyboard-e2e', tenantId, dataAuthority: 'local' }; };
store.getById = (async (collection, id) => collection === 'studio_projects' && id === projectId ? project
  : collection === 'trend_videos' && id === `trend-${suffix}`
    ? { id, tenantId, aiAnalysis: JSON.stringify({ gemini: { scriptDetails15s: [{ materialEvidence: { extractionStatus: 'ready', firstFrameObjectKey: sourceObjectKey } }] } }) }
    : null) as typeof store.getById;
store.list = (async collection => collection === 'tenant_profiles'
  ? { items: [{ id: 'profile', tenant_id: tenantId, profile: { products: { items: [
    { id: 'product-1', name: '星河吊灯', imageUrl: '/api/overseas/enterprise/assets/product.png',
      images: [{ url: '/api/overseas/enterprise/assets/product.png' }, { url: '/api/overseas/enterprise/assets/product-side.png' }] },
    { id: 'product-2', name: '海蓝吊灯', imageUrl: '/api/overseas/enterprise/assets/product-2.png' },
  ] } } }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 }
  : collection === 'studio_production_defaults'
    ? { items: [{ id: 'defaults', tenant_id: tenantId, payload: { presenters: [presenter] } }],
      page: 1, perPage: 1, totalItems: 1, totalPages: 1 }
    : { items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 }) as typeof store.list;
store.update = (async (collection, id, patch) => {
  assert.equal(collection, 'studio_projects'); assert.equal(id, projectId);
  project = { ...project, ...patch } as typeof project;
  projectSpec = project.spec;
  return true;
}) as typeof store.update;
const { studioRouter } = await import('./studio.js');
const app = express();
app.use(dataAuthorityRequestScope);
app.use(express.json());
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const post = async (url: string, body: unknown) => {
  const response = await originals.fetch(`http://127.0.0.1:${address.port}/studio${url}`, {
    method: 'POST', headers: { authorization: 'Bearer storyboard-e2e', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
};
try {
  for (const shot of shots) {
    projectId = `storyboard-project-${shot.id}-${suffix}`;
    projectSpec = { ...projectSpec, mode: shot.mode,
      selected: shot.scene === 'factory' ? [environmentMaterialId] : [],
      videoKickoff: shot.mode === 'clone' ? { referenceAnalysis: { details: [{ ...(shot.id === 'clone-multiple' ? { time: '0-4s' } : { shotId: shot.id }),
        firstFrameRef: `/api/overseas/videos/trend-${suffix}/shot/1/first-frame` }] } } : undefined,
      shootingSlots: [{ id: shot.id, slotId: shot.id, detail: shot.detail, duration: 4 }],
      storyboardSourcePlans: { [shot.id]: { mode: 'ai', sceneType: shot.scene,
        productIds: shot.id === 'free-factory' ? [] : shot.id === 'clone-multiple' ? ['product-1', 'product-2'] : ['product-1'], videoResolution: '480p', videoResolutionPinned: true,
        ...(shot.scene === 'factory' ? { environmentMaterialId } : {}),
        ...(['clone-multiple', 'clone-composite'].includes(shot.id) ? { characterMaterialId } : {}),
        ...(shot.scene === 'usage' ? { actionStartState: '吊灯尚未安装，人物手持吊灯', actionEndState: '吊灯固定在天花板上',
          actionBeats: '将吊灯对准天花板固定位置' } : {}) } },
      storyboardAssignments: {} };
    project = { id: projectId, tenant_id: tenantId, title: 'AIGC E2E', status: 'draft', spec: projectSpec };
    const productIds = shot.id === 'free-factory' ? [] : shot.id === 'clone-multiple' ? ['product-1', 'product-2'] : ['product-1'];
    const sourceFirstFrameUrl = shot.mode === 'clone'
      ? `/api/overseas/videos/trend-${suffix}/shot/1/first-frame` : undefined;
    const action = shot.scene === 'usage'
      ? { startState: '吊灯尚未安装，人物手持吊灯', beats: ['将吊灯对准天花板固定位置'], endState: '吊灯固定在天花板上', evidence: 'confirmed_storyboard' }
      : undefined;
    const frameRequest = {
      projectId, shotId: shot.id, requestId: `frame-${shot.id}-${suffix}`,
      mode: shot.mode === 'clone' ? 'replication' : 'free_creation', sceneType: shot.scene,
      shotDescription: shot.detail, startSeconds: 0, endSeconds: 4, ratio: '9:16',
      productIds, sourceFirstFrameUrl, action,
      ...(shot.scene === 'factory' ? { environmentMaterialId } : {}),
      ...(['clone-multiple', 'clone-composite'].includes(shot.id) ? { characterMaterialId } : {}),
    };
    if (shot.id === 'free-product') {
      const beforeUnseenView = supplierImagePosts;
      const unseenView = await post('/storyboard-first-frame', { ...frameRequest,
        shotDescription: '把产品旋转180度展示背面', productIds: ['product-2'] });
      assert.equal(unseenView.status, 422);
      assert.equal(unseenView.body.code, 'PRODUCT_ADDITIONAL_VIEW_REQUIRED');
      assert.equal(supplierImagePosts, beforeUnseenView, 'one KB view cannot pay to invent an unseen product back');
      const unseenLayout = await post('/storyboard-first-frame', { ...frameRequest,
        productIds: ['product-2'], layout: { productView: '背面' } });
      assert.equal(unseenLayout.status, 422);
      assert.equal(unseenLayout.body.code, 'PRODUCT_ADDITIONAL_VIEW_REQUIRED');
      assert.equal(supplierImagePosts, beforeUnseenView, 'layout viewpoint is checked before the paid image call');
    }
    if (shot.id === 'free-factory') {
      const beforeSpecific = supplierImagePosts;
      const missingFactoryProduct = await post('/storyboard-first-frame', { ...frameRequest,
        shotDescription: '产品在传送带上移动的特写', productIds: [] });
      assert.equal(missingFactoryProduct.status, 422);
      assert.equal(missingFactoryProduct.body.code, 'FACTORY_PRODUCT_REQUIRED');
      assert.equal(supplierImagePosts, beforeSpecific);
      const missingSpecificReference = await post('/storyboard-first-frame', { ...frameRequest,
        shotDescription: '展示本厂流水线设备近景', environmentMaterialId: '' });
      assert.equal(missingSpecificReference.status, 422);
      assert.equal(missingSpecificReference.body.code, 'FACTORY_REFERENCE_REQUIRED');
      assert.equal(supplierImagePosts, beforeSpecific, 'specific factory shot cannot submit without an enterprise environment image');
      const specificInLayout = await post('/storyboard-first-frame', { ...frameRequest,
        layout: { environment: '本厂指定产线' }, environmentMaterialId: '' });
      assert.equal(specificInLayout.status, 422);
      assert.equal(specificInLayout.body.code, 'FACTORY_REFERENCE_REQUIRED');
      assert.equal(supplierImagePosts, beforeSpecific);
      saveLocalMaterials(readLocalMaterials().map(item => item.id === environmentMaterialId
        ? { ...item, objectKey: sourceObjectKey } : item));
      const unsafeEnvironment = await post('/storyboard-first-frame', frameRequest);
      assert.equal(unsafeEnvironment.status, 422);
      assert.equal(unsafeEnvironment.body.code, 'ENVIRONMENT_MATERIAL_NOT_SELECTED');
      assert.equal(supplierImagePosts, beforeSpecific);
      saveLocalMaterials(readLocalMaterials().map(item => item.id === environmentMaterialId
        ? { ...item, objectKey: environmentObjectKey } : item));
    }
    if (shot.id === 'clone-multiple') {
      const beforeMismatch = supplierImagePosts;
      const rawUrl = await post('/storyboard-first-frame', { ...frameRequest,
        characterMaterialId: '', characterImageUrl: '/api/overseas/enterprise/assets/person.png' });
      assert.equal(rawUrl.status, 422);
      assert.equal(rawUrl.body.code, 'CHARACTER_MATERIAL_REQUIRED');
      assert.equal(supplierImagePosts, beforeMismatch);
      const mismatch = await post('/storyboard-first-frame', { ...frameRequest, characterMaterialId: 'missing-person' });
      assert.equal(mismatch.status, 422);
      assert.equal(mismatch.body.code, 'CHARACTER_MATERIAL_UNAVAILABLE');
      assert.equal(supplierImagePosts, beforeMismatch);
      const foreign = await post('/storyboard-first-frame', { ...frameRequest, characterMaterialId: foreignCharacterMaterialId });
      assert.equal(foreign.status, 422);
      assert.equal(foreign.body.code, 'CHARACTER_MATERIAL_UNAVAILABLE');
      assert.equal(supplierImagePosts, beforeMismatch);
      saveLocalMaterials(readLocalMaterials().map(item => item.id === characterMaterialId
        ? { ...item, objectKey: sourceObjectKey } : item));
      const unsafeStorage = await post('/storyboard-first-frame', frameRequest);
      assert.equal(unsafeStorage.status, 422);
      assert.equal(unsafeStorage.body.code, 'CHARACTER_MATERIAL_NOT_AUTHORIZED');
      assert.equal(supplierImagePosts, beforeMismatch);
      saveLocalMaterials(readLocalMaterials().map(item => item.id === characterMaterialId
        ? { ...item, objectKey: characterObjectKey } : item));
      presenter.rightsEvidence.providerScopes[0].uses = ['quality_inspection'];
      const unauthorized = await post('/storyboard-first-frame', frameRequest);
      assert.equal(unauthorized.status, 422);
      assert.equal(unauthorized.body.code, 'CHARACTER_MATERIAL_NOT_AUTHORIZED');
      assert.equal(supplierImagePosts, beforeMismatch);
      presenter.rightsEvidence.providerScopes[0].uses = ['person_replacement', 'quality_inspection'];
      const unbound = await post('/storyboard-first-frame', { ...frameRequest, characterMaterialId: '' });
      assert.equal(unbound.status, 409);
      assert.equal(unbound.body.code, 'STORYBOARD_PROJECT_INPUT_MISMATCH');
      assert.equal(supplierImagePosts, beforeMismatch);
    }
    const first = await post('/storyboard-first-frame', frameRequest);
    assert.equal(first.status, 200, `${shot.id} first frame: ${JSON.stringify(first.body)}`);
    assert.equal(first.body.firstFrameQuality.status, 'needs_review');
    if (shot.id === 'free-factory') assert.equal(first.body.firstFrameQuality.checks.environment_fidelity.verdict, 'pass');
    if (productIds.length) assert.ok(first.body.identityNotice, `${shot.id} must explain how the first frame handled product identity`);
    if (shot.id === 'free-product') {
      projectSpec.shootingSlots[0].requirements = '新版镜头约束';
      const staleReplay = await post('/storyboard-first-frame', frameRequest);
      assert.equal(staleReplay.status, 409);
      assert.equal(staleReplay.body.code, 'STORYBOARD_PROJECT_INPUT_CHANGED');
      delete projectSpec.shootingSlots[0].requirements;
    }
    projectSpec.shootingSlots[0].detail = `${shot.detail}，已修改`;
    const staleConfirmation = await post(`/storyboard-first-frame/${first.body.material.id}/confirm`,
      { shotId: shot.id, fingerprint: first.body.fingerprint });
    assert.equal(staleConfirmation.status, 409, 'edited storyboard must invalidate generated first frame');
    projectSpec.shootingSlots[0].detail = shot.detail;
    if (shot.id === 'free-factory') {
      projectSpec.selected = [];
      const unselected = await post(`/storyboard-first-frame/${first.body.material.id}/confirm`,
        { shotId: shot.id, fingerprint: first.body.fingerprint });
      assert.equal(unselected.status, 409, 'unselected factory reference invalidates first frame');
      projectSpec.selected = [environmentMaterialId];
      await objectStorageUpload({ key: environmentObjectKey,
        body: await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#127f49' } }).png().toBuffer(),
        contentType: 'image/png' });
      const changedFrameReference = await post(`/storyboard-first-frame/${first.body.material.id}/confirm`,
        { shotId: shot.id, fingerprint: first.body.fingerprint });
      assert.equal(changedFrameReference.status, 409);
      assert.equal(changedFrameReference.body.code, 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED');
      await objectStorageUpload({ key: environmentObjectKey, body: image, contentType: 'image/png' });
    }
    if (shot.id === 'clone-multiple') {
      presenter.authorized = false;
      const revoked = await post(`/storyboard-first-frame/${first.body.material.id}/confirm`,
        { shotId: shot.id, fingerprint: first.body.fingerprint });
      assert.equal(revoked.status, 409);
      assert.equal(revoked.body.code, 'STORYBOARD_PERSON_IMAGE_CHANGED');
      presenter.authorized = true;
      const changedPersonReference = await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#127f49' } }).png().toBuffer();
      await objectStorageUpload({ key: characterObjectKey, body: changedPersonReference, contentType: 'image/png' });
      const changed = await post(`/storyboard-first-frame/${first.body.material.id}/confirm`,
        { shotId: shot.id, fingerprint: first.body.fingerprint });
      assert.equal(changed.status, 409);
      assert.equal(changed.body.code, 'STORYBOARD_PERSON_IMAGE_CHANGED');
      await objectStorageUpload({ key: characterObjectKey, body: image, contentType: 'image/png' });
    }
    const confirmed = await post(`/storyboard-first-frame/${first.body.material.id}/confirm`,
      { shotId: shot.id, fingerprint: first.body.fingerprint });
    assert.equal(confirmed.status, 200, `${shot.id} confirm: ${JSON.stringify(confirmed.body)}`);
    const videoRequest = { firstFrameMaterialId: first.body.material.id, firstFrameFingerprint: first.body.fingerprint,
      shotId: shot.id, requestId: `video-${shot.id}-${suffix}`, ratio: '9:16', duration: 4, resolution: '480p',
      generationContext: { projectId }, script: shot.detail, language: 'zh' };
    if (shot.id === 'free-product') {
      const productFile = path.join(assetDir, 'product.png');
      fs.writeFileSync(productFile, await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#345678' } }).png().toBuffer());
      const beforeChangedKb = supplierVideoPosts;
      const changedKb = await post('/seedance-video', videoRequest);
      assert.equal(changedKb.status, 409);
      assert.equal(changedKb.body.code, 'STORYBOARD_PRODUCT_IMAGE_CHANGED');
      assert.equal(supplierVideoPosts, beforeChangedKb, 'changed KB product image must block paid video submission');
      fs.writeFileSync(productFile, image);
      const sideFile = path.join(assetDir, 'product-side.png');
      fs.writeFileSync(sideFile, await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#345678' } }).png().toBuffer());
      const beforeChangedView = supplierVideoPosts;
      const changedView = await post('/seedance-video', videoRequest);
      assert.equal(changedView.status, 409);
      assert.equal(changedView.body.code, 'STORYBOARD_PRODUCT_IMAGE_CHANGED');
      assert.equal(supplierVideoPosts, beforeChangedView, 'changed secondary KB view must block paid video submission');
      fs.writeFileSync(sideFile, sideImage);
    }
    if (shot.id === 'clone-multiple') {
      (presenter.rightsEvidence as typeof presenter.rightsEvidence & { revokedAt?: string }).revokedAt = '2026-10-01T00:00:00.000Z';
      const beforeRevoked = supplierVideoPosts;
      const revoked = await post('/seedance-video', videoRequest);
      assert.equal(revoked.status, 409);
      assert.equal(revoked.body.code, 'STORYBOARD_PERSON_IMAGE_CHANGED');
      assert.equal(supplierVideoPosts, beforeRevoked, 'revoked presenter rights must block paid video');
      delete (presenter.rightsEvidence as typeof presenter.rightsEvidence & { revokedAt?: string }).revokedAt;
      await objectStorageUpload({ key: characterObjectKey,
        body: await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#765432' } }).png().toBuffer(),
        contentType: 'image/png' });
      const beforeChangedPerson = supplierVideoPosts;
      const changedPerson = await post('/seedance-video', videoRequest);
      assert.equal(changedPerson.status, 409);
      assert.equal(changedPerson.body.code, 'STORYBOARD_PERSON_IMAGE_CHANGED');
      assert.equal(supplierVideoPosts, beforeChangedPerson, 'changed presenter material must block paid video');
      await objectStorageUpload({ key: characterObjectKey, body: image, contentType: 'image/png' });
    }
    if (shot.id === 'free-factory') {
      const changedEnvironment = await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#127f49' } }).png().toBuffer();
      await objectStorageUpload({ key: environmentObjectKey, body: changedEnvironment, contentType: 'image/png' });
      const beforeChangedEnvironment = supplierVideoPosts;
      const changed = await post('/seedance-video', videoRequest);
      assert.equal(changed.status, 409);
      assert.equal(changed.body.code, 'STORYBOARD_ENVIRONMENT_IMAGE_CHANGED');
      assert.equal(supplierVideoPosts, beforeChangedEnvironment, 'changed factory reference must block paid video submission');
      await objectStorageUpload({ key: environmentObjectKey, body: image, contentType: 'image/png' });
    }
    const result = await post('/seedance-video', videoRequest);
    assert.equal(result.status, 200, `${shot.id} video: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.ok, true);
    assert.ok(result.body.material?.id, `${shot.id} must persist locally before review`);
    const beforeReplay = supplierVideoPosts;
    const replay = await post('/seedance-video', videoRequest);
    assert.equal(replay.body.reused, true, `${shot.id} same request should recover the original material: ${JSON.stringify(replay.body)}`);
    assert.equal(supplierVideoPosts, beforeReplay, 'same request must not resubmit paid provider work');
    if (shot.id === 'free-product') {
      process.env.STORYBOARD_AIGC_MAX_RETRIES = '0';
      const overRetry = await post('/seedance-video', { ...videoRequest, requestId: `new-video-${suffix}` });
      assert.equal(overRetry.status, 429, 'configured retry cap must block a second paid submission');
      assert.equal(overRetry.body.code, 'STORYBOARD_PROJECT_BUDGET_EXCEEDED');
      assert.equal(supplierVideoPosts, beforeReplay);
      process.env.STORYBOARD_AIGC_MAX_RETRIES = '1';
    }
    const unreviewedSpec = { ...projectSpec, storyboardAssignments: { ...projectSpec.storyboardAssignments, [shot.id]: result.body.material.id } };
    const premature = await post('/projects', { id: projectId, status: 'draft', spec: unreviewedSpec });
    assert.equal(premature.body.code, 'STORYBOARD_AIGC_ASSIGNMENT_UNVERIFIED', 'unreviewed candidate must not be adopted');
    const checked = await post('/storyboard-quality-check', { materialId: result.body.material.id, storyboard: shot.detail });
    assert.equal(checked.status, 200, `${shot.id} QA: ${JSON.stringify(checked.body)}`);
    assert.equal(checked.body.quality.status, 'needs_review');
    if (shot.id === 'free-factory') assert.equal(checked.body.quality.checks.environment_fidelity.verdict, 'pass');
    const reviewed = await post(`/storyboard-quality-check/${result.body.material.id}/review`, {
      shotId: shot.id, reportId: checked.body.quality.reportId, decision: 'accept',
    });
    assert.equal(reviewed.status, 200, `${shot.id} review: ${JSON.stringify(reviewed.body)}`);
    assert.equal(reviewed.body.quality.passed, true);
    if (shot.id === 'free-product') {
      const sideFile = path.join(assetDir, 'product-side.png');
      fs.writeFileSync(sideFile, await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#345678' } }).png().toBuffer());
      const changedViewAdoption = await post('/projects', { id: projectId, status: 'draft', spec: unreviewedSpec });
      assert.equal(changedViewAdoption.status, 409, 'changed secondary product view blocks assignment');
      assert.equal(changedViewAdoption.body.code, 'STORYBOARD_AIGC_KB_IMAGE_CHANGED');
      fs.writeFileSync(sideFile, sideImage);
    }
    if (shot.id === 'free-factory') {
      const withoutEnvironment = { ...unreviewedSpec, selected: [] };
      const unselectedAdoption = await post('/projects', { id: projectId, status: 'draft', spec: withoutEnvironment });
      assert.equal(unselectedAdoption.status, 409, 'unselected factory reference blocks adoption');
      assert.equal(unselectedAdoption.body.code, 'STORYBOARD_AIGC_KB_IMAGE_CHANGED');
    }
    if (shot.id === 'clone-multiple') {
      (presenter.rightsEvidence as typeof presenter.rightsEvidence & { revokedAt?: string }).revokedAt = '2026-10-01T00:00:00.000Z';
      const revoked = await post('/projects', { id: projectId, status: 'draft', spec: unreviewedSpec });
      assert.equal(revoked.status, 409);
      assert.equal(revoked.body.code, 'STORYBOARD_AIGC_KB_IMAGE_CHANGED');
      delete (presenter.rightsEvidence as typeof presenter.rightsEvidence & { revokedAt?: string }).revokedAt;
      await objectStorageUpload({ key: characterObjectKey,
        body: await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#765432' } }).png().toBuffer(),
        contentType: 'image/png' });
      const changedPersonAdoption = await post('/projects', { id: projectId, status: 'draft', spec: unreviewedSpec });
      assert.equal(changedPersonAdoption.status, 409);
      assert.equal(changedPersonAdoption.body.code, 'STORYBOARD_AIGC_KB_IMAGE_CHANGED');
      await objectStorageUpload({ key: characterObjectKey, body: image, contentType: 'image/png' });
    }
    const adopted = await post('/projects', { id: projectId, status: 'draft', spec: unreviewedSpec });
    assert.equal(adopted.status, 200, `${shot.id} adopt: ${JSON.stringify(adopted.body)}`);
  }
  assert.equal(supplierImagePosts, shots.length);
  assert.equal(supplierVideoPosts, shots.length);
  console.log('storyboard AIGC mocked e2e passed: six shot cases, QA, review, adoption, idempotent video retry');
} finally {
  server.close();
  globalThis.fetch = originals.fetch;
  saveLocalMaterials(readLocalMaterials().filter(item => item.tenantId !== tenantId && item.id !== foreignCharacterMaterialId));
  fs.rmSync(tenantAssetDir(path.resolve('data/media'), tenantId), { recursive: true, force: true });
  fs.rmSync(assetDir, { recursive: true, force: true });
  fs.rmSync(assetRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originals.env)) value === undefined ? delete process.env[key] : process.env[key] = value;
}
