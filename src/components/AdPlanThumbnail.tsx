import { useEffect, useState } from 'react';
import type { PlatformAdTask } from '../lib/platformAds';
import type { MetaPlanAuditEntry } from '../../shared/metaPlanAudit';
import type { MetaAdAsset } from '../../shared/adAccountDirectory';
import { platformAdsRequest } from '../lib/platformAds';
import AdHistoryMedia from './AdHistoryMedia';
import { LsProgressiveMedia } from './ui/LsExperiencePrimitives';
export default function AdPlanThumbnail({ task, entry }: { task: PlatformAdTask; entry?: MetaPlanAuditEntry }) {
  const source = task.configuration.materialSource;
  const [asset, setAsset] = useState<MetaAdAsset | null>(null), [coverError, setCoverError] = useState(false);
  useEffect(() => {
    const c = new AbortController(); setAsset(null); setCoverError(false);
    if (!source && entry) platformAdsRequest<MetaAdAsset>(`/connections/${encodeURIComponent(entry.connectionId)}/history/${encodeURIComponent(entry.accountId)}/ads/${encodeURIComponent(entry.adId)}/creative`, { signal: c.signal }).then(value => { if (!c.signal.aborted) setAsset(value); }).catch(() => { if (!c.signal.aborted) setCoverError(true); });
    return () => c.abort();
  }, [task.id, source?.sha256, entry?.connectionId, entry?.adId]);
  return <div className="ads-material-table-thumbnail">{source ? <AdHistoryMedia key={`${task.id}:${source.sha256}`} source={{ ...source, key: `${source.sourceTaskId}:${source.artifactId}:${source.sha256}`, status: 'completed', createdAt: '', verifiedSource: true, note: '' }} refresh={0} mediaOnly thumbnailOnly/> : asset?.thumbnailUrl ? <LsProgressiveMedia src={asset.thumbnailUrl} alt={task.video || task.name} preview width={64} height={40} style={{ objectFit: 'cover' }}/> : <span className="ads-plan-thumbnail-empty">{coverError ? '封面读取失败' : '暂无封面'}</span>}</div>;
}
