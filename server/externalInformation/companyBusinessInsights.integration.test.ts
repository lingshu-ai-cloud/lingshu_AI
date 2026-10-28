import assert from 'node:assert/strict';
import test from 'node:test';
import { companyReportSummary, generateCompanyReport } from './companyReport.js';
import { COMPANY_REPORT_CATALOG } from './companyReportCatalog.js';
import { companyBusinessPeriod, generateCompanyBusinessInsights } from './companyBusinessInsights.js';

const pages = [
  { page: 6, text: '主要会计数据\n单位：元 币种：人民币\n营业收入 1,000,000.00 2,000,000.00 -50.00\n归属于上市公司股东的净利润 100,000.00 200,000.00 -50.00\n归属于上市公司股东的扣除非经常性损\n益的净利润 80,000.00 100,000.00 -20.00\n经营活动产生的现金流量净额 300,000.00 100,000.00 200.00\n' },
  { page: 12, text: '原料业务实现收入。公司持续开发新原料和客户，不代表已经取得新的注册许可。' },
  { page: 41, text: '财务报表相关科目变动分析表\n单位：元 币种：人民币\n销售费用 100,000.00 200,000.00 -50.00\n研发费用 200,000.00 100,000.00 100.00\n营业成本 400,000.00 800,000.00 -50.00' },
];
const cited = { text: '原料业务需要继续核对客户采用情况。', evidenceIds: ['P12'] };
const draft = { headline: '收入变化需要与业务结构结合判断', conclusion: cited,
  sections: ['整体经营', '业务结构', '后续研发'].map(title => ({ title,
    observation: { ...cited, text: '公司披露持续开发新原料和客户。', quoteIds: ['P12-Q1'] } })),
  watchpoints: ['收入结构', '产品转化', '客户采用'].map(text => ({ ...cited, text, verifyWith: '核对下一期报告的披露情况。' })) };
const now = () => new Date('2026-10-28T08:00:00Z');
const dependencies = { now, read: async () => ({ pages, totalPages: 100, fetchedAt: now().toISOString(), sha256: 'c'.repeat(64), audited: false }), analyze: async () => JSON.stringify(draft) };

test('insights mode separates cache from financial mode and never runs old gap repair', async () => {
  let calls = 0, supplements = 0;
  const financial = await generateCompanyReport(COMPANY_REPORT_CATALOG[0], 'mode-isolation-test', { ...dependencies, supplement: async () => { supplements++; return { sources: [], patches: [] }; } });
  const report = await generateCompanyReport(COMPANY_REPORT_CATALOG[0], 'mode-isolation-test', { ...dependencies, mode: 'insights',
    supplement: async () => { throw Error('must not run historical repair'); },
    businessInsights: async () => { calls++; return { observationPeriod: companyBusinessPeriod(now()), status: 'unavailable', sources: [], events: [], judgments: [], actions: [] }; } });
  assert.equal(supplements, 1); assert.equal(calls, 1);
  assert.equal(financial.businessInsights, undefined);
  assert.equal(report.businessInsights?.status, 'unavailable');
  assert.deepEqual(report.metrics, financial.metrics);
  assert.notEqual(report.id, financial.id);
});

test('public research failure preserves verified financial delivery without reporting ready insights', async () => {
  const report = await generateCompanyReport(COMPANY_REPORT_CATALOG[0], 'insights-failure-test', { ...dependencies, mode: 'insights',
    businessInsights: async () => { throw Error('search unavailable'); } });
  assert.equal(report.businessInsights?.status, 'unavailable');
  assert.equal(report.metrics.length, 7);
  assert.ok(report.analysis.conclusion.text);
});

test('a valid quote beyond the opening excerpt survives delivery and unavailable summary stays financial', async () => {
  const financial = await generateCompanyReport(COMPANY_REPORT_CATALOG[0], 'deep-quote-proof', dependencies);
  const quote = '华熙生物宣布与合作伙伴共同开展原料配方研究';
  const body = '华熙生物企业公开动态。' + '公司经营背景材料。'.repeat(240) + quote + '，项目计划与实际效果需后续披露。';
  assert.ok(body.indexOf(quote) > 2000);
  const result = await generateCompanyBusinessInsights(COMPANY_REPORT_CATALOG[0], financial, {
    now: now(), search: async () => ({ text: '', sources: [] }),
    originals: async () => ({ originals: [{ id: 'S1', source: { title: '华熙生物原料合作动态', uri: 'https://www.bloomagebiotech.com/news/example.html' }, text: body, published: ['2026-10-20'] }], rejected: 0, rejectionReasons: {} }),
    analyze: async () => JSON.stringify({
      events: [{ id: 'E1', title: '原料配方合作动态', date: '2026-10-20', category: 'partnership', sourceIds: ['C1'], quote, summary: '公司宣布开展原料配方研究合作。' }],
      judgments: [{ title: '应用研发方向值得关注', text: '财报披露与近期合作提示公司可能继续推进原料应用研发。', financialEvidenceIds: ['P12'], sourceIds: ['C1'] }], actions: [],
    }),
  });
  assert.equal(result.status, 'ready');
  assert.ok(result.sources[0].excerpt.includes(quote));
  assert.match(companyReportSummary({ ...financial, businessInsights: { observationPeriod: companyBusinessPeriod(now()), status: 'unavailable', sources: [], events: [], judgments: [], actions: [] } }), /2026年半年度经营解读/u);
});
