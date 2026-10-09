import { Alert, Button, Collapse, Empty, Skeleton, Table, Tag } from 'antd';
import { Download } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Chart, ChartConfiguration, ChartType } from 'chart.js';

export type LsChartSeries = { label: string; values: Array<number | null>; color?: string; xValues?: Array<number | null> };
export interface LsDataChartProps {
  title: string; description?: string; kind: 'bar' | 'line' | 'doughnut' | 'scatter';
  labels: string[]; series: LsChartSeries[]; horizontal?: boolean; stacked?: boolean;
  percent?: boolean; unit?: string; xUnit?: string; xValues?: Array<number | null>;
  loading?: boolean; error?: string; demo?: boolean; height?: number;
}
export const chartPalette = ['#117F51', '#356CAE', '#A97424', '#B74D43', '#7567A8', '#617169'];
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const displayValue = (value: unknown, unit = '') => finite(value) === null ? '—' : `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${unit}`;
type ChartRow = { key: number; label: string; [field: string]: number | string | null };

/** The graph and accessible data table consume the same query snapshot. */
export function LsDataChart({ title, description, kind, labels, series, horizontal = false, stacked = false, percent = false, unit = '', xUnit = '', xValues, loading = false, error, demo = false, height = 280 }: LsDataChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const titleId = useId();
  const [renderError, setRenderError] = useState('');
  // A series-specific X array owns its gaps; only absent arrays use the shared X values.
  const rows = useMemo<ChartRow[]>(() => labels.map((label, index) => ({ key: index, label, ...Object.fromEntries(series.flatMap((item, i) => [[`value${i}`, finite(item.values[index])], [`x${i}`, finite((item.xValues ?? xValues)?.[index])]])) })), [labels, series, xValues]);
  const hasData = rows.some(row => series.some((_, i) => finite(row[`value${i}`]) !== null && (kind !== 'scatter' || finite(row[`x${i}`]) !== null)));
  const plottedCount = kind === 'bar' ? Math.min(labels.length, 10) : kind === 'doughnut' ? Math.min(labels.length, 5) : labels.length;

  useEffect(() => {
    setRenderError('');
    if (!canvas.current || !hasData || loading) return;
    let canceled = false;
    let chart: Chart | undefined;
    void import('chart.js').then(({ Chart: ChartJS, BarController, LineController, DoughnutController, ScatterController, BarElement, LineElement, PointElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend }) => {
      if (canceled || !canvas.current) return;
      ChartJS.register(BarController, LineController, DoughnutController, ScatterController, BarElement, LineElement, PointElement, ArcElement, CategoryScale, LinearScale, Tooltip, Legend);
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
          animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 180 },
          indexAxis: horizontal ? 'y' : 'x',
          plugins: {
            legend: { display: series.length > 1 || kind === 'doughnut', position: 'bottom', labels: { color: '#53695F', usePointStyle: true, boxWidth: 8, padding: 18 } },
            tooltip: { backgroundColor: '#173D31', padding: 12, callbacks: { label: (item: { dataset: { label?: string }; raw: unknown; parsed: { x: number; y: number } }) => kind === 'scatter'
              ? `${item.dataset.label}: ${displayValue(item.parsed.x, xUnit)} / ${displayValue(item.parsed.y, unit)}`
              : `${item.dataset.label}: ${displayValue(item.raw, unit || (percent ? '%' : ''))}` } },
          },
          scales: kind === 'doughnut' ? {} : {
            x: { stacked, grid: { display: horizontal }, ticks: { color: '#617169', maxRotation: 0, autoSkip: true }, ...(kind === 'scatter' ? { type: 'linear', title: { display: Boolean(xUnit), text: xUnit } } : {}) },
            y: { stacked, grid: { display: !horizontal, color: '#DFE8E1' }, ticks: { color: '#617169' } },
            [valueAxis]: { stacked, beginAtZero: true, ...(percent ? { max: 100 } : {}), grid: { color: '#DFE8E1' }, ticks: { color: '#617169' }, title: { display: Boolean(unit || percent), text: unit || '%' } },
          },
        },
      } as ChartConfiguration<ChartType>;
      chart = new ChartJS(canvas.current, config);
    }).catch(() => { if (!canceled) setRenderError('图表暂时无法显示，可在下方数据表查看完整数据。'); });
    return () => { canceled = true; chart?.destroy(); };
  }, [kind, labels, series, horizontal, stacked, percent, unit, xUnit, rows, hasData, loading, plottedCount]);

  const download = () => {
    // Prefix spreadsheet formula characters to keep exported user text inert.
    const csv = (value: unknown) => {
      const text = String(value ?? '');
      const safeText = /^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
      return `"${safeText.replaceAll('"', '""')}"`;
    };
    const columns = series.flatMap(item => kind === 'scatter' ? [`${item.label} · X${xUnit ? ` (${xUnit})` : ''}`, `${item.label} · Y${unit ? ` (${unit})` : ''}`] : [item.label]);
    const body = [[demo ? '演示数据 · 日期/对象' : '日期/对象', ...columns], ...rows.map(row => [row.label, ...series.flatMap((_, i) => kind === 'scatter' ? [displayValue(row[`x${i}`]), displayValue(row[`value${i}`])] : [displayValue(row[`value${i}`], unit || (percent ? '%' : ''))])])].map(row => row.map(csv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${demo ? '演示数据-' : ''}${title}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="ls-chart" aria-labelledby={titleId}>
    <header className="ls-chart__header"><div><h3 id={titleId}>{title}</h3>{description && <p>{description}</p>}</div>{demo && <Tag color="warning">演示数据</Tag>}</header>
    {(error || renderError) && <Alert type="warning" showIcon title={error || renderError} style={{ marginBottom: 12 }} />}
    {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : !hasData ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可展示的数据" /> : <>
      <div style={{ height, position: 'relative' }}><canvas ref={canvas} role="img" aria-label={`${demo ? '演示数据。' : ''}${title}。${description || ''}完整数值请查看下方数据表。`} /></div>
      {(plottedCount < labels.length || series.length > 5) && <p className="ls-chart__note">图中展示前 {plottedCount} 项、最多 5 个序列，完整数值见数据表。</p>}
      <Collapse ghost items={[{ key: 'data', label: '查看数据表', children: <><Table size="small" rowKey="key" dataSource={rows} pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false } : false} scroll={{ x: 'max-content' }} columns={[{ title: '日期 / 对象', dataIndex: 'label' }, ...series.flatMap((item, i) => [...(kind === 'scatter' ? [{ title: `${item.label} · ${xUnit || 'X'}`, dataIndex: `x${i}`, align: 'right' as const, render: (value: unknown) => displayValue(value, xUnit) }] : []), { title: kind === 'scatter' ? `${item.label} · ${unit || 'Y'}` : item.label, dataIndex: `value${i}`, align: 'right' as const, render: (value: unknown) => displayValue(value, unit || (percent ? '%' : '')) }])]} /><Button type="text" size="small" icon={<Download size={14} />} onClick={download}>下载 CSV{demo ? '（演示数据）' : ''}</Button></> }]} />
    </>}
  </section>;
}

export default LsDataChart;
