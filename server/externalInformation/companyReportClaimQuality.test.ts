import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCompanyMetrics, validateCompanyAnalysis } from './companyReportEvidence.js';
import type { CompanyAnalysis } from '../../shared/contracts/companyReport.js';
import { readFile } from 'node:fs/promises';

const evidence = [
 { id: 'P10', page: 10, text: '类别 2026H1同期增减(%) 2025比上年同期增减(%) 2024比上年同期增减(%)\n护肤类 39.10 -6.87 -9.28 19.31\n美容彩妆类 8.97 7.15 14.86 21.96\n洗护类 5.60 74.95 117.85 79.41' },
 { id: 'P23', page: 23, text: '海外智能对账平台等的推进，有力推进业务效率提升。通过AI夜校、AI视频培训和OpenClaw Agent实践，让管理层和业务团队理解和使用AI。' },
 { id: 'P8', page: 8, text: '珀莱雅品牌线上线下全渠道协同销售。其他部分品牌以线上为主要销售渠道。' },
];
function check(text: string, evidenceIds = ['P10']) {
 validateCompanyAnalysis({ headline: '经营变化与业务布局', conclusion: { text, evidenceIds }, sections: [], watchpoints: [] } as CompanyAnalysis, evidence, []);
}

test('mixed H1 and annual columns do not prove a continuous two-year trend or last-year interim comparison', () => {
 for (const text of ['护肤类连续两年负增长。', '护肤类持续承压。', '洗护类翻倍式增长。', '彩妆增速放缓至7.15%，低于2025年同期14.86%。']) assert.throws(() => check(text), /同口径|上半年|增长倍数/);
 assert.doesNotThrow(() => check('护肤类本期同比下降6.87%；洗护类本期同比增长74.95%。'));
 assert.doesNotThrow(() => check('若营销成本持续增加，可能影响盈利。后续需要核对费用是否持续增长。'));
});

test('selected overseas and AI paragraphs cannot prove exhaustive absence or exclusive application scope', () => {
 for (const text of [
  '报告未披露任何海外业务收入、出口数据或国际化进展。',
  '暂无国际收入披露。', '未披露海外收入或动作。',
  'AI应用限于AI夜校、AI视频培训及OpenClaw Agent实践。',
  'AI投入集中于内部提效而非研发或供应链智能化。',
  'AI聚焦组织提效而非产品转化。',
  'AI应用处于组织能力建设阶段，尚未触及研发核心',
  '尚未形成对原料筛选、配方优化或产能调度的实质性赋能。',
 ]) assert.throws(() => check(text, ['P23']), /局部/);
 assert.doesNotThrow(() => check('公司披露开展AI夜校与AI视频培训，并推进海外智能对账平台。', ['P23']));
});

test('brand-wide channel claims and financial misconduct accusations require explicit evidence', () => {
 assert.throws(() => check('各品牌均以线上为主要销售渠道。', ['P8']), /所有品牌/);
 assert.throws(() => check('全品牌强依赖线上。', ['P8']), /所有品牌/);
 assert.throws(() => check('公司依赖非经常性损益粉饰利润。', ['P23']), /指控/);
 assert.doesNotThrow(() => check('珀莱雅品牌采用线上线下全渠道协同销售。', ['P8']));
});

test('an explicitly disclosed continuous trend can still be quoted without blanket removal', () => {
 const claim = '护肤类连续两年负增长';
 assert.doesNotThrow(() => validateCompanyAnalysis({ headline: '业务变化', conclusion: { text: claim, evidenceIds: ['P1'] }, sections: [], watchpoints: [] } as CompanyAnalysis,
  [{ id: 'P1', page: 1, text: claim + '，公司按可比年度口径披露。' }], []));
});

test('persisted Proya replay catches confirmed unsupported claims while retaining exact reported comparison', async () => {
 const saved = JSON.parse(await readFile(new URL('./fixtures/proya-seven-reference-replay.json', import.meta.url), 'utf8'));
 const metrics = saved.metrics ?? extractCompanyMetrics(saved.evidence);
 const analysis = (text: string, evidenceIds: string[]) => ({ headline: '经营变化与业务布局', conclusion: { text, evidenceIds }, sections: [], watchpoints: [] } as CompanyAnalysis);
 for (const text of ['护肤类连续两年负增长。', '洗护类翻倍式增长。', '彩妆增速低于2025年同期14.86%。']) assert.throws(() => validateCompanyAnalysis(analysis(text, ['P10']), saved.evidence, metrics));
 for (const text of ['报告未披露任何海外业务收入、出口数据或国际化进展。', 'AI应用限于AI夜校、AI视频培训。']) assert.throws(() => validateCompanyAnalysis(analysis(text, ['P23']), saved.evidence, metrics));
 assert.doesNotThrow(() => validateCompanyAnalysis(analysis('洗护类同比增长74.95%。', ['P10']), saved.evidence, metrics));
});

test('integrated business judgments and actions remove unsupported trend clauses without discarding supported siblings', async () => {
 const { generateCompanyBusinessInsights } = await import('./companyBusinessInsights.js');
 const { COMPANY_REPORT_CATALOG } = await import('./companyReportCatalog.js');
 const target = COMPANY_REPORT_CATALOG.find(item => item.id === 'proya')!;
 const quote = '珀莱雅宣布与合作伙伴开展原料技术合作';
 const original = { id: 'S1', source: { title: '珀莱雅原料技术合作', uri: 'https://www.proya.com/news/cooperation.html' }, text: (quote + '，双方计划共同进行配方研究，实际进度以公司后续披露为准。').repeat(5), published: ['2026-10-20'] };
 const report = await generateCompanyBusinessInsights(target, { metrics: [], evidence, analysis: { headline: '经营变化与业务布局', conclusion: { text: '公司披露配方研究与经营变化。', evidenceIds: ['P10'] }, sections: [], watchpoints: [] } } as Parameters<typeof generateCompanyBusinessInsights>[1], {
  now: new Date('2026-10-28T00:00:00Z'), search: async () => ({ text: '', sources: [original.source] }),
  originals: async () => ({ originals: [original], rejected: 0, rejectionReasons: {} }),
  analyze: async () => JSON.stringify({
   events: [{ id: 'E1', title: '宣布原料技术合作', date: '2026-10-20', category: 'partnership', sourceIds: ['C1'], quote, summary: '珀莱雅宣布与合作伙伴开展原料技术合作。' }],
   judgments: [
    { title: '合作应用需要继续观察', text: '护肤类连续负增长。财报与合作动作提示可能需要观察客户采用。', financialEvidenceIds: ['P10'], sourceIds: ['C1'] },
    { title: 'AI应用处于组织能力建设阶段，尚未触及研发核心', text: '合作动作可能有助于技术研发。', financialEvidenceIds: ['P10'], sourceIds: ['C1'] },
   ],
   actions: [{ audience: '原料商', text: '建议围绕配方合作提供技术资料。推广费持续增加。', verifyWith: '准备配方验证与客户采用证据。', financialEvidenceIds: ['P10'], sourceIds: ['C1', 'P10'] }],
  }),
 });
 assert.equal(report.status, 'ready');
 assert.equal(report.judgments[0].text, '财报与合作动作提示可能需要观察客户采用。');
 assert.equal(report.judgments.length, 1);
 assert.equal(report.actions[0].text, '建议围绕配方合作提供技术资料。');
 assert.deepEqual(report.actions[0].sourceIds, ['C1']);
 assert.deepEqual(report.actions[0].financialEvidenceIds, ['P10']);
 assert.doesNotMatch(JSON.stringify(report), /连续负增长|持续增加/);
});
