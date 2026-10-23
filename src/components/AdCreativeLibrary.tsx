import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Empty, Input, Pagination, Select, Space, Table, Tabs, Tag } from 'antd';
import AdSourceCatalog from './AdSourceCatalog';
import AdSourceLifecycle from './AdSourceLifecycle';
import { metaAccountDate } from '../../shared/metaPerformance';
import { RefreshCw, Play, Link2 } from 'lucide-react';
import { platformAdsRequest } from '../lib/platformAds';
import { authHeader } from '../lib/auth';
import type { AdCreativeLibraryItem, AdCreativeLibraryPage, AdCreativePreview, AdCreativeReport } from '../../shared/platformAdCreativeLibrary';
import { LsLoadingState, LsMasonryGallery, LsMediaStateFrame, LsProgressiveMedia } from './ui/LsExperiencePrimitives';
import { SocialPlatformIcon } from './SocialPlatformIcon';
import './adCreativeLibrary.css';

type Group = { key: string; items: AdCreativeLibraryItem[]; representative: AdCreativeLibraryItem };
const message = (error: unknown) => error instanceof Error ? error.message : '素材服务暂不可用';
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const groupKey = (item: AdCreativeLibraryItem) => item.binding ? `${item.connection.id}:${item.binding.sha256}:${item.binding.platformVideoId || item.binding.id}` : item.key;
const statusLabels: Record<string, string> = { PAUSED: '暂停', ACTIVE: '启用', PENDING_REVIEW: '待审核', IN_PROCESS: '平台处理中', WITH_ISSUES: '平台异常', DISAPPROVED: '未通过审核', ready: '平台视频已就绪', pending: '待上传', processing: '视频处理中', unknown: '待核对', failed: '上传失败', uploading: '上传中' };
function Cover({ bindingId, name, onPreview }: { bindingId?: string; name: string; onPreview: () => void }) {
  const [preview, setPreview] = useState<AdCreativePreview | null>(null);
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setPreview(null); setError(''); setLoaded(false);
    if (!bindingId) return;
    const controller = new AbortController();
    platformAdsRequest<AdCreativePreview>(`/creatives/${bindingId}/platform-preview`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setPreview(value); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [bindingId, refresh]);
  return <div className="ads-library-cover" style={{ aspectRatio: preview?.width && preview.height ? `${preview.width} / ${preview.height}` : '1 / 1' }}>
    <LsMediaStateFrame state={loaded ? 'ready' : error || !bindingId ? 'error' : 'loading'} label={error ? '封面暂不可用，可进入详情查看源视频' : (!bindingId ? '待确认素材关联' : '加载封面')}>
      {preview && !error && <LsProgressiveMedia key={`${bindingId}:${refresh}`} src={preview.thumbnailUrl} alt={`${name} · Meta 真实封面`} preview={false} width="100%" height="100%" style={{ objectFit: 'contain' }} onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setError('封面已失效，请重试'); }} />}
    </LsMediaStateFrame>
    <div className="ads-library-cover-actions"><Button size="small" icon={<Play size={14}/>} onClick={onPreview}>查看素材</Button>{error && bindingId && <Button size="small" onClick={() => setRefresh(v => v + 1)}>重试封面</Button>}{preview?.duration != null && <Tag>{number(preview.duration)} 秒</Tag>}</div>
  </div>;
}
function VideoPreview({ bindingId }: { bindingId: string }) {
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let blobUrl = '';
    setUrl(''); setError(''); setReady(false);
    void (async () => {
      const response = await fetch(`/api/overseas/platform-ads/creatives/${bindingId}/media`, { headers: authHeader(), signal: controller.signal });
      if (!response.ok) throw new Error('源视频暂不可预览，请检查素材权限或重试');
      const blob = await response.blob();
      if (!blob.type.startsWith('video/')) throw new Error('素材预览类型无效');
      if (controller.signal.aborted) return;
      blobUrl = URL.createObjectURL(blob); setUrl(blobUrl);
    })().catch(e => { if (!controller.signal.aborted) setError(message(e)); });
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [bindingId, retry]);
  return <div className="ads-library-video"><LsMediaStateFrame state={error ? 'error' : ready ? 'ready' : 'loading'} label={error || '加载已保存的源视频'}>
    {url && <video src={url} controls playsInline preload="metadata" aria-label="已保存的投放源视频" onLoadedData={() => setReady(true)} onError={() => setError('视频无法解码，请重试')} />}
  </LsMediaStateFrame>{error && <Button onClick={() => setRetry(v => v + 1)}>重试预览</Button>}</div>;
}

export default function AdCreativeLibrary({ onOpenTask, initialTaskId }: { onOpenTask: (id: string) => void; initialTaskId?: string }) {
  const [view, setView] = useState(initialTaskId ? 'ads' : 'history');
  const [catalog, setData] = useState<AdCreativeLibraryPage | null>(null), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const data = catalog?.page === page ? catalog : null;
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(initialTaskId || ''), [account, setAccount] = useState('all'), [selected, setSelected] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, AdCreativeReport>>({}), [reportErrors, setReportErrors] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false), [reportRefresh, setReportRefresh] = useState(0), [mapping, setMapping] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    platformAdsRequest<AdCreativeLibraryPage>(`/creative-library?page=${page}&perPage=20`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(e => { if (!controller.signal.aborted) setError(message(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, refresh]);
  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const item of data?.items || []) {
      if (account !== 'all' && item.connection.id !== account) continue;
      const key = groupKey(item), group = map.get(key);
      if (group) group.items.push(item); else map.set(key, { key, items: [item], representative: item });
    }
    return [...map.values()].filter(g => !search || g.items.some(i => `${i.task.id} ${i.binding?.name || ''} ${i.task.name} ${i.binding?.platformVideoId || ''} ${i.connection.name}`.toLowerCase().includes(search.toLowerCase())));
  }, [data, account, search]);
  const opened = groups.find(g => g.key === selected);
  const executionKey = opened?.items.map(i => i.execution?.id || '').join(',') || '';
  const activeReports = (opened?.items || []).flatMap(i => reports[i.execution?.id || ''] ? [reports[i.execution!.id]] : []);
  const reportDates = JSON.stringify(activeReports.map(r => [r.reportTimezone, r.window.until]));
  useEffect(() => {
    if (!opened || !reportDates) return;
    const check = () => { if (activeReports.some(r => metaAccountDate(r.reportTimezone) !== r.window.until)) setReportRefresh(n => n + 1); };
    const timer = window.setInterval(check, 60_000); window.addEventListener('focus', check); check();
    return () => { window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, [!!opened, reportDates]);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController(); setReading(true); setReportErrors({});
    void Promise.all(opened.items.filter(i => i.execution).map(async item => {
      const id = item.execution!.id;
      try { const report = await platformAdsRequest<AdCreativeReport>(`/creative-library/${id}/report`, { signal: controller.signal }); if (!controller.signal.aborted) setReports(old => ({ ...old, [id]: report })); }
      catch (e) { if (!controller.signal.aborted) setReportErrors(old => ({ ...old, [id]: message(e) })); }
    })).finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
    // IDs identify the immutable resource set; refresh is explicit.
  }, [selected, executionKey, reportRefresh]);
  async function attach(item: AdCreativeLibraryItem, sourceId: string) {
    setMapping(item.key); setNotice('');
    try {
      await platformAdsRequest(`/tasks/${item.task.id}/creatives/attach-existing`, { method: 'POST', body: JSON.stringify({ expectedVersion: item.task.version, executionId: item.execution?.id, sourceCreativeId: sourceId }) });
      setNotice('本地素材映射已核对保存；未上传视频、未创建或修改平台广告。'); setSelected(null); setRefresh(v => v + 1);
    } catch (e) { setNotice(message(e)); } finally { setMapping(''); }
  }
  const accounts = [...new Map((data?.items || []).map(i => [i.connection.id, i.connection])).values()];
  return <section aria-label="真实投放素材库" className="ads-library">
    <Tabs activeKey={view} onChange={setView} items={[{ key: 'ads', label: '投放素材' }, { key: 'history', label: '创作素材' }]} />
    {view === 'history' ? <AdSourceCatalog/> : <>
    <div className="ads-library-toolbar"><Input.Search aria-label="搜索本页素材" placeholder="搜索本页素材或计划" allowClear value={search} onChange={e => setSearch(e.target.value)} />
      <Select aria-label="本页素材账户" value={account} onChange={setAccount} options={[{ value: 'all', label: '本页全部账户' }, ...accounts.map(a => ({ value: a.id, label: `${a.name} · ${a.currency}` }))]} />
      <Button icon={<RefreshCw size={15}/>} loading={loading} onClick={() => setRefresh(v => v + 1)}>刷新素材</Button>
    </div>
    {error && <Alert type="error" showIcon title={error} description={data ? '保留上次读取结果，请重试刷新。' : undefined} />}
    {notice && <Alert type="info" showIcon title={notice} closable onClose={() => setNotice('')} />}
    {data?.truncated && <Alert type="warning" showIcon title="部分计划记录超过单次读取上限，当前目录不是完整总账。" />}
    <LsLoadingState loading={loading && !data} label="读取真实素材目录">
      {data && <LsMasonryGallery layout="masonry" columns={{ xs: 1, sm: 2, lg: 3, xl: 4 }} emptyText="当前计划范围没有匹配的素材；请先在计划中绑定已保存成片。" items={groups.map(group => {
        const item = group.representative, binding = item.binding;
        return { id: group.key, content: <article className="ads-library-card">
          <Cover key={binding?.id || item.key} bindingId={binding?.platformVideoId ? binding.id : undefined} name={binding?.name || item.task.name} onPreview={() => setSelected(group.key)} />
          <div className="ads-library-card-body"><h2>{binding?.name || item.task.name}</h2><Space wrap><SocialPlatformIcon platform={item.connection.provider === 'meta' ? 'facebook' : 'tiktok'} size={18}/><span>{item.connection.name}</span><Tag>{binding ? statusLabels[binding.status] || binding.status : '待确认关联'}</Tag></Space>
            <p>{new Set(group.items.filter(i => i.execution).map(i => i.execution!.adId)).size} 条关联广告 · {new Set(group.items.map(i => i.task.id)).size} 个计划</p>
            <Button block onClick={() => setSelected(group.key)}>查看详情与表现</Button>
          </div></article> };
      })} />}
    </LsLoadingState>
    {catalog && <div className="ads-library-pagination"><span>{data ? `本页匹配 ${groups.length} 项 · 账户分别展示` : '当前页目录未返回，可刷新或返回其他页。'}</span><Pagination current={page} pageSize={20} total={catalog.totalItems} showTotal={total => `${total} 条计划记录`} showSizeChanger={false} onChange={v => { setPage(v); setSelected(null); }} /></div>}
    </>}
    <Drawer title="素材与广告表现" open={!!opened} onClose={() => setSelected(null)} size={840} destroyOnHidden>
      {opened && <>
        {opened.representative.binding && <><VideoPreview key={opened.representative.binding.id} bindingId={opened.representative.binding.id}/><Collapse items={[{ key: 'evidence', label: '文件与平台标识', children: <Descriptions size="small" column={1} items={[
          { key: 'name', label: '源文件', children: opened.representative.binding.name },
          { key: 'hash', label: '版本 SHA-256', children: <span className="ads-library-id">{opened.representative.binding.sha256}</span> },
          { key: 'video', label: 'Meta 视频', children: opened.representative.binding.platformVideoId || '未上传' },
        ]}/> }]}/></>}
        <Space className="ads-library-detail-heading"><h3>计划关联与广告级报告</h3><Button loading={reading} onClick={() => setReportRefresh(v => v + 1)}>刷新平台报告</Button></Space>
        {activeReports.some(r => !r.daily.length) && <Alert type="info" showIcon title="等待平台数据回传" description="已有广告关联，Meta 尚未返回该窗口的表现数据；指标显示 —，不当作零消耗。"/>}
        {Object.keys(reportErrors).length > 0 && <Alert type="warning" showIcon title="部分广告表现暂未更新" description="请稍后重试；已有报告保留原采集时间，不用其他广告数据补齐。"/>}
        <Collapse items={[{ key: 'definitions', label: '统计口径与更新说明', children: <p>与投放数据共用广告级、最近 7 个账户日期报告；按展示时间回报，采用广告组归因设置。全部点击不等于链接点击，单次成本使用 Meta 原值；空数据不补零。报告缓存 60 秒、封面 5 分钟，以采集时间为准；刷新不启用广告。利润 ROI 与 CRM 有效询盘尚未接通，不等于 Meta ROAS 或线索。</p> }]}/>
        {opened.representative.binding && <Collapse items={[{ key: 'lifecycle', label: '查看同源素材全投放周期 / Meta 线索与 ROAS', children: <AdSourceLifecycle origin="social" sourceTaskId={opened.representative.binding.sourceTaskId} artifactId={opened.representative.binding.artifactId}/> }]}/>}
        <Table<AdCreativeLibraryItem> tableLayout="fixed" rowKey="key" pagination={false} dataSource={opened.items} scroll={{ x: 780 }} columns={[
          { title: '计划 / 映射', key: 'task', width: 210, render: (_, i) => <><Button className="ads-library-task-link" type="link" onClick={() => onOpenTask(i.task.id)}>{i.task.name}</Button><p>{i.mapping === 'creation_binding' ? '创建时绑定' : i.mapping === 'verified_existing' ? '投放后核对映射（不改原回执）' : i.mapping === 'platform_only' ? '仅平台记录，未关联本地源文件' : '本地成片，尚无核验广告'}</p><span className="ads-library-id">{i.execution?.adId || '—'}</span></> },
          { title: '平台状态', key: 'status', width: 150, render: (_, i) => { const r = reports[i.execution?.id || '']; return r ? <><p>配置：{statusLabels[r.configuredStatus] || r.configuredStatus}</p><p>有效：{statusLabels[r.effectiveStatus] || r.effectiveStatus}</p>{r.issues.map(issue => <p key={issue.code}>{issue.code} · {issue.message}</p>)}</> : reportErrors[i.execution?.id || ''] || (i.execution ? '正在核对 / 暂无读回' : '尚未创建广告'); } },
          { title: '广告表现 / 数据窗口', key: 'metrics', render: (_, i) => { const r = reports[i.execution?.id || '']; return r ? <><p>花费 {r.currency} {number(r.spend)} · 展示 {number(r.impressions)} · 全部点击 {number(r.clicks)}</p><p>{r.metricLabel} {number(r.results)} · 单次结果成本 {r.currency} {number(r.costPerResult)}</p><p>{r.window.since} — {r.window.until} · {r.reportTimezone}</p><p>归因：{r.attributionSpec?.length ? r.attributionSpec.map(a => `${a.event_type} ${a.window_days} 天`).join(' / ') : '窗口未返回，不推断'}</p><p>采集：{new Date(r.reportedAt).toLocaleString('zh-CN')}{reportErrors[i.execution?.id || ''] ? ' · 刷新失败，保留旧报告' : ''}</p>{!r.daily.length && <p>平台返回空报告，尚无可核验指标。</p>}</> : '—'; } },
        ]}/>
        {opened.items.filter(i => !i.binding && i.execution).map(item => {
          const report = reports[item.execution!.id];
          const candidates = (data?.items || []).filter(i => i.binding?.status === 'ready' && i.connection.id === item.connection.id && i.binding.platformVideoId === report?.videoId);
          const source = candidates[0]?.binding;
          return <div key={item.key} className="ads-library-mapping"><h3>补齐本地素材映射</h3><p>只关联同账户、同平台视频和已验证文件版本；不上传、不重建广告，不改计划版本或原创建证据。</p>{source ? <Button icon={<Link2 size={15}/>} loading={mapping === item.key} disabled={!!mapping || reading || report?.configuredStatus !== 'PAUSED'} onClick={() => void attach(item, source.id)}>关联已验证成片：{source.name}</Button> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前计划页没有匹配的已验证源成片；请核对源素材或翻页。" />}</div>;
        })}
      </>}
    </Drawer>
  </section>;
}
