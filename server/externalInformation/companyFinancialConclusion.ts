import type { CompanyAnalysis, CompanyReport } from '../../shared/contracts/companyReport.js';
import { compactReportText, validateCompanyAnalysis } from './companyReportEvidence.js';

/** Recover only a missing introduction from exact, independently recomputable financial rows. */
export function recoverCompanyFinancialConclusion(metrics: CompanyReport['metrics'], evidence: CompanyReport['evidence']): CompanyAnalysis['conclusion'] | undefined {
 const wanted = ['revenue', 'profit', 'core-profit', 'cashflow'];
 const rows = wanted.map(id => metrics.find(metric => metric.id === id));
 if (rows.some(row => !row)) return undefined;
 for (const row of rows) {
  if (!row || row.unit !== '元人民币' || !row.current.trim() || !row.previous.trim() || !row.changePct.trim()) return undefined;
  const current = Number(row.current), previous = Number(row.previous), reported = Number(row.changePct);
  if (![current, previous, reported].every(Number.isFinite) || previous === 0) return undefined;
  const recomputed = (current - previous) / Math.abs(previous) * 100;
  if (Math.abs(recomputed - reported) > 0.06) return undefined;
  const page = evidence.find(item => item.id === `P${row.page}` && item.page === row.page);
  if (!page || !compactReportText(page.text).includes(compactReportText(row.excerpt))) return undefined;
 }
 const [revenue, profit, core, cashflow] = rows as CompanyReport['metrics'];
 const phrase = (row: CompanyReport['metrics'][number]) => Number(row.changePct) === 0 ? '同比持平' : `同比${Number(row.changePct) > 0 ? '增长' : '下降'}${Math.abs(Number(row.changePct)).toFixed(2)}%`;
 const revenueDirection = Math.sign(Number(revenue.changePct)), coreDirection = Math.sign(Number(core.changePct));
 const business = revenueDirection > 0 && coreDirection > 0 ? '收入与扣非盈利同向增长。'
  : revenueDirection < 0 && coreDirection < 0 ? '收入和扣非盈利均同比下降。'
   : revenueDirection !== coreDirection ? '收入与扣非盈利的同比方向分化。' : '';
 const profitSplit = Math.sign(Number(profit.changePct)) !== coreDirection ? '归母净利润与扣非净利润的同比方向分化。' : '';
 const conclusion = { text: `${business}${revenue.label}${phrase(revenue)}，${profit.label}${phrase(profit)}，${core.label}${phrase(core)}。${profitSplit}${cashflow.label}${phrase(cashflow)}。`, evidenceIds: [...new Set(rows.map(row => `P${row!.page}`))] };
 try {
  validateCompanyAnalysis({ headline: '财务指标经营结论', conclusion, sections: [], watchpoints: [] }, evidence, metrics);
  return conclusion;
 } catch { return undefined; }
}
