import { useEffect, useState } from 'react';
import { Button, Space, Tag } from 'antd';
import type { AdSourceEntry, AdSourceLifecycle } from '../../shared/adSourceLifecycle';
import { platformAdsRequest } from '../lib/platformAds';
import { authHeader } from '../lib/auth';
import { LsMediaStateFrame, LsProgressiveMedia } from './ui/LsExperiencePrimitives';
import type { AdMaterialSelection } from '../../shared/platformAdCreatives';
import { adContentStatusLabel } from '../../shared/platformAdCreatives';

export function historyQuery(source: AdSourceEntry) {
  return new URLSearchParams({ origin: source.origin, ...(source.sourceId ? { sourceId: source.sourceId } : {}),
    ...(source.origin === 'studio' ? { projectId: source.projectId || '' } : { sourceTaskId: source.sourceTaskId || '', artifactId: source.artifactId || '' }) }).toString();
}
/** Identity-keyed by the parent. No thumbnail or metrics are reused across source records. */
export default function AdHistoryMedia({ source, refresh, onSelect, blockedReason, mediaOnly = false, thumbnailOnly = false, selectLabel = '选择素材' }: { source: AdSourceEntry; refresh: number; onSelect?: (selection: AdMaterialSelection) => void; blockedReason?: string; mediaOnly?: boolean; thumbnailOnly?: boolean; selectLabel?: string }) {
  const [selection, setSelection] = useState<AdMaterialSelection | null>(null), [selectionError, setSelectionError] = useState('');
  const [data, setData] = useState<AdSourceLifecycle | null>(null), [failed, setFailed] = useState(false);
  const [url, setUrl] = useState(''), [cover, setCover] = useState(''), [previewError, setPreviewError] = useState(false), [retry, setRetry] = useState(0);
  const query = historyQuery(source);
  useEffect(() => {
    if (mediaOnly && !source.sourceId) return;
    const c = new AbortController(); setData(null); setFailed(false);
    platformAdsRequest<AdSourceLifecycle>(`/creative-lifecycle?${query}`, { signal: c.signal }).then(r => { if (!c.signal.aborted) setData(r); })
      .catch(() => { if (!c.signal.aborted) setFailed(true); });
    return () => c.abort();
  }, [query, refresh, mediaOnly]);
  const available = source.verifiedSource && (!!source.sourceId ? !!data?.fileEvidence?.length && data.fileEvidence.every(f => f.state === 'verified') : true);
  useEffect(() => {
    const c = new AbortController(); let blobUrl = ''; setUrl(''); setCover(''); setPreviewError(false); setSelection(null); setSelectionError('');
    if (available) void (async () => {
      if (!source.sourceId) {
        try {
          const choice = await platformAdsRequest<AdMaterialSelection>(`/creative-selection?${query}`, { signal: c.signal });
          if (source.sha256 && choice.sha256 !== source.sha256) throw new Error('文件版本已变化，请重新核对素材');
          if (c.signal.aborted) return; setSelection(choice);
        } catch (e) { if (c.signal.aborted) return; setSelectionError(e instanceof Error ? e.message : '素材暂不能选择'); throw e; }
      }
      const r = await fetch(`/api/overseas/platform-ads/${source.sourceId ? 'creative-history' : 'creative-selection'}/media?${query}`, { headers: authHeader(), signal: c.signal });
      if (!r.ok || !r.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('preview unavailable');
      const blob = await r.blob(); if (c.signal.aborted) return;
      blobUrl = URL.createObjectURL(blob); setUrl(blobUrl);
    })().catch(e => { if (!c.signal.aborted) { setPreviewError(true); setSelectionError(e instanceof Error ? e.message : '素材暂不可用'); } });
    return () => { c.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [query, available, refresh, retry]);
  const missing = data?.fileEvidence?.some(f => f.state === 'missing');
  const fileLabel = missing ? '原始文件缺失' : failed ? '素材状态暂不可用' : previewError ? '封面暂不可用' : available ? '读取真实首帧' : data ? '尚无可预览成片' : '核对素材';
  const adLabel = !data ? (failed ? '投放关联待核对' : '核对投放关联') : !data.ads.length ? '未关联广告（本系统）' : data.ads.some(a => a.error || !a.report) ? '投放数据暂不可用'
    : data.ads.every(a => !a.report?.totals) ? '平台暂无数据' : '已有投放数据';
  const metaStatuses = [...new Set((data?.ads || []).flatMap(ad => ad.report ? [ad.report.adEffectiveStatus] : []))];
  const metaLabel = metaStatuses.map(status => ({ PENDING_REVIEW: '待审核', PAUSED: '暂停', ACTIVE: '启用', DISAPPROVED: '审核未通过', WITH_ISSUES: '存在问题', IN_PROCESS: '平台处理中' } as Record<string, string>)[status] || status).join(' / ');
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
    {!thumbnailOnly && <Space direction="vertical" size={4}><Tag color={missing ? 'warning' : undefined}>{missing ? '文件缺失' : cover ? '文件可用 · 可预览' : selection ? `文件可用 · ${previewError ? '封面暂不可用' : '封面加载中'}` : previewError ? '封面暂不可用' : data ? '文件待核对' : '核对中'}</Tag>
      <Tag>内部内容：{adContentStatusLabel(selection?.contentStatus || source.sourceMediaStatus)}</Tag>
      <Tag>使用范围：{source.sourceTenantName || '当前企业'}{source.sourceId ? ' · 只读' : ''}</Tag>
      {!mediaOnly && <><Tag>{adLabel}</Tag>{metaLabel && <Tag>Meta 广告：{metaLabel}</Tag>}</>}
      {previewError && <Button size="small" onClick={() => setRetry(n => n + 1)}>重试封面</Button>}
      {onSelect && <><Button size="small" type="primary" disabled={!!blockedReason || !selection} onClick={() => { if (selection && !blockedReason) onSelect(selection); }}>{selectLabel}</Button><span className="ads-library-meta">{blockedReason || (missing ? '请先找回原文件' : source.sourceId ? '外部企业只读素材，未开放跨企业投放复用' : selection ? '文件已核验 · 仅保存选择，不上传' : selectionError || (!source.verifiedSource ? '尚无可用成片，不能选择' : '核对文件与使用权限后可选'))}</span></>}
    </Space>}
  </div>;
}
