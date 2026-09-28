import { useEffect, useRef, useState } from 'react';
import type { PlatformAdMetricHistory } from '../../shared/platformAdMetricHistory';
import { platformAdsRequest } from '../lib/platformAds';
import { dayRange } from '../lib/adOverview';

const today = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export default function AdMetricHistoryPanel({ tasks }: { tasks: Array<{ id: string; name: string }> }) {
  const [selected, setSelected] = useState('');
  const taskId = tasks.some(task => task.id === selected) ? selected : tasks[0]?.id || '';
  const [since, setSince] = useState(today(-6));
  const [until, setUntil] = useState(today());
  const [history, setHistory] = useState<PlatformAdMetricHistory | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const valid = dayRange(since, until).length > 0;
  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    setHistory(null); setError(''); setLoading(false);
    if (!taskId || !valid) return;
    setLoading(true);
    void platformAdsRequest<PlatformAdMetricHistory>(`/tasks/${encodeURIComponent(taskId)}/metrics/history?since=${since}&until=${until}`, { signal: controller.signal })
      .then(result => { if (version === generation.current) setHistory(result); })
      .catch(error => { if (version === generation.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : '历史指标读取失败'); })
      .finally(() => { if (version === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [taskId, since, until, valid, refresh]);
  async function sync() {
    if (!taskId || syncing) return;
    setSyncing(true); setError('');
    const version = generation.current;
    try {
      await platformAdsRequest(`/tasks/${encodeURIComponent(taskId)}/metrics/sync`, { method: 'POST' });
      if (generation.current === version) setRefresh(value => value + 1);
    } catch (error) { if (generation.current === version) setError(error instanceof Error ? error.message : '指标保存失败'); }
    finally { setSyncing(false); }
  }
  return <section className="ads-card" aria-label="投放绩效历史表">
    <div className="ads-section-title"><div><h2>投放绩效历史表</h2><p className="ads-muted">查看已保存的平台日数据；按资源列示，不合并不同币种或结果口径。</p></div><button className="ads-button" disabled={!taskId || syncing} onClick={() => void sync()}>{syncing ? '正在保存…' : '同步并保存近 7 天'}</button></div>
    <div className="ad-toolbar"><label>历史指标计划<select value={taskId} disabled={syncing || !tasks.length} onChange={e => setSelected(e.target.value)}>{tasks.map(task => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label><label>历史开始日期<input type="date" value={since} max={until} disabled={syncing} onChange={e => setSince(e.target.value)} /></label><label>历史结束日期<input type="date" value={until} min={since} max={today()} disabled={syncing} onChange={e => setUntil(e.target.value)} /></label></div>
    <p className="ads-muted">同步会读取平台报告并保存到本系统。筛选只读取已存记录，不会补采历史；缺失值显示“—”。账户时区未知时保留平台报告日期，不转换时区。</p>
    {!valid && <p role="alert">请选择有效日期范围（最多 366 天）。</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">正在读取已保存指标…</p>}
    {history && <><p className="ads-muted">{history.dataNote}</p><div className="ad-table-scroll"><table><caption>已保存的资源日指标 · 非实时</caption><thead><tr><th>日期 / 时区</th><th>平台 / 账户 / 广告系列</th><th>花费 / 币种</th><th>曝光</th><th>点击</th><th>平台结果 / 口径</th><th>采集时间</th></tr></thead><tbody>{history.items.map(row => <tr key={row.id}><td>{row.date}<br/><small>{row.reportTimezone || '账户时区未知'}</small></td><td>{row.provider}<br/>{row.accountId}<br/>{row.campaignId}</td><td>{row.currency} {number(row.values.spend)}</td><td>{number(row.values.impressions)}</td><td>{number(row.values.clicks)}</td><td>{number(row.values.results)}<br/><small>{row.metricLabel}</small></td><td>{new Date(row.reportedAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>{!history.items.length && <p>所选周期暂无已保存指标。</p>}</>}
    {!tasks.length && <p>创建投放计划后可查看历史绩效。</p>}
  </section>;
}
