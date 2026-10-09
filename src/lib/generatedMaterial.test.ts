import assert from 'node:assert/strict';
import test from 'node:test';
import { filterMyGeneratedMaterials, isMyGeneratedMaterial, projectGeneratedAssetState, projectGeneratedMaterial } from './generatedMaterial.js';

test('projects legacy provider records into generated-material metadata without mutating source', () => {
  const legacy = { id: 'legacy-1', tenantId: 'tenant-a', scope: 'own', folder: 'upload', sourceType: 'ai-seedance',
    contentSha256: 'a'.repeat(64), provenance: { productSceneSpec: { schemaVersion: 'product-scene.v1' }, projectId: 'project-1' } };
  const before = JSON.stringify(legacy);
  const projected = projectGeneratedMaterial(legacy);
  assert.equal(projected?.generation.pipelineId, 'non_person_generation');
  assert.equal(projected?.generation.assetGenerationKind, 'product_scene');
  assert.equal(projected?.lineage.sourceProjectId, 'project-1');
  assert.equal(projected?.quality.state, 'repair_required');
  assert.equal(projected?.reuse.eligible, false);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(isMyGeneratedMaterial(legacy, 'tenant-a'), true);
});

test('keeps content creation mode separate and filters by assetGenerationKind', () => {
  const base = { tenantId: 'tenant-a', scope: 'own', generationMode: 'clone', sourceType: 'viral-sentence-replication' };
  const records = [base, { ...base, id: 'concept', sourceType: 'gemini-generated' }];
  const digital = filterMyGeneratedMaterials(records, { tenantId: 'tenant-a', assetGenerationKind: 'digital_human' });
  assert.equal(digital.length, 1);
  assert.equal(projectGeneratedMaterial(digital[0]!)?.generation.assetGenerationKind, 'digital_human');
  assert.equal(digital[0]?.generationMode, 'clone');
});

test('projects legacy execution states while incomplete quality remains repair_required', () => {
  assert.equal(projectGeneratedAssetState({ id: 'one', scope: 'own', sourceType: 'heygen', status: 'pending' }), 'provider_pending');
  assert.equal(projectGeneratedAssetState({ id: 'two', scope: 'own', sourceType: 'heygen', status: 'completed' }), 'repair_required');
  assert.equal(projectGeneratedAssetState({ id: 'three', scope: 'own', sourceType: 'local-upload', status: 'ready' }), 'draft');
});
