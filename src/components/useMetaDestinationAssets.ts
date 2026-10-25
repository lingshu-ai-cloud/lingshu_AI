import { useEffect, useState } from 'react';
import type { MetaDestinationAssets, MetaDestinationKind } from '../../shared/metaDestinationAssets';
import { platformAdsRequest } from '../lib/platformAds';
export function useMetaDestinationAssets(connectionId: string, pageId: string, kind: MetaDestinationKind | null) {
  const key = `${connectionId}:${pageId}:${kind}`;
  const [result, setResult] = useState<{ key: string; data?: MetaDestinationAssets; error?: string; errorCode?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setResult(null);
    if (connectionId && pageId && kind) {
      const query = new URLSearchParams({ pageId, kind });
      platformAdsRequest<MetaDestinationAssets>(`/connections/${encodeURIComponent(connectionId)}/meta-destination-assets?${query}`, { signal: controller.signal })
        .then(data => { if (!controller.signal.aborted) setResult({ key, data }); })
        .catch(error => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : '平台资产暂时读取失败', errorCode: error?.code }); });
    }
    return () => controller.abort();
  }, [connectionId, pageId, kind, key, revision]);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    if (!connectionId || !pageId || !kind) return;
    let last = 0;
    const refresh = () => { if (document.visibilityState === 'visible' && Date.now() - last > 1000) { last = Date.now(); setRevision(v => v + 1); } };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [connectionId, pageId, kind]);
  return { data: current?.data, error: current?.error, errorCode: current?.errorCode, loading: !!connectionId && !!pageId && !!kind && !current, refresh: () => setRevision(v => v + 1) };
}
