import assert from 'node:assert/strict';
import test from 'node:test';
import { enterpriseFactContentHash, type EnterpriseProfile } from '../routes/enterprise.js';
import {
  projectShotMaterialRequirements,
  resolveSocialEnterpriseProductBinding,
} from './socialContentTaskEvidenceProjection.js';

function profile(): EnterpriseProfile {
  const value = {
    company: { name: '企业', industry: '个护', mainMarkets: '全球', founded: '', description: '' },
    products: { categories: '个护', priceRange: '', moq: '', certifications: '', highlights: '', items: [
      { id: 'product-coosto', sku: 'COOSTO-001', name: 'COOSTO 止汗净味喷雾' },
      { id: 'product-other', sku: 'OTHER-001', name: 'COOSTO 止汗净味喷雾' },
    ] },
  } as unknown as EnterpriseProfile;
  value.factVersion = { id: 'enterprise-facts-v7', revision: 7, contentHash: enterpriseFactContentHash(value),
    confirmedAt: '2026-10-16T00:00:00.000Z', confirmedBy: 'owner' };
  return value;
}

test('enterprise product binding requires exact stable id inside verified fact revision', () => {
  const facts = profile();
  const binding = resolveSocialEnterpriseProductBinding(facts, 'product-coosto');
  assert.equal(binding?.productName, 'COOSTO 止汗净味喷雾');
  assert.equal(binding?.enterpriseFactRef, 'enterprise_fact:enterprise-facts-v7@7');
  assert.equal(resolveSocialEnterpriseProductBinding(facts, 'COOSTO 止汗净味喷雾'), null,
    'display name must not become a production identity, especially when duplicated');
  facts.products.items![0]!.name = '被未确认修改的产品名';
  assert.equal(resolveSocialEnterpriseProductBinding(facts, 'product-coosto'), null,
    'a product row changed after confirmation must not retain authority');
});

test('server-planned generation shots do not become circular customer upload requirements', () => {
  const shots = Array.from({ length: 7 }, (_, index) => ({
    shotId: `shot-${index + 1}`,
    function: index === 0 ? 'hook' : index === 6 ? 'call_to_action' : 'demonstration',
    requestedDescription: `COOSTO 镜头 ${index + 1}`,
    sourceStrategy: index % 2 ? 'motion_graphics' : 'aigc_product_scene_replication',
    sourceRefs: [], fallbackSourceStrategy: null, productionInstruction: '制作镜头',
    truthBoundary: { subject: 'none', syntheticVisualAllowed: true, customerEvidenceRequired: false,
      customerEvidenceRefs: [], confirmedFactRefs: ['enterprise_fact:enterprise-facts-v7@7'],
      mustNotImplyCustomerReality: true, prohibitedRepresentations: [] },
    functionalEquivalentReplacement: { required: false, preservesFunction: 'demonstration', replacesSubject: null,
      description: null, reason: null },
    feasibility: 'functional_equivalent', feasibilityReason: '待制作', customerShootRequired: false,
  }));
  const requirements = projectShotMaterialRequirements({
    plan: { planVersion: '5', creationMode: 'viral_replication', assetAvailability: 'none',
      managementMode: 'one_click_managed', productionRoute: 'zero_asset_generation', status: 'ready',
      overallFeasibility: 'functional_equivalent', canProduceWithoutCustomerShoot: true, customerActions: [],
      systemActions: [], optionalEnhancements: [], shots } as never,
    shotMaterialMap: [], themeId: 'product_value', aspectRatio: '9:16', recalculatedAt: '2026-10-16T00:00:00.000Z',
  });
  assert.equal(requirements.length, 7);
  assert.ok(requirements.every(item => !item.required && item.status === 'missing' && item.reason));
  assert.deepEqual(requirements.map(item => item.requirementId), shots.map(shot => `shot-material:${shot.shotId}`));
});

test('customer evidence and non-ready generation routes remain fail-closed', () => {
  const shot = { shotId: 'customer-proof', function: 'proof', requestedDescription: '客户工厂实拍', sourceStrategy: 'motion_graphics',
    sourceRefs: [], fallbackSourceStrategy: null, productionInstruction: '制作镜头',
    truthBoundary: { subject: 'customer_factory', syntheticVisualAllowed: true, customerEvidenceRequired: true,
      customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true, prohibitedRepresentations: [] },
    functionalEquivalentReplacement: { required: false, preservesFunction: 'proof', replacesSubject: null, description: null, reason: null },
    feasibility: 'goal_degraded', feasibilityReason: '缺真实证据', customerShootRequired: false };
  const plan = { productionRoute: 'zero_asset_generation', status: 'ready', canProduceWithoutCustomerShoot: true, customerActions: [], shots: [shot] } as never;
  assert.equal(projectShotMaterialRequirements({plan,shotMaterialMap:[],themeId:'product_value',recalculatedAt:'2026-10-20T00:00:00Z'})[0]?.required,true);
  const systemShot={...shot,truthBoundary:{...shot.truthBoundary,subject:'none',customerEvidenceRequired:false}};
  assert.equal(projectShotMaterialRequirements({plan:{...(plan as object),status:'blocked',shots:[systemShot]} as never,shotMaterialMap:[],themeId:'product_value',recalculatedAt:'2026-10-20T00:00:00Z'})[0]?.required,true);
});

test('only material ids consumed by the shot map satisfy a projected requirement', () => {
  const shot = { shotId: 'shot-1', function: 'hook', requestedDescription: '产品开场', sourceStrategy: 'customer_real_asset',
    sourceRefs: ['candidate-not-consumed'], fallbackSourceStrategy: null, productionInstruction: '剪辑',
    truthBoundary: { subject: 'none', syntheticVisualAllowed: false, customerEvidenceRequired: false,
      customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: false, prohibitedRepresentations: [] },
    functionalEquivalentReplacement: { required: false, preservesFunction: 'hook', replacesSubject: null, description: null, reason: null },
    feasibility: 'full_fidelity', feasibilityReason: '候选存在', customerShootRequired: false };
  const base = { plan: { shots: [shot] } as never, themeId: 'product_value' as const,
    recalculatedAt: '2026-10-16T00:00:00.000Z' };
  assert.equal(projectShotMaterialRequirements({ ...base, shotMaterialMap: [] })[0]?.status, 'missing');
  assert.equal(projectShotMaterialRequirements({ ...base, shotMaterialMap: [{ shotId: 'shot-1', customerAssetIds: ['used'],
    generatedAssetIds: [], licensedAssetIds: [], sourceStrategy: 'customer_real_asset',
    truthBoundary: shot.truthBoundary, functionalEquivalentReplacement: shot.functionalEquivalentReplacement } as never] })[0]?.status, 'satisfied');
});
