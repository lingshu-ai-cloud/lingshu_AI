import assert from 'node:assert/strict';
import { assertMaterialKnowledgeEligible, materialAssetPolicy } from './materialAssetPolicy.js';

assert.deepEqual(materialAssetPolicy({ scope: 'shared', sourceType: 'viral', provenance: {} }), {
  ownership: 'platform', visibility: 'platform_shared', knowledgeEligible: false, sourceEntry: 'platform_operations',
});
assert.throws(
  () => assertMaterialKnowledgeEligible({ scope: 'shared', tenantId: 'tenant-a' }),
  /platform material cannot enter enterprise knowledge/,
);

assert.deepEqual(materialAssetPolicy({
  scope: 'own', tenantId: 'tenant-a', provenance: { sourceEntry: 'enterprise_knowledge' },
}), {
  ownership: 'tenant', visibility: 'tenant_private', knowledgeEligible: true, sourceEntry: 'enterprise_knowledge',
});
assert.deepEqual(materialAssetPolicy({
  scope: 'own', tenantId: 'tenant-a', provenance: { sourceEntry: 'studio_workspace' },
}), {
  ownership: 'tenant', visibility: 'tenant_private', knowledgeEligible: true, sourceEntry: 'studio_workspace',
});

assert.equal(materialAssetPolicy({ scope: 'own', tenantId: 'tenant-b', sourceType: 'ai-storyboard-video' }).sourceEntry, 'ai_generation');
assert.equal(materialAssetPolicy({ scope: 'own' }).knowledgeEligible, false, 'tenant-less legacy records cannot become enterprise facts');

console.log('material asset ownership policy tests passed');
