import { useEffect, useState } from 'react';
import type { PlatformAdCreative, PlatformAdCreativeSource } from '../../shared/platformAdCreatives';
import { platformAdsApi, platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';

type Account = { id: string; provider: string; name: string; currency: string; status: string };
type SourcePage = { items: PlatformAdCreativeSource[]; page: number; totalPages: number };
const states: Record<PlatformAdCreative['status'], string> = { pending: '待上传 / 待验证', uploading: '上传中', processing: '平台处理中', ready: '平台视频已就绪', failed: '上传失败', unknown: '结果待核对' };
const errorText = (e: unknown) => e instanceof Error ? e.message : '素材服务暂不可用';

export default function AdCreativePanel({ task, connections, onUpdate, onUse, uploadAllowed }: {
  task: PlatformAdTask; connections: Account[]; onUpdate: (task: PlatformAdTask) => void;
  onUse: (creative: PlatformAdCreative) => void; uploadAllowed: boolean;
}) {
  const [items, setItems] = useState<PlatformAdCreative[]>([]);
  const [sources, setSources] = useState<SourcePage>({ items: [], page: 1, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [sourceKey, setSourceKey] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [refresh, setRefresh] = useState(0);
  const key = (source: PlatformAdCreativeSource) => JSON.stringify([source.sourceTaskId, source.artifactId]);
  const eligible = connections.filter(account => account.status === 'connected' && account.currency === task.currency &&
    (account.provider === 'meta' ? task.channels.length > 0 && task.channels.every(channel => ['Facebook', 'Instagram'].includes(channel)) : account.provider === 'tiktok' && task.channels.length === 1 && task.channels[0] === 'TikTok'));
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true); setSourceKey('');
    Promise.all([
      platformAdsRequest<{ items: PlatformAdCreative[] }>(`/tasks/${encodeURIComponent(task.id)}/creatives`, { signal: controller.signal }),
      platformAdsRequest<SourcePage>(`/creative-sources?page=${page}&perPage=20`, { signal: controller.signal }),
    ]).then(([bindings, catalog]) => { if (!controller.signal.aborted) { setItems(bindings.items); setSources(catalog); } })
      .catch(error => { if (!controller.signal.aborted) { setItems([]); setSources({ items: [], page, totalPages: 1 }); setFeedback(errorText(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [expanded, task.id, task.version, page, refresh]);
  const bind = async () => {
    const selected = sources.items.find(source => key(source) === sourceKey);
    if (!selected) return;
    setBusy(true); setFeedback('');
    try {
      await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/creatives`, { method: 'POST', body: JSON.stringify({ expectedVersion: task.version || 1, sourceTaskId: selected.sourceTaskId, artifactId: selected.artifactId, connectionId }) });
      onUpdate(await platformAdsApi.getTask(task.id));
      setRefresh(value => value + 1);
    } catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); }
  };
  const operate = async (creative: PlatformAdCreative, action: 'upload' | 'reconcile') => {
    setBusy(true); setFeedback('');
    try {
      await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/creatives/${encodeURIComponent(creative.id)}/${action}`, {
        method: 'POST', body: JSON.stringify({ expectedVersion: task.version || 1, requestId: crypto.randomUUID() }),
      });
      setRefresh(value => value + 1);
    } catch (error) { setFeedback(errorText(error)); setRefresh(value => value + 1); } finally { setBusy(false); }
  };
  return <section className="ads-creative-panel" aria-label="成片素材绑定">
    <div className="ads-section-title"><div><h3>成片素材</h3><p className="ads-muted">选择社媒内容中已保存的视频，固定素材版本并关联广告账户。</p></div><button type="button" className="ads-button" disabled={busy} onClick={() => setExpanded(value => !value)}>{expanded ? '收起素材' : '选择 / 管理成片'}</button></div>
    {expanded && <>
      <button type="button" className="ads-text-button" disabled={busy || loading} onClick={() => { setFeedback(''); setRefresh(value => value + 1); }}>刷新素材状态</button>
      <p className="ads-muted">当前目录覆盖社媒内容已保存的视频文件；工作室其他导出尚未接入。绑定不会上传或创建广告；换绑会更新计划版本并清空旧方案与授权。</p>
      {task.status === 'draft' && task.managementMode === 'manual' ? <div className="ads-form-fields">
        <label>成片版本<select value={sourceKey} disabled={loading || busy} onChange={e => setSourceKey(e.target.value)}><option value="">选择已保存的成片</option>{sources.items.map(source => <option key={key(source)} value={key(source)}>{source.name} · {(source.size / 1024 / 1024).toFixed(1)} MB · {source.sha256.slice(0, 12)}</option>)}</select></label>
        {!loading && !sources.items.length && <p className="ads-muted">本页暂无可绑定视频，请先在社媒内容保存成片，或继续翻页查找。</p>}
        <div className="ads-actions"><button type="button" className="ads-button" disabled={busy || loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页素材</button><span>第 {page} / {Math.max(1, sources.totalPages)} 页</span><button type="button" className="ads-button" disabled={busy || loading || page >= sources.totalPages} onClick={() => setPage(value => value + 1)}>下一页素材</button></div>
        <label>素材对应账户<select value={connectionId} disabled={busy || loading} onChange={e => setConnectionId(e.target.value)}><option value="">选择同平台、同币种账户</option>{eligible.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
        <button type="button" className="ads-button" disabled={busy || loading || !sourceKey || !eligible.some(account => account.id === connectionId)} onClick={() => void bind()}>绑定此成片版本</button>
      </div> : <p className="ads-muted">仅人工管理的草稿可换绑；已有执行记录时需新建计划。</p>}
      {loading ? <p role="status">正在读取素材…</p> : items.map(creative => <article className="ads-proposal" key={creative.id}>
        <h4>{creative.name} · {states[creative.status]}</h4><p>版本指纹：{creative.sha256.slice(0, 16)} · {(creative.size / 1024 / 1024).toFixed(1)} MB</p><p>账户：{connections.find(account => account.id === creative.connectionId)?.name || creative.connectionId}；平台视频：{creative.platformVideoId || '尚无'}</p>
        {creative.provider === 'meta' ? <>
          <p className="ads-muted">上传会把此成片发送到 Meta 账户，不会启用广告。当前上传支持不超过 64 MiB 的 MP4 视频；平台处理完成后才能使用。结果待核对时不会重复上传。</p>
          <div className="ads-actions">
            <button type="button" className="ads-button" disabled={busy || !uploadAllowed || task.managementMode !== 'manual' || task.status !== 'draft' || creative.status !== 'pending' || !!creative.platformVideoId} onClick={() => void operate(creative, 'upload')}>上传到 Meta</button>
            <button type="button" className="ads-button" disabled={busy || !creative.platformVideoId} onClick={() => void operate(creative, 'reconcile')}>核对视频状态</button>
            <button type="button" className="ads-button primary" disabled={busy || creative.status !== 'ready' || task.managementMode !== 'manual'} onClick={() => onUse(creative)}>用于本次人工创建</button>
          </div>{['unknown', 'uploading'].includes(creative.status) && !creative.platformVideoId && <p className="ads-muted">未取得可核对的视频 ID，请由账户管理员在 Meta 核对；此页面不会自动重传。</p>}{creative.status === 'failed' && <p className="ads-muted">本次上传已失败，请核对原因后重新绑定成片，再发起新的上传。</p>}{!uploadAllowed && <p className="ads-muted">当前平台写入未开放，仍可管理本地素材绑定。</p>}
        </> : <p className="ads-muted">TikTok 仍需使用既有可推广 Spark 帖子；此绑定仅记录成片版本，不上传视频或自动取得帖子授权。</p>}
      </article>)}
      {feedback && <p role="status">{feedback}</p>}
    </>}
  </section>;
}
