import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { LangGraphTestStore } from './langgraphTestStore.js';
import { createStarter198Repository, STARTER_COLLECTIONS } from '../server/starter198/repository.js';
import { STARTER_198_CAPABILITIES } from '../shared/contracts/starter198.js';
import { STARTER_198_DEFAULT_LIMITS } from '../server/starter198/provisioning.js';
import { createSocialContentTask } from '../server/starter198/socialContentTasks.js';
import { parseCreateSocialTask } from '../server/starter198/socialContentValidation.js';
import { readSocialTaskDetail, buildSocialWorkflowMaterialCandidates } from '../server/starter198/socialContentRecords.js';
import { createGeneratedAssetArchiveService } from '../server/lib/generatedAssetArchive.js';
import { archiveSocialGeneratedShots } from '../server/starter198/socialContentProductionExecution.js';
import { socialProductionGraphInput, readSocialProductionGraphDetail } from '../server/starter198/socialContentProductionGraph.js';

test('newly archived generated shot cannot rewrite its own frozen plan', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'graph-generated-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LangGraphTestStore(path.join(root, 'business.json'));
  let materials: any[] = [];
  const repository = createStarter198Repository(store, { materialLibrary: async () => ({ items: materials, folders: [] }) as any });
  const tenantId = 'generated-inventory-tenant', userId = 'reviewer', now = new Date();
  await store.create(STARTER_COLLECTIONS.access, { tenant_id: tenantId, product_profile: 'starter_198', profile_version: 'starter_198.v1', entitlement_snapshot_id: 'local', feature_entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })), resource_limits: STARTER_198_DEFAULT_LIMITS, status: 'active', cycle_started_at: new Date(now.getTime() - 86_400_000).toISOString(), cycle_ends_at: new Date(now.getTime() + 86_400_000).toISOString(), updated_at: now.toISOString() });
  const initial = await createSocialContentTask({ repository, tenantId, userId, idempotencyKey: 'generated-inventory-create', value: parseCreateSocialTask({ title: '生成素材归档检查', objective: '冻结计划恢复', mode: 'instant', themeId: 'customization_process' }) });
  const frozen = await readSocialTaskDetail({ repository, tenantId, taskId: initial.taskId }); assert.ok(frozen);
  const image = path.join(root, 'generated.png'); await sharp({ create: { width: 32, height: 32, channels: 3, background: '#336699' } }).png().toFile(image);
  const objects = new Map<string, Buffer>();
  const archive = createGeneratedAssetArchiveService({ readMaterials: () => materials, saveMaterials: value => { materials = value; },
    uploadObject: async input => { objects.set(input.key, Buffer.from(input.body as Buffer)); return {} as any; },
    headObject: async key => objects.has(key) ? { size: objects.get(key)!.length, etag: 'local' } as any : null });
  const execution: any = { schemaVersion: 'social-content.asset-supply-execution.v1', planVersion: frozen.version, creationMode: 'product', productionRoute: 'asset_generation', managementMode: 'system', executedAt: now.toISOString(), shots: [{ shotId: 'scene-generated', sceneId: 'scene-generated', function: 'value', requestedSourceStrategy: 'non_evidentiary_ai_visual', sourceStrategy: 'non_evidentiary_ai_visual', fallbackApplied: false, providerId: 'controlled-fixture', assetId: 'generated-image', sourceRef: null, truthBoundary: {}, functionalEquivalentReplacement: null, provenance: { synthetic: true, representation: 'non_evidentiary_visual', authorizationRef: null, disclosure: null }, attempts: [] }] };
  await archiveSocialGeneratedShots({ tenantId, taskId: frozen.taskId, execution, assets: [{ id: 'generated-image', name: '概念图', type: 'image', sourceId: 'controlled:1', url: image, localPath: image, duration: 2.8, visualObservations: [], segments: [] }] as any, archiveMedia: archive.archiveNewMedia });
  assert.equal(materials.length, 1); assert.equal(materials[0].generationState, 'archived'); assert.equal(objects.size, 1);
  assert.equal(buildSocialWorkflowMaterialCandidates({ records: materials, tenantId, voiceoverRows: [] }).candidates.length, 1, 'atomic generated image becomes a projected inventory candidate');
  const current = await readSocialTaskDetail({ repository, tenantId, taskId: frozen.taskId }); assert.ok(current);
  assert.throws(() => socialProductionGraphInput(current, frozen), /plan_changed/, 'unfiltered runtime inventory really changes the projection');
  const validated = await readSocialProductionGraphDetail({ repository, tenantId, taskId: frozen.taskId }, frozen); assert.ok(validated);
  assert.equal(socialProductionGraphInput(validated, frozen).inputHash, socialProductionGraphInput(frozen).inputHash);
  const originalSource = await readSocialProductionGraphDetail({ repository, tenantId, taskId: frozen.taskId }, current); assert.ok(originalSource);
  assert.equal(socialProductionGraphInput(originalSource, current).inputHash, socialProductionGraphInput(current).inputHash, 'previously admitted generated sources remain visible');
});
