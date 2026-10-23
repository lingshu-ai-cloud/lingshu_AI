import { useEffect, useState } from 'react';
import type { PlatformAdCreative } from '../../shared/platformAdCreatives';
import { platformAdsApi, platformAdsRequest, type PlatformAdTask } from '../lib/platformAds';
import { Button, Collapse, Space, Tag } from 'antd';
import AdMaterialPicker from './AdMaterialPicker';
import type { AdMaterialSelection } from '../../shared/platformAdCreatives';

type Account = { id: string; provider: string; name: string; currency: string; status: string };
const states: Record<PlatformAdCreative['status'], string> = { pending: '本地绑定 · 未上传', uploading: '上传中', processing: '平台处理中', ready: '平台视频已就绪', failed: '上传失败', unknown: '结果待核对' };
const errorText = (e: unknown) => e instanceof Error ? e.message : '素材服务暂不可用';

export default function AdCreativePanel({ task, connections, onUpdate, onUse, uploadAllowed }: {
  task: PlatformAdTask; connections: Account[]; onUpdate: (task: PlatformAdTask) => void;
  onUse: (creative: PlatformAdCreative) => void; uploadAllowed: boolean;
}) {
  const [items, setItems] = useState<PlatformAdCreative[]>([]);
  const [picked, setPicked] = useState<AdMaterialSelection | null>(task.configuration.materialSource || null);
  useEffect(() => { setPicked(task.configuration.materialSource || null); setConnectionId(''); }, [task.id, task.configuration.materialSource]);
  const [connectionId, setConnectionId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [refresh, setRefresh] = useState(0);
  const eligible = connections.filter(account => account.status === 'connected' && account.currency === task.currency &&
    (account.provider === 'meta' ? task.channels.length > 0 && task.channels.every(channel => ['Facebook', 'Instagram'].includes(channel)) : account.provider === 'tiktok' && task.channels.length === 1 && task.channels[0] === 'TikTok'));
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoading(true);
    platformAdsRequest<{ items: PlatformAdCreative[] }>(`/tasks/${encodeURIComponent(task.id)}/creatives`, { signal: controller.signal })
      .then(bindings => { if (!controller.signal.aborted) setItems(bindings.items); })
      .catch(error => { if (!controller.signal.aborted) { setItems([]); setFeedback(errorText(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [expanded, task.id, task.version, refresh]);
  const bind = async () => {
    const selected = picked;
    if (!selected) return;
    setBusy(true); setFeedback('');
    try {
      await platformAdsRequest(`/tasks/${encodeURIComponent(task.id)}/creatives`, { method: 'POST', body: JSON.stringify({ expectedVersion: task.version || 1, sourceTaskId: selected.sourceTaskId, artifactId: selected.artifactId, expectedSha256: selected.sha256, connectionId }) });
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
  const useCreative = async (creative: PlatformAdCreative) => {
    setBusy(true); setFeedback('');
    try {
      const selected = await platformAdsRequest<AdMaterialSelection>(`/creative-selection?${new URLSearchParams({ origin: 'social', sourceTaskId: creative.sourceTaskId, artifactId: creative.artifactId })}`);
      if (selected.sha256 !== creative.sha256) throw new Error('成片版本已变化，请重新选择并绑定。');
      onUse(creative);
    } catch (error) { setFeedback(errorText(error)); } finally { setBusy(false); }
  };
  return <section className="ads-creative-panel" aria-label="成片素材绑定">
    <div className="ads-section-title"><div><h3>成片素材</h3><p className="ads-muted">选择社媒内容中已保存的视频，固定素材版本并关联广告账户。</p></div><button type="button" className="ads-button" disabled={busy} onClick={() => setExpanded(value => !value)}>{expanded ? '收起素材' : '选择 / 管理成片'}</button></div>
    {expanded && <>
      <button type="button" className="ads-text-button" disabled={busy || loading} onClick={() => { setFeedback(''); setRefresh(value => value + 1); }}>刷新素材状态</button>
      <p className="ads-muted">与素材管理共用目录和预览。绑定不会上传或创建广告；换绑会更新计划版本并清空旧方案与授权。</p>
      {task.status === 'draft' && task.managementMode === 'manual' ? <div className="ads-form-fields">
        <AdMaterialPicker value={picked} disabled={loading || busy} onChange={setPicked} blockedReason={task.channels.every(c => ['Facebook', 'Instagram'].includes(c)) ? undefined : '当前选择器用于 Meta 视频计划，请核对计划渠道。'}/>
        <label>素材对应账户<select value={connectionId} disabled={busy || loading} onChange={e => setConnectionId(e.target.value)}><option value="">选择同平台、同币种账户</option>{eligible.map(account => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
        <Button type="primary" disabled={busy || loading || !picked || !eligible.some(account => account.id === connectionId)} onClick={() => void bind()}>绑定此成片版本</Button>
      </div> : <p className="ads-muted">仅人工管理的草稿可换绑；已有执行记录时需新建计划。</p>}
      {loading ? <p role="status">正在读取素材…</p> : items.map(creative => <article className="ads-proposal" key={creative.id}>
        <h4>{creative.name}</h4><Space wrap><Tag>当前企业</Tag><Tag>{states[creative.status]}</Tag>{creative.taskVersion !== task.version && <Tag color="warning">方案已更新，请重新确认绑定</Tag>}<span>{connections.find(account => account.id === creative.connectionId)?.name || '账户待核对'}</span></Space><Collapse items={[{ key: 'evidence', label: '文件版本与平台标识', children: <p>版本指纹：{creative.sha256} · {(creative.size / 1024 / 1024).toFixed(1)} MB<br/>平台视频：{creative.platformVideoId || '尚无'}</p> }]}/>
        {creative.provider === 'meta' ? <>
          <p className="ads-muted">上传会把此成片发送到 Meta 账户，不会启用广告。当前上传支持不超过 64 MiB 的 MP4 视频；平台处理完成后才能使用。结果待核对时不会重复上传。</p>
          <div className="ads-actions">
            <button type="button" className="ads-button" disabled={busy || !uploadAllowed || creative.taskVersion !== task.version || task.managementMode !== 'manual' || task.status !== 'draft' || creative.status !== 'pending' || !!creative.platformVideoId} onClick={() => void operate(creative, 'upload')}>上传到 Meta</button>
            <button type="button" className="ads-button" disabled={busy || !creative.platformVideoId} onClick={() => void operate(creative, 'reconcile')}>核对视频状态</button>
            <Button type="primary" disabled={busy || creative.status !== 'ready' || creative.taskVersion !== task.version || task.managementMode !== 'manual' || task.status !== 'draft'} onClick={() => void useCreative(creative)}>用于本次人工创建</Button>
          </div>{['unknown', 'uploading'].includes(creative.status) && !creative.platformVideoId && <p className="ads-muted">未取得可核对的视频 ID，请由账户管理员在 Meta 核对；此页面不会自动重传。</p>}{creative.status === 'failed' && <p className="ads-muted">本次上传已失败，请核对原因后重新绑定成片，再发起新的上传。</p>}{!uploadAllowed && <p className="ads-muted">当前平台写入未开放，仍可管理本地素材绑定。</p>}
        </> : <p className="ads-muted">TikTok 仍需使用既有可推广 Spark 帖子；此绑定仅记录成片版本，不上传视频或自动取得帖子授权。</p>}
      </article>)}
      {feedback && <p role="status">{feedback}</p>}
    </>}
  </section>;
}
