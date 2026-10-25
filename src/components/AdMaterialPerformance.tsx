import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Input, Pagination, Select, Space, Table, Tag } from 'antd';
import type { AdMaterialDirectory, AdMaterialDirectoryItem } from '../../shared/adMaterialDirectory';
import { materialReportGroups } from '../../shared/adMaterialDirectory';
import type { AdCreativeReport } from '../../shared/platformAdCreativeLibrary';
import type { AdMaterialSelection } from '../../shared/platformAdCreatives';
import type { MetaAdAsset } from '../../shared/adAccountDirectory';
import { PLATFORM_AD_GOALS } from '../../shared/platformAdCapabilities';
import { platformAdsRequest } from '../lib/platformAds';
import AdHistoryMedia from './AdHistoryMedia';
import AdSourceLifecycle from './AdSourceLifecycle';
import { useAdAccountDirectory } from './AdAccountDirectory';
import { LsMediaStateFrame, LsProgressiveMedia } from './ui/LsExperiencePrimitives';
import './adCreativeLibrary.css';
const n = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const message = (e: unknown) => e instanceof Error ? e.message : '素材数据暂不可读';
function NativeMaterial({ item }: { item: AdMaterialDirectoryItem }) {
  const ad = item.ads[0];
  const [asset, setAsset] = useState<MetaAdAsset | null>(null), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const c = new AbortController(); setAsset(null); setError(''); setLoaded(false);
    platformAdsRequest<MetaAdAsset>(`/connections/${encodeURIComponent(ad.connectionId)}/history/${encodeURIComponent(ad.accountId)}/ads/${encodeURIComponent(ad.adId)}/creative`, { signal: c.signal })
      .then(value => { if (!c.signal.aborted) setAsset(value); }).catch(e => { if (!c.signal.aborted) setError(message(e)); });
    return () => c.abort();
  }, [item.key]);
  return <><LsMediaStateFrame state={loaded ? 'ready' : error || asset && !asset.thumbnailUrl ? 'error' : 'loading'} label={error || '读取平台广告封面'}>
    {asset?.thumbnailUrl && <LsProgressiveMedia src={asset.thumbnailUrl} alt={item.name} preview={false} width="100%" height="100%" style={{ objectFit: 'contain' }} onLoad={() => setLoaded(true)} onError={() => setError('平台封面暂不可用')}/>}
  </LsMediaStateFrame><Tag>平台广告 · 原片尚未关联</Tag>{asset && <p>配置：{asset.configuredStatus || '未返回'} · 有效：{asset.effectiveStatus || '未返回'}</p>}</>;
}
function Metrics({ item, reports, errors }: { item: AdMaterialDirectoryItem; reports: Record<string, AdCreativeReport>; errors: Record<string, string> }) {
  const expected = item.ads.filter(a => a.executionId), available = expected.flatMap(a => reports[a.executionId!] ? [{ ...reports[a.executionId!], market: a.market || '市场未返回' }] : []);
  const groups = materialReportGroups(available);
  if (!item.ads.length) return <p>尚无已核验广告关联 · 暂无投放数据</p>;
  if (!expected.length) {
    const ad = item.ads[0], history = ad.history;
    return history ? <><p>花费 {ad.currency} {n(history.metrics.spend)} · 展示 {n(history.metrics.impressions)}</p><p>Meta 线索 {n(history.metrics.leads)} · 消息会话 {n(history.metrics.messagingConversations)}</p><p>Meta 购买 ROAS {n(history.metrics.purchaseRoas)}（非利润 ROI）</p><small>平台可用历史 {history.since} — {history.until} · {ad.timezone || '时区未返回'}</small></> : <p>平台报告尚未返回</p>;
  }
  return <>{available.length !== expected.length && <p role="status">已返回 {available.length}/{expected.length} 条广告报告，尚不能视为完整小计。</p>}{expected.some(a => errors[a.executionId!]) && <p role="alert">部分广告报告读取失败，请刷新重试。</p>}{groups.map((g, index) => <div key={index}><p>{g.currency} {n(g.spend)} 消耗 · {g.metricLabel} {n(g.results)}</p><p>加权单次结果成本 {g.currency} {n(g.derivedCost)} · {g.adCount} 条广告</p><small>{g.market} · {g.window.since} — {g.window.until} · {g.reportTimezone} · 采集 {new Date(g.reportedAt).toLocaleString('zh-CN')}</small></div>)}</>;
}
function MaterialSummary({ item, reports, errors }: { item: AdMaterialDirectoryItem; reports: Record<string, AdCreativeReport>; errors: Record<string, string> }) {
  if (!item.ads.length) return <span className="ads-library-meta">暂无投放数据</span>;
  const expected = item.ads.filter(a => a.executionId);
  if (!expected.length) {
    const ad = item.ads[0], metrics = ad.history?.metrics;
    return metrics ? <><div>{ad.currency} {n(metrics.spend)} 消耗</div><small>展示 {n(metrics.impressions)} · 平台历史</small></> : <span>平台报告待返回</span>;
  }
  if (expected.some(a => errors[a.executionId!])) return <span>部分报告读取失败 · 查看详情</span>;
  const available = expected.flatMap(a => reports[a.executionId!] ? [{ ...reports[a.executionId!], market: a.market || '市场未返回' }] : []);
  if (available.length !== expected.length) return <span>报告已返回 {available.length}/{expected.length}</span>;
  const groups = materialReportGroups(available);
  if (groups.length !== 1) return <span>{groups.length} 组投放结果 · 查看详情</span>;
  const group = groups[0];
  return <><div>{group.currency} {n(group.spend)} 消耗 · {group.metricLabel} {n(group.results)}</div><small>单次结果 {group.currency} {n(group.derivedCost)}</small></>;
}
export default function AdMaterialPerformance({ onCreate, onOpenTask, initialTaskId, onClearTask }: { onClearTask?: () => void; onCreate: (source: AdMaterialSelection) => void; onOpenTask: (id: string) => void; initialTaskId?: string }) {
  const directory = useAdAccountDirectory();
  const [searchInput, setSearchInput] = useState(''), [search, setSearch] = useState(''), [origin, setOrigin] = useState('all'), [goal, setGoal] = useState(''), [account, setAccount] = useState('');
  const [taskFilter, setTaskFilter] = useState(initialTaskId || ''), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ query: string; data: AdMaterialDirectory } | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [reports, setReports] = useState<Record<string, AdCreativeReport>>({}), [errors, setErrors] = useState<Record<string, string>>({}), [reportQuery, setReportQuery] = useState('');
  const [selected, setSelected] = useState('');
  useEffect(() => { setTaskFilter(initialTaskId || ''); setPage(1); }, [initialTaskId]);
  const params = new URLSearchParams({ page: String(page), perPage: '12', origin, ...(search.trim() ? { search: search.trim() } : {}), ...(goal ? { goal } : {}), ...(account ? { accountId: account } : {}), ...(taskFilter ? { taskId: taskFilter } : {}) });
  const query = params.toString(), data = snapshot?.query === query ? snapshot.data : null;
  useEffect(() => {
    const c = new AbortController(); setLoading(true); setError(''); setSelected('');
    platformAdsRequest<AdMaterialDirectory>(`/material-directory?${query}`, { signal: c.signal }).then(value => { if (!c.signal.aborted) setSnapshot({ query, data: value }); }).catch(e => { if (!c.signal.aborted) setError(message(e)); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [query, refresh]);
  const ids = [...new Set(data?.items.flatMap(i => i.ads.flatMap(a => a.executionId ? [a.executionId] : [])) || [])].join(',');
  useEffect(() => {
    const c = new AbortController(); setReportQuery(query); setReports({}); setErrors({});
    const list = ids.split(',').filter(Boolean);
    void (async () => { for (let i = 0; i < list.length; i += 2) {
      await Promise.all(list.slice(i, i + 2).map(async id => { try { const report = await platformAdsRequest<AdCreativeReport>(`/creative-library/${encodeURIComponent(id)}/report`, { signal: c.signal }); if (!c.signal.aborted) setReports(old => ({ ...old, [id]: report })); } catch (e) { if (!c.signal.aborted) setErrors(old => ({ ...old, [id]: message(e) })); } }));
      if (c.signal.aborted) return;
    } })();
    return () => c.abort();
  }, [ids, query, refresh]);
  const current = reportQuery === query ? reports : {}, currentErrors = reportQuery === query ? errors : {};
  const opened = data?.items.find(i => i.key === selected);
  const chooseFilter = (setter: (v: string) => void) => (value: string) => { setter(value); setPage(1); };
  return <section className="ads-library ads-material-performance" aria-label="素材投放表现">
    <div className="ads-material-filter-scroll" role="group" aria-label="素材筛选工具栏" tabIndex={0}><div className="ads-library-toolbar"><Input.Search aria-label="搜索素材与计划" placeholder="搜索素材、计划或市场" allowClear value={searchInput} onChange={e => { setSearchInput(e.target.value); if (!e.target.value) chooseFilter(setSearch)(''); }} onSearch={chooseFilter(setSearch)}/>
      <Select aria-label="素材来源" value={origin} onChange={chooseFilter(setOrigin)} options={[{ value: 'all', label: '全部素材来源' }, { value: 'local', label: '当前企业素材' }, { value: 'external', label: '已接入企业 · 只读' }, { value: 'platform', label: '平台广告 · 原片待关联' }]}/>
      <Select aria-label="素材推广目标" value={goal} onChange={chooseFilter(setGoal)} options={[{ value: '', label: '全部计划目标' }, ...PLATFORM_AD_GOALS.map(value => ({ value, label: value }))]}/>
      <Select aria-label="素材广告账户" value={account} onChange={chooseFilter(setAccount)} options={[{ value: '', label: '全部授权账户' }, ...directory.items.map(a => ({ value: a.accountId, label: `${a.name} · ${a.currency}` }))]}/>
      <Button loading={loading} onClick={() => setRefresh(v => v + 1)}>刷新表现</Button>
    </div></div>
    {taskFilter && <Space><Tag>当前计划关联素材</Tag><Button type="link" onClick={() => { setTaskFilter(''); setPage(1); onClearTask?.(); }}>查看全部计划素材</Button></Space>}
    {error && <Alert type="error" showIcon title={error} description="目录读取失败不代表没有素材，请刷新重试。"/>}
    {data?.warnings.map(w => <Alert key={w} type="warning" showIcon title={w}/>)}
    {data?.truncated && <Alert type="warning" showIcon title="当前目录未完整返回，数量与筛选仅覆盖已读取记录。"/>}
    {data && <p role="status">已读取 {data.totalItems} 条素材／待关联广告记录 · 目录更新 {new Date(data.checkedAt).toLocaleString('zh-CN')}</p>}
    <Table<AdMaterialDirectoryItem> className="ads-material-table" size="small" rowKey="key" loading={loading} dataSource={data?.items || []} pagination={false} scroll={{ x: 926 }} locale={{ emptyText: error ? '目录尚未读取成功' : '当前筛选没有匹配素材' }} columns={[
      { title: '缩略图', key: 'thumbnail', width: 88, render: (_, item) => <div className="ads-material-table-thumbnail">{item.source ? <AdHistoryMedia key={`${item.key}:${refresh}`} source={item.source} refresh={refresh} mediaOnly thumbnailOnly/> : <NativeMaterial item={item}/>}</div> },
      { title: '素材', key: 'name', width: 260, render: (_, item) => <><Button type="link" className="ads-material-table-name" title={item.name} onClick={() => setSelected(item.key)}>{item.name}</Button></> },
      { title: '来源', key: 'source', width: 110, render: (_, item) => <small>{item.source?.sourceTenantName || (item.source ? '当前企业' : item.ads[0]?.accountName)}{item.source?.sourceId ? ' · 只读' : ''}</small> },
      { title: '关联投放', key: 'plans', width: 130, render: (_, item) => <>{item.plans.length} 个计划 · {item.ads.length} 条广告</> },
      { title: '投放表现', key: 'performance', width: 220, render: (_, item) => <MaterialSummary item={item} reports={current} errors={currentErrors}/> },
      { title: '操作', key: 'actions', width: 118, render: (_, item) => <Button size="small" onClick={() => setSelected(item.key)}>详情与复用</Button> },
    ]}/>
    {data && <Pagination current={page} pageSize={12} total={data.totalItems} showSizeChanger={false} onChange={setPage}/>}
    <Drawer title={opened?.name || '素材投放表现'} open={!!opened} onClose={() => setSelected('')} size={900} destroyOnHidden>
      {opened && <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Metrics item={opened} reports={current} errors={currentErrors}/>
        <Table rowKey="id" pagination={false} dataSource={opened.plans} scroll={{ x: 560 }} columns={[{ title: '关联计划', key: 'name', render: (_, p) => <Button type="link" onClick={() => onOpenTask(p.id)}>{p.name}</Button> }, { title: '推广目标', dataIndex: 'goal' }, { title: '市场', dataIndex: 'market' }]}/>
        {opened.source ? <><AdHistoryMedia key={`detail:${opened.key}:${refresh}`} source={opened.source} refresh={refresh} onSelect={onCreate} selectLabel="用此素材创编计划"/>
          <Collapse items={[{ key: 'evidence', label: '文件版本与完整关联报告', children: <AdSourceLifecycle origin={opened.source.origin} {...(opened.source.sourceId ? { sourceId: opened.source.sourceId } : {})} {...(opened.source.origin === 'studio' ? { projectId: opened.source.projectId } : { sourceTaskId: opened.source.sourceTaskId, artifactId: opened.source.artifactId })}/> }]}/></> : <><NativeMaterial item={opened}/><Alert type="info" showIcon title="可查看平台表现，暂不能直接复用原片" description="系统尚未确认本地文件与使用权限。不会按广告名称猜测原文件。"/></>}
        <Descriptions column={1} items={[{ key: 'scope', label: '结果说明', children: 'Meta 线索、消息会话和购买 ROAS 分别展示；尚无可核验的 CRM 有效询盘或利润 ROI。' }]}/>
      </Space>}
    </Drawer>
  </section>;
}
