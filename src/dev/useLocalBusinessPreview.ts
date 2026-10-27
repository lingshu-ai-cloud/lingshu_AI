import { useEffect, useState } from 'react';
import { platformAdsRequest } from '../lib/platformAds';
import type { LocalBusinessPreview } from '../../shared/localBusinessPreview';
export function useLocalBusinessPreview(identity: string) {
  const [value, setValue] = useState<LocalBusinessPreview | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
    const abort = new AbortController();
    void platformAdsRequest<LocalBusinessPreview>('/local-business-preview', { signal: abort.signal }).then(data => { if (!abort.signal.aborted) setValue(data); }).catch(() => {});
    return () => abort.abort();
  }, [identity]);
  return value;
}
