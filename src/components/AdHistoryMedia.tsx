import { useEffect, useState } from 'react';
import { Button, Space, Tag } from 'antd';
import type { AdSourceEntry, AdSourceLifecycle } from '../../shared/adSourceLifecycle';
import { platformAdsRequest } from '../lib/platformAds';
import { authHeader } from '../lib/auth';
import { LsMediaStateFrame, LsProgressiveMedia } from './ui/LsExperiencePrimitives';

export function historyQuery(source: AdSourceEntry) {
  return new URLSearchParams({ origin: source.origin, ...(source.sourceId ? { sourceId: source.sourceId } : {}),
    ...(source.origin === 'studio' ? { projectId: source.projectId || '' } : { sourceTaskId: source.sourceTaskId || '', artifactId: source.artifactId || '' }) }).toString();
}
/** Identity-keyed by the parent. No thumbnail or metrics are reused across source records. */
export default function AdHistoryMedia({ source, refresh }: { source: AdSourceEntry; refresh: number }) {
  const [data, setData] = useState<AdSourceLifecycle | null>(null), [failed, setFailed] = useState(false);
  const [url, setUrl] = useState(''), [cover, setCover] = useState(''), [previewError, setPreviewError] = useState(false), [retry, setRetry] = useState(0);
  const query = historyQuery(source);
  useEffect(() => {
    const c = new AbortController(); setData(null); setFailed(false);
    platformAdsRequest<AdSourceLifecycle>(`/creative-lifecycle?${query}`, { signal: c.signal }).then(r => { if (!c.signal.aborted) setData(r); })
      .catch(() => { if (!c.signal.aborted) setFailed(true); });
    return () => c.abort();
  }, [query, refresh]);
  const available = !!source.sourceId && source.verifiedSource && !!data?.fileEvidence?.length && data.fileEvidence.every(f => f.state === 'verified');
  useEffect(() => {
    const c = new AbortController(); let blobUrl = ''; setUrl(''); setCover(''); setPreviewError(false);
    if (available) void (async () => {
      const r = await fetch(`/api/overseas/platform-ads/creative-history/media?${query}`, { headers: authHeader(), signal: c.signal });
      if (!r.ok || !r.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('preview unavailable');
      const blob = await r.blob(); if (c.signal.aborted) return;
      blobUrl = URL.createObjectURL(blob); setUrl(blobUrl);
    })().catch(() => { if (!c.signal.aborted) setPreviewError(true); });
    return () => { c.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [query, available, refresh, retry]);
  const missing = data?.fileEvidence?.some(f => f.state === 'missing');
  const fileLabel = missing ? '原始文件缺失' : failed ? '素材状态暂不可用' : previewError ? '封面暂不可用' : available ? '读取真实首帧' : data ? '尚无可预览成片' : '核对素材';
  const adLabel = !data ? (failed ? '投放关联待核对' : '核对投放关联') : !data.ads.length ? '未关联广告（本系统）' : data.ads.some(a => a.error || !a.report) ? '投放数据暂不可用'
    : data.ads.every(a => !a.report?.totals) ? '平台暂无数据' : '已有投放数据';
  return <div className="ads-history-media">
    <div className={`ads-history-thumbnail${!missing && !failed && !previewError ? ' is-neutral' : ''}`}>
      <LsMediaStateFrame state={cover ? 'ready' : available && !previewError || !data && !failed ? 'loading' : 'error'} label={fileLabel}>
        {cover && <LsProgressiveMedia src={cover} alt={`${source.name} · 原始成片首帧`} preview width="100%"/>}
        {url && !cover && !previewError && <video key={url} src={url} muted playsInline preload="auto" aria-label="读取原始成片封面" onLoadedData={event => {
          const video = event.currentTarget, canvas = document.createElement('canvas');
          if (!video.videoWidth || !video.videoHeight) { setPreviewError(true); return; }
          canvas.width = Math.min(480, video.videoWidth); canvas.height = canvas.width * video.videoHeight / video.videoWidth;
          const context = canvas.getContext('2d'); if (!context) { setPreviewError(true); return; }
          context.drawImage(video, 0, 0, canvas.width, canvas.height); setCover(canvas.toDataURL('image/jpeg', 0.85));
        }} onError={() => setPreviewError(true)}/>}
      </LsMediaStateFrame>
    </div>
    <Space direction="vertical" size={4}><Tag color={missing ? 'warning' : undefined}>{missing ? '文件缺失' : cover ? '可预览' : previewError ? '封面暂不可用' : data ? '成片待核对' : '核对中'}</Tag><Tag>{adLabel}</Tag>
      {previewError && <Button size="small" onClick={() => setRetry(n => n + 1)}>重试封面</Button>}
    </Space>
  </div>;
}
