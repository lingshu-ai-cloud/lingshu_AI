import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Descriptions, Drawer, Empty, Pagination, Space, Spin, Tag } from 'antd';
import { AdDirectorySelect, useAdAccountDirectory } from './AdAccountDirectory';
import { platformAdsRequest } from '../lib/platformAds';
import type { MetaAccountHistory } from '../../shared/metaAccountHistory';
import type { MetaAdAsset } from '../../shared/adAccountDirectory';
import { LsMasonryGallery, LsMediaStateFrame, LsProgressiveMedia } from './ui/LsExperiencePrimitives';
const number = (v: number | null | undefined) => v == null ? '暂无数据' : v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const statuses: Record<string, string> = { PAUSED: '暂停', ACTIVE: '启用', PENDING_REVIEW: '待审核', DISAPPROVED: '未通过审核', CAMPAIGN_PAUSED: '广告系列暂停', ADSET_PAUSED: '广告组暂停' };
function NativeCover({ asset, error }: { asset?: MetaAdAsset; error?: string }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => { setLoaded(false); setFailed(false); }, [asset?.adId, asset?.thumbnailUrl]);
  return <div style={{ aspectRatio: '1 / 1' }}><LsMediaStateFrame state={loaded ? 'ready' : error || failed || asset && !asset.thumbnailUrl ? 'error' : 'loading'} label={error || (failed ? '平台封面暂不可用，广告数据仍可查看' : asset ? '平台未返回可展示封面' : '正在核对真实广告素材')}>
    {asset?.thumbnailUrl && !failed && <LsProgressiveMedia src={asset.thumbnailUrl} alt={`${asset.adName} · 平台广告封面`} preview={false} width="100%" height="100%" style={{ objectFit: 'contain' }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}/>}
  </LsMediaStateFrame></div>;
}
export default function AdPlatformCreatives() {
  const directory = useAdAccountDirectory(), account = directory.selected;
  const [catalog, setReport] = useState<{ base: string; report: MetaAccountHistory } | null>(null), [assets, setAssets] = useState<Record<string, MetaAdAsset>>({}), [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [page, setPage] = useState(1), [selected, setSelected] = useState('');
  const base = account ? `/connections/${encodeURIComponent(account.connectionId)}/history/${encodeURIComponent(account.accountId)}` : '';
  const report = catalog?.base === base ? catalog.report : null;
  const lastBase = useRef('');
  useEffect(() => {
    setError('');
    if (lastBase.current !== base) { setAssets({}); setErrors({}); setSelected(''); setPage(1); lastBase.current = base; }
    if (!base) return;
    const abort = new AbortController(); setBusy(true);
    platformAdsRequest<MetaAccountHistory>(base, { signal: abort.signal }).then(v => { if (!abort.signal.aborted) setReport({ base, report: v }); })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : '历史广告读取失败'); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [base, refresh]);
  const rows = report?.items.slice((page - 1) * 10, page * 10) || [];
  const ids = rows.map(r => r.adId).join(',');
  useEffect(() => {
    if (!report || report.accountId !== account?.accountId) return;
    const abort = new AbortController();
    void (async () => {
      for (let n = 0; n < rows.length; n += 2) {
        await Promise.all(rows.slice(n, n + 2).map(async row => {
          try {
            const asset = await platformAdsRequest<MetaAdAsset>(`${base}/ads/${row.adId}/creative`, { signal: abort.signal });
            if (!abort.signal.aborted) { setAssets(old => ({ ...old, [row.adId]: asset })); setErrors(old => ({ ...old, [row.adId]: '' })); }
          } catch (e) { if (!abort.signal.aborted) setErrors(old => ({ ...old, [row.adId]: e instanceof Error ? e.message : '素材关联核对失败' })); }
        }));
        if (abort.signal.aborted) return;
      }
    })();
    return () => abort.abort();
  }, [base, ids, report?.reportedAt, refresh]);
  useEffect(() => { if (directory.adId && report?.items.some(i => i.adId === directory.adId)) { setPage(Math.floor(report.items.findIndex(i => i.adId === directory.adId) / 10) + 1); setSelected(directory.adId); } }, [directory.adId, report]);
  const active = report?.items.find(i => i.adId === selected), asset = assets[selected];
  return <section className="meta-performance" aria-label="平台真实广告素材"><div className="meta-performance-toolbar"><AdDirectorySelect/><Button loading={busy} onClick={() => setRefresh(v => v + 1)}>刷新平台素材</Button></div>
    <Tag>当前企业授权 · 有消耗历史广告 · 不与本地成片混算</Tag>
    {error && <Alert type="error" title={error} description={report ? '保留当前账户上次确认结果，以原采集时间为准；不代表最新数据。' : '读取失败不等于没有广告，不借用其他账户或企业数据。'}/>}
    {busy && !report && <Spin aria-label="正在读取平台历史广告"/>}
    {!busy && !error && report && !report.items.length && <Empty description="当前账户没有有消耗的历史广告；本地草稿与暂停测试广告请在投放素材中查看。"/>}
    {report && !report.complete && <Alert type="warning" title="历史目录未完整返回，仅展示已读取记录。"/>}
    {!!rows.length && <LsMasonryGallery layout="masonry" columns={{ xs: 1, sm: 2, lg: 3, xl: 4 }} items={rows.map(row => ({ id: `${report!.accountId}:${row.adId}`, content: <article className="ads-library-card">
      <NativeCover key={`${base}:${row.adId}:${refresh}`} asset={assets[row.adId]} error={errors[row.adId]}/><div className="ads-library-card-body"><h2>{row.adName}</h2><p>{report!.accountName} · {report!.currency}</p>
        <Tag>{errors[row.adId] ? assets[row.adId] ? '刷新失败，保留上次核验' : '素材关联待核对' : assets[row.adId] ? '平台广告与素材已核验' : '正在读取素材'}</Tag>
        <p>花费 {report!.currency} {number(row.metrics.spend)} · 展示 {number(row.metrics.impressions)}</p>
        <p>Meta 线索 {number(row.metrics.leads)} · ROAS {number(row.metrics.purchaseRoas)}</p>
        <Button onClick={() => setSelected(row.adId)}>查看真实素材与表现</Button></div></article> }))}/>}
    {!!report?.items.length && <Pagination current={page} pageSize={10} total={report.items.length} showSizeChanger={false} onChange={setPage}/>}
    <Drawer title="平台广告素材与表现" open={!!active} onClose={() => setSelected('')} size={720} destroyOnHidden>
      {active && <Space orientation="vertical" size="large" style={{ width: '100%' }}><h3>{active.adName}</h3><NativeCover key={`${base}:${active.adId}:${refresh}`} asset={asset} error={errors[active.adId]}/>
        {asset && errors[active.adId] && <Alert type="warning" title="平台素材刷新失败，保留上次确认结果" description={errors[active.adId]}/>}
        {asset ? <Tag>配置：{statuses[asset.configuredStatus] || asset.configuredStatus || '未返回'} · 有效：{statuses[asset.effectiveStatus] || asset.effectiveStatus || '未返回'}</Tag> : <Alert type="warning" title={errors[active.adId] || '正在核对广告素材'}/>}
        <Descriptions column={1} items={[{ key: 'account', label: '账户', children: `${report?.accountName} · ${report?.currency}` }, { key: 'period', label: '报告窗口', children: `${active.since} — ${active.until} · ${report?.timezone}` },
          { key: 'spend', label: '花费', children: `${report?.currency} ${number(active.metrics.spend)}` }, { key: 'impressions', label: '展示', children: number(active.metrics.impressions) }, { key: 'leads', label: 'Meta 归因线索', children: number(active.metrics.leads) }, { key: 'messages', label: 'Meta 新消息会话', children: number(active.metrics.messagingConversations) }, { key: 'roas', label: 'Meta 购买 ROAS', children: number(active.metrics.purchaseRoas) }]}/>
        <Alert type="info" title="平台素材与本地原文件分开管理" description="广告与 Creative 的对应关系来自 Meta 原始标识；尚无本地原文件指纹证据，不自动挂接任何历史素材，也不把 Meta 图片 hash 当作本地 SHA-256。"/>
        {asset && <Collapse items={[{ key: 'evidence', label: '平台素材标识与核验时间', children: <Descriptions column={1} items={[{ key: 'ad', label: '广告', children: asset.adId }, { key: 'creative', label: 'Creative', children: asset.creativeId }, { key: 'video', label: '视频', children: asset.videoIds.join('、') || '未返回独立视频标识' }, { key: 'image', label: '图片', children: asset.imageHashes.join('、') || '未返回图片 hash' }, { key: 'at', label: '核验时间', children: asset.checkedAt }]}/> }]}/>}
      </Space>}
    </Drawer>
  </section>;
}
