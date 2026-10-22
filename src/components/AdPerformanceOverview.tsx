import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Collapse, DatePicker, Input, Pagination, Select, Space, Table, Tag, Tooltip } from 'antd';
import { RefreshCw, Download } from 'lucide-react';
import dayjs from 'dayjs';
import { platformAdsRequest } from '../lib/platformAds';
import type { AdCreativeLibraryPage, AdCreativeLibraryItem } from '../../shared/platformAdCreativeLibrary';
import { META_PERFORMANCE_FIELDS, metaAccountDate, metaDateRange, metaPerformanceSummary, type MetaPerformanceReport, type MetaMetricKey, type MetaReportLevel } from '../../shared/metaPerformance';
import { LsMetricStrip } from './ui/LsExperiencePrimitives';
import LsDataChart from './ui/LsDataChart';
import './metaPerformance.css';

type Task = { id: string; name: string; currency: string; budget: string | number };
const format = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const labels: Record<string, string> = { PAUSED: '暂停', ACTIVE: '启用', PENDING_REVIEW: '待审核', WITH_ISSUES: '存在问题', DISAPPROVED: '审核未通过', IN_PROCESS: '处理中', CAMPAIGN_PAUSED: '广告系列暂停', ADSET_PAUSED: '广告组暂停' };
const levelLabels = { campaign: '广告系列', adset: '广告组', ad: '广告' };
const metricKeys = Object.keys(META_PERFORMANCE_FIELDS) as MetaMetricKey[];
const defaultColumns: MetaMetricKey[] = ['spend', 'impressions', 'clicks', 'linkClicks', 'thruPlays', 'cpm', 'ctr'];
const errorText = (e: unknown) => e instanceof Error ? e.message : '读取失败，请稍后刷新';
const fieldRef = (key: MetaMetricKey) => { const def = META_PERFORMANCE_FIELDS[key]; return def.field + ('actionType' in def ? `[${def.actionType}]` : ''); };
const resource = (i: AdCreativeLibraryItem, level: MetaReportLevel) => i.execution?.[level === 'campaign' ? 'campaignId' : level === 'adset' ? 'adsetId' : 'adId'] || '';
export default function AdPerformanceOverview({ loading, onOpen, initialTaskId }: { tasks: Task[]; loading: boolean; onOpen: (id: string) => void; initialTaskId?: string }) {
  const [taskFilter, setTaskFilter] = useState(initialTaskId || '');
  const [catalog, setDirectory] = useState<AdCreativeLibraryPage | null>(null), [page, setPage] = useState(1), [catalogRefresh, setCatalogRefresh] = useState(0), [catalogBusy, setCatalogBusy] = useState(false);
  const directory = catalog?.page === page ? catalog : null;
  const [error, setError] = useState(''), [account, setAccount] = useState(''), [level, setLevel] = useState<MetaReportLevel>('campaign'), [preset, setPreset] = useState('7');
  const [range, setRange] = useState<[string, string] | null>(null), [search, setSearch] = useState(''), [columns, setColumns] = useState<MetaMetricKey[]>(defaultColumns);
  const [reports, setReports] = useState<Record<string, MetaPerformanceReport>>({}), [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setCatalogBusy(true); setError('');
    platformAdsRequest<AdCreativeLibraryPage>(`/creative-library?page=${page}&perPage=20`, { signal: abort.signal }).then(v => { if (!abort.signal.aborted) setDirectory(v); }).catch(e => { if (!abort.signal.aborted) setError(errorText(e)); }).finally(() => { if (!abort.signal.aborted) setCatalogBusy(false); });
    return () => abort.abort();
  }, [page, catalogRefresh]);
  const accounts = useMemo(() => {
    const items = directory?.items.filter(i => i.connection.provider === 'meta') || [];
    return [...new Map([...items.filter(i => i.execution), ...items].map(i => [i.connection.id, i.connection])).values()];
  }, [directory]);
  const selectedAccount = accounts.find(a => a.id === account) || accounts.find(a => directory?.items.some(i => i.task.id === taskFilter && i.connection.id === a.id)) || accounts[0];
  const rows = useMemo(() => [...new Map((directory?.items || []).filter(i => i.connection.id === selectedAccount?.id && i.execution && (!taskFilter || i.task.id === taskFilter)).map(i => [resource(i, level), i])).values()], [directory, selectedAccount?.id, level, taskFilter]);
  const ids = rows.map(i => i.execution!.id).join(',');
  const valid = preset !== 'custom' || !!range && metaDateRange(...range).length > 0;
  const query = new URLSearchParams({ level, preset, ...(preset === 'custom' && range ? { since: range[0], until: range[1] } : {}) }).toString();
  const scope = `${selectedAccount?.id}:${ids}:${query}`;
  const [reportScope, setReportScope] = useState('');
  const current = valid && scope === reportScope ? reports : {};
  const currentErrors = valid && scope === reportScope ? errors : {};
  useEffect(() => {
    if (!valid || !ids) { setBusy(false); return; }
    const abort = new AbortController(); setBusy(true); setErrors({});
    if (reportScope !== scope) setReports({});
    setReportScope(scope);
    void (async () => {
      // Two concurrent resources at most; repeated identical reads are coalesced server-side.
      for (let n = 0; n < rows.length; n += 2) {
        await Promise.all(rows.slice(n, n + 2).map(async item => {
          const id = item.execution!.id;
          try { const report = await platformAdsRequest<MetaPerformanceReport>(`/performance/${id}?${query}`, { signal: abort.signal }); if (!abort.signal.aborted) setReports(old => ({ ...old, [id]: report })); }
          catch (e) { if (!abort.signal.aborted) setErrors(old => ({ ...old, [id]: errorText(e) })); }
        }));
        if (abort.signal.aborted) return;
      }
      setBusy(false);
    })();
    return () => abort.abort();
  }, [scope, refresh, valid]);
  const successful = rows.flatMap(i => current[i.execution!.id] ? [current[i.execution!.id]] : []);
  const summary = metaPerformanceSummary(successful, rows.length), currency = selectedAccount?.currency || '';
  const first = successful[0];
  useEffect(() => {
    if (!first || preset === 'custom') return;
    const check = () => { if (metaAccountDate(first.reportTimezone) !== first.window.until) setRefresh(n => n + 1); };
    const timer = window.setInterval(check, 60_000); window.addEventListener('focus', check); check();
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [first?.reportTimezone, first?.window.until, preset]);
  const dates = first ? metaDateRange(first.window.since, first.window.until) : [];
  const displayedRows = rows.filter(i => !search || `${i.task.name} ${resource(i, level)}`.toLowerCase().includes(search.toLowerCase()));
  const exportRows = () => {
    const cell = (v: unknown) => { const s = String(v ?? ''); return `"${(/^[\s\u0000-\u001f]*[=+@-]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`; };
    const data = [['计划', '账户', '层级', '资源 ID', '币种', '账户时区', '开始日期', '结束日期', '采集时间', '刷新错误', ...columns.map(fieldRef)], ...displayedRows.map(i => { const r = current[i.execution!.id]; return [i.task.name, i.connection.accountId, level, resource(i, level), r?.currency, r?.reportTimezone, r?.window.since, r?.window.until, r?.reportedAt, currentErrors[i.execution!.id] || '', ...columns.map(k => r?.totals?.[k] ?? '')]; })];
    const url = URL.createObjectURL(new Blob(['\uFEFF', data.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `Meta-${level}-报告.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="meta-performance" aria-label="Meta 真实投放数据">
    <div className="meta-performance-toolbar">
      <Select aria-label="计划范围" value={taskFilter} onChange={v => { setTaskFilter(v); setAccount(''); }} options={[{ value: '', label: '本页全部计划' }, ...[...new Map((directory?.items || []).map(i => [i.task.id, i.task])).values()].map(t => ({ value: t.id, label: t.name }))]} />
      <Select aria-label="广告账户" value={selectedAccount?.id} placeholder="选择 Meta 广告账户" onChange={setAccount} options={accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` }))} />
      <Select aria-label="报告层级" value={level} onChange={setLevel} options={Object.entries(levelLabels).map(([value, label]) => ({ value, label }))} />
      <Select aria-label="报告周期" value={preset} onChange={setPreset} options={[{ value: '1', label: '今天（账户时区）' }, { value: '7', label: '近 7 天（含今天）' }, { value: '30', label: '近 30 天（含今天）' }, { value: 'custom', label: '自定义日期' }]} />
      {preset === 'custom' && <DatePicker.RangePicker aria-label="账户报告日期" value={range ? [dayjs(range[0]), dayjs(range[1])] : null} onChange={dates => setRange(dates?.[0] && dates[1] ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')] : null)} />}
      <Button icon={<RefreshCw size={15}/>} loading={busy || catalogBusy || loading} disabled={!valid} onClick={() => { setRefresh(v => v + 1); setCatalogRefresh(v => v + 1); }}>刷新数据</Button>
    </div>
    {error && <Alert type="error" showIcon title={error} description={directory ? '目录刷新失败；保留同页上次结果，不代表平台最新状态。' : '当前页目录读取失败；未使用其他页的数据，请重试。'} />}
    {!valid && <Alert type="warning" showIcon title="请选择开始和结束日期，最多 93 天；日期按广告账户时区解释。" />}
    <Space wrap role="status" aria-live="polite"><Tag>Meta 平台报告</Tag><span>{busy ? '读取中 · ' : ''}{successful.length}/{rows.length} 个去重资源已返回 · {successful.filter(r => !r.totals).length} 个空报告</span>{first && <span>{first.window.since} — {first.window.until} · {first.reportTimezone} · {currency}</span>}</Space>
    {Object.keys(currentErrors).length > 0 && <Alert type="warning" showIcon title="部分平台报告刷新失败；保留同一筛选范围内最后一次成功报告，以采集时间为准，不补零。" />}
    <LsMetricStrip items={(['spend', 'impressions', 'clicks', 'linkClicks'] as const).map(key => ({ key, label: `${META_PERFORMANCE_FIELDS[key].label}${key === 'spend' && currency ? ` (${currency})` : ''}`, value: format(summary[key]) }))} />
    <Collapse ghost items={[{ key: 'definition', label: '统计口径与数据范围', children: <div className="meta-performance-notes"><p>仅当前计划页、所选账户与层级的已核验资源小计，不是完整账户总账；按平台资源 ID 去重，不跨账户、币种或时区汇总。缺失字段和空报告保持“—”，真零保留 0。</p><p>日期筛选会重新请求 Meta。账户币种、时区由 Meta 读回；报告按展示时间（action_report_time=impression）回报，使用广告组统一归因设置，不假定固定归因窗口。报告缓存 60 秒，平台可能延迟或回补。</p><p>全部点击 clicks 与链接点击 inline_link_clicks 不同。ThruPlay 读取 video_thruplay_watched_actions 中的 video_view，不用 3 秒播放代替。CPM、CPC、CTR、覆盖人数、频次和单次成本直接采用所选窗口的 Meta 汇总，不平均日比率、不累加去重人数。</p><p>不把点击或播放当询盘，不展示无归因收入、ROAS 或虚构漏斗；目标不同的结果不混为同一“转化”。</p></div> }]} />
    <LsDataChart title={`每日广告花费${currency ? ` (${currency})` : ''}`} kind="line" unit={currency} loading={busy && !successful.length} labels={dates} series={rows.slice(0, 5).map(i => ({ label: i.task.name, values: dates.map(date => current[i.execution!.id]?.daily.find(d => d.date === date)?.spend ?? null) }))} />
    <div className="meta-performance-toolbar">
      <Input.Search aria-label="搜索当前报告" placeholder="仅搜索明细（不改变上方小计）：计划或资源 ID" value={search} onChange={e => setSearch(e.target.value)} allowClear />
      <Select aria-label="自定义指标列" mode="multiple" maxTagCount="responsive" value={columns} onChange={setColumns} options={metricKeys.map(k => ({ value: k, label: META_PERFORMANCE_FIELDS[k].label }))} />
      <Button icon={<Download size={15}/>} disabled={!successful.length || busy} onClick={exportRows}>导出当前报告</Button>
    </div>
    <Table<AdCreativeLibraryItem> size="small" tableLayout="fixed" rowKey={i => resource(i, level)} dataSource={displayedRows} loading={catalogBusy && !directory} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 720 + columns.length * 135 }} columns={[
      { title: `${levelLabels[level]} / 本地计划`, width: 250, fixed: 'left', render: (_, i) => <><Button className="meta-performance-task" type="link" onClick={() => onOpen(i.task.id)}>{i.task.name}</Button><p>{resource(i, level)}</p></> },
      { title: '平台状态 / 目标', width: 180, render: (_, i) => { const r = current[i.execution!.id]; return r ? <><p>配置：{labels[r.configuredStatus] || r.configuredStatus || '未知'}</p><p>有效：{labels[r.effectiveStatus] || r.effectiveStatus || '未知'}</p>{level !== 'ad' && <p>关联广告：{labels[r.adEffectiveStatus] || r.adEffectiveStatus || '未知'}</p>}<p>{r.optimizationGoal || r.objective || '未返回目标'}</p>{r.issues.map(issue => <p key={issue.code}>{issue.code} · {issue.message}</p>)}</> : currentErrors[i.execution!.id] || (busy ? '读取中' : '暂无报告'); } },
      ...columns.map(key => ({ title: <Tooltip title={`Meta 字段：${fieldRef(key)}`}><span>{META_PERFORMANCE_FIELDS[key].label}{META_PERFORMANCE_FIELDS[key].unit === 'money' ? ` (${currency})` : META_PERFORMANCE_FIELDS[key].unit === 'percent' ? ' (%)' : ''}</span></Tooltip>, key, width: 135, align: 'right' as const, render: (_: unknown, i: AdCreativeLibraryItem) => format(current[i.execution!.id]?.totals?.[key]) })),
      { title: '来源 / 采集时间', width: 290, render: (_, i) => { const r = current[i.execution!.id]; return r ? <><p>{r.totals ? 'Meta 平台汇总' : 'Meta 返回空报告'}</p><p>{r.window.since} — {r.window.until}</p><p>{r.reportTimezone} · {new Date(r.reportedAt).toLocaleString('zh-CN')}</p><p>展示时间回报 · 关联广告组归因设置</p><p>{r.attributionSpec.length ? r.attributionSpec.map(a => `${a.event_type} ${a.window_days} 天`).join(' / ') : '归因窗口未返回，不推断'}</p>{currentErrors[i.execution!.id] && <p role="alert">旧报告 · {currentErrors[i.execution!.id]}</p>}</> : '—'; } },
    ]}/>
    {catalog && <div className="meta-performance-footer"><span>{directory ? `按本地计划分页 · 本页 ${directory.items.filter(i => i.connection.id === selectedAccount?.id && !i.execution && (!taskFilter || i.task.id === taskFilter)).length} 个关联尚无完整广告回执；不计入报告。${directory.truncated ? '本页目录存在截断，非完整总账。' : ''}` : '当前页目录未返回，可刷新或返回其他页。'}</span><Pagination current={page} pageSize={20} total={catalog.totalItems} showSizeChanger={false} onChange={setPage} /></div>}
  </div>;
}
