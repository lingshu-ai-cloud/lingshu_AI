import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import type { CompanyReport } from '../../shared/contracts/companyReport.js';
import { assertCompanyFinancialRatioDirection } from './companyFinancialRatioDirection.js';
import { extractCompanyMetrics, validateCompanyAnalysis } from './companyReportEvidence.js';
const row = (label: string, current: string, previous: string, page = 1): CompanyReport['metrics'][number] => ({ id: label, label, current, previous, page, unit: '元人民币', changePct: '0', excerpt: '同表本期与上年同期金额。' });
const ratio = (current: string, previous: string, revenue = ['1000', '1000']) => [row('营业收入', revenue[0], revenue[1]), row('研发费用', current, previous)];

test('direction comes from comparable expense divided by revenue, not the change in expense alone', () => {
 for (const label of ['销售费用', '管理费用', '研发费用', '财务费用']) {
  const rows = [row('营业收入', '500', '1000'), row(label, '90', '100')];
  assert.doesNotThrow(() => assertCompanyFinancialRatioDirection(`${label}率同比上升。`, rows, ['P1']));
  assert.throws(() => assertCompanyFinancialRatioDirection(`${label}率微降。`, rows, ['P1']), /同比方向/);
 }
 assert.throws(() => assertCompanyFinancialRatioDirection('研发费用率提升。', ratio('120', '100', ['2000', '1000']), ['P1']), /同比方向/);
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用率下降。', ratio('120', '100', ['2000', '1000']), ['P1']));
});

test('gross-margin direction is recomputed from revenue and cost on the same period basis', () => {
 const rows = [row('营业收入', '1000', '1000'), row('营业成本', '200', '300')];
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('销售毛利率提升至八成。', rows, ['P1']));
 assert.throws(() => assertCompanyFinancialRatioDirection('毛利率同比回落。', rows, ['P1']), /同比方向/);
});

test('direction validation covers titles, comma-delimited prose and stable ratios without confusing adjacent ratio labels', () => {
 const rows = [...ratio('20', '10'), row('管理费用', '10', '20')];
 for (const text of ['研发费用率微降', '研发费用率为百分之二，同比下降。', '研发费用率降至百分之二']) assert.throws(() => assertCompanyFinancialRatioDirection(text, rows, ['P1']), /同比方向/);
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用率提升，管理费用率下降。', rows, ['P1']));
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用率为百分之二，且扣非净利润同比下降。', rows, ['P1']));
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用率保持稳定。', ratio('10', '10'), ['P1']));
 assert.throws(() => assertCompanyFinancialRatioDirection('研发费用率保持稳定。', ratio('20', '10'), ['P1']), /同比方向/);
 assert.throws(() => assertCompanyFinancialRatioDirection('研发费用绝对值微增但费用率下降', ratio('99429488.73', '95025833.06', ['5374800725.36', '5361890476.66']), ['P23']), /同比方向/);
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用绝对值微增但费用率提升', ratio('99429488.73', '95025833.06', ['5374800725.36', '5361890476.66']), ['P23']));
});

test('conditional scenarios, separate legal entities, explicit annual comparisons and missing period evidence are not relabelled', () => {
 const rows = ratio('20', '10');
 for (const text of ['若研发费用率下降，可能改善利润。', '后续核对研发费用率是否下降。', '母公司研发费用率下降。', '研发费用率较上年全年下降。']) assert.doesNotThrow(() => assertCompanyFinancialRatioDirection(text, rows, ['P1']));
 assert.throws(() => assertCompanyFinancialRatioDirection('研发费用率下降。', [row('营业收入', '1000', '1000'), row('研发费用', '20', '10', 2)], ['P1']), /同比方向/);
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用率下降。', [row('营业收入', '1000', '1000'), row('研发费用', '20', '')], ['P1']));
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发投入占比下降。', rows, ['P1']));
});

test('real Proya evidence rejects the draft micro-decline while retaining the true same-half-year direction', async () => {
 const saved = JSON.parse(await readFile(new URL('./fixtures/proya-seven-reference-replay.json', import.meta.url), 'utf8'));
 const metrics = extractCompanyMetrics(saved.evidence);
 const rows = metrics.filter(item => ['营业收入', '研发费用'].includes(item.label));
 assert.equal(rows.length, 2);
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('研发费用率同比上升至1.85%。', metrics, ['P23']));
 assert.throws(() => assertCompanyFinancialRatioDirection('研发费用率微降至1.85%。', metrics, ['P23']), /同比方向/);
 assert.throws(() => assertCompanyFinancialRatioDirection('增收不增利下的结构性分化', metrics, ['P6']), /归母净利润增长/);
 assert.doesNotThrow(() => assertCompanyFinancialRatioDirection('扣非利润承压', metrics, ['P6']));
 const minimal = { headline: '费用与经营变化', conclusion: { text: '研发费用率微降至1.85%。', evidenceIds: ['P23'] }, sections: [], watchpoints: [] };
 assert.throws(() => validateCompanyAnalysis(minimal, saved.evidence, metrics), /同比方向/);
});
