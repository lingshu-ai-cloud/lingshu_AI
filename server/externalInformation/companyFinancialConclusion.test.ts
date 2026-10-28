import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { recoverCompanyFinancialConclusion } from './companyFinancialConclusion.js';
import { extractCompanyMetrics } from './companyReportEvidence.js';
import { generateCompanyReport } from './companyReport.js';
import { COMPANY_REPORT_CATALOG } from './companyReportCatalog.js';
const fixture = async () => JSON.parse(await readFile(new URL('./fixtures/proya-seven-reference-replay.json', import.meta.url), 'utf8'));

test('only exact source-bound recomputable financial rows can recover a conclusion', async () => {
 const saved = await fixture(), metrics = extractCompanyMetrics(saved.evidence);
 const result = recoverCompanyFinancialConclusion(metrics, saved.evidence);
 assert.ok(result);assert.match(result.text, /方向分化/);assert.ok(result.evidenceIds.every(id => saved.evidence.some((item: {id: string}) => item.id === id)));
 for (const mutate of [
  (rows: typeof metrics) => rows.splice(rows.findIndex(row => row.id === 'cashflow'), 1),
  (rows: typeof metrics) => { rows[0].previous = '0'; },
  (rows: typeof metrics) => { rows[0].current = 'NaN'; },
  (rows: typeof metrics) => { rows[0].changePct = '9999'; },
  (rows: typeof metrics) => { rows[0].excerpt = '未出现于原文的金额'; },
 ]) { const rows = structuredClone(metrics); mutate(rows); assert.equal(recoverCompanyFinancialConclusion(rows, saved.evidence), undefined); }
 assert.equal(recoverCompanyFinancialConclusion(metrics, []), undefined);
});

test('the latest faulty Proya conclusion is replaced using saved evidence with no discovery or model retry', async () => {
 const saved = await fixture();
 const raw = JSON.parse(saved.raw);
 raw.conclusion.text = '多品牌矩阵中惊时、原色波塔单独列示，但未披露其分部收入绝对值。';
 const report = await generateCompanyReport(COMPANY_REPORT_CATALOG.find(item => item.id === 'proya')!, 'proya-recovered-conclusion', {
  read: async () => ({ pages: saved.evidence, totalPages: 209, fetchedAt: '2026-10-28T00:00:00Z', sha256: saved.sourceSha256, audited: false }),
  analyze: async () => JSON.stringify(raw), supplement: async () => ({ sources: [], patches: [] }),
 });
 assert.equal(report.analysis.sections.length, 4);
 assert.match(report.analysis.conclusion.text, /营业收入同比增长0.24%/);
 assert.match(report.analysis.conclusion.text, /扣除非经常性损益的净利润同比下降13.80%/);
 assert.doesNotMatch(report.analysis.conclusion.text, /未披露|品牌孵化|订单|原因/);
});
