import { reportPresentationLine } from '../../../shared/reportPresentation';
import type { CompanyReport } from '../../../shared/contracts/companyReport';

/** Old reports can contain validator placeholders. Never present those as an insight. */
export function companyReportVisibleText(text: string): string {
  const sentences = text.match(/[^。！？；\n]+[。！？；]?/gu) || [];
  return sentences.map(reportPresentationLine).filter(sentence => !/(?:未取得|未获取|未找到|尚无|暂无|缺乏).{0,30}(?:可核验|可靠|有效|足够).{0,15}(?:数据|资料|证据)|(?:数据|资料|证据)(?:不足|缺失)|(?:暂不|不予|无法|不能)(?:作出|作|做)?(?:判断|核验|确认)|该段.{0,25}(?:未披露|无数据)/u.test(sentence)).join('').trim();
}

export const companyMetricLabel = (label: string) => label
  .replace('归属于上市公司股东的扣除非经常性损益的净利润', '扣非净利润')
  .replace('归属于上市公司股东的净利润', '归母净利润')
  .replace('经营活动产生的现金流量净额', '经营现金流');

export function companyReportChartMetrics(metrics: CompanyReport['metrics']) {
  return metrics.filter(metric => metric.unit === '元人民币' && [metric.current, metric.previous, metric.changePct]
    .every(value => value.trim() !== '' && Number.isFinite(Number(value)))).slice(0, 6);
}

export const isCompanyOperatingSection = (title: string) => /整体经营|总体经营|经营概况|经营表现|财务表现|盈利能力|经营结论/u.test(title);
