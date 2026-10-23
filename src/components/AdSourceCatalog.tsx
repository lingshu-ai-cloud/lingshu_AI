import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Grid, Pagination, Select, Space, Table } from 'antd';
import type { AdSourceCatalog as Catalog, AdSourceEntry, AdHistorySource } from '../../shared/adSourceLifecycle';
import { platformAdsRequest } from '../lib/platformAds';
import AdSourceLifecycle from './AdSourceLifecycle';
export default function AdSourceCatalog() {
  const screens = Grid.useBreakpoint();
  const [dataset, setDataset] = useState('studio'), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sources, setSources] = useState<AdHistorySource[]>([]), [sourceError, setSourceError] = useState('');
  const origin = dataset === 'social' ? 'social' : 'studio', sourceId = dataset.startsWith('external:') ? dataset.slice(9) : '';
  const [snapshot, setData] = useState<{ key: string; value: Catalog } | null>(null), [selected, setSelected] = useState<AdSourceEntry | null>(null);
  const key = `${dataset}:${page}`, data = snapshot?.key === key ? snapshot.value : null;
  useEffect(() => {
    const c = new AbortController(); setSourceError('');
    platformAdsRequest<{ items: AdHistorySource[] }>('/creative-history-sources', { signal: c.signal }).then(r => { if (!c.signal.aborted) setSources(r.items); }).catch(e => { if (!c.signal.aborted) setSourceError(e.message || '企业来源列表读取失败'); });
    return () => c.abort();
  }, [refresh]);
  useEffect(() => {
    const c = new AbortController(); setBusy(true); setError('');
    platformAdsRequest<Catalog>(`/creative-history?${new URLSearchParams({ origin, page: String(page), perPage: '20', ...(sourceId ? { sourceId } : {}) })}`, { signal: c.signal }).then(value => { if (!c.signal.aborted) setData({ key, value }); }).catch(e => { if (!c.signal.aborted) setError(e.message || '来源读取失败'); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [key, refresh]);
  return <section aria-label="历史素材与社媒成片来源" style={{ minWidth: 0, maxWidth: '100%' }}>
    <Space wrap><Select aria-label="素材来源数据集" style={{ minWidth: 200, maxWidth: '100%' }} value={dataset} onChange={v => { setDataset(v); setPage(1); setSelected(null); }} options={[{ value: 'studio', label: '当前企业 · 我的历史素材' }, { value: 'social', label: '当前企业 · 已保存社媒成片' }, ...sources.map(s => ({ value: `external:${s.id}`, label: `${s.tenantName} · ${s.label}` }))]}/><Button loading={busy} onClick={() => setRefresh(n => n + 1)}>刷新来源</Button></Space>
    <p>直接读取原数据源，不复制、不上传；有权威成片版本的来源可核对投放生命周期，未核验的历史草稿不会冒充已投放素材。按源记录分页，非视频/模板或不可用成片不作为可投放视频。</p>
    {error && <Alert type="error" showIcon title={error} description={data ? '保留同页来源快照，请重试。' : '当前来源未返回，不使用其他数据集冒充。'}/>}
    {sourceError && <Alert type="error" showIcon title={sourceError} description="企业来源配置未成功刷新；不自动切换或合并企业。"/>}
    <Table<AdSourceEntry> size="small" tableLayout="fixed" rowKey="key" loading={busy && !data} dataSource={data?.items || []} pagination={false} scroll={screens.md ? { x: 720 } : undefined} columns={[
      { title: '原始素材 / 项目', dataIndex: 'name', width: screens.md ? 240 : undefined, render: (_, r) => <div style={{ overflowWrap: 'anywhere' }}><p>{r.name}</p><p>{r.sourceTenantName ? `${r.sourceTenantName} · ${r.sourceTenantId}` : '当前企业'}</p>{!screens.md && <p>{r.status} · {r.verifiedSource ? '源版本记录已核验' : '需核验关联'}</p>}</div> }, { title: '状态 / 源版本', responsive: ['md'], render: (_, r) => <><p>{r.status} · {r.verifiedSource ? '源版本记录已核验' : '需核验关联'}</p>{r.sourceMediaStatus && <p>成片：{r.sourceMediaStatus === 'superseded' ? '已被新版本替代' : r.sourceMediaStatus === 'review_required' ? '待内容审阅' : r.sourceMediaStatus} · 不等于投放准入</p>}<p style={{ overflowWrap: 'anywhere' }}>{r.sha256 || r.note}</p></> },
      { title: '操作', width: screens.md ? 140 : 112, render: (_, r) => <Button style={{ height: 'auto', minHeight: 44, whiteSpace: 'normal' }} onClick={() => setSelected(r)}>查看投放生命周期</Button> },
    ]}/>
    {snapshot && <Pagination current={page} pageSize={20} total={snapshot.key.startsWith(`${dataset}:`) ? snapshot.value.totalItems : 0} showTotal={total => `${total} 条 · 来源独立展示`} showSizeChanger={false} onChange={v => { setPage(v); setSelected(null); }}/>}
    <Drawer title={selected?.name || '素材投放生命周期'} open={!!selected} onClose={() => setSelected(null)} width="min(880px, 100vw)" destroyOnHidden>
      {selected && <AdSourceLifecycle origin={selected.origin} {...(selected.sourceId ? { sourceId: selected.sourceId } : {})} {...(selected.origin === 'studio' ? { projectId: selected.projectId } : { sourceTaskId: selected.sourceTaskId, artifactId: selected.artifactId })}/>}
    </Drawer>
  </section>;
}
