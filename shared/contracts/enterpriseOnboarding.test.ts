import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
  normalizeEnterpriseOnboardingDraft,
  validateEnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingDraft,
} from './enterpriseOnboarding.js';

function completeDraft(): EnterpriseOnboardingDraft {
  return {
    schemaVersion: ENTERPRISE_ONBOARDING_SCHEMA_VERSION,
    revision: 3,
    currentStep: 3,
    confirmationId: 'onboarding:confirmation-001',
    baseFactVersion: 'fact-v1',
    companyName: '灵枢科技', brandName: 'Aurelia', industry: '工业自动化',
    primaryBusiness: '视觉检测设备', companyIntro: '面向海外工厂提供视觉检测设备。', brandTone: '专业、清晰、可核验。',
    products: [
      { id: 'p1', name: '检测相机', category: '工业相机', highlights: '高速检测' },
      { id: 'p2', name: '光源', category: '工业光源', description: '稳定照明' },
      { id: 'p3', name: '控制器', category: '控制器', highlights: '快速集成' },
      { id: 'p4', name: '辅助件', category: '配件', highlights: '易于安装' },
    ],
    focusProductIds: ['p1', 'p2'],
    targetMarket: '北美', targetBuyer: '经销商与采购负责人', primaryPlatform: 'linkedin', language: '英语',
    contentStage: 'b2b_growth', primaryCta: '发送采购需求，获取适配建议',
    sources: { companyName: 'user_provided', products: 'system_detected', focusProducts: 'system_detected' },
    updatedAt: '2026-10-24T00:00:00.000Z',
  };
}

test('draft normalization retains at most three real focus products and valid provenance', () => {
  const normalized = normalizeEnterpriseOnboardingDraft({
    ...completeDraft(),
    focusProductIds: ['p1', 'missing', 'p2', 'p3', 'p4', 'p1'],
    sources: { companyName: 'user_provided', brandName: 'invented', products: 'ai_suggested' },
  });
  assert.deepEqual(normalized?.focusProductIds, ['p1', 'p2', 'p3']);
  assert.deepEqual(normalized?.sources, { companyName: 'user_provided', products: 'ai_suggested' });
});

test('confirmation rejects incomplete focus facts and accepts the complete three-step result', () => {
  const draft = completeDraft();
  const incomplete = validateEnterpriseOnboardingConfirmation({
    ...draft,
    products: draft.products.map(product => product.id === 'p1' ? { ...product, category: '' } : product),
    draftRevision: draft.revision,
  });
  assert.equal(incomplete.confirmation, null);
  assert.ok(incomplete.missing.includes('主推产品类目'));

  const complete = validateEnterpriseOnboardingConfirmation({ ...draft, draftRevision: draft.revision });
  assert.equal(complete.missing.length, 0);
  assert.equal(complete.confirmation?.draftRevision, 3);
  assert.equal(complete.confirmation?.focusProductIds.length, 2);
});

test('onboarding no longer requires a main platform selection', () => {
  const parsed = validateEnterpriseOnboardingConfirmation({ ...completeDraft(), primaryPlatform: '', draftRevision: 3 });
  assert.deepEqual(parsed.missing, []);
  assert.ok(parsed.confirmation);
});

test('asset normalization drops malformed evidence instead of promoting it into enterprise facts', () => {
  const normalized = normalizeEnterpriseOnboardingDraft({
    ...completeDraft(),
    products: [{
      ...completeDraft().products[0],
      images: [
        { name: 'front.png', type: 'image/png', size: 128, updatedAt: '2026-10-24T00:00:00.000Z', url: 'https://example.test/front.png' },
        { url: 'https://example.test/unknown.png' },
      ],
    }],
    focusProductIds: ['p1'],
  });
  assert.equal(normalized?.products[0]?.images?.length, 1);
  assert.equal(normalized?.products[0]?.images?.[0]?.name, 'front.png');
});

test('original evidence and AI proposals retain only verifiable source identities', () => {
  const normalized = normalizeEnterpriseOnboardingDraft({ ...completeDraft(),
    evidenceRefs:[{ id:`onboarding-source:${'a'.repeat(64)}`, kind:'source_document', name:'products.xlsx',
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size:128,
      sha256:'a'.repeat(64), url:'/api/overseas/enterprise/assets/products.xlsx',
      capturedAt:'2026-10-24T00:00:00.000Z', status:'uploaded' }, { id:'bad', kind:'source_document' }],
    proposalSet:{ schemaVersion:'enterprise-onboarding-proposals.v1', inputHash:'b'.repeat(64), generatedAt:'2026-10-24T00:01:00.000Z',
      companyIntro:{ value:'待确认简介', confidence:2, sourceRefs:['company.name'] },
      brandTone:{ value:'待确认语气', confidence:.6, sourceRefs:['company.brandName'] },
      focusProducts:[{ productId:'p1', category:'工业相机', highlights:'高速检测', description:'产品说明', reason:'资料完整', confidence:.8, sourceRefs:['product:p1'] },
        { productId:'invented', category:'编造', highlights:'编造', description:'', reason:'', confidence:1, sourceRefs:[] }],
      market:{ targetBuyer:'采购负责人', primaryPlatform:'linkedin', language:'英语', reason:'B2B 建议', confidence:.7,
        sourceRefs:['targetMarket'], coverage:{ enterpriseIdentity:true, productProfile:true, targetMarket:true, operatingHistory:false, note:'没有经营历史' } } },
  });
  assert.equal(normalized?.evidenceRefs?.length, 1);
  assert.equal(normalized?.proposalSet?.focusProducts.length, 1);
  assert.equal(normalized?.proposalSet?.focusProducts[0]?.productId, 'p1');
  assert.equal(normalized?.proposalSet?.companyIntro.confidence, 1);
});


test('company introduction and initial brand tone may be deferred without weakening product confirmation', () => {
  const draft = { ...completeDraft(), companyIntro: '', brandTone: '' };
  assert.ok(validateEnterpriseOnboardingConfirmation({ ...draft, draftRevision: draft.revision }).confirmation);
  const missingProduct = { ...draft, products: [], focusProductIds: [] };
  assert.equal(validateEnterpriseOnboardingConfirmation({ ...missingProduct, draftRevision: draft.revision }).confirmation, null);
});

test('product setup may be explicitly deferred without inventing confirmed product facts', () => {
  const draft = { ...completeDraft(), productsDeferred: true, products: [], focusProductIds: [] };
  const parsed = validateEnterpriseOnboardingConfirmation({ ...draft, draftRevision: draft.revision });
  assert.deepEqual(parsed.missing, []);
  assert.equal(parsed.confirmation?.productsDeferred, true);
  assert.deepEqual(parsed.confirmation?.products, []);
  assert.deepEqual(parsed.confirmation?.focusProductIds, []);
});
