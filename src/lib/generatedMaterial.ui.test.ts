import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedMaterialKindLabel, matchesGeneratedMaterialKind, projectGeneratedMaterial } from './generatedMaterial.js';

test('filters canonical generated metadata without using physical folders', () => {
  const asset = {
    id: 'asset-1', scope: 'own', folder: 'upload',
    generation: { pipelineId: 'non_person_generation', assetGenerationKind: 'product_scene' },
    quality: { state: 'accepted', checks: [{ status: 'passed' }] },
    reuse: { eligible: true },
  };
  assert.equal(matchesGeneratedMaterialKind(asset, 'product_scene'), true);
  assert.equal(generatedMaterialKindLabel(asset), '产品场景');
});

test('projects historical generated source types but never infers from folder', () => {
  assert.equal(projectGeneratedMaterial({ id: 'a', scope: 'own', sourceType: 'heygen', folder: 'upload' })?.generation.assetGenerationKind, 'digital_human');
  assert.equal(projectGeneratedMaterial({ id: 'b', scope: 'own', sourceType: 'tenant_upload', folder: 'presenter' }), null);
  assert.equal(projectGeneratedMaterial({ id: 'c', scope: 'own', sourceType: 'tenant_upload', folder: 'product' }), null);
});
