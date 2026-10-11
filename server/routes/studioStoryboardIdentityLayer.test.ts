import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { tenantAssetDir } from '../lib/assetAccess.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { readLocalMaterials, saveLocalMaterials } from '../lib/materialLibrary.js';
import { objectStorageDownload, objectStorageUpload } from '../storage/objectStorage.js';

const suffix = randomUUID();
const tenantId = `local_tenant_identity_${suffix}`;
const projectId = `identity-project-${suffix}`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-route-'));
const oldFetch = globalThis.fetch;
const oldEnv = Object.fromEntries(['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL', 'DASHSCOPE_IMAGE_BASE_URL',
  'SEEDREAM_API_KEY', 'SEEDREAM_BASE_URL',
  'OBJECT_STORAGE_DRIVER', 'LOCAL_OBJECT_STORAGE_ROOT', 'STORYBOARD_AIGC_BATCH_BUDGET_CNY',
  'STORYBOARD_AIGC_BUDGET_DIR', 'STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED',
  'STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY', 'DEMO_MODE', 'SUBSCRIPTION_ENFORCED'].map(key => [key, process.env[key]]));
Object.assign(process.env, {
  DASHSCOPE_API_KEY: 'test-only', DASHSCOPE_BASE_URL: 'https://mock.identity/compatible-mode/v1',
  DASHSCOPE_IMAGE_BASE_URL: 'https://mock.identity/compatible-mode/v1', OBJECT_STORAGE_DRIVER: 'local',
  SEEDREAM_API_KEY: 'test-only', SEEDREAM_BASE_URL: 'https://mock.identity/compatible-mode/v1',
  LOCAL_OBJECT_STORAGE_ROOT: path.join(temp, 'objects'), STORYBOARD_AIGC_BATCH_BUDGET_CNY: '200',
  STORYBOARD_AIGC_BUDGET_DIR: path.join(temp, 'budget'), STORYBOARD_CLONE_GEOMETRY_QWEN_ENABLED: 'true',
  STORYBOARD_AIGC_CLONE_GEOMETRY_ESTIMATED_CNY: '0.1', DEMO_MODE: 'false', SUBSCRIPTION_ENFORCED: 'false',
});
const product = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#00000000' } })
  .composite([{ input: Buffer.from('<svg width="20" height="20"><rect x="2" y="2" width="16" height="16" fill="#e60012"/></svg>') }]).png().toBuffer();
const plate = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#cccccc' } }).png().toBuffer();
const sourceFrameUrl = `/api/overseas/videos/trend-${suffix}/shot/1/first-frame`;
const sourceObjectKey = `identity-test/${tenantId}/source.png`;
await objectStorageUpload({ key: sourceObjectKey, body: plate, contentType: 'image/png' });
const assetDir = path.join(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId));
fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(path.join(assetDir, 'product.png'), product);
let imagePosts = 0;
let geometryPosts = 0;
const imageRequests: Array<{ prompt: string; image?: string[] }> = [];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://mock.identity/compatible-mode/v1/images/generations') {
    imagePosts++;
    imageRequests.push(JSON.parse(String(init?.body || '{}')));
    return json({ data: [{ url: 'https://mock.identity/plate.png' }] });
  }
  if (url === 'https://mock.identity/plate.png') return new Response(plate, { headers: { 'content-type': 'image/png' } });
  if (url === 'https://mock.identity/compatible-mode/v1/chat/completions') {
    const payload = JSON.parse(String(init?.body || '{}'));
    const text = String(payload.messages?.[0]?.content?.[0]?.text || '');
    if (text.includes('Measure only the supplied current storyboard shot first frame')) {
      geometryPosts++;
      const version = createHash('sha256').update(plate.toString('base64')).digest('hex');
      return json({ choices: [{ message: { content: JSON.stringify({ shotId: 'clone', sourceFrameAssetId: sourceFrameUrl,
        sourceFrameVersion: version, scene: 'tabletop', productBox: { x: .4, y: .3, width: .2, height: .2 },
        contactSurfaceY: .5, productView: 'source', foregroundOcclusion: 'none', confidence: .96,
        evidence: '当前分镜首帧可见产品底边接触桌面' }) } }] });
    }
    const keys = ['product_identity', 'layout', 'contact', 'start_state', 'visual_integrity'];
    return json({ choices: [{ message: { content: JSON.stringify({ observations: keys.map(key => ({ key, verdict: 'pass', evidenceFrames: ['候选首帧'] })) }) } }] });
  }
  return oldFetch(input as any, init);
}) as typeof fetch;

const placementOverride = { contactScene: 'tabletop', productBox: { x: .4, y: .3, width: .2, height: .2 }, contactSurfaceY: .5 };
const project = { id: projectId, tenant_id: tenantId, title: 'Identity route', status: 'draft', spec: {
  mode: 'free', ratio: '9:16', activeAssemblyId: 'assembly', selectedProductIds: ['product-1'],
  shootingSlots: [{ id: 'persisted-exact', slotId: 'exact', detail: '产品摆在桌面', duration: 4 }, { id: 'auto', detail: '产品摆在桌面', duration: 4 },
    { id: 'conveyor', detail: '产品在传送带上', duration: 4 }, { id: 'fallback', detail: '产品特写', duration: 4 }],
  storyboardSourcePlans: {
    exact: { mode: 'ai', sceneType: 'product', productIds: ['product-1'], placementOverride },
    auto: { mode: 'ai', sceneType: 'product', productIds: ['product-1'] },
    conveyor: { mode: 'ai', sceneType: 'product', productIds: ['product-1'] },
    fallback: { mode: 'ai', sceneType: 'product', productIds: ['product-1'] },
  }, storyboardAssignments: {},
} };
const cloneProjectId = `clone-identity-project-${suffix}`;
const cloneProject = { id: cloneProjectId, tenant_id: tenantId, title: 'Clone identity route', status: 'draft', spec: {
  mode: 'clone', ratio: '9:16', activeAssemblyId: 'assembly-clone', selectedProductIds: ['product-1'],
  shootingSlots: [{ id: 'clone', slotId: 'clone', detail: '产品摆在桌面', duration: 4 }],
  storyboardSourcePlans: { clone: { mode: 'ai', sceneType: 'product', productIds: ['product-1'] } },
  storyboardAssignments: {}, videoKickoff: { referenceAnalysis: { details: [{ shotId: 'clone', firstFrameRef: sourceFrameUrl }] } },
} };
const { auth, store } = await import('../storage/index.js');
const { bindDataAuthority, dataAuthorityRequestScope } = await import('../storage/dataAuthority.js');
auth.verifyToken = async () => { bindDataAuthority('local'); return { userId: 'identity-test', tenantId, dataAuthority: 'local' }; };
store.getById = (async (collection, id) => collection === 'studio_projects' && id === projectId ? project
  : collection === 'studio_projects' && id === cloneProjectId ? cloneProject
    : collection === 'trend_videos' && id === `trend-${suffix}`
      ? { id, tenantId, aiAnalysis: JSON.stringify({ gemini: { scriptDetails15s: [{ materialEvidence: {
        extractionStatus: 'ready', firstFrameObjectKey: sourceObjectKey } }] } }) } : null) as typeof store.getById;
store.list = (async collection => collection === 'tenant_profiles'
  ? { items: [{ id: 'profile', tenant_id: tenantId, profile: { products: { items: [{ id: 'product-1', name: '红色产品', imageUrl: '/api/overseas/enterprise/assets/product.png' }] } } }], page: 1, perPage: 20, totalItems: 1, totalPages: 1 }
  : { items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 }) as typeof store.list;
const { studioRouter } = await import('./studio.js');
const app = express(); app.use(dataAuthorityRequestScope); app.use(express.json()); app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const request = async (shotId: string, layout?: Record<string, unknown>, clone = false) => {
  const response = await oldFetch(`http://127.0.0.1:${address.port}/studio/storyboard-first-frame`, {
    method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: clone ? cloneProjectId : projectId, shotId, requestId: `${shotId}-${suffix}`, shotDescription: shotId === 'fallback' ? '产品特写'
      : shotId === 'conveyor' ? '产品在传送带上' : '产品摆在桌面',
      mode: clone ? 'replication' : 'free_creation', sceneType: 'product', productId: 'product-1', ratio: '9:16',
      startSeconds: 0, endSeconds: 4, layout, ...(clone ? { sourceFirstFrameUrl: sourceFrameUrl } : {}) }),
  });
  return { status: response.status, body: await response.json() as any };
};
try {
  const exact = await request('exact', { ...placementOverride, productView: 'source' });
  assert.equal(exact.status, 200, JSON.stringify(exact.body));
  const exactSaved = readLocalMaterials().find(item => item.id === exact.body.material.id);
  assert.equal(exactSaved?.provenance?.identityLayer?.strategy, 'exact_source_pixels');
  assert.equal(exactSaved?.provenance?.geometryPlan?.source, 'confirmed_layout');
  assert.equal(imagePosts, 1);
  assert.match(imageRequests[0]!.prompt, /EMPTY environment plate/);
  assert.equal(imageRequests[0]!.image, undefined, 'clean plate must not receive product reference pixels');
  assert.ok(exactSaved?.objectKey);
  const stored = await objectStorageDownload(exactSaved.objectKey);
  assert.ok(stored?.buf);
  const { data, info } = await sharp(stored.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (40 * info.width + 50) * 4;
  assert.deepEqual([...data.subarray(offset, offset + 3)], [230, 0, 18], 'product center retains source pixels');
  const auto = await request('auto');
  assert.equal(auto.status, 200, JSON.stringify(auto.body));
  const autoSaved = readLocalMaterials().find(item => item.id === auto.body.material.id);
  assert.equal(autoSaved?.provenance?.identityLayer?.strategy, 'exact_source_pixels');
  assert.equal(autoSaved?.provenance?.geometryPlan?.source, 'authored_template');
  const conveyor = await request('conveyor');
  assert.equal(conveyor.status, 200, JSON.stringify(conveyor.body));
  const conveyorSaved = readLocalMaterials().find(item => item.id === conveyor.body.material.id);
  assert.equal(conveyorSaved?.provenance?.identityLayer?.strategy, 'exact_source_pixels');
  assert.equal(conveyorSaved?.provenance?.geometryPlan?.layout?.contactScene, 'conveyor');
  const fallback = await request('fallback');
  assert.equal(fallback.status, 200, JSON.stringify(fallback.body));
  const fallbackSaved = readLocalMaterials().find(item => item.id === fallback.body.material.id);
  assert.equal(fallbackSaved?.provenance?.identityLayer?.strategy, 'generative');
  assert.equal(fallbackSaved?.provenance?.identityLayer?.fallbackReason, 'contact_scene_or_cutout_unavailable');
  assert.equal(imagePosts, 4);
  assert.ok(Array.isArray(imageRequests[3]!.image) && imageRequests[3]!.image!.length === 1,
    'normal generation still receives the KB product reference');
  const clone = await request('clone', undefined, true);
  assert.equal(clone.status, 200, JSON.stringify(clone.body));
  const cloneSaved = readLocalMaterials().find(item => item.id === clone.body.material.id);
  assert.equal(cloneSaved?.provenance?.identityLayer?.strategy, 'seedream_reference_composite');
  assert.equal(cloneSaved?.provenance?.geometryPlan?.source, 'observed_source_frame');
  assert.equal(cloneSaved?.provenance?.estimatedCostCny, .7,
    'product replication charges geometry observation plus cleanup and enterprise-product composite frames');
  assert.equal(geometryPosts, 1, 'only current-shot source frame is observed once');
  assert.equal(imagePosts, 6, 'product replication removes the source product and rebuilds with enterprise references');
  assert.equal(cloneSaved?.provenance?.identityLayer?.directToSeedance, undefined);
  const replay = await request('clone', undefined, true);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.reused, true);
  assert.equal(geometryPosts, 1, 'idempotent replay must not re-observe the paid source frame');
  assert.equal(imagePosts, 6, 'idempotent replay must not regenerate the first frame');
  console.log('storyboard identity route mocked exact/fallback passed');
} finally {
  server.close(); globalThis.fetch = oldFetch;
  saveLocalMaterials(readLocalMaterials().filter(item => item.tenantId !== tenantId));
  fs.rmSync(tenantAssetDir(path.resolve('data/media'), tenantId), { recursive: true, force: true });
  fs.rmSync(assetDir, { recursive: true, force: true });
  fs.rmSync(temp, { recursive: true, force: true });
  for (const [key, value] of Object.entries(oldEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
}
