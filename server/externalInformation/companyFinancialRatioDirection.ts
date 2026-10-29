import type { CompanyReport } from '../../shared/contracts/companyReport.js';
import { ExternalInformationError } from './http.js';

type Metric = CompanyReport['metrics'][number];
const definitions = [
 { labels: ['销售费用率'], numerator: '销售费用' },
 { labels: ['管理费用率'], numerator: '管理费用' },
 { labels: ['研发费用率'], numerator: '研发费用' },
 { labels: ['财务费用率'], numerator: '财务费用' },
 { labels: ['销售毛利率', '毛利率'], numerator: '营业成本', gross: true },
] as const;
const ratioLabel = /销售费用率|管理费用率|研发费用率|财务费用率|销售毛利率|毛利率/gu;
const number = (value: string) => value.trim() ? Number(value.replaceAll(',', '')) : NaN;
function pair(numerator: Metric, revenue: Metric, gross: boolean) {
 const a = number(numerator.current), b = number(numerator.previous), r = number(revenue.current), p = number(revenue.previous);
 if (![a, b, r, p].every(Number.isFinite) || r <= 0 || p <= 0) return undefined;
 return { current: (gross ? 1 - a / r : a / r) * 100, previous: (gross ? 1 - b / p : b / p) * 100 };
}

/** Recompute direction from the same current/prior-period RMB rows, never the adjacent annual ratio column. */
export function assertCompanyFinancialRatioDirection(prose: string, metrics: CompanyReport['metrics'], evidenceIds: string[]): void {
 if (!evidenceIds.length) return;
 // All rows are already verified against this report. A selective annual-column citation
 // must not hide a contradiction with the available same-period financial rows.
 const revenue = metrics.find(metric => metric.label === '营业收入');
 if (!revenue) return;
 const netProfit = metrics.find(metric => metric.label === '归属于上市公司股东的净利润');
 if (/增收不增利/u.test(prose) && netProfit
   && number(netProfit.current) > number(netProfit.previous)) {
  throw new ExternalInformationError('company_report_scope_mismatch', '归母净利润增长，不能笼统称增收不增利。');
 }
 const text = prose.normalize('NFKC').replace(/\s+/gu, '')
  .replace(/(销售|管理|研发|财务)费用([^。；;！？，,]{0,16}?)(?:但|而|与)(?:其)?费用率/gu, '$1费用率');
 const labels = [...text.matchAll(ratioLabel)];
 for (let index = 0; index < labels.length; index++) {
  const label = labels[index][0], start = labels[index].index ?? 0;
  const prefix = text.slice(Math.max(0, start - 12), start).split(/[。；;！？]/u).at(-1) ?? '';
  if (/母公司|子公司|单品牌/u.test(prefix)) continue; // Consolidated rows cannot establish another entity's ratio.
  let clause = text.slice(start, labels[index + 1]?.index ?? text.length).split(/[。；;！？]/u)[0];
  const comma = clause.search(/[，,]/u);
  if (comma >= 0 && !/^(?:同比|较上年同期|比上年同期|较同期|环比|有所|明显|显著|小幅|大幅|略|微|保持|持平|上升|下降|提高|提升|增加|减少|回落)/u.test(clause.slice(comma + 1))) clause = clause.slice(0, comma);
  if (/环比|较上季|(?:较|比|与)(?:上年度|上年全年|20\d{2}年全年)/u.test(clause)) continue;
  const direction = clause.match(/上升|提升|提高|增长|增加|攀升|升至|升为|微升|上行|下降|降低|减少|下滑|回落|降至|降为|微降|下行|持平|不变|保持稳定/);
  if (!direction) continue;
  const beforeDirection = prefix + clause.slice(0, direction.index);
  if (/若|如果|假如|一旦|可能|或将|有望|预计|是否|能否|并未|没有/u.test(beforeDirection)) continue;
  const definition = definitions.find(item => (item.labels as readonly string[]).includes(label))!;
  const numerator = metrics.find(metric => metric.label === definition.numerator);
  if (!numerator) continue;
  const comparison = pair(numerator, revenue, 'gross' in definition && definition.gross);
  if (!comparison) continue;
  // A half-basis-point threshold accommodates two-decimal percentage display rounding.
  const delta = comparison.current - comparison.previous;
  const actual = Math.abs(delta) < 0.005 ? 0 : Math.sign(delta);
  const claimed = /持平|不变|保持稳定/u.test(direction[0]) ? 0 : /下降|降低|减少|下滑|回落|降至|降为|微降|下行/u.test(direction[0]) ? -1 : 1;
  if (actual !== claimed) throw new ExternalInformationError('company_report_scope_mismatch', '财务比率的同比方向与同口径原表复算结果不一致，本次未采用。');
 }
}
