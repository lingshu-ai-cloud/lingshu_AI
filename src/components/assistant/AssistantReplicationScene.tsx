import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { authHeader } from '../../lib/auth';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { useAssistantStore } from '../../stores/assistantStore';
import { AuthenticatedVideo, ThumbnailImage } from '../inspiration/InspirationMedia';
import { recordsToVideos, type CrawlerRecord } from '../inspiration/inspirationVideoProjection';
import AssistantReplicationDetails from './AssistantReplicationDetails';
import { replicationStepReply } from '../../lib/assistantReplicationStepReply';

export default function AssistantReplicationScene({ portal }: { portal: AssistantCreationPortal }) {
  const galleryRef = useRef<HTMLDivElement>(null);
  const [batchSize, setBatchSize] = useState(4);
  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    const measure = () => setBatchSize(Math.max(1, Math.ceil(gallery.clientWidth / 124)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(gallery);
    return () => observer.disconnect();
  }, [portal.replicationStep]);
  const [videos, setVideos] = useState<TrendVideo[]>([]);
  const [selected, setSelected] = useState(portal.selectedReferenceId || '');
  const [preview, setPreview] = useState('');
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [page, setPage] = useState(portal.referencePage || 1), [totalPages, setTotalPages] = useState(1), [revision, setRevision] = useState(0);
  useEffect(() => {
    const store = useAssistantStore.getState();
    const messages = store.threads.business.messages;
    const content = replicationStepReply(portal);
    if (messages.some(message => message.creationPortal?.id === portal.id && message.content !== content)) {
      store.setMessages('business', messages.map(message => message.creationPortal?.id === portal.id
        ? { ...message, content } : message));
    }
  }, [portal.id, portal.confirmedTaskId, portal.replicationStep]);
  const identity = useRef(productionNavigationIdentity());
  const current = () => identity.current === productionNavigationIdentity();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ page: String(page), perPage: String(batchSize), contentFormat: 'video', crawlRange: 'all' });
    void fetch(`/api/overseas/videos?${query}`, { headers: authHeader(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('对标视频暂时读取失败，请重试。');
        return await response.json() as { items: CrawlerRecord[]; totalPages?: number };
      }).then(result => {
        if (controller.signal.aborted || !current()) return;
        const items = recordsToVideos(result.items).filter(video => video.contentFormat === 'video' && video.recordId);
        setVideos(items);
        setTotalPages(Math.max(1, Number(result.totalPages || 1)));
      }).catch(cause => { if (!controller.signal.aborted && current()) setError(cause instanceof Error ? cause.message : '读取失败'); })
      .finally(() => { if (!controller.signal.aborted && current()) setLoading(false); });
    return () => controller.abort();
  }, [page, revision, batchSize]);
  const choose = (video: TrendVideo) => {
    if (!current()) return;
    setSelected(video.id); setPreview(video.id);
    const store = useAssistantStore.getState();
    store.setMessages('business', store.threads.business.messages.map(message => message.creationPortal?.id === portal.id
      ? { ...message, content: '先选一条想借鉴的对标视频，再确定产品和周发布安排。',
        creationPortal: { ...message.creationPortal, selectedReferenceId: video.recordId || video.id, selectedReferenceSourceUrl: video.sourceUrl, referencePage: page, selectedTaskId: undefined } } : message));
  };
  const update = (patch: Partial<AssistantCreationPortal>) => {
    if (!current()) return;
    const store = useAssistantStore.getState();
    store.setMessages('business', store.threads.business.messages.map(message => message.creationPortal?.id === portal.id
      ? { ...message, content: replicationStepReply({ ...message.creationPortal!, ...patch }), creationPortal: { ...message.creationPortal, ...patch } } : message));
  };
  if (portal.replicationStep && portal.replicationStep !== 'reference') return <AssistantReplicationDetails portal={portal} update={update}/>;
  const chosen = videos.find(video => video.id === selected);
  return <section aria-label="选择对标视频" className="mt-3 space-y-3 rounded-lg border border-border bg-surface p-4">
    <div><strong className="text-sm text-text-primary">先选一条对标视频</strong>
      <p className="mt-1 text-xs text-text-secondary">悬停静音预览，点击选择想借鉴的内容。</p></div>
    {error && <Alert type="warning" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>重试</Button>}/>}
    <div ref={galleryRef} className="replication-thumbnails" role="group" aria-label="对标视频卡片">
      {videos.map(video => <button key={video.id} type="button" aria-label={`选择对标视频：${video.title}`} aria-pressed={selected === video.id}
        onClick={() => choose(video)} onMouseEnter={() => setPreview(video.id)} onMouseLeave={() => setPreview('')}
        onFocus={() => setPreview(video.id)} onBlur={() => setPreview('')}
        className={`replication-thumbnail overflow-hidden rounded-lg border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${selected === video.id ? 'border-accent ring-2 ring-accent' : 'border-border'}`}>
        <div className="relative h-24 overflow-hidden bg-surface-2">
          <ThumbnailImage src={video.thumbnail} platform={video.platform} title={video.title} className="absolute inset-0 h-full w-full object-cover"/>
          {preview === video.id && video.videoUrl && !failed[video.id] && <AuthenticatedVideo key={video.id} apiUrl={video.videoUrl}
            className="absolute inset-0 h-full w-full object-cover" previewActive controls={false}
            onError={() => setFailed(previous => ({ ...previous, [video.id]: true }))}/>}
          {selected === video.id && <span aria-hidden="true" className="absolute right-1 top-1 rounded-full bg-surface px-1 text-accent">✓</span>}
        </div>
      </button>)}
    </div>
    {loading && <Spin size="small"/>}
    {!loading && !error && !videos.length && <p className="text-sm text-text-secondary">暂无对标视频，请先在灵感中心添加视频。</p>}
    <div className="flex items-center justify-between gap-2">
      <Button disabled={loading || totalPages < 2} onClick={() => {
        setPreview(''); setSelected(''); setVideos([]);
        const next = page >= totalPages ? 1 : page + 1;
        setPage(next); update({ selectedReferenceId: undefined, referencePage: next });
      }}>换一批</Button>
      <Button type="primary" disabled={loading || !chosen || !current()} onClick={() => {
        if (chosen) { setPreview(''); update({ replicationStep: 'product' }); }
      }}>选择该对标视频</Button>
    </div>
    {selected && failed[selected] && <p role="status" className="text-xs text-text-secondary">该视频暂时无法预览，可选择其他视频。</p>}
  </section>;
}
