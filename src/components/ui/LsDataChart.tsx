import { Alert, Button, Collapse, Empty, Skeleton, Table, Tag } from 'antd';
import { Download } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Chart, ChartConfiguration, ChartType } from 'chart.js';
import { lsFonts, lsMotion, lsTypography } from '../../lib/designTokens';
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion';

export type LsChartSeries = { label: string; values: Array<number | null>; color?: string; xValues?: Array<number | null> };
export interface LsDataChartProps {
  title: string; description?: string; kind: 'bar' | 'line' | 'doughnut' | 'scatter';
  labels: string[]; series: LsChartSeries[]; horizontal?: boolean; stacked?: boolean;
  percent?: boolean; unit?: string; xUnit?: string; xValues?: Array<number | null>;
  loading?: boolean; error?: string; demo?: boolean; height?: number;
}
export const chartPalette = ['#36A2EB', '#FF6384', '#4BC0C0', '#FFCD56', '#9966FF', '#FF9F40'];
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const displayValue = (value: unknown, unit = '') => finite(value) === null ? '—' : `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit}`;
type ChartRow = { key: number; label: string; [field: string]: number | string | null };

/** The graph and accessible data table consume the same query snapshot. */
export function LsDataChart({ title, description, kind, labels, series, horizontal = false, stacked = false, percent = false, unit = '', xUnit = '', xValues, loading = false, error, demo = false, height = 280 }: LsDataChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderedChart = useRef<{ chart: Chart; canvas: HTMLCanvasElement; kind: LsDataChartProps['kind'] } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const titleId = useId();
  const [renderError, setRenderError] = useState('');
  // A series-specific X array owns its gaps; only absent arrays use the shared X values.
  const rows = useMemo<ChartRow[]>(() => labels.map((label, index) => ({ key: index, label, ...Object.fromEntries(series.flatMap((item, i) => [[`value${i}`, finite(item.values[index])], [`x${i}`, finite((item.xValues ?? xValues)?.[index])]])) })), [labels, series, xValues]);
  const hasData = rows.some(row => series.some((_, i) => finite(row[`value${i}`]) !== null && (kind !== 'scatter' || finite(row[`x${i}`]) !== null)));
  const plottedCount = kind === 'bar' ? Math.min(labels.length, 10) : kind === 'doughnut' ? Math.min(labels.length, 5) : labels.length;

  useEffect(() => () => {
    renderedChart.current?.chart.destroy();
    renderedChart.current = null;
  }, []);

  useEffect(() => {
    setRenderError('');
    if (!canvas.current || !hasData || loading) {
      renderedChart.current?.chart.destroy();
      renderedChart.current = null;
      return;
    }
    if (reducedMotion && renderedChart.current) {
      renderedChart.current.chart.stop();
      renderedChart.current.chart.options.animation = false;
      renderedChart.current.chart.update('none');
    }
    let canceled = false;
    void import('chart.js').then(({ Chart: ChartJS, BarController, LineController, DoughnutController, ScatterController, BarElement, LineElement, PointElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend }) => {
      if (canceled || !canvas.current) return;
      ChartJS.register(BarController, LineController, DoughnutController, ScatterController, BarElement, LineElement, PointElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend);
      const active = renderedChart.current;
      const reuse = active?.canvas === canvas.current && active.kind === kind;
      const labelType = lsTypography['body-small'];
      const labelFont = { family: lsFonts.sans, size: labelType.size, lineHeight: labelType.line / labelType.size, weight: labelType.weight };
      const datasets = series.slice(0, 5).map((item, index) => ({
        label: item.label,
        data: kind === 'scatter'
          ? rows.map(row => ({ x: finite(row[`x${index}`]), y: finite(row[`value${index}`]) })).filter(point => point.x !== null && point.y !== null)
          : rows.slice(0, plottedCount).map(row => finite(row[`value${index}`])),
        borderColor: item.color || chartPalette[index],
        backgroundColor: kind === 'doughnut' ? chartPalette : item.color || chartPalette[index],
        borderWidth: kind === 'line' || kind === 'doughnut' ? 2 : 0,
        borderDash: index % 2 ? [5, 3] : [],
        pointStyle: (['circle', 'rect', 'triangle', 'crossRot', 'rectRot'] as const)[index],
        pointRadius: kind === 'scatter' ? 5 : labels.length < 32 ? 3 : 0,
        maxBarThickness: 28, tension: 0, spanGaps: false,
      }));
      const valueAxis = horizontal ? 'x' : 'y';
      const config = {
        type: kind,
        data: { labels: labels.slice(0, plottedCount), datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          font: labelFont,
          animation: reducedMotion || reuse || plottedCount * Math.min(series.length, 5) >= 1000 ? false : { duration: lsMotion.duration.enter, easing: 'easeOutCubic' },
          indexAxis: horizontal ? 'y' : 'x',
          plugins: {
            legend: { display: series.length > 1 || kind === 'doughnut', position: 'bottom', labels: { color: '#52525B', font: labelFont, usePointStyle: true, boxWidth: 8, padding: 18 } },
            tooltip: { backgroundColor: '#FFFFFF', titleColor: '#171717', bodyColor: '#52525B', titleFont: { ...labelFont, weight: lsTypography['title-small'].weight }, bodyFont: labelFont, borderColor: '#E4E4E7', borderWidth: 1, padding: 12, callbacks: { label: (item: { dataset: { label?: string }; raw: unknown; parsed: { x: number; y: number } }) => kind === 'scatter'
              ? `${item.dataset.label}: ${displayValue(item.parsed.x, xUnit)} / ${displayValue(item.parsed.y, unit)}`
              : `${item.dataset.label}: ${displayValue(item.raw, unit || (percent ? '%' : ''))}` } },
          },
          scales: kind === 'doughnut' ? {} : {
            x: { stacked, grid: { display: horizontal, color: '#E4E4E7' }, border: { color: '#E4E4E7' }, ticks: { color: '#71717A', maxRotation: 0, autoSkip: true }, ...(kind === 'scatter' ? { type: 'linear', title: { display: Boolean(xUnit), text: xUnit, color: '#52525B' } } : {}) },
            y: { stacked, grid: { display: !horizontal, color: '#E4E4E7' }, border: { color: '#E4E4E7' }, ticks: { color: '#71717A' } },
            [valueAxis]: { stacked, beginAtZero: true, ...(percent ? { max: 100 } : {}), grid: { color: '#E4E4E7' }, border: { color: '#E4E4E7' }, ticks: { color: '#71717A' }, title: { display: Boolean(unit || percent), text: unit || '%', color: '#52525B' } },
          },
        },
      } as ChartConfiguration<ChartType>;
      if (reuse && active) {
        active.chart.stop();
        active.chart.data = config.data;
        active.chart.options = config.options || {};
        active.chart.update('none');
      } else {
        active?.chart.destroy();
        renderedChart.current = { chart: new ChartJS(canvas.current, config), canvas: canvas.current, kind };
      }
    }).catch(() => { if (!canceled) setRenderError('图表暂时无法显示，可在下方数据表查看完整数据。'); });
    return () => { canceled = true; };
  }, [kind, labels, series, horizontal, stacked, percent, unit, xUnit, rows, hasData, loading, plottedCount, reducedMotion]);

  const download = () => {
    // Prefix spreadsheet formula characters to keep exported user text inert.
    const csv = (value: unknown) => {
      const text = String(value ?? '');
      const safeText = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
      return `"${safeText.replaceAll('"', '""')}"`;
    };
    const columns = series.flatMap(item => kind === 'scatter' ? [`${item.label} · X${xUnit ? ` (${xUnit})` : ''}`, `${item.label} · Y${unit ? ` (${unit})` : ''}`] : [item.label]);
    const body = [[demo ? '参考预览 · 日期/对象' : '日期/对象', ...columns], ...rows.map(row => [row.label, ...series.flatMap((_, i) => kind === 'scatter' ? [displayValue(row[`x${i}`]), displayValue(row[`value${i}`])] : [displayValue(row[`value${i}`], unit || (percent ? '%' : ''))])])].map(row => row.map(csv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${demo ? '参考预览-' : ''}${title}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="ls-chart" aria-labelledby={titleId}>
    <header className="ls-chart__header"><div><h3 id={titleId} className="ls-type-title-small">{title}</h3>{description && <p className="ls-type-body-small">{description}</p>}</div>{demo && <Tag color="warning">参考预览</Tag>}</header>
    {(error || renderError) && <Alert type="warning" showIcon title={error || renderError} style={{ marginBottom: 12 }} />}
    {loading ? <Skeleton active={!reducedMotion} paragraph={{ rows: 5 }} /> : !hasData ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可展示的数据" /> : <>
      <div style={{ height, position: 'relative' }}><canvas ref={canvas} role="img" aria-label={`${demo ? '参考预览。' : ''}${title}。${description || ''}完整数值请查看下方数据表。`} /></div>
      {(plottedCount < labels.length || series.length > 5) && <p className="ls-chart__note">图中展示前 {plottedCount} 项、最多 5 个序列，完整数值见数据表。</p>}
      <Collapse ghost items={[{ key: 'data', label: '查看数据表', children: <><Table size="small" rowKey="key" dataSource={rows} pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false } : false} scroll={{ x: 'max-content' }} columns={[{ title: '日期 / 对象', dataIndex: 'label' }, ...series.flatMap((item, i) => [...(kind === 'scatter' ? [{ title: `${item.label} · ${xUnit || 'X'}`, dataIndex: `x${i}`, align: 'right' as const, render: (value: unknown) => displayValue(value, xUnit) }] : []), { title: kind === 'scatter' ? `${item.label} · ${unit || 'Y'}` : item.label, dataIndex: `value${i}`, align: 'right' as const, render: (value: unknown) => displayValue(value, unit || (percent ? '%' : '')) }])]} /><Button type="text" size="small" icon={<Download size={14} />} onClick={download}>下载 CSV{demo ? '（参考预览）' : ''}</Button></> }]} />
    </>}
  </section>;
}

export default LsDataChart;
