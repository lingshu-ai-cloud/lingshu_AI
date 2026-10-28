import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertCompanyBusinessClaim, attributeCompanyPublicReview } from './companyBusinessClaimQuality.js';
import { generateCompanyBusinessInsights } from './companyBusinessInsights.js';
import { COMPANY_REPORT_CATALOG } from './companyReportCatalog.js';
import type { CompanyReport } from '../../shared/contracts/companyReport.js';

test('a rising R&D ratio is not evidence of low industry-relative spending, in title or prose', () => {
  for (const text of ['洗护高增与研发费用率偏低并存提示技术壁垒隐忧', '集团层面研发费用率小幅提升且整体偏低。', '这些举措可能意在弥补研发投入的相对不足。']) {
    assert.throws(() => assertCompanyBusinessClaim(text, '研发费用率 本期1.85% 上年同期1.77%。'), /research_benchmark_missing/);
  }
  assert.doesNotThrow(() => assertCompanyBusinessClaim('研发费用率小幅提升。', '研发费用率 本期1.85% 上年同期1.77%。'));
  assert.doesNotThrow(() => assertCompanyBusinessClaim('研发费用率低于行业水平。', '可比公司研发费用率中位数为3%，公司为1.85%。'));
});

test('specific technology suggestions need cited support or explicit conditional self-capability framing', () => {
  assert.throws(() => assertCompanyBusinessClaim('建议评估微珠包裹工艺及双形态喷雾的备案能力。', '公司发布护肤新品。'), /specific_technology_unsupported/);
  assert.doesNotThrow(() => assertCompanyBusinessClaim('建议若自身具备微珠包裹工艺，再核对客户是否有此需求。', '公司发布护肤新品。'));
  assert.doesNotThrow(() => assertCompanyBusinessClaim('建议评估自身次抛剂型、微珠包裹工艺及双形态喷雾的量产能力。', '推出双仓次抛、微珠包裹精华油、双态精华乳喷雾，采用双形态设计。'));
});

test('promotional reviews stay attributable public claims without independent-testing embellishment', () => {
  assert.equal(attributeCompanyPublicReview('第三方测评指出产品表现较好。', '横向实测评分，限时加赠，购1送正装。'), '公开测评文章指出产品表现较好。');
  assert.equal(attributeCompanyPublicReview('独立测评报道。', '独立实验室公开测试方法、原始数据与资助披露。'), '独立测评报道。');
});

test('actual Proya audit replay removes benchmark assertion, retains P11-backed techniques and attributes promotional review', async () => {
  const saved = JSON.parse(await readFile(new URL('./fixtures/proya-business-claim-replay.json', import.meta.url), 'utf8'));
  const financial = { evidence: saved.evidence, metrics: saved.metrics, analysis: {} as CompanyReport['analysis'] };
  const result = await generateCompanyBusinessInsights(COMPANY_REPORT_CATALOG.find(target => target.id === 'proya')!, financial, {
    now: new Date('2026-10-28T08:00:00Z'), search: async () => ({ text: '', sources: [] }),
    originals: async () => ({ originals: saved.originals, rejected: 0, rejectionReasons: {} }), analyze: async () => saved.raw,
  });
  assert.equal(result.status, 'ready');
  assert.ok(!JSON.stringify(result).includes('第三方测评'));
  assert.ok(!result.judgments.some(item => /研发费用率偏低|投入的相对不足/u.test(item.title + item.text)));
  assert.ok(result.events.some(item => /公开测评文章/u.test(item.summary)));
  assert.deepEqual(result.actions.map(item => item.audience).sort(), ['代工厂', '原料商', '品牌方'].sort());
  assert.ok(result.actions.some(item => item.audience === '代工厂' && /微珠包裹|双形态喷雾/u.test(item.text)));
});

test('cash receipts falling does not establish slower collections without cited evidence', () => {
 assert.throws(() => assertCompanyBusinessClaim('经营现金流下降主因宣传费支付增加及回款放缓。', '经营活动产生的现金流量净额变动原因：销售商品收到的现金下降；支付的形象宣传推广费增加。'), /payment_delay_unsupported/);
 assert.doesNotThrow(() => assertCompanyBusinessClaim('销售商品收到的现金下降。', '销售商品收到的现金下降。'));
 assert.doesNotThrow(() => assertCompanyBusinessClaim('回款周期延长。', '公司披露回款周期延长。'));
});
