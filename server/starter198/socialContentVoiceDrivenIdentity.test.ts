import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceDrivenIdentityPolicy } from './socialContentVoiceDrivenIdentity.js';

const emptyLegacy = {
  company: { originals: [], replacement: null },
  brand: { originals: [], replacement: null },
  product: { originals: [], replacement: null },
};

test('v3 consumes explicit nonstandard reference identity evidence without reading arbitrary prose', () => {
  const rewrite = voiceDrivenIdentityPolicy({
    legacy: emptyLegacy,
    referenceRecord: {},
    analysis: {
      summary: '普通产品和核心卖点只是分析文字，不能成为实体',
      gemini: {
        competitorProfile: {
          competitorCompany: 'Acme Labs',
          competitorBrand: 'Glow-X',
          competitorProduct: 'Ultra Serum',
          certifications: ['Gold Origin Seal'],
        },
      },
    },
    context: {
      enterpriseName: '自有企业', brandName: '自有品牌', productName: '自有精华',
      facts: [{ key: 'certifications', label: '已核验资质', value: 'ISO 9001' }],
      source: 'enterprise_product', confidence: 1,
    },
  });

  const result = rewrite('Acme Labs 的 Glow-X Ultra Serum，通过 Gold Origin Seal 认证。普通产品和核心卖点继续保留。');
  assert.equal(result.text, '自有企业 的 自有品牌 自有精华，通过 ISO 9001 认证。普通产品和核心卖点继续保留。');
  assert.deepEqual(result.replacedEntityTypes, ['company', 'brand', 'product']);
});

test('v3 accepts typed alias rows but drops an exclusive competitor credential claim', () => {
  const rewrite = voiceDrivenIdentityPolicy({
    legacy: emptyLegacy,
    referenceRecord: {},
    analysis: { gemini: { referenceIdentity: { sourceEntities: [
      { category: 'competitor_brand', canonicalName: 'NORTHSTAR' },
      { role: 'reference_model', mention: 'NX-200' },
      { entityType: 'accreditation', value: 'Platinum Lab Seal' },
    ] } } },
    context: {
      brandName: '自有品牌', productName: '自有型号',
      facts: [{ key: 'certifications', label: '已核验资质', value: 'CE' }],
      source: 'enterprise_product', confidence: 1,
    },
  });

  const result = rewrite('NORTHSTAR NX-200。唯一获得 Platinum Lab Seal 的产品。');
  assert.equal(result.text, '自有品牌 自有型号。');
  assert.deepEqual(result.replacedEntityTypes, ['brand', 'product']);
});

test('v3 removes a recognized competitor clause when no verified replacement exists', () => {
  const rewrite = voiceDrivenIdentityPolicy({
    legacy: emptyLegacy,
    referenceRecord: { competitorIdentity: { competitorBrand: 'OtherBrand' } },
    analysis: {},
    context: { productName: null, facts: [], source: 'none', confidence: 0 },
  });

  const result = rewrite('OtherBrand 提供这项服务。欢迎了解通用方案。');
  assert.equal(result.text, '欢迎了解通用方案。');
  assert.deepEqual(result.replacedEntityTypes, []);
});

test('a short verified certification does not approve a longer competitor-only credential', () => {
  const rewrite = voiceDrivenIdentityPolicy({
    legacy: emptyLegacy,
    referenceRecord: {},
    analysis: { competitorProfile: { certifications: ['Gold CE Mark'] } },
    context: {
      productName: '自有产品',
      facts: [{ key: 'certifications', label: '已核验资质', value: 'CE' }],
      source: 'enterprise_product', confidence: 1,
    },
  });

  assert.equal(rewrite('产品通过 Gold CE Mark。普通说明。').text, '产品通过 CE。普通说明。');
});
