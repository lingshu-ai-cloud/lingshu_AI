import test from 'node:test';
import assert from 'node:assert/strict';
import { extractIndustryMetrics, validateIndustryMetrics } from './industryEvidenceMetrics.js';
import type { SearchOriginal } from './searchEvidenceAnswer.js';
const text = '全球化妆品原料市场在2026年预计继续保持增长态势，市场规模预计达到1020亿美元，相较2025年的940亿美元增长8.5%。';
const original: SearchOriginal = { id: 'S2', source: { title: '全球化妆品原料市场公开研究摘要', uri: 'https://publisher.com/research/cosmetic-ingredients' }, published: ['2026-10-20'], text };
test('market extraction binds comparative years to their own values and keeps source forecast attribution', () => {
 const result = extractIndustryMetrics([original]);
 assert.deepEqual(result.map(metric => [metric.period, metric.value, metric.unit, metric.kind]), [['2026', 1020, '亿美元', 'forecast'], ['2025', 940, '亿美元', 'reported']]);
 assert.ok(result.every(metric => metric.sourceUrl === original.source.uri && metric.quote === text));
 assert.equal(extractIndustryMetrics([{ ...original, text: text + '\n' + text.replaceAll('市场', '市 场') }]).length, 2);
});
test('metric validation rejects wrong years, values, units, source IDs, excerpt IDs and prediction laundering', () => {
 const candidate = { label: '市场规模', period: '2026', value: 1020, unit: '亿美元', kind: 'forecast', sourceId: 'S2', quoteId: 'S2-Q1' };
 const quotes = new Map([['S2', [{ id: 'S2-Q1', text }]]]);
 assert.equal(validateIndustryMetrics([candidate], [original], quotes).length, 1);
 for (const patch of [{ period: '2025' }, { value: 940 }, { value: Infinity }, { value: 102000 }, { unit: '亿元' }, { kind: 'reported' }, { sourceId: 'S999' }, { quoteId: 'S2-Q9' }]) assert.equal(validateIndustryMetrics([{ ...candidate, ...patch }], [original], quotes).length, 0);
 assert.equal(validateIndustryMetrics([candidate], [{ ...original, text: '原文未披露市场规模数值。' }], quotes).length, 0);
});
test('invented geography labels are canonicalized and data without market-size context is ignored', () => {
 const quote = '2026年预计市场规模达到1020亿美元。';
 const source = { ...original, text: quote };
 const candidates = [{ label: '美国市场规模', period: '2026', value: 1020, unit: '亿美元', kind: 'forecast', sourceId: 'S2', quoteId: 'Q1' }];
 assert.equal(validateIndustryMetrics(candidates, [source], new Map([['S2', [{ id: 'Q1', text: quote }]]]))[0].label, '全球化妆品原料市场规模');
 assert.deepEqual(extractIndustryMetrics([{ ...original, text: '公司2026年预计收入1020亿美元。' }]), []);
});

test('packaging and OEM market figures retain their different source subjects across comparison years', () => {
 const packaging = { ...original, id: 'S25', source: { title: '2026美妆包材新趋势:从环保合规到智能包装的源头对接', uri: 'https://www.sohu.com/a/1091522791_122519715' }, text: '据Market Research Reports与多家行业咨询机构联合测算，2026年全球美妆包装市场规模预计将突破580亿美元，年复合增长率维持在4.8%左右。' };
 const oem = { ...original, id: 'S26', source: { title: '2026年全球化妆品代工服务规模约329亿美元 柔性快反成为代工核心竞争力[图]', uri: 'https://www.sohu.com/a/1090619835_120974733' }, text: '二、市场规模：市场规模稳步增长 据共研网（共研产业研究院）数据，2025 年全球化妆品代工服务市场销售额为 317 亿美元，2026 年预计增长至 329 亿美元；在新锐品牌崛起、洁净美妆、功效护肤需求带动下，20262032 年复合增长率 4.2%，预计 2032 年全球市场规模将达到 419 亿美元。' };
 const metrics = extractIndustryMetrics([packaging, oem]);
 assert.deepEqual(metrics.map(({ label, period, value, kind }) => [label, period, value, kind]), [
  ['全球美妆包装市场规模', '2026', 580, 'forecast'],
  ['全球化妆品代工服务市场规模', '2025', 317, 'reported'],
  ['全球化妆品代工服务市场规模', '2026', 329, 'forecast'],
  ['全球化妆品代工服务市场规模', '2032', 419, 'forecast'],
 ]);
 assert.ok(metrics.every(metric => [packaging.source.uri, oem.source.uri].includes(metric.sourceUrl)));
});
