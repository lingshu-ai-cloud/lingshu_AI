import assert from 'node:assert/strict';
import test from 'node:test';
import { ENTERPRISE_ONBOARDING_SCHEMA_VERSION, type EnterpriseOnboardingDraft } from '../../shared/contracts/enterpriseOnboarding.js';
import { EnterpriseOnboardingProposalError, generateEnterpriseOnboardingProposals } from './enterpriseOnboardingProposals.js';

function draft(): EnterpriseOnboardingDraft {
  return {
    schemaVersion: ENTERPRISE_ONBOARDING_SCHEMA_VERSION, revision: 1, currentStep: 3,
    confirmationId: 'onboarding:proposal-test', baseFactVersion: 'fact-v1',
    companyName: '北辰设备', brandName: 'Polaris', industry: '工业设备', primaryBusiness: '提供灌装设备',
    companyIntro: '', brandTone: '',
    products: [{ id: 'p1', name: '灌装机', category: '包装设备', description: '适用于玻璃瓶灌装' }],
    focusProductIds: [], targetMarket: '北美', targetBuyer: '', primaryPlatform: '', language: '',
    contentStage: 'b2b_launch', primaryCta: '获取产品资料', sources: {}, updatedAt: '2026-10-24T00:00:00.000Z',
  };
}

test('AI onboarding proposals remain bounded suggestions with explicit data coverage', async () => {
  const result = await generateEnterpriseOnboardingProposals(draft(), async () => JSON.stringify({
    companyIntro: { value: '北辰设备面向北美客户提供灌装设备。', confidence: 0.99, sourceRefs: ['company.name', 'company.primaryBusiness', 'unknown'] },
    brandTone: { value: '专业、清晰、以产品资料为依据。', confidence: 0.8, sourceRefs: ['company.brandName'] },
    focusProducts: [{ productId: 'p1', category: '包装设备', highlights: '适用于玻璃瓶灌装', description: '面向采购场景介绍设备能力。', reason: '资料中有明确应用对象。', confidence: 0.9, sourceRefs: ['product:p1:description'] }],
    market: { targetBuyer: '包装设备经销商与采购负责人', primaryPlatform: 'linkedin', language: '英语', reason: '基于 B2B 产品和目标市场的待确认建议。', confidence: 0.88, sourceRefs: ['targetMarket', 'product:p1'] },
  }), '2026-10-24T08:00:00.000Z');
  assert.equal(result.schemaVersion, 'enterprise-onboarding-proposals.v1');
  assert.equal(result.focusProducts[0]?.productId, 'p1');
  assert.equal(result.companyIntro.sourceRefs.includes('unknown'), false);
  assert.equal(result.market.coverage.operatingHistory, false);
  assert.match(result.market.coverage.note, /未读取到可核验经营历史/);
  assert.equal(result.market.confidence, 0.78, 'confidence is capped by actual source coverage');
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
});

test('AI onboarding proposals reject invented product identities and malformed provider output', async () => {
  await assert.rejects(generateEnterpriseOnboardingProposals(draft(), async () => JSON.stringify({
    companyIntro: { value: '企业简介', sourceRefs: [] }, brandTone: { value: '专业', sourceRefs: [] },
    focusProducts: [{ productId: 'invented', category: '未知', highlights: '未知' }],
    market: { targetBuyer: '采购', primaryPlatform: 'linkedin', language: '英语', sourceRefs: [] },
  })), (error: unknown) => error instanceof EnterpriseOnboardingProposalError && error.code === 'enterprise_onboarding_proposal_invalid');
  await assert.rejects(generateEnterpriseOnboardingProposals(draft(), async () => 'not-json'), /enterprise_onboarding_proposal_invalid/);
});
