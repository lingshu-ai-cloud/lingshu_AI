import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { platformAdsRequest } from '../lib/platformAds';
import { dayRange, overviewData, percentChange, type AdReport, type ReportEntry } from '../lib/adOverview';
import './adPerformanceOverview.css';

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
  const data = useMemo(() => overviewData(entries, chosen, since, until), [entries, chosen, since, until]);
  const dates = dayRange(since, until);
  const priorUntil = new Date(Date.parse(since + 'T00:00:00Z') - 86400000);
  const previous = Number.isFinite(priorUntil.getTime()) ? overviewData(entries, chosen, new Date(priorUntil.getTime() - Math.max(0, dates.length - 1) * 86400000).toISOString().slice(0, 10), priorUntil.toISOString().slice(0, 10)) : null;
  const hasData = data.spend !== null;
  const cards = [
    { label: '广告花费', value: `${chosen} ${format(data.spend, 2)}`, note: percentChange(data.spend, previous?.spend ?? null, data.complete && !!previous?.complete) },
    { label: '询盘 / 单条询盘成本', value: '未接通', note: '点击、播放量不等于询盘' },
    { label: '有效询盘 / 有效询盘成本', value: '未接通', note: '待建立客服质量判定与广告归因' },
    { label: '归因成交金额 / ROAS', value: '未接通', note: '不使用未归因订单计算广告回报' },
  ];
  return <div className="ad-performance">
    <section className="ads-card ad-summary">
      <div className="ads-section-title"><div><p className="ads-muted">PERFORMANCE PULSE</p><h2>花费有依据，增长看全程</h2></div><button className="ads-button" disabled={busy || loading} onClick={() => setRefresh(r => r + 1)}>刷新数据</button></div>
      <div className="ad-toolbar"><label>统计周期<select value={period} onChange={e => { setPeriod(e.target.value); if (e.target.value !== 'custom') { setSince(day(1 - Number(e.target.value))); setUntil(day()); } }}><option value="1">今天</option><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="custom">自定义</option></select></label>{period === 'custom' && <><label>开始日期<input type="date" value={since} max={until} onChange={e => setSince(e.target.value)} /></label><label>结束日期<input type="date" value={until} min={since} max={day()} onChange={e => setUntil(e.target.value)} /></label></>}<label>币种<select value={chosen} onChange={e => setCurrency(e.target.value)}>{(currencies.length ? currencies : ['CNY']).map(c => <option key={c}>{c}</option>)}</select></label></div>
      {!dates.length && <p role="alert">请选择有效日期范围（最多 366 天）。</p>}
      <div className="ad-kpis">{cards.map(c => <article key={c.label}><span>{c.label}</span><strong>{c.value}</strong><small>{c.note}</small></article>)}</div>
    </section>
    <section className="ads-card"><div className="ads-section-title"><div><h2>从投放到成交</h2><p className="ads-muted">前两步来自平台报告；后四步尚未归因，不连线、不推算转化率。</p></div></div><div className="ad-funnel">{[
      ['广告花费', `${chosen} ${format(data.spend, 2)}`, '平台已返回小计'], ['点击', format(data.clicks), '平台点击，非独立客户'], ['进入会话', '未接通', '待关联广告来源'], ['有效询盘', '未接通', '待客服质量判定'], ['报价', '未接通', '待报价记录归因'], ['成交', '未接通', '待订单归因'],
    ].map(([label, value, note], i) => <article key={label} className={i > 1 ? 'ad-stage-missing' : ''}><small>0{i + 1}</small><h3>{label}</h3><strong>{value}</strong><span>{note}</span><div className="ad-stage-line" /></article>)}</div><p className="ads-muted">广告点击 → 会话转化率：未接通。已有客户和聊天记录不会自动计为广告带来的询盘。</p></section>
    <section className="ads-card"><div className="ads-section-title"><div><h2>花费与触达趋势</h2><p className="ads-muted">同一日期对照花费和平台结果，断点表示缺失，不是零。</p></div><label>对照指标<select value={series} onChange={e => setSeries(e.target.value as typeof series)}><option value="clicks">点击次数</option><option value="impressions">曝光次数</option></select></label></div>
      <div className="ad-chart" role="img" aria-label={`每日花费（${chosen}）与${series === 'clicks' ? '点击' : '曝光'}趋势；下方可展开原始数值表`}>{hasData ? <ResponsiveContainer width="100%" height={290}><ComposedChart data={data.daily} margin={{ top: 12, right: 24, left: 16, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="date" tickFormatter={v => v.slice(5)} minTickGap={24}/><YAxis yAxisId="money" width={66} label={{ value: chosen, position: 'insideTopLeft' }}/><YAxis yAxisId="count" orientation="right" width={50} allowDecimals={false}/><Tooltip labelFormatter={v => `${v}`} /><Legend/><Bar yAxisId="money" dataKey="spend" name={`花费 (${chosen})`} fill="#16886b" maxBarSize={28}/><Line yAxisId="count" dataKey={series} name={series === 'clicks' ? '点击 (次)' : '曝光 (次)'} stroke="#b97928" strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer> : <div className="ad-chart-empty">暂无可绘制的日数据<br/><small>现有接口仅返回其报告窗口；选择更长周期不会自动补齐历史。</small></div>}</div>
      <details><summary>数据核对：逐日数值与覆盖范围</summary><div className="ad-table-scroll"><table><caption>仅汇总当前币种已返回日数据；空值为“—”。</caption><thead><tr><th>日期</th><th>花费 ({chosen})</th><th>点击</th><th>曝光</th><th>有日记录的计划</th></tr></thead><tbody>{data.daily.map(r => <tr key={r.date}><td>{r.date}</td><td>{format(r.spend, 2)}</td><td>{format(r.clicks)}</td><td>{format(r.impressions)}</td><td>{r.reportingTasks}/{data.selected.length}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className="ads-card"><h2>报告来源与核对</h2><p className="ads-muted">保留平台原始报告口径，与上方日期筛选小计分开显示。未建立跨计划资源去重口径；请勿将重复映射的计划合计当作账户总账。</p><div className="ad-table-scroll"><table><thead><tr><th>计划</th><th>来源 / 状态</th><th>报告窗口</th><th>原报告花费</th><th>更新时间</th></tr></thead><tbody>{entries.map(e => <tr key={e.id}><td><button className="ads-text-button" onClick={() => onOpen(e.id)}>{e.name}</button></td><td>{e.error ? `读取失败：${e.error}` : e.report?.stale || e.report?.source === 'provider_snapshot' ? '历史快照 · 非实时' : e.report?.source === 'provider' ? '平台报告' : e.report?.reason || '数据未就绪'}</td><td>{e.report?.window ? `${e.report.window.since} — ${e.report.window.until}` : '—'}</td><td>{e.report?.currency || e.currency} {format(e.report?.spend ?? null, 2)}</td><td>{e.report?.reportedAt ? new Date(e.report.reportedAt).toLocaleString('zh-CN') : '—'}</td></tr>)}</tbody></table></div></section>
  </div>;
}
