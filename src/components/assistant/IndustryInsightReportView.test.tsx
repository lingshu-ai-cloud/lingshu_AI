import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { IndustryInsightReportView, IndustryInsightReportContents, parseIndustryInsight, industryInsightCoverage, industryMetricGroups, industryVisibleText } from './IndustryInsightReportView';
import { readableAssistantReply, splitAssistantReply } from '../../../shared/assistantReadableReply';
import AgentReply from '../AgentReply';

const raw = JSON.stringify({ version: 1, industry: '美妆原料', market: '欧洲', period: '近30天', summary: '应关注配方变化。', signals: [
  { title: '新法规', category: '政策', publishedAt: '2026-10-01', fact: '官方发布新规则。', implication: '企业需要评估。', action: '核对产品要求。', sourceTitle: '官方原文', sourceUrl: 'https://example.com/official' },
  { title: '原料进展', category: '技术', publishedAt: '2026-10-02', fact: '发布了新技术。', sourceTitle: '未核验', sourceUrl: 'https://example.com/unverified' },
], limitations: ['样本不足以代表市场。'] });
const sources = [{ title: '官方原文', uri: 'https://example.com/official' }];
test('a brief displays verified facts and original link inline without pretending to be a full report',()=>{
 const value=JSON.parse(raw);value.presentation='brief';
 const html=renderToStaticMarkup(<IndustryInsightReportView raw={JSON.stringify(value)} sources={sources}/>);
 assert.match(html,/精简资讯/);assert.match(html,/官方发布新规则/);assert.match(html,/2026-10-01/);
 assert.match(html,/href="https:\/\/example.com\/official"/);assert.doesNotMatch(html,/阅读完整行业报告|example.com\/unverified/);
});
test('renders evidence and explicitly scoped sample chart without unverified links', () => {
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={raw} sources={sources}/>);
  assert.match(html, /已报道事实/); assert.match(html, /重点主题/); assert.match(html, /建议行动/);
  assert.match(html, /href="https:\/\/example.com\/official"/); assert.doesNotMatch(html, /href="https:\/\/example.com\/unverified"/);
});
test('industry fenced report survives readable and presentation processing and renders via AgentReply', () => {
  const content = `\`\`\`industry-insight\n${raw}\n\`\`\``;
  assert.equal(splitAssistantReply(readableAssistantReply(content), { presentation: 'news' }).summary, content);
  const html = renderToStaticMarkup(<AgentReply content={content} sources={sources} presentation="news"/>);
  assert.match(html, /阅读完整行业报告/); assert.match(html, /专题观察/); assert.doesNotMatch(html, /```industry-insight/);
});
test('incomplete report does not fabricate a chart or links', () => {
  const html = renderToStaticMarkup(<IndustryInsightReportView raw="{" sources={sources}/>);
  assert.match(html, /报告正在整理/); assert.doesNotMatch(html, /本次资讯样本分布/);
});
test('Chinese verified facts lead while original language remains in the source and collapsed evidence', () => {
  const value = JSON.parse(raw);
  value.signals[0].title = 'Supplier announces a new formulation';
  value.signals[0].sourceTitle = 'Supplier announces a new formulation';
  value.signals[0].quote = 'The supplier announced a new formulation.';
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={sources}/>);
  assert.match(html, /<h3[^>]*>官方发布新规则<\/h3>/);
  assert.match(html, /Supplier announces a new formulation/);
  assert.match(html, /查看原文摘录/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /The supplier announced a new formulation/);
});

test('conversation is a compact summary with real counts; complete content is outside the chat card', () => {
  const html = renderToStaticMarkup(<IndustryInsightReportView raw={raw} sources={sources}/>);
  assert.match(html, /阅读完整行业报告/);
  assert.match(html, /1<\/strong> 条核验资讯/);
  assert.match(html, /附数据来源/);
  assert.doesNotMatch(html, /重点行业信号|B2B行动矩阵|新技术|未核验/);
});
test('unretrieved signals and their summary never leak into the report or its chart', () => {
  const value = JSON.parse(raw); value.summary = '发布了未核验的新技术。';
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={sources}/>);
  assert.doesNotMatch(html, /本次资讯样本分布|<canvas/); assert.match(html, /重点主题/); assert.match(html, /B2B行动矩阵/);
  assert.doesNotMatch(html, /发布了未核验的新技术|发布了新技术|href="https:\/\/example.com\/unverified/);
  const coverage = industryInsightCoverage(parseIndustryInsight(raw)!, sources);
  assert.deepEqual(coverage.categories, [['政策', 1]]);
  assert.equal(coverage.signals.length, 1);
});
test('different websites produce a scoped industry report while unsafe links cannot be rendered', () => {
  const value = JSON.parse(raw); value.signals[1].sourceUrl = 'https://association.example/research';
  const html = renderToStaticMarkup(<IndustryInsightReportView raw={JSON.stringify(value)} sources={[...sources,{ title:'协会研究',uri:'https://association.example/research' }]}/>);
  assert.match(html, /专题观察/); assert.match(html, /2<\/strong> 条核验资讯/);
  value.signals[1].sourceUrl = 'javascript:alert(1)'; value.signals[1].fact = '<script>bad()</script>';
  const safe = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={[...sources,{ title:'恶意',uri:'javascript:alert(1)' }]}/>);
  assert.doesNotMatch(safe, /javascript:|<script>|bad\(\)/);
});

test('zero verified sources retain scope and show a clear undelivered state instead of a successful report', () => {
  for (const Component of [IndustryInsightReportView, IndustryInsightReportContents]) {
    const html = renderToStaticMarkup(<Component raw={raw} sources={[]}/>);
    assert.match(html, /未形成报告/); assert.match(html, /本次未取得可交付的资讯原文/);
    assert.match(html, /美妆原料/); assert.match(html, /欧洲/); assert.match(html, /近30天/);
    assert.doesNotMatch(html, /单一网站|核心摘要|本次资讯样本分布|重点行业信号|B2B行动矩阵|<canvas/);
  }
  const card = renderToStaticMarkup(<IndustryInsightReportView raw={raw} sources={[]}/>);
  assert.match(card, /disabled=""/);
});

test('multiple verified themes render the shared chart with actual sample counts and accessible table', () => {
  const value = JSON.parse(raw); value.signals[1].sourceUrl = 'https://association.example/research';
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={[...sources,{ title:'协会研究',uri:'https://association.example/research' }]}/>);
  assert.match(html, /本次资讯样本分布/); assert.match(html, /按主题统计收录资讯条数/); assert.match(html, /查看数据表/);
  assert.doesNotMatch(html, /重点主题/);
});

test('all delivered reports are topical observations and use a single concise footer disclaimer', () => {
  const value = JSON.parse(raw); value.limitations = ['未经证实，仅供参考。','不代表行业全貌，不能据此判断。'];
  value.summary = '关注配方变化。不代表行业全貌。';
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={sources}/>);
  assert.match(html, /专题观察/); assert.match(html, /AI结论仅供参考/); assert.match(html, /来源依据/);
  assert.equal((html.match(/仅供参考/gu) ?? []).length,1);
  assert.doesNotMatch(html,/不代表行业|不能据此|未经证实|经营洞察报告/);
});
const dimUrl = 'https://www.dim.net.cn/75/view-31635-1.html';
const dimMetrics = [
  { label:'全球化妆品原料市场规模',value:940,unit:'亿美元',period:'2025',kind:'reported',sourceUrl:dimUrl,sourceTitle:'全球化妆品原料数据全景洞察报告（2026 DIMRTRD）',quote:'全球化妆品原料市场在2026年预计继续保持增长态势，市场规模预计达到1020亿美元，相较2025年的940亿美元增长8.5%。' },
  { label:'全球化妆品原料市场规模',value:1020,unit:'亿美元',period:'2026',kind:'forecast',sourceUrl:dimUrl,sourceTitle:'全球化妆品原料数据全景洞察报告（2026 DIMRTRD）',quote:'全球化妆品原料市场在2026年预计继续保持增长态势，市场规模预计达到1020亿美元，相较2025年的940亿美元增长8.5%。' },
];
test('DIM actual source metrics preserve units, years and forecast identity in a shared market chart', () => {
  const value = JSON.parse(raw); value.metrics = dimMetrics;
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={[...sources,{ title:'全球化妆品原料数据全景洞察报告（2026 DIMRTRD）',uri:dimUrl }]}/>);
  assert.match(html,/市场数据/); assert.match(html,/全球化妆品原料市场规模（亿美元）/);
  assert.match(html,/2025年 · 报告值/); assert.match(html,/2026年 · 预测/);
  assert.match(html,/940/); assert.match(html,/1,020|1020/); assert.match(html,/数据来源：全球化妆品原料数据全景洞察报告（2026 DIMRTRD）/);
});
test('metrics need original sources and valid finite values, and charts never mix units, publishers or basis', () => {
  const value = JSON.parse(raw); value.metrics = [...dimMetrics,
    { ...dimMetrics[0],unit:'亿元人民币' },{ ...dimMetrics[0],sourceUrl:'https://other.example/report' },
    { ...dimMetrics[0],basis:'仅护肤品原料' },{ ...dimMetrics[0],period:'2025年第一季度' },{ ...dimMetrics[0],value:'940' },{ ...dimMetrics[0],value:null },
  ];
  const report = parseIndustryInsight(JSON.stringify(value))!;
  assert.equal(report.metrics!.length,6);
  assert.equal(industryMetricGroups(report,[...sources,{title:'DIM',uri:dimUrl},{title:'其他研究',uri:'https://other.example/report'}]).length,5);
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={sources}/>);
  assert.doesNotMatch(html,/市场数据|全球化妆品原料市场规模|2026年 · 预测/);
});

test('legacy independent protection sentences disappear while substantive conditional analysis remains', () => {
  const text = '上述内容分别代表企业披露和研究判断，不能视为全行业事实。关于市场规模，证据不足，有待进一步核对。若原料成本持续上升，不能据此推断企业毛利率下降，还应结合渠道费用变化分析。';
  const visible = industryVisibleText(text);
  assert.doesNotMatch(visible,/上述内容|关于市场规模|有待进一步核对/);
  assert.match(visible,/若原料成本持续上升/); assert.match(visible,/渠道费用变化分析/);
});

test('pending industry narrative rows are hidden and real DIM numeric source metrics remain visible', () => {
  const value = JSON.parse(raw);
  value.summary = '市场判断低置信度。';
  value.signals[0].implication = '信号不足，暂无法指导内容制作';
  value.signals[0].action = '待补充配文后再定选题';
  value.signals[0].sourceType = '候选待确认';
  value.metrics = dimMetrics;
  const saved = JSON.stringify(value);
  const html = renderToStaticMarkup(<IndustryInsightReportContents raw={saved} sources={[...sources, { title: 'DIM', uri: dimUrl }]}/>);
  assert.doesNotMatch(html, /低置信|待复核|待确认|业务影响待|海外订单增长|信号不足|暂无法指导|待补充配文/);
  assert.match(html, /940/); assert.match(html, /1,020|1020/); assert.match(html, /2026年 · 预测/);
  assert.equal(JSON.stringify(value), saved);
});


test('the actual evidence-gap sentence disappears from a paragraph while its valid industry conclusions remain', () => {
 const value=JSON.parse(raw);
 value.signals=value.signals.slice(0,1);
 value.summary='监管与技术发布值得企业持续关注。对中小型企业的全球竞争格局及技术转化细节的证据尚存缺口。建议围绕真实技术资料准备客户沟通。';
 const html=renderToStaticMarkup(<IndustryInsightReportContents raw={JSON.stringify(value)} sources={sources}/>);
 assert.doesNotMatch(html,/证据尚存缺口|全球竞争格局及技术转化细节/);
 assert.match(html,/监管与技术发布值得企业持续关注/);
 assert.match(html,/建议围绕真实技术资料准备客户沟通/);
});
