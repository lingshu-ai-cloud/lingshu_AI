import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { companyDisclosedIncomeEntities, assertCompanyIncomeDisclosure } from './companyDisclosureContradictions.js';
import { extractCompanyMetrics, validateCompanyAnalysis } from './companyReportEvidence.js';
const source = '品牌 收入金额（亿元） 2026H1 同比增减\n品牌甲 3.13 222.23 5.83\n品牌乙 0.82 103.53 1.53\n3CE 0.00 -20.00 0.00\n合计 53.67 0.21 100.00';

test('generic entity income rows contradict explicit non-disclosure assertions without hardcoded brand names', () => {
 assert.deepEqual(companyDisclosedIncomeEntities(source), ['品牌甲', '品牌乙', '3CE']);
 for (const text of ['品牌甲和品牌乙单独列示，但未披露其分部收入绝对值。', '报告未披露品牌甲收入金额。', '品牌乙收入金额未披露。', '3CE未披露收入金额。']) assert.throws(() => assertCompanyIncomeDisclosure(text, source), /已列示/);
});

test('percentage-only tables, other entities, other metrics, questions and historical scopes do not establish a contradiction', () => {
 const percentage = '品牌收入占比(%)\n品牌甲 60.00 55.00\n品牌乙 40.00 45.00';
 assert.deepEqual(companyDisclosedIncomeEntities(percentage), []);
 for (const [text, evidence] of [
  ['品牌甲未披露收入金额。', percentage],
  ['品牌丙未披露收入金额。', source],
  ['品牌甲未披露利润金额。', source],
  ['品牌甲未披露销量。', source],
  ['品牌甲2025年收入金额未披露。', source],
  ['品牌甲二季度收入金额未披露。', source],
  ['品牌甲海外收入金额未披露。', source],
  ['需核对品牌甲是否未披露收入金额。', source],
  ['若品牌甲未披露收入金额，需进一步核对。', source],
 ]) assert.doesNotThrow(() => assertCompanyIncomeDisclosure(text, evidence));
});

test('real Proya page rows reject the exact persisted absolute-income denial and retain the actual disclosed amounts', async () => {
 const saved = JSON.parse(await readFile(new URL('./fixtures/proya-seven-reference-replay.json', import.meta.url), 'utf8'));
 const page = saved.evidence.find((item: { id: string }) => item.id === 'P10');
 const entities = companyDisclosedIncomeEntities(page.text);
 assert.ok(entities.includes('原色波塔')); assert.ok(entities.includes('惊时'));
 const text = '多品牌矩阵中惊时、原色波塔等新锐品牌单独列示，但未披露其分部收入绝对值，品牌孵化成效仍待验证。';
 assert.throws(() => assertCompanyIncomeDisclosure(text, page.text), /已列示/);
 const metrics = extractCompanyMetrics(saved.evidence);
 assert.throws(() => validateCompanyAnalysis({ headline: '品牌收入披露', conclusion: { text, evidenceIds: ['P10'] }, sections: [], watchpoints: [] }, saved.evidence, metrics), /已列示/);
 assert.doesNotThrow(() => validateCompanyAnalysis({ headline: '品牌收入披露', conclusion: { text: '原色波塔收入为3.13亿元，惊时收入为0.82亿元。', evidenceIds: ['P10'] }, sections: [], watchpoints: [] }, saved.evidence, metrics));
});
