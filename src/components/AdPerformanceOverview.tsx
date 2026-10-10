import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { platformAdsRequest } from '../lib/platformAds';
import { dayRange, overviewData, overviewEntries, percentChange, type AdReport, type ReportEntry } from '../lib/adOverview';
import './adPerformanceOverview.css';
import AdMetricHistoryPanel from './AdMetricHistoryPanel';
import { foreignTradeMockAdReport, isForeignTradeMockId, isLocalForeignTradeMockEnabled } from '../mocks/foreignTradeOperations';
import { CHART_CURSOR_STYLE, CHART_TOOLTIP_STYLE } from '../lib/uiStyles';
import { chartPalette } from './ui/LsDataChart';

type Task = { id: string; name: string; currency: string; budget: string | number };
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const format = (n: number | null, digits = 0) => n === null ? '—' : n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
export default function AdPerformanceOverview({ tasks, loading, onOpen }: { tasks: Task[]; loading: boolean; onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [currency, setCurrency] = useState('');
  const [period, setPeriod] = useState('7');
  const [since, setSince] = useState(day(-6));
  const [until, setUntil] = useState(day());
  const [series, setSeries] = useState<'clicks' | 'impressions'>('clicks');
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    const abort = new AbortController();
    setBusy(true); setEntries([]);
    // Read the existing metrics endpoint only; no credentials or account mutations.
    void (async () => {
      const results: ReportEntry[] = [];
      for (let i = 0; i < tasks.length; i += 3) {
        const batch = await Promise.all(tasks.slice(i, i + 3).map(async task => {
          const localMockReport = isLocalForeignTradeMockEnabled() ? foreignTradeMockAdReport(task.id) : null;
          if (localMockReport) return { ...task, report: localMockReport };
          try { return { ...task, report: await platformAdsRequest<AdReport>(`/tasks/${encodeURIComponent(task.id)}/metrics`, { signal: abort.signal }) }; }
          catch (error) { return { ...task, error: error instanceof Error ? error.message : '读取失败' }; }
        }));
        if (version !== generation.current || abort.signal.aborted) return;
        results.push(...batch); setEntries([...results]);
      }
      if (version === generation.current) setBusy(false);
    })();
    return () => { abort.abort(); generation.current++; };
  }, [tasks, refresh]);
  const currencies = [...new Set(tasks.map(t => t.currency))];
  const chosen = currencies.includes(currency) ? currency : currencies[0] || 'CNY';
  // Pending and failed requests remain in the denominator during progressive loading.
  const scopedEntries = useMemo(() => overviewEntries(tasks, entries), [tasks, entries]);
  const data = useMemo(() => overviewData(scopedEntries, chosen, since, until), [scopedEntries, chosen, since, until]);
  const missing = data.selected.length - data.usable.length;
  const budget = tasks.filter(t => t.currency === chosen).reduce((n, t) => n + (Number(t.budget) || 0), 0);
  const dates = dayRange(since, until);
  const priorUntil = new Date(Date.parse(since + 'T00:00:00Z') - 86400000);
  const previous = Number.isFinite(priorUntil.getTime()) ? overviewData(scopedEntries, chosen, new Date(priorUntil.getTime() - Math.max(0, dates.length - 1) * 86400000).toISOString().slice(0, 10), priorUntil.toISOString().slice(0, 10)) : null;
  const hasData = data.daily.some(row => row.spend !== null || row[series] !== null);
  const hasLocalMockData = isLocalForeignTradeMockEnabled() && scopedEntries.some(entry => entry.currency === chosen && isForeignTradeMockId(entry.id));
  const mockFunnel = { conversations: 31, qualified: 12, quotes: 5, orders: 2, revenue: 522000 };
  const cards = [
    { label: '广告花费', value: `${chosen} ${format(data.spend, 2)}`, note: percentChange(data.spend, previous?.spend ?? null, data.complete && !!previous?.complete) },
    hasLocalMockData
      ? { label: '询盘 / 单条询盘成本', value: `${mockFunnel.conversations} / ${chosen} ${format(data.spend === null ? null : data.spend / mockFunnel.conversations, 2)}`, note: '来自广告来源会话模拟归因' }
      : { label: '询盘 / 单条询盘成本', value: '未接通', note: '点击、播放量不等于询盘' },
    hasLocalMockData
      ? { label: '有效询盘 / 有效询盘成本', value: `${mockFunnel.qualified} / ${chosen} ${format(data.spend === null ? null : data.spend / mockFunnel.qualified, 2)}`, note: '已完成需求与采购角色判定' }
      : { label: '有效询盘 / 有效询盘成本', value: '未接通', note: '待建立客服质量判定与广告归因' },
    hasLocalMockData
      ? { label: '归因成交金额 / ROAS', value: `USD ${format(mockFunnel.revenue)} / ${data.spend ? (mockFunnel.revenue / data.spend).toFixed(1) : '—'}x`, note: '模拟归因：沙特首期订单 + 德国试点订单' }
      : { label: '归因成交金额 / ROAS', value: '未接通', note: '不使用未归因订单计算广告回报' },
  ];
  const funnelRows = hasLocalMockData ? [
    ['广告花费', `${chosen} ${format(data.spend, 2)}`, '近 7 天模拟平台快照'],
    ['点击', format(data.clicks), 'Meta / YouTube 平台点击'],
    ['进入会话', String(mockFunnel.conversations), '带广告来源参数的 WhatsApp 会话'],
    ['有效询盘', String(mockFunnel.qualified), '需求、预算或采购角色已确认'],
    ['报价', String(mockFunnel.quotes), '已发正式方案或 PI'],
    ['成交', String(mockFunnel.orders), '已登记付款凭证'],
  ] : [
    ['广告花费', `${chosen} ${format(data.spend, 2)}`, '平台已返回小计'],
    ['点击', format(data.clicks), '平台点击，非独立客户'],
    ['进入会话', '未接通', '待关联广告来源'],
    ['有效询盘', '未接通', '待客服质量判定'],
    ['报价', '未接通', '待报价记录归因'],
    ['成交', '未接通', '待订单归因'],
  ];
  return <div className="ad-performance">
    <section className="ads-card ad-summary">
      <div className="ads-section-title"><div><p className="ads-muted">PERFORMANCE PULSE</p><h2>花费有依据，增长看全程</h2></div><button className="ads-button" disabled={busy || loading} onClick={() => setRefresh(r => r + 1)}>刷新数据</button></div>
      <div className="ad-toolbar"><label>统计周期<select value={period} onChange={e => { setPeriod(e.target.value); if (e.target.value !== 'custom') { setSince(day(1 - Number(e.target.value))); setUntil(day()); } }}><option value="1">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="custom">自定义</option></select></label>{period === 'custom' && <><label>开始日期<input type="date" value={since} max={until} onChange={e => setSince(e.target.value)} /></label><label>结束日期<input type="date" value={until} min={since} max={day()} onChange={e => setUntil(e.target.value)} /></label></>}<label>币种<select value={chosen} onChange={e => setCurrency(e.target.value)}>{(currencies.length ? currencies : ['CNY']).map(c => <option key={c}>{c}</option>)}</select></label></div>
      {!dates.length && <p role="alert">请选择有效日期范围（最多 366 天）。</p>}
      <div className="ad-coverage" role="status" aria-live="polite">
        <span className="ad-status">{busy || loading ? '正在读取报告' : data.stale ? '含历史快照 · 非实时' : !data.complete ? '数据覆盖不完整' : '所选周期数据完整'}</span>
        {data.stale && (busy || loading) && <span>含历史快照 · 非实时</span>}
        {data.stale && !data.complete && <span>数据覆盖不完整</span>}
        <p>已返回 {data.usable.length}/{tasks.filter(t => t.currency === chosen).length} 个计划报告；{missing} 个尚无报告{busy ? '（含读取中）' : ''}。</p>
        {!hasData && <p>所选周期没有可核验的日数据。</p>}
        <p>日期筛选按 UTC 日期边界；平台日记录沿用原报告日期，尚未转换账户时区。缺失日期不补零，部分覆盖仅代表已返回小计。切换周期不会自动补采历史。</p>
        <p>{chosen} {format(budget, 2)} · 计划预算合计，非剩余预算、账户余额或所选周期可用额度。</p>
      </div>
      <div className="ad-kpis">{cards.map(c => <article key={c.label}><span>{c.label}</span><strong>{c.value}</strong><small>{c.note}</small></article>)}</div>
    </section>
    <section className="ads-card"><div className="ads-section-title"><div><h2>从投放到成交</h2><p className="ads-muted">{hasLocalMockData ? '本地模拟链路与客户、订单页使用同一组外贸工厂数据。' : '前两步来自平台报告；后四步尚未归因，不连线、不推算转化率。'}</p></div></div><div className="ad-funnel">
      {funnelRows.map(([label, value, note], i) => <article key={label} className={!hasLocalMockData && i > 1 ? 'ad-stage-missing' : ''}><small>0{i + 1}</small><h3>{label}</h3><strong>{value}</strong><span>{note}</span><div className="ad-stage-line" /></article>)}</div><p className="ads-muted">{hasLocalMockData ? '模拟链路：广告点击 → WhatsApp 会话 → 有效询盘 → 正式报价 → 付款订单。' : '广告点击 → 会话转化率：未接通。已有客户和聊天记录不会自动计为广告带来的询盘。'}</p></section>
    <section className="ads-card"><div className="ads-section-title"><div><h2>花费与触达趋势</h2><p className="ads-muted">同一日期对照花费和平台结果，断点表示缺失，不是零。</p></div><label>对照指标<select value={series} onChange={e => setSeries(e.target.value as typeof series)}><option value="clicks">点击次数</option><option value="impressions">曝光次数</option></select></label></div>
      <div className="ad-chart" role="img" aria-label={`每日花费（${chosen}）与${series === 'clicks' ? '点击' : '曝光'}趋势；下方可展开原始数值表`}>{hasData ? <ResponsiveContainer width="100%" height={290}><ComposedChart data={data.daily} margin={{ top: 12, right: 24, left: 16, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false}/><XAxis dataKey="date" tickFormatter={v => v.slice(5)} minTickGap={24} tick={{ fill: '#71717a' }}/><YAxis yAxisId="money" width={66} label={{ value: chosen, position: 'insideTopLeft', fill: '#52525b' }} tick={{ fill: '#71717a' }}/><YAxis yAxisId="count" orientation="right" width={50} allowDecimals={false} tick={{ fill: '#71717a' }}/><Tooltip labelFormatter={v => `${v}`} contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR_STYLE}/><Legend/><Bar yAxisId="money" dataKey="spend" name={`花费 (${chosen})`} fill={chartPalette[0]} maxBarSize={28}/><Line yAxisId="count" dataKey={series} name={series === 'clicks' ? '点击 (次)' : '曝光 (次)'} stroke={chartPalette[1]} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer> : <div className="ad-chart-empty">暂无可绘制的日数据<br/><small>现有接口仅返回其报告窗口；选择更长周期不会自动补齐历史。</small></div>}</div>
      <details><summary>数据核对：逐日数值与覆盖范围</summary><div className="ad-table-scroll"><table><caption>仅汇总当前币种已返回日数据；空值为“—”。</caption><thead><tr><th>日期</th><th>花费 ({chosen})</th><th>点击</th><th>曝光</th><th>有日记录的计划</th></tr></thead><tbody>{data.daily.map(r => <tr key={r.date}><td>{r.date}</td><td>{format(r.spend, 2)}</td><td>{format(r.clicks)}</td><td>{format(r.impressions)}</td><td>{r.reportingTasks}/{data.selected.length}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className="ads-card"><h2>报告来源与核对</h2><p className="ads-muted">保留平台原始报告口径，与上方日期筛选小计分开显示。未建立跨计划资源去重口径；请勿将重复映射的计划合计当作账户总账。</p><div className="ad-table-scroll"><table><thead><tr><th>计划</th><th>来源 / 状态</th><th>报告窗口</th><th>原报告花费</th><th>更新时间</th></tr></thead><tbody>{scopedEntries.map(e => <tr key={e.id}><td><button className="ads-text-button" onClick={() => onOpen(e.id)}>{e.name}</button></td><td>{isForeignTradeMockId(e.id) ? '本地演示快照' : e.error ? `读取失败：${e.error}` : e.report?.stale || e.report?.source === 'provider_snapshot' ? '历史快照 · 非实时' : e.report?.source === 'provider' ? '平台报告' : e.report?.reason || '数据未就绪'}</td><td>{e.report?.window ? `${e.report.window.since} — ${e.report.window.until}` : '—'}</td><td>{e.report?.currency || e.currency} {format(e.report?.spend ?? null, 2)}</td><td>{e.report?.reportedAt ? new Date(e.report.reportedAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</tbody></table></div></section>
    {tasks.some(task => !isForeignTradeMockId(task.id))
      ? <AdMetricHistoryPanel tasks={tasks.filter(task => !isForeignTradeMockId(task.id))} />
      : <section className="ads-card"><h2>投放绩效历史表</h2><p className="ads-muted">当前为本地外贸工厂参考预览。连接真实广告账户后，这里会按广告资源展示可核验的逐日历史指标。</p></section>}
  </div>;
}
