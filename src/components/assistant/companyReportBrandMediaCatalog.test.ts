import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { COMPANY_BRAND_MEDIA, companyReportBrandMedia } from './companyReportBrandMediaCatalog';

test('brand imagery matches the company and brands actually disclosed in the section', () => {
  assert.deepEqual(companyReportBrandMedia('botanee', '业务分布：薇诺娜、瑷科缦与初普').map(item => item.id), ['winona', 'aoxmed', 'tripollar']);
  assert.deepEqual(companyReportBrandMedia('botanee', '品牌：薇诺娜宝贝').map(item => item.id), ['winona-baby']);
  assert.deepEqual(companyReportBrandMedia('proya', '品牌：薇诺娜'), []);
  assert.deepEqual(companyReportBrandMedia('botanee', '经营现金流增加'), []);
});

test('each media record has a bundled real image and traceable official source', () => {
  for (const item of COMPANY_BRAND_MEDIA) {
    const officialHost = item.companyId === 'proya' ? 'www.proya-group.com' : 'www.botanee.com.cn';
    assert.equal(new URL(item.sourceUrl).hostname, officialHost);
    assert.equal(new URL(item.originalImageUrl).hostname, officialHost);
    assert.match(item.retrievedOn, /^\d{4}-\d{2}-\d{2}$/u);
    const bytes = readFileSync(new URL(`../../../public${item.image}`, import.meta.url));
    assert.ok(bytes.length > 10_000);
    assert.ok(bytes[0] === 0xff || bytes.subarray(1, 4).toString() === 'PNG');
    assert.ok(item.attribution.length > 0);
  }
});

test('Proya business sections include only their explicitly mentioned official brands and product media', () => {
 assert.deepEqual(companyReportBrandMedia('proya','业务分布：珀莱雅、彩棠、Off&Relax、悦芙媞品牌矩阵。').map(item=>item.id),['proya-main','timage','off-relax','hapsode']);
 assert.deepEqual(companyReportBrandMedia('proya','品牌矩阵：TIMAGE、Off & Relax、HAPSODE。').map(item=>item.id),['timage','off-relax','hapsode']);
 assert.deepEqual(companyReportBrandMedia('botanee','业务分布：珀莱雅和彩棠。'),[]);
 assert.deepEqual(companyReportBrandMedia('proya','整体经营：收入和利润同比变化。'),[]);
});
