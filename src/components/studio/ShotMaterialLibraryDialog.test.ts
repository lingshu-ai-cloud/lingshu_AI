import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleShotMaterials } from './ShotMaterialLibraryDialog';

const items = [
  { id: 'ordinary', name: 'Factory photo', type: 'image', url: '/factory.png', metadataSource: { id: 'ordinary', scope: 'own', sourceType: 'local-upload' } },
  { id: 'generated', name: 'Product concept', type: 'image', url: '/concept.png', metadataSource: { id: 'generated', scope: 'own', sourceType: 'seedream' } },
  { id: 'foreign', name: 'Other tenant concept', type: 'image', url: '/foreign.png', metadataSource: { id: 'foreign', scope: 'shared', sourceType: 'seedream' } },
];

test('the live shot library filters generated assets through the read-only generation projection', () => {
  assert.deepEqual(visibleShotMaterials(items, '', 'all', 'all').map(item => item.id), ['ordinary', 'generated', 'foreign']);
  assert.deepEqual(visibleShotMaterials(items, '', 'generated', 'all').map(item => item.id), ['generated']);
  assert.deepEqual(visibleShotMaterials(items, 'product', 'generated', 'concept_visual').map(item => item.id), ['generated']);
  assert.deepEqual(visibleShotMaterials(items, '', 'generated', 'digital_human'), []);
});
