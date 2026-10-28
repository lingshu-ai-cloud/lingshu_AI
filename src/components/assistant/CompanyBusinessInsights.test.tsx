import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanyReport } from '../../../shared/contracts/companyReport';
registerHooks({ load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: 'export {};', shortCircuit: true } : next(url, context); } });
const { default: CompanyBusinessInsights, companyInsightSafeUrl } = await import('./CompanyBusinessInsights');
const { CompanyReportPresentation } = await import('./CompanyReportCard');

const report = {
  id: 'cr_123456789012345678901234', status: 'ready', company: '测试企业', companyId: 'fixture', period: '2026年半年度', generatedAt: '2026-10-28T01:00:00Z', metrics: [],
  evidence: [{ id: 'P8', page: 8, text: '报告期研发投入原文证据' }], source: { title: '测试半年报', url: 'https://static.cninfo.com.cn/report.pdf', publishedAt: '2026-08-20', fetchedAt: '2026-10-28T01:00:00Z', sha256: 'a'.repeat(64), pages: 100, audited: false, latestVerified: false },
  analysis: { headline: '财报披露经营情况', conclusion: { text: '公司报告期经营披露。', evidenceIds: ['P8'] }, sections: [], watchpoints: [] }, limitations: ['数据以财报原文为准'],
  businessInsights: {
    status: 'ready', observationPeriod: { from: '2026-07-31', to: '2026-10-28' },
    sources: [{ id: 's1', title: '官方研发合作公告', url: 'https://example.com/research', publishedAt: '2026-10-20', excerpt: '企业发布研发合作安排' }],
    events: [{ id: 'e1', title: '启动研发合作项目', category: 'partnership', date: '2026-10-20', sourceIds: ['s1'], quote: '企业在公告中明确披露研发合作项目安排', summary: '企业披露与研究机构合作开展研发项目。' }],
    judgments: [{ title: '研发能力建设值得持续观察', text: '财报研发投入与合作公告共同反映能力建设动作。', financialEvidenceIds: ['P8'], sourceIds: ['s1'] }],
    actions: [{ audience: '代工厂', text: '准备与研发项目匹配的试产能力说明', verifyWith: '先核实采购需求和自身真实工艺资质。', financialEvidenceIds: ['P8'], sourceIds: ['s1'] }],
  },
} satisfies CompanyReport;

test('business report separates financial basis from observation dates and links every fact, judgment and B2B action', () => {
  const html = renderToStaticMarkup(<CompanyBusinessInsights report={report}/>);
  for (const text of ['财务基准', '2026年半年度', '公开动态观察期', '2026/07/31', '2026/10/28', '生成日期', '经营基本盘', '战略与业务动作', '核心经营判断', 'B2B经营行动启示', '已报道事实', '分析判断', '行动建议', '财报第8页', '执行前准备与核实']) assert.ok(html.includes(text), text);
  assert.match(html, /href="https:\/\/example.com\/research"/);
  assert.match(html, /收录1篇可读取公开资料/);
  assert.doesNotMatch(html, /多源印证|多方交叉验证|已取得收入/);
});

test('old and unavailable reports do not invent empty insight sections or unsupported judgment', () => {
  assert.equal(renderToStaticMarkup(<CompanyBusinessInsights report={{ ...report, businessInsights: undefined }}/>), '');
  assert.equal(renderToStaticMarkup(<CompanyBusinessInsights report={{ ...report, businessInsights: { ...report.businessInsights!, status: 'unavailable', sources: [], events: [], judgments: [], actions: [] } }}/>), '');
  const html = renderToStaticMarkup(<CompanyBusinessInsights report={{ ...report, businessInsights: { ...report.businessInsights!, sources: [], judgments: [{ ...report.businessInsights!.judgments[0], sourceIds: [], financialEvidenceIds: [] }], actions: [] } }}/>);
  assert.doesNotMatch(html, /研发能力建设值得持续观察|启动研发合作项目|B2B经营行动启示/);
});

test('source URL and source content cannot inject executable markup', () => {
  assert.equal(companyInsightSafeUrl('javascript:alert(1)'), null);
  assert.equal(companyInsightSafeUrl('https://user:secret@example.com/'), null);
  const html = renderToStaticMarkup(<CompanyBusinessInsights report={{ ...report, businessInsights: { ...report.businessInsights!, sources: [{ ...report.businessInsights!.sources[0], title: '<script>alert(1)</script>' }] } }}/>);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
});

 test('ready reports expose financial reading tab while historical reports retain the original financial body', () => {
  const html = renderToStaticMarkup(<CompanyReportPresentation report={report}/>);
  assert.match(html, /role="tab"[^>]*>企业经营洞察/);
  assert.match(html, /纯财报解读/);
  const legacy = renderToStaticMarkup(<CompanyReportPresentation report={{ ...report, businessInsights: undefined }}/>);
  assert.match(legacy, /财报披露经营情况/);
  assert.doesNotMatch(legacy, /role="tab"/);
  const unavailable = renderToStaticMarkup(<CompanyReportPresentation report={{ ...report, businessInsights: { ...report.businessInsights!, status: 'unavailable', sources: [], events: [], judgments: [], actions: [] } }}/>);
  assert.match(unavailable, /公开动态观察期/);
  assert.doesNotMatch(unavailable, /核心经营判断|B2B经营行动启示/);
});

test('pending insight rows and financial report review badges are omitted while evidence and numeric facts stay intact', async () => {
  const { default: CompanyReportCard, CompanyReportContents } = await import('./CompanyReportCard');
  const value: CompanyReport = structuredClone(report);
  value.businessInsights!.judgments[0].text = '分析依据不充分，暂不形成经营判断';
  value.businessInsights!.actions[0].verifyWith = '企业资质待核验';
  value.businessInsights!.events[0].summary = '经营结论低置信度';
  value.analysis.conclusion.text = '营业收入25.92亿元。经营判断需复核。';
  value.limitations.push('结论尚未复核');
  const saved = JSON.stringify(value);
  const insight = renderToStaticMarkup(<CompanyBusinessInsights report={value}/>);
  const financial = renderToStaticMarkup(<CompanyReportContents report={value}/>);
  const card = renderToStaticMarkup(<CompanyReportCard report={value}/>);
  assert.doesNotMatch(insight + financial + card, /低置信|待确认|待核验|需复核|待复核|尚未复核|研究草稿|分析依据不充分/);
  assert.doesNotMatch(insight, /核心经营判断|战略与业务动作|执行前准备与核实/);
  assert.match(insight, /准备与研发项目匹配的试产能力说明/);
  assert.match(financial, /营业收入25.92亿元/);
  assert.equal(JSON.stringify(value), saved);
});
