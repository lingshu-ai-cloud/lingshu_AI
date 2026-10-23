import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Drawer, Input, Pagination, Select, Space, Table, Tag } from 'antd';
import type { AdSourceCatalog as Catalog, AdSourceEntry, AdHistorySource } from '../../shared/adSourceLifecycle';
import { platformAdsRequest } from '../lib/platformAds';
import AdSourceLifecycle from './AdSourceLifecycle';
import AdHistoryMedia from './AdHistoryMedia';
import type { AdMaterialSelection } from '../../shared/platformAdCreatives';
type SelectionProps = { onSelect?: (selection: AdMaterialSelection) => void; blockedReason?: string };
export default function AdSourceCatalog({ onSelect, blockedReason }: SelectionProps = {}) {
  const [sources, setSources] = useState<AdHistorySource[]>([]), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [filter, setFilter] = useState('all');
  useEffect(() => {
    const c = new AbortController(); setFailed(false); setLoading(true);
    platformAdsRequest<{ items: AdHistorySource[] }>('/creative-history-sources', { signal: c.signal }).then(r => { if (!c.signal.aborted) setSources(r.items); }).catch(() => { if (!c.signal.aborted) setFailed(true); }).finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [refresh]);
  const visible = sources.filter(s => filter === 'all' || filter === s.id);
  return <section className={`ads-history-groups${visible.length > 1 ? ' is-multi' : ''}`} aria-label="企业创作素材">
    <div className="ads-library-toolbar"><Select aria-label="企业素材范围" value={filter} onChange={setFilter} options={[{ value: 'all', label: '全部已接入企业（分别展示）' }, ...sources.map(s => ({ value: s.id, label: s.tenantName })), { value: 'studio', label: '当前企业 · 我的历史素材' }, { value: 'social', label: '当前企业 · 社媒成片' }]}/><Button onClick={() => setRefresh(n => n + 1)}>刷新全部</Button></div>
    {failed && <Alert type="warning" showIcon title="企业素材来源暂未更新" description="请重试刷新，不会自动切换到其他企业。"/>}
    {onSelect && filter === 'all' && <section className="ads-history-group"><h3>当前企业 · 成片素材</h3><DatasetCatalog key={`selectable:${refresh}`} initialDataset="social" onSelect={onSelect} blockedReason={blockedReason}/></section>}
    {visible.map(source => <section key={source.id} className="ads-history-group"><Space wrap><h3>{source.tenantName}</h3><Tag>{source.label}</Tag></Space><DatasetCatalog key={`${source.id}:${refresh}`} initialDataset={`external:${source.id}`} onSelect={onSelect} blockedReason={blockedReason}/></section>)}
    {['studio', 'social'].includes(filter) && <DatasetCatalog key={`${filter}:${refresh}`} initialDataset={filter} onSelect={onSelect} blockedReason={blockedReason}/>}
    {!loading && !failed && !sources.length && filter === 'all' && <Alert type="info" showIcon title="暂无已接入的外部企业来源" description="可选择当前企业查看已有素材。"/>}
  </section>;
}
function DatasetCatalog({ initialDataset, onSelect, blockedReason }: { initialDataset: string } & SelectionProps) {
  const [search, setSearch] = useState('');
  const dataset = initialDataset;
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const origin = dataset === 'social' ? 'social' : 'studio', sourceId = dataset.startsWith('external:') ? dataset.slice(9) : '';
  const [snapshot, setData] = useState<{ key: string; value: Catalog } | null>(null), [selected, setSelected] = useState<AdSourceEntry | null>(null);
  const key = `${dataset}:${page}`, data = snapshot?.key === key ? snapshot.value : null;
  useEffect(() => {
    const c = new AbortController(); setBusy(true); setError('');
    platformAdsRequest<Catalog>(`/creative-history?${new URLSearchParams({ origin, page: String(page), perPage: '5', ...(sourceId ? { sourceId } : {}) })}`, { signal: c.signal }).then(value => { if (!c.signal.aborted) setData({ key, value }); }).catch(e => { if (!c.signal.aborted) setError(e.message || '来源读取失败'); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [key, refresh]);
  return <section aria-label="历史素材与社媒成片来源" style={{ minWidth: 0, maxWidth: '100%' }}>
    <div className="ads-library-toolbar"><Input.Search aria-label="搜索本页创作素材" placeholder="搜索本企业当前页素材" allowClear value={search} onChange={e => setSearch(e.target.value)}/><Button loading={busy} onClick={() => setRefresh(n => n + 1)}>刷新素材</Button></div>
    {error && <Alert type="error" showIcon title={error} description={data ? '保留同页来源快照，请重试。' : '当前来源未返回，不使用其他数据集冒充。'}/>}
    <Table<AdSourceEntry> tableLayout="fixed" rowKey="key" loading={busy && !data} dataSource={(data?.items || []).filter(r => r.name.toLowerCase().includes(search.trim().toLowerCase()))} locale={{ emptyText: search ? '本页没有匹配的素材，请调整搜索或翻页。' : '当前来源暂无素材，可切换来源查看。' }} pagination={false} scroll={{ x: 480 }} columns={[
      { title: '预览 / 投放状态', width: 160, render: (_, r) => <AdHistoryMedia key={`${r.key}:${r.sourceRevision || ''}`} source={r} refresh={refresh} onSelect={onSelect} blockedReason={blockedReason}/> },
      { title: '素材 / 创作项目', dataIndex: 'name', render: (_, r) => <div className="ads-source-name"><span>{r.name}</span><Tag>{r.sourceTenantName || '当前企业'}</Tag></div> },
      { title: '操作', width: 88, render: (_, r) => <Button type="link" onClick={() => setSelected(r)}>查看详情</Button> },
    ]}/>
    {snapshot && <div className="ads-library-pagination"><Pagination current={page} pageSize={5} total={snapshot.key.startsWith(`${dataset}:`) ? snapshot.value.totalItems : 0} showTotal={total => `${total} 条 · 企业分别展示，不合并统计`} showSizeChanger={false} onChange={v => { setPage(v); setSelected(null); }}/></div>}
    <Drawer title={selected?.name || '素材投放生命周期'} open={!!selected} onClose={() => setSelected(null)} width="min(880px, 100vw)" destroyOnHidden>
      {selected && <><Space wrap><Tag>{selected.sourceTenantName || '当前企业'}</Tag><Tag>创作素材</Tag></Space><AdSourceLifecycle origin={selected.origin} {...(selected.sourceId ? { sourceId: selected.sourceId } : {})} {...(selected.origin === 'studio' ? { projectId: selected.projectId } : { sourceTaskId: selected.sourceTaskId, artifactId: selected.artifactId })}/><Collapse items={[{ key: 'source', label: '原始记录与关联说明', children: <><p>{selected.note}</p><p className="ads-library-id">来源企业：{selected.sourceTenantId || '当前企业'}<br/>版本：{selected.sha256 || '尚未核验'}</p></> }]}/></>}
    </Drawer>
  </section>;
}
