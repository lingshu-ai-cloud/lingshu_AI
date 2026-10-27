import assert from 'node:assert/strict';
import test from 'node:test';
import { fillLocalMetaReport } from './localBusinessProjection';
import type { MetaBusinessOverview } from '../../shared/metaBusinessOverview';
import type { AdDirectoryAccount } from '../../shared/adAccountDirectory';
const library = { companyName: '企业', industry: '护肤', markets: '北美', description: '', productCount: 1, products: [{ id: 'p1', name: '产品', category: '护肤', imageUrl: '/media/product.png' }] };
const account = { accountId: '123', name: '账户', currency: 'CNY' } as AdDirectoryAccount;
test('local supplementation preserves provider zero and actual daily rows', () => {
  const seed = fillLocalMetaReport(undefined, account, library, 7)!;
  const real = { ...seed, source: 'provider', totals: { ...seed.totals, spend: 0, impressions: 0, clicks: 0, linkClicks: 0 }, daily: [{ ...seed.daily[0], impressions: 0, spend: 0 }] } as MetaBusinessOverview;
  const result = fillLocalMetaReport(real, account, library, 7)!;
  assert.equal(result.totals?.spend, 0);
  assert.equal(result.totals?.impressions, 0);
  assert.deepEqual(result.daily, real.daily);
  assert.equal(fillLocalMetaReport(real, account, null, 7), real);
});
test('supplemental daily totals conserve impressions and spend for either period', () => {
  for (const days of [7, 30]) {
    const result = fillLocalMetaReport(undefined, account, library, days)!;
    assert.equal(result.daily.length, days);
    assert.equal(result.daily.reduce((sum, row) => sum + row.impressions!, 0), result.totals?.impressions);
    assert.equal(Math.round(result.daily.reduce((sum, row) => sum + row.spend!, 0) * 100), Math.round(result.totals!.spend! * 100));
  }
});
