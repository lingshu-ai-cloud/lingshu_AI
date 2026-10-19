import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSceneVisualContract } from './sceneVisualContract.js';
import {
  FIXED_YIELD_ARCHETYPE_IDS,
  FIXED_YIELD_MATERIAL_RULES,
  classifyFixedYieldArchetype,
  fixedYieldCandidateMatches,
} from './fixedYieldMaterialRegistry.js';

test('registry covers all 22 fixed-yield archetypes exactly once', () => {
  assert.equal(FIXED_YIELD_ARCHETYPE_IDS.length, 22);
  assert.equal(new Set(FIXED_YIELD_ARCHETYPE_IDS).size, 22);
  assert.deepEqual(Object.keys(FIXED_YIELD_MATERIAL_RULES).sort(), [...FIXED_YIELD_ARCHETYPE_IDS].sort());
});

test('reference shots classify to precise presenter, product and factory archetypes', () => {
  assert.equal(classifyFixedYieldArchetype({materialType:'talking_head',function:'hook',visual:normalizeSceneVisualContract({
    subjects:['person','product','environment'],interaction:{kind:'person_talking',description:'人物在货架前讲解'},
    environment:{kind:'retail',description:'产品货架'},action:{path:'稳定站立口播'},
  })}),'P1C_SHELF_STAND_TALK');
  assert.equal(classifyFixedYieldArchetype({materialType:'product',function:'value',visual:normalizeSceneVisualContract({
    subjects:['product'],interaction:{kind:'product_only_display',description:'包装标签微距特写'},action:{path:'展示标签细节'},
  })}),'P2C_PACKAGE_DETAIL');
  assert.equal(classifyFixedYieldArchetype({materialType:'factory',function:'proof',visual:normalizeSceneVisualContract({
    subjects:['factory'],interaction:{kind:'factory_process',description:'灌装机向瓶内灌装'},action:{path:'机器灌装并旋盖'},
  })}),'P3B_MACHINE_CLOSEUP');
});

test('local candidate cannot cross material type, SKU or archetype boundaries', () => {
  const shelf=normalizeSceneVisualContract({subjects:['product'],interaction:{kind:'product_only_display',description:'产品在货架陈列'},
    environment:{kind:'retail',description:'产品货架'},productRef:'SKU-1',productPolicy:'locked'});
  const base={archetypeId:'P2B_PRODUCT_SHELF' as const,candidateMaterialType:'product' as const,
    candidateRoles:['product' as const],candidateVisual:shelf,requestedProductRef:'SKU-1',candidateProductRefs:['SKU-1']};
  assert.deepEqual(fixedYieldCandidateMatches(base),{accepted:true,reason:null});
  assert.equal(fixedYieldCandidateMatches({...base,candidateMaterialType:'factory'}).reason,'material_type_mismatch');
  assert.equal(fixedYieldCandidateMatches({...base,candidateProductRefs:['SKU-2']}).reason,'product_identity_mismatch');
  const detail=normalizeSceneVisualContract({subjects:['product'],interaction:{kind:'product_only_display',description:'包装标签特写'},
    action:{path:'微距展示标签'},productRef:'SKU-1',productPolicy:'locked'});
  assert.equal(fixedYieldCandidateMatches({...base,candidateVisual:detail}).reason,'archetype_mismatch');
});
