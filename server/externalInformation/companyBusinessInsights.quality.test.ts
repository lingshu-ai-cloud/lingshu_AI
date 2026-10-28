import assert from 'node:assert/strict';
import test from 'node:test';
import { companyReportSchema, type CompanyReport } from '../../shared/contracts/companyReport.js';
import { parseMessages } from '../routes/assistantThreadMessageInput.js';

function legacyReport(): CompanyReport {
  const cited = { text: '公司持续开发新原料和客户，客户采用情况应与下一期披露核对。', evidenceIds: ['P12'] };
  return companyReportSchema.parse({
    id: `cr_${'a'.repeat(24)}`, company: '华熙生物', companyId: 'bloomage', period: '2026年半年度',
    generatedAt: '2026-10-28T00:00:00.000Z', status: 'partial',
    source: { title: '华熙生物2026年半年度报告', url: 'https://static.cninfo.com.cn/finalpage/2026-08-28/report.PDF',
      publishedAt: '2026-08-28', fetchedAt: '2026-10-28T00:00:00.000Z', sha256: 'b'.repeat(64), pages: 204, audited: false, latestVerified: false },
    metrics: ['revenue', 'profit', 'core-profit', 'cashflow'].map((id, index) => ({ id, label: ['营业收入', '归母净利润', '扣非净利润', '经营现金流'][index],
      current: '1000000.00', previous: '2000000.00', unit: '元人民币', changePct: '-50.00', page: 6, excerpt: '财报原表披露本期和上年同期对应金额。' })),
    evidence: [6, 12, 41].map(page => ({ id: `P${page}`, page, text: '华熙生物持续开发新原料和客户，公司披露的计划尚需后续核对执行结果。' })),
    analysis: { headline: '经营变化需要与业务结构共同观察', conclusion: cited,
      sections: ['整体经营', '业务结构', '研发投入'].map(title => ({ title, observation: { ...cited, quote: cited.text } })),
      watchpoints: ['客户采用', '产品转化', '费用变化'].map(text => ({ ...cited, text, verifyWith: '核对下一期财报的实际披露。' })) },
    limitations: ['财务数字依据指定半年报。'],
  });
}

test('pre-insights financial reports remain valid and persist as assistant-only conversation data', () => {
  const report = legacyReport();
  assert.equal('businessInsights' in report, false);
  const messages = parseMessages([{ role: 'assistant', content: '历史财报解读', companyReport: report }]);
  assert.deepEqual((messages[0] as { companyReport: CompanyReport }).companyReport, report);
  assert.throws(() => parseMessages([{ role: 'user', content: '伪造经营洞察', companyReport: report }]));
});

import { companyBusinessOriginals, companyBusinessPeriod, generateCompanyBusinessInsights } from './companyBusinessInsights.js';
import { COMPANY_REPORT_CATALOG } from './companyReportCatalog.js';
import type { SearchOriginal } from './searchEvidenceAnswer.js';
const now = new Date('2026-10-28T00:00:00.000Z');
const target = COMPANY_REPORT_CATALOG[0];
const body = '华熙生物宣布与合作伙伴开展原料技术合作，双方计划共同进行配方研究，项目实际进度以公司后续披露为准。'.repeat(6);
function original(date = '2026-10-20', overrides: Partial<SearchOriginal> = {}): SearchOriginal {
  return { id: 'S1', source: { title: '华熙生物宣布原料技术合作', uri: 'https://www.bloomagebiotech.com/news/cooperation.html' }, published: [date], text: body, ...overrides };
}
function synthesis() {
  return {
    events: [{ id: 'E1', title: '宣布原料技术合作', date: '2026-10-20', category: 'partnership', sourceIds: ['C1'],
      quote: '华熙生物宣布与合作伙伴开展原料技术合作', summary: '华熙生物宣布与合作伙伴开展原料技术合作，双方计划共同进行配方研究。' }],
    judgments: [{ title: '客户转化需要继续观察', text: '财报研发披露与近期合作动作提示公司可能继续推进原料应用，实际客户采用仍需验证。', financialEvidenceIds: ['P12'], sourceIds: ['C1'] }],
    actions: [{ audience: '原料商', text: '建议围绕配方应用提供技术资料并核对实际合作需求。', verifyWith: '准备供应链稳定性、工厂资质和技术文档，核对客户采用证据。', financialEvidenceIds: ['P12'], sourceIds: ['C1'] }],
  };
}

test('recent public observation has ninety China-calendar dates independently of selected H1 and excludes future sources', () => {
  assert.deepEqual(companyBusinessPeriod(now), { from: '2026-07-31', to: '2026-10-28' });
  assert.deepEqual(companyBusinessPeriod(new Date('2026-10-28T16:30:00Z')), { from: '2026-08-01', to: '2026-10-29' });
  for (const date of ['2026-07-30', '2026-10-29', '2026-02-30', '', '2025-10-20']) {
    assert.equal(companyBusinessOriginals([original(date)], target, now).length, 0, date);
  }
  assert.equal(companyBusinessOriginals([original('2026-07-31')], target, now).length, 1);
  assert.equal(companyBusinessOriginals([original('2026-10-28')], target, now).length, 1);
});

test('source selection rejects scripts, unrelated companies, unsafe addresses and duplicate republications', () => {
  const accepted = original();
  const sources = [accepted,
    original('2026-10-20', { source: { ...accepted.source, uri: accepted.source.uri + '?utm_source=copy' } }),
    original('2026-10-20', { source: { ...accepted.source, uri: 'https://media.example.com/reprint' } }),
    original('2026-10-20', { source: { title: '合作消息转载换了一个标题', uri: 'https://other.example.com/reprint-different-title' } }),
    original('2026-10-20', { text: '另一家公司开展生产和研发合作。'.repeat(20) }),
    original('2026-10-20', { text: `<script>${body}</script>` }),
    original('2026-10-20', { source: { title: '脚本页面', uri: 'javascript:alert(1)' } }),
    original('2026-10-20', { source: { title: '内网页面', uri: 'https://127.0.0.1/private' } }),
    original('2026-10-20', { source: { title: '凭据页面', uri: 'https://secret:password@media.example.com/article' } }),
  ];
  assert.deepEqual(companyBusinessOriginals(sources, target, now), [accepted]);
});

test('zero qualifying originals allow one bounded supplemental discovery but no model synthesis', async () => {
  let searches = 0, reads = 0, calls = 0;
  const result = await generateCompanyBusinessInsights(target, legacyReport(), {
    now,
    search: async () => { searches++; return { text: '', sources: [original().source] }; },
    originals: async () => { reads++; return { originals: [original('2026-07-30')], rejected: 0, rejectionReasons: {} }; },
    analyze: async () => { calls++; throw Error('No usable original must not trigger synthesis'); },
  });
  assert.deepEqual([searches, reads, calls], [2, 2, 0]);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.judgments, []);
});

test('one source can support qualified insight without pretending corroboration and cannot replace financial numbers', async () => {
  const report = legacyReport(), before = structuredClone(report);
  let calls = 0;
  const result = await generateCompanyBusinessInsights(target, report, {
    now, search: async () => ({ text: '', sources: [original().source] }),
    originals: async () => ({ originals: [original()], rejected: 0, rejectionReasons: {} }),
    analyze: async () => { calls++; return JSON.stringify(synthesis()); },
  });
  assert.equal(calls, 1); assert.equal(result.status, 'ready');
  assert.equal(result.sources.length, 1);
  assert.equal(result.events[0].date, '2026-10-20');
  assert.equal(result.actions[0].audience, '原料商');
  assert.deepEqual(report, before);
  const combined = companyReportSchema.parse({ ...report, businessInsights: result });
  assert.equal(combined.period, '2026年半年度');
  assert.equal(combined.businessInsights?.observationPeriod.from, '2026-07-31');
  assert.deepEqual(combined.metrics, before.metrics);
  assert.throws(() => companyReportSchema.parse({ ...combined, businessInsights: { ...result,
    judgments: [{ ...result.judgments[0], financialEvidenceIds: ['P999'] }] } }));
  assert.throws(() => companyReportSchema.parse({ ...combined, businessInsights: { ...result,
    events: [{ ...result.events[0], sourceIds: ['C999'] }] } }));
});

test('unsupported quotations, invented financial citations and multi-source certainty are never published', async () => {
  for (const mutate of [
    (draft: ReturnType<typeof synthesis>) => { draft.events[0].quote = '华熙生物合作已实现收入并证明量产成功'; },
    (draft: ReturnType<typeof synthesis>) => { draft.events[0].title = '合作带动收入增长999%'; },
    (draft: ReturnType<typeof synthesis>) => { draft.judgments[0].title = '合作必然带动收入增长999%'; },
    (draft: ReturnType<typeof synthesis>) => { draft.judgments[0].financialEvidenceIds = ['P999']; },
    (draft: ReturnType<typeof synthesis>) => { draft.judgments[0].text = '多来源交叉核验已经证明合作必然带来新增收入。'; },
  ]) {
    const draft = synthesis(); mutate(draft);
    const result = await generateCompanyBusinessInsights(target, legacyReport(), { now,
      search: async () => ({ text: '', sources: [original().source] }),
      originals: async () => ({ originals: [original()], rejected: 0, rejectionReasons: {} }),
      analyze: async () => JSON.stringify(draft),
    });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.judgments.length, 0);
  }
});

test('stored insight boundaries reject private, credential and signed source links and orphan event quotes', async () => {
  const report = legacyReport();
  const draft = synthesis();
  const quote = draft.events[0].quote;
  const insights = { observationPeriod: companyBusinessPeriod(now), status: 'ready',
    sources: [{ id: 'C1', title: '华熙生物原料技术合作', url: original().source.uri, publishedAt: '2026-10-20', excerpt: body }], ...draft };
  assert.equal(companyReportSchema.safeParse({ ...report, businessInsights: insights }).success, true);
  for (const url of ['javascript:alert(1)', 'https://user:password@publisher.example/news', 'https://localhost/private',
    'https://127.0.0.1/private', 'https://10.2.3.4/private', 'https://[::1]/private', 'https://0x7f000001/private',
    'https://www.bloomagebiotech.com/news?token=secret', 'https://www.bloomagebiotech.com/news?X-Amz-Signature=secret']) {
    const candidate = { ...insights, sources: [{ ...insights.sources[0], url }] };
    assert.equal(companyReportSchema.safeParse({ ...report, businessInsights: candidate }).success, false, url);
  }
  assert.equal(companyReportSchema.safeParse({ ...report, businessInsights: { ...insights,
    events: [{ ...draft.events[0], quote: quote + '不存在的原文内容' }] } }).success, false);
});

test('insight audit distinguishes model-empty evidence from reference and numeric rejections without relaxing checks', async () => {
 for (const [change, reason] of [
  [(draft: ReturnType<typeof synthesis>) => { draft.events[0].quote = '华熙生物合作已经成功实现大规模量产收入'; }, 'quote_mismatch'],
  [(draft: ReturnType<typeof synthesis>) => { draft.judgments[0].financialEvidenceIds = ['P999']; }, 'financial_reference_invalid'],
  [(draft: ReturnType<typeof synthesis>) => { draft.events[0].title = '合作新增999项原料'; }, 'insight_number_unsupported'],
 ] as const) {
  const draft = synthesis(); change(draft);
  const traces: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit[] = [];
  const result = await generateCompanyBusinessInsights(target, legacyReport(), { now,
   search: async () => ({ text: '', sources: [original().source] }),
   originals: async () => ({ originals: [original()], rejected: 0, rejectionReasons: {} }),
   analyze: async () => JSON.stringify(draft), audit: audit => { traces.push(audit); },
  });
  assert.equal(result.status, 'unavailable');
  const last = traces.at(-1)!;
  assert.equal(last.stage, 'insufficient_supported_insights');
  assert.equal(last.candidateCount, 2); assert.equal(last.originalCount, 2);
  assert.equal(last.raw, JSON.stringify(draft));
  assert.ok(last.rejections.some(item => item.reason === reason));
  assert.ok(!traces[0].raw, 'earlier audit snapshots cannot mutate after capture');
 }
});

test('insight audit retains raw structural failure and no-original stopping stage', async () => {
 const traces: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit[] = [];
 const options = { now, search: async () => ({ text: '', sources: [original().source] }),
  originals: async () => ({ originals: [original()], rejected: 0, rejectionReasons: {} }),
  analyze: async () => '{invalid', audit: (audit: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit) => { traces.push(audit); } };
 await assert.rejects(generateCompanyBusinessInsights(target, legacyReport(), options));
 assert.equal(traces.at(-1)?.stage, 'synthesis_invalid');
 assert.equal(traces.at(-1)?.raw, '{invalid'); assert.equal(traces.at(-1)?.error, 'invalid_json');
 const result = await generateCompanyBusinessInsights(target, legacyReport(), { ...options,
  originals: async () => ({ originals: [], rejected: 1, rejectionReasons: { unreadable: 1 } }) });
 assert.equal(result.status, 'unavailable'); assert.equal(traces.at(-1)?.stage, 'no_qualifying_originals');
});

test('company discovery filters unusable provider hits and supplemental failure preserves verified first-pass evidence', async () => {
 let searches = 0, analyses = 0;
 const budgets: unknown[] = [];
 const result = await generateCompanyBusinessInsights(target, legacyReport(), { now,
  search: async messages => {
   searches++;
   if (searches === 2) { assert.match(String(messages[0].content), /补充调查|产品发布/); throw Error('supplemental search unavailable'); }
   return { text: '', sources: [original().source,
    { title: '{"code":0,"strategy_result":{', uri: 'https://media.publisher.com/blocked-json' },
    { title: '华熙生物', uri: 'https://finance.sina.com.cn/realstock/company/sh688363/nc.shtml' },
    { title: '某基金2026年第3季度报告', uri: 'https://fund.publisher.com/quarterly.html' },
    { title: '华熙生物企业动态', uri: 'https://www.douyin.com/note/123' },
   ] };
  },
  originals: async (sources, options) => { assert.deepEqual(sources, [original().source]); budgets.push(options?.articleRequestBudget); return { originals: [original()], rejected: 0, rejectionReasons: {} }; },
  analyze: async () => { analyses++; return JSON.stringify(synthesis()); },
 });
 assert.equal(result.status, 'ready'); assert.equal(searches, 2); assert.equal(analyses, 1);
 assert.deepEqual(budgets, [{ remaining: 24 }]);
});

test('sufficient distinct business articles skip supplementation; cancellation never triggers extra search', async () => {
 let searches = 0;
 const originals = ['one', 'two', 'three'].map((id, index) => original('2026-10-20', { id,
  source: { title: '华熙生物原料技术合作' + id, uri: 'https://publisher'+index+'.com/news/cooperation' }, text: body + id }));
 const result = await generateCompanyBusinessInsights(target, legacyReport(), { now,
  search: async () => { searches++; return { text: '', sources: originals.map(item => item.source) }; },
  originals: async () => ({ originals, rejected: 0, rejectionReasons: {} }), analyze: async () => JSON.stringify(synthesis()),
 });
 assert.equal(searches, 1); assert.equal(result.status, 'ready');
 const controller = new AbortController(); searches = 0;
 await assert.rejects(generateCompanyBusinessInsights(target, legacyReport(), { now, signal: controller.signal,
  search: async () => { searches++; controller.abort(Error('cancelled')); throw controller.signal.reason; },
 }), /cancelled/);
 assert.equal(searches, 1);
});

test('both discovery rounds share the same twenty-four request read budget and synthesize only once', async () => {
 const budgets: unknown[] = []; let searches = 0, calls = 0;
 const result = await generateCompanyBusinessInsights(target, legacyReport(), { now,
  search: async () => { searches++; return { text: '', sources: [original().source] }; },
  originals: async (_sources, options) => { budgets.push(options?.articleRequestBudget); return { originals: [original()], rejected: 0, rejectionReasons: {} }; },
  analyze: async () => { calls++; return JSON.stringify(synthesis()); },
 });
 assert.equal(result.status, 'ready'); assert.equal(searches, 2); assert.equal(calls, 1);
 assert.equal(budgets[0], budgets[1]); assert.deepEqual(budgets[0], { remaining: 24 });
});

test('third real Proya synthesis preserves sourced event days and independent selected sources while rejecting sole-superiority claim', async () => {
 const fs = await import('node:fs/promises');
 const audit = JSON.parse(await fs.readFile(new URL('./fixtures/proya-business-event-date-replay.json', import.meta.url), 'utf8'));
 const proya = COMPANY_REPORT_CATALOG.find(item => item.id === 'proya')!;
 let trace: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit | undefined;
 const options = { now, search: async () => ({ text: '', sources: audit.originals.map((item: SearchOriginal) => item.source) }),
  originals: async () => ({ originals: audit.originals, rejected: 0, rejectionReasons: {} }), analyze: async () => audit.raw,
  audit: (value: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit) => { trace = value; } };
 const rejectedDirection = await generateCompanyBusinessInsights(proya, audit.financial, options);
 assert.equal(rejectedDirection.status, 'unavailable'); // The raw historical title and prose incorrectly call the same-period ratio a decline.
 const supported = JSON.parse(audit.raw);
 supported.judgments[0].title = 'PSTC科技大会与研发投入形成转化观察窗口';
 supported.judgments[0].text = supported.judgments[0].text.replace('研发费用率同比下降', '研发费用率同比上升');
 const result = await generateCompanyBusinessInsights(proya, audit.financial, { ...options, analyze: async () => JSON.stringify(supported) });
 assert.equal(result.status, 'ready');
 assert.deepEqual(result.events.filter(event => ['E1', 'E2'].includes(event.id)).map(event => event.date), ['2026-08-25', '2026-08-25']);
 assert.equal(result.sources.find(source => source.id === 'C1')?.publishedAt, '2026-08-26');
 assert.equal(result.sources.find(source => source.id === 'C2')?.publishedAt, '2026-09-01');
 assert.equal(result.judgments.length, 1); assert.deepEqual(result.judgments[0].sourceIds, ['C1', 'C2']);
 assert.ok(trace?.rejections.some(item => item.kind === 'judgment' && item.index === 1 && item.reason === 'unsupported_certainty'));
 const invalid = JSON.parse(audit.raw); invalid.judgments[0].sourceIds.push('C999');
 assert.equal((await generateCompanyBusinessInsights(proya, audit.financial, { ...options, analyze: async () => JSON.stringify(invalid) })).status, 'unavailable');
 const noEvents = { ...JSON.parse(audit.raw), events: [] };
 assert.equal((await generateCompanyBusinessInsights(proya, audit.financial, { ...options, analyze: async () => JSON.stringify(noEvents) })).status, 'unavailable');
});

test('latest real synthesis retains grounded J1 with verified half-year bounds while removing unsupported comparisons and action requirements', async () => {
 const fs = await import('node:fs/promises');
 const audit = JSON.parse(await fs.readFile(new URL('./fixtures/proya-business-sentence-replay.json', import.meta.url), 'utf8'));
 const proya = COMPANY_REPORT_CATALOG.find(item => item.id === 'proya')!;
 const result = await generateCompanyBusinessInsights(proya, audit.financial, { now,
  search: async () => ({ text: '', sources: audit.originals.map((item: SearchOriginal) => item.source) }),
  originals: async () => ({ originals: audit.originals, rejected: 0, rejectionReasons: {} }), analyze: async () => audit.raw,
 });
 assert.equal(result.status, 'ready');
 assert.ok(result.judgments.some(item => item.title.startsWith('红宝石/源力4.0') && item.text.includes('2026-06-30')));
 assert.ok(!result.judgments.some(item => /4.63%|0.24%|唯一/u.test(item.text)));
 assert.ok(!result.actions.some(item => item.verifyWith.includes('48小时')));
 assert.ok(!result.events.some(item => item.id === 'E1'), 'legacy concatenated quote remains rejected');
});

test('new event quote IDs materialize only a continuous excerpt bound to the referenced source', async () => {
 const { searchOriginalExcerpts } = await import('./searchEvidenceAnswer.js');
 const excerpt = searchOriginalExcerpts({ ...original(), id: 'C1' }, 6000)[0];
 const draft = synthesis(); const event = { ...draft.events[0], quoteId: excerpt.id } as Record<string, unknown>; delete event.quote;
 const options = { now, search: async () => ({ text: '', sources: [original().source] }),
  originals: async () => ({ originals: [original()], rejected: 0, rejectionReasons: {} }),
 };
 const oldModel = process.env.QWEN_NEWS_ANALYSIS_MODEL; process.env.QWEN_NEWS_ANALYSIS_MODEL = 'qwen3.8-max';
 try {
  const result = await generateCompanyBusinessInsights(target, legacyReport(), { ...options, analyze: async (prompt, opts) => {
   assert.match(prompt, /quoteId/); assert.match(prompt, /C1-Q1/); assert.equal(opts?.model, 'qwen3.8-max');
   return JSON.stringify({ ...draft, events: [event] });
  } });
  assert.equal(result.status, 'ready'); assert.equal(result.events[0].quote, excerpt.text);
  assert.equal('quoteId' in result.events[0], false);
  for (const quoteId of ['C2-Q1', 'C1-Q999']) assert.equal((await generateCompanyBusinessInsights(target, legacyReport(), { ...options,
   analyze: async () => JSON.stringify({ ...draft, events: [{ ...event, quoteId }] }),
  })).status, 'unavailable');
 } finally { if (oldModel === undefined) delete process.env.QWEN_NEWS_ANALYSIS_MODEL; else process.env.QWEN_NEWS_ANALYSIS_MODEL = oldModel; }
});

test('sentence filtering cannot launder wrong comparisons, arbitrary dates or a calendar year into an amount', async () => {
 for (const text of ['提示4.63%低于营收增速0.24%，可能需要继续观察。', '提示公司可能已取得2026元收入。', '提示公司可能在2026-06-29签约。']) {
  const draft = synthesis(); draft.judgments[0].text = text;
  assert.equal((await generateCompanyBusinessInsights(target, legacyReport(), { now,
   search: async () => ({ text: '', sources: [original().source] }),
   originals: async () => ({ originals: [original('2026-10-20', { text: body + '2026年增长4.63%和0.24%。' })], rejected: 0, rejectionReasons: {} }),
   analyze: async () => JSON.stringify(draft),
  })).status, 'unavailable', text);
 }
});

test('synthesis timeout keeps an explicit unknown paid outcome and never retries or leaks the private error', async () => {
 let calls = 0; let audit: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit | undefined;
 await assert.rejects(generateCompanyBusinessInsights(target, legacyReport(), { now,
  search: async () => ({ text: '', sources: [original().source] }),
  originals: async () => ({ originals: [original()], rejected: 0, rejectionReasons: {} }),
  analyze: async (_prompt, options) => { calls++; assert.equal(options?.timeoutMs, 90000); assert.equal(options?.deepThinking, false); assert.equal(options?.maxRetries, 0); throw Error('qwen LLM request timed out after 90s PRIVATE_CREDENTIAL_DETAIL'); },
  audit: value => { audit = value; },
 }), { code: 'company_insights_timeout' });
 assert.equal(calls, 1); assert.equal(audit?.stage, 'failed');
 assert.deepEqual(audit?.failure, { code: 'company_insights_timeout', phase: 'synthesis_requested', requestOutcome: 'unknown', automaticRetry: false, timeoutKind: 'request', timeoutMs: 90000 });
 assert.ok(!JSON.stringify(audit).includes('PRIVATE_CREDENTIAL_DETAIL'));
});

test('overall workflow deadline cancels discovery with a safe phase receipt and no supplemental retry', async () => {
 let calls = 0; let audit: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit | undefined;
 await assert.rejects(generateCompanyBusinessInsights(target, legacyReport(), { now, workflowTimeoutMs: 5,
  search: async (_messages, options) => { calls++; return new Promise((_resolve, reject) => {
   const timer = setTimeout(() => reject(Error('fixture unexpectedly outlived deadline')), 100);
   options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal?.reason); }, { once: true });
  }); }, audit: value => { audit = value; },
 }), { code: 'company_insights_timeout' });
 assert.equal(calls, 1); assert.equal(audit?.failure?.phase, 'discovery_requested');
 assert.equal(audit?.failure?.requestOutcome, 'unknown'); assert.equal(audit?.failure?.automaticRetry, false);
 assert.equal(audit?.failure?.timeoutKind, 'workflow'); assert.equal(audit?.failure?.timeoutMs, 5);
});

test('real Qwen3 schema metadata is ignored only at root and metric references resolve to their actual financial pages', async () => {
 const fs = await import('node:fs/promises');
 const audit = JSON.parse(await fs.readFile(new URL('./fixtures/proya-business-schema-meta-replay.json', import.meta.url), 'utf8'));
 const proya = COMPANY_REPORT_CATALOG.find(item => item.id === 'proya')!;
 let trace: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit | undefined;
 const options = { now, search: async () => ({ text: '', sources: audit.originals.map((item: SearchOriginal) => item.source) }),
  originals: async () => ({ originals: audit.originals, rejected: 0, rejectionReasons: {} }), analyze: async () => audit.raw,
  audit: (value: import('./companyBusinessInsights.js').CompanyBusinessInsightsAudit) => { trace = value; } };
 const result = await generateCompanyBusinessInsights(proya, audit.financial, options);
 assert.equal(result.status, 'ready'); assert.ok(result.events.length); assert.ok(result.judgments.length);
 assert.ok(result.judgments.every(item => item.financialEvidenceIds.every(id => /^P\d+$/u.test(id))));
 assert.ok(result.judgments.some(item => item.title.includes('研发叙事')));
 assert.ok(result.judgments.find(item => item.title.includes('研发叙事'))?.text.includes('百分之十三点八零'));
 assert.ok(trace?.rejections.some(item => item.kind === 'event' && item.index === 1));
 assert.ok(!result.judgments.some(item => item.text.includes('百分之七十四点九五')));
 for (const patch of [{ extra: true }, { $id: 'unexpected' }]) await assert.rejects(generateCompanyBusinessInsights(proya, audit.financial, { ...options, analyze: async () => JSON.stringify({ ...JSON.parse(audit.raw), ...patch }) }));
 const nested = JSON.parse(audit.raw); nested.events[0].$schema = 'unexpected';
 await assert.rejects(generateCompanyBusinessInsights(proya, audit.financial, { ...options, analyze: async () => JSON.stringify(nested) }));
 const unknown = JSON.parse(audit.raw); unknown.judgments.forEach((item: { financialEvidenceIds: string[] }) => { item.financialEvidenceIds = ['unknown-metric']; });
 assert.equal((await generateCompanyBusinessInsights(proya, audit.financial, { ...options, analyze: async () => JSON.stringify(unknown) })).status, 'unavailable');
});
