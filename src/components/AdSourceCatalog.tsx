import { useEffect, useState } from 'react';
import { Alert, Button, Pagination, Select, Space, Table } from 'antd';
import type { AdSourceCatalog as Catalog, AdSourceEntry } from '../../shared/adSourceLifecycle';
import { platformAdsRequest } from '../lib/platformAds';
import AdSourceLifecycle from './AdSourceLifecycle';
export default function AdSourceCatalog() {
  const [origin, setOrigin] = useState<'studio' | 'social'>('studio'), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [snapshot, setData] = useState<{ key: string; value: Catalog } | null>(null), [selected, setSelected] = useState<AdSourceEntry | null>(null);
  const key = `${origin}:${page}`, data = snapshot?.key === key ? snapshot.value : null;
  useEffect(() => {
    const c = new AbortController(); setBusy(true); setError('');
    platformAdsRequest<Catalog>(`/creative-history?origin=${origin}&page=${page}&perPage=20`, { signal: c.signal }).then(value => { if (!c.signal.aborted) setData({ key, value }); }).catch(e => { if (!c.signal.aborted) setError(e.message || '来源读取失败'); }).finally(() => { if (!c.signal.aborted) setBusy(false); });
    return () => c.abort();
  }, [key, refresh]);
  return <section aria-label="历史素材与社媒成片来源">
    <Space wrap><Select aria-label="素材来源数据集" value={origin} onChange={v => { setOrigin(v); setPage(1); setSelected(null); }} options={[{ value: 'studio', label: '我的创作 · 历史素材' }, { value: 'social', label: '已保存社媒成片' }]}/><Button loading={busy} onClick={() => setRefresh(n => n + 1)}>刷新来源</Button></Space>
    <p>直接读取原数据源，不复制、不上传；有权威成片版本的来源可核对投放生命周期，未核验的历史草稿不会冒充已投放素材。按源记录分页，非视频/模板或不可用成片不作为可投放视频。</p>
    {error && <Alert type="error" showIcon title={error} description={data ? '保留同页来源快照，请重试。' : '当前来源未返回，不使用其他数据集冒充。'}/>}
    <Table<AdSourceEntry> size="small" rowKey="key" loading={busy && !data} dataSource={data?.items || []} pagination={false} scroll={{ x: 720 }} columns={[
      { title: '原始素材 / 项目', dataIndex: 'name', width: 240 }, { title: '状态 / 源版本', render: (_, r) => <><p>{r.status} · {r.verifiedSource ? '源版本已核验' : '需核验关联'}</p><p style={{ overflowWrap: 'anywhere' }}>{r.sha256 || r.note}</p></> },
      { title: '操作', width: 140, render: (_, r) => <Button onClick={() => setSelected(r)}>查看投放生命周期</Button> },
    ]}/>
    {snapshot && <Pagination current={page} pageSize={20} total={snapshot.key.startsWith(`${origin}:`) ? snapshot.value.totalItems : 0} showSizeChanger={false} onChange={v => { setPage(v); setSelected(null); }}/>} 
    {selected && <AdSourceLifecycle origin={selected.origin} {...(selected.origin === 'studio' ? { projectId: selected.projectId } : { sourceTaskId: selected.sourceTaskId, artifactId: selected.artifactId })}/>}
  </section>;
}
