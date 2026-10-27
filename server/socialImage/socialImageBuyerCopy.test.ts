import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnterpriseProfile } from '../routes/enterpriseProfileContracts.js';
import { socialImageBuyerCopy } from './socialImageBuyerCopy.js';

const profile = {
  factVersion: { id: 'facts-1' }, brand: { name: 'GUIANFA' }, knowledge: '已确认产品目录',
  socialStrategy: { routeStrategies: { wholesale_distribution: { primaryCta: '私信获取产品目录' } } },
  products: { items: [
    { id: 'GUIANFA-RS-005', sku: 'GUIANFA-RS-005', name: '冰沙面霜', category: '面霜', brand: 'GUIANFA',
      attributes: { 净含量: '50g', 核心场景: '面霜质地与晚间锁水' }, images: [{ name: '闭罐正面', url: '/owned.png' }], packagingImages: [] },
    { id: 'other', name: '其他面霜', category: '面霜', attributes: { 净含量: '100g' } },
  ] },
} as unknown as EnterpriseProfile;

test('buyer copy uses only the selected confirmed product and package-observed texture', () => {
  const result = socialImageBuyerCopy(profile, 'GUIANFA-RS-005', 'en', 'SORBET CREAM');
  assert.deepEqual(result?.poster, {
    headline: 'SORBET CREAM', originBadge: 'GUIANFA', subheadline: 'Cool-touch sorbet texture',
    sellingPoints: ['Face cream', 'Sorbet-like texture', 'Evening skincare', 'SKU: GUIANFA-RS-005'],
    bottomBar: ['50 g', 'B2B SOURCING', 'Order size · Packaging · Timing?'],
    cta: 'Message us for catalog and quote',
  });
  assert.match(result?.auditEvidence || '', /50 g/);
  assert.match(result?.auditEvidence || '', /晚间锁水/);
  assert.doesNotMatch(JSON.stringify(result), /100g|OEM|Thailand/);
});

test('missing package evidence removes texture wording; other languages keep buyer text localized', () => {
  const result = socialImageBuyerCopy(profile, 'GUIANFA-RS-005', 'es', null);
  assert.equal(result?.poster.subheadline, '');
  assert.equal(result?.poster.headline, 'CREMA FACIAL');
  assert.equal(result?.poster.sellingPoints[0], 'Crema facial');
  assert.ok(result?.poster.sellingPoints.includes('Cuidado facial nocturno'));
  assert.doesNotMatch(JSON.stringify(result?.poster), /Cool-touch|Face cream/);
  assert.equal(socialImageBuyerCopy(profile, 'unknown', 'en', 'SORBET CREAM'), null);
  assert.equal(socialImageBuyerCopy({ ...profile, factVersion: undefined }, 'GUIANFA-RS-005', 'en', 'SORBET CREAM'), null);
});

test('missing net content keeps footer positions without inventing a package size', () => {
  const withoutNet = { ...profile, products: { items: [{ ...profile.products.items![0], attributes: {} }] } } as EnterpriseProfile;
  const result = socialImageBuyerCopy(withoutNet, 'GUIANFA-RS-005', 'en', 'SORBET CREAM');
  assert.deepEqual(result?.poster.bottomBar, ['', 'B2B SOURCING', 'Order size · Packaging · Timing?']);
});

test('switching to peach cream keeps its own facts and drops the previous sorbet claim', () => {
  const peach = { ...profile, products: { items: [{ ...profile.products.items![0],
    id: 'GUIANFA-RS-006', sku: 'GUIANFA-RS-006', name: '蜜桃冰雪霜',
    attributes: { 净含量: '50g', 核心场景: '面霜质地与晚间锁水' } }] } } as unknown as EnterpriseProfile;
  const result = socialImageBuyerCopy(peach, 'GUIANFA-RS-006', 'en', 'PEACH ICE FROST');
  assert.deepEqual(result?.poster.sellingPoints, ['Face cream', 'Evening skincare', 'SKU: GUIANFA-RS-006']);
  assert.equal(result?.poster.subheadline, '');
  assert.doesNotMatch(JSON.stringify(result), /RS-005|Sorbet-like|Thailand|OEM/);
});

test('confirmed OEM/ODM inquiry route becomes buyer copy for a different product category', () => {
  const mist = { ...profile, socialStrategy: { routeStrategies: {
    oem_odm: { primaryCta: '私信获取美妆产品目录与 OEM/ODM 合作资料' },
  } }, products: { items: [{ ...profile.products.items![0],
    id: 'GUIANFA-RS-003', sku: 'GUIANFA-RS-003', name: '深海冰川舒缓喷雾', category: '护肤喷雾',
    attributes: { 净含量: '180ml' } }] } } as unknown as EnterpriseProfile;
  const result = socialImageBuyerCopy(mist, 'GUIANFA-RS-003', 'en', 'DEEP SEA GLACIER SOOTHING MIST');
  assert.equal(result?.poster.headline, 'DEEP SEA MIST');
  assert.equal(result?.poster.bottomBar[1], 'OEM / ODM');
  assert.deepEqual(result?.poster.sellingPoints,
    ['Facial mist', 'Request OEM/ODM info', 'SKU: GUIANFA-RS-003']);
  assert.match(result?.auditEvidence || '', /已确认OEM\/ODM资料询盘入口/);
  assert.doesNotMatch(JSON.stringify(result), /MOQ|lead time|factory|manufacturing capacity/);
  const withoutRoute = { ...mist, socialStrategy: { routeStrategies: {} } } as EnterpriseProfile;
  assert.equal(socialImageBuyerCopy(withoutRoute, 'GUIANFA-RS-003', 'en', null)?.poster.bottomBar[1], 'B2B SOURCING');
  assert.equal(socialImageBuyerCopy(withoutRoute, 'GUIANFA-RS-003', 'en', null)?.poster.headline, 'FACIAL MIST');
});
