import type { CompanyReport } from '../../../shared/contracts/companyReport';
import { LsDataChart, chartPalette } from '../ui/LsDataChart';
import { companyMetricLabel, companyReportChartMetrics } from './companyReportPresentation';

export function CompanyReportCharts({ report }: { report: CompanyReport }) {
  const metrics = companyReportChartMetrics(report.metrics);
  if (!metrics.length) return null;
  const labels = metrics.map(metric => companyMetricLabel(metric.label));
  return <div className="company-report__charts">
    <LsDataChart title={`${report.period} · 本期与上年同期`} kind="bar" unit="亿元" labels={labels}
      series={[{ label: '本期', color: chartPalette[0], values: metrics.map(metric => Number(metric.current) / 1e8) },
        { label: '上年同期', color: chartPalette[4], values: metrics.map(metric => Number(metric.previous) / 1e8) }]} height={260}/>
    <LsDataChart title={`${report.period} · 同比变化`} kind="bar" unit="%" labels={labels}
      series={[{ label: '同比变化', color: chartPalette[2], values: metrics.map(metric => Number(metric.changePct)) }]} height={220}/>
  </div>;
}

export function CompanyOperatingHighlights({ report }: { report: CompanyReport }) {
  const metrics = companyReportChartMetrics(report.metrics).filter(metric => ['revenue', 'profit', 'core-profit', 'cashflow'].includes(metric.id));
  if (!metrics.length) return null;
  return <div className="company-report__operating-highlights" aria-label={`${report.period}经营指标`}>
    {metrics.map((metric, index) => <div key={metric.id} style={{ borderTopColor: chartPalette[index] }}>
      <span>{companyMetricLabel(metric.label)}</span>
      <strong>{(Number(metric.current) / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}<small>亿元</small></strong>
      <span>同比 {Number(metric.changePct) > 0 ? '+' : ''}{metric.changePct}%</span>
    </div>)}
  </div>;
}
