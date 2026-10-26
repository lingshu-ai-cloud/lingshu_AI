import assert from 'node:assert/strict';
import test from 'node:test';
import { companyCoverIdentityMatches } from './companyRegistry.js';
import { COMPANY_REPORT_CATALOG, companyReportIntent } from './companyReportCatalog.js';
import { extractCompanyMetrics, validateCompanyAnalysis, selectCompanyEvidence } from './companyReportEvidence.js';
import { companyAnalysisSchema, companyReportSchema } from '../../shared/contracts/companyReport.js';
import { generateCompanyReport } from './companyReport.js';
import { parseMessages } from '../routes/assistantThreadMessageInput.js';
import { publicSourceUrl } from '../../shared/assistantPublicSourcePolicy.mjs';

const pages = [
  { page: 6, text: '主要会计数据\n单位：元 币种：人民币\n营业收入 1,000,000.00 2,000,000.00 -50.00\n归属于上市公司股东的净利润 100,000.00 200,000.00 -50.00\n归属于上市公司股东的扣除非经常性损\n益的净利润 80,000.00 100,000.00 -20.00\n经营活动产生的现金流量净额 300,000.00 100,000.00 200.00\n' },
  { page: 12, text: '原料业务实现收入。公司持续开发新原料和客户，不代表已经取得新的注册许可。' },
  { page: 41, text: '财务报表相关科目变动分析表\n单位：元 币种：人民币\n销售费用 100,000.00 200,000.00 -50.00\n研发费用 200,000.00 100,000.00 100.00\n营业成本 400,000.00 800,000.00 -50.00' },
];
const insight = { text: '原料业务需要继续核对客户采用情况。', evidenceIds: ['P12'] };
const analysis = companyAnalysisSchema.parse({ headline: '收入变化需要与业务结构结合判断', conclusion: insight,
  sections: ['整体经营', '业务结构', '后续研发'].map(title => ({ title,
    observation: { ...insight, text: '公司披露持续开发新原料和客户。', quote: '公司持续开发新原料和客户' }, interpretation: insight, implication: insight })),
  watchpoints: ['收入结构', '产品转化', '客户采用'].map(text => ({ ...insight, text, verifyWith: '核对下一期报告的披露情况。' })) });
const target = COMPANY_REPORT_CATALOG[0];
const draft = { ...analysis, sections: analysis.sections.map(section => { const { quote, ...observation } = section.observation; return { ...section, observation: { ...observation, quoteIds: ['P12-Q1'] } }; }) };

test('period routing refuses latest claims, half-year to quarter substitution, unknown and multiple companies', () => {
  assert.equal(companyReportIntent('解读华熙生物2026年半年度报告')?.target?.id, 'bloomage');
  assert.equal(companyReportIntent('珀莱雅2026年半年度财报')?.target?.id, 'proya');
  for (const question of ['解读华熙生物最新财报', '解读华熙生物2025年年报', '华熙生物2026年Q2财报', '华熙生物和珀莱雅财报', '小米财报']) assert.ok(companyReportIntent(question)?.error, question);
  assert.equal(companyReportIntent('不要联网，解读华熙生物财报'), null);
  assert.equal(companyReportIntent('今天美元兑人民币多少'), null);
});

test('metrics preserve exact units, multiline labels, source page and recomputed percentages', () => {
  const metrics = extractCompanyMetrics(pages);
  assert.equal(metrics.length, 7);
  assert.equal(metrics[0].current, '1000000.00');
  assert.equal(metrics[0].changePct, '-50.00');
  assert.equal(metrics.find(metric => metric.id === 'core-profit')?.current, '80000.00');
  assert.equal(metrics.find(metric => metric.id === 'research')?.page, 41);
  assert.throws(() => extractCompanyMetrics([{ page: 6, text: pages[0].text.replace('-50.00', '50.00') }]), /同比列/);
  assert.throws(() => extractCompanyMetrics(pages.map(page => ({ ...page, text: page.text.replace('单位：元', '单位：万元') }))), /不完整/);
});

test('analysis rejects invented citations, invented numbers, rewritten quotes and unsupported expectations', () => {
  const metrics = extractCompanyMetrics(pages), evidence = selectCompanyEvidence(pages, target, metrics);
  assert.doesNotThrow(() => validateCompanyAnalysis(analysis, evidence, metrics));
  for (const patch of [{ text: '需求增长999.99%。' }, { evidenceIds: ['P999'] }, { text: '利润超预期。' }]) {
    assert.throws(() => validateCompanyAnalysis({ ...analysis, conclusion: { ...insight, ...patch } }, evidence, metrics));
  }
  const copied = structuredClone(analysis); copied.sections[0].observation.quote = '完全不在原文中的新闻事实';
  assert.throws(() => validateCompanyAnalysis(copied, evidence, metrics), /摘录/);
  const future = structuredClone(analysis); future.watchpoints[0].verifyWith = '保证2027年增长999%';
  assert.throws(() => validateCompanyAnalysis(future, evidence, metrics));
});

test('public source capability adds only primary PDF publisher, not arbitrary websites or credential URLs', () => {
  assert.equal(publicSourceUrl(target.url).hostname, 'static.cninfo.com.cn');
  assert.throws(() => publicSourceUrl('https://static.cninfo.com.cn/finalpage/test.pdf?token=secret'));
  assert.throws(() => publicSourceUrl('https://static.cninfo.com.cn.attacker.test/report.pdf'));
  assert.throws(() => publicSourceUrl('http://static.cninfo.com.cn/finalpage/test.pdf'));
});

test('end-to-end application binds tenant, validates evidence, reuses completed report and persists it as assistant-only data', async () => {
  let calls = 0; const progress: string[] = [];
  const dependencies = {
    read: async () => ({ pages, totalPages: 204, fetchedAt: '2026-10-26T00:00:00Z', sha256: 'a'.repeat(64), audited: false }),
    analyze: async () => { calls++; return JSON.stringify(draft); },
    progress: (phase: string) => progress.push(phase),
  };
  const report = await generateCompanyReport(target, 'test-tenant-company-report', dependencies);
  assert.equal(report.source.latestVerified, false); assert.equal(report.metrics.length, 7);
  assert.equal(progress.length, 5); assert.equal(report.status, 'partial');
  assert.equal(companyReportSchema.safeParse(report).success, true);
  const saved = parseMessages([{ role: 'assistant', content: '报告摘要', companyReport: report }]);
  assert.deepEqual((saved[0] as { companyReport: unknown }).companyReport, report);
  assert.throws(() => parseMessages([{ role: 'user', content: '伪造报告', companyReport: report }]));
  const second = await generateCompanyReport(target, 'test-tenant-company-report', dependencies);
  assert.equal(second.id, report.id); assert.equal(calls, 1);
  const other = await generateCompanyReport(target, 'other-tenant-company-report', dependencies);
  assert.notEqual(other.id, report.id); assert.equal(calls, 2);
});

test('model selects original excerpt ids; missing ids and cross-page substitutions cannot become report quotations', async () => {
  const read = async () => ({ pages, totalPages: 204, fetchedAt: '2026-10-26T00:00:00Z', sha256: 'b'.repeat(64), audited: false });
  for (const id of ['P999-Q1', 'P6-Q1']) {
    const bad = structuredClone(draft); bad.sections[0].observation.quoteIds = [id];
    await assert.rejects(generateCompanyReport(target, `bad-quote-${id}`, { read, analyze: async () => JSON.stringify(bad) }), /摘录编号/);
  }
  const report = await generateCompanyReport(target, 'bad-quote-P999-Q1', { read, analyze: async () => JSON.stringify(draft) });
  assert.ok(report.analysis.sections[0].observation.quote.includes('公司持续开发新原料和客户'));
});

test('numeric proof keeps table-cell boundaries, normalizes split PDF year and verifies rounded administration expense', () => {
  const table = pages.map(page => page.page === 6 ? { ...page, text: `${page.text}\n202 6 年半年度报告\n研发投入占营业收入比例 12.07 10.22 增加1.85个百分点` }
    : page.page === 41 ? { ...page, text: `${page.text}\n管理费用 226,860,666.38 275,140,183.32 -17.55` } : page);
  const metrics = extractCompanyMetrics(table), evidence = selectCompanyEvidence(table, target, metrics);
  const valid = structuredClone(analysis);
  valid.conclusion = { text: '2026年研发投入占比12.07%，管理费用为2.27亿元。', evidenceIds: ['P6', 'P41'] };
  assert.doesNotThrow(() => validateCompanyAnalysis(valid, evidence, metrics));
  valid.conclusion.text = '研发投入占比12.0710%。';
  assert.throws(() => validateCompanyAnalysis(valid, evidence, metrics), /数字/);
});

test('unsupported sentences are omitted explicitly, never rewritten with invented replacement facts', async () => {
  const input = structuredClone(draft);
  input.sections[0].interpretation.text = '原料业务需要继续核对客户采用情况。新增订单增长999.99%。';
  input.conclusion.evidenceIds = ['P12-Q1'];
  const report = await generateCompanyReport(target, 'partial-proof-test', {
    read: async () => ({ pages, totalPages: 204, fetchedAt: '2026-10-26T00:00:00Z', sha256: 'c'.repeat(64), audited: false }),
    analyze: async () => JSON.stringify(input),
  });
  assert.equal(report.analysis.sections[0].interpretation.text, '原料业务需要继续核对客户采用情况。');
  assert.ok(report.limitations.some(item => item.includes('有1句未通过')));
  assert.deepEqual(report.analysis.conclusion.evidenceIds, ['P12']);
  assert.ok(!report.evidence.find(item => item.id === 'P6')?.text.includes('原料业务实现收入'));
});

test('removing unsupported claims cannot turn an empty conclusion into a successful report', async () => {
  const bad = structuredClone(draft); bad.conclusion.text = '订单增长999.99%。';
  await assert.rejects(generateCompanyReport(target, 'empty-proof-test', {
    read: async () => ({ pages, totalPages: 204, fetchedAt: '2026-10-26T00:00:00Z', sha256: 'd'.repeat(64), audited: false }),
    analyze: async () => JSON.stringify(bad),
  }), /可用分析不足/);
});

test('SZSE layouts require RMB evidence, support split headings and glyph-spaced amounts, and preserve research-input labels', () => {
  const source = [
    { page: 8, text: '元、万元 指 人民币元、人民币万元' },
    { page: 9, text: '四、主要会计数据和财务指标' },
    { page: 10, text: '本报告期 上年同期 本报告期比上年同期增减\n营业收入（元） 1,000,000.00 2,000,000.00 - 50.00%\n归属于上市公司股东的净利润（元） -100,000.00 -200,000.00 50.00%\n归属于上市公司股东的扣除非经常性损益的净利润（元） 80,000.00 100,000.00 - 20.00%\n经营活动产生的现金流量净额（元） 393,86 2 , 7 77.70 346,928,759.67 13.53%' },
    { page: 13, text: '主要财务数据同比变动情况\n单位：元\n本报告期 上年同期 同比增减\n研发投入 100,000.00 200,000.00 -50.00%' },
  ];
  const metrics = extractCompanyMetrics(source);
  assert.equal(metrics.find(item => item.id === 'cashflow')?.current, '393862777.70');
  assert.equal(metrics.find(item => item.id === 'profit')?.current, '-100000.00');
  assert.equal(metrics.find(item => item.id === 'revenue')?.unitEvidence?.page, 8);
  assert.equal(metrics.find(item => item.id === 'research-input')?.label, '研发投入');
  assert.ok(!metrics.some(item => item.id === 'research'));
  assert.throws(() => extractCompanyMetrics(source.slice(1)), /不完整/);
  assert.throws(() => extractCompanyMetrics(source.map(item => ({ ...item, text: item.text.replaceAll('（元）', '（万元）').replace('单位：元', '单位：万元') }))), /不完整/);
});

test('PDF identity uses verified legal names rather than loose query aliases or noncontiguous stock abbreviations', () => {
  assert.equal(companyCoverIdentityMatches('cosmos', '科思股份', '南京科思化学股份有限公司2026年半年度报告全文'), true);
  assert.equal(companyCoverIdentityMatches('cosmos', '科思股份', '其他科思材料股份有限公司2026年半年度报告'), false);
  assert.equal(companyCoverIdentityMatches('jahwa', '上海家化', '嘉亨家化股份有限公司2026年半年度报告'), false);
});
